/**
 * LumiIQ — Gaze Engine V3
 * ------------------------------------------------------------------
 * Browser-native eye-gaze tracking. Pipeline per frame:
 *
 *   MediaPipe Face Landmarker (face mesh + iris + head-pose matrix)
 *        │
 *        ▼  feature vector  [lx, ly, rx, ry, yaw, pitch, roll, ear]
 *   GazeCalibration.predict()  ── ridge regression over polynomial features,
 *        │                         trained from a 5/9/16/25-point calibration
 *        ▼  normalized screen point (0..1)
 *   GazeStabilizer  ── One Euro filter + deadband (steady yet responsive)
 *        │
 *        ▼  pixel cursor
 *   DwellController ── focus → stability → dwell → activate
 *
 * Runs entirely client-side at camera frame-rate, so it meets the low-latency
 * target that a server round-trip cannot. Depends on the modules in /gaze:
 * one-euro-filter.js, ridge-regression.js, gaze-stabilizer.js,
 * dwell-controller.js, gaze-calibration.js (loaded before this file).
 */

const LumiGaze = {
    faceLandmarker: null,
    videoElement: null,
    stream: null,
    isInitialized: false,
    isTracking: false,

    // Width of the vector built by _extractFeatures. A calibration trained on a
    // different width cannot be restored into this engine.
    FEATURE_DIM: 10,

    // V3 subsystems
    calibration: null,     // GazeCalibration instance (trained model lives here)
    stabilizer: null,      // GazeStabilizer instance
    dwell: null,           // DwellController instance

    // State
    isCalibrating: false,
    isCalibrated: false,
    calibTarget: null,     // { x, y, index, total } normalized
    rawRatios: { x: 0.5, y: 0.5 },   // for the diagnostic canvas overlay
    lastConfidence: 0,

    // Cached settings (avoids per-frame LumiStore.getSettings() calls)
    _cachedSettings: null,
    _lastFrameTime: -1,     // for RAF fallback dedup

    // Blink / Emergency
    blinkHistory: [],
    eyesClosedSince: null,
    emergencyAlertTriggered: false,

    // Callbacks (wired by app.js)
    onGazeUpdate: null,          // (x, y, eyeMode, state)
    onBlink: null,               // (whichEye)
    onDwellProgress: null,       // (element, ratio 0-1)
    onDwellClick: null,          // (element)
    onEmergencyAlert: null,      // (type, details)
    onStatusUpdate: null,        // (message, type)
    onCalibrationCollect: null,  // (sampleCount)
    onCalibrationComplete: null, // (report)

    // ─────────────────────────────────────────────────────
    //  INIT — load MediaPipe + construct V3 subsystems
    // ─────────────────────────────────────────────────────
    async init(videoElement) {
        this.videoElement = videoElement;
        this.updateStatus('Loading AI Face Mesh…', 'info');
        try {
            const { FaceLandmarker, FilesetResolver } = await import(
                '/lib/mediapipe/vision_bundle.mjs'
            );
            const vision = await FilesetResolver.forVisionTasks(
                '/lib/mediapipe/wasm'
            );
            this.faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
                baseOptions: {
                    modelAssetPath: '/models/face_landmarker.task',
                    delegate: 'GPU'
                },
                runningMode: 'VIDEO',
                numFaces: 1,
                outputFaceBlendshapes: false,
                outputFacialTransformationMatrixes: true   // ← head pose (yaw/pitch/roll)
            });

            this._buildSubsystems();
            this.isInitialized = true;
            this.updateStatus('AI ready. Grant camera access.', 'success');

            // Restore a previously trained calibration if one was saved.
            const saved = LumiStore.getCalibration();
            const restored = saved && saved.version === 3 ? GazeCalibration.fromJSON(saved) : null;
            if (restored && restored.isReady && restored.featureDim === this.FEATURE_DIM) {
                this.calibration = restored;
                this.isCalibrated = true;
                const q = restored.report ? `${restored.report.rating} (${restored.report.confidence}%)` : '';
                this.updateStatus(`Calibration restored ${q}`.trim(), 'info');
            } else if (restored) {
                this.updateStatus('Saved calibration is out of date — please recalibrate.', 'info');
            }
            return true;
        } catch (err) {
            console.error('LumiGaze init failed:', err);
            this.updateStatus('Failed to load AI engine. Check internet.', 'error');
            return false;
        }
    },

    _buildSubsystems() {
        const s = LumiStore.getSettings();
        this.stabilizer = new GazeStabilizer({
            width: window.innerWidth,
            height: window.innerHeight,
            ...this._stabilizerParams(s)
        });
        this.dwell = new DwellController({
            dwellTime: s.dwellTimeMs,
            adaptive: true,
            hitTest: (x, y) => this._hitTest(x, y),
            onProgress: (el, p) => { if (this.onDwellProgress) this.onDwellProgress(el, p); },
            onActivate: (el) => { if (this.onDwellClick) this.onDwellClick(el); }
        });
        window.addEventListener('resize', () => {
            if (this.stabilizer) this.stabilizer.setBounds(window.innerWidth, window.innerHeight);
        });

        // Cache settings and listen for changes
        this._cachedSettings = LumiStore.getSettings();
        window.addEventListener('lumiiq-settings-changed', () => {
            this._cachedSettings = LumiStore.getSettings();
        });
    },

    // Map the "smoothing" setting (0.05 jittery-fast … 0.45 very-smooth) onto
    // One Euro parameters. Lower minCutoff = smoother at rest.
    // V2: Rebalanced for lower latency — Phase 1 accuracy improvements produce
    // cleaner predictions, so we can afford less aggressive smoothing.
    _stabilizerParams(s) {
        const f = Math.min(0.45, Math.max(0.05, s.smoothingFactor != null ? s.smoothingFactor : 0.35));
        return {
            minCutoff: 3.5 - f * 4.0,     // 0.05→3.3Hz (τ≈48ms) … 0.45→1.7Hz (τ≈94ms)
            beta: 0.04 - f * 0.05,         // higher beta for aggressive saccade tracking
            deadband: 2.5
        };
    },

    // ─────────────────────────────────────────────────────
    //  CAMERA
    // ─────────────────────────────────────────────────────
    async startCamera() {
        if (!this.isInitialized) { this.updateStatus('Init LumiGaze first.', 'error'); return false; }
        try {
            this.stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    width: { ideal: 1280 },
                    height: { ideal: 720 },
                    frameRate: { ideal: 30 },
                    facingMode: 'user',
                    // Request auto-adjustment capabilities
                    autoGainControl: true,
                    exposureMode: 'continuous',
                    whiteBalanceMode: 'continuous',
                },
                audio: false
            });

            // Apply advanced constraints if supported
            const track = this.stream.getVideoTracks()[0];
            const capabilities = track.getCapabilities();
            if (capabilities.exposureMode) {
                try {
                    await track.applyConstraints({ advanced: [{ exposureMode: 'continuous' }] });
                } catch(e) {}
            }
            this.videoElement.srcObject = this.stream;
            await new Promise(resolve =>
                this.videoElement.addEventListener('loadeddata', resolve, { once: true }));
            if (this.stabilizer) this.stabilizer.setBounds(window.innerWidth, window.innerHeight);
            this.isTracking = true;
            this._runLoop();
            this.updateStatus('Camera active. Calibrate for best accuracy.', 'success');
            return true;
        } catch (err) {
            console.error('Camera error:', err);
            this.updateStatus('Camera permission denied.', 'error');
            return false;
        }
    },

    stopCamera() {
        this.isTracking = false;
        if (this.stream) { this.stream.getTracks().forEach(t => t.stop()); this.stream = null; }
        if (this.videoElement) this.videoElement.srcObject = null;
        if (this.stabilizer) this.stabilizer.reset();
        if (this.dwell) this.dwell.cancel();
        this.updateStatus('Tracking stopped.', 'info');
    },

    // ─────────────────────────────────────────────────────
    //  MAIN FRAME LOOP
    // ─────────────────────────────────────────────────────
    _runLoop() {
        // Prefer requestVideoFrameCallback: fires only on NEW camera frames (~30Hz)
        // instead of display refresh rate (60–120Hz). Avoids redundant detectForVideo
        // calls on duplicate frames, saving GPU cycles and battery.
        if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
            const onVideoFrame = (now, metadata) => {
                if (!this.isTracking) return;
                try {
                    if (this.videoElement.readyState >= 2) {
                        const r = this.faceLandmarker.detectForVideo(this.videoElement, now);
                        const lm = r.faceLandmarks && r.faceLandmarks[0];
                        const matrix = r.facialTransformationMatrixes && r.facialTransformationMatrixes[0];
                        if (lm) this._processLandmarks(lm, matrix);
                        else if (this.onGazeUpdate) this.onGazeUpdate(null, null, 'none', 'Face not detected', 0);
                    }
                } catch (e) { console.error('Frame error:', e); }
                this.videoElement.requestVideoFrameCallback(onVideoFrame);
            };
            this.videoElement.requestVideoFrameCallback(onVideoFrame);
        } else {
            // Fallback: RAF with timestamp dedup to skip already-processed frames
            const step = (now) => {
                if (!this.isTracking) return;
                if (now !== this._lastFrameTime) {
                    try {
                        if (this.videoElement.readyState >= 2) {
                            const r = this.faceLandmarker.detectForVideo(this.videoElement, now);
                            const lm = r.faceLandmarks && r.faceLandmarks[0];
                            const matrix = r.facialTransformationMatrixes && r.facialTransformationMatrixes[0];
                            if (lm) this._processLandmarks(lm, matrix);
                            else if (this.onGazeUpdate) this.onGazeUpdate(null, null, 'none', 'Face not detected', 0);
                        }
                    } catch (e) { console.error('Frame error:', e); }
                    this._lastFrameTime = now;
                }
                requestAnimationFrame(step);
            };
            requestAnimationFrame(step);
        }
    },

    // ─────────────────────────────────────────────────────
    //  FEATURE EXTRACTION
    // ─────────────────────────────────────────────────────
    _dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); },

    _computeConfidence(features) {
        let score = 1.0;
        
        // 1. EAR sanity — very low or very high EAR suggests bad detection
        const ear = features[7];
        if (ear < 0.12 || ear > 0.45) score *= 0.5;
        
        // 2. Iris containment — iris center should be INSIDE eye contour
        const lx = features[0], ly = features[1];
        if (lx < 0.1 || lx > 0.9 || ly < 0.1 || ly > 0.9) score *= 0.6;
        
        // 3. Head pose extremes — accuracy degrades at large angles
        const yaw = Math.abs(features[4]), pitch = Math.abs(features[5]);
        if (yaw > 25) score *= Math.max(0.3, 1 - (yaw - 25) / 45);
        if (pitch > 20) score *= Math.max(0.3, 1 - (pitch - 20) / 40);
        
        return score;
    },

    /** Head pose (yaw, pitch, roll in degrees) from MediaPipe's 4×4 transform. */
    _headPose(matrix) {
        if (!matrix || !matrix.data) return [0, 0, 0];
        const m = matrix.data; // column-major 4×4
        const R = (r, c) => m[c * 4 + r];
        const sy = Math.hypot(R(0, 0), R(1, 0));
        let x, y, z;
        if (sy > 1e-6) {
            x = Math.atan2(R(2, 1), R(2, 2));
            y = Math.atan2(-R(2, 0), sy);
            z = Math.atan2(R(1, 0), R(0, 0));
        } else {
            x = Math.atan2(-R(1, 2), R(1, 1));
            y = Math.atan2(-R(2, 0), sy);
            z = 0;
        }
        const deg = 180 / Math.PI;
        return [y * deg, x * deg, z * deg]; // [yaw, pitch, roll]
    },

    /**
     * Build the regression feature vector and blink/eye state from landmarks.
     * Returns null if no usable eye is available.
     */
    _extractFeatures(lm, matrix, settings) {
        // Eye-aspect-ratio per eye (vertical opening / horizontal width).
        let earL = this._dist(lm[159], lm[145]) / (this._dist(lm[33], lm[133]) + 1e-6);
        let earR = this._dist(lm[386], lm[374]) / (this._dist(lm[362], lm[263]) + 1e-6);

        // Iris-within-eye ratios (0..1). Independent of head translation.
        let irisL = lm[468], irisR = lm[473];
        let L_tl = lm[33], L_tr = lm[133], L_top = lm[159], L_bot = lm[145];
        let R_tl = lm[362], R_tr = lm[263], R_top = lm[386], R_bot = lm[374];

        if (settings.swapEyes) {
            const t1 = earL; earL = earR; earR = t1;
            [irisL, irisR] = [irisR, irisL];
            [L_tl, R_tl] = [R_tl, L_tl]; [L_tr, R_tr] = [R_tr, L_tr];
            [L_top, R_top] = [R_top, L_top]; [L_bot, R_bot] = [R_bot, L_bot];
        }

        const lOpen = earL > settings.earThreshold;
        const rOpen = earR > settings.earThreshold;

        let lx = (irisL.x - L_tl.x) / (L_tr.x - L_tl.x + 1e-6);
        let ly = (irisL.y - L_top.y) / (L_bot.y - L_top.y + 1e-6);
        let rx = (irisR.x - R_tl.x) / (R_tr.x - R_tl.x + 1e-6);
        let ry = (irisR.y - R_top.y) / (R_bot.y - R_top.y + 1e-6);

        // Honour the active-eye preference and substitute for a closed eye so the
        // feature vector is always complete (single-eye patients keep working).
        const useL = lOpen && (settings.activeEye === 'left' || settings.activeEye === 'both');
        const useR = rOpen && (settings.activeEye === 'right' || settings.activeEye === 'both');
        let eyeMode = 'none';
        if (useL && useR) eyeMode = 'both';
        else if (useL) { rx = lx; ry = ly; eyeMode = 'left'; }
        else if (useR) { lx = rx; ly = ry; eyeMode = 'right'; }
        else return { eyeMode: 'none', earL, earR, lOpen, rOpen };

        const [yaw, pitch, roll] = this._headPose(matrix);
        const ear = (earL + earR) / 2;

        // Face scale (inter-eye-corner distance, normalizes for head distance from camera)
        const faceScale = Math.hypot(lm[33].x - lm[263].x, lm[33].y - lm[263].y);

        // Inter-pupillary distance (sensitive to head rotation)
        const ipd = Math.hypot(lm[468].x - lm[473].x, lm[468].y - lm[473].y);

        return {
            features: [lx, ly, rx, ry, yaw, pitch, roll, ear, faceScale, ipd],
            eyeMode, earL, earR, lOpen, rOpen,
            rawRatios: { x: (lx + rx) / 2, y: (ly + ry) / 2 }
        };
    },

    // ─────────────────────────────────────────────────────
    //  LANDMARK PROCESSING (per frame)
    // ─────────────────────────────────────────────────────
    _processLandmarks(lm, matrix) {
        const settings = this._cachedSettings || LumiStore.getSettings();
        const fx = this._extractFeatures(lm, matrix, settings);

        if (fx.features) {
            const conf = this._computeConfidence(fx.features);
            this.lastConfidence = conf;
        } else {
            this.lastConfidence = 0;
        }

        // ── Calibration capture mode ────────────────────
        if (this.isCalibrating) {
            if (fx.eyeMode !== 'none' && fx.features) {
                this.calibration.addSample(fx.features);
                this.rawRatios = fx.rawRatios;
                if (this.onCalibrationCollect) this.onCalibrationCollect(this.calibration.sampleCount());
            }
            if (this.onGazeUpdate) this.onGazeUpdate(null, null, fx.eyeMode, 'calibrating', this.lastConfidence);
            return;
        }

        // ── Blink / emergency detection ─────────────────
        this._updateBlinkState(fx, settings);

        if (fx.eyeMode === 'none' || !fx.features) {
            if (this.onGazeUpdate) this.onGazeUpdate(null, null, 'none', 'Eyes closed', this.lastConfidence);
            return;
        }
        this.rawRatios = fx.rawRatios;

        if (this.lastConfidence < 0.2) {
            if (this.onGazeUpdate) this.onGazeUpdate(null, null, fx.eyeMode, 'low_confidence', this.lastConfidence);
            return;
        }

        // ── Predict gaze → stabilize → dwell ────────────
        const norm = this.isCalibrated && this.calibration
            ? this.calibration.predict(fx.features)
            : this._fallbackMap(fx.features);

        this.stabilizer.setParams(this._stabilizerParams(settings));
        const px = norm.x * window.innerWidth;
        const py = norm.y * window.innerHeight;
        const pt = this.stabilizer.process(px, py, performance.now());

        this._avgConfidence = (this._avgConfidence || 1.0) * 0.9 + this.lastConfidence * 0.1;

        if (this.onGazeUpdate) this.onGazeUpdate(pt.x, pt.y, fx.eyeMode, 'active', this._avgConfidence);

        let dynamicDwell = settings.dwellTimeMs;
        if (this._avgConfidence < 0.4) dynamicDwell *= 2.0;
        else if (this._avgConfidence < 0.7) dynamicDwell *= 1.3;

        this.dwell.setDwellTime(dynamicDwell);
        this.dwell.update(pt.x, pt.y, performance.now());
    },

    /** Rough uncalibrated mapping so the cursor is usable before calibration. */
    _fallbackMap(features) {
        const ax = (features[0] + features[2]) / 2;
        const ay = (features[1] + features[3]) / 2;
        const gain = 2.2;
        const mx = 1 - ax; // correct webcam mirror
        return {
            x: Math.max(0, Math.min(1, 0.5 + (mx - 0.5) * gain)),
            y: Math.max(0, Math.min(1, 0.5 + (ay - 0.5) * gain))
        };
    },

    _hitTest(x, y) {
        // Throttle DOM hit-testing to 20Hz (every 50ms) to avoid layout thrashing
        const now = performance.now();
        if (this._lastHitTestTime && now - this._lastHitTestTime < 50) {
            return this._cachedHitTarget;
        }
        this._lastHitTestTime = now;
        const hit = document.elementFromPoint(x, y);
        if (!hit) { this._cachedHitTarget = null; return null; }
        // Only elements explicitly marked .gazeable can be activated by gaze. Plain
        // buttons (alarm "CAREGIVER CONFIRMED", "Stop Gaze Camera", calibration and
        // settings controls) are for the caregiver's mouse/touch only.
        this._cachedHitTarget = hit.closest('.gazeable');
        return this._cachedHitTarget;
    },

    // ─────────────────────────────────────────────────────
    //  BLINK / EMERGENCY
    // ─────────────────────────────────────────────────────
    _updateBlinkState(fx, settings) {
        const bothClosed = !fx.lOpen && !fx.rOpen;
        const activeClosed =
            (settings.activeEye === 'both' && bothClosed) ||
            (settings.activeEye === 'left' && !fx.lOpen) ||
            (settings.activeEye === 'right' && !fx.rOpen);

        const now = Date.now();
        if (activeClosed) {
            if (!this.eyesClosedSince) this.eyesClosedSince = now;
            const dur = (now - this.eyesClosedSince) / 1000;
            if (dur >= 3.0 && !this.emergencyAlertTriggered) {
                this._triggerEmergency('PROLONGED_CLOSURE', `Eyes closed for ${dur.toFixed(1)}s — Unresponsive alert`);
            }
        } else if (this.eyesClosedSince) {
            const d = now - this.eyesClosedSince;
            if (d > 50 && d < 800) this._registerBlink(fx.eyeMode);
            this.eyesClosedSince = null;
        }
    },

    _registerBlink(eye) {
        const now = Date.now();
        this.blinkHistory.push(now);
        this.blinkHistory = this.blinkHistory.filter(t => now - t < 3000);
        if (this.onBlink) this.onBlink(eye);
        if (this.blinkHistory.length >= 6 && !this.emergencyAlertTriggered) {
            this._triggerEmergency('RAPID_BLINKS', 'Rapid blinking detected (6× in 3s) — Eye irritation alert');
        }
    },

    _triggerEmergency(type, details) {
        this.emergencyAlertTriggered = true;
        LumiStore.addAlertLog(type, details);
        if (this.onEmergencyAlert) this.onEmergencyAlert(type, details);
        setTimeout(() => { this.emergencyAlertTriggered = false; }, 15000);
    },

    // ─────────────────────────────────────────────────────
    //  CALIBRATION (V3 — multi-point, regression-trained)
    // ─────────────────────────────────────────────────────
    /** Begin calibration. @param {number} pointCount 5 | 9 | 16 | 25 */
    startCalibration(pointCount = 9) {
        if (!this.calibration || !this.isCalibrating) this.calibration = new GazeCalibration();
        this.calibTarget = this.calibration.begin(pointCount);
        this.isCalibrating = true;
        this.isCalibrated = false;
        this.updateStatus(`Calibration started — ${pointCount} points. Look at the target.`, 'info');
        return this.calibTarget;
    },

    /** Commit the current target's samples and advance (or finish + train). */
    captureCalibrationPoint() {
        if (!this.isCalibrating) return { error: 'not_calibrating' };
        // ~850ms of clean capture at 30fps is ~25 frames. Below 12 the point is
        // mostly blink or lost face, and folding it in would poison the fit —
        // the caller's retry path handles this.
        if (this.calibration.sampleCount() < 12) {
            this.updateStatus('Hold your gaze on the target a moment longer…', 'error');
            return { error: 'insufficient', samples: this.calibration.sampleCount() };
        }
        const res = this.calibration.commitPoint();
        if (!res.done) {
            this.calibTarget = res.next;
            this.updateStatus(`Point ${res.next.index} of ${res.next.total} captured.`, 'info');
            return { done: false, target: res.next, accepted: res.accepted, rejected: res.rejected };
        }

        // Last point captured → train the regression model.
        this.isCalibrating = false;
        const report = this.calibration.train({ width: window.innerWidth, height: window.innerHeight });
        if (report.ok) {
            this.isCalibrated = true;
            LumiStore.saveCalibration(this.calibration.toJSON());
            this.updateStatus(`Calibration complete — ${report.rating} (${report.confidence}%, ~${report.accuracyPx}px).`, 'success');
        } else {
            this.updateStatus('Calibration failed — not enough clean samples. Please retry.', 'error');
        }
        if (this.onCalibrationComplete) this.onCalibrationComplete(report);
        return { done: true, report };
    },

    /** Discard the in-transit samples gathered during the settle phase. */
    clearCalibrationSamples() {
        if (this.isCalibrating && this.calibration) this.calibration.discardCurrentSamples();
    },

    cancelCalibration() {
        this.isCalibrating = false;
        this.calibTarget = null;
        if (this.calibration && !this.calibration.isReady) this.calibration = null;
        this.updateStatus('Calibration cancelled.', 'info');
    },

    updateStatus(msg, type) { if (this.onStatusUpdate) this.onStatusUpdate(msg, type); }
};

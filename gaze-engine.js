/**
 * LumiIQ — Gaze Engine V3
 * ------------------------------------------------------------------
 * Browser-native eye-gaze tracking. Pipeline per frame:
 *
 *   MediaPipe Face Landmarker (face mesh + iris + head-pose matrix)
 *        │
 *        ▼  feature vector  [lx, ly, rx, ry, yaw, pitch, roll, ear, faceScale, ipd]
 *   GazeCalibration.predict()  ── ridge regression over polynomial features,
 *        │                         trained from a 5/9/16/25-point calibration
 *        ▼  normalized screen point (0..1)
 *   GazeStabilizer  ── One Euro filter + deadband (steady yet responsive)
 *        │
 *        ▼  pixel cursor
 *   DwellController ── focus → stability → dwell → activate (only once calibrated)
 *
 * Safety monitoring runs alongside: prolonged eye closure, rapid blinking,
 * no face detected, camera lost, and the page being hidden are all raised or
 * logged. Alarms sound on this device only; nothing is sent elsewhere.
 *
 * Runs entirely client-side at camera frame-rate, so it meets the low-latency
 * target that a server round-trip cannot. Depends on the modules in /gaze:
 * one-euro-filter.js, ridge-regression.js, gaze-stabilizer.js,
 * dwell-controller.js, gaze-calibration.js, gaze-features.js (loaded before
 * this file). Feature extraction itself lives in gaze-features.js, so the
 * offline replay of recorded sessions runs the same code.
 */

const LumiGaze = {
    faceLandmarker: null,
    videoElement: null,
    stream: null,
    isInitialized: false,
    isTracking: false,

    // Width of the vector built by _extractFeatures. A calibration trained on a
    // different width cannot be restored into this engine.
    FEATURE_DIM: GazeFeatures.FEATURE_DIM,

    // V3 subsystems
    calibration: null,     // GazeCalibration in use (the trained model lives here)
    _calibRun: null,       // calibration being recorded; replaces `calibration` only once accepted
    _pendingCalibration: null, // trained run awaiting the caregiver's Accept
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

    // Blink / Emergency (all times are performance.now(): a monotonic clock that
    // system-clock changes cannot make jump)
    blinkHistory: [],
    eyesClosedSince: null,
    _closureAlarmed: false,       // one PROLONGED_CLOSURE alarm per closure episode
    _rapidBlinkQuietUntil: 0,     // RAPID_BLINKS at most once per 15 s
    _lastFaceSeen: null,          // time of the last frame with a face (while tracking)
    _faceLostAlarmed: false,      // one FACE_NOT_DETECTED alarm per episode
    _hiddenSince: null,           // when the page was hidden while tracking
    _pageListenersBound: false,

    // Blink to select: look at a target, then close the eyes deliberately for at
    // least settings.blinkSelectMs (default 500 ms) but less than this maximum.
    // Normal blinks (~100-400 ms) are shorter; closures of 3 s raise an alarm.
    BLINK_SELECT_MAX_MS: 1500,
    BLINK_SETTLE_MS: 300,         // the gaze must have rested on a target this long
    BLINK_LOOKBACK_MS: 300,       // …within this long before the eyes closed (lid-closing drags the estimate)
    _gazeOn: { target: null, since: 0 },   // target under the gaze, and since when
    _settled: null,               // { target, at }: last target the gaze had rested on
    _blinkCandidate: null,        // target to select if the current closure is a deliberate blink

    // Sleep mode (caregiver button): pauses only the eyes-closed alarm. All other
    // monitoring stays on, and once the patient has fallen asleep, activity (eyes
    // open for settings.sleepWakeSec, or a selection) is reported once per waking.
    SLEEP_MAX_MS: 12 * 3600 * 1000,   // ends by itself after 12 h, in case it is forgotten
    SLEEP_ASLEEP_MS: 30000,           // eyes closed this long = asleep; arms the wake report
    _eyesOpenSince: null,
    _sleepClosedSince: null,
    _wakeReportArmed: false,

    // Callbacks (wired by app.js)
    onGazeUpdate: null,          // (x, y, eyeMode, state)
    onBlink: null,               // (whichEye)
    onDwellProgress: null,       // (element, ratio 0-1)
    onDwellClick: null,          // (element)
    onEmergencyAlert: null,      // (type, details)
    onStatusUpdate: null,        // (message, type)
    onNotice: null,              // (message | null, level) persistent notice for the caregiver; null clears it
    onSleepActivity: null,       // (description) patient activity during sleep mode
    onSleepModeChange: null,     // (isOn) sleep mode switched, e.g. ended after 12 h
    onCalibrationCollect: null,  // (sampleCount)
    onCalibrationComplete: null, // (report)
    onFrameInfo: null,           // (info) per-frame detection record for the caregiver's diagnostics

    // Last per-frame record (see _frameInfo). Passive: nothing in the pipeline reads it.
    lastFrameInfo: null,

    // The landmarks of each eye (see gaze-features.js).
    EYE_LANDMARKS: GazeFeatures.EYES,

    // ─────────────────────────────────────────────────────
    //  INIT — load MediaPipe + construct V3 subsystems
    // ─────────────────────────────────────────────────────
    /** Load MediaPipe once; concurrent or repeated calls share the same load. */
    init(videoElement) {
        if (!this._initPromise) {
            this._initPromise = this._load(videoElement).then((ok) => {
                if (!ok) this._initPromise = null;   // allow a retry after a failure
                return ok;
            });
        }
        return this._initPromise;
    },

    /** Separate so tests can replace it; the browser loads the vendored MediaPipe bundle. */
    _importVision() {
        return import('/lib/mediapipe/vision_bundle.mjs');
    },

    /** Create the landmarker on the GPU if possible, else on the CPU (slower, works everywhere). */
    async _createLandmarker(FaceLandmarker, vision) {
        const options = (delegate) => ({
            baseOptions: { modelAssetPath: '/models/face_landmarker.task', delegate },
            runningMode: 'VIDEO',
            numFaces: 1,
            outputFaceBlendshapes: false,
            outputFacialTransformationMatrixes: true   // ← head pose (yaw/pitch/roll)
        });
        try {
            return await FaceLandmarker.createFromOptions(vision, options('GPU'));
        } catch (err) {
            console.warn('GPU face tracking unavailable, using the CPU instead:', err);
            return await FaceLandmarker.createFromOptions(vision, options('CPU'));
        }
    },

    async _load(videoElement) {
        this.videoElement = videoElement;
        this.updateStatus('Loading AI Face Mesh…', 'info');
        try {
            const { FaceLandmarker, FilesetResolver } = await this._importVision();
            const vision = await FilesetResolver.forVisionTasks('/lib/mediapipe/wasm');
            this.faceLandmarker = await this._createLandmarker(FaceLandmarker, vision);

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
            this.updateStatus('Failed to load the face-tracking engine (lib/mediapipe, models/). See the browser console.', 'error');
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
            getRect: (el) => el.getBoundingClientRect(),
            onProgress: (el, p) => { if (this.onDwellProgress) this.onDwellProgress(el, p); },
            onActivate: (el) => {
                this._noteSleepSelection(el);
                if (this.onDwellClick) this.onDwellClick(el);
            }
        });
        window.addEventListener('resize', () => {
            if (this.stabilizer) this.stabilizer.setBounds(window.innerWidth, window.innerHeight);
        });

        // Cache settings and listen for changes
        this._cachedSettings = LumiStore.getSettings();
        if (this._pageListenersBound) return;
        this._pageListenersBound = true;
        window.addEventListener('lumiiq-settings-changed', () => {
            this._cachedSettings = LumiStore.getSettings();
        });
        document.addEventListener('visibilitychange', () => this._onVisibilityChange());
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
        if (this.isTracking || this._starting) return false;   // already running or starting
        this._starting = true;
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
            // Fires when the camera goes away (unplugged, permission revoked) — not on stopCamera().
            track.addEventListener('ended', () => this._onCameraLost());
            const capabilities = typeof track.getCapabilities === 'function' ? track.getCapabilities() : {};
            if (capabilities.exposureMode) {
                try {
                    await track.applyConstraints({ advanced: [{ exposureMode: 'continuous' }] });
                } catch (e) { console.warn('Continuous exposure not applied:', e); }
            }
            this.videoElement.srcObject = this.stream;
            await new Promise(resolve =>
                this.videoElement.addEventListener('loadeddata', resolve, { once: true }));
            if (this.stabilizer) this.stabilizer.setBounds(window.innerWidth, window.innerHeight);
            this.isTracking = true;
            this._lastFaceSeen = performance.now();
            this._faceLostAlarmed = false;
            this._runLoop();
            this._notice(null);
            this.updateStatus('Camera active. Calibrate for best accuracy.', 'success');
            return true;
        } catch (err) {
            console.error('Camera error:', err);
            if (this.stream) { this.stream.getTracks().forEach(t => t.stop()); this.stream = null; }
            this.updateStatus(this._cameraErrorMessage(err), 'error');
            return false;
        } finally {
            this._starting = false;
        }
    },

    /** Say what actually went wrong (getUserMedia error names), not always "permission denied". */
    _cameraErrorMessage(err) {
        switch (err && err.name) {
            case 'NotAllowedError':
            case 'SecurityError':        return 'Camera permission denied — allow camera access for this page.';
            case 'NotFoundError':
            case 'OverconstrainedError': return 'No suitable camera found — connect a webcam.';
            case 'NotReadableError':
            case 'AbortError':           return 'The camera is in use by another app, or could not start.';
            default:                     return `The camera could not start (${(err && (err.name || err.message)) || 'unknown error'}).`;
        }
    },

    stopCamera() {
        this.isTracking = false;
        if (this.stream) { this.stream.getTracks().forEach(t => t.stop()); this.stream = null; }
        if (this.videoElement) this.videoElement.srcObject = null;
        if (this.stabilizer) this.stabilizer.reset();
        if (this.dwell) this.dwell.cancel();
        this._settled = null;
        this.updateStatus('Tracking stopped.', 'info');
        this._notice('Eye monitoring is OFF: the camera is stopped, so no alarms can be raised.', 'warning');
    },

    /** The camera went away while tracking: stop, and alarm — monitoring is no longer possible. */
    _onCameraLost() {
        if (!this.isTracking) return;
        this.isTracking = false;
        if (this.dwell) this.dwell.cancel();
        this.updateStatus('Camera disconnected — monitoring stopped.', 'error');
        this._notice('Eye monitoring is OFF: the camera disconnected.', 'error');
        this._triggerEmergency('CAMERA_LOST', 'The camera stopped (unplugged or blocked) — eye monitoring has stopped');
    },

    /** Browsers pause camera-frame callbacks for hidden pages, so monitoring pauses too: record it. */
    _onVisibilityChange() {
        const now = performance.now();
        if (document.hidden) {
            if (this.isTracking && this._hiddenSince === null) {
                this._hiddenSince = now;
                LumiStore.addAlertLog('MONITORING_PAUSED', 'App hidden (tab switched or window minimised) — eye monitoring paused');
            }
        } else if (this._hiddenSince !== null) {
            const secs = Math.round((now - this._hiddenSince) / 1000);
            this._hiddenSince = null;
            this._lastFaceSeen = now;   // the hidden time is not "no face"
            LumiStore.addAlertLog('MONITORING_RESUMED', `Eye monitoring resumed after being paused for ${secs}s`);
            this._notice(`Eye monitoring was paused for ${secs}s while the app was hidden.`, 'warning');
        }
    },

    _notice(message, level) { if (this.onNotice) this.onNotice(message, level); },

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
                        this._onFrame(this.faceLandmarker.detectForVideo(this.videoElement, now));
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
                            this._onFrame(this.faceLandmarker.detectForVideo(this.videoElement, now));
                        }
                    } catch (e) { console.error('Frame error:', e); }
                    this._lastFrameTime = now;
                }
                requestAnimationFrame(step);
            };
            requestAnimationFrame(step);
        }
    },

    /** Handle one MediaPipe result: a face → the full pipeline; no face → no gaze this frame. */
    _onFrame(result) {
        const now = performance.now();
        this._checkSleepExpiry();
        const lm = result.faceLandmarks && result.faceLandmarks[0];
        const matrix = result.facialTransformationMatrixes && result.facialTransformationMatrixes[0];
        if (lm) {
            this._lastFaceSeen = now;
            this._faceLostAlarmed = false;
            this._processLandmarks(lm, matrix);
            return;
        }
        // Tell the dwell controller: a long enough gap cancels any dwell in progress.
        if (this.dwell) this.dwell.noGaze(now);
        this._checkFaceLost(now);
        if (this.onGazeUpdate) this.onGazeUpdate(null, null, 'none', 'Face not detected', 0);
        const settings = this._cachedSettings || LumiStore.getSettings();
        this._reportFrame({ t: now, face: false, eyes: [], pose: null, confidence: 0, eyeMode: 'none',
                            earThreshold: settings.earThreshold, raw: null }, 'no_face');
    },

    /**
     * What this frame detected, for the caregiver's diagnostics overlay and
     * statistics: each eye's landmarks (normalised video coordinates), its EAR
     * and open/used state, head pose and confidence. Passive: changes nothing.
     */
    _frameInfo(lm, matrix, fx, settings) {
        const P = (i) => ({ x: lm[i].x, y: lm[i].y });
        const engineLeft = settings.swapEyes ? 1 : 0;   // the physical eye the engine calls "L"
        const usedL = fx.eyeMode === 'both' || fx.eyeMode === 'left';
        const usedR = fx.eyeMode === 'both' || fx.eyeMode === 'right';
        const eyes = this.EYE_LANDMARKS.map((e, i) => {
            const ear = this._dist(lm[e.lids[0]], lm[e.lids[1]]) / (this._dist(lm[e.corners[0]], lm[e.corners[1]]) + 1e-6);
            return {
                side: e.side, iris: P(e.iris), corners: e.corners.map(P), lids: e.lids.map(P),
                ear, open: ear > settings.earThreshold, used: i === engineLeft ? usedL : usedR,
            };
        });
        const [yaw, pitch, roll] = this._headPose(matrix);
        return {
            t: performance.now(), face: true, eyes, pose: { yaw, pitch, roll },
            confidence: this.lastConfidence, eyeMode: fx.eyeMode, earThreshold: settings.earThreshold,
            raw: fx.rawRatios || null,   // iris-in-eye ratio of the eyes in use (features' average)
            features: fx.features ? Array.from(fx.features) : null,
        };
    },

    /** Finish a frame record: why it did or did not produce a gaze point (reason), and the point. */
    _reportFrame(info, reason, gaze = null) {
        info.reason = reason;
        info.gaze = gaze ? { x: gaze.x, y: gaze.y } : null;
        this.lastFrameInfo = info;
        // Diagnostics must never disturb monitoring: a failure here is only logged.
        try { if (this.onFrameInfo) this.onFrameInfo(info); }
        catch (err) { console.error('Diagnostics error:', err); }
    },

    /** One FACE_NOT_DETECTED alarm when no face has been seen for faceLostAlarmSec while tracking. */
    _checkFaceLost(now) {
        if (!this.isTracking || this._faceLostAlarmed || this._lastFaceSeen === null) return;
        const settings = this._cachedSettings || LumiStore.getSettings();
        const limitSec = settings.faceLostAlarmSec != null ? settings.faceLostAlarmSec : 10;
        const missingSec = (now - this._lastFaceSeen) / 1000;
        if (missingSec >= limitSec) {
            this._faceLostAlarmed = true;
            this._triggerEmergency('FACE_NOT_DETECTED',
                `No face detected for ${Math.round(missingSec)}s — check the patient and the camera`);
        }
    },

    // ─────────────────────────────────────────────────────
    //  FEATURE EXTRACTION
    // ─────────────────────────────────────────────────────
    // Feature extraction is shared with the offline replay: see gaze/gaze-features.js.
    _dist(a, b) { return GazeFeatures.dist(a, b); },

    _computeConfidence(features) { return GazeFeatures.confidence(features); },

    /** Head pose (yaw, pitch, roll in degrees) from MediaPipe's 4×4 transform. */
    _headPose(matrix) { return GazeFeatures.headPose(matrix); },

    /** The regression feature vector and blink/eye state from landmarks. */
    _extractFeatures(lm, matrix, settings) { return GazeFeatures.extract(lm, matrix, settings); },

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
        const info = this._frameInfo(lm, matrix, fx, settings);

        // ── Blink / emergency detection (also during calibration) ──
        this._updateBlinkState(fx, settings);

        // ── Calibration capture mode ────────────────────
        if (this.isCalibrating) {
            if (fx.eyeMode !== 'none' && fx.features) {
                this._calibRun.addSample(fx.features);
                this.rawRatios = fx.rawRatios;
                if (this.onCalibrationCollect) this.onCalibrationCollect(this._calibRun.sampleCount());
            }
            if (this.onGazeUpdate) this.onGazeUpdate(null, null, fx.eyeMode, 'calibrating', this.lastConfidence);
            this._reportFrame(info, 'calibrating');
            return;
        }

        if (fx.eyeMode === 'none' || !fx.features) {
            this.dwell.noGaze(performance.now());
            if (this.onGazeUpdate) this.onGazeUpdate(null, null, 'none', 'Eyes closed', this.lastConfidence);
            this._reportFrame(info, 'eyes_closed');
            return;
        }
        this.rawRatios = fx.rawRatios;

        if (this.lastConfidence < 0.2) {
            this.dwell.noGaze(performance.now());
            if (this.onGazeUpdate) this.onGazeUpdate(null, null, fx.eyeMode, 'low_confidence', this.lastConfidence);
            this._reportFrame(info, 'low_confidence');
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

        this._avgConfidence = GazeFeatures.smoothConfidence(this._avgConfidence, this.lastConfidence);

        if (this.onGazeUpdate) {
            this.onGazeUpdate(pt.x, pt.y, fx.eyeMode, this.isCalibrated ? 'active' : 'uncalibrated', this._avgConfidence);
        }

        // Before calibration the cursor comes from a rough fixed mapping; letting it
        // click would press random targets (AUDIT M5). Gaze clicks wait for a calibration.
        if (!this.isCalibrated) {
            this.dwell.cancel();
            this._reportFrame(info, 'uncalibrated', pt);
            return;
        }

        const dynamicDwell = settings.dwellTimeMs * GazeFeatures.dwellScale(this._avgConfidence);

        const now = performance.now();
        this._trackSettledTarget(pt, now);
        this.dwell.setParams({
            // "Blink only": the ring fills to show the target is armed; the blink selects.
            autoActivate: this._selectionMode(settings) !== 'blink',
            repeatWhileLooking: settings.dwellRepeat === true,
        });
        this.dwell.setDwellTime(dynamicDwell);
        this.dwell.update(pt.x, pt.y, now);
        this._reportFrame(info, 'ok', pt);
    },

    /** 'both' (dwell or blink, default), 'dwell' or 'blink'. */
    _selectionMode(settings) {
        return settings.selectionMode || 'both';
    },

    /** Remember which target the gaze has rested on, for blink selection. */
    _trackSettledTarget(pt, now) {
        const hit = this._hitTest(pt.x, pt.y);
        if (hit !== this._gazeOn.target) this._gazeOn = { target: hit, since: now };
        if (hit && now - this._gazeOn.since >= this.BLINK_SETTLE_MS) this._settled = { target: hit, at: now };
    },

    /** A deliberate blink ended: select the target the gaze had rested on. */
    _blinkSelect(now) {
        const target = this._blinkCandidate;
        this._blinkCandidate = null;
        if (!target || !this.isCalibrated || this.isCalibrating || target.isConnected === false) return;
        this.dwell.markActivated(target, now);   // so dwell does not click it again at once
        this._noteSleepSelection(target);
        if (this.onDwellClick) this.onDwellClick(target);
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

        const now = performance.now();
        const sleeping = this.isSleepMode();
        const blinkSelectOn = this._selectionMode(settings) !== 'dwell';
        const blinkSelectMs = settings.blinkSelectMs || 500;
        if (activeClosed) {
            if (this.eyesClosedSince === null) {
                this.eyesClosedSince = now;
                // The target to select if this turns out to be a deliberate blink.
                this._blinkCandidate = this._settled && now - this._settled.at <= this.BLINK_LOOKBACK_MS
                    ? this._settled.target : null;
            }
            const dur = (now - this.eyesClosedSince) / 1000;
            // One alarm per closure: the siren keeps sounding until a caregiver
            // dismisses it; a new alarm needs the eyes to open and close again.
            if (dur >= 3.0 && !this._closureAlarmed && !sleeping) {
                this._closureAlarmed = true;
                this._triggerEmergency('PROLONGED_CLOSURE', `Eyes closed for ${dur.toFixed(1)}s — Unresponsive alert`);
            }
        } else if (this.eyesClosedSince !== null) {
            const d = now - this.eyesClosedSince;
            if (blinkSelectOn && d >= blinkSelectMs && d <= this.BLINK_SELECT_MAX_MS) {
                this._blinkSelect(now);       // deliberate blink: select, don't count as a blink
            } else if (d > 50 && d < (blinkSelectOn ? Math.min(800, blinkSelectMs) : 800)) {
                this._registerBlink(fx.eyeMode);
            }
            this._blinkCandidate = null;
            this.eyesClosedSince = null;
            this._closureAlarmed = false;
        }
        this._updateSleepActivity(!activeClosed, settings, now, sleeping);
    },

    _registerBlink(eye) {
        const now = performance.now();
        this.blinkHistory.push(now);
        this.blinkHistory = this.blinkHistory.filter(t => now - t < 3000);
        if (this.onBlink) this.onBlink(eye);
        if (this.blinkHistory.length >= 6 && now >= this._rapidBlinkQuietUntil) {
            this._rapidBlinkQuietUntil = now + 15000;
            this._triggerEmergency('RAPID_BLINKS', 'Rapid blinking detected (6× in 3s) — Eye irritation alert');
        }
    },

    // ─────────────────────────────────────────────────────
    //  SLEEP MODE
    // ─────────────────────────────────────────────────────
    /** Wall-clock ms: sleep mode must survive a page reload. Separate so tests can replace it. */
    _wallNow() { return Date.now(); },

    /** True while sleep mode is on. A stored end time more than 12 h ahead is not trusted. */
    isSleepMode() {
        const until = (this._cachedSettings || LumiStore.getSettings()).sleepModeUntil || 0;
        const left = until - this._wallNow();
        return left > 0 && left <= this.SLEEP_MAX_MS + 60000;
    },

    /** Caregiver button. On: pause only the eyes-closed alarm, for at most 12 hours. */
    setSleepMode(on) {
        LumiStore.updateSetting('sleepModeUntil', on ? this._wallNow() + this.SLEEP_MAX_MS : 0);
        this._eyesOpenSince = null;
        this._sleepClosedSince = null;
        this._wakeReportArmed = false;          // armed once the patient has fallen asleep
        if (!on) this._restartClosureTimer();
        LumiStore.addAlertLog(on ? 'SLEEP_MODE_ON' : 'SLEEP_MODE_OFF', on
            ? 'Sleep mode on: eyes-closed alarm paused, other alarms on; ends automatically after 12 hours'
            : 'Sleep mode off: all alarms on');
        if (this.onSleepModeChange) this.onSleepModeChange(on);
        return on;
    },

    /** When sleep mode ends with the eyes already closed, alarm only after 3 more seconds. */
    _restartClosureTimer() {
        if (this.eyesClosedSince !== null) this.eyesClosedSince = performance.now();
        this._closureAlarmed = false;
    },

    /** Turn sleep mode off, and say so, once its 12 hours are over. */
    _checkSleepExpiry() {
        const settings = this._cachedSettings || LumiStore.getSettings();
        if (!settings.sleepModeUntil || this.isSleepMode()) return;
        LumiStore.updateSetting('sleepModeUntil', 0);
        this._restartClosureTimer();
        LumiStore.addAlertLog('SLEEP_MODE_OFF', 'Sleep mode ended automatically (12-hour limit): all alarms on');
        this._notice('Sleep mode ended automatically after 12 hours: all alarms are on.', 'warning');
        if (this.onSleepModeChange) this.onSleepModeChange(false);
    },

    /** In sleep mode: arm after 30 s asleep; report eyes open for sleepWakeSec (once per waking). */
    _updateSleepActivity(eyesOpen, settings, now, sleeping) {
        if (!sleeping) { this._eyesOpenSince = null; this._sleepClosedSince = null; return; }
        if (eyesOpen) {
            this._sleepClosedSince = null;
            if (this._eyesOpenSince === null) this._eyesOpenSince = now;
            const secs = (now - this._eyesOpenSince) / 1000;
            if (secs >= (settings.sleepWakeSec || 5)) this._reportSleepActivity(`eyes open for ${Math.round(secs)}s`);
        } else {
            this._eyesOpenSince = null;
            if (this._sleepClosedSince === null) this._sleepClosedSince = now;
            if (now - this._sleepClosedSince >= this.SLEEP_ASLEEP_MS) this._wakeReportArmed = true;
        }
    },

    /** A selection during sleep mode is activity too. */
    _noteSleepSelection(el) {
        if (!this.isSleepMode()) return;
        const d = (el && el.dataset) || {};
        const label = String(d.key || d.text || d.part || (el && el.textContent) || '').trim().slice(0, 40);
        this._reportSleepActivity(`selected "${label || 'a button'}"`);
    },

    /** Tell the caregiver (on this device: log + callback → banner and chime), once per waking. */
    _reportSleepActivity(what) {
        if (!this._wakeReportArmed) return;
        this._wakeReportArmed = false;
        LumiStore.addAlertLog('SLEEP_ACTIVITY', `Patient activity during sleep mode: ${what}`);
        if (this.onSleepActivity) this.onSleepActivity(what);
    },

    /** Log and raise an alert. The only place alerts are logged (AUDIT M7: logging it in
     *  several places stored each alarm two or three times). */
    _triggerEmergency(type, details) {
        LumiStore.addAlertLog(type, details);
        if (this.onEmergencyAlert) this.onEmergencyAlert(type, details);
    },

    // ─────────────────────────────────────────────────────
    //  CALIBRATION (V3 — multi-point, regression-trained)
    // ─────────────────────────────────────────────────────
    /**
     * Begin calibration. @param {number} pointCount 5 | 9 | 16 | 25
     * Samples go into a separate run: the calibration in use (if any) keeps
     * working until the new one is trained and accepted (AUDIT M6).
     */
    startCalibration(pointCount = 9) {
        this._calibRun = new GazeCalibration();
        this._pendingCalibration = null;
        this._settled = null;
        this.calibTarget = this._calibRun.begin(pointCount);
        this.isCalibrating = true;
        this.updateStatus(`Calibration started — ${pointCount} points. Look at the target.`, 'info');
        return this.calibTarget;
    },

    /** Commit the current target's samples and advance (or finish + train). */
    captureCalibrationPoint() {
        if (!this.isCalibrating) return { error: 'not_calibrating' };
        // ~850ms of clean capture at 30fps is ~25 frames. Below 12 the point is
        // mostly blink or lost face, and folding it in would poison the fit —
        // the caller's retry path handles this.
        if (this._calibRun.sampleCount() < 12) {
            this.updateStatus('Hold your gaze on the target a moment longer…', 'error');
            return { error: 'insufficient', samples: this._calibRun.sampleCount() };
        }
        const res = this._calibRun.commitPoint();
        if (!res.done) {
            this.calibTarget = res.next;
            this.updateStatus(`Point ${res.next.index} of ${res.next.total} captured.`, 'info');
            return { done: false, target: res.next, accepted: res.accepted, rejected: res.rejected };
        }

        // Last point captured → train the regression model. It is not used or
        // saved until the caregiver accepts it on the results screen.
        this.isCalibrating = false;
        const run = this._calibRun;
        this._calibRun = null;
        const report = run.train({ width: window.innerWidth, height: window.innerHeight });
        if (report.ok) {
            this._pendingCalibration = run;
            this.updateStatus(`Calibration trained — ${report.rating}. Accept it to start using it.`, 'success');
        } else {
            this.updateStatus('Calibration failed — not enough clean samples. The previous calibration is still in use.', 'error');
        }
        if (this.onCalibrationComplete) this.onCalibrationComplete(report);
        return { done: true, report };
    },

    /** Put the reviewed calibration into use and save it. Returns false if there is none. */
    acceptCalibration() {
        if (!this._pendingCalibration) return false;
        this.calibration = this._pendingCalibration;
        this._pendingCalibration = null;
        this.isCalibrated = true;
        LumiStore.saveCalibration(this.calibration.toJSON());
        this.updateStatus(`Calibration in use — ${this.calibration.report.rating}.`, 'success');
        return true;
    },

    /** Drop a trained calibration that was not accepted; the previous one stays in use. */
    discardCalibration() {
        this._pendingCalibration = null;
    },

    /** Discard the in-transit samples gathered during the settle phase. */
    clearCalibrationSamples() {
        if (this.isCalibrating && this._calibRun) this._calibRun.discardCurrentSamples();
    },

    cancelCalibration() {
        this.isCalibrating = false;
        this.calibTarget = null;
        this._calibRun = null;
        this.updateStatus(this.isCalibrated
            ? 'Calibration cancelled — the previous calibration is still in use.'
            : 'Calibration cancelled.', 'info');
    },

    updateStatus(msg, type) { if (this.onStatusUpdate) this.onStatusUpdate(msg, type); }
};

/**
 * LumiIQ - Application Controller
 * - Patient tabs are .gazeable so dwell-click works on them (the Caregiver tab is not)
 * - Dwell progress draws a border sweep on any hovered element
 * - Emergency alarm uses Web Audio synthesis
 */

const EyeApp = {
    activeTab: 'keyboard',
    audioCtx: null,
    sirenInterval: null,
    sirenPlaying: false,
    _audioUnlocked: false,
    driftDetector: null,
    // While an alarm is showing, or until _pillHoldUntil, gaze frames must not
    // overwrite the status pill (they arrive ~30 times a second).
    _alarmActive: false,
    _pillHoldUntil: 0,

    _ensureAudioUnlocked() {
        if (this._audioUnlocked) return;
        if (!this.audioCtx) {
            this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (this.audioCtx.state === 'suspended') {
            this.audioCtx.resume().then(() => {
                this._audioUnlocked = true;
            }).catch(() => {});
        } else {
            this._audioUnlocked = true;
        }
    },

    // ─────────────────────────────────────────────────────
    async init() {
        await LumiStore.init();   // hydrate settings/logs/calibration from server
        LumiVoice.init();         // warm up loud & clear voice engine
        LumiVoice.onError = (text, reason) =>
            this._showNotice(`Speech failed (${reason}) — this message was not spoken aloud: "${text}"`, 'error');
        this._createGazeCursor();
        this._renderTab('keyboard');
        this._bindHeaderEvents();
        this._loadSettingsValues();
        this._bindSettingsInputs();
        this._bindAlarmDismiss();
        document.getElementById('noticeClose')?.addEventListener('click', () => this._showNotice(null));
        this._bindCameraButtons();
        this._bindSleepMode();
        this._bindResetSettings();
        this._bindDiagnostics();
        this._bindEvalWizard();
        this.updatePill('Disconnected', '');

        // Wire up gaze engine callbacks
        LumiGaze.onGazeUpdate    = (x, y, eye, state, conf) => this._onGazeUpdate(x, y, eye, state, conf);
        LumiGaze.onDwellProgress = (el, p)            => this._onDwellProgress(el, p);
        LumiGaze.onDwellClick    = (el)               => this._onDwellClick(el);
        LumiGaze.onBlink         = (eye)              => this._onBlink(eye);
        LumiGaze.onEmergencyAlert= (t, d)             => this._onEmergency(t, d);
        LumiGaze.onStatusUpdate  = (m, t)             => this._onStatus(m, t);
        LumiGaze.onNotice        = (m, level)         => this._showNotice(m, level);
        LumiGaze.onFrameInfo     = (info)             => this._onFrameInfo(info);
        LumiGaze.onSleepActivity = (what)             => this._onSleepActivity(what);
        LumiGaze.onSleepModeChange = ()               => this._updateSleepUi();
        LumiGaze.onCalibrationCollect  = (n)          => this._onCalibCollect(n);
        LumiGaze.onCalibrationComplete = (report)     => this._showCalibResults(report);

        // Global events
        window.addEventListener('eye_symptom_reported', e => {
            this._refreshLogs();
        });
        window.addEventListener('eye_text_spoken', e => {
            this._refreshLogs();
        });
        window.addEventListener('eye_emergency_alert', e => {
            LumiGaze._triggerEmergency(e.detail.type, e.detail.details);
        });
        
        this.driftDetector = new DriftDetector();
        this._updateSleepUi();
    },

    // ─────────────────────────────────────────────────────
    //  CURSOR
    // ─────────────────────────────────────────────────────
    _createGazeCursor() {
        if (document.getElementById('gazeCursor')) return;
        const c = document.createElement('div');
        c.id = 'gazeCursor';
        c.className = 'gaze-cursor hidden';
        c.innerHTML = `<div class="gc-halo"></div><div class="gc-dot"></div>`;
        document.body.appendChild(c);
    },

    // ─────────────────────────────────────────────────────
    //  TABS
    // ─────────────────────────────────────────────────────
    _bindHeaderEvents() {
        document.querySelectorAll('.nav-tab-btn').forEach(btn => {
            btn.addEventListener('click', () => this._renderTab(btn.dataset.tab));
        });
    },

    _renderTab(tabKey) {
        this.activeTab = tabKey;
        document.querySelectorAll('.nav-tab-btn').forEach(b =>
            b.classList.toggle('active', b.dataset.tab === tabKey)
        );
        document.querySelectorAll('.eye-screen').forEach(s =>
            s.classList.toggle('active', s.id === `${tabKey}Screen`)
        );

        if (tabKey === 'keyboard')   LumiKeyboard.render('keyboardScreen');
        if (tabKey === 'phrases')    LumiPhrases.render('phrasesScreen');
        if (tabKey === 'bodymap')    LumiBodyMap.render('bodymapScreen');
        if (tabKey === 'dashboard')  {
            this._loadSettingsValues();
            this._refreshLogs();
            // Pull the freshest logs from the server, then re-render.
            LumiStore.refreshLogs().then(() => this._refreshLogs());
        }
    },

    // ─────────────────────────────────────────────────────
    //  GAZE EVENTS
    // ─────────────────────────────────────────────────────
    _onGazeUpdate(x, y, eye, state, conf) {
        const c = document.getElementById('gazeCursor');
        if (!c) return;
        const pillFree = !this._alarmActive && performance.now() >= this._pillHoldUntil;
        if (x === null) {
            c.classList.add('hidden');
            const reason = { 'Face not detected': 'No face detected', 'Eyes closed': 'Eyes closed',
                             low_confidence: 'Tracking paused (low confidence)', calibrating: 'Calibrating…' }[state];
            if (pillFree) this.updatePill(reason || 'No gaze', state === 'calibrating' ? 'calibrating' : '');
            return;
        }
        c.classList.remove('hidden');
        c.style.left = `${x}px`;
        c.style.top  = `${y}px`;
        const label = eye === 'both' ? 'Both Eyes' : eye === 'left' ? 'Left Eye' : eye === 'right' ? 'Right Eye' : '–';

        // Enlarge targets while tracking confidence is low.
        const severe = conf !== undefined && conf < 0.4;
        const moderate = conf !== undefined && conf >= 0.4 && conf < 0.7;
        document.body.classList.toggle('low-confidence-severe', severe);
        document.body.classList.toggle('low-confidence-moderate', moderate);

        if (pillFree) {   // otherwise an alarm or held message stays visible
            if (state === 'uncalibrated') this.updatePill('Not calibrated — gaze clicks off', 'calibrating');
            else if (severe) this.updatePill(`Tracking: Poor (${Math.round(conf * 100)}%)`, 'warning');
            else if (moderate) this.updatePill(`Tracking: Fair (${Math.round(conf * 100)}%)`, 'active');
            else this.updatePill(`Tracking: ${label}`, 'active');
        }
    },

    _onDwellProgress(el, progress) {
        const ring = el.querySelector('.dwell-progress-ring');
        if (progress > 0) {
            el.classList.add('dwelling');
            if (ring) {
                // Draw circular progress using conic-gradient on the ring
                const deg = Math.round(progress * 360);
                ring.style.background = `conic-gradient(var(--amber) ${deg}deg, transparent ${deg}deg)`;
                ring.style.opacity = '1';
            }
        } else {
            el.classList.remove('dwelling');
            if (ring) { ring.style.opacity = '0'; ring.style.background = 'none'; }
        }
    },

    _onDwellClick(el) {
        // Reset ring
        const ring = el.querySelector('.dwell-progress-ring');
        if (ring) { ring.style.opacity = '0'; ring.style.background = 'none'; }
        el.classList.remove('dwelling');

        // Visual pulse feedback
        el.classList.add('dwell-fired');
        setTimeout(() => el.classList.remove('dwell-fired'), 300);

        // Calculate drift
        const rect = el.getBoundingClientRect();
        const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        const pt = LumiGaze.stabilizer.last;
        if (pt && this.driftDetector && this.driftDetector.onDwellActivate(pt, center, rect)) {
            this._holdPill('⚠️ Calibration drift suspected — please recalibrate', 'alert', 10000);
        }

        // FIRE the actual click
        this._activate(el);
        this._ensureAudioUnlocked();
    },

    // HTML elements have click(); SVG elements (the body-map zones) do not, so
    // dispatch the click event that a mouse click would produce.
    _activate(el) {
        if (typeof el.click === 'function') el.click();
        else el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    },

    _onBlink(eye) {
        console.log(`Blink: ${eye}`);
        this._refreshLogs();
    },

    _onEmergency(type, details) {
        const ov = document.getElementById('emergencyOverlay');
        const desc = document.getElementById('emergencyDesc');
        if (ov && desc) { desc.textContent = details; ov.classList.remove('hidden'); }
        this._alarmActive = true;
        this.updatePill('⚠ EMERGENCY ALERT', 'alert');
        this._playSiren();
        // Already logged by LumiGaze._triggerEmergency — the single logging point.
        this._refreshLogs();
    },

    // Persistent caregiver notice (e.g. "monitoring is off"); null hides it.
    _showNotice(message, level) {
        const box = document.getElementById('noticeBanner');
        const text = document.getElementById('noticeText');
        if (!box || !text) return;
        if (!message) { box.classList.add('hidden'); return; }
        text.textContent = message;
        box.classList.toggle('notice-error', level === 'error');
        box.classList.remove('hidden');
    },

    _onStatus(msg, type) {
        const el = document.getElementById('calibStatusText');
        if (el) el.textContent = `[${type.toUpperCase()}] ${msg}`;
    },

    // ─────────────────────────────────────────────────────
    //  EMERGENCY ALARM
    // ─────────────────────────────────────────────────────
    _playSiren() {
        if (this.sirenPlaying) return;
        this.sirenPlaying = true;
        try {
            if (!this.audioCtx) {
                this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            }
            if (this.audioCtx.state === 'suspended') {
                this.audioCtx.resume();
            }
            this.sirenInterval = setInterval(() => {
                if (!this.audioCtx) return;
                const s = LumiStore.getSettings();
                const vol = s.alarmVolume !== undefined ? s.alarmVolume : 0.5;
                const now = this.audioCtx.currentTime;
                const osc = this.audioCtx.createOscillator();
                const g   = this.audioCtx.createGain();
                osc.connect(g); g.connect(this.audioCtx.destination);
                osc.type = 'sawtooth';
                osc.frequency.setValueAtTime(Math.random() > 0.5 ? 880 : 660, now);
                g.gain.setValueAtTime(vol * 0.5, now);
                g.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
                osc.start(now); osc.stop(now + 0.4);
            }, 500);
        } catch(e) { console.error('Audio err', e); }
    },

    _stopSiren() {
        if (this.sirenInterval) { clearInterval(this.sirenInterval); this.sirenInterval = null; }
        this.sirenPlaying = false;
    },

    _bindAlarmDismiss() {
        const btn = document.getElementById('alarmDismissBtn');
        if (btn) btn.addEventListener('click', () => {
            document.getElementById('emergencyOverlay').classList.add('hidden');
            this._alarmActive = false;
            this._stopSiren();
            this.updatePill(LumiGaze.isTracking ? 'Active' : 'Disconnected', LumiGaze.isTracking ? 'active' : '');
        });
    },

    // ─────────────────────────────────────────────────────
    //  SLEEP MODE (caregiver button; not a gaze target)
    // ─────────────────────────────────────────────────────
    _bindSleepMode() {
        const btn = document.getElementById('sleepModeBtn');
        if (!btn) return;
        btn.addEventListener('click', () => {
            this._ensureAudioUnlocked();          // so the wake-up chime can play later
            LumiGaze.setSleepMode(!LumiGaze.isSleepMode());
            this._updateSleepUi();
            this._refreshLogs();
        });
    },

    _updateSleepUi() {
        const on = LumiGaze.isSleepMode();
        const btn = document.getElementById('sleepModeBtn');
        if (btn) {
            btn.textContent = on ? '☀️ Turn Sleep Mode Off' : '🌙 Turn Sleep Mode On';
            btn.classList.toggle('btn-active', on);
        }
        const badge = document.getElementById('sleepBadge');
        if (badge) badge.classList.toggle('hidden', !on);
    },

    /** The patient became active during sleep mode: tell the caregiver on this device. */
    _onSleepActivity(what) {
        const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        this._showNotice(`Patient activity during sleep mode (${time}): ${what}`, 'warning');
        this._chime();
        this._refreshLogs();
    },

    /** A short two-tone chime: an update for the caregiver, gentler than the alarm siren. */
    _chime() {
        try {
            if (!this.audioCtx) this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            if (this.audioCtx.state === 'suspended') this.audioCtx.resume();
            const s = LumiStore.getSettings();
            const vol = (s.alarmVolume !== undefined ? s.alarmVolume : 0.7) * 0.4;
            [660, 880].forEach((freq, i) => {
                const t = this.audioCtx.currentTime + i * 0.35;
                const osc = this.audioCtx.createOscillator();
                const g = this.audioCtx.createGain();
                osc.connect(g); g.connect(this.audioCtx.destination);
                osc.type = 'sine';
                osc.frequency.setValueAtTime(freq, t);
                g.gain.setValueAtTime(vol, t);
                g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
                osc.start(t); osc.stop(t + 0.3);
            });
        } catch (err) { console.warn('Chime failed:', err); }
    },

    // ─────────────────────────────────────────────────────
    //  CAMERA & CALIBRATION
    // ─────────────────────────────────────────────────────
    _bindCameraButtons() {
        const startBtn = document.getElementById('startCameraBtn');
        if (startBtn) {
            startBtn.addEventListener('click', async () => {
                this._ensureAudioUnlocked();
                if (LumiGaze.isTracking) {
                    LumiGaze.stopCamera();
                    this._drawFeed(null);
                    startBtn.textContent = 'Start Gaze Camera';
                    startBtn.classList.remove('btn-active');
                } else {
                    const video = document.getElementById('caregiverVideo');
                    if (!LumiGaze.faceLandmarker) await LumiGaze.init(video);
                    const ok = await LumiGaze.startCamera();
                    if (ok) {
                        startBtn.textContent = 'Stop Gaze Camera';
                        startBtn.classList.add('btn-active');
                    }
                }
            });
        }

        const calibBtn = document.getElementById('startCalibrationBtn');
        if (calibBtn) calibBtn.addEventListener('click', () => this._startCalib());

        // Point-count selector
        this._calibPoints = 9;
        const hint = document.getElementById('calibPointHint');
        const perPointSec = (this._SETTLE_MS + this._CAPTURE_MS) / 1000;
        const note = { 5: 'fastest', 9: 'default', 16: 'more points', 25: 'most points' };
        const hintText = {};
        for (const n of [5, 9, 16, 25]) hintText[n] = `${n} points · ~${Math.round(n * perPointSec)}s · ${note[n]}`;
        if (hint) hint.textContent = hintText[this._calibPoints];
        document.querySelectorAll('.cal-pt-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.cal-pt-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this._calibPoints = parseInt(btn.dataset.points, 10);
                if (hint) hint.textContent = hintText[this._calibPoints];
            });
        });

        document.getElementById('startCalibProgressBtn')?.addEventListener('click', async () => {
            // Calibration needs a live camera + initialized engine.
            if (!LumiGaze.isInitialized) {
                const video = document.getElementById('caregiverVideo');
                await LumiGaze.init(video);
            }
            if (!LumiGaze.isTracking) await LumiGaze.startCamera();
            if (!LumiGaze.isTracking) { this._onStatus('Camera required for calibration.', 'error'); return; }

            document.getElementById('calibIntro').classList.add('hidden');
            document.getElementById('calibResults').classList.add('hidden');
            document.getElementById('calibDotBox').classList.remove('hidden');
            const target = LumiGaze.startCalibration(this._calibPoints);
            this._beginCalibCapture(target);
        });

        document.getElementById('exitCalibBtn')?.addEventListener('click', () => this._exitCalib());
        document.getElementById('recalibBtn')?.addEventListener('click', () => {
            LumiGaze.discardCalibration();   // the previous calibration stays in use
            document.getElementById('calibResults').classList.add('hidden');
            document.getElementById('calibIntro').classList.remove('hidden');
        });
        document.getElementById('acceptCalibBtn')?.addEventListener('click', () => {
            document.getElementById('calibOverlay').classList.add('hidden');
            if (LumiGaze.acceptCalibration()) {
                this._holdPill(`Calibrated ✓ ${LumiGaze.calibration.report.rating}`, 'active', 4000);
            } else {
                this.updatePill(LumiGaze.isCalibrated ? 'Previous calibration in use' : 'Not calibrated', '');
            }
        });

        // Keyboard escape hatch for the caregiver during calibration.
        document.addEventListener('keydown', e => {
            const box = document.getElementById('calibDotBox');
            if (!box || box.classList.contains('hidden')) return;
            if (e.key === 'Escape') this._exitCalib();
        });
    },

    _startCalib() {
        const ov = document.getElementById('calibOverlay');
        if (!ov) return;
        ov.classList.remove('hidden');
        document.getElementById('calibIntro').classList.remove('hidden');
        document.getElementById('calibDotBox').classList.add('hidden');
        document.getElementById('calibResults').classList.add('hidden');
        this.updatePill('Calibrating…', 'calibrating');
    },

    _exitCalib() {
        if (this._calibTimer) { cancelAnimationFrame(this._calibTimer); this._calibTimer = null; }
        LumiGaze.cancelCalibration();
        document.getElementById('calibOverlay').classList.add('hidden');
        this.updatePill(LumiGaze.isTracking ? 'Active' : 'Disconnected', LumiGaze.isTracking ? 'active' : '');
    },

    // ── Auto-capture: show each target, collect for a fixed window, advance ──
    _SETTLE_MS: 500,    // let the eye land before counting samples
    _CAPTURE_MS: 1100,  // collection window per target

    _beginCalibCapture(target) {
        if (!target) return;
        this._positionCalibDot(target);
        const pill = document.getElementById('calibProgressPill');
        if (pill) pill.textContent = `Point ${target.index + 1} / ${target.total}`;
        const fill = document.getElementById('calibDotFill');
        const dot  = document.getElementById('calibDot');
        const hint = document.getElementById('calibSampleHint');
        if (dot) dot.classList.add('capturing');

        const total = this._SETTLE_MS + this._CAPTURE_MS;
        const start = performance.now();
        let cleared = false;

        const tick = (now) => {
            const elapsed = now - start;
            const settling = elapsed < this._SETTLE_MS;
            // Drop in-transit samples once, when the real collection window opens.
            if (!settling && !cleared) { LumiGaze.clearCalibrationSamples(); cleared = true; }
            const ratio = Math.max(0, Math.min(1, (elapsed - this._SETTLE_MS) / this._CAPTURE_MS));
            const deg = Math.round(ratio * 360);
            if (fill) fill.style.background =
                `conic-gradient(var(--amber) ${deg}deg, rgba(255,255,255,0.10) ${deg}deg)`;
            if (hint) hint.textContent = settling ? 'Hold your gaze…' : `Capturing… ${Math.round(ratio * 100)}%`;

            if (elapsed < total) {
                this._calibTimer = requestAnimationFrame(tick);
            } else {
                this._calibTimer = null;
                if (dot) dot.classList.remove('capturing');
                if (fill) fill.style.background = 'conic-gradient(transparent 0deg, transparent 360deg)';
                const finish = () => {
                    const res = LumiGaze.captureCalibrationPoint();
                    if (res.error === 'insufficient') {
                        // Not enough clean frames (face lost / blinking) — retry this point.
                        if (hint) hint.textContent = 'Missed it — let’s try that point again.';
                        setTimeout(() => this._beginCalibCapture(LumiGaze.calibTarget || target), 600);
                    } else if (res.done) {
                        // onCalibrationComplete handles the results screen.
                    } else if (res.target) {
                        this._beginCalibCapture(res.target);
                    }
                };
                if (target.index + 1 === target.total) {
                    // Training the model blocks the page briefly: let this text paint first.
                    if (hint) hint.textContent = 'Computing calibration…';
                    setTimeout(finish, 50);
                } else {
                    finish();
                }
            }
        };
        this._calibTimer = requestAnimationFrame(tick);
    },

    _onCalibCollect(n) {
        // Live sample counter is reflected through the ring; nothing else needed.
    },

    _showCalibResults(report) {
        document.getElementById('calibDotBox').classList.add('hidden');
        const panel = document.getElementById('calibResults');
        panel.classList.remove('hidden');
        const title = document.getElementById('calibResultsTitle');
        const note  = document.getElementById('crNote');

        const acceptBtn = document.getElementById('acceptCalibBtn');
        if (!report || !report.ok) {
            title.textContent = 'Calibration Incomplete';
            if (acceptBtn) acceptBtn.textContent = 'Close (keep previous calibration)';
            document.getElementById('crRating').textContent = '—';
            document.getElementById('crConfidence').textContent = '—';
            document.getElementById('crAccuracy').textContent = '—';
            document.getElementById('crSamples').textContent = report ? (report.samples || 0) : 0;
            if (note) note.textContent = 'Not enough clean samples were collected. Improve lighting, keep your head still, and try again.';
            this.updatePill('Calibration failed', 'alert');
            return;
        }

        title.textContent = 'Calibration Complete';
        if (acceptBtn) acceptBtn.textContent = 'Accept & Use This Calibration';
        const rate = document.getElementById('crRating');
        rate.textContent = report.rating;
        rate.className = 'cr-value ' + this._ratingClass(report.rating);
        document.getElementById('crConfidence').textContent = report.confidence + '%';
        document.getElementById('crAccuracy').textContent = '~' + report.accuracyPx + ' px';
        document.getElementById('crSamples').textContent = report.samples;
        if (note) note.textContent = report.r2 >= 0.8
            ? 'Accept to start using this calibration. You can recalibrate any time from the Caregiver tab.'
            : 'Accuracy is modest. For better results use more points, improve lighting, and keep your head still.';
        this.updatePill('Review the calibration result', 'calibrating');
    },

    _ratingClass(rating) {
        return { Excellent: 'cr-excellent', Good: 'cr-good', Fair: 'cr-fair', Poor: 'cr-poor' }[rating] || '';
    },

    _positionCalibDot(target) {
        const dot = document.getElementById('calibDot');
        const lbl = document.getElementById('calibLabel');
        if (!dot || !target) return;
        dot.style.left = (target.x * 100) + '%';
        dot.style.top  = (target.y * 100) + '%';
        if (lbl) lbl.textContent = `Look at the target — लक्ष्य को देखें`;
    },

    // ─────────────────────────────────────────────────────
    //  STATUS PILL
    // ─────────────────────────────────────────────────────
    updatePill(msg, state) {
        const dot  = document.getElementById('statusDot');
        const text = document.getElementById('statusText');
        if (!dot || !text) return;
        if (text.textContent === msg && this._pillState === state) return; // called every frame
        this._pillState = state;
        text.textContent = msg;
        dot.className = 'status-dot';
        if (state === 'active')      dot.classList.add('dot-active');
        if (state === 'calibrating') dot.classList.add('dot-calibrating');
        if (state === 'alert')       dot.classList.add('dot-alert');
    },

    /** Show a message that gaze frames will not overwrite for `ms` milliseconds. */
    _holdPill(msg, state, ms) {
        this.updatePill(msg, state);
        this._pillHoldUntil = performance.now() + ms;
    },

    // ─────────────────────────────────────────────────────
    //  LOGS DASHBOARD
    // ─────────────────────────────────────────────────────
    /** Escape text for use inside innerHTML: log entries come from the server
     *  and must never be interpreted as HTML (AUDIT H7). */
    _escape(value) {
        return String(value).replace(/[&<>"']/g, (ch) =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    },

    _refreshLogs() {
        const commBox  = document.getElementById('dashCommLogs');
        const alertBox = document.getElementById('dashAlertLogs');

        if (commBox) {
            // Keyboard SPEAK and phrase selections — everything the patient said.
            const typed   = LumiStore.getTypedLogs().map(l => ({ ...l, disp: `Said: "${l.text}"` }));
            const syms    = LumiStore.getSymptomLogs().map(s => ({ ...s, disp: `Symptom: ${s.bodyPart} — ${s.symptom}` }));
            const all     = [...typed, ...syms].sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp));
            commBox.innerHTML = all.length
                ? all.map(i => `<div class="log-item"><span>${this._escape(i.disp)}</span><span class="log-time">${this._escape(new Date(i.timestamp).toLocaleTimeString())}</span></div>`).join('')
                : '<div class="log-empty">No records yet.</div>';
        }

        if (alertBox) {
            const alerts = LumiStore.getAlertLogs();
            alertBox.innerHTML = alerts.length
                ? alerts.map(a => `<div class="log-item log-alert"><b>${this._escape(a.type)}</b><span>${this._escape(a.details)}</span><span class="log-time">${this._escape(new Date(a.timestamp).toLocaleTimeString())}</span></div>`).join('')
                : '<div class="log-empty">No alerts recorded.</div>';
        }
    },

    // ─────────────────────────────────────────────────────
    //  SETTINGS
    // ─────────────────────────────────────────────────────
    _bindSettingsInputs() {
        document.querySelectorAll('.settings-field input, .settings-field select').forEach(inp => {
            inp.addEventListener('input', e => {
                const key = e.target.id.replace('set_', '');
                let val   = e.target.value;
                if (e.target.type === 'range') val = parseFloat(val);
                if (key === 'swapEyes' || key === 'dwellRepeat') val = (val === 'true');
                LumiStore.updateSetting(key, val);
                const valEl = document.getElementById(`${e.target.id}_val`);
                if (valEl) valEl.textContent = val;
            });
        });
    },

    /** "Reset settings to defaults" (caregiver only). Calibration and logs are not touched. */
    _bindResetSettings() {
        const btn = document.getElementById('resetSettingsBtn');
        if (!btn) return;
        btn.addEventListener('click', () => {
            if (!window.confirm('Reset all settings to their defaults? The calibration and the logs are kept.')) return;
            LumiStore.resetSettings();
            this._loadSettingsValues();
            this._showNotice('Settings reset to their defaults. The calibration and the logs are unchanged.', 'info');
        });
    },

    _loadSettingsValues() {
        const s = LumiStore.getSettings();
        const set = (id, v) => {
            const el = document.getElementById(id);
            if (!el) return;
            el.value = v;
            const ve = document.getElementById(`${id}_val`);
            if (ve) ve.textContent = v;
        };
        set('set_dwellTimeMs',       s.dwellTimeMs);
        set('set_smoothingFactor',   s.smoothingFactor);
        set('set_activeEye',         s.activeEye);
        set('set_earThreshold',      s.earThreshold);
        set('set_alarmVolume',       s.alarmVolume !== undefined ? s.alarmVolume : 0.5);
        set('set_faceLostAlarmSec',  s.faceLostAlarmSec !== undefined ? s.faceLostAlarmSec : 10);
        set('set_sleepWakeSec',      s.sleepWakeSec !== undefined ? s.sleepWakeSec : 5);
        set('set_blinkSelectMs',     s.blinkSelectMs !== undefined ? s.blinkSelectMs : 500);
        set('set_selectionMode',     s.selectionMode || 'both');
        set('set_dwellRepeat',       s.dwellRepeat ? 'true' : 'false');
        set('set_voiceRate',         s.voiceRate !== undefined ? s.voiceRate : 0.95);
        set('set_voicePitch',        s.voicePitch !== undefined ? s.voicePitch : 1.0);
        set('set_voiceVolume',       s.voiceVolume !== undefined ? s.voiceVolume : 1.0);

        const vl = document.getElementById('set_voiceLanguage');
        if (vl) vl.value = s.voiceLanguage || 'en-US';

        const sw = document.getElementById('set_swapEyes');
        if (sw) sw.value = s.swapEyes ? 'true' : 'false';
    },

    // ─────────────────────────────────────────────────────
    //  LIVE FEED OVERLAY & DIAGNOSTICS (caregiver only; nothing is stored or sent)
    // ─────────────────────────────────────────────────────
    // The live video is shown mirrored (styles.css: .feed-video scaleX(-1)); the
    // canvas is not, so camera coordinates are mapped onto it in one place.
    FEED_MIRRORED: true,
    _overlayOn: false,
    _stats: null,
    _statsOn: false,
    _statsShownAt: -Infinity,
    _readoutAt: -Infinity,
    _earCheck: null,

    /** Called by the engine once per camera frame with what it detected. */
    _onFrameInfo(info) {
        if (this._statsOn && this._stats) {
            this._stats.add(info);
            if (performance.now() - this._statsShownAt >= 1000) this._showStats();
        }
        if (this._earCheck) this._earCheck.add(info, performance.now());
        if (this._evalWizard && this._evalWizard.active) this._evalWizard.onFrame(info);
        this._drawFeed(info);
    },

    /** Redraw the feed canvas: the raw eye-direction inset, plus the detection overlay if switched on. */
    _drawFeed(info) {
        const canvas = document.getElementById('caregiverCanvas');
        if (!canvas || !canvas.getContext) return;
        const ctx = canvas.getContext('2d');
        const r = canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
        if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, r.width, r.height);
        if (!info || !LumiGaze.isTracking) { this._showReadout(null); return; }
        if (!r.width) return;                                    // dashboard not shown
        const box = { width: r.width, height: r.height };
        const video = document.getElementById('caregiverVideo');
        if (this._overlayOn && video && video.videoWidth) {
            const map = LumiDiagnostics.feedMapping(video.videoWidth, video.videoHeight, r.width, r.height, this.FEED_MIRRORED);
            LumiDiagnostics.drawOverlay(ctx, info, map, box);
            this._showReadout(info);
        }
        const dir = info.raw ? LumiGaze._fallbackMap([info.raw.x, info.raw.y, info.raw.x, info.raw.y]) : null;
        LumiDiagnostics.drawDirection(ctx, dir, box);
    },

    /** The frame in words under the video; at most 10 updates a second. */
    _showReadout(info) {
        const out = document.getElementById('diagReadout');
        if (!out) return;
        if (!info) { out.textContent = ''; return; }
        const now = performance.now();
        if (now - this._readoutAt < 100) return;
        this._readoutAt = now;
        out.textContent = LumiDiagnostics.describeFrame(info).join('\n');
    },

    _bindDiagnostics() {
        const toggle = document.getElementById('diagOverlayToggle');
        if (toggle) {
            try { this._overlayOn = localStorage.getItem('lumiiq_diag_overlay') === '1'; } catch (e) { /* storage unavailable */ }
            toggle.checked = this._overlayOn;
            toggle.addEventListener('change', () => {
                this._overlayOn = toggle.checked;
                if (!this._overlayOn) this._showReadout(null);
                try { localStorage.setItem('lumiiq_diag_overlay', this._overlayOn ? '1' : '0'); } catch (e) { /* not remembered */ }
            });
        }
        const statsBtn = document.getElementById('diagStatsBtn');
        if (statsBtn) statsBtn.addEventListener('click', () => {
            this._statsOn = !this._statsOn;
            if (this._statsOn && !this._stats) {
                const d = LumiStore.DEFAULT_SETTINGS;
                this._stats = new LumiDiagnostics.FrameStats(d && d.earThreshold != null ? d.earThreshold : 0.18);
            }
            statsBtn.textContent = this._statsOn ? 'Stop frame statistics' : 'Start frame statistics';
            statsBtn.classList.toggle('btn-active', this._statsOn);
            this._showStats();
        });
        document.getElementById('diagStatsReset')?.addEventListener('click', () => {
            if (this._stats) this._stats.reset();
            this._showStats();
        });
        document.getElementById('earCheckBtn')?.addEventListener('click', () => this._startEarCheck());
        document.getElementById('earCheckCancel')?.addEventListener('click', () => this._endEarCheck(true));
    },

    _showStats() {
        this._statsShownAt = performance.now();
        const out = document.getElementById('diagStatsOut');
        if (!out) return;
        if (!this._stats) { out.textContent = 'Not collecting.'; return; }
        out.textContent = this._stats.describe().join('\n') + (this._statsOn ? '' : '\n(paused)');
    },

    /** Guided check of how the EAR threshold classifies this person's open and closed eyes. */
    _startEarCheck() {
        if (this._earCheck) return;
        if (!LumiGaze.isTracking) {
            this._showNotice('Start the gaze camera first: the eyes open / closed check needs the live camera.', 'warning');
            return;
        }
        this._ensureAudioUnlocked();
        const check = new LumiDiagnostics.EarCheck();
        check.start(performance.now());
        this._earCheck = check;
        this._earPhase = null;
        document.getElementById('earCheckOverlay')?.classList.remove('hidden');
        const out = document.getElementById('earCheckOut');
        if (out) out.textContent = '';
        const tick = () => {
            if (this._earCheck !== check) return;          // cancelled
            const ph = check.phase(performance.now());
            if (!ph) { this._endEarCheck(false); return; }
            if (ph.name !== this._earPhase) { this._earPhase = ph.name; this._showEarPhase(ph); }
            this._earTimer = requestAnimationFrame(tick);
        };
        tick();
    },

    _showEarPhase(ph) {
        const dot = document.getElementById('earCheckDot');
        if (dot) {
            dot.classList.toggle('hidden', !ph.dot);
            if (ph.dot) { dot.style.left = `${ph.dot.x * 100}%`; dot.style.top = `${ph.dot.y * 100}%`; }
        }
        const text = document.getElementById('earCheckText');
        if (text) text.textContent = ph.open
            ? `Keep your eyes open and look at the dot (${ph.label.toLowerCase()}).`
            : 'Close your eyes now. Open them at the next chime.';
        if (!ph.open) this._chime();                        // "close your eyes"
    },

    _endEarCheck(cancelled) {
        const check = this._earCheck;
        if (!check) return;
        this._earCheck = null;
        cancelAnimationFrame(this._earTimer);
        document.getElementById('earCheckOverlay')?.classList.add('hidden');
        const out = document.getElementById('earCheckOut');
        if (cancelled) { if (out) out.textContent = 'Check cancelled.'; return; }
        this._chime();                                      // "open your eyes"
        const threshold = LumiStore.getSettings().earThreshold;
        if (out) out.textContent = 'Measured just now (live):\n' +
            LumiDiagnostics.EarCheck.describe(check.result(threshold), threshold).join('\n');
    },

    /** The evaluation wizard (eval/eval-wizard.js): operator only; it binds its own buttons. */
    _evalWizard: null,
    _bindEvalWizard() {
        if (typeof LumiEvalWizard === 'undefined') return;
        this._evalWizard = new LumiEvalWizard.EvalWizard({ gaze: LumiGaze, store: LumiStore, app: this });
    }
};

window.addEventListener('DOMContentLoaded', () => EyeApp.init());

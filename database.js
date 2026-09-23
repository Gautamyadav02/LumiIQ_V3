/**
 * LumiIQ - Data Store (API-backed, keeps working while the server is down)
 *
 * Talks to the Python/SQLite backend over REST, but keeps a synchronous
 * in-memory cache so hot paths (e.g. the gaze loop calling getSettings()
 * every frame) stay fast.
 *
 * Writes go through a queue kept in localStorage and are removed only when
 * the server confirms them, so messages, symptoms and alerts are not lost
 * if the server is unreachable or the page reloads (AUDIT M8). The queue is
 * retried on start-up, when the browser comes back online, and every 30 s.
 * Settings and calibration are also mirrored to localStorage for start-up.
 */

const LumiStore = {
    // Default settings configuration (mirrors server defaults)
    DEFAULT_SETTINGS: {
        dwellTimeMs: 1200,      // Time (in ms) to dwell on an element to trigger click
        smoothingFactor: 0.35,  // 0.05 (least smoothing, fastest) … 0.45 (most smoothing); mapped to One-Euro parameters in gaze-engine.js
        activeEye: 'both',      // 'both', 'left', 'right' (single-eye fallback)
        earThreshold: 0.18,     // Eye Aspect Ratio threshold below which eye is considered closed
        voiceRate: 0.95,        // Speech rate (0.5 to 2)
        voicePitch: 1.0,        // Speech pitch (0.5 to 2)
        voiceVolume: 1.0,       // Speech volume (0.0 to 1.0) — loud & clear
        voiceLanguage: 'en-US', // Default TTS voice locale
        alarmVolume: 0.7,       // Sirens and alarms volume (0.0 to 1.0)
        faceLostAlarmSec: 10,   // Alarm when no face is seen for this long while tracking
        selectionMode: 'both',  // 'both' (dwell or blink), 'dwell' or 'blink'
        blinkSelectMs: 500,     // Eyes closed at least this long (and < 1.5 s) = deliberate blink
        dwellRepeat: false,     // Keep looking at a key to repeat it (else look away, or blink)
        swapEyes: false         // Swap left/right for mirrored webcams
    },

    LS: {
        SETTINGS: 'lumiiq_settings',
        CALIBRATION: 'lumiiq_calibration',
        PENDING: 'lumiiq_pending_writes'   // writes the server has not confirmed yet, oldest first
    },

    MAX_PENDING: 500,        // bound the queue; beyond this the oldest entries are dropped
    RETRY_MS: 30000,

    _cache: {
        settings: null,
        calibration: null,
        typed: [],
        symptom: [],
        alert: []
    },
    online: false,
    _settingsTimer: null,
    _flushPromise: null,
    _seq: 0,

    // ─────────────────────────────────────────────────────
    //  INIT — hydrate cache from server (fallback: localStorage)
    // ─────────────────────────────────────────────────────
    async init() {
        // Settings
        const serverSettings = await this._get('/api/settings');
        if (serverSettings) {
            this._cache.settings = { ...this.DEFAULT_SETTINGS, ...serverSettings };
            this.online = true;
        } else {
            this._cache.settings = { ...this.DEFAULT_SETTINGS, ...this._lsGet(this.LS.SETTINGS, {}) };
        }
        this._lsSet(this.LS.SETTINGS, this._cache.settings);

        // Calibration
        const cal = await this._get('/api/calibration');
        this._cache.calibration = cal || this._lsGet(this.LS.CALIBRATION, null);

        // Logs
        await this.refreshLogs();

        // Deliver anything queued while the server was unreachable.
        window.addEventListener('online', () => this.flushPending());
        setInterval(() => this.flushPending(), this.RETRY_MS);
        this.flushPending();

        console.log(`LumiIQ store ready (online: ${this.online}).`);
    },

    async refreshLogs() {
        const data = await this._get('/api/logs');
        if (data) {
            this._cache.typed   = data.typed   || [];
            this._cache.symptom = data.symptom || [];
            this._cache.alert   = data.alert   || [];
        }
        this._showPendingLogs();
        return this._cache;
    },

    // ─────────────────────────────────────────────────────
    //  SETTINGS (synchronous reads)
    // ─────────────────────────────────────────────────────
    getSettings() {
        return this._cache.settings || this.DEFAULT_SETTINGS;
    },

    updateSetting(key, value) {
        const s = this.getSettings();
        s[key] = value;
        this._lsSet(this.LS.SETTINGS, s);
        // Notify gaze engine and other listeners that settings changed
        window.dispatchEvent(new Event('lumiiq-settings-changed'));
        // Debounce server writes while a slider is being dragged.
        clearTimeout(this._settingsTimer);
        this._settingsTimer = setTimeout(() => this._write('PUT', '/api/settings', { ...s }), 250);
    },

    // ─────────────────────────────────────────────────────
    //  CALIBRATION
    // ─────────────────────────────────────────────────────
    getCalibration() {
        return this._cache.calibration;
    },

    saveCalibration(points) {
        this._cache.calibration = points;
        this._lsSet(this.LS.CALIBRATION, points);
        this._write('PUT', '/api/calibration', points);
    },

    // ─────────────────────────────────────────────────────
    //  LOGS (synchronous reads from cache)
    // ─────────────────────────────────────────────────────
    getTypedLogs()   { return this._cache.typed; },
    getSymptomLogs() { return this._cache.symptom; },
    getAlertLogs()   { return this._cache.alert; },

    addTypedLog(text) {
        if (!text || text.trim() === '') return;
        const body = { text: text.trim(), timestamp: new Date().toISOString() };
        const id = this._write('POST', '/api/logs/typed', body);
        this._remember('typed', { id, ...body }, 200);
        return this._cache.typed;
    },

    addSymptomLog(bodyPart, symptom) {
        const body = { bodyPart, symptom, timestamp: new Date().toISOString() };
        const id = this._write('POST', '/api/logs/symptom', body);
        this._remember('symptom', { id, ...body }, 200);
        return this._cache.symptom;
    },

    addAlertLog(type, details) {
        const body = { type, details, timestamp: new Date().toISOString() };
        const id = this._write('POST', '/api/logs/alert', body);
        this._remember('alert', { id, ...body }, 100);
        return this._cache.alert;
    },

    async clearAllLogs() {
        this._cache.typed = []; this._cache.symptom = []; this._cache.alert = [];
        try { await fetch('/api/logs', { method: 'DELETE' }); }
        catch (err) { console.warn('Could not clear logs on the server:', err); }
    },

    _remember(kind, item, limit) {
        this._cache[kind].unshift(item);
        if (this._cache[kind].length > limit) this._cache[kind].pop();
    },

    /** Put queued (not yet delivered) log entries into the cache so the caregiver still sees them. */
    _showPendingLogs() {
        const kinds = { '/api/logs/typed': 'typed', '/api/logs/symptom': 'symptom', '/api/logs/alert': 'alert' };
        for (const entry of this._pending()) {
            const kind = kinds[entry.url];
            if (!kind || this._cache[kind].some((item) => item.id === entry.id)) continue;
            this._cache[kind].unshift({ id: entry.id, ...entry.body });
        }
    },

    // ─────────────────────────────────────────────────────
    //  WRITE QUEUE — nothing is dropped because the server is down
    // ─────────────────────────────────────────────────────
    /** Queue a write, then try to deliver the queue. Returns the entry id. */
    _write(method, url, body) {
        const entry = { id: `pending_${Date.now()}_${this._seq++}`, method, url, body };
        let queue = this._pending();
        // A newer settings/calibration write supersedes an older queued one.
        if (method === 'PUT') queue = queue.filter((e) => !(e.method === 'PUT' && e.url === url));
        queue.push(entry);
        if (queue.length > this.MAX_PENDING) queue = queue.slice(queue.length - this.MAX_PENDING);
        this._lsSet(this.LS.PENDING, queue);
        this.flushPending();
        return entry.id;
    },

    _pending() { return this._lsGet(this.LS.PENDING, []); },

    /** Deliver queued writes in order; stop at the first failure and retry later. */
    flushPending() {
        if (!this._flushPromise) {
            this._flushPromise = this._deliverQueue().finally(() => { this._flushPromise = null; });
        }
        return this._flushPromise;
    },

    async _deliverQueue() {
        for (let entry = this._pending()[0]; entry; entry = this._pending()[0]) {
            let status;
            try {
                const r = await fetch(entry.url, {
                    method: entry.method,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(entry.body)
                });
                status = r.status;
            } catch (err) {
                this.online = false;          // unreachable: keep everything for the next attempt
                return;
            }
            if (status >= 500) { this.online = false; return; }   // server trouble: retry later
            if (status >= 400) {
                // The server will never accept this entry: drop it rather than block the queue.
                console.warn(`Server rejected ${entry.method} ${entry.url} (HTTP ${status}); dropping it.`);
            }
            this.online = true;
            this._lsSet(this.LS.PENDING, this._pending().filter((e) => e.id !== entry.id));
        }
    },

    // ─────────────────────────────────────────────────────
    //  HTTP / localStorage helpers
    // ─────────────────────────────────────────────────────
    async _get(url) {
        try {
            const r = await fetch(url, { headers: { 'Accept': 'application/json' } });
            if (!r.ok) return null;
            return await r.json();
        } catch (err) {
            console.warn(`GET ${url} failed (server unreachable?):`, err.message || err);
            return null;
        }
    },

    _lsGet(key, fallback) {
        try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
        catch (err) { console.warn(`localStorage read of ${key} failed:`, err); return fallback; }
    },
    _lsSet(key, val) {
        try { localStorage.setItem(key, JSON.stringify(val)); }
        catch (err) { console.warn(`localStorage write of ${key} failed:`, err); }
    }
};

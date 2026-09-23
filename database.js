/**
 * LumiIQ - Data Store (API-backed with offline fallback)
 *
 * Talks to the Python/SQLite backend over REST, but keeps a synchronous
 * in-memory cache so hot paths (e.g. the gaze loop calling getSettings()
 * every frame) stay fast. Every write is mirrored to localStorage, so the
 * UI keeps working even if the server is briefly unreachable.
 */

const LumiStore = {
    // Default settings configuration (mirrors server defaults)
    DEFAULT_SETTINGS: {
        dwellTimeMs: 1200,      // Time (in ms) to dwell on an element to trigger click
        smoothingFactor: 0.35,  // Exponential moving average — higher = faster cursor tracking
        activeEye: 'both',      // 'both', 'left', 'right' (single-eye fallback)
        earThreshold: 0.18,     // Eye Aspect Ratio threshold below which eye is considered closed
        gazeSensitivityX: 1.2,  // Multiplier for horizontal calibration scale
        gazeSensitivityY: 1.2,  // Multiplier for vertical calibration scale
        voiceRate: 0.95,        // Speech rate (0.5 to 2)
        voicePitch: 1.0,        // Speech pitch (0.5 to 2)
        voiceVolume: 1.0,       // Speech volume (0.0 to 1.0) — loud & clear
        voiceLanguage: 'en-US', // Default TTS voice locale
        alarmVolume: 0.7,       // Sirens and alarms volume (0.0 to 1.0)
        faceLostAlarmSec: 10,   // Alarm when no face is seen for this long while tracking
        emergencyContacts: 'Nurse Dashboard, +1 (555) 019-9111',
        swapEyes: false         // Swap left/right for mirrored webcams
    },

    LS: {
        SETTINGS: 'lumiiq_settings',
        CALIBRATION: 'lumiiq_calibration'
    },

    _cache: {
        settings: null,
        calibration: null,
        typed: [],
        symptom: [],
        alert: []
    },
    online: false,
    _settingsTimer: null,

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

        console.log(`LumiIQ store ready (online: ${this.online}).`);
    },

    async refreshLogs() {
        const data = await this._get('/api/logs');
        if (data) {
            this._cache.typed   = data.typed   || [];
            this._cache.symptom = data.symptom || [];
            this._cache.alert   = data.alert   || [];
        }
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
        this._settingsTimer = setTimeout(() => this._put('/api/settings', s), 250);
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
        this._put('/api/calibration', points);
    },

    // ─────────────────────────────────────────────────────
    //  LOGS (synchronous reads from cache)
    // ─────────────────────────────────────────────────────
    getTypedLogs()   { return this._cache.typed; },
    getSymptomLogs() { return this._cache.symptom; },
    getAlertLogs()   { return this._cache.alert; },

    addTypedLog(text) {
        if (!text || text.trim() === '') return;
        const item = { id: 'log_' + Date.now(), text: text.trim(), timestamp: new Date().toISOString() };
        this._cache.typed.unshift(item);
        if (this._cache.typed.length > 200) this._cache.typed.pop();
        this._post('/api/logs/typed', { text: item.text });
        return this._cache.typed;
    },

    addSymptomLog(bodyPart, symptom) {
        const item = { id: 'sym_' + Date.now(), bodyPart, symptom, timestamp: new Date().toISOString() };
        this._cache.symptom.unshift(item);
        if (this._cache.symptom.length > 200) this._cache.symptom.pop();
        this._post('/api/logs/symptom', { bodyPart, symptom });
        return this._cache.symptom;
    },

    addAlertLog(type, details) {
        const item = { id: 'alert_' + Date.now(), type, details, timestamp: new Date().toISOString() };
        this._cache.alert.unshift(item);
        if (this._cache.alert.length > 100) this._cache.alert.pop();
        this._post('/api/logs/alert', { type, details });
        return this._cache.alert;
    },

    async clearAllLogs() {
        this._cache.typed = []; this._cache.symptom = []; this._cache.alert = [];
        await this._del('/api/logs');
    },

    // ─────────────────────────────────────────────────────
    //  HTTP helpers (never throw — always degrade gracefully)
    // ─────────────────────────────────────────────────────
    async _get(url) {
        try {
            const r = await fetch(url, { headers: { 'Accept': 'application/json' } });
            if (!r.ok) return null;
            return await r.json();
        } catch (_) { return null; }
    },
    _put(url, body) {
        fetch(url, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        }).catch(() => {});
    },
    _post(url, body) {
        fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        }).catch(() => {});
    },
    async _del(url) {
        try { await fetch(url, { method: 'DELETE' }); } catch (_) {}
    },

    _lsGet(key, fallback) {
        try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
        catch (_) { return fallback; }
    },
    _lsSet(key, val) {
        try { localStorage.setItem(key, JSON.stringify(val)); } catch (_) {}
    }
};

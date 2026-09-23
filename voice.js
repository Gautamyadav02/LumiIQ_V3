/**
 * LumiIQ - Voice Engine (loud & clear)
 *
 * Wraps the browser SpeechSynthesis API with:
 *  - Maximum volume by default (configurable in settings)
 *  - Automatic selection of the clearest available voice for the language
 *  - Auto language detection (Devanagari -> hi-IN, else English)
 *  - Chrome "stuck speech" resume workaround
 */

const LumiVoice = {
    _voices: [],

    init() {
        if (!('speechSynthesis' in window)) {
            console.warn('SpeechSynthesis not supported in this browser.');
            return;
        }
        const load = () => { this._voices = window.speechSynthesis.getVoices() || []; };
        load();
        // Voices often load asynchronously.
        window.speechSynthesis.onvoiceschanged = load;
        // Warm-up so the first real utterance is instant and audible.
        setTimeout(load, 300);
    },

    /** Pick the clearest, most natural voice for a given language code. */
    _pickVoice(lang) {
        if (!this._voices.length) {
            this._voices = window.speechSynthesis.getVoices() || [];
        }
        if (!this._voices.length) return null;

        const base = (lang || 'en').slice(0, 2).toLowerCase();
        const matches = this._voices.filter(
            v => v.lang && v.lang.toLowerCase().startsWith(base)
        );
        const pool = matches.length ? matches : this._voices;

        // Prefer high-quality natural voices when present.
        const preferred = pool.find(v => /google|natural|neural|premium|enhanced/i.test(v.name));
        return preferred || pool.find(v => v.localService) || pool[0] || null;
    },

    /**
     * Speak text loudly and clearly.
     * @param {string} text
     * @param {string} [langOverride] - force a BCP-47 lang code
     */
    speak(text, langOverride) {
        if (!('speechSynthesis' in window) || !text) return;

        // Cancel anything already queued so messages never overlap/garble.
        window.speechSynthesis.cancel();

        const s = (typeof LumiStore !== 'undefined') ? LumiStore.getSettings() : {};
        const isHindi = /[ऀ-ॿ]/.test(text);
        const lang = langOverride || (isHindi ? 'hi-IN' : (s.voiceLanguage || 'en-US'));

        const u = new SpeechSynthesisUtterance(text);
        u.lang   = lang;
        u.rate   = s.voiceRate   !== undefined ? s.voiceRate   : 0.95;
        u.pitch  = s.voicePitch  !== undefined ? s.voicePitch  : 1.0;
        u.volume = s.voiceVolume !== undefined ? s.voiceVolume : 1.0; // loud by default

        const voice = this._pickVoice(lang);
        if (voice) u.voice = voice;

        window.speechSynthesis.speak(u);

        // Chrome can silently pause the queue — nudge it back awake.
        setTimeout(() => {
            try { if (window.speechSynthesis.paused) window.speechSynthesis.resume(); } catch (_) {}
        }, 120);
    }
};

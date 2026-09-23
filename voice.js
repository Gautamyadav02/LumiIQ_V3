/**
 * LumiIQ - Voice Engine (loud & clear)
 *
 * Wraps the browser SpeechSynthesis API with:
 *  - Maximum volume by default (configurable in settings)
 *  - On-device voices preferred: online voices fail without internet and
 *    send the patient's words to a cloud speech service
 *  - Auto language detection (Devanagari -> hi-IN, else the chosen language)
 *  - Speech failures reported through onError instead of failing silently
 *  - Chrome "stuck speech" resume workaround
 */

const LumiVoice = {
    _voices: [],
    onError: null,   // (text, reason) — app.js shows a visible warning

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

    /**
     * Pick a voice for a language code. Order of preference:
     *   1. an on-device voice (localService) for the exact locale, e.g. en-GB
     *   2. an on-device voice for the same language, e.g. any English
     *   3. an online voice for the locale / language (better than silence)
     * Among on-device voices, "Premium/Enhanced/Natural/Neural" ones are preferred.
     */
    _pickVoice(lang) {
        if (!this._voices.length) {
            this._voices = window.speechSynthesis.getVoices() || [];
        }
        if (!this._voices.length) return null;

        const want = (lang || 'en-US').toLowerCase();
        const base = want.slice(0, 2);
        const voiceLang = v => (v.lang || '').toLowerCase().replace('_', '-');
        const exact = v => voiceLang(v) === want;
        const sameLanguage = v => voiceLang(v).startsWith(base);
        const best = list => list.find(v => /premium|enhanced|natural|neural/i.test(v.name)) || list[0];

        const local = this._voices.filter(v => v.localService);
        return best(local.filter(exact)) || best(local.filter(sameLanguage))
            || this._voices.find(exact) || this._voices.find(sameLanguage)
            || local[0] || this._voices[0] || null;
    },

    _fail(text, reason) {
        console.warn('Speech failed:', reason);
        if (this.onError) this.onError(text, reason);
    },

    /**
     * Speak text loudly and clearly.
     * @param {string} text
     * @param {string} [langOverride] - force a BCP-47 lang code
     */
    speak(text, langOverride) {
        if (!text) return;
        if (!('speechSynthesis' in window)) { this._fail(text, 'speech is not supported in this browser'); return; }

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

        u.onerror = (e) => {
            // Replaced by a newer message (cancel above) — not a failure.
            if (e.error === 'interrupted' || e.error === 'canceled') return;
            this._fail(text, e.error || 'unknown error');
        };

        window.speechSynthesis.speak(u);

        // Chrome can silently pause the queue — nudge it back awake.
        setTimeout(() => {
            try { if (window.speechSynthesis.paused) window.speechSynthesis.resume(); }
            catch (err) { console.warn('Speech resume failed:', err); }
        }, 120);
    }
};

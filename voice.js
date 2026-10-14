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
     * Within each, voices are ranked by clarity (_clarity): "Premium/Enhanced/Natural/Neural"
     * first, then known clear voices, then the rest. Novelty voices come last, used only
     * when nothing else speaks the language.
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
        const best = list => list.reduce((a, v) => (a && this._clarity(a) <= this._clarity(v) ? a : v), null);

        const local = this._voices.filter(v => v.localService);
        return best(local.filter(exact)) || best(local.filter(sameLanguage))
            || this._voices.find(exact) || this._voices.find(sameLanguage)
            || local[0] || this._voices[0] || null;
    },

    // macOS lists novelty and old robotic voices as ordinary on-device voices, alphabetically
    // before the clear ones: "Albert" (croaky), "Bad News" (sung), "Bells", "Whisper", …
    NOVELTY: /^(albert|bad news|bahh|bells|boing|bubbles|cellos|deranged|good news|grandma|grandpa|hysterical|jester|organ|pipe organ|superstar|trinoids|whisper|wobble|zarvox|fred|junior|ralph|kathy|princess|agnes|bruce|vicki|victoria)\b/i,
    // Natural-sounding voices, clearly spoken: macOS (en, en-IN, hi-IN) and Windows.
    CLEAR: /^(samantha|alex|ava|allison|susan|tom|zoe|evan|nathan|noelle|joelle|daniel|serena|kate|oliver|arthur|martha|karen|lee|moira|tessa|fiona|rishi|veena|isha|neel|kiyara|lekha|microsoft (aria|jenny|guy|zira|david|mark|hazel|george|heera|ravi|kalpana|hemant))\b/i,

    /** 0 is clearest: high-quality variant, known clear voice, any other, novelty. */
    _clarity(v) {
        const name = v.name || '';
        if (this.NOVELTY.test(name)) return 3;
        if (/premium|enhanced|natural|neural/i.test(name)) return 0;
        return this.CLEAR.test(name) ? 1 : 2;
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

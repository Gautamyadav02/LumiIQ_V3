/**
 * LumiIQ - Virtual QWERTY Keyboard
 * FIXES: Dwell-click works on every key. Suggestion bar clickable.
 * Nurse call button dwell works. Speak key vocalises current sentence.
 */

const LumiKeyboard = {
    currentText: '',

    ROWS: [
        ['Q','W','E','R','T','Y','U','I','O','P'],
        ['A','S','D','F','G','H','J','K','L'],
        ['Z','X','C','V','B','N','M','⌫'],
        ['SPACE','SPEAK','CLEAR']
    ],

    render(containerId) {
        const el = document.getElementById(containerId);
        if (!el) return;

        el.innerHTML = `
        <div class="keyboard-wrapper">

            <!-- Word suggestions -->
            <div class="suggestion-bar" id="suggestionBar"></div>

            <!-- Text display + Nurse call -->
            <div class="text-row">
                <div class="text-display" id="keyboardDisplay">
                    <span id="displayText" class="display-text-inner">Start typing…</span>
                </div>
                <button class="nurse-btn gazeable" id="nurseCallBtn">
                    <span style="font-size:2rem">🔔</span>
                    <span>NURSE CALL<br><small>नर्स बुलाएं</small></span>
                    <span class="dwell-progress-ring"></span>
                </button>
            </div>

            <!-- Keys -->
            <div class="keys-grid" id="keysGrid">
                ${this.ROWS.map(row => `
                    <div class="key-row">
                        ${row.map(k => this._keyHTML(k)).join('')}
                    </div>
                `).join('')}
            </div>

        </div>`;

        this._updateDisplay();
        this._updateSuggestions();
        this._bindEvents();
    },

    _keyHTML(k) {
        let cls = 'key-btn gazeable';
        let label = k;
        if (k === '⌫')     { cls += ' key-backspace'; }
        if (k === 'SPACE')  { cls += ' key-space';     label = 'SPACE  ␣'; }
        if (k === 'SPEAK')  { cls += ' key-speak';     label = '🗣 SPEAK'; }
        if (k === 'CLEAR')  { cls += ' key-clear';     label = '✕ CLEAR'; }
        return `
        <button class="${cls}" data-key="${k}">
            <span class="key-label">${label}</span>
            <span class="dwell-progress-ring"></span>
        </button>`;
    },

    _bindEvents() {
        // Key buttons
        document.querySelectorAll('#keysGrid .key-btn').forEach(btn => {
            btn.addEventListener('click', () => this._handleKey(btn.dataset.key));
        });
        // Nurse call
        const nurse = document.getElementById('nurseCallBtn');
        if (nurse) nurse.addEventListener('click', () => this._nurseCall());
    },

    _handleKey(k) {
        if (k === '⌫') {
            this.currentText = this.currentText.slice(0, -1);
        } else if (k === 'SPACE') {
            // Autocorrect last word on space
            const words = this.currentText.trimEnd().split(/\s+/);
            const last  = words[words.length - 1] || '';
            if (last.length > 1) {
                const fixed = LumiDictionary.autocorrect(last);
                if (fixed !== last) {
                    const idx = this.currentText.lastIndexOf(last);
                    this.currentText = this.currentText.slice(0, idx) + fixed;
                }
            }
            this.currentText += ' ';
        } else if (k === 'CLEAR') {
            this.currentText = '';
        } else if (k === 'SPEAK') {
            this._speak();
            return; // Don't update display twice
        } else {
            this.currentText += k;
        }
        this._updateDisplay();
        this._updateSuggestions();
    },

    _updateDisplay() {
        const el = document.getElementById('displayText');
        if (!el) return;
        el.textContent = this.currentText || 'Start typing…';
    },

    _updateSuggestions() {
        const bar = document.getElementById('suggestionBar');
        if (!bar) return;
        const preds = LumiDictionary.getPredictions(this.currentText);
        bar.innerHTML = preds.map(w => `
            <button class="sug-btn gazeable" data-word="${w}">
                ${w}
                <span class="dwell-progress-ring"></span>
            </button>
        `).join('');
        bar.querySelectorAll('.sug-btn').forEach(b => {
            b.addEventListener('click', () => this._selectSuggestion(b.dataset.word));
        });
    },

    _selectSuggestion(word) {
        const words = this.currentText.trimEnd().split(/\s+/);
        const last  = words[words.length - 1] || '';
        if (last && !this.currentText.endsWith(' ')) {
            const idx = this.currentText.lastIndexOf(last);
            this.currentText = this.currentText.slice(0, idx) + word + ' ';
        } else {
            this.currentText += word + ' ';
        }
        this._updateDisplay();
        this._updateSuggestions();
    },

    _speak() {
        const text = this.currentText.trim();
        if (!text) return;
        LumiStore.addTypedLog(text);

        // Loud & clear voice output
        LumiVoice.speak(text);

        // Flash the display
        const d = document.getElementById('keyboardDisplay');
        if (d) {
            d.classList.add('display-flash');
            setTimeout(() => d.classList.remove('display-flash'), 900);
        }

        window.dispatchEvent(new CustomEvent('eye_text_spoken', { detail: { text } }));
    },

    _nurseCall() {
        // Logged once, by LumiGaze._triggerEmergency (via app.js).
        window.dispatchEvent(new CustomEvent('eye_emergency_alert', {
            detail: { type: 'NURSE_CALL_BUTTON', details: 'Patient pressed Nurse Call button!' }
        }));
    }
};

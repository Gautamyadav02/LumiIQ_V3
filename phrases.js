const LumiPhrases = {
    categories: {
        "Urgent": ["I need help", "Call nurse", "I can't breathe", "I'm in pain"],
        "Comfort": ["I'm thirsty", "I'm cold", "Turn me over", "Adjust pillow"],
        "Medical": ["I need medicine", "I feel dizzy", "My chest hurts", "Suction tube"],
        "Social": ["Call my family", "Thank you", "Yes", "No"]
    },
    // Phrases in this category also raise the caregiver alarm (siren + safety log),
    // like Nurse Call: they must not depend on someone being in earshot.
    URGENT_CATEGORY: "Urgent",

    render(containerId) {
        const c = document.getElementById(containerId);
        if (!c) return;
        let html = '<div class="phrases-layout" style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; height: 100%;">';
        for (const [cat, phrases] of Object.entries(this.categories)) {
            const urgent = cat === this.URGENT_CATEGORY;
            html += `<div class="phrase-cat" style="display: flex; flex-direction: column; gap: 10px;">
                        <h3 style="color: var(--amber); font-family: var(--ff-head);">${cat}</h3>
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; flex: 1;">`;
            for (const p of phrases) {
                html += `<button class="key-btn gazeable phrase-btn" data-text="${p}" data-urgent="${urgent}">${p}</button>`;
            }
            html += `</div></div>`;
        }
        html += '</div>';
        c.innerHTML = html;
        this._bindEvents(c);
    },

    _bindEvents(container) {
        container.querySelectorAll('.phrase-btn').forEach(btn => {
            btn.addEventListener('click', () => this.say(btn.dataset.text, btn.dataset.urgent === 'true'));
        });
    },

    /** Speak a phrase, record it in the caregiver timeline, and alert for urgent ones. */
    say(text, urgent) {
        LumiVoice.speak(text);
        LumiStore.addTypedLog(text);
        window.dispatchEvent(new CustomEvent('eye_text_spoken', { detail: { text } }));
        if (urgent) {
            window.dispatchEvent(new CustomEvent('eye_emergency_alert', {
                detail: { type: 'URGENT_PHRASE', details: `Patient selected: "${text}"` }
            }));
        }
    }
};
window.LumiPhrases = LumiPhrases;

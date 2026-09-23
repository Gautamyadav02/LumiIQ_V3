const LumiPhrases = {
    categories: {
        "Urgent": ["I need help", "Call nurse", "I can't breathe", "I'm in pain"],
        "Comfort": ["I'm thirsty", "I'm cold", "Turn me over", "Adjust pillow"],
        "Medical": ["I need medicine", "I feel dizzy", "My chest hurts", "Suction tube"],
        "Social": ["Call my family", "Thank you", "Yes", "No"]
    },
    render(containerId) {
        const c = document.getElementById(containerId);
        if (!c) return;
        let html = '<div class="phrases-layout" style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; height: 100%;">';
        for (const [cat, phrases] of Object.entries(this.categories)) {
            html += `<div class="phrase-cat" style="display: flex; flex-direction: column; gap: 10px;">
                        <h3 style="color: var(--amber); font-family: var(--ff-head);">${cat}</h3>
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; flex: 1;">`;
            for (const p of phrases) {
                html += `<button class="key-btn gazeable phrase-btn" data-text="${p}">${p}</button>`;
            }
            html += `</div></div>`;
        }
        html += '</div>';
        c.innerHTML = html;
        this._bindEvents(c);
    },
    _bindEvents(container) {
        container.querySelectorAll('.phrase-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                LumiVoice.speak(btn.dataset.text);
            });
        });
    }
};
window.LumiPhrases = LumiPhrases;

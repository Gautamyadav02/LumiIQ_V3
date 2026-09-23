/**
 * LumiIQ - Anatomical Body Map
 * Clean, large-target SVG zones with labeled body parts.
 * Gaze on a zone → symptom panel slides in → gaze-dwell on symptom → bilingual TTS + log.
 */

const LumiBodyMap = {
    selectedPart: null,

    // Front view (SVG units, viewBox 400×450). Zones must not overlap: where two
    // shapes overlap, the one drawn later wins the hit-test — that used to make the
    // centres of Chest and Stomach select "Back" (AUDIT H5). The back cannot be
    // shown on a front view, so "Back" is a separate button (no cx/cy).
    PARTS: [
        { id: 'head',       label: 'Head',        hindi: 'सिर',      cx: 200, cy: 24,  rx: 42, ry: 17 },
        { id: 'eyes',       label: 'Eyes',        hindi: 'आँखें',    cx: 200, cy: 55,  rx: 42, ry: 12 },
        { id: 'throat',     label: 'Throat',      hindi: 'गला',      cx: 200, cy: 96,  rx: 24, ry: 18 },
        { id: 'chest',      label: 'Chest',       hindi: 'छाती',     cx: 200, cy: 158, rx: 58, ry: 38 },
        { id: 'stomach',    label: 'Stomach',     hindi: 'पेट',      cx: 200, cy: 238, rx: 54, ry: 36 },
        { id: 'left_arm',   label: 'Left Arm',    hindi: 'बायाँ हाथ', cx: 114, cy: 182, rx: 24, ry: 70 },
        { id: 'right_arm',  label: 'Right Arm',   hindi: 'दायाँ हाथ',cx: 286, cy: 182, rx: 24, ry: 70 },
        { id: 'left_leg',   label: 'Left Leg',    hindi: 'बायाँ पैर', cx: 164, cy: 360, rx: 30, ry: 78 },
        { id: 'right_leg',  label: 'Right Leg',   hindi: 'दायाँ पैर', cx: 236, cy: 360, rx: 30, ry: 78 },
        { id: 'back',       label: 'Back',        hindi: 'पीठ' }
    ],

    SYMPTOMS: [
        { id: 'pain',    label: '🔴 Pain',        hindi: 'दर्द'    },
        { id: 'itch',    label: '🟡 Itching',     hindi: 'खुजली'  },
        { id: 'numb',    label: '🔵 Numbness',    hindi: 'सुन्न'   },
        { id: 'spasm',   label: '🟢 Spasm',       hindi: 'ऐंठन'   },
        { id: 'cold',    label: '❄️ Cold',         hindi: 'ठंड'    },
        { id: 'hot',     label: '🔥 Hot',          hindi: 'गर्मी'  }
    ],

    TTS: {
        head:       { pain:'Head pain. सिर में दर्द है।',       itch:'Head itch. सिर में खुजली है।',      numb:'Head numb. सिर सुन्न है।',        spasm:'Head spasm. सिर में ऐंठन।',            cold:'Head feels cold. सिर ठंडा लग रहा है।',    hot:'Head feels hot. सिर गर्म है।'        },
        eyes:       { pain:'Eye pain. आँखों में दर्द।',          itch:'Eyes itching. आँखें खुजली।',       numb:'Vision blurry. धुंधला दिखाई दे रहा।', spasm:'Eye twitch. आँख फड़क रही।',           cold:'Eyes dry. आँखें सूखी लग रहीं।',          hot:'Eyes burning. आँखें जल रहीं।'        },
        throat:     { pain:'Throat pain. गले में दर्द।',         itch:'Throat itch. गले में खुजली।',      numb:'Throat numb. गला सुन्न।',            spasm:'Throat spasm. गले में ऐंठन।',          cold:'Throat cold. गला ठंडा।',                hot:'Throat burning. गले में जलन।'        },
        chest:      { pain:'Chest pain. छाती में दर्द।',         itch:'Chest itch. छाती में खुजली।',      numb:'Chest tight. छाती भारी।',            spasm:'Chest spasm. छाती में ऐंठन।',          cold:'Chest cold. छाती ठंडी।',                hot:'Chest burning. छाती जल रही।'         },
        stomach:    { pain:'Stomach pain. पेट में दर्द।',        itch:'Stomach itch. पेट में खुजली।',     numb:'Stomach bloated. पेट फूला।',         spasm:'Stomach cramp. पेट में मरोड़।',        cold:'Stomach cold. पेट ठंडा।',               hot:'Acid reflux. पेट में जलन।'           },
        left_arm:   { pain:'Left arm pain. बाएं हाथ में दर्द।', itch:'Left arm itch. बाएं हाथ खुजली।',  numb:'Left arm numb. बायाँ हाथ सुन्न।',    spasm:'Left arm spasm. बाएं हाथ ऐंठन।',     cold:'Left arm cold. बायाँ हाथ ठंडा।',        hot:'Left arm hot. बायाँ हाथ गर्म।'       },
        right_arm:  { pain:'Right arm pain. दाएं हाथ दर्द।',   itch:'Right arm itch. दाएं हाथ खुजली।', numb:'Right arm numb. दायाँ हाथ सुन्न।',   spasm:'Right arm spasm. दाएं हाथ ऐंठन।',    cold:'Right arm cold. दायाँ हाथ ठंडा।',       hot:'Right arm hot. दायाँ हाथ गर्म।'      },
        left_leg:   { pain:'Left leg pain. बाएं पैर दर्द।',    itch:'Left leg itch. बाएं पैर खुजली।',  numb:'Left leg numb. बायाँ पैर सुन्न।',    spasm:'Left leg spasm. बाएं पैर ऐंठन।',     cold:'Left leg cold. बायाँ पैर ठंडा।',        hot:'Left leg hot. बायाँ पैर गर्म।'       },
        right_leg:  { pain:'Right leg pain. दाएं पैर दर्द।',   itch:'Right leg itch. दाएं पैर खुजली।', numb:'Right leg numb. दायाँ पैर सुन्न।',   spasm:'Right leg spasm. दाएं पैर ऐंठन।',    cold:'Right leg cold. दायाँ पैर ठंडा।',       hot:'Right leg hot. दायाँ पैर गर्म।'      },
        back:       { pain:'Back pain. पीठ में दर्द।',           itch:'Back itch. पीठ में खुजली।',        numb:'Back numb. पीठ सुन्न।',              spasm:'Back spasm. पीठ में अकड़न।',          cold:'Back cold. पीठ ठंडी।',                   hot:'Back hot. पीठ गर्म।'                }
    },

    render(containerId) {
        const el = document.getElementById(containerId);
        if (!el) return;
        const zones = this.PARTS.filter(p => p.cx !== undefined);
        const dwellSecs = ((LumiStore.getSettings().dwellTimeMs || 1200) / 1000).toFixed(1);
        el.innerHTML = `
        <div class="bodymap-layout">

            <!-- LEFT: SVG body diagram -->
            <div class="bodymap-svg-panel">
                <h3 class="panel-heading">Where does it hurt?</h3>
                <div class="svg-scroll-wrapper">
                    <svg viewBox="0 0 400 450" class="body-svg" id="bodySvg">
                        <!-- Body silhouette background fill -->
                        <ellipse cx="200" cy="50"  rx="50" ry="45"  fill="#1e2130" stroke="none"/>
                        <rect    x="135" y="93"   width="130" height="185" rx="18" fill="#1e2130" stroke="none"/>
                        <rect    x="88"  y="110"  width="56"  height="145" rx="18" fill="#1e2130" stroke="none"/>
                        <rect    x="256" y="110"  width="56"  height="145" rx="18" fill="#1e2130" stroke="none"/>
                        <rect    x="130" y="270"  width="68"  height="170" rx="18" fill="#1e2130" stroke="none"/>
                        <rect    x="202" y="270"  width="68"  height="170" rx="18" fill="#1e2130" stroke="none"/>

                        <!-- Gaze zones (ellipses, non-overlapping); labels sit inside each zone -->
                        ${zones.map(p => `
                        <g class="body-zone-group">
                            <ellipse
                                cx="${p.cx}" cy="${p.cy}" rx="${p.rx}" ry="${p.ry}"
                                class="body-zone gazeable"
                                data-part="${p.id}"
                                id="zone_${p.id}"
                            />
                            <text x="${p.cx}" y="${p.cy}"
                                class="zone-label" text-anchor="middle" dominant-baseline="middle"
                                font-size="11" fill="rgba(255,179,0,0.85)"
                                pointer-events="none">${p.label}</text>
                        </g>
                        `).join('')}
                    </svg>
                </div>
                <button class="body-zone-btn gazeable" data-part="back" id="zone_back">
                    Back — पीठ
                    <span class="dwell-progress-ring"></span>
                </button>
                <p class="hint-text">👁 Look at a body part for ${dwellSecs} seconds to select it</p>
            </div>

            <!-- RIGHT: Symptom panel -->
            <div class="bodymap-symptom-panel" id="symptomPanel">
                <div class="symptom-idle" id="symptomIdle">
                    <div class="idle-icon">👁</div>
                    <p>Look at the body diagram on the left.<br>Select a body part to report symptoms.</p>
                </div>

                <div class="symptom-active hidden" id="symptomActive">
                    <div class="active-part-title" id="activePart">Head (सिर)</div>
                    <div class="symptom-grid" id="symptomGrid">
                        ${this.SYMPTOMS.map(s => `
                        <button class="symptom-card gazeable" data-symptom="${s.id}" id="sym_${s.id}">
                            <span class="sym-label">${s.label}</span>
                            <span class="sym-hindi">${s.hindi}</span>
                            <span class="dwell-progress-ring"></span>
                        </button>
                        `).join('')}
                    </div>
                    <button class="cancel-btn gazeable" id="symCancelBtn">
                        ✕ Cancel / Go Back
                        <span class="dwell-progress-ring"></span>
                    </button>
                </div>
            </div>

        </div>`;

        this._bindEvents();
    },

    _bindEvents() {
        document.querySelectorAll('.body-zone').forEach(z => {
            z.addEventListener('click', e => this.selectPart(e.currentTarget.dataset.part));
        });
        const back = document.getElementById('zone_back');
        if (back) back.addEventListener('click', () => this.selectPart('back'));
        document.querySelectorAll('.symptom-card').forEach(b => {
            b.addEventListener('click', e => this.reportSymptom(e.currentTarget.dataset.symptom));
        });
        const cancel = document.getElementById('symCancelBtn');
        if (cancel) cancel.addEventListener('click', () => this._resetPanel());
    },

    selectPart(partId) {
        const part = this.PARTS.find(p => p.id === partId);
        if (!part) return;
        this.selectedPart = partId;

        // Highlight selected zone
        document.querySelectorAll('.body-zone').forEach(z => z.classList.remove('zone-active'));
        document.getElementById('zone_back')?.classList.remove('zone-active');
        const zone = document.getElementById(`zone_${partId}`);
        if (zone) zone.classList.add('zone-active');

        // Show symptom panel
        document.getElementById('symptomIdle').classList.add('hidden');
        document.getElementById('symptomActive').classList.remove('hidden');
        document.getElementById('activePart').textContent = `${part.label} (${part.hindi})`;

        this._speak(`${part.label} selected. Choose symptom.`);
    },

    reportSymptom(symptomId) {
        if (!this.selectedPart) return;
        const part    = this.PARTS.find(p => p.id === this.selectedPart);
        const sym     = this.SYMPTOMS.find(s => s.id === symptomId);
        const ttsText = (this.TTS[this.selectedPart] || {})[symptomId] || `${part.label}: ${sym.label}`;

        LumiStore.addSymptomLog(part.label, symptomId);
        this._speak(ttsText);

        // Show toast
        this._toast(part.label, sym.label);

        // Dispatch event for dashboard
        window.dispatchEvent(new CustomEvent('eye_symptom_reported', {
            detail: { bodyPart: part.label, symptom: symptomId, speechText: ttsText }
        }));

        this._resetPanel();
    },

    _resetPanel() {
        this.selectedPart = null;
        document.querySelectorAll('.body-zone').forEach(z => z.classList.remove('zone-active'));
        document.getElementById('zone_back')?.classList.remove('zone-active');
        const idle   = document.getElementById('symptomIdle');
        const active = document.getElementById('symptomActive');
        if (idle)   idle.classList.remove('hidden');
        if (active) active.classList.add('hidden');
    },

    _toast(part, sym) {
        const t = document.createElement('div');
        t.className = 'symptom-toast';
        t.innerHTML = `<b>✓ Reported</b> — ${part}: ${sym}`;
        document.body.appendChild(t);
        requestAnimationFrame(() => t.classList.add('toast-show'));
        setTimeout(() => { t.classList.remove('toast-show'); setTimeout(() => t.remove(), 400); }, 3000);
    },

    _speak(text) {
        // Loud & clear, with automatic Hindi/English detection.
        LumiVoice.speak(text);
    }
};

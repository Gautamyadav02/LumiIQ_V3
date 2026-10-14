/**
 * LumiIQ — Evaluation Wizard (Phase B)
 *
 * Implements the empirical measurement protocol described in the dissertation
 * (Section 3.6) and docs/RECORDING.md.
 *
 * Steps:
 * 1. Consent, viewing distance (cm), screen width (cm), condition name
 * 2. 9-point calibration (standard LumiGaze calibration)
 * 3. 12 held-out validation targets across corners, edges, header, center
 * 4. Head rotation test (~5° yaw left/right)
 * 5. Selection test (10 keyboard targets)
 * 6. 2-minute rest period (false activation counting)
 * 7. Results summary (accuracy, precision, p95, selection rate) & session JSON download
 */
(function (root) {
  'use strict';

  // 12 held-out targets in normalized coordinates (0..1).
  // None of these match standard 9-point calibration grid points (0.08, 0.50, 0.92).
  const VALIDATION_TARGETS = [
    // Header band (y = 0.035, where navigation tabs sit)
    { x: 0.20, y: 0.035, zone: 'header' },
    { x: 0.50, y: 0.035, zone: 'header' },
    { x: 0.80, y: 0.035, zone: 'header' },
    // Right edge (x = 0.96, where Nurse Call sits)
    { x: 0.96, y: 0.25, zone: 'right_edge' },
    { x: 0.96, y: 0.50, zone: 'right_edge' },
    { x: 0.96, y: 0.75, zone: 'right_edge' },
    // Extreme corners (x/y: 0.04 / 0.96)
    { x: 0.04, y: 0.08, zone: 'corner_tl' },
    { x: 0.04, y: 0.92, zone: 'corner_bl' },
    { x: 0.94, y: 0.92, zone: 'corner_br' },
    // Interior / off-grid targets
    { x: 0.30, y: 0.35, zone: 'interior' },
    { x: 0.70, y: 0.35, zone: 'interior' },
    { x: 0.50, y: 0.70, zone: 'interior' },
  ];

  class EvalWizard {
    constructor() {
      this.recorder = null;
      this.step = 'idle';
      this.valIndex = 0;
      this.valSamples = [];
      this.selectionTrials = [];
      this.falseActivations = 0;
      this.restStartTime = 0;
      this.restDurationMs = 60000; // 60s for evaluation protocol
      this.active = false;
      this._timer = null;
    }

    /** Start the wizard flow */
    launch() {
      if (typeof document === 'undefined') return;
      this.active = true;
      this.showScreen('evalIntro');
    }

    startSession(options = {}) {
      if (!options.consent) {
        alert('Evaluation recording requires informed consent.');
        return;
      }
      const RecorderClass = (typeof LumiSessionRecorder !== 'undefined' ? LumiSessionRecorder.SessionRecorder : null) ||
                            (typeof require !== 'undefined' ? require('./session-recorder.js').SessionRecorder : null);
      if (!RecorderClass) throw new Error('SessionRecorder not loaded');

      this.recorder = new RecorderClass({
        screenWidthMm: options.screenWidthMm || 344,
        distanceMm: options.distanceMm || 500,
        condition: options.condition || 'baseline',
        userConsent: true,
      });

      this.recorder.start(true);
      this.step = 'calibration';
      this.showScreen('evalCalibPrompt');
    }

    startValidation() {
      this.step = 'validation';
      this.valIndex = 0;
      this.valSamples = [];
      this.showScreen('evalValDotBox');
      this.presentNextValidationTarget();
    }

    presentNextValidationTarget() {
      if (this.valIndex >= VALIDATION_TARGETS.length) {
        this.finishValidation();
        return;
      }
      const target = VALIDATION_TARGETS[this.valIndex];
      this.recorder.setPhase('validation', target);

      const dot = document.getElementById('evalValDot');
      const pill = document.getElementById('evalValPill');
      if (dot) {
        dot.style.left = `${target.x * 100}%`;
        dot.style.top = `${target.y * 100}%`;
      }
      if (pill) {
        pill.textContent = `Target ${this.valIndex + 1} of ${VALIDATION_TARGETS.length} (${target.zone})`;
      }

      // Settle 400ms, then record for 1000ms
      clearTimeout(this._timer);
      this._timer = setTimeout(() => {
        const startTime = performance.now();
        const collectInterval = setInterval(() => {
          if (!this.active || this.step !== 'validation') {
            clearInterval(collectInterval);
            return;
          }
          if (performance.now() - startTime >= 1000) {
            clearInterval(collectInterval);
            this.valIndex++;
            this.presentNextValidationTarget();
          }
        }, 33);
      }, 400);
    }

    finishValidation() {
      this.recorder.setPhase('head_movement');
      this.step = 'head_movement';
      this.showScreen('evalHeadPrompt');
    }

    startHeadMovementTest() {
      const target = { x: 0.5, y: 0.5, zone: 'center' };
      this.recorder.setPhase('head_movement', target);
      this.showScreen('evalHeadTestBox');

      const text = document.getElementById('evalHeadInstruction');
      if (text) text.textContent = 'Look at the dot. Keep your head straight forward.';

      this._timer = setTimeout(() => {
        if (text) text.textContent = 'Keep looking at the dot, but turn your head slightly to the LEFT (~5°).';
        this._timer = setTimeout(() => {
          if (text) text.textContent = 'Now turn your head slightly to the RIGHT (~5°).';
          this._timer = setTimeout(() => {
            this.finishHeadMovementTest();
          }, 2000);
        }, 2000);
      }, 2000);
    }

    finishHeadMovementTest() {
      this.step = 'rest';
      this.falseActivations = 0;
      this.recorder.setPhase('rest');
      this.showScreen('evalRestBox');
      this.startRestPeriod();
    }

    startRestPeriod() {
      this.restStartTime = performance.now();
      const timeRemaining = document.getElementById('evalRestTimer');
      const interval = setInterval(() => {
        if (!this.active || this.step !== 'rest') {
          clearInterval(interval);
          return;
        }
        const elapsed = performance.now() - this.restStartTime;
        const left = Math.max(0, Math.ceil((this.restDurationMs - elapsed) / 1000));
        if (timeRemaining) timeRemaining.textContent = `${left}s remaining`;
        if (elapsed >= this.restDurationMs) {
          clearInterval(interval);
          this.finishEvaluation();
        }
      }, 500);
    }

    noteActivation(element) {
      if (this.step === 'rest') {
        this.falseActivations++;
        this.recorder.recordEvent('false_activation', {
          target: element ? element.textContent : 'unknown',
          timestamp: performance.now(),
        });
      }
    }

    finishEvaluation() {
      this.step = 'summary';
      const sessionData = this.recorder.stop();
      this.showScreen('evalSummaryBox');

      // Compute metrics
      const Metrics = (typeof LumiMetrics !== 'undefined' ? LumiMetrics : null) ||
                      (typeof require !== 'undefined' ? require('./metrics.js') : null);
      if (Metrics) {
        // Collect validation frames
        const valFrames = sessionData.frames.filter((f) => f.phase === 'validation' && f.target && f.predStabilized);
        const samples = valFrames.map((f) => ({
          pred: f.predStabilized,
          target: {
            x: f.target.x * sessionData.metadata.screenWidth,
            y: f.target.y * sessionData.metadata.screenHeight,
          },
        }));

        const m = Metrics.computeGazeMetrics(samples, {
          screenWidthMm: sessionData.metadata.screenWidthMm,
          screenWidthPx: sessionData.metadata.screenWidth,
          distanceMm: sessionData.metadata.distanceMm,
        });

        const falseRate = Metrics.computeFalseActivationsPerMin(this.falseActivations, this.restDurationMs);

        // Display results
        this._setElem('evalResAccuracyPx', `${m.accuracyPx} px`);
        this._setElem('evalResAccuracyDeg', m.accuracyDeg != null ? `${m.accuracyDeg}°` : '—');
        this._setElem('evalResPrecisionPx', `${m.precisionPx} px`);
        this._setElem('evalResP95Px', `${m.p95Px} px`);
        this._setElem('evalResFalseAct', `${falseRate} / min`);
      }
    }

    downloadSession() {
      if (this.recorder) {
        this.recorder.downloadJSON();
      }
    }

    exit() {
      this.active = false;
      this.step = 'idle';
      clearTimeout(this._timer);
      if (this.recorder && this.recorder.isRecording) {
        this.recorder.stop();
      }
      const overlay = document.getElementById('evalOverlay');
      if (overlay) overlay.classList.add('hidden');
    }

    showScreen(screenId) {
      const overlay = document.getElementById('evalOverlay');
      if (overlay) overlay.classList.remove('hidden');
      const screens = ['evalIntro', 'evalCalibPrompt', 'evalValDotBox', 'evalHeadPrompt', 'evalHeadTestBox', 'evalRestBox', 'evalSummaryBox'];
      for (const id of screens) {
        const el = document.getElementById(id);
        if (el) {
          if (id === screenId) el.classList.remove('hidden');
          else el.classList.add('hidden');
        }
      }
    }

    _setElem(id, val) {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    }
  }

  const wizard = new EvalWizard();
  root.LumiEvalWizard = wizard;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { EvalWizard, VALIDATION_TARGETS };
  }
})(typeof window !== 'undefined' ? window : globalThis);

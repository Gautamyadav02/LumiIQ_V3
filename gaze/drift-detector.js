/**
 * LumiIQ — drift detector
 *
 * After each dwell selection the app reports where the gaze estimate was,
 * relative to the selected target. If the calibration drifts, the estimate
 * stops being centred on what the person selects.
 *
 * Two rules:
 *   'legacy' (Phase B): the average distance from the centre over the last
 *     20 selections, as a share of the target size, exceeds 0.6. Audit M10:
 *     this almost never fires, because a selection only happens when the
 *     estimate is already inside the target.
 *   'bias' (Phase C, C7): drift shows as a consistent DIRECTION. Six selections
 *     in a row that land on the same side of the centre (by more than a tenth
 *     of the target size), or a median distance of more than 0.35 of the target
 *     size over the last six, ask for recalibration. After a warning the
 *     detector starts over, so it warns once per drift.
 */
(function (root) {
  'use strict';

  const median = (v) => { const s = v.slice().sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

  class DriftDetector {
    /** @param {{mode?: 'legacy'|'bias'}} [opts] */
    constructor(opts = {}) {
      this.mode = opts.mode === 'bias' ? 'bias' : 'legacy';
      this.recentDwells = [];  // legacy: last 20 normalised distances
      this.recent = [];        // bias: last 10 normalised offsets {dx, dy}
      this.run = 6;            // bias: selections in a row on one side
      this.deadzone = 0.1;     // bias: "on one side" means further than this from the centre line
      this.medianLimit = 0.35; // bias: median distance from the centre that counts as drift
      this.last = null;        // bias: the most recent judgement, for the caller to show
    }

    /**
     * @param {{x:number,y:number}} gazePoint  the gaze estimate when the selection fired (px)
     * @param {{x:number,y:number}} elementCenter
     * @param {{width:number,height:number}} elementSize
     * @returns {boolean} true: suggest recalibrating
     */
    onDwellActivate(gazePoint, elementCenter, elementSize) {
      return this.mode === 'bias'
        ? this._bias(gazePoint, elementCenter, elementSize)
        : this._legacy(gazePoint, elementCenter, elementSize);
    }

    _legacy(gazePoint, elementCenter, elementSize) {
      const error = Math.hypot(gazePoint.x - elementCenter.x, gazePoint.y - elementCenter.y);
      const normalizedError = error / Math.max(elementSize.width, Math.max(elementSize.height, 1));

      this.recentDwells.push(normalizedError);
      if (this.recentDwells.length > 20) this.recentDwells.shift();

      const avgError = this.recentDwells.reduce((a, b) => a + b, 0) / this.recentDwells.length;
      if (avgError > 0.6 && this.recentDwells.length >= 10) {
        return true; // Drift detected, needs recalibration
      }
      return false;
    }

    _bias(gazePoint, elementCenter, elementSize) {
      const offset = {
        dx: (gazePoint.x - elementCenter.x) / Math.max(1, elementSize.width),
        dy: (gazePoint.y - elementCenter.y) / Math.max(1, elementSize.height),
      };
      this.recent.push(offset);
      if (this.recent.length > 10) this.recent.shift();
      const last = this.recent.slice(-this.run);
      const full = last.length === this.run;
      const oneSide = (k) => full && (last.every((o) => o[k] > this.deadzone) || last.every((o) => o[k] < -this.deadzone));
      let reason = null;
      if (oneSide('dx')) reason = 'consistent-x';
      else if (oneSide('dy')) reason = 'consistent-y';
      else if (full && median(last.map((o) => Math.hypot(o.dx, o.dy))) > this.medianLimit) reason = 'far-from-centre';
      const mean = (k) => last.reduce((a, o) => a + o[k], 0) / last.length;
      this.last = { drift: reason !== null, reason, biasX: mean('dx'), biasY: mean('dy'), dwells: last.length };
      if (reason) this.recent = [];   // warn once, then start over
      return reason !== null;
    }

    reset() {
      this.recentDwells = [];
      this.recent = [];
      this.last = null;
    }
  }

  root.DriftDetector = DriftDetector;
  if (typeof module !== 'undefined' && module.exports) module.exports = { DriftDetector };
})(typeof window !== 'undefined' ? window : globalThis);

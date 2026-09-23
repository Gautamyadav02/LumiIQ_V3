(function (root) {
  'use strict';
  class DriftDetector {
    constructor() {
      this.recentDwells = [];  // Last 20 successful dwells
    }
    
    onDwellActivate(gazePoint, elementCenter, elementSize) {
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
  }
  root.DriftDetector = DriftDetector;
  if (typeof module !== 'undefined' && module.exports) module.exports = { DriftDetector };
})(typeof window !== 'undefined' ? window : globalThis);

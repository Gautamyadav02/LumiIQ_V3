/**
 * LumiIQ — Evaluation Session Recorder (Phase B)
 *
 * Records evaluation sessions for offline replay, validation, and benchmarking.
 * PRIVACY & SAFETY:
 * - NO video frames, NO facial images, NO audio.
 * - Stores ONLY numerical features (10-dim vector, EAR, head pose, confidence, timestamps, targets).
 * - Records exclusively during consented evaluation wizard runs.
 */
(function (root) {
  'use strict';

  class SessionRecorder {
    constructor(metadata = {}) {
      this.metadata = {
        sessionId: 'session_' + Date.now(),
        startedAt: new Date().toISOString(),
        screenWidth: typeof window !== 'undefined' ? window.innerWidth : 1920,
        screenHeight: typeof window !== 'undefined' ? window.innerHeight : 1080,
        screenWidthMm: metadata.screenWidthMm || 344, // Default 15.6" laptop
        distanceMm: metadata.distanceMm || 500,       // 50cm default viewing distance
        condition: metadata.condition || 'default',   // e.g. 'baseline', 'lighting_low', 'head_pose_comp'
        userConsent: metadata.userConsent || false,
        settings: metadata.settings || null,
        calibrationReport: metadata.calibrationReport || null,
      };
      this.frames = [];
      this.events = [];
      this.isRecording = false;
      this.currentTarget = null;
      this.phase = 'idle'; // 'calibration', 'validation', 'selection', 'rest', 'head_pose'
    }

    start(consent = true) {
      if (!consent) {
        throw new Error('Recording requires explicit user consent.');
      }
      this.metadata.userConsent = true;
      this.metadata.startedAt = new Date().toISOString();
      this.frames = [];
      this.events = [];
      this.isRecording = true;
      this.recordEvent('session_start', { timestamp: performance.now() });
    }

    setPhase(phase, target = null) {
      this.phase = phase;
      this.currentTarget = target;
      this.recordEvent('phase_change', { phase, target, timestamp: performance.now() });
    }

    setTarget(target) {
      this.currentTarget = target;
      if (target) {
        this.recordEvent('target_onset', { target, timestamp: performance.now() });
      }
    }

    recordFrame(frameData) {
      if (!this.isRecording) return;
      // frameData contains:
      // features: [10 numbers], confidence, earL, earR, pose: [yaw, pitch, roll],
      // predRaw: { x, y } (normalized), predStabilized: { x, y } (px), t: performance.now()
      this.frames.push({
        t: frameData.t || performance.now(),
        phase: this.phase,
        target: this.currentTarget ? { ...this.currentTarget } : null,
        features: frameData.features ? Array.from(frameData.features) : null,
        confidence: frameData.confidence || 0,
        earL: frameData.earL || 0,
        earR: frameData.earR || 0,
        pose: frameData.pose ? { ...frameData.pose } : null,
        predRaw: frameData.predRaw ? { ...frameData.predRaw } : null,
        predStabilized: frameData.predStabilized ? { ...frameData.predStabilized } : null,
      });
    }

    recordEvent(name, data = {}) {
      if (!this.isRecording && name !== 'session_start') return;
      this.events.push({
        name,
        data,
        t: performance.now(),
        iso: new Date().toISOString(),
      });
    }

    stop() {
      if (!this.isRecording) return;
      this.recordEvent('session_end', { totalFrames: this.frames.length });
      this.isRecording = false;
      this.metadata.endedAt = new Date().toISOString();
      this.metadata.totalFrames = this.frames.length;
      this.metadata.totalEvents = this.events.length;
      return this.toJSON();
    }

    toJSON() {
      return {
        version: 1,
        type: 'lumiiq_eval_session',
        metadata: this.metadata,
        events: this.events,
        frames: this.frames,
      };
    }

    downloadJSON(filename = null) {
      if (typeof window === 'undefined' || typeof document === 'undefined') return;
      const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(this.toJSON(), null, 2));
      const a = document.createElement('a');
      a.setAttribute('href', dataStr);
      a.setAttribute('download', filename || `${this.metadata.sessionId}_eval.json`);
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  }

  const api = { SessionRecorder };
  root.LumiSessionRecorder = SessionRecorder;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);

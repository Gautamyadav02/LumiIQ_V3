/**
 * LumiIQ — caregiver diagnostics (Phase A)
 * ------------------------------------------------------------------
 * Tools for telling a DETECTION problem (MediaPipe's eye landmarks are wrong
 * or unstable) from a MAPPING problem (the landmarks are fine but the screen
 * prediction is wrong):
 *
 *   • feedMapping   — camera coordinates → pixels on the displayed feed
 *                     (object-fit: cover crop + mirror), in one place
 *   • drawOverlay   — iris centres, EAR points and EAR per eye, on the video
 *   • describeFrame — the same frame in words (EAR, threshold, confidence,
 *                     head pose, whether it produced a gaze point and why not)
 *   • drawDirection — small inset showing the raw (uncalibrated) eye direction
 *   • FrameStats    — % frames with a face / with a gaze point, reasons,
 *                     confidence and EAR distributions
 *   • EarCheck      — a guided 8 s check: eyes open looking up, open looking
 *                     down, closed; says how the EAR threshold classifies them
 *
 * Input is the engine's per-frame record (LumiGaze.onFrameInfo). Everything
 * stays in memory and on this screen: nothing is stored or sent.
 */
(function (root) {
  'use strict';

  // ── Mapping ────────────────────────────────────────────────────────

  /**
   * Map a point of the camera frame (normalised 0..1, as MediaPipe reports it)
   * to pixels in the box that displays the video with CSS `object-fit: cover`
   * (scaled to fill the box, overflow cropped equally on both sides).
   * `mirrored`: the video is shown flipped horizontally (CSS scaleX(-1)).
   */
  function feedMapping(videoW, videoH, boxW, boxH, mirrored) {
    const scale = Math.max(boxW / videoW, boxH / videoH);
    const w = videoW * scale, h = videoH * scale;
    const offX = (boxW - w) / 2, offY = (boxH - h) / 2;
    return (nx, ny) => {
      const x = offX + nx * w;
      return { x: mirrored ? boxW - x : x, y: offY + ny * h };
    };
  }

  // ── Drawing ────────────────────────────────────────────────────────

  const COLOURS = { iris: '#22d3ee', used: '#FFB300', unused: '#9ca3af', open: '#4ade80', closed: '#f87171',
                    text: '#ffffff', panel: 'rgba(0,0,0,0.6)' };

  const REASON_TEXT = {
    ok: 'yes',
    uncalibrated: 'cursor only (not calibrated: clicks off)',
    calibrating: 'no (calibrating: samples collected)',
    eyes_closed: 'no (no usable eye: closed, or not the selected eye)',
    low_confidence: 'no (confidence below 0.2)',
    no_face: 'no (no face)',
  };

  function dot(ctx, p, r, colour) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, 2 * Math.PI);
    ctx.fillStyle = colour;
    ctx.fill();
  }

  const f2 = (v) => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(2));
  const deg = (v) => `${Math.round(v)}°`;

  /**
   * The detection overlay for one frame: landmark points and a short EAR label
   * per eye, nothing else, so the video (and the eyes) stay visible even on a
   * small feed. The words go under the video (describeFrame). `map` comes from
   * feedMapping. Eyes are labelled R/L by the patient's side.
   */
  function drawOverlay(ctx, info, map, box) {
    if (!info || !info.face) return;
    for (const e of info.eyes) {
      const colour = e.used ? COLOURS.used : COLOURS.unused;
      for (const p of [...e.corners, ...e.lids]) dot(ctx, map(p.x, p.y), 2.5, colour);
      const c = map(e.iris.x, e.iris.y);
      ctx.beginPath();
      ctx.arc(c.x, c.y, 4, 0, 2 * Math.PI);
      ctx.strokeStyle = COLOURS.iris;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(c.x - 7, c.y); ctx.lineTo(c.x + 7, c.y);
      ctx.moveTo(c.x, c.y - 7); ctx.lineTo(c.x, c.y + 7);
      ctx.stroke();
      // EAR label under the eye, coloured by how the threshold classifies it.
      const lower = map(e.lids[1].x, e.lids[1].y);
      ctx.font = '11px monospace';
      ctx.fillStyle = e.open ? COLOURS.open : COLOURS.closed;
      ctx.fillText(`${e.side === 'right' ? 'R' : 'L'} ${f2(e.ear)}`, lower.x - 18, lower.y + 16);
    }
  }

  /** The frame in words, for the readout under the video. */
  function describeFrame(info) {
    if (!info) return [];
    if (!info.face) return ['No face detected', `gaze point: ${REASON_TEXT.no_face}`];
    const [r, l] = [info.eyes.find((e) => e.side === 'right'), info.eyes.find((e) => e.side === 'left')];
    const state = (e) => (e ? `${f2(e.ear)} ${e.open ? 'open' : 'closed'}${e.used ? '' : ' (not used)'}` : '—');
    const pose = info.pose || { yaw: 0, pitch: 0, roll: 0 };
    return [
      `EAR R ${state(r)}   EAR L ${state(l)}`,
      `threshold ${f2(info.earThreshold)}   confidence ${f2(info.confidence)}`,
      `yaw ${deg(pose.yaw)}  pitch ${deg(pose.pitch)}  roll ${deg(pose.roll)}`,
      `gaze point: ${REASON_TEXT[info.reason] || info.reason}`,
    ];
  }

  /**
   * Inset in the bottom-left corner showing the raw eye direction, i.e. where
   * the uncalibrated mapping points (`dir` in screen fractions 0..1). It is a
   * direction, not a position in the video.
   */
  function drawDirection(ctx, dir, box) {
    const w = 72, h = 48, x0 = 8, y0 = box.height - h - 8;
    ctx.fillStyle = COLOURS.panel;
    ctx.fillRect(x0, y0, w, h);
    ctx.strokeStyle = 'rgba(255,179,0,0.4)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x0, y0, w, h);
    ctx.fillStyle = COLOURS.text;
    ctx.font = '9px monospace';
    ctx.fillText('eye direction', x0 + 4, y0 - 3);
    if (!dir) return;
    const clamp = (v) => Math.max(0, Math.min(1, v));
    dot(ctx, { x: x0 + clamp(dir.x) * w, y: y0 + clamp(dir.y) * h }, 4, COLOURS.used);
  }

  // ── Distributions ──────────────────────────────────────────────────

  /** Nearest-rank percentile of a numeric array (p in 0..1); null if empty. */
  function percentile(values, p) {
    if (!values.length) return null;
    const s = values.slice().sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))];
  }

  /** Fixed-width histogram: bounded memory for long collections. */
  class Histogram {
    constructor(width, max) { this.width = width; this.bins = new Array(Math.ceil(max / width) + 1).fill(0); this.n = 0; }
    add(v) {
      if (!Number.isFinite(v)) return;
      const i = Math.min(this.bins.length - 1, Math.max(0, Math.floor(v / this.width)));
      this.bins[i]++; this.n++;
    }
    /** Percentile as the centre of the bin holding it (±width/2). */
    percentile(p) {
      if (!this.n) return null;
      const rank = Math.max(1, Math.ceil(p * this.n));
      let seen = 0;
      for (let i = 0; i < this.bins.length; i++) {
        seen += this.bins[i];
        if (seen >= rank) return (i + 0.5) * this.width;
      }
      return null;
    }
    summary() { return { n: this.n, p5: this.percentile(0.05), p50: this.percentile(0.5), p95: this.percentile(0.95) }; }
  }

  // ── Frame statistics ───────────────────────────────────────────────

  class FrameStats {
    /** @param {number} [defaultThreshold=0.18] the built-in EAR threshold, for comparison */
    constructor(defaultThreshold = 0.18) { this.defaultThreshold = defaultThreshold; this.reset(); }

    reset() {
      this.frames = 0; this.faceFrames = 0; this.gazeFrames = 0;
      this.reasons = {};
      this.conf = new Histogram(0.01, 1.0);
      this.earOpen = new Histogram(0.005, 0.6);
      this.earClosed = new Histogram(0.005, 0.6);
      this.openBelowDefault = 0;
      this.threshold = null;
    }

    add(info) {
      if (!info) return;
      this.frames++;
      this.reasons[info.reason] = (this.reasons[info.reason] || 0) + 1;
      if (info.gaze) this.gazeFrames++;
      if (!info.face) return;
      this.faceFrames++;
      this.threshold = info.earThreshold;
      this.conf.add(info.confidence);
      for (const e of info.eyes) {
        if (e.open) {
          this.earOpen.add(e.ear);
          if (e.ear <= this.defaultThreshold) this.openBelowDefault++;
        } else {
          this.earClosed.add(e.ear);
        }
      }
    }

    summary() {
      const pct = (n) => (this.frames ? (n / this.frames) * 100 : 0);
      return {
        frames: this.frames,
        facePct: pct(this.faceFrames),
        gazePct: pct(this.gazeFrames),
        reasons: { ...this.reasons },
        confidence: this.conf.summary(),
        ear: {
          threshold: this.threshold,
          open: this.earOpen.summary(),
          closed: this.earClosed.summary(),
          // Share of eye samples treated as open that the default threshold would call closed.
          openBelowDefault: this.earOpen.n ? this.openBelowDefault / this.earOpen.n : 0,
        },
      };
    }

    /** Plain-text lines for the dashboard. */
    describe() {
      const s = this.summary();
      const pc = (v) => `${v.toFixed(1)}%`;
      const dist = (d) => (d.n ? `median ${f2(d.p50)}, 5–95% ${f2(d.p5)}–${f2(d.p95)} (n=${d.n})` : 'no samples');
      const reasons = Object.entries(s.reasons).sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k} ${pc((v / Math.max(1, s.frames)) * 100)}`).join(', ');
      const lines = [
        `Frames: ${s.frames}   with a face: ${pc(s.facePct)}   with a gaze point: ${pc(s.gazePct)}`,
        `Why: ${reasons || '—'}`,
        `Confidence (face frames): ${dist(s.confidence)}`,
        `EAR, eyes counted open:   ${dist(s.ear.open)}`,
        `EAR, eyes counted closed: ${dist(s.ear.closed)}`,
      ];
      if (s.ear.threshold != null && s.ear.threshold < this.defaultThreshold && s.ear.open.n) {
        lines.push(`At threshold ${f2(s.ear.threshold)}, ${pc(s.ear.openBelowDefault * 100)} of the eye samples used as open ` +
                   `would count as closed at the default ${f2(this.defaultThreshold)}.`);
      }
      return lines;
    }
  }

  // ── Eyes open / closed check ───────────────────────────────────────

  const EAR_CHECK_PHASES = [
    { name: 'up', label: 'Eyes open, looking up', ms: 3000, skipMs: 700, open: true, dot: { x: 0.5, y: 0.1 } },
    { name: 'down', label: 'Eyes open, looking down', ms: 3000, skipMs: 700, open: true, dot: { x: 0.5, y: 0.9 } },
    // Short enough (with reaction time) to stay under the 3 s eyes-closed alarm.
    { name: 'closed', label: 'Eyes closed', ms: 2000, skipMs: 600, open: false, dot: null },
  ];

  class EarCheck {
    constructor(phases = EAR_CHECK_PHASES) { this.phases = phases; this.t0 = null; }

    start(t) {
      this.t0 = t;
      this.samples = this.phases.map(() => ({ right: [], left: [], missing: 0 }));
    }

    /** The phase at time t ({ index, elapsed, ...phase }), or null when finished. */
    phase(t) {
      let start = this.t0;
      for (let i = 0; i < this.phases.length; i++) {
        const p = this.phases[i];
        if (t < start + p.ms) return { ...p, index: i, elapsed: t - start };
        start += p.ms;
      }
      return null;
    }

    add(info, t) {
      const ph = this.t0 == null ? null : this.phase(t);
      if (!ph || ph.elapsed < ph.skipMs || !info) return;   // settling or reacting: not counted
      const bucket = this.samples[ph.index];
      if (!info.face) { bucket.missing++; return; }
      for (const e of info.eyes) bucket[e.side].push(e.ear);
    }

    result(threshold) {
      const stats = (v) => ({ n: v.length, p5: percentile(v, 0.05), p50: percentile(v, 0.5), p95: percentile(v, 0.95) });
      const phases = this.phases.map((p, i) => {
        const b = this.samples[i];
        return { name: p.name, label: p.label, open: p.open, missing: b.missing,
                 n: Math.max(b.right.length, b.left.length), right: stats(b.right), left: stats(b.left) };
      });
      const pooled = (open) => this.phases.flatMap((p, i) => (p.open === open ? [...this.samples[i].right, ...this.samples[i].left] : []));
      const openVals = pooled(true), closedVals = pooled(false);
      const share = (vals, pred) => (vals.length ? vals.filter(pred).length / vals.length : 0);
      const openLow = percentile(openVals, 0.05), closedHigh = percentile(closedVals, 0.95);
      return {
        threshold, phases,
        enough: phases.every((p) => p.n >= 10),
        openAsClosed: share(openVals, (v) => v <= threshold),
        closedAsOpen: share(closedVals, (v) => v > threshold),
        openLow, closedHigh,
        separable: openLow != null && closedHigh != null && closedHigh < openLow,
      };
    }

    /** Plain-text lines for the dashboard. */
    static describe(r, threshold) {
      const pc = (v) => `${Math.round(v * 100)}%`;
      const eye = (s, which) => (s.n ? `${which} median ${f2(s.p50)} (5–95% ${f2(s.p5)}–${f2(s.p95)})` : `${which} —`);
      const lines = r.phases.map((p) => `${p.label.padEnd(24)} ${eye(p.right, 'R')} · ${eye(p.left, 'L')}  n=${p.n}` +
                                         (p.missing ? `, ${p.missing} frames without a face` : ''));
      if (!r.enough) {
        lines.push('Too few frames in at least one step (face not found?). Check the lighting and position, then repeat.');
        return lines;
      }
      lines.push(`Threshold now ${f2(threshold)}: ${pc(r.openAsClosed)} of open-eye samples count as closed, ` +
                 `${pc(r.closedAsOpen)} of closed-eye samples count as open.`);
      lines.push(r.separable
        ? `For this person, open and closed eyes separate between ${f2(r.closedHigh)} and ${f2(r.openLow)} (5th–95th percentiles).`
        : `Open and closed eyes overlap (closed up to ${f2(r.closedHigh)}, open down to ${f2(r.openLow)}): no threshold separates them cleanly.`);
      return lines;
    }
  }

  root.LumiDiagnostics = { feedMapping, drawOverlay, describeFrame, drawDirection, FrameStats, EarCheck,
                           EAR_CHECK_PHASES, REASON_TEXT, percentile };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.LumiDiagnostics;
})(typeof window !== 'undefined' ? window : globalThis);

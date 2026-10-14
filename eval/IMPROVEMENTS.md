# LumiIQ — Phase C: each improvement against the baseline

Written by `npm run eval:ablation` from the sessions in `eval/sessions/`. Do not edit by hand: run the command again.

*Generated 2026-10-14T09:40:26.881Z · code: commit 585eb8b on phase-c-gaze, with uncommitted changes*

**How to read this**
- Every row replays the **same recorded sessions** through the app's own gaze code (`eval/replay.js`) with some
  improvements switched on: none (the baseline, the app as of Phase B), one at a time, or all seven.
- **replayed real**: every figure in this file is recomputed from recordings of a person.
- Mean ± SD is across sessions; *n* is the number of sessions. A figure no session provides is shown as "—".
- The split into development and held-out sessions, the figures and the criteria were fixed before any session
  was recorded: `docs/adr/0003-phase-c-ablation.md` (ADR 0003).

## Held-out sessions (the result)

**No sessions have been recorded yet.** Every table below is therefore empty. Record sessions as described in
`docs/RECORDING.md` (on at least two days), then run `npm run eval:ablation` again.

An improvement **meets the criteria** if its mean is, compared with the baseline's, 15 % or more accurate (9-point),
or has a lower p95, or fewer wrong selections, **and** is not worse in false activations per minute or time per
correct selection. Means are compared; with this few sessions no statistical test is claimed.

| Variant | Accuracy 9-pt (px) | Change in accuracy | Accuracy 16-pt (px) | p95 9-pt (px) | After head movement (px) | Wrong selections, dwell (%) | Time per correct selection, dwell (s) | False activations / min | Drift warnings | n | Label | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Baseline (Phase B): all off | — | — | — | — | — | — | — | — | — | — | — | — |
| C1: head-pose compensation | — | — | — | — | — | — | — | — | — | — | — | — |
| C2: eye-opening floor for gaze | — | — | — | — | — | — | — | — | — | — | — | — |
| C3: stricter outlier filter | — | — | — | — | — | — | — | — | — | — | — | — |
| C4: 300 ms settle guard | — | — | — | — | — | — | — | — | — | — | — | — |
| C5: degree 1 or 2 | — | — | — | — | — | — | — | — | — | — | — | — |
| C6: confidence-weighted smoothing | — | — | — | — | — | — | — | — | — | — | — | — |
| C7: directional drift detector | — | — | — | — | — | — | — | — | — | — | — | — |
| All of C1–C7 | — | — | — | — | — | — | — | — | — | — | — | — |

## Development sessions (not a result)

Used while changing the code (ADR 0003). Shown so that every recorded session is accounted for; **not a result**.

| Variant | Accuracy 9-pt (px) | Change in accuracy | Accuracy 16-pt (px) | p95 9-pt (px) | After head movement (px) | Wrong selections, dwell (%) | Time per correct selection, dwell (s) | False activations / min | Drift warnings | n | Label |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Baseline (Phase B): all off | — | — | — | — | — | — | — | — | — | — | — |
| C1: head-pose compensation | — | — | — | — | — | — | — | — | — | — | — |
| C2: eye-opening floor for gaze | — | — | — | — | — | — | — | — | — | — | — |
| C3: stricter outlier filter | — | — | — | — | — | — | — | — | — | — | — |
| C4: 300 ms settle guard | — | — | — | — | — | — | — | — | — | — | — |
| C5: degree 1 or 2 | — | — | — | — | — | — | — | — | — | — | — |
| C6: confidence-weighted smoothing | — | — | — | — | — | — | — | — | — | — | — |
| C7: directional drift detector | — | — | — | — | — | — | — | — | — | — | — |
| All of C1–C7 | — | — | — | — | — | — | — | — | — | — | — |

## Sessions

None yet.

## What a replay cannot show
- The person reacted to the cursor they saw live. Selection and rest figures are estimates of what a variant
  would have done with the same eye movements. Blink selection is not replayed.
- A variant can drop calibration frames the live run kept, but cannot add frames the live run did not collect.
- C4 waits 300 ms after a target appears; the app already waits 500 ms, so C4 is expected to equal the baseline.
- C7 changes only when the recalibration warning appears (the drift warnings column), no accuracy figure.
- C1 assumes a head-turn gain of 0.4 and MediaPipe's head-matrix sign convention; neither is yet checked on a
  real camera.

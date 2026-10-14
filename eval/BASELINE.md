# LumiIQ — evaluation baseline

Written by `npm run eval:report` from the sessions in `eval/sessions/`. Do not edit by hand: run the command again.

*Generated 2026-10-14T09:43:52.317Z · code: commit 47c5d32 on phase-c-gaze*

**How to read the numbers**
- Every figure is computed by code from recorded sessions. A figure no session provides is shown as "—".
- **replayed real**: recomputed from the recording by `eval/replay.js`, which runs the app's own gaze code.
- **live real**: counted while the session ran (selections, false activations, lag).
- Lengths are given as pixels / degrees of visual angle. Mean ± SD is across sessions; *n* is the number of sessions.

## Sessions

**No sessions have been recorded yet.** Every table below is therefore empty.
To record one: open the app, go to **⚙ Caregiver → Diagnostics → Start an evaluation session**, and follow
`docs/RECORDING.md`. Then run `npm run eval:report` again.

## Table A — accuracy and precision (dissertation Table 4.6)

Measured on targets that were **not** used for calibration, 500–1600 ms after each target appeared.

| Condition | Accuracy x | Accuracy y | Precision x | Precision y | n | Source |
|---|---|---|---|---|---|---|
| Default settings, 9-point calibration | — | — | — | — | 0 | — |
| Default settings, 16-point calibration | — | — | — | — | 0 | — |
| Header and right-edge targets only | — | — | — | — | 0 | — |
| After head turn (about 5° left/right) | — | — | — | — | 0 | — |
| After head tilt (up/down) | — | — | — | — | 0 | — |
| Leaning closer/farther | — | — | — | — | 0 | — |
| In-app estimate for the same calibration | — | — | — | — | 0 | — |

- **Accuracy**: mean distance of the gaze from the target on that axis. **Precision**: spread (SD) of the gaze around its own mean.
- Rows 1–2 use all 12 held-out targets; row 3 the 2 header and 2 right-edge targets; the head rows the 4 interior targets
  measured again after each movement, with the 9-point calibration.
- The in-app estimate is what the calibration screen reports (leave-one-target-out error). The app does not estimate precision.

## Table B — selection and false activations (dissertation Table 4.7)

| Measure | Dwell | Blink | n | Source |
|---|---|---|---|---|
| Wrong selections (%) | — | — | 0 | — |
| Missed prompts (%) | — | — | 0 | — |
| Time per correct selection (s) | — | — | 0 | — |
| False activations per minute (rest period) | — | — | 0 | — |

- Selection test: 10 prompted keys per mode on the real keyboard. **Wrong**: share of selections that hit another target.
  **Missed**: share of prompts not selected within 10 s. Time runs from the prompt to the correct selection.
- False activations: selections made during the 2-minute rest period, with the default "dwell or blink" mode, split by what caused each one.

### Lag and jitter

| Measure | Smoothing 0.35 | Smoothing 0.06 | n | Source |
|---|---|---|---|---|
| Settling time (ms) | — | — | 0 | — |
| Fixation jitter (px, RMS) | — | — | 0 | — |

- **Settling time**: from a target jumping until the cursor stays within 60 px of where it comes to rest. It includes the
  person's own reaction time. **Jitter**: RMS movement of the cursor between frames during a steady 5-second fixation.

## 95th-percentile error and the smallest reliable target

| Calibration | 95th-percentile error | Smallest reliable target | n | Source |
|---|---|---|---|---|
| 9-point | — | — | 0 | — |
| 16-point | — | — | 0 | — |

A target is reliable only if 95% of gaze samples aimed at its centre land inside it, so it must be at least
**twice the 95th-percentile error** wide and high.

## In-app estimate against the held-out error (audit finding M1)

For the 9-point calibration: what the calibration screen would have reported, next to what was measured.

| Figure | x | y | n | Source |
|---|---|---|---|---|
| In-app estimate, interleaved folds (old) | — | — | 0 | — |
| In-app estimate, leave-one-target-out (new) | — | — | 0 | — |
| Measured on the 12 held-out targets | — | — | 0 | — |

## Settle time before measuring (audit finding L6)

The same showing of each target, measured over two windows (9-point calibration, accuracy).

| Window after the target appears | Accuracy x | Accuracy y | n | Source |
|---|---|---|---|---|
| 500–1600 ms (the calibration timing) | — | — | 0 | — |
| 1100–2200 ms (longer settle) | — | — | 0 | — |

## Head positions actually reached

Change from the head position during the head-still accuracy check, as measured by the camera when each position was accepted.
Turn and tilt in degrees; lean as the change in apparent face size.

| Position | Change | n | Source |
|---|---|---|---|
| turnLeft | — | 0 | — |
| turnRight | — | 0 | — |
| tiltUp | — | 0 | — |
| tiltDown | — | 0 | — |
| leanCloser | — | 0 | — |
| leanFarther | — | 0 | — |

## Sessions behind each row

| Row | Sessions |
|---|---|
| A: Default settings, 9-point calibration | — |
| A: Default settings, 16-point calibration | — |
| A: Header and right-edge targets only | — |
| A: After head turn (about 5° left/right) | — |
| A: After head tilt (up/down) | — |
| A: Leaning closer/farther | — |
| A: In-app estimate for the same calibration | — |
| B: Wrong selections (%) | — |
| B: Missed prompts (%) | — |
| B: Time per correct selection (s) | — |
| B: False activations per minute (rest period) | — |
| Lag: Settling time (ms) | — |
| Lag: Fixation jitter (px, RMS) | — |
| p95: 9-point | — |
| p95: 16-point | — |
| M1: In-app estimate, interleaved folds (old) | — |
| M1: In-app estimate, leave-one-target-out (new) | — |
| M1: Measured on the 12 held-out targets | — |
| L6: 500–1600 ms (the calibration timing) | — |
| L6: 1100–2200 ms (longer settle) | — |

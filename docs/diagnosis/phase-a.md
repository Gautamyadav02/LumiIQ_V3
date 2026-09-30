# Phase A — Diagnosis: detection or mapping?

*30 September 2026, branch `phase-a-diagnosis`. Every number here is **synthetic**: it
comes from the code or from synthetic landmarks run through the real modules. No real
person was measured. The on-screen checks in section 3 produce the first **live real**
numbers.*

## The question

"Accuracy is poor" and "it doesn't seem to detect the eye properly" can have two different
causes:

- **Detection:** MediaPipe's eye landmarks are wrong or unstable, so every later step works
  from bad input.
- **Mapping:** the landmarks are fine, but calibration, the model or the settings turn them
  into the wrong screen position.

The fixes are completely different, so this must be settled first.

## 1. What the code already shows (before looking at a real face)

### 1.1 The amber crosshair on the live feed was misleading (fixed)

It could easily look like "the eye is not detected":

- **It was never on the eye.** It plotted the iris position *inside the eye opening* (a
  0–1 ratio) stretched across the whole video. It hovered near the middle of the picture,
  usually over the nose, and moved only a little.
- **It moved the wrong way.** The canvas was mirrored by CSS and the code flipped it again, so
  it moved left when the eyes turned right.
- **Its numbers were drawn backwards**, because the canvas was mirrored.

It is now a small inset labelled "eye direction" that moves with the eyes. The new overlay
shows where MediaPipe actually puts each iris. The overlay's mapping from camera to screen
was checked in Chrome with a fake camera: markers land within about 1 px of the video
content they describe (**synthetic** video, 1280×720 camera in the 276×206 px feed).

### 1.2 The saved EAR threshold 0.11 lets half-closed eyes count as open

EAR (eye aspect ratio) is the eye's height divided by its width. An eye counts as open when
EAR is above the threshold. The default threshold is 0.18; the development machine has 0.11.

Measured on the real engine with synthetic landmarks (`node eval/synthetic/ear-threshold.js`,
**synthetic**):

| Both eyes at EAR | Threshold 0.11 | Threshold 0.18 |
|---|---|---|
| 0.10 | closed: no gaze, no calibration sample | closed |
| 0.12, 0.14, 0.16 | **open**: gaze points and calibration samples (10/10 frames) | closed (0/10) |
| 0.20, 0.28 | open | open |
| 0.12–0.16 held for 4 s | **no eyes-closed alarm** | alarm |

**What this means:**

- **Half-closed frames drive the cursor.** Frames from half-closed eyes (drowsy, squinting,
  the start and end of every blink) produce gaze points.
- **Their vertical estimate is unreliable.** The vertical features (`ly`, `ry`) are measured
  *between the eyelids*, so they move when the lids move, even if the eye does not. The
  direction and size of that shift on a real face is not known yet; the overlay and Phase B
  will show it.
- **Those frames also enter calibration** as ordinary training samples.
- **Drowsy eyes don't alarm.** A patient whose eyes rest half-shut at EAR 0.12–0.16 never
  raises the eyes-closed alarm.
- **Blinks are harder to detect.** A blink only registers if EAR goes down to the threshold, so
  shallow blinks are missed (fewer rapid-blink alarms, harder blink-to-select).
- **Why 0.11 may have been chosen:** eyes open *less* when looking down, where the keyboard's
  bottom row is. If this person's open eyes drop below 0.18 when looking down, 0.18 would lose
  the gaze there. **That is exactly what the new eyes open/closed check measures** (section 3,
  check D4). The right threshold is a fact about this person's eyes, not a guess.

### 1.3 Calibration's outlier filter lets partly-closed frames through

Calibration throws a frame away only if it is an outlier in **more than 30%** of the
10 features. A frame disturbed by the eyelids moves `ly`, `ry` and `ear`: 3 of 10, exactly
30%, so it passes as "clean".

**Synthetic check:**

| Disturbed frames | Kept as clean |
|---|---|
| Changed in 3 of 10 features | 6 of 6 |
| Changed in 4 of 10 features | 0 of 6 |

Together with 1.2, this means blink and half-closed frames can reach the model. Changing the
filter is a gaze-behaviour change, so it waits for Phase B's baseline.

### 1.4 "Left Eye Only" probably tracks the patient's right eye

- **The code:** the engine's "left" eye uses MediaPipe's *right-eye* landmarks (33/133/159/145,
  iris 468) unless "Swap Left & Right" is on. MediaPipe names eyes by the person's own side, in
  an unmirrored camera image, which is what browsers deliver.
- **The consequence:** for a patient who can use only one eye, choosing that eye by name may
  track the other one.
- **Status:** this follows from MediaPipe's documented landmark convention and needs one
  confirmation on a real camera (check D3). The per-frame record reports truthfully which eye
  is used (test: `diagnostics.test.js`). No change yet: it would change which eye is tracked.

### 1.5 The in-app calibration score is not evidence of accuracy

The saved calibration is rated "Excellent" (99%, ~74 px). Audit finding M1 showed that this
score is optimistic, because its cross-validation mixes frames of the same target into
training and testing. In synthetic tests it said "Excellent" in all 8 scenarios, including
ones with large real errors. Phase B replaces it with held-out validation targets.

### 1.6 The saved settings make any error more visible

- **Dwell 600 ms**, the shortest the UI allows: a key fires 150 ms of focus + 600 ms after the
  gaze arrives, so a brief glance at the neighbouring key can type it.
- **Smoothing 0.06**, close to the least: the cursor follows every jitter of the estimate.

Even with good detection, these settings make selection feel inaccurate. **Reset settings to
defaults** (new button, Platform Settings) before judging tracking.

## 2. What the code cannot tell us

- Whether MediaPipe's iris centres sit on this person's pupils, in this light, at this distance.
- This person's EAR when open (looking up and down) and when closed.
- How far the cursor lands from where they look, and whether head movement is the cause (M2).

## 3. What to look at on screen

The Caregiver tab, with the camera on. First press **Reset settings to defaults** (or write
down the current values to put them back).

**Detection checks.** Tick **Show detection overlay**.

| # | Do this | Detection is fine if… | Detection problem if… |
|---|---|---|---|
| D1 | Look around the screen, head still | the cyan crosshairs stay on the pupils; the amber dots sit on the eye corners and lid edges | crosshairs sit beside the pupil, or on the eyelid; dots off the eye outline |
| D2 | Hold your gaze on one spot for 5 s | the crosshairs stay still (a pixel or two of flicker) | they jump around while the eye is still |
| D3 | Close only your **left** eye (wink) | the **L** label turns red and its EAR drops; **R** stays green | **R** drops instead: the eye labels (and "Left/Right Eye Only") are swapped |
| D4 | Diagnostics → **Eyes open / closed check** (8 s; the patient follows the dot, closes at the chime, opens at the next chime) | the result says open and closed "separate between A and B"; the current threshold counts ~0% of open samples as closed | "overlap", or many open samples (looking down) count as closed |
| D5 | Turn your head left, then right; nod | yaw changes sign between left and right; pitch changes when nodding; the readout says "gaze point: yes" when looking at the screen | values frozen, or "no usable eye" while the eyes are clearly open |
| D6 | Diagnostics → **Start frame statistics**; use the keyboard normally for 1–2 minutes; **Stop** | a face in nearly every frame; a gaze point in well over 90% of frames | many frames without a face (light, position) or "no usable eye" (threshold) |

**Mapping checks.** Do these only if D1–D6 pass.

| # | Do this | What it means |
|---|---|---|
| M1 | Look left, right, up, down; watch the **eye direction** inset | It should move the same way each time. If it does and D1 passes, detection is fine. |
| M2 | Recalibrate with the defaults (9 or 16 points, head still), accept, then look at single keys | If the cursor is consistently offset, squeezed toward the middle, or worse at the edges, the problem is **mapping**. |
| M3 | After M2, turn or tilt the head slightly and look at the same key | If the error grows a lot, it is head movement after calibration (audit M2). |

**Reading the results:**

- **D1, D2 or D3 fail:** detection. Fix light and camera position first; then see Phase E (a
  sharper eye crop) only if needed.
- **D4 or D6 point at the threshold:** set the EAR threshold inside the range D4 reports.
  This is a setting, not a code change.
- **D1–D6 pass but M2/M3 fail:** mapping. That is Phase B (measure) and Phase C (improve).

When you report back, the numbers from D4 and D6 are **live real** numbers.

## 4. Open risks

- **The on-screen checks rely on judgement** ("on the pupil"). Phase B's recorded sessions make
  this objective.
- **The eyes open/closed check has limits.** Its closed step lasts 2 s, to stay under the 3 s
  eyes-closed alarm; a slow reaction to the second chime could still set it off. It also
  measures one sitting, in one light.
- **Head-pose signs (D5) are not yet confirmed** against the column-major assumption noted in
  AUDIT §5.6. D5 is the first real check.

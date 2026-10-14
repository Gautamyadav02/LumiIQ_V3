# ADR 0003 — Phase C: switches, a fixed held-out split, and how an improvement is judged

- **Status:** accepted (Phase C, 14 October 2026). Written before any session with a person
  had been recorded, so neither the split nor the criteria could be chosen to suit a result.
- **Context:** gaze accuracy is poor in real use (seen by the author and the supervisor).
  Phase C adds seven changes (C1–C7) meant to improve it. Each needs to be judged on its own
  and together, on recordings of a person, without tuning to the recordings it is judged on.

## Decisions

1. **Every change is a switch, on by default on `phase-c-gaze`.**
   - The switches are `GazeFeatures.IMPROVEMENTS` (C1–C7). `GazeFeatures.improvementOptions()`
     turns them into the options of `GazeFeatures.extract`, `GazeCalibration`,
     `GazeStabilizer` and `DriftDetector`.
   - In the app, `LumiGaze.setImprovements()` switches them. The choice is not saved: a
     reload brings back the defaults.
   - Every evaluation session records the switches in force (`engine.flags`). A session
     from before Phase C has none.
   - All switches off is exactly the Phase B app. The tests check this for features,
     confidence, calibration options, smoothing and the drift rule.

2. **Comparisons are made by replay, on the same recordings.**
   - `npm run eval:ablation` replays each session with each variant:
     - the baseline (all off);
     - each change alone;
     - all seven together.
   - It writes `eval/IMPROVEMENTS.md`.
   - Every variant sees the same eye movements, so differences come from the code. Live
     recordings with different code would differ in the person as well.

3. **The held-out set is the last recording day.**
   - A session's day is the date of its `createdAt`, in UTC.
   - The sessions of the **latest day** are the held-out set. The sessions of all earlier
     days are the development set.
   - With sessions from only one day there is no held-out set, and no comparison is
     reported as a result.
   - Synthetic sessions are never in either set.
   - `docs/RECORDING.md` already asks for both lighting conditions on both days, so the
     held-out day has both.
   - **Any change to C1–C7 after this point is decided on development sessions only.** This
     includes their constants: the head-turn gain 0.4, the EAR floor 0.16, the 300 ms
     settle time, and the drift run of 6 and median 0.35.
   - The held-out table is read for the final report. It is not used to choose between
     versions of a change.

4. **The figures, per session, then mean ± SD over the held-out sessions:**
   - **Accuracy (primary):** mean error on the 12 held-out targets after the 9-point
     calibration (standard window 500–1600 ms), in px. The 16-point figure is shown beside
     it.
   - **p95:** the 95th-percentile error over the same samples.
   - **Accuracy after head movement:** the mean of the turn, tilt and lean figures.
   - **Wrong selections (%)** and **time per correct selection (s)**, both from the dwell
     half of the selection test, replayed.
   - **False activations per minute** in the 2-minute rest, by dwell, replayed.
   - **Drift warnings**: how often the drift detector would have asked for recalibration
     during the replayed selections.

5. **An improvement meets the criteria** if its held-out mean is better than the baseline's
   held-out mean in at least one of:
   - accuracy, by **15 % or more**;
   - a **lower p95**;
   - **fewer wrong selections**;

   and it is **not worse** in either of:
   - false activations per minute;
   - time per correct selection.

   Any needed figure missing → "cannot be judged". "Better" and "worse" compare means.
   With a handful of sessions no statistical test is claimed. The report shows the
   per-session spread so the reader can see how much the means could move.

## Consequences and limits (stated in the report too)

- **The person reacted to the live cursor.** In the selection test and the rest period,
  the replayed outcome is an estimate of what the variant would have done with the same eye
  movements.
- **Blink selection is not replayed.** Its figures stay live-only.
- **A variant can drop calibration frames the live run kept, but cannot add frames the live
  run did not collect.** For example, C2 replayed on a baseline session drops narrow-eye
  frames; the reverse cannot restore frames C2 dropped live.
- **C4 cannot change a replay of the current app.** The app already waits 500 ms before
  collecting, and C4's guard is 300 ms. C4's row is expected to equal the baseline; it is
  kept as a guard for callers that do not wait.
- **C7 changes no accuracy or selection figure.** It changes only when the recalibration
  warning appears.
- **C1 rests on assumptions not yet checked on a real camera:**
  - the head-turn gain 0.4, from eye anatomy;
  - the sign convention of MediaPipe's head matrix;
  - the camera picture's aspect ratio, recorded per session since this phase. Sessions
    recorded before that assume 16:9.
- **An observation, not a change:** the eye opening (EAR) is computed from normalised image
  coordinates, so it is inflated by the picture's aspect ratio (about 1.78 for 16:9). The
  thresholds (0.18 for the alarm, 0.16 for C2) are in those units. This is left as it is
  because existing settings depend on it.
- **Saved calibrations:** a calibration made with C1 off is version 3, and with C1 on
  version 4. Each is restored only when the same feature set is in use. Otherwise the
  caregiver is asked to recalibrate. The server accepts both versions.

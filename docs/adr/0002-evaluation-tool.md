# ADR 0002 — The evaluation tool: record numbers, replay the real code, never fill a gap

- **Status:** accepted (Phase B, 14 October 2026)
- **Context:** the dissertation (Section 3.6) describes an evaluation that measures gaze
  accuracy on held-out targets, selection performance and false activations. No such tool
  existed, and accuracy is poor in real use, so every later change needs a baseline to beat.
  A first attempt at the tool (commit `93404f3`) was replaced: it could not start a session
  in a browser, pre-ticked consent, and would have reported the screen centre's error as a
  "replayed real" result.

## Decisions

1. **A session stores numbers, not pictures.**
   - **What is stored per frame:** a timestamp, 16 landmark positions, the head matrix, the 10
     features, eye opening, confidence, the model's output and the smoothed gaze.
   - **How images are kept out:** the recorder copies a fixed list of numeric fields and nothing
     else. The recorder and the server both reject long or image-like text.
   - **Why:** face data linked to a person is special-category data under UK GDPR.

2. **Consent is explicit, and gates everything.** The box is never pre-ticked. No recorder
   exists before consent, the recorder refuses to start without it, and the server refuses to
   save a session without it. Stopping saves nothing.

3. **Held-out targets.** 12 targets that are on none of the calibration grids: 4 corners,
   2 in the header band, 2 on the right edge (one on Nurse Call), 4 interior. Cross-validation
   inside a calibration is not a measurement of accuracy (decision 8); only targets the model
   never saw are.

4. **One showing, two windows.** Each validation target stays for 2.2 s. The standard figures
   use the calibration timing (500–1600 ms). The longer settle for audit L6 (1100–2200 ms) is
   cut from the same recording, so the two are compared on identical eye movements, and the
   participant is not asked to do it twice.

5. **The selection test and the rest period use the real keyboard, with selections
   intercepted.** Nothing is typed or spoken and Nurse Call cannot fire. A rest period on a
   blank screen would always count zero false activations, which would look like a result.

6. **Replay runs the app's own code.** Feature extraction moved into `gaze/gaze-features.js`
   so the engine and `eval/replay.js` share it; replay re-fits each calibration from exactly
   the frames each point was built from, then runs the real smoother and dwell controller.
   **Every replay reports how closely it reproduces the live gaze** before any variant is
   trusted. On a simulated session the model's output matches to within 0.01 px.

7. **No number is ever filled in.**
   - A metric with no data is `null`, shown as "—".
   - Every reported row is labelled "replayed real" or "live real".
   - A generated session is marked `synthetic`; it is left out of `eval/BASELINE.md` and can
     appear only in a separate, gitignored file where every row says "synthetic".

8. **Calibration's own estimate uses leave-one-target-out (audit M1).** The old interleaved
   folds put frames of one target on both sides and were optimistic. Leave-one-target-out is
   **not** the true error either: on synthetic calibrations it is above the error on unseen
   targets, because a held-out corner has to be extrapolated. It errs on the safe side. The
   report prints both estimates beside the measured held-out error.

9. **Saving goes through the local server.** `POST /api/eval/session` has its own size limit,
   validates the session, never overwrites, and never serves a session back. It is local-only
   like the rest of the API. A download is the fallback.

10. **Metric definitions** (in `eval/metrics.js`, for one fixation on one target):
    - **accuracy**: mean distance from the target;
    - **precision**: RMS spread around the samples' own mean;
    - both are also given per axis, in pixels and degrees of visual angle;
    - a set of targets is the mean of its targets' figures;
    - **p95** is taken over all samples together.

## Consequences

- **Slower calibration.** Leave-one-target-out trains more models. In Node on the development
  Mac, with synthetic samples:

  | Points | Before | After |
  |---|---|---|
  | 9 | 83 ms | 189 ms |
  | 16 | 144 ms | 612 ms |
  | 25 | 227 ms | 1,572 ms |

  The page shows "Computing the calibration…" meanwhile.
- **The trained model can change.** Lambda is now chosen by leave-one-target-out, so the model
  may differ from before. The replay can run either method on the same recording.
- **Session size.** A session file is roughly 4–8 MB.
- **A live-only bug was found.** Running the wizard in real Chrome showed that the camera
  stopped whenever its picture was scrolled out of view. It was fixed in the same phase with a
  watchdog for stalled frames.

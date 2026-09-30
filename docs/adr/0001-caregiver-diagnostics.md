# ADR 0001 — Caregiver diagnostics: in memory, on screen, one coordinate mapping

- **Status:** accepted (Phase A, 30 September 2026)
- **Context:** Phase A must tell a *detection* problem (MediaPipe's landmarks wrong or
  unstable) from a *mapping* problem (landmarks fine, screen prediction wrong). The only
  visual aid, an amber crosshair on the live feed, turned out to mislead:
  - it plotted a ratio, not a position on the face;
  - it was mirrored twice;
  - its text was drawn backwards.

## Decisions

1. **The engine publishes a passive per-frame record.** `LumiGaze.onFrameInfo` receives what
   was detected (eye landmarks, EAR, open/used state, head pose, confidence, raw iris ratio)
   and why the frame did or did not produce a gaze point. Nothing in the pipeline reads it,
   and a failing listener is only logged. Diagnostics therefore cannot change gaze, dwell,
   blink or alarm behaviour.

2. **Diagnostics stay in memory, on this screen.** The overlay, frame statistics and eyes
   open/closed check are never stored, logged or sent. Only the overlay on/off choice is
   remembered in `localStorage`. Reason: the data is face-derived and linked to a patient
   (UK GDPR special category). Recording belongs to Phase B, behind a consent screen.

3. **One function maps camera coordinates onto the displayed feed.**
   `LumiDiagnostics.feedMapping` handles the `object-fit: cover` crop and the mirror. The
   canvas carries no CSS transform, so the flip happens once and text stays readable. The
   alternative, mirroring the canvas with CSS to match the video, is what caused the
   crosshair bugs: every drawing then has to remember an implicit flip.

4. **Words go under the video, not over it.** On the dashboard the feed is about 276×206 px.
   A text panel over it covered the top 40% of the picture, where the eyes usually are. Only
   point markers and short EAR labels are drawn on the video.

5. **The raw direction indicator is kept, as a labelled inset.** It shows the uncalibrated
   eye direction (the same mapping as the pre-calibration cursor). This separates "the eyes
   are tracked" from "the calibration is right".

6. **Caregiver only.** All controls are on the Caregiver tab and are not `.gazeable`.

## Consequences

- A new script, `diagnostics.js`, is served by `server.py` and precached by the service worker
  (cache `lumiiq-v5`). A test checks that every script is both.
- The per-frame record costs a few small allocations per frame (~30 per second): negligible.
- The Phase B recorder can reuse the same per-frame record rather than re-deriving landmarks.

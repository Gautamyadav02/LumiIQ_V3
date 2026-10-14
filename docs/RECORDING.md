# LumiIQ Evaluation Protocol & Recording Guide (Phase B)

*Protocol for recording real sessions to establish the empirical baseline for accuracy and precision.*

---

## 1. Principles

1. **Safety and Consent:** The evaluation protocol must never cause fatigue or distress. The participant may stop at any time. Informed consent is explicitly required before any recording starts.
2. **Privacy by Design:**
   - **No video or webcam photos are ever recorded or stored.**
   - Only numerical features (10-dim vector, eye aspect ratios, head pose matrix, timestamps, target coordinates) are saved.
   - Recordings are saved to `eval/sessions/` (which is excluded by `.gitignore`).
3. **Scientific Integrity:**
   - Real-person numbers are never fabricated, estimated or tidied.
   - Provenance is always documented (`[live real]` or `[replayed real]`).
   - Every accuracy improvement candidate must be measured against held-out validation targets.

---

## 2. Recommended Session Set

To establish Dissertation Tables 4.6 and 4.7:
- **Participant count:** At least 1 participant (author/volunteer).
- **Sessions:** At least 3 sessions per condition.
- **Timing:** Across 2 separate days.
- **Lighting conditions:**
  1. Even daytime/ambient light (~300–500 lux).
  2. Dim or directional/uneven light (~100 lux).

---

## 3. Step-by-Step Wizard Workflow

1. **Preparation:**
   - Start local server: `python3 server.py 8002` (or available port).
   - Open Chrome at `http://localhost:8002`.
   - Ensure camera has clean view of face, seated approximately 50–60 cm away.
2. **Launch Wizard:**
   - Go to **⚙ Caregiver** tab → **Diagnostics** → click **Launch Evaluation Wizard**.
3. **Step 1: Consent & Setup:**
   - Confirm consent for numerical feature recording.
   - Measure viewing distance (cm) and screen width (cm).
   - Enter lighting condition and session label.
   - Click **Reset Settings to Defaults** to ensure consistent baseline.
4. **Step 2: Baseline Calibration:**
   - Complete 9-point calibration following the target dot.
   - Review calibration quality report.
5. **Step 3: Held-Out Validation Targets (12 points):**
   - 12 targets presented across the screen that the model was NOT trained on:
     - 4 corners
     - 4 edges (including top header band and right edge where Nurse Call is located)
     - 4 inner targets
   - Eye fixates on each target for 1.5 seconds.
6. **Step 4: Head-Movement Validation:**
   - Look at center target, hold gaze.
   - Turn head slightly (~5° yaw) left and right as guided on screen.
   - Gaze error under head rotation is recorded.
7. **Step 5: Selection Accuracy (10 keys):**
   - Type 10 prompt keys using eye gaze (Dwell mode).
   - Switch to Blink-to-select mode (optional) to measure deliberate blink selection.
8. **Step 6: Rest Period (2 minutes):**
   - Look at neutral screen (reading or resting).
   - Any accidental/false activations are recorded.
9. **Step 7: 16-point Comparison (Optional):**
   - Run 16-point calibration to evaluate if higher density improves held-out accuracy.
10. **Save Session:**
    - Click **Download Evaluation Session JSON**.
    - Move file to `eval/sessions/session_<timestamp>.json`.
    - Run `npm run eval:report` to update `eval/BASELINE.md`.

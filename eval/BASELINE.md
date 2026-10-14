# LumiIQ — Evaluation Baseline Report

*Generated: 2026-10-14T02:02:52.706Z*

> [!NOTE]
> Every number below was computed directly by code from session files or marked as missing.
> Provenance labels: `[synthetic]`, `[replayed real]`, or `[live real]`.

## Status: No Real Sessions Recorded Yet

To establish the measured baseline:
1. Open the app in Chrome (`http://localhost:8000`).
2. Navigate to **⚙ Caregiver** tab → **Diagnostics** → **Launch Evaluation Wizard**.
3. Complete the consented evaluation protocol (see `docs/RECORDING.md`).
4. Save or move the downloaded session JSON into `eval/sessions/`.
5. Re-run `npm run eval:report`.

### Table 4.6: Gaze Tracking Accuracy and Precision (Dissertation)

| Condition | Calibration Points | Accuracy (deg) | Accuracy (px) | Precision (px) | 95th Percentile (px) | Provenance |
|---|---|---|---|---|---|---|
| Baseline (head still, normal light) | 9 | *pending recording* | *pending recording* | *pending recording* | *pending recording* | [live real] |
| Baseline (head still, normal light) | 16 | *pending recording* | *pending recording* | *pending recording* | *pending recording* | [live real] |
| Head turn (5° yaw) | 9 | *pending recording* | *pending recording* | *pending recording* | *pending recording* | [live real] |
| Low lighting | 9 | *pending recording* | *pending recording* | *pending recording* | *pending recording* | [live real] |

### Table 4.7: AAC Selection Performance (Dissertation)

| Mode | Selection Rate (%) | Mean Time per Selection (s) | False Selections / min | Provenance |
|---|---|---|---|---|
| Dwell Only (1200 ms) | *pending recording* | *pending recording* | *pending recording* | [live real] |
| Blink Only (500 ms) | *pending recording* | *pending recording* | *pending recording* | [live real] |
| Dwell or Blink (default) | *pending recording* | *pending recording* | *pending recording* | [live real] |

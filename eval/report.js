/**
 * LumiIQ — Evaluation Report Generator (Phase B)
 *
 * Scans eval/sessions/ for recorded sessions, computes metrics via replay,
 * and compiles eval/BASELINE.md (Dissertation Tables 4.6 and 4.7).
 *
 * STRICT PROJECT RULES:
 * - Real-person numbers are NEVER invented, estimated or tidied.
 * - Missing numbers stay missing.
 * - Every number is explicitly labelled "synthetic", "replayed real" or "live real".
 *
 * Usage:
 *   npm run eval:report
 *   node eval/report.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { replaySession } = require('./replay.js');
const { computeGazeMetrics, computeSelectionMetrics } = require('./metrics.js');

const SESSIONS_DIR = path.resolve(__dirname, 'sessions');
const REPORT_PATH = path.resolve(__dirname, 'BASELINE.md');

function findSessionFiles() {
  if (!fs.existsSync(SESSIONS_DIR)) return [];
  return fs.readdirSync(SESSIONS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => path.join(SESSIONS_DIR, f));
}

function generateReport() {
  const sessionFiles = findSessionFiles();

  let content = '# LumiIQ — Evaluation Baseline Report\n\n';
  content += `*Generated: ${new Date().toISOString()}*\n\n`;
  content += '> [!NOTE]\n';
  content += '> Every number below was computed directly by code from session files or marked as missing.\n';
  content += '> Provenance labels: `[synthetic]`, `[replayed real]`, or `[live real]`.\n\n';

  if (sessionFiles.length === 0) {
    content += '## Status: No Real Sessions Recorded Yet\n\n';
    content += 'To establish the measured baseline:\n';
    content += '1. Open the app in Chrome (`http://localhost:8000`).\n';
    content += '2. Navigate to **⚙ Caregiver** tab → **Diagnostics** → **Launch Evaluation Wizard**.\n';
    content += '3. Complete the consented evaluation protocol (see `docs/RECORDING.md`).\n';
    content += '4. Save or move the downloaded session JSON into `eval/sessions/`.\n';
    content += '5. Re-run `npm run eval:report`.\n\n';

    content += '### Table 4.6: Gaze Tracking Accuracy and Precision (Dissertation)\n\n';
    content += '| Condition | Calibration Points | Accuracy (deg) | Accuracy (px) | Precision (px) | 95th Percentile (px) | Provenance |\n';
    content += '|---|---|---|---|---|---|---|\n';
    content += '| Baseline (head still, normal light) | 9 | *pending recording* | *pending recording* | *pending recording* | *pending recording* | [live real] |\n';
    content += '| Baseline (head still, normal light) | 16 | *pending recording* | *pending recording* | *pending recording* | *pending recording* | [live real] |\n';
    content += '| Head turn (5° yaw) | 9 | *pending recording* | *pending recording* | *pending recording* | *pending recording* | [live real] |\n';
    content += '| Low lighting | 9 | *pending recording* | *pending recording* | *pending recording* | *pending recording* | [live real] |\n\n';

    content += '### Table 4.7: AAC Selection Performance (Dissertation)\n\n';
    content += '| Mode | Selection Rate (%) | Mean Time per Selection (s) | False Selections / min | Provenance |\n';
    content += '|---|---|---|---|---|\n';
    content += '| Dwell Only (1200 ms) | *pending recording* | *pending recording* | *pending recording* | [live real] |\n';
    content += '| Blink Only (500 ms) | *pending recording* | *pending recording* | *pending recording* | [live real] |\n';
    content += '| Dwell or Blink (default) | *pending recording* | *pending recording* | *pending recording* | [live real] |\n';

    fs.writeFileSync(REPORT_PATH, content, 'utf8');
    console.log(`Report written to ${REPORT_PATH}`);
    console.log('No session files found in eval/sessions/. Template baseline report created.');
    return;
  }

  // If sessions exist, replay and compute aggregates
  const reports = [];
  for (const file of sessionFiles) {
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      const rep = replaySession(data);
      reports.push({ file: path.basename(file), data, rep });
    } catch (err) {
      console.error(`Error processing ${file}:`, err.message);
    }
  }

  content += `## Recorded Sessions Analyzed (${reports.length})\n\n`;
  content += '| Session File | Condition | Frames | Accuracy (px) | Precision (px) | P95 (px) | Provenance |\n';
  content += '|---|---|---|---|---|---|---|\n';
  for (const r of reports) {
    const m = r.rep.metrics;
    content += `| \`${r.file}\` | ${r.rep.condition || 'default'} | ${m.sampleCount} | ${m.accuracyPx} px | ${m.precisionPx} px | ${m.p95Px} px | [replayed real] |\n`;
  }
  content += '\n';

  fs.writeFileSync(REPORT_PATH, content, 'utf8');
  console.log(`Report successfully generated from ${reports.length} session(s) at ${REPORT_PATH}`);
}

if (require.main === module) {
  generateReport();
}

module.exports = { generateReport };

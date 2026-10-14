# Recording evaluation sessions

How to record the sessions that fill `eval/BASELINE.md` (dissertation Tables 4.6 and 4.7).
One session takes about 10 minutes. You are both the participant and the operator, unless
someone else helps.

## What a session records

- **Recorded:** numbers only. Per camera frame: a timestamp, 16 face landmark positions, the
  head matrix, eye opening, the 10 gaze features, and where the app estimated you were looking.
  Also the targets shown, which keys were selected in the test, the settings, and the camera
  picture's size in pixels.
- **Not recorded:** no video, no camera images, no sound, nothing you type.
- **Where:** one file per session in `eval/sessions/`, on this computer only. The folder is
  excluded from git and the server never serves it back.
- **Consent:** the first screen asks for it. Nothing is recorded before the box is ticked, and
  stopping at any point saves nothing.

If another person takes part, read them the consent screen first. Do not write their name in
the note field; their recording must be deleted if they ask.

## How many sessions

At least **3 sessions per lighting condition**, in **2 lighting conditions**, over **2 different
days**. That is 6 sessions at the minimum; 8 (2 per lighting per day) is better balanced.

| | Daylight | Dim or room light |
|---|---|---|
| Day 1 | 2 sessions | 1 session (2 if you can) |
| Day 2 | 1 session (2 if you can) | 2 sessions |

- **Record both lighting conditions on both days.** The sessions of the last day are the
  held-out set for Phase C, and it needs both conditions.
- Leave a break between sessions and sit down afresh each time: a session should include
  the small differences in posture that real use has.
- Pick the lighting label on the setup screen: *Daylight*, *Room light*, *Dim*, or *Uneven*
  (light from one side). Use the same two labels throughout.

**Record the baseline on branch `phase-b-eval`.** It must measure the app before any of the
accuracy changes in `phase-c-gaze`. Each session records which changes were on; `eval:report`
warns if any were.

The Phase C comparison (`npm run eval:ablation`) replays these same baseline sessions with each
change switched on, so it needs no extra recording. Its held-out set is the **last day** you record
on (see [ADR 0003](adr/0003-phase-c-ablation.md)). Record that day's sessions only when you are
done changing the code.

## Before each session

1. Start the server and open the app in Chrome:
   ```bash
   cd /Users/axel/EyeCare
   git switch phase-b-eval
   python3 server.py 8002        # port 8000 is used by another project on this Mac
   ```
   Open `http://localhost:8002` and press **Cmd+Shift+R** once after any code change.
2. Measure with a ruler or tape:
   - **viewing distance**: from your eyes to the middle of the screen, in cm;
   - **screen width**: the lit part of the screen, left edge to right edge, in cm.
3. Sit as you normally would. Keep the Chrome window full-screen and do not resize it during
   the session.
4. Go to **⚙ Caregiver → Start Gaze Camera**. Check that the picture shows your whole face.

## The session, stage by stage

Go to **⚙ Caregiver → Diagnostics → Start an evaluation session**. Each stage starts with a
card that says what to do; press **Continue** (or the space bar) when ready.

| Stage | What happens | What you do |
|---|---|---|
| 1 Consent | What is and is not recorded | Tick the box, continue |
| 2 Setup | Distance, screen width, lighting, optional note | Type the two measurements |
| 3 Settings reset | Your current settings are listed, then set to the defaults | Continue. You can restore them at the end |
| 4 Calibration, 9 points | The orange dot visits 9 places | Keep your head still; look at each dot until it moves |
| 5 Accuracy check | 12 dots the app has not seen, 2.2 s each | Look at each dot until it moves |
| 6 Head movement | Six small movements: turn left/right, tilt up/down, lean closer/back | Move until the card says "Good", hold still, then look at 4 dots. Finish by returning to the start position |
| 7 Selection test | The keyboard, with one key highlighted at a time. 10 keys by dwell, then 10 by blink | Dwell: look at the key until its ring fills. Blink: look at it, close your eyes for half a second, open them. Nothing is typed or spoken |
| 8 Rest | The keyboard for 2 minutes | Do **not** try to select anything. Look around, read the keys, rest |
| 9 Steadiness and speed | A dot to stare at for 5 s, then a dot that jumps. Twice, with two smoothing settings | Stare steadily; then follow the jumps as fast as you can |
| 10 Calibration, 16 points | 16 points, then the same 12 dots again | As in stages 4 and 5 |

Then the summary appears. It shows **this session's** figures and saves the file. Note the
file name it prints. Press **Restore my previous settings** if you want them back, then **Close**.

**During the session:**
- **Stop** (bottom right, or in the banner) ends the session and saves nothing.
- **Alarms stay on.** If the "no face" or "eyes closed" alarm sounds, dismiss it and carry on;
  the session notes that it happened. If it keeps happening, stop and fix the light or position.
- **"This step could not be completed"**: the camera did not see open eyes, or a calibration
  had too few clean samples. Check the light and your position, then press *Try this step again*.
- **"The session was NOT saved"**: the server did not accept the file. Press *Download the
  session file* and move the downloaded file into `eval/sessions/`.

## After recording

```bash
npm run eval:report        # writes eval/BASELINE.md from every session in eval/sessions/
npm run eval:ablation      # writes eval/IMPROVEMENTS.md: each Phase C change against the baseline
node eval/replay.js        # prints each session's figures and its replay check
```

Open `eval/BASELINE.md` and check:
- **Sessions table:** every session you recorded is listed, with the right date and lighting.
- **Replay check column:** it should say the model is within a hundredth of a pixel or so of
  the live one. A large difference means the replay did not reproduce that session; tell me.
- **n column:** the number of sessions behind each row. A row with fewer sessions than you
  recorded means some sessions did not complete that stage.

Do not edit `eval/BASELINE.md` by hand; it is rewritten each time the report runs.

## Deleting recordings

```bash
ls eval/sessions/                              # one file per session, named by its start time
rm eval/sessions/2026-10-15T09-30-00Z-ab12.json   # one session
rm -r eval/sessions/                           # all of them
npm run eval:report                            # rewrite the report without them
```

`eval/BASELINE.md` holds only combined figures and the session file names, never the frames.
Keep the recordings until the dissertation is marked, then delete them.

## Checking the tool without recording

```bash
npm run eval:report -- --synthetic
```

This simulates three sessions with a software "person" and writes `eval/SYNTHETIC-CHECK.md`.
Every number in that file is labelled synthetic. It shows what the report will look like; it
is not a result, and it is excluded from git.

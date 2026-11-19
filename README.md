# Gym Bulking Tracker

A personal, free, phone-first workout and bulking tracker. It's an installable web app (PWA) that works offline and keeps your data on your phone, with optional backup to your own Google Sheet.

**Status: Phase 3 (dashboard).**

| Phase | What | Status |
|---|---|---|
| 1 | Templates, workout logging, rest timer, local storage, install + offline | ✅ |
| 2 | Google Sheets sync via Apps Script, JSON export/import | ✅ |
| 3 | Dashboard: icon calendar, streak, PRs, e1RM charts, rest stats | ✅ this release |
| 4 | Bodyweight, measurements, food log (with meal start/finish times), bulk check | |
| 5 | Progress photos | |

---

## What Phase 1 does

- **Splits and day types.** Presets: Push/Pull/Legs, Upper/Lower, Full Body and Bro split. Each preset has rest days in its rotation, and you can build custom splits. Each day type has an icon, a colour and an ordered list of exercises, each with sets × rep range, target RIR and rest time.
- **Exercise library.** About 50 common lifts, editable. Each is tagged with muscle group, compound or isolation, equipment, and its **weight jump**: 2.5 kg for barbells and cables, 7 kg for pin-loaded machines like the lat pulldown and machine chest press. Dumbbells follow your **rack** (2.5–25 kg in 2.5 kg steps, editable in Settings).
- **Next workout.** The app suggests the next day in your rotation. A rest day in the rotation uses up one calendar day: after Legs on Monday, Tuesday shows "Rest day" and Wednesday shows Push. You can always start a different day or an empty workout.
- **Workout screen.** Each set row shows a "Previous" column with last session's weight × reps for that set, from any day type. Those values are pre-filled, so matching last time is one tap on ✓. Tap any cell to open the set editor: big −/+ steppers (weight steps follow the exercise's jump or the dumbbell rack), reps, RIR 0–4+, and a warm-up toggle. You can add, swap, skip, reorder and remove exercises, and add a note per exercise.
- **Overload hint (double progression).** If every working set last time hit the top of the rep range at or above target RIR, the app suggests the next weight up, with one tap to apply it. Otherwise it suggests adding reps. At 25 kg (the top of your rack) it tells you to add reps or slow the tempo instead.
- **PRs.** You get an instant 🏆 toast for the heaviest weight, best estimated 1RM (Epley: weight × (1 + reps/30)) or most reps at a weight you've lifted before. There are no PR badges in the first session of an exercise, because every set would count. Warm-up sets never count.
- **Autosave.** Every tap is saved to the phone straight away. If the app is closed or refreshed mid-workout, it reopens straight into the workout, with the timer intact.
- **Finish summary.** Duration, working sets, volume, PRs, and average rest per exercise and per session.
- **Rest timer.** It starts automatically when you complete a set, using that exercise's rest. After the last set of an exercise it uses the longer "moving to the next exercise" rest (default 3:00). It has −15s, Skip and +15s buttons, a big sticky countdown (tap it to shrink it), a mini-bar on other screens, and a quick RIR picker for the set you just did. After rest ends it counts up in green, so you can see how long you over-rested.
- **Actual rest tracking.** The time between completed sets is measured separately from the timer and stored on each set (`rest_before_s`). Gaps between different exercises are flagged and left out of "working rest" averages, as are gaps over 10 minutes.

## The dashboard (Phase 3)

Home, top to bottom:

1. **Today.** Your next workout in the rotation, with exercise count and when you last did it. **Start** is one tap; **Change** picks another day or an empty workout. On a planned rest day it says so, with a **Train anyway** button.
2. **Consistency.** This week's sessions against your target (ring), your **streak**, and sessions this month, above a **month calendar**. Each training day shows its day-type icon on its colour, and today is outlined. Tap a day to open that workout (if you trained twice, you choose which). Swipe or use the arrows to change month; **Today** jumps back. The card header opens **History** at the same month.
   - *Streak* = consecutive weeks (Mon–Sun) in which you hit your weekly target. The current week only adds to it once you hit the target, and it never breaks the streak while it's still in progress.
3. **Recent PRs.** Your latest records with how much you beat the previous one (▲ 2.5 kg, ▲ 1 rep). Tap one to open that workout; **All** lists every record by month. Records are recalculated from your full history, so deleting a workout keeps them correct.
4. **Trends**, with one time-range control (1M / 3M / 6M / 1Y / All) for both cards:
   - **Strength.** Estimated 1RM (Epley) per session for the lift you pick (most-trained first), with the change over the period. Tap or drag on the chart to see a session; tap the tooltip to open it.
   - **Rest.** Average working rest (between sets of the same exercise) and how it compares with the period before, one column per session, plus per-exercise averages.

**History** has the same calendar, full size, with the month's totals and every session in that month.

## iPhone: what works and what doesn't

The app is built around what iOS allows a web app to do. Here's the honest version:

| | Works? | Notes |
|---|---|---|
| Timer stays accurate when the screen locks or you switch apps | ✅ | It stores an end time instead of counting ticks, so it's correct as soon as you come back. |
| Beep when rest ends, app open and screen on | ✅ | This is the reliable setup. **Keep screen on** (Wake Lock) is on by default during workouts. |
| Beep doesn't stop Spotify | ✅ (test it) | The app uses `navigator.audioSession`. "Duck music" (`transient`) briefly lowers Spotify; "Mix with music" (`ambient`) plays over it. Use **Settings → Test beep** with Spotify playing to choose one. The ring/silent switch may mute the beep. |
| Beep or notification with the **screen locked** | ❌ | iOS pauses web apps when the screen locks. Web apps can't schedule local notifications, and real push would need a server that can sign push messages, which a free Apps Script can't do. |
| Notification while you're briefly in another app | ⚠️ | Only in the installed app, after you tap **Allow notifications** in Settings. iOS pauses background web apps within seconds, so treat it as a bonus. |
| Vibration | ❌ | Safari on iOS doesn't support the Vibration API. It works on Android. |

**Recommended gym setup:** install the app to your home screen, start the workout, and leave the app open on screen with Spotify playing in the background. Control music from Control Center or the lock-screen widget without leaving the app. Keep the phone's ringer on if you want to hear the beep.

## Install on your iPhone

1. Open the site in **Safari** (other browsers on iOS can't install web apps with full features).
2. Tap **Share** → **Add to Home Screen** → **Add**.
3. Open it from the home screen icon. It now runs full screen and works offline.
4. In **Settings**, tap **Test beep** (with Spotify playing) and **Allow notifications**.

> The installed app has **its own storage**, separate from Safari's. Data you log in Safari won't appear in the installed app. Install first, then start logging.

## Where your data lives

Everything is stored on your phone in IndexedDB, and nothing waits on the network. The app asks iOS to protect the data from automatic clearing, and home-screen apps aren't subject to Safari's 7-day storage cleanup. **Deleting the app from the home screen deletes its data**, so set up sync (below) or export a backup now and then.

## Sync and backup (Phase 2)

- **Google Sheets sync (recommended).** Your phone stays the source of truth. Changes are queued and uploaded in the background, so retries are safe and never duplicate rows. Sync runs on launch, when you return to the app, when you come back online, every 5 minutes, and a few seconds after you finish a workout. **It never runs during a workout.** A workout in progress is uploaded when you finish it.
- **Status.** The chip at the top of Home shows ☁️ Synced / N waiting / Offline / ⚠️ Sync problem. Settings → Google Sheets sync has **Sync now** and the details.
- **New phone or lost data.** Install the app, go to Settings, paste the URL and token, tap **Connect**. Everything is downloaded back. Seed exercises and presets never duplicate.
- **Conflicts.** For each record the **newest** `updated_at` wins. If you edit the same thing on two devices while offline, the later edit wins.
- **Backup file.** Settings → **Export backup** saves one JSON file with everything (on iPhone, choose **Save to Files** in the share sheet). **Import backup…** merges a file into the phone: the newest copy of each record wins, so importing never loses newer data. Imported records are also uploaded to the Sheet. The backup never contains your sync URL or token.
- **Backup reminder.** If you have 3 or more workouts, no sync and no backup in 14 days, Home shows a small reminder (you can snooze it).
- **Advanced** (Settings → Google Sheets sync → Advanced): re-download everything from the Sheet, re-upload everything to it, or disconnect. Connecting to a *different* Sheet automatically re-uploads everything to it.

---

## Local development

You need [Node.js](https://nodejs.org) 20 or newer.

```bash
npm install
```

```bash
npm run dev
```

Open the URL it prints (`http://localhost:5173/gym-bulking-tracker/`). `--host` is on, so you can also open the "Network" URL on your phone on the same Wi-Fi. Note that the service worker, notifications and wake lock need HTTPS, so test those on the deployed site.

Other commands:

```bash
npm test          # training logic, plus sync/backup tested against the real Apps Script code
```

```bash
npm run build     # type-check + production build into dist/
```

```bash
npm run preview   # serve the production build locally
```

### Project layout

```
src/
  db/schema.ts        data model (all tables, typed)
  db/db.ts            IndexedDB (Dexie) + put/patch/delete helpers that queue sync
  db/seed.ts          starter exercises, day types and preset splits
  lib/logic.ts        pure logic: Epley, double progression, PRs, rotation, formatting
  state/settings.ts   settings with defaults
  state/workout.ts    start/log/finish workouts, previous sets, rest tracking
  state/timer.ts      end-time-based rest timer
  state/device.ts     beep (Web Audio + audioSession), wake lock, notifications
  lib/stats.ts        dashboard maths: calendar grid, streak, PR replay, e1RM series, rest stats
  screens/            Home (dashboard), Workout, History/Summary/PRs, Plan editors, Settings
  components/charts   small SVG line + column charts with tap-to-inspect
  components/         sheet, stepper, RIR picker, timer panel, exercise picker
  sync/sync.ts        push/pull engine, connect, automatic sync
  sync/merge.ts       newest-wins merging (used by pull and import)
  sync/backup.ts      JSON export/import
apps-script/Code.gs   Google Sheets API
tests/                vitest tests (sync tests run the real Code.gs against a fake Sheets API)
```

---

## Deploy to GitHub Pages

> **Private repo caveat.** On a free GitHub account, **GitHub Pages only works for public repositories**. Pages from a private repo needs a paid plan (GitHub Pro). You have two free options:
>
> - **A: Make the repo public (recommended).** The code contains no secrets and no data. Your workouts live on your phone and in your own private Google Sheet. The Sheet URL and token are typed into the app and stored only on your phone.
> - **B: Keep the repo private and host on Cloudflare Pages (free).** Connect the repo in Cloudflare → Workers & Pages → Create → Pages → Connect to Git. Build command: `npm run build`. Output: `dist`. Environment variable: `BASE_PATH=/`.

For option A:

1. Create the repo on GitHub, e.g. `gym-bulking-tracker`. Don't add a README (this project has one).
2. Push this folder:

   ```bash
   git remote add origin https://github.com/<your-username>/gym-bulking-tracker.git
   ```

   ```bash
   git push -u origin main
   ```

3. On GitHub, go to **Settings → Pages → Build and deployment → Source: GitHub Actions**.
4. The workflow in `.github/workflows/deploy.yml` runs the tests, builds and deploys on every push to `main`. Watch it under the **Actions** tab.
5. Your app is at `https://<your-username>.github.io/gym-bulking-tracker/`.

If you name the repo something else, nothing needs changing: the workflow uses the repo name as the base path.

**Updating:** push to `main`. The installed app picks up the new version the next time it's opened with a connection. It may take a second launch.

---

## Google Sheets sync (Apps Script)

### Why a token?

An Apps Script web app deployed with access set to "Anyone" accepts requests from anyone who knows the URL. The script rejects every request that doesn't carry your secret token. Requests are sent as `text/plain` POSTs, which avoids a CORS preflight that Apps Script can't answer.

### Setup (about 5 minutes)

1. **Create the sheet.** Go to [sheets.new](https://sheets.new) and name it e.g. *Gym Tracker Data*.
2. **Open the script editor:** **Extensions → Apps Script**.
3. **Paste the script.** Delete the sample code in `Code.gs`, then paste all of [`apps-script/Code.gs`](apps-script/Code.gs). Click 💾 **Save**.
4. **Create the tabs and your token.** In the toolbar's function dropdown, choose **`setup`** and click **▶ Run**.
   - Google asks for permission: **Review permissions** → choose your account → **Advanced** → **Go to (project name) (unsafe)** → **Allow**. ("Unsafe" just means Google hasn't reviewed your own script.)
   - Open **Execution log** (bottom panel) and copy the long **API token**.
   - Back in the sheet you'll see one tab per entity (`exercises`, `sets`, `workouts`, …).
5. **Deploy it as a web app:** **Deploy → New deployment** → ⚙️ **Select type → Web app**.
   - Description: `v1`
   - Execute as: **Me**
   - Who has access: **Anyone**
   - Click **Deploy** and copy the **Web app URL** (ends in `/exec`).
6. **Connect the app:** in the app, go to **Settings → Google Sheets sync**, paste the **URL** and the **token**, and tap **Connect**. It tests the connection, saves it and runs the first sync. After a few seconds the tabs in your Sheet fill up.

**Check it works:** open the Web app URL in a browser. You should see `{"ok":true,"message":"Gym Bulking Tracker API is running. Use POST."}`.

**If the app says your script is “out of date”:** paste the latest `apps-script/Code.gs` over the old one, then do the “edit the script later” steps below (a *new version* of the same deployment).

**If you edit the script later:** use **Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy**. This keeps the same URL. ("New deployment" would create a different URL.)

**If your token leaks:** run **`rotateToken`** from the editor, then paste the new token into the app.

### How sync works

- Each change is pushed as an upsert keyed by the phone-generated `id`, so retrying is always safe.
- Last write wins, compared on `updated_at`. Deletions are kept as rows with `deleted = 1`.
- Each row gets a `_synced_at` server timestamp, and the app pulls "rows changed since X". Restoring onto a new phone is a full pull.
- Only changed rows are written, and everything is stored as plain text, so Sheets can't turn dates or notes into other types.
- The script keeps any extra columns you add to the right of the data.
- Arrays such as split rotations and PR types are stored as JSON text in the cell.
- Please don't reorder, rename or delete the existing columns, and don't edit rows by hand while the app might sync (your edit would be overwritten by the phone's copy if the phone's `updated_at` is newer). Adding your own columns to the right is fine.

---

## Data model

Every synced record has `id` (uuid), `created_at`, `updated_at` (ISO, UTC) and `deleted` (0/1). Each table is one tab in the Sheet.

| Table | Fields |
|---|---|
| exercises | name, muscle_group, mechanic (compound/isolation), equipment, increment_kg, default_rest_s, notes |
| day_types | name, icon, color, transition_rest_s |
| template_exercises | day_type_id, exercise_id, position, target_sets, rep_min, rep_max, target_rir, rest_s |
| splits | name, rotation (day_type ids and `"rest"`, in order) |
| workouts | day_type_id, split_id, rotation_index, name, icon, color, started_at, ended_at, status (active/done), notes |
| workout_exercises | workout_id, exercise_id, position, targets (copied from the template), note, skipped, swapped_from_id |
| sets | workout_id, workout_exercise_id, exercise_id, set_number, is_warmup, weight_kg, reps, rir, completed_at, rest_before_s, rest_is_transition, pr_types, note |
| bodyweights | date, weight_kg, sleep_h *(Phase 4)* |
| measurements | date, site, value_cm *(Phase 4)* |
| photos | date, pose, drive_file_id, width, height *(Phase 5)* |
| foods | name, basis (per_100g/per_serving), serving_g, serving_label, kcal, protein_g, carbs_g, fat_g *(Phase 4)* |
| saved_meals | name, items [{food_id, amount, unit}] *(Phase 4)* |
| meals | date, name, started_at, finished_at, saved_meal_id: one eating occasion *(Phase 4)* |
| food_logs | date, meal_id, food_id, amount, unit, kcal, protein_g, carbs_g, fat_g (copied at log time) *(Phase 4)* |
| settings | one row per setting: id = key, value (JSON) |

Local only (never synced or exported): `outbox` (pending changes), `local` (rest timer state, the sync URL and token, sync cursor).

Seed records (starter exercises, presets) use fixed ids like `ex-barbell-bench-press` and a year-2000 timestamp, so restoring from the Sheet never duplicates them and your edits always win.

## Troubleshooting

- **No beep:** tap **Test beep** once after opening the app (iOS needs a tap before audio can play). Check the ringer switch and volume. Try the other beep mode.
- **Screen turned off mid-workout:** check that **Keep screen on** is enabled (workout ⋯ menu or Settings). iOS drops the lock when you leave the app, and the app takes it back when you return.
- **Old version after an update:** close the app fully (swipe it away) and reopen it.
- **Data missing after installing:** the home-screen app's storage is separate from Safari's (see above).
- **“Wrong token”:** copy the token again from the Apps Script **Execution log** after running `setup`. Or run `rotateToken` and use the new one.
- **“Unexpected reply from Google”:** the web app isn't deployed with **Who has access: Anyone**, or you used the `/dev` URL. Redeploy and use the `/exec` URL.
- **“Couldn't reach Google”:** you're offline, or the URL is wrong. The app keeps working and will retry.
- **Sync says “N waiting” and doesn't go down:** tap **Sync now** in Settings and read the message. Nothing is lost: changes stay queued until Google confirms them.

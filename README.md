# Daily Organoleptic Report v15.2: upload and tablet checklist

## What to upload to GitHub (repository root)

| File | Change from the version on GitHub |
|---|---|
| `index.html` | Replaced (v15.2) |
| `sw.js` | Replaced (cache `daily-organoleptic-report-v15.2`) |
| `manifest.json` | Replaced (landscape, v15.2 description; same `id` / `start_url` / `scope`) |
| `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` | Unchanged; upload anyway so the set is complete |
| `extras/` (`Code.gs` qc-v9, `FONT-LICENSES.txt`), `docs/`, `README.md`, `CHANGELOG.md` | Reference only. The tablet never downloads them |

Upload `index.html`, `sw.js` and `manifest.json` **in the same commit**. Uploading `sw.js` alone would give the tablet a v15 worker serving the old page until the next reload.

## Before uploading (2 minutes)

1. **On the tablet, make sure `Queue` shows nothing.** Tap **Sync now** if a Queue chip is visible, and wait for it to disappear. The update keeps queued records anyway (tested from v10), but an empty queue removes any doubt. The version currently on GitHub was not available to me for testing; the zip labelled "v10-2" was identical to v10.
2. **Open the Apps Script `/exec` URL in a browser.** Expect `"version":"qc-v9"` and `"ready":true`. If the version is not qc-v9, deploy `extras/Code.gs` first (Manage deployments → Edit → New version, so the URL stays the same). qc-v9 stops a retried record from being written twice.

## After uploading (on the Samsung Tab A9+)

1. **Update the app.** Open the installed app with internet on. A banner "A new version is available" appears; tap **Reload**. Or close and reopen the app.
2. **Confirm the version.** Right after opening the app, tap the **Online** chip. The diagnostics (last 8 events) include `app-start: v15.2`.
3. **Run the speed and heat check.** Open `<your GitHub Pages URL>/index.html?perf=1` once and note the overlay values: `fps`, `dots`, `q`, `frost`. Look again after 15–30 minutes of normal use. Expected: q stays 1.0, and frost is `real` (frosted glass) or `tint` (lighter glass on slower devices; nothing else changes).
4. **Check Chrome.** Open `chrome://version`. Any current Chrome is fine. Chrome 105 or newer is needed for the card colours and popover layering (`:has()` rules).
5. **Test the mic offline.** Turn on airplane mode and tap the mic. If Chrome's voice needs internet you will see a mic error. Typing Brix and pH still works offline, and records queue until the network returns.
6. **Check rotation.** The app now opens in landscape even if the tablet's auto-rotate is on.

## Undoing the update

Re-upload the previous `index.html`, `sw.js` and `manifest.json`, with a **new cache name** in that `sw.js` (for example `daily-organoleptic-report-v15-rollback`). The tablet only swaps versions when the cache name changes.

## Operator quick guide (what is new)

- **Amber spec line / Pass (tol):** inside tolerance, saved automatically.
- **Red spec line / Out · Hold:** beyond tolerance, nothing is saved.
  1. Check the reading.
  2. Tap **Confirm reading** if it is right. To change it, use **Edit value** (number keypad) or the mic.
  3. Complete the fault comment and the corrective action / HOLD.
  4. Tap **Log QC Result**.
- **Spoken spoilage words:** saying "spoilage", "spoiled" or "early stage" works like "fermented". The result is HOLD (RED) and needs a corrective action.
- **pH:** optional. Products without a pH limit show a greyed pH box.
- **Say products like this:**
  - Fresh Juices: "mango juice"
  - Smoothies: "mango smoothie" (or just "mango")
  - Shots: "ginger shot"
  - Thrill: "Thrill orange"
  - Private Labelling: brand first, e.g. "Carrefour orange"
- **Verify category (amber):** what you said doesn't fit the selected category. Tap **Keep** if the category is right, or **Switch** to move the reading to the suggested product. Nothing saves until you tap.
- **"Re-send N unconfirmed" (orange, footer):** appears after the backend is updated. Tap it once to send entries the old backend never stored.
- **"Backend script is out of date":** the Google Apps Script must be updated (see `extras/Code.gs`). Your entries are safe in the queue meanwhile.
- **Two product buttons:** more than one product in this category matches the word you said. Tap the right one.

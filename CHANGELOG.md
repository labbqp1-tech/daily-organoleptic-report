# Daily Organoleptic Report — CHANGELOG

## v15.2 (23 Nov 2026): category-first matching + "Verify category"

### Data-loss fix (found 23 Nov, 17:30): entries not reaching the Google Sheet
- **Finding:** the live Apps Script at `/exec` is an **old script, not qc-v9**. Its `doGet` reports the headers `Shift, Operator` with no `QA_Inspector` or `Record_ID`, and its last row is 7. It answers a POST with a plain `{"status":"success"}` but writes nothing.
- **Why the tablet showed "synced":** since v12 the app accepted that plain "success", marked the entries **synced** and removed them from the queue. The records survive only in the tablet's last-30 "Recently added" list.
- **Fix 1, no silent loss:** a record counts as sent only when the server confirms it (`accepted_ids`, qc-v9). Any other "success" keeps the records queued and shows *"Backend script is out of date (no qc-v9 confirmation). Records are kept on this tablet."*
- **Fix 2, recovery:**
  - Once the backend has confirmed a record (qc-v9 deployed), a footer button **"Re-send N unconfirmed"** appears.
  - It rebuilds each entry the old backend claimed but never stored, using the tablet's Recent list, and re-queues it. The Record_ID, product, category, Brix, pH, specs, statuses, overall status, remark and timestamp are the originals.
  - `QA_Inspector` is the inspector entered at recovery time. `Raw_Transcript` is marked `[Recovered from tablet log …]`, because the spoken transcript was not stored.
  - qc-v9 skips Record_IDs already in the sheet, so re-sending cannot duplicate.
- **Tested end to end:** the bug was reproduced; v15.2 keeps the queue against the old backend; recovery wrote all lost entries field-for-field; a second tap wrote nothing.
- **Backend still required:** deploy `extras/Code.gs` (qc-v9) as a new version of the same deployment, then run `migrateHeaders()` once. Without it, v15.2 keeps everything queued on the tablet, which is safe but not synced.

Includes the v15.1 smoothie fix (v15.1 was built but never deployed). `#logic` and `#ui` only. No SKU, limit, category, payload key or `Code.gs` change.

**Problem seen on the tablet**
- In Smoothies, "mango smootty bricks 17.1" showed "Did you mean MANGO JUICE (FRESH JUICES)?" instead of selecting MANGO SMOOTHIE.
- **Cause:** "smoothie" was a required word, "juice" was ignored, and a misheard "smootty" left the smoothie at half a match.

**How product matching works now (agreed with Akhil, 23 Nov)**
1. **Only the selected category is searched.** Cross-category "Did you mean" suggestions are gone.
2. **The main word is enough.** "mango" in Smoothies gives MANGO SMOOTHIE, and "ginger" in Shots gives GINGER SHOT.
   - The type words juice / smoothie / shot / water / milk are optional.
   - Misheard forms are accepted: "smootty", "smoothy", "juices"…
   - 163 of 179 single product words pick one product directly.
3. **Look-alikes inside the same category** (16 words, e.g. "apple" in Fresh Juices = Green Apple / Apple Celery Ginger) show tap-to-pick buttons. Nothing is saved until one is tapped.
4. **Verify category.** An amber message with **Keep \<category\>** and **Switch to \<category\> · \<product\>** buttons appears when the spoken words contradict the selected category:
   - **Type word:** "mango **juice**" while in Smoothies; "mango **smoothie**" while in Fresh Juices.
   - **Brand word:** "**Carrefour** orange" while in Fresh Juices (also Thrill, EKFC, ViVA, ADNOC, Talabat, Etihad, Calo, Ramadan).
   - **Convention:** Fresh Juices items are said "\<fruit\> juice", and Thrill items "Thrill \<product\>". So "orange juice" without "Thrill" while in Thrill asks "is this a Fresh Juices item?". This applies only when Fresh Juices has that exact product.
   - **EKFC is exempt**, at the owner's request: operators handle EKFC look-alikes manually.
   - **Voice never switches the category. Only the operator's tap does.** Switch keeps the spoken readings and remark, and moves between Barakat and Private Labelling when needed.
   - **While the message is shown:** nothing auto-saves, Log QC Result is locked, and the Confirm reading row and HOLD row stay hidden. After Keep or Switch, the reading is judged against the chosen product with the normal rules (auto-save if in spec; Confirm + corrective action if out of tolerance).
   - Type words are read only from the product part of the sentence, before the first reading, so "…watery like juice" in a remark does not trigger it.
5. Buttons are 44 px; no page scroll at 1280×800 or 1280×720.

**Catalogue audit (138 products, 12 categories)**
- **Placement:** every product is in the category of its source CSV. EKFC (9) and Talabat (2) smoothies and Talabat's GREEN JUICE SHOT are customer lines, and correctly stay there.
- **Own category:** 311/311 spoken variants pick the right product (was 265/311).
  - **Main word alone:** 163 direct, 16 look-alike buttons, 0 false category messages.
  - **Natural type or brand word in the right category:** 271/276 with no message. The 5 that do get one are Thrill items with an identical Fresh Juices product said *without* "Thrill", which is the agreed convention.
- **Wrong category:** 690 cases (product said with its type or brand word while another category is selected).
  - **Verify message:** 666. Switch offers the exact intended product in 661.
  - **Silent pick:** 17, all EKFC (agreed manual).
  - **"Not found":** the rest.

**Verification**

| Suite | Result |
|---|---|
| Category / verify UI | 14/14 |
| v15 behaviour cases | 27/27 |
| Smoothie scenarios | 9/9 |
| v12 regression | 14/15 (the intended Confirm lock) |
| Service worker and upgrade | 11/11 |
| Two-window lock | 1 send per record |
| v15 → v15.2 update | queued record kept and synced |

**Cache:** `daily-organoleptic-report-v15.2`.

## v15 (23 Nov 2026)

Built from v14 "Horizon". The approved design is unchanged except where listed under **Visible changes**. The Google Sheet contract is unchanged: same 17 payload keys, same `Record_ID` format (`QC-YYYYMMDDhhmmss-<32 hex>`), same `extras/Code.gs` (qc-v9).

### Owner decisions implemented
| Decision | v15 behaviour |
|---|---|
| TOL (within tolerance) is acceptable and may auto-save | Unchanged: it auto-saves. Now also marked **amber** on the spec line under the product name, as well as in the Verdict box. |
| Out of tolerance (Brix, or pH where a limit exists) needs operator review | RED never auto-saves (unchanged). New **Confirm reading** and **Edit value** buttons in the Verdict column. **Log QC Result stays disabled until Confirm is tapped.** Any change to the product, Brix or pH cancels the confirmation. Re-speak with the mic. The remark plus corrective action / HOLD rule is unchanged. |
| pH is optional | Unchanged: Brix then silence auto-saves with "Within limit, acceptable taste and Brix". |
| Ignore pH where there is no pH limit | The pH box is greyed and labelled "no limit" for those products (72 of 138). It is never flagged. |
| Spoilage words must stop auto-save | `spoilage / spoiled / spoilt / spoiling / early stage` added to the HOLD words, alongside fermentation. They force RED plus a corrective action. |
| Acidity | Ignored entirely (no change). |
| Tablet only, landscape | `manifest.json` `"orientation": "landscape"`. Phone layout not pursued. |

### Data and voice fixes (`#logic`, `#ui`)
- **Remark prefix:** the system prefix ("Brix too high — ") now follows the reading. Correcting a RED value to in-spec removes the prefix and keeps the operator's own words. Going out of tolerance again puts it back. Before, a GREEN record could be saved as "Brix too high — sour".
- **Misheard labels and decimals:**
  - "breaks / bricks / prix / briggs" become Brix, and "page / beach / peach / pee h" become pH. Both apply only when a number comes **after** the word.
  - "11,2" becomes 11.2.
  - "ph 3-8" or "ph 3/8" becomes 3.8, only straight after a label.
  - "point to / for / ate / won / tree / free" are read as digits, only after "point".
- **Split product words:** "beat root", "pome granate", "water melon", "pine apple" and "grape fruit" now match the joined product. The split parts no longer leak into the remark. Talabat "What a Melon" still matches.
- **Reading order (bug present since v12):** "orange juice 11.2 ph 3.8" used to log **Brix 3.8 / pH 11.2**. It now logs Brix 11.2 / pH 3.8. The spoken styles "11.2 brix 3.8 ph" and "ph 3.8 brix 11.2" are unchanged.
- **Product suggestions:** confirming a "Did you mean …" suggestion no longer clears unrelated reading warnings.
- **No double sending:** only one window can send at a time (Web Locks). The installed app plus a Chrome tab could previously send the same rows twice.
- **One script URL:** the sync indicator reads the URL from `CONFIG.WEB_APP_URL`. The second hard-coded copy is gone.
- The diagnostics log says `app-start v15`.

### Service worker (`sw.js`, cache `daily-organoleptic-report-v15`)
- **Safer installs:** if `./` or `index.html` fails to download (for example a broken upload), the install is abandoned. The old version and its offline copy stay in use. Previously the old copy could be deleted.
- **Weak Wi-Fi:** the saved copy is shown after **3 s** instead of waiting indefinitely. The network answer still refreshes the saved copy in the background.
- **Host errors:** a host error (404 / 5xx) on the page shows the saved copy instead of the error page.
- **Fresh copies:** files are installed bypassing the browser's HTTP cache (`cache: 'reload'`).
- **Single page copy:** `?perf=1` and other query strings no longer save extra 240 KB copies of the page.

### Page and status
- **Encoding:** `<meta charset="utf-8">` is now the first line of `<head>` (it was at byte 4,753). Spec text with "–" can no longer be mis-decoded into the Sheet.
- **"Synced" label:** "· synced" shows only when storage is healthy, nothing is queued and the last sync succeeded.
- **Sync now:** hidden when the queue is 0, as v12 intended.
- **✓ animation:** fires on every save. Before, it stopped after 30 records.
- **"Last today":** scoped to the product's own category. ORANGE JUICE in Fresh Juices no longer shows EKFC or Carrefour readings.
- **Popover close button:** now 44×44 px. The product popover closes on a category change, a mode change and Clear.

### Visible changes
- **Rings:** the globe's orbit rings and its thin circle outline are removed. The dots and wordmark are unchanged.
- **Spec line colour:** amber (TOL) or red (out of tolerance) on the line under the product name.
- **Confirm reading / Edit value:** these replace the small variance line while the result is out of tolerance. The variance text moves into the red notice, so the card does not grow.
- **No-limit pH box:** greyed for products without a pH limit.
- **Counter label:** "Last 30" before Logged / Pass / Hold, because the counters cover the last 30 records on this device.
- **Red notice:** narrower, so it no longer covers the category buttons.

### Performance (no visual change)
- **Idle frame rate:** the idle globe is capped at about 60 fps (45 fps on the A9+'s 90 Hz screen) to reduce heat. The mic, loading, ✓ and swarm stages run at full rate.
- **Dot count:** under load the globe sheds at most 20% of its dots (it was 50%), and wins them back when frames are fast again. Dot sharpness never changes: the canvas always draws at native pixel density.
- **Frost check:** the frosted-glass check runs after the fonts load, then re-checks once at 45 s. The re-check can only switch to tint.
- **Grain:** the grain is a static image with normal blending. The two full-screen "overlay" blend layers over the animated globe are gone. The skupop popover no longer stacks a second backdrop blur.
- **Keyboard guard:** the globe is not rebuilt if the on-screen keyboard shrinks the window while typing.

### Verification (headless Chrome 1280×800 and 1280×720, mock speech recogniser; not tablet hardware)
- **v12-vs-v15 regression:** 14 of 15 checks identical. The one intended difference: on RED, Log stays disabled until the reading is confirmed. Payload keys, payload values, `Record_ID` format and Sheet text are identical.
- **New behaviour:** 27/27 pass (TOL auto-save, Brix-only save, RED confirm/edit, prefix strip and restore, pH out-of-tolerance, pH TOL, HOLD words, misheard speech, compound words, "Last today" scope, no-limit pH, sync states, ✓ after 30+ records, popover, payload keys, no JS errors).
- **Service worker and upgrade:** 11/11 pass.
  - A v10 record queued offline survives the v10→v15 update and syncs.
  - A broken upload is refused and the old version keeps working.
  - A hanging network shows the saved copy in 3.2 s.
  - Offline reload works and the queue auto-flushes when back online.
  - No query-string copies are cached.
  - The manifest identity is unchanged.
- **Two windows:** each record sent once with the lock (twice without it).
- **Layout:** no page scroll at 1280×800 and 1280×720 in idle, TOL and RED. No touch target below 44 px. Card geometry on RED is identical to v14.

## v14 (22 Nov 2026)
"Horizon" design. The `#logic` and `#ui` scripts were byte-identical to v12.

/**
 * Daily Organoleptic Report — Apps Script Web App v9 (used unchanged by app v10).
 * Header-name mapping, QA_Inspector only, Shift/Operator explicitly ignored.
 * Record_ID idempotency is checked across the complete log under a script lock.
 * This source must be installed and deployed in Apps Script before live use.
 * Keep the existing deployment: Manage deployments > Edit > New version.
 */
var SHEET_NAME = 'QC_Logs';
// Headers the app sends (17). 'Shift' is intentionally absent.
var REQUIRED = ['Timestamp','Date','QA_Inspector','Batch_Code','Stream','Sub_Category','SKU_Name','Measured_Brix','Brix_Spec','Brix_Status',
                'Measured_pH','pH_Spec','pH_Status','Overall_Status','Organoleptic_Remark','Raw_Transcript','Record_ID'];
var TEXT_COLS = { Timestamp: 1, Date: 1, Batch_Code: 1, QA_Inspector: 1, Record_ID: 1 };

// Read-only handshake (informational). App v10 does NOT gate sync on it; open <exec URL>?action=health in a browser to check header readiness.
function doGet() {
  try {
    var sh = SpreadsheetApp.getActive().getSheetByName(SHEET_NAME);
    if (!sh || !sh.getLastColumn()) return out_({ version: 'qc-v9', ready: false, message: 'QC_Logs headers not found' });
    var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(function (h) { return String(h).trim(); });
    var missing = REQUIRED.filter(function (h) { return headers.indexOf(h) < 0; });
    var duplicates = headers.filter(function (h, i) { return h && headers.indexOf(h) !== i; });
    return out_({ version: 'qc-v9', ready: !missing.length && !duplicates.length, missing: missing, duplicate_headers: duplicates });
  } catch (err) { return out_({ version: 'qc-v9', ready: false, message: String(err) }); }
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(25000);
    var body = JSON.parse(e.postData.contents);
    var records = body && body.records;
    if (!Array.isArray(records) || !records.length || records.length > 100) {
      return out_({ status: 'error', message: 'Expected 1–100 records. Nothing was written.' });
    }
    // Validate the whole batch BEFORE writing any rows.
    for (var v = 0; v < records.length; v++) {
      var rec = records[v];
      if (!rec || typeof rec !== 'object' || Array.isArray(rec) ||
          typeof rec.Record_ID !== 'string' || !rec.Record_ID.trim() ||
          typeof rec.QA_Inspector !== 'string' || !rec.QA_Inspector.trim() ||
          typeof rec.Timestamp !== 'string' || !rec.Timestamp.trim()) {
        return out_({ status: 'error', message: 'Record_ID, QA_Inspector and Timestamp are required. Nothing was written.' });
      }
      for (var k = 0; k < 2; k++) {
        var key = k ? 'Measured_pH' : 'Measured_Brix', max = k ? 14 : 50, value = rec[key];
        if (value !== '' && value !== null && value !== undefined &&
            (typeof value !== 'number' || !isFinite(value) || value < 0 || value > max)) {
          return out_({ status: 'error', message: key + ' must be between 0 and ' + max + '. Nothing was written.' });
        }
      }
    }
    var sh = SpreadsheetApp.getActive().getSheetByName(SHEET_NAME);
    if (!sh) return out_({ status: 'error', message: 'Sheet tab not found: ' + SHEET_NAME });

    var lastCol = sh.getLastColumn();
    var headers = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); });
    var col = Object.create(null), duplicateHeaders = [];
    headers.forEach(function (h, i) { if (h && h in col) duplicateHeaders.push(h); else if (h) col[h] = i; });
    if (duplicateHeaders.length) return out_({ status: 'error', message: 'Duplicate headers: ' + duplicateHeaders.join(', ') + '. Nothing was written.' });
    var missing = REQUIRED.filter(function (h) { return !(h in col); });
    if (missing.length) return out_({ status: 'error', message: 'Missing header(s) in row 1: ' + missing.join(', ') + '. Nothing was written.' });

    // Full-ID scan: retries remain safe even after more than 3,000 later rows.
    var lastRow = sh.getLastRow(), seen = Object.create(null);
    if (lastRow > 1) {
      sh.getRange(2, col['Record_ID'] + 1, lastRow - 1, 1).getValues().forEach(function (r) { if (r[0] !== '') seen[String(r[0])] = 1; });
    }

    var rows = [], skipped = 0, accepted = [];
    records.forEach(function (rec) {
      var idKey = rec.Record_ID;
      accepted.push(idKey);
      if (seen[idKey]) { skipped++; return; }
      seen[idKey] = 1;
      var row = new Array(headers.length).fill('');
      headers.forEach(function (h, i) {
        if (h === 'Shift' || h === 'Operator') return; // Never copy legacy fields, even if supplied.
        if (REQUIRED.indexOf(h) >= 0 && Object.prototype.hasOwnProperty.call(rec, h)) {
          var value = rec[h];
          // Sheet cells must contain values, not nested objects or formulas.
          row[i] = value === null || value === undefined ? '' :
            (typeof value === 'string' ? (/^[=+@-]/.test(value) ? "'" + value : value) :
              (typeof value === 'number' || typeof value === 'boolean' ? value : JSON.stringify(value)));
        }
      });
      rows.push(row);
    });

    if (rows.length) {
      var start = sh.getLastRow() + 1;
      var range = sh.getRange(start, 1, rows.length, headers.length);
      headers.forEach(function (h, i) { if (TEXT_COLS[h]) sh.getRange(start, i + 1, rows.length, 1).setNumberFormat('@'); });
      range.setValues(rows);
    }
    return out_({ status: 'success', written: rows.length, skipped: skipped, accepted_ids: accepted, version: 'qc-v9' });
  } catch (err) {
    return out_({ status: 'error', message: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (e2) {}
  }
}

function out_(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }

/**
 * ONE-TIME helper (run manually from the editor, on the copy first):
 *  - renames header "Operator" -> "QA_Inspector"
 *  - appends header "Record_ID" if missing
 *  - leaves the "Shift" column and all old data untouched (new rows just leave Shift blank)
 */
function migrateHeaders() {
  var sh = SpreadsheetApp.getActive().getSheetByName(SHEET_NAME);
  var lastCol = sh.getLastColumn();
  var h = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (x) { return String(x).trim(); });
  var iOp = h.indexOf('Operator');
  if (iOp >= 0 && h.indexOf('QA_Inspector') < 0) sh.getRange(1, iOp + 1).setValue('QA_Inspector');
  if (h.indexOf('Record_ID') < 0) sh.getRange(1, lastCol + 1).setValue('Record_ID');
  Logger.log('Headers now: ' + sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].join(' | '));
}

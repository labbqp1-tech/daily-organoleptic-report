/**
 * Daily Organoleptic Report — Apps Script Web App qc-v9.2 (app v15.3).
 * qc-v9.2: Rhino-safe (no Array.fill; the project uses the legacy runtime). qc-v9.1: opens the Sheet by ID, so it works in the standalone project 'Barakat_Lab_QC_Logger'.
 * Header-name mapping, QA_Inspector only, Shift/Operator explicitly ignored.
 * Record_ID idempotency is checked across the complete log under a script lock.
 * This source must be installed and deployed in Apps Script before live use.
 * Keep the existing deployment: Manage deployments > Edit > New version.
 */
var SS_ID = '1UtC7dmBxa05IVQs0Ap6Y_0x44yI-7M2c4ytX64P7KXk';   // spreadsheet 'Daily Organoleptic Report'
var SHEET_NAME = 'QC_Logs';
function book_() { return SS_ID ? SpreadsheetApp.openById(SS_ID) : SpreadsheetApp.getActive(); }
// Headers the app sends (17). 'Shift' is intentionally absent.
var REQUIRED = ['Timestamp','Date','QA_Inspector','Batch_Code','Stream','Sub_Category','SKU_Name','Measured_Brix','Brix_Spec','Brix_Status',
                'Measured_pH','pH_Spec','pH_Status','Overall_Status','Organoleptic_Remark','Raw_Transcript','Record_ID'];
var TEXT_COLS = { Timestamp: 1, Date: 1, Batch_Code: 1, QA_Inspector: 1, Record_ID: 1 };

// Read-only handshake (informational). App v10 does NOT gate sync on it; open <exec URL>?action=health in a browser to check header readiness.
function doGet() {
  try {
    var sh = book_().getSheetByName(SHEET_NAME);
    if (!sh || !sh.getLastColumn()) return out_({ version: 'qc-v9.2', ready: false, message: 'QC_Logs headers not found' });
    var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(function (h) { return String(h).trim(); });
    var missing = REQUIRED.filter(function (h) { return headers.indexOf(h) < 0; });
    var duplicates = headers.filter(function (h, i) { return h && headers.indexOf(h) !== i; });
    return out_({ version: 'qc-v9.2', ready: !missing.length && !duplicates.length, missing: missing, duplicate_headers: duplicates });
  } catch (err) { return out_({ version: 'qc-v9.2', ready: false, message: String(err) }); }
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
    var sh = book_().getSheetByName(SHEET_NAME);
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
      var row = []; for (var z = 0; z < headers.length; z++) row.push('');   // no Array.fill: this project runs on the legacy (Rhino) runtime
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
    return out_({ status: 'success', written: rows.length, skipped: skipped, accepted_ids: accepted, version: 'qc-v9.2' });
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
  var sh = book_().getSheetByName(SHEET_NAME);
  var lastCol = sh.getLastColumn();
  var h = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (x) { return String(x).trim(); });
  var iOp = h.indexOf('Operator');
  if (iOp >= 0 && h.indexOf('QA_Inspector') < 0) sh.getRange(1, iOp + 1).setValue('QA_Inspector');
  if (h.indexOf('Record_ID') < 0) sh.getRange(1, lastCol + 1).setValue('Record_ID');
  Logger.log('Headers now: ' + sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].join(' | '));
}

/* =====================================================================================================
 * v16 REPORT TOOLS (run from the editor; the web app above is unchanged).
 *  - runProductionSetup(): amber/green/red formatting on QC_Logs, builds the tabs "Today", "Dashboard" and the hidden "_calc".
 *  - deleteLegacyRows_20261123(): deletes the 15 rows of 23 Nov 2026 written by the old script (no Record_ID).
 *  Tabs are rebuilt from scratch each run; QC_Logs data is never touched by setup.
 * ===================================================================================================== */
var REPORT_TABS = ['Today', 'Dashboard', '_calc'];
var C_GREEN = '#C6F6D5', C_AMBER = '#FDE68A', C_RED = '#FECACA', C_INK = '#0B1F14';

function runProductionSetup() { setupReports_(SS_ID); }

function deleteLegacyRows_20261123() {
  var sh = book_().getSheetByName(SHEET_NAME), lock = LockService.getScriptLock(); lock.waitLock(25000);
  try {
    var h = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(function (x) { return String(x).trim(); });
    var iD = h.indexOf('Date'), iR = h.indexOf('Record_ID'), last = sh.getLastRow(); if (last < 2) return Logger.log('Nothing to delete');
    var v = sh.getRange(2, 1, last - 1, h.length).getDisplayValues(), rows = [];
    v.forEach(function (r, i) { if (String(r[iD]) === '2026-11-23' && String(r[iR]).trim() === '') rows.push(i + 2); });
    if (rows.length > 20) throw new Error('Safety stop: ' + rows.length + ' rows matched (expected 15). Nothing deleted.');
    for (var k = rows.length - 1; k >= 0; k--) sh.deleteRow(rows[k]);
    Logger.log('Deleted ' + rows.length + ' legacy rows (23 Nov 2026, no Record_ID).');
  } finally { lock.releaseLock(); }
}

function colL_(n) { var s = ''; while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; } return s; }

function setupReports_(ssId) {
  var ss = SpreadsheetApp.openById(ssId), log = ss.getSheetByName(SHEET_NAME);
  var h = log.getRange(1, 1, 1, log.getLastColumn()).getValues()[0].map(function (x) { return String(x).trim(); });
  var L = {}; ['Timestamp','Date','QA_Inspector','Batch_Code','Sub_Category','SKU_Name','Measured_Brix','Brix_Spec','Brix_Status','Measured_pH','pH_Spec','pH_Status','Overall_Status','Organoleptic_Remark']
    .forEach(function (k) { var i = h.indexOf(k); if (i < 0) throw new Error('Missing header ' + k); L[k] = "'" + SHEET_NAME + "'!" + colL_(i + 1) + '2:' + colL_(i + 1); });

  // ---- amber / green / red on QC_Logs status columns ----
  var stCols = ['Brix_Status','pH_Status','Overall_Status'].map(function (k) { return h.indexOf(k) + 1; });
  var rules = log.getConditionalFormatRules().filter(function (r) { return !r.getRanges().some(function (g) { return stCols.indexOf(g.getColumn()) >= 0 && g.getNumColumns() === 1; }); });   // keep the user's other rules
  ['Brix_Status','pH_Status','Overall_Status'].forEach(function (k) {
    var c = h.indexOf(k) + 1, rg = log.getRange(colL_(c) + '2:' + colL_(c));   // open-ended: keeps colouring past row 1000
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextStartsWith('SLIGHT').setBackground(C_AMBER).setRanges([rg]).build());
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('GREEN').setBackground(C_GREEN).setRanges([rg]).build());
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('RED').setBackground(C_RED).setRanges([rg]).build());
  });
  log.setConditionalFormatRules(rules);
  log.setFrozenRows(1);

  REPORT_TABS.forEach(function (n) { var s = ss.getSheetByName(n); if (s) ss.deleteSheet(s); });

  // ---- _calc: one clean, typed row per QC record (hidden) ----
  var cal = ss.insertSheet('_calc');
  cal.getRange('A1').setFormula(
    '=LET(d,' + L.Date + ',tm,' + L.Timestamp + ',ov,' + L.Overall_Status + ',bt,' + L.Batch_Code + ',bs,' + L.Brix_Spec + ',ps,' + L.pH_Spec + ',bx,' + L.Measured_Brix + ',ph,' + L.Measured_pH + ',' +
    '{"Date","Month","Category","Product","Brix","pH","Class","Batch","Sub","AgeDays","Inspector","BrixMin","BrixMax","Time","BrixSpec","pHSpec","Overall","Remark","pHMin","pHMax";' +
    'ARRAYFORMULA(IF(d="",,{d,LEFT(d,7),' + L.Sub_Category + ',' + L.SKU_Name + ',IF(ISNUMBER(bx),bx,),IF(ISNUMBER(ph),ph,),' +
    'IF(REGEXMATCH(ov&"","^SLIGHT"),"SLIGHT VARIATION",IF(ov="GREEN","GREEN",IF(ov="RED","RED","N/A"))),bt,' +
    'IF(REGEXMATCH(bt&"","^\\d{2}[A-L]\\d{2}[A-Z]$"),RIGHT(bt,1),),' +
    'IFERROR(DATEVALUE(d)-DATE(2000+VALUE(MID(bt,4,2)),FIND(MID(bt,3,1),"ABCDEFGHIJKL"),VALUE(LEFT(bt,2))),),' +
    L.QA_Inspector + ',IFERROR(VALUE(REGEXEXTRACT(bs&"","^([0-9.]+)")),),IFERROR(VALUE(REGEXEXTRACT(bs&"","([0-9.]+)$")),),MID(tm,12,5),bs,ps,ov,' + L.Organoleptic_Remark + ',' +
    'IFERROR(VALUE(REGEXEXTRACT(ps&"","^([0-9.]+)")),),IFERROR(VALUE(REGEXEXTRACT(ps&"","([0-9.]+)$")),)}))})');
  cal.hideSheet();

  // ---- Today: latest check date only ----
  var t = ss.insertSheet('Today', 0);
  t.getRange('A1').setFormula('="Daily Organoleptic Report — "&IF($B$2="","no entries yet",TEXT($B$2,"dddd, d mmmm yyyy"))');
  t.getRange('A2').setValue('Report date'); t.getRange('B2').setFormula('=IF(COUNTA(_calc!A2:A)=0,"",IFERROR(MAX(ARRAYFORMULA(IFERROR(DATEVALUE(_calc!A2:A)))),""))').setNumberFormat('dd-mmm-yyyy');
  t.getRange('D2:K2').setValues([['Checks','','Pass','','Slight variation','','Out / HOLD','']]);
  var dk = 'TEXT($B$2,"yyyy-mm-dd")';
  t.getRange('E2').setFormula('=IF($B$2="",0,COUNTIF(_calc!A2:A,' + dk + '))');
  t.getRange('G2').setFormula('=IF($B$2="",0,COUNTIFS(_calc!A2:A,' + dk + ',_calc!G2:G,"GREEN"))');
  t.getRange('I2').setFormula('=IF($B$2="",0,COUNTIFS(_calc!A2:A,' + dk + ',_calc!G2:G,"SLIGHT VARIATION"))');
  t.getRange('K2').setFormula('=IF($B$2="",0,COUNTIFS(_calc!A2:A,' + dk + ',_calc!G2:G,"RED"))');
  t.getRange('A4:K4').setValues([['Time','Batch','Category','Product','Brix °Bx','Brix spec','pH','pH spec','Status','Organoleptic remark','Inspector']]);
  t.getRange('A5').setFormula('=IFERROR(SORT(FILTER({_calc!N2:N,_calc!H2:H,_calc!C2:C,_calc!D2:D,_calc!E2:E,_calc!O2:O,_calc!F2:F,_calc!P2:P,_calc!Q2:Q,_calc!R2:R,_calc!K2:K},_calc!A2:A=' + dk + '),1,TRUE),"No entries for this date")');
  t.getRange('A1:K1').merge().setFontSize(16).setFontWeight('bold').setFontColor(C_INK);
  t.getRange('A2:K2').setFontWeight('bold');
  t.getRange('A4:K4').setFontWeight('bold').setBackground('#0B5E2E').setFontColor('#FFFFFF');
  t.setFrozenRows(4);
  [70,90,150,220,80,90,60,80,230,330,110].forEach(function (w, i) { t.setColumnWidth(i + 1, w); });
  t.getRange('J5:J').setWrap(true);
  var st = t.getRange('I5:I'), bc = t.getRange('B5:B');
  t.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenTextStartsWith('SLIGHT').setBackground(C_AMBER).setRanges([st]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('GREEN').setBackground(C_GREEN).setRanges([st]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('RED').setBackground(C_RED).setRanges([st]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=AND($B5<>"",LEFT($B5,5)<>TEXT($B$2,"dd")&MID("ABCDEFGHIJKL",MONTH($B$2),1)&TEXT($B$2,"yy"))')
      .setBackground('#FFF7E0').setFontColor('#92400E').setRanges([bc]).build()
  ]);
  t.getRange('A3').setValue('Shows only the latest check date in QC_Logs. Amber batch = back-dated production day (e.g. weekend samples checked on Monday).').setFontColor('#5B6B63').setFontStyle('italic');

  // ---- Dashboard ----
  var d = ss.insertSheet('Dashboard', 1);
  d.getRange('A1').setValue('QC Trend Dashboard — organoleptic quality, variation and consistency').setFontSize(16).setFontWeight('bold');
  d.getRange('Z1:AA1').setValues([['Months','Products']]);
  d.getRange('Z2').setFormula('=IFERROR(SORT(UNIQUE(FILTER(_calc!B2:B,_calc!B2:B<>"")),1,FALSE),"")');
  d.getRange('AA2').setFormula('=IFERROR(SORT(UNIQUE(FILTER(_calc!D2:D,_calc!D2:D<>""))),"")');
  d.getRange('A2').setValue('Month'); d.getRange('B2').setFormula('=Z2');
  d.getRange('D2').setValue('Product for charts'); d.getRange('E2').setFormula('=AA2');
  d.getRange('B2').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInRange(d.getRange('Z2:Z'), true).setAllowInvalid(true).build());
  d.getRange('E2').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInRange(d.getRange('AA2:AA'), true).setAllowInvalid(true).build());
  d.getRange('E2:G2').merge(); d.getRange('A2:E2').setFontWeight('bold'); d.getRange('B2').setBackground('#FFF7E0'); d.getRange('E2').setBackground('#FFF7E0');
  d.getRange('A4:G4').setValues([['Checks','Pass (GREEN)','Slight variation','Out / HOLD','Products','Avg age at check (days)','Batch E share']]);
  var m = '$B$2';
  d.getRange('A5').setFormula('=IF(' + m + '="",0,COUNTIF(_calc!B2:B,' + m + '))');
  d.getRange('B5').setFormula('=IFERROR(COUNTIFS(_calc!B2:B,' + m + ',_calc!G2:G,"GREEN")/$A$5,0)');
  d.getRange('C5').setFormula('=IFERROR(COUNTIFS(_calc!B2:B,' + m + ',_calc!G2:G,"SLIGHT VARIATION")/$A$5,0)');
  d.getRange('D5').setFormula('=IFERROR(COUNTIFS(_calc!B2:B,' + m + ',_calc!G2:G,"RED")/$A$5,0)');
  d.getRange('E5').setFormula('=IF(' + m + '="",0,IFERROR(COUNTUNIQUE(FILTER(_calc!D2:D,_calc!B2:B=' + m + ')),0))');
  d.getRange('F5').setFormula('=IFERROR(AVERAGEIFS(_calc!J2:J,_calc!B2:B,' + m + ',_calc!J2:J,"<>"),"—")');
  d.getRange('G5').setFormula('=IFERROR(COUNTIFS(_calc!B2:B,' + m + ',_calc!I2:I,"E")/$A$5,0)');
  d.getRange('B5:D5').setNumberFormat('0.0%'); d.getRange('G5').setNumberFormat('0.0%'); d.getRange('F5').setNumberFormat('0.0');
  d.getRange('A4:G4').setFontWeight('bold').setBackground('#0B5E2E').setFontColor('#FFFFFF').setWrap(true);
  d.getRange('A5:G5').setFontSize(14).setFontWeight('bold').setHorizontalAlignment('center'); d.setRowHeight(4, 48);
  d.getRange('B5').setBackground(C_GREEN); d.getRange('C5').setBackground(C_AMBER); d.getRange('D5').setBackground(C_RED);

  d.getRange('A7').setValue('Per product — selected month').setFontWeight('bold').setFontSize(13);
  d.getRange('A8').setFormula('=IFERROR(QUERY(_calc!A2:V,"select C, D, count(D), avg(E), min(E), max(E), avg(F) where B = \'"&' + m + '&"\' group by C, D order by C, D label C \'Category\', D \'Product\', count(D) \'Checks\', avg(E) \'Avg Brix\', min(E) \'Min Brix\', max(E) \'Max Brix\', avg(F) \'Avg pH\'",0),"No data for this month")');
  d.getRange('H8:M8').setValues([['SD Brix','CV % Brix','% Pass','% Slight var.','% Out / HOLD','Avg age (days)']]);
  var f = [], N = 200;
  for (var r = 9; r < 9 + N; r++) {
    var key = '_calc!$B$2:$B,' + m + ',_calc!$C$2:$C,$A' + r + ',_calc!$D$2:$D,$B' + r;
    f.push([
      '=IF($B' + r + '="","",IFERROR(STDEV(FILTER(_calc!$E$2:$E,_calc!$B$2:$B=' + m + ',_calc!$C$2:$C=$A' + r + ',_calc!$D$2:$D=$B' + r + ',ISNUMBER(_calc!$E$2:$E))),""))',
      '=IF(OR($B' + r + '="",H' + r + '="",N(D' + r + ')=0),"",H' + r + '/D' + r + ')',
      '=IF($B' + r + '="","",COUNTIFS(' + key + ',_calc!$G$2:$G,"GREEN")/$C' + r + ')',
      '=IF($B' + r + '="","",COUNTIFS(' + key + ',_calc!$G$2:$G,"SLIGHT VARIATION")/$C' + r + ')',
      '=IF($B' + r + '="","",COUNTIFS(' + key + ',_calc!$G$2:$G,"RED")/$C' + r + ')',
      '=IF($B' + r + '="","",IFERROR(AVERAGEIFS(_calc!$J$2:$J,' + key + ',_calc!$J$2:$J,"<>"),""))'
    ]);
  }
  d.getRange(9, 8, N, 6).setFormulas(f);
  d.getRange('A8:M8').setFontWeight('bold').setBackground('#E8F5EC').setWrap(true);
  d.getRange(9, 4, N, 4).setNumberFormat('0.00'); d.getRange(9, 8, N, 1).setNumberFormat('0.00');
  d.getRange(9, 9, N, 4).setNumberFormat('0.0%'); d.getRange(9, 13, N, 1).setNumberFormat('0.0');
  var pr = function (c) { return d.getRange(9, c, N, 1); };
  d.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenNumberGreaterThan(0).setBackground(C_AMBER).setRanges([pr(11)]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenNumberGreaterThan(0).setBackground(C_RED).setRanges([pr(12)]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenNumberGreaterThan(0.05).setBackground(C_AMBER).setRanges([pr(9)]).build()
  ]);
  [120,210,60,70,70,70,65,65,70,65,70,75,75].forEach(function (w, i) { d.setColumnWidth(i + 1, w); });
  d.setFrozenRows(5);

  // trend tables (all months) — right side, below the charts
  d.getRange('O60').setValue('Average Brix by product and month (trend)').setFontWeight('bold').setFontSize(13);
  d.getRange('O61').setFormula('=IFERROR(QUERY(_calc!A2:V,"select D, avg(E) where E is not null group by D pivot B",0),"")');
  d.getRange('O90').setValue('% checks needing attention (slight variation + out) by product and month').setFontWeight('bold').setFontSize(13);
  // chart data blocks (far right)
  d.getRange('AC1').setValue('Status mix by month');
  d.getRange('AC2:AF2').setValues([['Month','Pass','Slight variation','Out / HOLD']]);
  d.getRange('AC3').setFormula('=IFERROR(SORT(UNIQUE(FILTER(_calc!B2:B,_calc!B2:B<>""))),"")');
  d.getRange('AD3').setFormula('=ARRAYFORMULA(IF(AC3:AC40="",,COUNTIFS(_calc!B2:B,AC3:AC40,_calc!G2:G,"GREEN")))');
  d.getRange('AE3').setFormula('=ARRAYFORMULA(IF(AC3:AC40="",,COUNTIFS(_calc!B2:B,AC3:AC40,_calc!G2:G,"SLIGHT VARIATION")))');
  d.getRange('AF3').setFormula('=ARRAYFORMULA(IF(AC3:AC40="",,COUNTIFS(_calc!B2:B,AC3:AC40,_calc!G2:G,"RED")))');
  d.getRange('AK1:AN1').setValues([['Date','Brix','Min spec','Max spec']]);
  d.getRange('AK2').setFormula('=IFERROR(SORT(QUERY(_calc!A2:V,"select A, E, L, M where D = \'"&$E$2&"\' and E is not null order by A desc limit 40 label A \'\', E \'\', L \'\', M \'\'",0),1,TRUE),"")');
  d.getRange('AP1:AS1').setValues([['Date','pH','Min spec','Max spec']]);
  d.getRange('AP2').setFormula('=IFERROR(SORT(QUERY(_calc!A2:V,"select A, F, S, T where D = \'"&$E$2&"\' and F is not null order by A desc limit 40 label A \'\', F \'\', S \'\', T \'\'",0),1,TRUE),"")');
  d.getRange('O91').setFormula('=ARRAYFORMULA(IFERROR(QUERY({_calc!D2:D,_calc!B2:B,IF((_calc!G2:G="")+(_calc!G2:G="N/A"),,IF(_calc!G2:G="GREEN",0,1))},"select Col1, avg(Col3) where Col1 is not null and Col3 is not null group by Col1 pivot Col2",0),""))');
  d.getRange('P92:AA200').setNumberFormat('0%');

  d.newChart && d.insertChart(d.newChart().setChartType(Charts.ChartType.COLUMN).addRange(d.getRange('AC2:AF40')).setNumHeaders(1)
    .setOption('isStacked', true).setOption('title', 'Checks by status per month').setOption('legend', { position: 'right' })
    .setOption('series', { 0: { color: '#16A34A' }, 1: { color: '#F59E0B' }, 2: { color: '#DC2626' } })
    .setPosition(3, 15, 0, 0).setOption('width', 620).setOption('height', 300).build());
  d.insertChart(d.newChart().setChartType(Charts.ChartType.LINE).addRange(d.getRange('AK1:AN41')).setNumHeaders(1)
    .setOption('title', 'Brix readings vs spec — product in E2 (last 40)').setOption('series', { 0: { color: '#0B5E2E', pointSize: 5 }, 1: { color: '#DC2626', lineDashStyle: [6, 4] }, 2: { color: '#DC2626', lineDashStyle: [6, 4] } })
    .setPosition(20, 15, 0, 0).setOption('width', 620).setOption('height', 300).build());
  d.insertChart(d.newChart().setChartType(Charts.ChartType.LINE).addRange(d.getRange('AP1:AS41')).setNumHeaders(1)
    .setOption('title', 'pH readings vs spec — product in E2 (last 40)').setOption('series', { 0: { color: '#1D4ED8', pointSize: 5 }, 1: { color: '#DC2626', lineDashStyle: [6, 4] }, 2: { color: '#DC2626', lineDashStyle: [6, 4] } })
    .setPosition(38, 15, 0, 0).setOption('width', 620).setOption('height', 300).build());
  d.getRange('A3').setValue('Pick a month in B2 and a product in E2 (yellow cells). Trend over months: tables from O60. SD / CV = consistency (lower is more consistent).').setFontColor('#5B6B63').setFontStyle('italic');
  d.hideColumns(26, 2);
  ss.setActiveSheet(t);
  Logger.log('Reports ready on ' + ss.getName());
}

/* ---- TEST ONLY: builds the reports on a NEW throw-away spreadsheet with synthetic rows (production is not touched). ---- */
function runTestOnNewSheet() {
  var ss = SpreadsheetApp.create('QC report TEST - delete me'), sh = ss.getSheets()[0]; sh.setName(SHEET_NAME);
  var H = ['Timestamp','Date','Shift','QA_Inspector','Batch_Code','Stream','Sub_Category','SKU_Name','Measured_Brix','Brix_Spec','Brix_Status','Measured_pH','pH_Spec','pH_Status','Overall_Status','Organoleptic_Remark','Raw_Transcript','Record_ID'];
  sh.getRange(1, 1, 1, H.length).setValues([H]);
  var P = [['FRESH JUICES','ORANGE JUICE',10,12.5,3.5,4.5],['FRESH JUICES','CARROT JUICE',6.5,8.5,6,7],['SMOOTHIES','MANGO SMOOTHIE',16,19,3.5,4.5],['SHOTS','GINGER SHOT',7,9,null,null]];
  var rows = [], n = 0, ML = 'ABCDEFGHIJKL';
  for (var day = 0; day < 40; day++) {
    var dt = new Date(2026, 9, 15 + day), ds = Utilities.formatDate(dt, 'GMT+4', 'yyyy-MM-dd');
    P.forEach(function (p, pi) {
      var back = (dt.getDay() === 1 && pi === 0) ? 2 : 0, letter = (day + pi) % 5 === 0 ? 'E' : 'D';
      var bd = new Date(dt.getTime() - back * 864e5), bc = ('0' + bd.getDate()).slice(-2) + ML.charAt(bd.getMonth()) + String(bd.getFullYear() % 100) + letter;
      var wob = [0, 0.3, -0.2, 0.6, -0.7, 1.4, 0.1, -1.3][(day * 3 + pi) % 8], bx = Math.round(((p[2] + p[3]) / 2 + wob * (p[3] - p[2]) / 2.5) * 10) / 10;
      var ph = p[4] === null ? '' : Math.round(((p[4] + p[5]) / 2 + [0, .2, -.3, .55, -.6][(day + pi) % 5]) * 100) / 100;
      var ev = function (v, lo, hi, tol) { if (v === '' || lo === null) return 'N/A'; var d = v < lo ? lo - v : (v > hi ? v - hi : 0); d = Math.round(d * 1000) / 1000; return d === 0 ? 'GREEN' : (d <= tol ? 'SLIGHT VARIATION' : 'RED'); };
      var b = ev(bx, p[2], p[3], 0.5), q = ev(ph, p[4], p[5], 0.2), o = (b === 'RED' || q === 'RED') ? 'RED' : (b === 'SLIGHT VARIATION' && q === 'SLIGHT VARIATION' ? 'SLIGHT VARIATION ON BRIX & pH' : (b === 'SLIGHT VARIATION' ? 'SLIGHT VARIATION ON BRIX' : (q === 'SLIGHT VARIATION' ? 'SLIGHT VARIATION ON pH' : 'GREEN')));
      rows.push([ds + ' 0' + (8 + pi) + ':1' + pi + ':00.000', ds, '', 'Tester', bc, 'STANDARD / HOUSE', p[0], p[1], bx, p[2].toFixed(1) + '–' + p[3].toFixed(1), b, ph,
        p[4] === null ? 'N/A (No_Limit)' : p[4].toFixed(1) + '–' + p[5].toFixed(1), q, o, o === 'RED' ? 'Brix too low — test | CORRECTIVE ACTION/HOLD: Batch on HOLD' : 'ok', 'synthetic', 'test-' + (n++)]);
    });
  }
  [1, 2, 4, 5, 18].forEach(function (c) { sh.getRange(2, c, rows.length, 1).setNumberFormat('@'); });   // same text columns as the web app
  sh.getRange(2, 1, rows.length, H.length).setValues(rows);
  setupReports_(ss.getId());
  // real doPost write path against the scratch sheet (same code as production, different spreadsheet)
  var rec = function (id) { return { Timestamp: '2026-11-24 10:00:0' + id + '.000', Date: '2026-11-24', QA_Inspector: 'Tester', Batch_Code: '24K26D', Stream: 'STANDARD / HOUSE', Sub_Category: 'FRESH JUICES', SKU_Name: 'ORANGE JUICE',
    Measured_Brix: 11.2, Brix_Spec: '10.0–12.5', Brix_Status: 'GREEN', Measured_pH: 3.8, pH_Spec: '3.5–4.5', pH_Status: 'GREEN', Overall_Status: 'GREEN', Organoleptic_Remark: '=HYPERLINK("x")', Raw_Transcript: 't', Record_ID: 'w' + id }; };
  var r1 = postToSheet_(sh, [rec(1), rec(2)]), r2 = postToSheet_(sh, [rec(2), rec(3)]);
  Logger.log('POST1 ' + r1 + ' | RETRY ' + r2 + ' | last row: ' + sh.getRange(sh.getLastRow(), 1, 1, 18).getDisplayValues()[0].join(' ¦ '));
  Logger.log('TEST_URL ' + ss.getUrl() + ' rows=' + rows.length);
}

function postToSheet_(sheet, records) {
  var keep = book_; book_ = function () { return { getSheetByName: function () { return sheet; } }; };
  try { return doPost({ postData: { contents: JSON.stringify({ records: records }) } }).getContent(); } finally { book_ = keep; }
}

/**
 * Gym Bulking Tracker — Google Sheets sync API (Google Apps Script web app).
 *
 * One sheet tab per entity. Column A is `id`. Every write is an upsert keyed by
 * the id generated on the phone, so retries never create duplicate rows.
 * Last write wins, compared on `updated_at`. Deleted records stay as rows with
 * deleted = 1 so the deletion syncs to other devices.
 *
 * All requests are POSTs with a text/plain JSON body (avoids a CORS preflight):
 *   { "token": "...", "action": "push", "changes": { "sets": [ {...}, ... ], ... } }
 *   { "token": "...", "action": "pull", "since": "2026-11-18T10:00:00.000Z" }
 *   { "token": "...", "action": "ping" }
 *
 * Setup: see README.md → "Google Sheets sync (Apps Script)".
 */

var ENTITIES = [
  'exercises', 'day_types', 'template_exercises', 'splits', 'workouts',
  'workout_exercises', 'sets', 'bodyweights', 'measurements', 'photos',
  'foods', 'saved_meals', 'meals', 'food_logs', 'settings',
];

// Fields holding arrays/objects. They are stored as JSON text in the sheet.
var JSON_FIELDS = {
  splits: ['rotation'],
  sets: ['pr_types'],
  saved_meals: ['items'],
  settings: ['value'],
};

var SYNCED_AT = '_synced_at';
var API_VERSION = 3; // the app checks this, so it can tell you when the script is out of date (3 = progress photos)
var PHOTO_FOLDER_NAME = 'Gym Bulking Tracker photos';

/** Run this once from the editor (Run ▶ setup). It creates the tabs and logs your token. */
function setup() {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty('API_TOKEN');
  if (!token) {
    token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
    props.setProperty('API_TOKEN', token);
  }
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ENTITIES.forEach(function (name) { getSheet_(ss, name); });
  photoFolder_(); // creates the Drive folder for progress photos (and asks for Drive permission)
  var first = ss.getSheetByName('Sheet1');
  if (first && ss.getSheets().length > 1 && first.getLastRow() === 0) ss.deleteSheet(first);
  Logger.log('Your API token (paste it into the app → Settings → Sync):\n\n' + token);
}

/** Run this if your token leaks. Then paste the new one into the app. */
function rotateToken() {
  PropertiesService.getScriptProperties().deleteProperty('API_TOKEN');
  setup();
}

function doGet() {
  return json_({ ok: true, message: 'Gym Bulking Tracker API is running. Use POST.' });
}

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var expected = PropertiesService.getScriptProperties().getProperty('API_TOKEN');
    if (!expected || body.token !== expected) return json_({ ok: false, error: 'unauthorized' });

    var lock = LockService.getScriptLock();
    lock.waitLock(25000);
    try {
      if (body.action === 'ping') return json_({ ok: true, api_version: API_VERSION, server_time: new Date().toISOString() });
      if (body.action === 'push') return json_(push_(body.changes || {}));
      if (body.action === 'pull') return json_(pull_(body.since || ''));
      if (body.action === 'photo_upload') return json_(photoUpload_(body));
      if (body.action === 'photo_get') return json_(photoGet_(body));
      if (body.action === 'photo_delete') return json_(photoDelete_(body));
      return json_({ ok: false, error: 'unknown action' });
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

// ---------------------------------------------------------------------------

function push_(changes) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tz = ss.getSpreadsheetTimeZone();
  var now = new Date().toISOString();
  var result = { ok: true, server_time: now, applied: {}, skipped: {} };

  Object.keys(changes).forEach(function (entity) {
    if (ENTITIES.indexOf(entity) < 0) return;
    var rows = changes[entity] || [];
    if (!rows.length) return;
    var sheet = getSheet_(ss, entity);
    var jsonFields = JSON_FIELDS[entity] || [];

    // Make sure every incoming field has a column.
    var headers = readHeaders_(sheet);
    var headersChanged = false;
    rows.forEach(function (r) {
      Object.keys(r || {}).forEach(function (k) {
        if (headers.indexOf(k) < 0) { headers.push(k); headersChanged = true; }
      });
    });
    if (headers.indexOf(SYNCED_AT) < 0) { headers.push(SYNCED_AT); headersChanged = true; }
    if (headersChanged) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
      sheet.setFrozenRows(1);
    }

    var width = headers.length;
    var lastRow = sheet.getLastRow();
    var data = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, width).getValues() : [];
    var originalCount = data.length;
    var idCol = headers.indexOf('id');
    var updCol = headers.indexOf('updated_at');
    var index = {};
    data.forEach(function (row, i) { index[String(row[idCol])] = i; });

    var changed = {};
    var changedCount = 0;
    var applied = 0, skipped = 0;
    rows.forEach(function (r) {
      if (!r || !r.id) { skipped++; return; }
      var at = index[r.id];
      if (at !== undefined) {
        var existing = normalize_(data[at][updCol], 'updated_at', tz);
        if (existing && r.updated_at && existing > r.updated_at) { skipped++; return; } // a newer copy is already stored
      }
      var out = headers.map(function (h, c) {
        if (h === SYNCED_AT) return now;
        var v = r[h];
        if (v === undefined) return at !== undefined ? data[at][c] : '';   // keep columns the app doesn't know about
        if (jsonFields.indexOf(h) >= 0) return JSON.stringify(v === undefined ? null : v);
        if (v === null) return '';
        if (typeof v === 'object') return JSON.stringify(v);
        return v;
      });
      if (at !== undefined) {
        data[at] = out;
        if (at < originalCount && !changed[at]) { changed[at] = true; changedCount++; }
      } else {
        index[r.id] = data.length;
        data.push(out);
      }
      applied++;
    });

    // Write only what changed. A few edited rows are written one by one; many, as one block.
    if (changedCount > 25) {
      writeRows_(sheet, 2, data.slice(0, originalCount), width);
    } else {
      Object.keys(changed).forEach(function (i) { writeRows_(sheet, 2 + Number(i), [data[i]], width); });
    }
    writeRows_(sheet, 2 + originalCount, data.slice(originalCount), width);

    result.applied[entity] = applied;
    result.skipped[entity] = skipped;
  });
  return result;
}

/** Plain-text format stops Sheets turning ids, dates and "=..." notes into other types. */
function writeRows_(sheet, startRow, rows, width) {
  if (!rows.length) return;
  var range = sheet.getRange(startRow, 1, rows.length, width);
  range.setNumberFormat('@');
  range.setValues(rows.map(function (row) {
    return row.map(function (v) { return typeof v === 'number' || typeof v === 'boolean' ? String(v) : v; });
  }));
}

function pull_(since) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tz = ss.getSpreadsheetTimeZone();
  var serverTime = new Date().toISOString();
  var out = {};
  ENTITIES.forEach(function (entity) {
    var sheet = ss.getSheetByName(entity);
    if (!sheet || sheet.getLastRow() < 2) return;
    var headers = readHeaders_(sheet);
    var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();
    var syncedCol = headers.indexOf(SYNCED_AT);
    var jsonFields = JSON_FIELDS[entity] || [];
    var rows = [];
    values.forEach(function (row) {
      var synced = normalize_(row[syncedCol], SYNCED_AT, tz);
      if (since && synced && synced < since) return; // '<' not '<=': a row stamped in the same millisecond as the last pull is sent again (harmless)
      var obj = {};
      headers.forEach(function (h, i) {
        if (h === SYNCED_AT || !h) return;
        obj[h] = decode_(normalize_(row[i], h, tz), h, jsonFields);
      });
      if (obj.id) rows.push(obj);
    });
    if (rows.length) out[entity] = rows;
  });
  return { ok: true, server_time: serverTime, changes: out };
}

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Progress photos: stored in one Drive folder. Only files in that folder can be read or deleted.

function photoFolder_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('PHOTO_FOLDER_ID');
  if (id) {
    try {
      var existing = DriveApp.getFolderById(id);
      if (!existing.isTrashed()) return existing;
    } catch (e) { /* deleted: make a new one */ }
  }
  var folder = DriveApp.createFolder(PHOTO_FOLDER_NAME);
  props.setProperty('PHOTO_FOLDER_ID', folder.getId());
  return folder;
}

function photoInFolder_(fileId) {
  var folder = photoFolder_();
  var file = DriveApp.getFileById(String(fileId));
  var parents = file.getParents();
  while (parents.hasNext()) if (parents.next().getId() === folder.getId()) return file;
  throw new Error('not a progress photo');
}

/** Idempotent: the file name contains the photo's id, so a retry returns the same file. */
function photoUpload_(b) {
  if (!b.id || !b.data) throw new Error('missing photo');
  var folder = photoFolder_();
  var name = String(b.name || b.id);
  var found = folder.getFilesByName(name);
  if (found.hasNext()) return { ok: true, file_id: found.next().getId(), existed: true };
  var blob = Utilities.newBlob(Utilities.base64Decode(b.data), b.mime || 'image/jpeg', name);
  return { ok: true, file_id: folder.createFile(blob).getId() };
}

function photoGet_(b) {
  var file = photoInFolder_(b.file_id);
  return { ok: true, mime: file.getMimeType(), data: Utilities.base64Encode(file.getBlob().getBytes()) };
}

function photoDelete_(b) {
  try { photoInFolder_(b.file_id).setTrashed(true); } catch (e) { /* already gone */ }
  return { ok: true };
}

function getSheet_(ss, name) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, 5).setValues([['id', 'created_at', 'updated_at', 'deleted', SYNCED_AT]]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function readHeaders_(sheet) {
  var lastCol = sheet.getLastColumn();
  if (lastCol < 1) return ['id'];
  return sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(String).filter(function (h) { return h !== ''; });
}

/** Undo any type conversion Sheets did (e.g. dates typed into cells by hand). */
function normalize_(v, field, tz) {
  if (v instanceof Date) {
    return field === 'date' ? Utilities.formatDate(v, tz, 'yyyy-MM-dd') : v.toISOString();
  }
  return v;
}

var NUMERIC = /^-?\d+(\.\d+)?$/;
var TEXT_FIELDS = ['id', 'name', 'note', 'notes', 'label', 'serving_label', 'date', 'site', 'icon', 'color', 'drive_file_id'];

function decode_(v, field, jsonFields) {
  if (v === '' || v === null || v === undefined) return null;
  if (jsonFields.indexOf(field) >= 0) {
    try { return JSON.parse(v); } catch (e) { return v; }
  }
  if (typeof v === 'string' && TEXT_FIELDS.indexOf(field) < 0 && !/_id$/.test(field) && NUMERIC.test(v)) return Number(v);
  if (v === 'true') return true;
  if (v === 'false') return false;
  return v;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

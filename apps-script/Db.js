/**
 * Small helpers for treating each tab as a table: row 1 is headers, every
 * other row is one record keyed by those headers.
 */

function readTable(name) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(String);
  const rows = values.slice(1).map((values, i) => {
    const row = { _row: i + 2 };
    headers.forEach((h, j) => (row[h] = values[j]));
    return row;
  });
  return { sheet, headers, rows };
}

/** Changes some fields of one row, written back to the sheet in a single call. */
function updateRow(table, row, fields) {
  Object.keys(fields).forEach((key) => {
    if (table.headers.indexOf(key) < 0) throw new Error(`Column ${key} missing from ${table.sheet.getName()}`);
    row[key] = fields[key];
  });
  table.sheet.getRange(row._row, 1, 1, table.headers.length).setValues([table.headers.map((h) => row[h])]);
}

function appendRow(table, record) {
  table.sheet.appendRow(table.headers.map((h) => (h in record ? record[h] : '')));
}

/** Appends without reading the tab first, using the headers defined in Setup.js. */
function appendRecord(tabName, record) {
  const headers = TABS.find((t) => t.name === tabName).headers;
  SpreadsheetApp.getActiveSpreadsheet().getSheetByName(tabName).appendRow(headers.map((h) => (h in record ? record[h] : '')));
}

/** Only call inside withLock, right after reading, so row numbers are current. */
function deleteRow(table, row) {
  table.sheet.deleteRow(row._row);
}

function getConfig() {
  const config = {};
  readTable('Config').rows.forEach((r) => {
    if (r.key) config[String(r.key).trim()] = r.value;
  });
  return config;
}

/** Checkbox cells read as true/false; hand-typed cells may say TRUE/FALSE. */
function isTrue(value) {
  return value === true || String(value).trim().toUpperCase() === 'TRUE';
}

/** Runs fn while holding the script-wide lock, so simultaneous requests can't collide. */
function withLock(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw new UserError('The site is busy right now. Please try again.');
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

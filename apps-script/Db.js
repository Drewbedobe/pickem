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

function updateRow(table, row, fields) {
  Object.keys(fields).forEach((key) => {
    const col = table.headers.indexOf(key);
    if (col < 0) throw new Error(`Column ${key} missing from ${table.sheet.getName()}`);
    table.sheet.getRange(row._row, col + 1).setValue(fields[key]);
    row[key] = fields[key];
  });
}

function appendRow(table, record) {
  table.sheet.appendRow(table.headers.map((h) => (h in record ? record[h] : '')));
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

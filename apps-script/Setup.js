/**
 * One-time setup: creates every tab with its header row and a note on what is
 * safe to edit by hand. Safe to run again — existing tabs and data are left alone.
 *
 * Run it from the Apps Script editor: choose "setup" in the function menu, then Run.
 */

const TABS = [
  {
    name: 'Config',
    headers: ['key', 'value'],
    note: 'Settings for the site. Safe to edit values in column B. Do not rename keys in column A.\n\ncurrent_week: the week players are picking. Moves to the next week automatically once every game is final.\n\ndeadline_override: leave blank for the normal deadline (6:00 AM CT on the day of the first game), or enter a date and time to change it for the current week only.',
    rows: [
      ['season', 2026],
      ['commissioner_name', ''],
      ['current_week', ''],
      ['deadline_override', ''],
      ['rules_text', ''],
      ['admin_pin_hash', ''],
      ['admin_pin_salt', ''],
    ],
  },
  {
    name: 'Players',
    headers: ['player_id', 'name', 'pin_hash', 'pin_salt', 'is_player', 'is_admin', 'active', 'failed_tries', 'paused_until'],
    note: 'One row per person. Safe to edit name, is_player, is_admin and active. Set or reset PINs from the admin page, not here.',
  },
  {
    name: 'Devices',
    headers: ['token_hash', 'player_id', 'created_at', 'last_seen_at'],
    note: 'Signed-in phones and computers. Delete a row to sign that device out. Do not edit otherwise.',
  },
  {
    name: 'Games',
    headers: ['week', 'game_id', 'kickoff', 'away_team', 'home_team', 'away_record', 'home_record', 'favorite', 'spread', 'spread_source', 'status', 'away_score', 'home_score', 'winner', 'winner_override', 'away_abbr', 'home_abbr'],
    note: 'One row per game, loaded from ESPN. To fix a result, type the winning team (or TIE) in winner_override.',
  },
  {
    name: 'Picks',
    headers: ['week', 'player_id', 'game_id', 'picked_team', 'points', 'updated_at', 'updated_by'],
    note: 'One row per player per game. Safe to edit picked_team and points. Each player must use each points number only once per week.',
  },
  {
    name: 'WeeklyTotals',
    headers: ['week', 'player_id', 'points', 'correct_picks', 'source', 'note'],
    note: 'Weekly scores. source = site rows are filled in automatically (edit picks or results instead). source = imported rows are weeks from the old spreadsheet. source = override rows are the commissioner\'s corrections and replace the automatic score.',
  },
  {
    name: 'Adjustments',
    headers: ['adjustment_id', 'player_id', 'points', 'reason', 'created_at', 'created_by'],
    note: 'Season point adjustments added in Commissioner Tools (+ or -). Each row is added to that player\'s season total.',
  },
  {
    name: 'AuditLog',
    headers: ['timestamp', 'actor', 'action', 'details'],
    note: 'Record of admin actions. Written automatically; no need to edit.',
  },
];

function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.setSpreadsheetTimeZone('America/Chicago');

  TABS.forEach((tab) => {
    if (ss.getSheetByName(tab.name)) {
      ensureHeaders(ss.getSheetByName(tab.name), tab);
      return;
    }
    const sheet = ss.insertSheet(tab.name);
    const header = sheet.getRange(1, 1, 1, tab.headers.length);
    header.setValues([tab.headers]).setFontWeight('bold').setBackground('#e8eaed');
    sheet.getRange(1, 1).setNote(tab.note);
    sheet.setFrozenRows(1);
    if (tab.rows) sheet.getRange(2, 1, tab.rows.length, tab.headers.length).setValues(tab.rows);
    sheet.autoResizeColumns(1, tab.headers.length);
  });

  ensureConfigKeys(ss.getSheetByName('Config'));
  keepAsText('Games', ['away_record', 'home_record']);
  if (typeof PRIVATE_SEED !== 'undefined') seedFromPrivate(PRIVATE_SEED);

  // Remove the blank starter tab Google creates with a new spreadsheet.
  const starter = ss.getSheetByName('Sheet1');
  if (starter && starter.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(starter);

  installTriggers();
  if (Number(getConfig().current_week)) syncTick();

  ss.setActiveSheet(ss.getSheetByName('Config'));
  console.log('Setup complete: ' + ss.getSheets().map((s) => s.getName()).join(', '));
}

/** Adds any columns that were introduced after the tab was first created, and refreshes the note. */
function ensureHeaders(sheet, tab) {
  const width = Math.max(sheet.getLastColumn(), 1);
  const existing = sheet.getRange(1, 1, 1, width).getValues()[0].map(String);
  tab.headers.forEach((h) => {
    if (existing.indexOf(h) >= 0) return;
    const col = sheet.getLastColumn() + 1;
    sheet.getRange(1, col).setValue(h).setFontWeight('bold').setBackground('#e8eaed');
  });
  sheet.getRange(1, 1).setNote(tab.note);
}

/**
 * Formats whole columns as plain text, so values like "3-1" stay team records
 * instead of Sheets turning them into dates (March 1).
 */
function keepAsText(tabName, headers) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(tabName);
  const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  headers.forEach((h) => {
    const col = header.indexOf(h) + 1;
    if (col > 0) sheet.getRange(1, col, sheet.getMaxRows(), 1).setNumberFormat('@');
  });
}

/** Adds any Config keys that were introduced after the tab was first created. */
function ensureConfigKeys(sheet) {
  const existing = sheet.getRange(1, 1, sheet.getLastRow(), 1).getValues().map((r) => String(r[0]).trim());
  TABS[0].rows.forEach((row) => {
    if (existing.indexOf(row[0]) < 0) sheet.appendRow(row);
  });
}

/**
 * Loads players, the rules text and the commissioner's name from Private.js,
 * a file that is uploaded to Google but kept out of the public GitHub code.
 * Players already in the tab (matched by name) are skipped; Config values are
 * only filled in when blank.
 */
function seedFromPrivate(seed) {
  const players = readTable('Players');
  const known = players.rows.map((p) => String(p.name).trim().toLowerCase());
  let nextId = players.rows.length + 1;
  (seed.players || []).forEach((p) => {
    if (known.indexOf(p.name.trim().toLowerCase()) >= 0) return;
    appendRow(players, {
      player_id: 'P' + String(nextId++).padStart(2, '0'),
      name: p.name.trim(),
      is_player: p.isPlayer !== false,
      is_admin: Boolean(p.isAdmin),
      active: true,
      failed_tries: 0,
    });
  });
  const sheet = players.sheet;
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    ['is_player', 'is_admin', 'active'].forEach((h) => {
      sheet.getRange(2, players.headers.indexOf(h) + 1, lastRow - 1, 1).insertCheckboxes();
    });
  }

  const config = readTable('Config');
  const fill = { rules_text: seed.rulesText, commissioner_name: seed.commissionerName };
  config.rows.forEach((row) => {
    const value = fill[String(row.key).trim()];
    if (value && !row.value) updateRow(config, row, { value });
  });
}

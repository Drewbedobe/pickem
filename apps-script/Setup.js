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
    note: 'Settings for the site. Safe to edit values in column B. Do not rename keys in column A.',
    rows: [
      ['season', 2026],
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
    headers: ['week', 'game_id', 'kickoff', 'away_team', 'home_team', 'away_record', 'home_record', 'favorite', 'spread', 'spread_source', 'status', 'away_score', 'home_score', 'winner', 'winner_override'],
    note: 'One row per game, loaded from ESPN. To fix a result, type the winning team (or TIE) in winner_override.',
  },
  {
    name: 'Picks',
    headers: ['week', 'player_id', 'game_id', 'picked_team', 'points', 'updated_at', 'updated_by'],
    note: 'One row per player per game. Safe to edit picked_team and points. Each player must use each points number only once per week.',
  },
  {
    name: 'WeeklyTotals',
    headers: ['week', 'player_id', 'points', 'correct_picks', 'source'],
    note: 'Weekly scores. Filled in automatically for site weeks; imported weeks have source = imported. Safe to edit.',
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
    if (ss.getSheetByName(tab.name)) return;
    const sheet = ss.insertSheet(tab.name);
    const header = sheet.getRange(1, 1, 1, tab.headers.length);
    header.setValues([tab.headers]).setFontWeight('bold').setBackground('#e8eaed');
    sheet.getRange(1, 1).setNote(tab.note);
    sheet.setFrozenRows(1);
    if (tab.rows) sheet.getRange(2, 1, tab.rows.length, tab.headers.length).setValues(tab.rows);
    sheet.autoResizeColumns(1, tab.headers.length);
  });

  // Remove the blank starter tab Google creates with a new spreadsheet.
  const starter = ss.getSheetByName('Sheet1');
  if (starter && starter.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(starter);

  ss.setActiveSheet(ss.getSheetByName('Config'));
  console.log('Setup complete: ' + ss.getSheets().map((s) => s.getName()).join(', '));
}

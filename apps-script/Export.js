/**
 * Builds the weekly Excel file in the same format as the commissioner's old
 * spreadsheet (WEEK and SEASON tabs), starting from that file as a template
 * (PRIVATE_XLSX_TEMPLATE in PrivateTemplate.js, kept out of GitHub) and
 * filling in this week's games, everyone's picks and season totals.
 *
 * Template layout (WEEK tab): row 1 title, row 2 "N Games" / spread note /
 * season totals per player, row 3 names, rows 4–35 two rows per game (away
 * team, then home), row 36 SUM totals. Players are columns F, G, H, …
 */

const TEMPLATE_PLAYER_COLS = 25; // F..AD in the template
const TEMPLATE_GAMES = 16;
const FIRST_PLAYER_COL = 6; // F

/** Returns an .xlsx Blob for the week. */
function buildWeekWorkbook(week) {
  const config = getConfig();
  const season = Number(config.season);
  const players = activePlayers();
  const games = weekGames(week);
  if (!games.length) throw new UserError(`Week ${week} has no games.`);
  const picks = picksForWeek(week, readTable('Picks'));

  // Season totals for the weeks before this one, like the old SEASON tab.
  const weeks = seasonWeeks(config, players, week - 1);
  const weekNumbers = Object.keys(weeks).map(Number).filter((w) => w < week);
  const seasonTotal = {};
  players.forEach((p) => {
    seasonTotal[p.id] = weekNumbers.reduce((sum, w) => sum + ((weeks[w].scores[p.id] || {}).points || 0), 0);
  });

  const files = {};
  Utilities.unzip(Utilities.newBlob(Utilities.base64Decode(PRIVATE_XLSX_TEMPLATE), 'application/zip')).forEach((b) => (files[b.getName()] = b));
  const text = (name) => files[name].getDataAsString('UTF-8');
  const put = (name, content) => (files[name] = Utilities.newBlob(content, 'application/xml', name));

  const spreadSource = (games.find((g) => g.spread_source) || {}).spread_source || '';
  const lastRow = 3 + games.length * 2;
  const totalsRow = lastRow + 1;

  put('xl/worksheets/sheet1.xml', buildWeekSheet(text('xl/worksheets/sheet1.xml'), { season, week, games, players, picks, seasonTotal, spreadSource, lastRow, totalsRow }));
  put('xl/worksheets/sheet2.xml', buildSeasonSheet(text('xl/worksheets/sheet2.xml'), { players, weeks, weekNumbers, seasonTotal }));

  // Links next to "N Games" and the spread note.
  let rels = text('xl/worksheets/_rels/sheet1.xml.rels');
  rels = rels.replace(/https:\/\/www\.nfl\.com\/schedules\/\d+\/by-week\/week-\d+/g, `https://www.nfl.com/schedules/${season}/by-week/week-${week}`);
  if (/draft\s*kings/i.test(spreadSource)) rels = rels.replace(/https:\/\/sportsbook\.fanduel\.com[^"]*/g, 'https://sportsbook.draftkings.com/leagues/football/nfl');
  put('xl/worksheets/_rels/sheet1.xml.rels', rels);

  put('xl/workbook.xml', text('xl/workbook.xml').replace(/WEEK!\$A\$1:\$AH\$\d+/, `WEEK!$A$1:$AH$${totalsRow}`));

  const name = `Week${String(week).padStart(2, '0')}_${season}.xlsx`;
  return Utilities.zip(Object.keys(files).map((k) => files[k].setName(k)), name).setContentType('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}

function buildWeekSheet(xml, d) {
  const { season, week, games, players, picks, seasonTotal, spreadSource, lastRow, totalsRow } = d;
  const lastPlayerCol = FIRST_PLAYER_COL + Math.max(players.length, TEMPLATE_PLAYER_COLS) - 1;
  const rows = parseSheetRows(xml);
  const out = [];

  // Rows 1–3: title, game count / spread note / season totals, names.
  const r1 = rows[1];
  setCell(r1, 1, `${season} - ${season + 1} WEEK #${week}`);
  out.push(r1);

  // Season totals across the top, with the season leader highlighted yellow like the old sheet.
  const r2 = rows[2];
  setCell(r2, 1, `${games.length} Games`);
  setCell(r2, 2, `Spread from ${spreadSource || 'sportsbook'}. For reference only*`);
  const best = Math.max(0, ...players.map((p) => seasonTotal[p.id]));
  forPlayerCols(players, (col, p, i) => {
    const leader = p && best > 0 && seasonTotal[p.id] === best;
    setCell(r2, col, p ? { formula: `SEASON!${colName(2 + i)}20`, value: seasonTotal[p.id] } : null, leader ? '125' : '29');
  });
  out.push(r2);

  const r3 = rows[3];
  forPlayerCols(players, (col, p) => setCell(r3, col, p ? p.name : null));
  out.push(r3);

  // Two rows per game. The last game uses the template's last pair (it has the bottom border).
  games.forEach((g, i) => {
    const templatePair = i === games.length - 1 ? TEMPLATE_GAMES - 1 : i;
    [g.away_team, g.home_team].forEach((team, side) => {
      const row = cloneRow(rows[4 + templatePair * 2 + side], 4 + i * 2 + side);
      const record = recordText(side === 0 ? g.away_record : g.home_record).split('-');
      setCell(row, 1, team);
      setCell(row, 2, g.favorite === team && g.spread !== '' ? -Math.abs(Number(g.spread)) : null);
      setCell(row, 3, record[0] !== '' ? Number(record[0]) : null);
      setCell(row, 4, record.length > 1 ? Number(record[1]) : null);
      setCell(row, 5, side === 0 ? Utilities.formatDate(new Date(g.kickoff), TZ, 'EEE').toUpperCase() : null);
      forPlayerCols(players, (col, p) => {
        const pick = p && picks[p.id] && picks[p.id][String(g.game_id)];
        setCell(row, col, pick && pick.team === team && pick.points ? pick.points : null);
      });
      out.push(row);
    });
  });

  // Totals row (each player's points should add up to N × (N + 1) / 2).
  const totals = cloneRow(rows[36], totalsRow);
  forPlayerCols(players, (col, p) => {
    const mine = (p && picks[p.id]) || {};
    const sum = Object.keys(mine).reduce((s, id) => s + (mine[id].team && mine[id].points ? mine[id].points : 0), 0);
    setCell(totals, col, p ? { formula: `SUM(${colName(col)}4:${colName(col)}${lastRow})`, value: sum } : null);
  });
  out.push(totals);

  // Everything below the old totals row (blank formatted rows) stays as it was.
  Object.keys(rows).map(Number).filter((n) => n > 36).sort((a, b) => a - b).forEach((n) => out.push(rows[n]));

  let sheet = xml.replace(/<sheetData>[\s\S]*<\/sheetData>/, `<sheetData>${out.map(rowXml).join('')}</sheetData>`);

  const merges = [`A1:${colName(lastPlayerCol)}1`, 'A2:A3', 'B2:B3', 'C2:C3', 'D2:D3', 'E2:E3'];
  games.forEach((g, i) => merges.push(`E${4 + i * 2}:E${5 + i * 2}`));
  sheet = sheet.replace(/<mergeCells[\s\S]*?<\/mergeCells>/, `<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>`);

  const range = `F4:${colName(lastPlayerCol)}${lastRow}`;
  sheet = sheet.replace(/<conditionalFormatting sqref="[^"]*">([\s\S]*?)<formula>[\s\S]*?<\/formula>/, (m, mid) =>
    `<conditionalFormatting sqref="${range}">${mid}<formula>AND(F4&lt;&gt;"",COUNTIF(F$4:F$${lastRow},F4)&gt;1)</formula>`);
  sheet = sheet.replace(/display="\d+ Games"/, `display="${games.length} Games"`);
  sheet = sheet.replace(/<selection [^>]*\/>/, '<selection activeCell="A1" sqref="A1"/>');
  return sheet;
}

function buildSeasonSheet(xml, d) {
  const { players, weeks, weekNumbers, seasonTotal } = d;
  const rows = parseSheetRows(xml);
  const normalStyle = '34';
  const winnerStyle = '45'; // the old sheet highlighted each week's winner

  players.forEach((p, i) => setCell(rows[1], 2 + i, p.name));

  for (let w = 1; w <= 18; w++) {
    const row = rows[w + 1];
    if (!row) continue;
    const data = weeks[w];
    const winners = data && data.final
      ? weekWinners(players.map((p) => Object.assign({ id: p.id }, data.scores[p.id] || { points: 0, correct: 0 })))
      : [];
    players.forEach((p, i) => {
      const col = 2 + i;
      const value = data && weekNumbers.indexOf(w) >= 0 ? (data.scores[p.id] || {}).points || 0 : null;
      setCell(row, col, value, winners.indexOf(p.id) >= 0 ? winnerStyle : normalStyle);
    });
  }

  players.forEach((p, i) => {
    const col = colName(2 + i);
    setCell(rows[20], 2 + i, { formula: `SUM(${col}2:${col}19)`, value: seasonTotal[p.id] });
  });

  const out = Object.keys(rows).map(Number).sort((a, b) => a - b).map((n) => rows[n]);
  return xml.replace(/<sheetData>[\s\S]*<\/sheetData>/, `<sheetData>${out.map(rowXml).join('')}</sheetData>`)
    .replace(/<selection [^>]*\/>/, '<selection activeCell="A1" sqref="A1"/>');
}

// ---- Minimal worksheet XML editing ---------------------------------------------

/** { rowNumber: { num, attrs, cells: [{ col, attrs, body }] } } */
function parseSheetRows(xml) {
  const data = xml.match(/<sheetData>([\s\S]*)<\/sheetData>/)[1];
  const rows = {};
  const rowRe = /<row r="(\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g;
  let m;
  while ((m = rowRe.exec(data))) {
    const cells = [];
    const cellRe = /<c r="([A-Z]+)\d+"([^>]*?)(\/>|>[\s\S]*?<\/c>)/g;
    let c;
    while ((c = cellRe.exec(m[3] || ''))) cells.push({ col: colIndex(c[1]), attrs: c[2], body: c[3] });
    rows[Number(m[1])] = { num: Number(m[1]), attrs: m[2], cells };
  }
  return rows;
}

function cloneRow(row, num) {
  return { num, attrs: row.attrs, cells: row.cells.map((c) => Object.assign({}, c)) };
}

/**
 * Sets a cell's value, keeping its formatting (or using style if given).
 * value: number, string, { formula, value }, or null for empty.
 */
function setCell(row, col, value, style) {
  let cell = row.cells.find((c) => c.col === col);
  if (!cell) {
    const neighbor = row.cells.filter((c) => c.col < col).pop();
    cell = { col, attrs: neighbor ? styleAttr(neighbor.attrs) : '', body: '/>' };
    row.cells.push(cell);
    row.cells.sort((a, b) => a.col - b.col);
  }
  let attrs = style ? ` s="${style}"` : styleAttr(cell.attrs);
  let body = '/>';
  if (value !== null && value !== undefined && value !== '') {
    if (typeof value === 'number') {
      body = `><v>${value}</v></c>`;
    } else if (typeof value === 'object') {
      body = `><f>${xmlEscape(value.formula)}</f>${value.value === undefined ? '' : `<v>${value.value}</v>`}</c>`;
    } else {
      attrs += ' t="inlineStr"';
      body = `><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
    }
  }
  cell.attrs = attrs;
  cell.body = body;
}

function styleAttr(attrs) {
  const s = (attrs || '').match(/ s="\d+"/);
  return s ? s[0] : '';
}

function rowXml(row) {
  const cells = row.cells.map((c) => `<c r="${colName(c.col)}${row.num}"${c.attrs}${c.body}`).join('');
  return `<row r="${row.num}"${row.attrs}>${cells}</row>`;
}

/** Calls fn(column, player, index) for every player column, plus any blank template columns. */
function forPlayerCols(players, fn) {
  const count = Math.max(players.length, TEMPLATE_PLAYER_COLS);
  for (let i = 0; i < count; i++) fn(FIRST_PLAYER_COL + i, players[i] || null, i);
}

function colName(n) {
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function colIndex(name) {
  return name.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
}

function xmlEscape(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---- Emailing it to the commissioner ------------------------------------------

/**
 * Emails the week's spreadsheet to the commissioner (Config: commissioner_email)
 * from the account that owns the site. Returns a short description of what was sent.
 */
function emailWeekWorkbook(week) {
  const config = getConfig();
  const to = String(config.commissioner_email || '').trim();
  if (!to) throw new UserError('No commissioner email is set up.');
  const blob = buildWeekWorkbook(week);
  const games = weekGames(week);
  const deadline = weekDeadline(games, Number(config.current_week) === week ? config : {});
  const picks = picksForWeek(week, readTable('Picks'));
  const players = activePlayers();
  const missing = players.filter((p) => !Object.keys(picks[p.id] || {}).some((id) => picks[p.id][id].team && picks[p.id][id].points));
  const partial = players.filter((p) => {
    const done = Object.keys(picks[p.id] || {}).filter((id) => picks[p.id][id].team && picks[p.id][id].points).length;
    return done > 0 && done < games.length;
  });

  const lines = [
    `Here are everyone's Week ${week} picks${deadline ? ` (deadline ${Utilities.formatDate(deadline, TZ, "EEE MMM d, h:mm a 'CT'")})` : ''}.`,
    '',
    `${players.length - missing.length} of ${players.length} players made picks.`,
  ];
  if (missing.length) lines.push(`No picks: ${missing.map((p) => p.name).join(', ')}`);
  if (partial.length) lines.push(`Not finished: ${partial.map((p) => p.name).join(', ')}`);
  lines.push('', 'Sent automatically by NFL Pick\'em: https://drewbedobe.github.io/pickem/');

  MailApp.sendEmail({
    to,
    subject: `NFL Pick'em: Week ${week} picks`,
    body: lines.join('\n'),
    attachments: [blob],
    name: "NFL Pick'em",
  });
  return `${blob.getName()} sent to ${to}`;
}

/** Called by the timer: once the current week's deadline passes, email its spreadsheet (once). */
function emailAfterDeadline() {
  const config = getConfig();
  const week = Number(config.current_week);
  if (!week || Number(config.emailed_week) === week) return;
  const deadline = weekDeadline(weekGames(week), config);
  if (!deadline || new Date() < deadline) return;
  emailWeekWorkbook(week);
  withLock(() => setConfigValue('emailed_week', week));
}

/**
 * Run this from the Apps Script editor to email this week's spreadsheet now.
 * (Running it the first time is also how the owner approves sending email.)
 */
function emailThisWeekNow() {
  console.log(emailWeekWorkbook(Number(getConfig().current_week)));
}

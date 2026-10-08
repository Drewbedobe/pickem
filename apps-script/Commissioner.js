/**
 * Commissioner Tools: actions only admins (Players.is_admin) can use, from
 * the website. Every change is written to the AuditLog tab.
 */

/** Returns the signed-in player's row if they are an admin; otherwise refuses. */
function requireAdmin(token) {
  const player = requirePlayer(token);
  if (!isTrue(player.is_admin)) throw new UserError('Only the commissioner can do that.', 'not_admin');
  return player;
}

function logAudit(actor, action, details) {
  appendRecord('AuditLog', { timestamp: new Date(), actor: String(actor.name).trim(), action, details });
}

/** Everything the Commissioner Tools home screen needs. */
function handleAdminOverview(req) {
  requireAdmin(req.token);
  const config = getConfig();
  const current = Number(config.current_week) || null;
  const games = current ? weekGames(current) : [];
  const deadline = current ? weekDeadline(games, config) : null;
  const pinOf = {};
  readTable('Players').rows.forEach((p) => (pinOf[String(p.player_id)] = Boolean(p.pin_hash)));

  const log = readTable('AuditLog').rows.slice(-20).reverse().map((r) => ({
    when: r.timestamp ? Utilities.formatDate(new Date(r.timestamp), TZ, "EEE MMM d, h:mm a") : '',
    who: String(r.actor || ''),
    action: String(r.action || ''),
    details: String(r.details || ''),
  }));

  return {
    currentWeek: current,
    deadlineLabel: deadline ? Utilities.formatDate(deadline, TZ, "EEE MMM d, h:mm a 'CT'") : '',
    deadlineOverridden: config.deadline_override instanceof Date,
    siteWeeks: siteWeeks(current),
    totalsWeeks: totalsWeeks(current),
    players: activePlayers().map((p) => ({ id: p.id, name: p.name, hasPin: pinOf[p.id] })),
    log,
  };
}

// ---- Players & PINs --------------------------------------------------------

function handleAdminResetPin(req) {
  const admin = requireAdmin(req.token);
  return withLock(() => {
    const players = readTable('Players');
    const player = players.rows.find((p) => String(p.player_id) === String(req.playerId));
    if (!player) throw new UserError('Player not found.');
    updateRow(players, player, { pin_hash: '', pin_salt: '', failed_tries: 0, paused_until: '' });
    deleteRowsWhere('Devices', (d) => String(d.player_id) === String(player.player_id));
    logAudit(admin, 'Reset PIN', String(player.name).trim());
    return {};
  });
}

// ---- Edit someone's picks ----------------------------------------------------

/** One player's picks for any site week, with no deadline lock. */
function handleAdminWeek(req) {
  requireAdmin(req.token);
  const week = checkSiteWeek(req.week);
  const player = findActivePlayerById(req.playerId);
  const games = weekGames(week);
  const picks = picksForWeek(week, readTable('Picks'))[player.id] || {};
  return {
    week,
    deadline: null,
    deadlineLabel: '',
    locked: false,
    games: games.map(publicGame),
    picks,
    player: { id: player.id, name: player.name },
  };
}

function handleAdminSavePicks(req) {
  const admin = requireAdmin(req.token);
  const changes = Array.isArray(req.changes) ? req.changes : [];
  if (!changes.length) return {};
  const week = checkSiteWeek(req.week);
  const player = findActivePlayerById(req.playerId);
  return withLock(() => {
    const games = weekGames(week);
    const result = applyPickChanges(week, games, player.id, changes, `commissioner:${admin.player_id}`);
    const summary = changes.map((c) => {
      const p = result.after[String(c.gameId)];
      const game = games.find((g) => String(g.game_id) === String(c.gameId));
      const label = p.team ? teamShortName(p.team) : `${teamShortName(game.away_team)}/${teamShortName(game.home_team)} (no team)`;
      return `${label}: ${p.points || 'no'} points`;
    });
    logAudit(admin, 'Edited picks', `${player.name}, Week ${week}: ${summary.join('; ')}`);
    recordWeeklyTotals(week);
    return { savedAt: result.savedAt };
  });
}

// ---- Fix totals --------------------------------------------------------------

/** Everyone's total for one week, showing automatic scores and any overrides. */
function handleAdminTotals(req) {
  requireAdmin(req.token);
  const week = Number(req.week);
  const players = activePlayers();
  const totals = readTable('WeeklyTotals');
  const games = weekGames(week);

  if (!games.length) {
    // A week from before the site: edit the imported numbers directly.
    const imported = {};
    totals.rows.forEach((r) => {
      if (Number(r.week) === week && String(r.source).trim() === 'imported') imported[String(r.player_id)] = Number(r.points) || 0;
    });
    return {
      week,
      kind: 'imported',
      players: players.map((p) => ({ id: p.id, name: p.name, points: imported[p.id] || 0, autoPoints: null, override: false, note: '' })),
    };
  }

  const overrides = weeklyOverrides(totals);
  const scores = effectiveScores(week, scoreWeek(games, picksForWeek(week, readTable('Picks'))), players, overrides);
  return {
    week,
    kind: 'site',
    players: players.map((p) => {
      const o = overrides[`${week}|${p.id}`];
      return { id: p.id, name: p.name, points: scores[p.id].points, autoPoints: scores[p.id].autoPoints, override: scores[p.id].override, note: o ? o.note : '' };
    }),
  };
}

/** Sets a player's weekly total (imported weeks) or overrides it (site weeks). */
function handleAdminSetWeekTotal(req) {
  const admin = requireAdmin(req.token);
  const week = Number(req.week);
  const points = Number(req.points);
  if (!week) throw new UserError('Choose a week.');
  if (!Number.isInteger(points) || points < 0 || points > 200) throw new UserError('Enter a whole number of points.');
  const player = findActivePlayerById(req.playerId);
  const note = String(req.note || '').slice(0, 200);
  const source = weekGames(week).length ? 'override' : 'imported';

  return withLock(() => {
    const totals = readTable('WeeklyTotals');
    const row = totals.rows.find((r) => Number(r.week) === week && String(r.player_id) === player.id && String(r.source).trim() === source);
    if (row) updateRow(totals, row, { points, note });
    else appendRecord('WeeklyTotals', { week, player_id: player.id, points, correct_picks: '', source, note });
    logAudit(admin, source === 'override' ? 'Overrode weekly total' : 'Changed weekly total', `${player.name}, Week ${week}: ${points} points${note ? ` (${note})` : ''}`);
    return {};
  });
}

/** Removes an override so the automatic score is used again. */
function handleAdminClearWeekTotal(req) {
  const admin = requireAdmin(req.token);
  const week = Number(req.week);
  const player = findActivePlayerById(req.playerId);
  return withLock(() => {
    deleteRowsWhere('WeeklyTotals', (r) => Number(r.week) === week && String(r.player_id) === player.id && String(r.source).trim() === 'override');
    logAudit(admin, 'Removed weekly override', `${player.name}, Week ${week}: back to automatic score`);
    return {};
  });
}

function handleAdminAdjustments(req) {
  requireAdmin(req.token);
  const adjustments = seasonAdjustments();
  return {
    players: activePlayers().map((p) => ({ id: p.id, name: p.name, adjustments: adjustments[p.id] || [] })),
  };
}

function handleAdminAddAdjustment(req) {
  const admin = requireAdmin(req.token);
  const player = findActivePlayerById(req.playerId);
  const points = Number(req.points);
  const reason = String(req.reason || '').trim().slice(0, 200);
  if (!Number.isInteger(points) || points === 0 || Math.abs(points) > 500) throw new UserError('Enter a whole number of points, like 5 or -5.');
  if (!reason) throw new UserError('Please add a short reason.');
  return withLock(() => {
    appendRecord('Adjustments', {
      adjustment_id: Utilities.getUuid().slice(0, 8),
      player_id: player.id,
      points,
      reason,
      created_at: new Date(),
      created_by: String(admin.name).trim(),
    });
    logAudit(admin, 'Season adjustment', `${player.name}: ${points > 0 ? '+' : ''}${points} (${reason})`);
    return {};
  });
}

function handleAdminDeleteAdjustment(req) {
  const admin = requireAdmin(req.token);
  return withLock(() => {
    const table = readTable('Adjustments');
    const row = table.rows.find((r) => String(r.adjustment_id) === String(req.adjustmentId));
    if (!row) throw new UserError('That adjustment was already removed.');
    const player = activePlayers().find((p) => p.id === String(row.player_id));
    deleteRow(table, row);
    logAudit(admin, 'Removed season adjustment', `${player ? player.name : row.player_id}: ${row.points} (${row.reason})`);
    return {};
  });
}

// ---- Fix a game result -------------------------------------------------------

function handleAdminGames(req) {
  requireAdmin(req.token);
  const week = checkSiteWeek(req.week);
  return {
    week,
    games: weekGames(week).map((g) => Object.assign(publicGame(g), {
      espnWinner: String(g.winner || ''),
      override: String(g.winner_override || ''),
    })),
  };
}

/** result: a team name, "TIE", or "" to go back to ESPN's result. */
function handleAdminSetResult(req) {
  const admin = requireAdmin(req.token);
  const week = checkSiteWeek(req.week);
  return withLock(() => {
    const table = readTable('Games');
    const game = table.rows.find((g) => Number(g.week) === week && String(g.game_id) === String(req.gameId));
    if (!game) throw new UserError('Game not found.');
    const result = String(req.result || '');
    if (result && result !== 'TIE' && result !== game.away_team && result !== game.home_team) throw new UserError('Choose one of the two teams or a tie.');
    updateRow(table, game, { winner_override: result });
    const matchup = `${teamShortName(game.away_team)} at ${teamShortName(game.home_team)}`;
    logAudit(admin, 'Changed game result', `Week ${week}, ${matchup}: ${result ? (result === 'TIE' ? 'tie' : `${teamShortName(result)} won`) : "back to ESPN's result"}`);
    recordWeeklyTotals(week);
    return {};
  });
}

// ---- Change the deadline -----------------------------------------------------

/** value: "yyyy-MM-ddTHH:mm" in Central time, or "" for the normal rule. */
function handleAdminSetDeadline(req) {
  const admin = requireAdmin(req.token);
  const value = String(req.value || '');
  let deadline = '';
  if (value) {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new UserError('Choose a date and a time.');
    deadline = Utilities.parseDate(value, TZ, "yyyy-MM-dd'T'HH:mm");
  }
  return withLock(() => {
    setConfigValue('deadline_override', deadline);
    const week = Number(getConfig().current_week);
    logAudit(admin, 'Changed deadline', `Week ${week}: ${deadline ? Utilities.formatDate(deadline, TZ, "EEE MMM d, h:mm a 'CT'") : 'back to the normal deadline'}`);
    return {};
  });
}

// ---- Helpers -----------------------------------------------------------------

/** Weeks played on the site (have games), up to the current week, newest first. */
function siteWeeks(current) {
  const weeks = {};
  readTable('Games').rows.forEach((g) => {
    const w = Number(g.week);
    if (w && (!current || w <= current)) weeks[w] = true;
  });
  return Object.keys(weeks).map(Number).sort((a, b) => b - a);
}

/** Weeks that have totals: imported weeks plus site weeks, newest first. */
function totalsWeeks(current) {
  const weeks = {};
  siteWeeks(current).forEach((w) => (weeks[w] = true));
  readTable('WeeklyTotals').rows.forEach((r) => {
    if (String(r.source).trim() === 'imported' && Number(r.week)) weeks[Number(r.week)] = true;
  });
  return Object.keys(weeks).map(Number).sort((a, b) => b - a);
}

function checkSiteWeek(value) {
  const week = Number(value);
  if (!week || !weekGames(week).length) throw new UserError('That week has no games on the site.');
  return week;
}

function findActivePlayerById(playerId) {
  const player = activePlayers().find((p) => p.id === String(playerId));
  if (!player) throw new UserError('Player not found.');
  return player;
}

function teamShortName(fullName) {
  const words = String(fullName).trim().split(/\s+/);
  return words[words.length - 1];
}

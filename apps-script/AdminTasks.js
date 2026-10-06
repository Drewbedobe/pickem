/**
 * Maintenance tasks run from the developer's computer (scripts/admin.sh) so
 * nobody has to open the script editor or edit settings by hand. Protected by
 * the private admin key in Private.js, which never goes to GitHub.
 */

const ADMIN_TASKS = {
  /** Creates missing tabs/columns, loads players, starts the timer, syncs games. */
  setup: () => {
    setup();
    return taskStatus();
  },
  /** Sets one Config value, e.g. {"configKey": "current_week", "value": 5}. */
  setConfig: (req) => {
    const allowed = TABS[0].rows.map((r) => r[0]);
    if (allowed.indexOf(req.configKey) < 0) throw new UserError(`Unknown setting ${req.configKey}`);
    withLock(() => setConfigValue(req.configKey, req.value));
    return taskStatus();
  },
  /** Refreshes the current week from ESPN right now (the timer does this every 15 minutes). */
  sync: () => {
    syncTick();
    return taskStatus();
  },
  status: () => taskStatus(),
  /**
   * Loads a week played before the site from the old spreadsheet:
   * games come from ESPN (with results), spreads/records/picks from the sheet.
   * req: { week, spreadSource, games: [{ teams: [a, b], favorite, spread, records: { team: "2-1" } }],
   *        picks: [{ name, team, points }] }
   */
  importWeek: (req) => {
    const week = Number(req.week);
    withLock(() => {
      syncWeekGames(week);
      const games = readTable('Games');
      const weekRows = games.rows.filter((g) => Number(g.week) === week);
      (req.games || []).forEach((sheetGame) => {
        const row = weekRows.find((g) => sheetGame.teams.indexOf(g.away_team) >= 0 && sheetGame.teams.indexOf(g.home_team) >= 0);
        if (!row) throw new UserError(`No ESPN game in week ${week} for ${sheetGame.teams.join(' vs ')}`);
        updateRow(games, row, {
          favorite: sheetGame.favorite || '',
          spread: sheetGame.favorite ? Math.abs(Number(sheetGame.spread)) : '',
          spread_source: sheetGame.favorite ? req.spreadSource || '' : '',
          away_record: sheetGame.records[row.away_team] || row.away_record,
          home_record: sheetGame.records[row.home_team] || row.home_record,
        });
      });

      const byName = {};
      readTable('Players').rows.forEach((p) => (byName[String(p.name).trim().toLowerCase()] = String(p.player_id)));
      const picks = readTable('Picks');
      const existing = {};
      picks.rows.forEach((p) => {
        if (Number(p.week) === week) existing[`${p.player_id}|${p.game_id}`] = p;
      });
      const now = new Date();
      const toAdd = [];
      (req.picks || []).forEach((pick) => {
        const playerId = byName[String(pick.name).trim().toLowerCase()];
        if (!playerId) throw new UserError(`Unknown player ${pick.name}`);
        const game = weekRows.find((g) => g.away_team === pick.team || g.home_team === pick.team);
        if (!game) throw new UserError(`No week ${week} game for ${pick.team}`);
        const fields = { picked_team: pick.team, points: Number(pick.points), updated_at: now, updated_by: 'import' };
        const row = existing[`${playerId}|${game.game_id}`];
        if (row) updateRow(picks, row, fields);
        else toAdd.push(Object.assign({ week, player_id: playerId, game_id: String(game.game_id) }, fields));
      });
      appendRecords('Picks', toAdd);
      recordWeeklyTotals(week);
    });
    return taskStatus();
  },
  /** Loads weekly totals for weeks before the site. req.totals: [{ week, name, points }] */
  importTotals: (req) => {
    withLock(() => {
      const byName = {};
      readTable('Players').rows.forEach((p) => (byName[String(p.name).trim().toLowerCase()] = String(p.player_id)));
      const totals = readTable('WeeklyTotals');
      const existing = {};
      totals.rows.forEach((r) => {
        if (String(r.source).trim() === 'imported') existing[`${Number(r.week)}|${r.player_id}`] = r;
      });
      const toAdd = [];
      (req.totals || []).forEach((t) => {
        const playerId = byName[String(t.name).trim().toLowerCase()];
        if (!playerId) throw new UserError(`Unknown player ${t.name}`);
        const row = existing[`${Number(t.week)}|${playerId}`];
        if (row) updateRow(totals, row, { points: Number(t.points) });
        else toAdd.push({ week: Number(t.week), player_id: playerId, points: Number(t.points), correct_picks: '', source: 'imported' });
      });
      appendRecords('WeeklyTotals', toAdd);
    });
    return taskStatus();
  },
  /** Replaces the rules text and commissioner name with the ones in Private.js. */
  applyPrivateSettings: () => {
    withLock(() => {
      setConfigValue('rules_text', PRIVATE_SEED.rulesText);
      setConfigValue('commissioner_name', PRIVATE_SEED.commissionerName);
    });
    return taskStatus();
  },
};

function handleAdminTask(req) {
  const key = typeof PRIVATE_SEED !== 'undefined' ? PRIVATE_SEED.adminKey : '';
  if (!key || String(req.key || '') !== key) throw new UserError('Not allowed.');
  const task = ADMIN_TASKS[req.task];
  if (!task) throw new UserError(`Unknown task ${req.task}`);
  try {
    return task(req);
  } catch (err) {
    // Admin tasks show the full error, since only the developer sees them.
    if (err instanceof UserError) throw err;
    throw new UserError(`${err.message}\n${err.stack || ''}`, 'task_failed');
  }
}

function taskStatus() {
  const config = getConfig();
  const week = Number(config.current_week) || null;
  const games = week ? weekGames(week) : [];
  const deadline = week ? weekDeadline(games, config) : null;
  return {
    currentWeek: week,
    games: games.length,
    deadline: deadline ? Utilities.formatDate(deadline, TZ, "EEE MMM d, h:mm a 'CT'") : null,
    players: readTable('Players').rows.filter((p) => isTrue(p.active) && isTrue(p.is_player)).length,
    timers: ScriptApp.getProjectTriggers().map((t) => t.getHandlerFunction()),
  };
}

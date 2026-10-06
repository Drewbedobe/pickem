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

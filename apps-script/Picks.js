/**
 * Making picks. A player's picks for a week are one Picks row per game:
 * picked_team (full team name) and points (1..N, each used once).
 * Every change is checked here; the website is only a convenience.
 */

function handleWeek(req) {
  const player = requirePlayer(req.token);
  const config = getConfig();
  const week = Number(config.current_week);
  if (!week) return { week: null };

  const games = weekGames(week);
  const deadline = weekDeadline(games, config);
  const picks = {};
  readTable('Picks').rows.forEach((p) => {
    if (Number(p.week) === week && String(p.player_id) === String(player.player_id)) {
      picks[String(p.game_id)] = { team: String(p.picked_team || ''), points: Number(p.points) || null };
    }
  });

  return {
    week,
    deadline: deadline ? deadline.toISOString() : null,
    deadlineLabel: deadline ? Utilities.formatDate(deadline, TZ, "EEE MMM d, h:mm a 'CT'") : '',
    locked: Boolean(deadline && new Date() >= deadline),
    games: games.map(publicGame),
    picks,
  };
}

/**
 * Saves changes to the signed-in player's picks. req.changes is a list of
 * { gameId, team, points } giving the new full state of each changed game
 * (team '' and points null mean "not picked"). A points swap sends two games.
 */
function handleSavePicks(req) {
  const player = requirePlayer(req.token);
  const changes = Array.isArray(req.changes) ? req.changes : [];
  if (!changes.length) return {};

  return withLock(() => {
    const config = getConfig();
    const week = Number(config.current_week);
    if (!week || Number(req.week) !== week) {
      throw new UserError('This week has changed. Please reload the page.', 'stale_week');
    }
    const games = weekGames(week);
    const deadline = weekDeadline(games, config);
    if (deadline && new Date() >= deadline) {
      throw new UserError('Picks are locked. The deadline has passed.', 'locked');
    }

    const gameById = {};
    games.forEach((g) => (gameById[String(g.game_id)] = g));
    const n = games.length;

    const table = readTable('Picks');
    const mine = {};
    table.rows.forEach((p) => {
      if (Number(p.week) === week && String(p.player_id) === String(player.player_id)) mine[String(p.game_id)] = p;
    });

    // Work out the player's full set of picks after the changes, and check it.
    const after = {};
    Object.keys(mine).forEach((id) => (after[id] = { team: String(mine[id].picked_team || ''), points: Number(mine[id].points) || null }));
    changes.forEach((c) => {
      const id = String(c.gameId);
      const game = gameById[id];
      if (!game) throw new UserError('That game is not part of this week. Please reload the page.', 'stale_week');
      const team = String(c.team || '');
      if (team && team !== game.away_team && team !== game.home_team) throw new UserError('That team is not in this game.');
      const points = c.points === null || c.points === '' || c.points === undefined ? null : Number(c.points);
      if (points !== null && !(Number.isInteger(points) && points >= 1 && points <= n)) {
        throw new UserError(`Points must be a number from 1 to ${n}.`);
      }
      after[id] = { team, points };
    });
    const used = {};
    Object.keys(after).forEach((id) => {
      const p = after[id].points;
      if (p === null || !gameById[id]) return;
      if (used[p]) throw new UserError(`You used ${p} points twice. Please reload the page.`, 'conflict');
      used[p] = true;
    });

    const now = new Date();
    const by = player.player_id;
    changes.forEach((c) => {
      const id = String(c.gameId);
      const fields = { picked_team: after[id].team, points: after[id].points === null ? '' : after[id].points, updated_at: now, updated_by: by };
      if (mine[id]) updateRow(table, mine[id], fields);
      else appendRecord('Picks', Object.assign({ week, player_id: player.player_id, game_id: id }, fields));
    });
    return { savedAt: now.toISOString() };
  });
}

function publicGame(g) {
  const kickoff = new Date(g.kickoff);
  return {
    id: String(g.game_id),
    kickoff: kickoff.toISOString(),
    day: Utilities.formatDate(kickoff, TZ, 'EEEE, MMM d'),
    time: Utilities.formatDate(kickoff, TZ, "h:mm a 'CT'"),
    away: { name: String(g.away_team), abbr: String(g.away_abbr || ''), record: String(g.away_record || '') },
    home: { name: String(g.home_team), abbr: String(g.home_abbr || ''), record: String(g.home_record || '') },
    favorite: String(g.favorite || ''),
    spread: g.spread === '' ? null : Number(g.spread),
    spreadSource: String(g.spread_source || ''),
    status: String(g.status || 'pre'),
    awayScore: g.away_score === '' ? null : Number(g.away_score),
    homeScore: g.home_score === '' ? null : Number(g.home_score),
    winner: gameWinner(g),
  };
}

/**
 * Scoring, the everyone's-picks grid, and season standings.
 *
 * Scoring: a correct pick earns that game's points; a tie game earns nothing.
 * Weekly winner: most points, then most correct picks; still tied = co-winners.
 *
 * Privacy: a week's picks are only ever sent to browsers after its deadline.
 * The grid shows the latest locked week, which stays up until the next
 * week's deadline passes. Season totals for weeks before the site existed
 * come from WeeklyTotals rows with source = imported.
 */

function handleGrid(req) {
  const viewer = requirePlayer(req.token);
  const config = getConfig();
  const players = activePlayers();
  const picksTable = readTable('Picks');
  const current = Number(config.current_week) || null;
  const result = { status: null, grid: null };

  let gridWeek = null;
  if (current) {
    const games = weekGames(current);
    const deadline = weekDeadline(games, config);
    const locked = Boolean(deadline && new Date() >= deadline);
    if (locked) {
      gridWeek = current;
    } else {
      gridWeek = weekGames(current - 1).length ? current - 1 : null;
      result.status = pickStatus(current, games, deadline, players, picksTable);
    }
  }
  if (gridWeek) result.grid = weekGrid(gridWeek, players, picksTable);
  result.viewerId = String(viewer.player_id);
  return result;
}

/** Before the deadline: how far along each player is, without revealing picks. */
function pickStatus(week, games, deadline, players, picksTable) {
  const done = {};
  picksTable.rows.forEach((p) => {
    if (Number(p.week) === week && p.picked_team && Number(p.points)) {
      done[String(p.player_id)] = (done[String(p.player_id)] || 0) + 1;
    }
  });
  return {
    week,
    n: games.length,
    deadlineLabel: deadline ? Utilities.formatDate(deadline, TZ, "EEE MMM d, h:mm a 'CT'") : '',
    players: players.map((p) => ({ id: p.id, name: p.name, done: done[p.id] || 0 })),
  };
}

function weekGrid(week, players, picksTable) {
  const games = weekGames(week);
  const picks = picksForWeek(week, picksTable);
  const scores = scoreWeek(games, picks);
  const final = games.length > 0 && games.every((g) => g.status === 'post');
  return {
    week,
    final,
    games: games.map(publicGame),
    players: players.map((p) => ({
      id: p.id,
      name: p.name,
      points: scores[p.id] ? scores[p.id].points : 0,
      correct: scores[p.id] ? scores[p.id].correct : 0,
      picks: picks[p.id] || {},
    })),
    winners: final ? weekWinners(players.map((p) => ({ id: p.id, points: scores[p.id] ? scores[p.id].points : 0, correct: scores[p.id] ? scores[p.id].correct : 0 }))) : [],
  };
}

function handleStandings(req) {
  requirePlayer(req.token);
  const config = getConfig();
  const players = activePlayers();
  const current = Number(config.current_week) || 0;
  const picksTable = readTable('Picks');
  const weeks = {}; // week -> { final, scores: { playerId: { points, correct|null } } }

  // Weeks before the site: imported totals.
  readTable('WeeklyTotals').rows.forEach((r) => {
    if (String(r.source).trim() !== 'imported' || !Number(r.week)) return;
    const w = Number(r.week);
    weeks[w] = weeks[w] || { final: true, scores: {} };
    weeks[w].scores[String(r.player_id)] = { points: Number(r.points) || 0, correct: r.correct_picks === '' ? null : Number(r.correct_picks) };
  });

  // Weeks played on the site: scored from picks, once their deadline has passed.
  for (let w = 1; w <= current; w++) {
    const games = weekGames(w);
    if (!games.length) continue;
    const deadline = weekDeadline(games, w === current ? config : {});
    if (!deadline || new Date() < deadline) continue;
    const scores = scoreWeek(games, picksForWeek(w, picksTable));
    weeks[w] = { final: games.every((g) => g.status === 'post'), scores };
  }

  const weekNumbers = Object.keys(weeks).map(Number).sort((a, b) => a - b);
  const rows = players.map((p) => {
    const byWeek = {};
    let total = 0;
    weekNumbers.forEach((w) => {
      const s = weeks[w].scores[p.id];
      byWeek[w] = s ? s.points : 0;
      total += byWeek[w];
    });
    return { id: p.id, name: p.name, total, weeks: byWeek };
  });
  rows.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  rows.forEach((r, i) => {
    r.rank = i > 0 && r.total === rows[i - 1].total ? rows[i - 1].rank : i + 1;
  });
  rows.forEach((r) => {
    r.tied = rows.filter((x) => x.rank === r.rank).length > 1;
  });

  const weeklyWinners = weekNumbers
    .filter((w) => weeks[w].final)
    .map((w) => {
      const entries = players.map((p) => {
        const s = weeks[w].scores[p.id] || { points: 0, correct: 0 };
        return { id: p.id, points: s.points, correct: s.correct || 0 };
      });
      const ids = weekWinners(entries);
      return { week: w, points: ids.length ? entries.find((e) => e.id === ids[0]).points : 0, names: ids.map((id) => players.find((p) => p.id === id).name) };
    });

  return {
    weeks: weekNumbers.map((w) => ({ week: w, final: weeks[w].final })),
    players: rows,
    weeklyWinners,
  };
}

/** { playerId: { gameId: { team, points } } } for one week. */
function picksForWeek(week, picksTable) {
  const out = {};
  picksTable.rows.forEach((p) => {
    if (Number(p.week) !== week) return;
    const id = String(p.player_id);
    out[id] = out[id] || {};
    out[id][String(p.game_id)] = { team: String(p.picked_team || ''), points: Number(p.points) || null };
  });
  return out;
}

/** { playerId: { points, correct } } using each game's final winner (ties earn nothing). */
function scoreWeek(games, picks) {
  const winners = {};
  games.forEach((g) => (winners[String(g.game_id)] = gameWinner(g)));
  const scores = {};
  Object.keys(picks).forEach((playerId) => {
    let points = 0;
    let correct = 0;
    Object.keys(picks[playerId]).forEach((gameId) => {
      const pick = picks[playerId][gameId];
      const winner = winners[gameId];
      if (pick.team && winner && winner !== 'TIE' && pick.team === winner) {
        correct++;
        points += pick.points || 0;
      }
    });
    scores[playerId] = { points, correct };
  });
  return scores;
}

/** Most points, then most correct picks; anyone still tied shares the win. */
function weekWinners(entries) {
  if (!entries.length) return [];
  const best = entries.reduce((a, b) => (b.points > a.points || (b.points === a.points && b.correct > a.correct) ? b : a));
  if (best.points === 0) return [];
  return entries.filter((e) => e.points === best.points && e.correct === best.correct).map((e) => e.id);
}

/** Saves a finished site week's totals into WeeklyTotals so they're visible in the Sheet. */
function recordWeeklyTotals(week) {
  const games = weekGames(week);
  if (!games.length || !games.every((g) => g.status === 'post')) return;
  const scores = scoreWeek(games, picksForWeek(week, readTable('Picks')));
  const totals = readTable('WeeklyTotals');
  const existing = {};
  totals.rows.forEach((r) => {
    if (Number(r.week) === week && String(r.source).trim() === 'site') existing[String(r.player_id)] = r;
  });
  const toAdd = [];
  activePlayers().forEach((p) => {
    const s = scores[p.id] || { points: 0, correct: 0 };
    const row = existing[p.id];
    if (!row) toAdd.push({ week, player_id: p.id, points: s.points, correct_picks: s.correct, source: 'site' });
    else if (Number(row.points) !== s.points || Number(row.correct_picks) !== s.correct) updateRow(totals, row, { points: s.points, correct_picks: s.correct });
  });
  appendRecords('WeeklyTotals', toAdd);
}

/** Active players in spreadsheet order: [{ id, name }]. */
function activePlayers() {
  return readTable('Players')
    .rows.filter((p) => p.player_id && isTrue(p.active) && isTrue(p.is_player))
    .map((p) => ({ id: String(p.player_id), name: String(p.name).trim() }));
}

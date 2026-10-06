// This Week's Picks: before the deadline, who's done (no picks shown); after
// the deadline, everyone's picks in the familiar spreadsheet layout.

const GRID_KEY = 'pickem.grid';

async function showGrid() {
  const cached = readJson(GRID_KEY);
  if (cached) renderGrid(cached);
  else renderLoading();
  try {
    const data = await api('grid', { token: storage.get(TOKEN_KEY) });
    storage.set(GRID_KEY, JSON.stringify(data));
    if (location.hash === '#/grid' && JSON.stringify(data) !== JSON.stringify(cached)) renderGrid(data);
  } catch (err) {
    if (err.code === 'signed_out') signOut();
    else if (!cached) renderError(err.message, showGrid);
  }
}

function renderGrid(data) {
  state.grid = data;
  render(`
    <button type="button" class="back-btn" data-action="home">← Home</button>
    <h1>This Week's Picks</h1>
    ${data.status ? statusHtml(data.status, data.viewerId) : ''}
    ${data.grid ? gridHtml(data.grid, data.viewerId) : (data.status ? '' : '<div class="message">No picks to show yet.</div>')}
  `);
  document.getElementById('app').onclick = (e) => {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    if (target.dataset.action === 'home') go('#/home');
    if (target.dataset.action === 'player') showPlayerPicks(target.dataset.player);
  };
}

function statusHtml(status, viewerId) {
  const players = status.players.slice().sort((a, b) => a.name.localeCompare(b.name));
  const name = (p) => (p.id === viewerId ? `<strong>${esc(p.name)} (you)</strong>` : esc(p.name));
  const done = players.filter((p) => p.done === status.n);
  const partial = players.filter((p) => p.done > 0 && p.done < status.n);
  const none = players.filter((p) => p.done === 0);
  const group = (title, kind, list, show) => (list.length ? `
    <div class="done-group ${kind}">
      <h3>${title} <span class="count">(${list.length})</span></h3>
      <p>${list.map(show).join(', ')}</p>
    </div>` : '');
  return `
    <section class="status-block">
      <h2>Week ${status.week}: who's done</h2>
      <p>Everyone's Week ${status.week} picks will show here at <strong>${esc(status.deadlineLabel)}</strong>.</p>
      ${group('All set ✓', 'done', done, name)}
      ${group('Working on it', 'partial', partial, (p) => `${name(p)} (${p.done} of ${status.n})`)}
      ${group('Not started', 'none', none, name)}
    </section>`;
}

function gridHtml(grid, viewerId) {
  // The viewer's own column comes first.
  const players = grid.players.slice().sort((a, b) => (a.id === viewerId ? -1 : b.id === viewerId ? 1 : 0));
  const top = Math.max(0, ...players.map((p) => p.points));
  const winners = new Set(grid.winners);
  const winnerNames = grid.players.filter((p) => winners.has(p.id)).map((p) => p.name);
  const finishedGames = grid.games.filter((g) => g.status === 'post').length;

  const banner = grid.final && winnerNames.length
    ? `<div class="winner-banner">🏆 Week ${grid.week} winner${winnerNames.length > 1 ? 's' : ''}: <strong>${esc(winnerNames.join(' & '))}</strong> with ${top} points</div>`
    : `<p class="lead">${finishedGames} of ${grid.games.length} games finished. Totals update as games end.</p>`;

  let lastDay = '';
  const rows = [];
  grid.games.forEach((g) => {
    if (g.day !== lastDay) {
      lastDay = g.day;
      rows.push(`<tr class="day-row"><th scope="rowgroup" class="sticky-col" title="${esc(g.day)}">${esc(g.day.slice(0, 3))}</th><td colspan="${players.length}"></td></tr>`);
    }
    [g.away, g.home].forEach((team, i) => {
      const won = g.winner && g.winner === team.name;
      const lost = g.status === 'post' && !won;
      const spread = g.favorite === team.name && g.spread !== null ? `<span class="grid-spread">−${esc(g.spread)}</span>` : '';
      rows.push(`
        <tr class="${won ? 'won' : ''} ${lost ? 'lost' : ''} ${i === 1 ? 'game-end' : ''}">
          <th scope="row" class="sticky-col team-cell">${won ? '✓ ' : ''}${esc(teamNickname(team.name))}${spread}</th>
          ${players.map((p) => {
            const pick = p.picks[g.id];
            const mine = pick && pick.team === team.name;
            return `<td class="${p.id === viewerId ? 'me' : ''}">${mine ? (pick.points || '✓') : ''}</td>`;
          }).join('')}
        </tr>`);
    });
  });

  return `
    <section>
      <h2>Week ${grid.week} picks${grid.final ? ' (final)' : ''}</h2>
      ${banner}
      <p class="grid-help">Green rows are winning teams. Each column is one person; numbers are their points. Tap a name to see just their picks. Slide sideways to see everyone.</p>
      <div class="grid-wrap">
        <table class="pick-grid">
          <thead>
            <tr>
              <th class="sticky-col corner">Team</th>
              ${players.map((p) => `<th class="${p.id === viewerId ? 'me' : ''}"><button type="button" class="name-link" data-action="player" data-player="${esc(p.id)}">${esc(p.name)}</button></th>`).join('')}
            </tr>
            <tr class="totals-row">
              <th class="sticky-col corner">Points</th>
              ${players.map((p) => `<th class="${p.id === viewerId ? 'me' : ''} ${p.points === top && top > 0 ? 'leader' : ''}">${winners.has(p.id) ? '🏆' : ''}${p.points}</th>`).join('')}
            </tr>
          </thead>
          <tbody>${rows.join('')}</tbody>
        </table>
      </div>
    </section>`;
}

/** One person's picks as a simple list, highest points first. */
function showPlayerPicks(playerId) {
  const grid = state.grid.grid;
  const player = grid.players.find((p) => p.id === playerId);
  const lines = grid.games
    .map((g) => ({ g, pick: player.picks[g.id] }))
    .filter((x) => x.pick && x.pick.team)
    .sort((a, b) => (b.pick.points || 0) - (a.pick.points || 0))
    .map(({ g, pick }) => {
      let result = '<span class="result pending">Not played yet</span>';
      if (g.winner === 'TIE') result = '<span class="result lost">Tie, 0</span>';
      else if (g.winner) result = g.winner === pick.team ? '<span class="result won">✓ Won</span>' : '<span class="result lost">✗ Lost</span>';
      return `<li><span class="pts">${pick.points || '–'}</span><span class="team">${esc(teamNickname(pick.team))}</span>${result}</li>`;
    });

  const sheet = document.createElement('div');
  sheet.className = 'sheet-backdrop';
  sheet.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
      <h2 id="sheet-title">${esc(player.name)}'s Week ${grid.week} picks</h2>
      <p class="sheet-help">${player.points} points so far · ${player.correct} correct</p>
      ${lines.length ? `<ul class="player-picks">${lines.join('')}</ul>` : '<p>No picks this week.</p>'}
      <div class="sheet-actions"><button type="button" class="secondary-btn" data-sheet="close">Close</button></div>
    </div>`;
  document.body.appendChild(sheet);
  document.body.classList.add('sheet-open');
  const close = () => {
    sheet.remove();
    document.body.classList.remove('sheet-open');
    document.onkeydown = null;
  };
  sheet.addEventListener('click', (e) => {
    if (e.target === sheet || e.target.closest('[data-sheet="close"]')) close();
  });
  document.onkeydown = (e) => {
    if (e.key === 'Escape') close();
  };
  sheet.querySelector('[data-sheet="close"]').focus({ preventScroll: true });
}

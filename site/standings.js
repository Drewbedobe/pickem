// Season Standings: everyone ranked by season total. Tap a row to see that
// person's week-by-week points. Wide screens also get the spreadsheet layout.

const STANDINGS_KEY = 'pickem.standings';

async function showStandings() {
  const cached = readJson(STANDINGS_KEY);
  if (cached) renderStandings(cached);
  else renderLoading();
  try {
    const data = await api('standings', { token: storage.get(TOKEN_KEY) });
    storage.set(STANDINGS_KEY, JSON.stringify(data));
    if (location.hash === '#/standings' && JSON.stringify(data) !== JSON.stringify(cached)) renderStandings(data);
  } catch (err) {
    if (err.code === 'signed_out') signOut();
    else if (!cached) renderError(err.message, showStandings);
  }
}

function renderStandings(data) {
  const viewerId = state.session.player.id;
  const lastWeek = data.weeks.length ? data.weeks[data.weeks.length - 1] : null;
  const winnersByWeek = {};
  data.weeklyWinners.forEach((w) => (winnersByWeek[w.week] = w.names));

  const throughText = !lastWeek
    ? 'No weeks have been played yet.'
    : lastWeek.final
      ? `Through Week ${lastWeek.week}.`
      : `Through Week ${lastWeek.week} (games still being played).`;

  render(`
    <button type="button" class="back-btn" data-action="home">← Home</button>
    <h1>Season Standings</h1>
    <p class="lead">${throughText} Tap a name to see each week.${data.players.some((p) => (p.overridden || []).length) ? ' * = changed by the commissioner.' : ''}</p>
    <ol class="standings">
      ${data.players.map((p) => `
        <li class="${p.id === viewerId ? 'me' : ''}">
          <button type="button" class="standing-row" data-action="toggle" aria-expanded="false">
            <span class="rank">${p.tied ? 'T-' : ''}${p.rank}</span>
            <span class="name">${esc(p.name)}</span>
            <span class="total">${p.total}</span>
          </button>
          <div class="week-breakdown" hidden>
            ${data.weeks.map((w) => {
              const won = (winnersByWeek[w.week] || []).includes(p.name);
              const changed = (p.overridden || []).includes(w.week) ? '*' : '';
              return `<span class="week-chip ${won ? 'won' : ''}">Week ${w.week}: <strong>${p.weeks[w.week]}${changed}</strong>${won ? ' 🏆' : ''}</span>`;
            }).join('')}
            ${(p.adjustments || []).map((a) => `<span class="week-chip adjust">Adjustment: <strong>${a.points > 0 ? '+' : ''}${a.points}</strong> (${esc(a.reason)})</span>`).join('')}
          </div>
        </li>`).join('')}
    </ol>

    ${data.weeklyWinners.length ? `
      <h2>Weekly winners</h2>
      <ul class="weekly-winners">
        ${data.weeklyWinners.map((w) => `<li>Week ${w.week}: <strong>${esc(w.names.join(' & ') || 'None')}</strong>${w.names.length ? ` (${w.points})` : ''}</li>`).join('')}
      </ul>` : ''}

    ${data.weeks.length ? `
      <section class="wide-only">
        <h2>Spreadsheet view</h2>
        <div class="grid-wrap">
          <table class="pick-grid season-grid">
            <thead><tr><th class="sticky-col corner">Week</th>${data.players.map((p) => `<th class="${p.id === viewerId ? 'me' : ''}">${esc(p.name)}</th>`).join('')}</tr></thead>
            <tbody>
              ${data.weeks.map((w) => `<tr><th scope="row" class="sticky-col">${w.week}</th>${data.players.map((p) => `<td class="${p.id === viewerId ? 'me' : ''}">${p.weeks[w.week]}</td>`).join('')}</tr>`).join('')}
              <tr class="totals-row"><th scope="row" class="sticky-col">Total</th>${data.players.map((p) => `<td class="${p.id === viewerId ? 'me' : ''}">${p.total}</td>`).join('')}</tr>
            </tbody>
          </table>
        </div>
      </section>` : ''}
  `);

  document.getElementById('app').onclick = (e) => {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    if (target.dataset.action === 'home') go('#/home');
    if (target.dataset.action === 'toggle') {
      const panel = target.nextElementSibling;
      panel.hidden = !panel.hidden;
      target.setAttribute('aria-expanded', String(!panel.hidden));
    }
  };
}

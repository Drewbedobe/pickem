// Commissioner Tools: only shown to admins, and the server checks every
// action too. Screens live under #/admin/...

async function showAdmin(parts) {
  if (!state.session.player.isAdmin) {
    go('#/home');
    return;
  }
  const [section, a, b] = parts;
  if (!section) return adminHome();
  if (section === 'pins') return adminPins();
  if (section === 'picks' && !a) return adminChooseWeek('picks', "Edit someone's picks", 'Which week?');
  if (section === 'picks' && !b) return adminChoosePlayer(Number(a));
  if (section === 'picks') return adminEditPicks(Number(a), b);
  if (section === 'totals' && !a) return adminChooseWeek('totals', 'Fix weekly totals', 'Which week?');
  if (section === 'totals') return adminTotals(Number(a));
  if (section === 'adjust') return adminAdjustments();
  if (section === 'results' && !a) return adminChooseWeek('results', 'Fix a game result', 'Which week?');
  if (section === 'results') return adminResults(Number(a));
  if (section === 'deadline') return adminDeadline();
  go('#/admin');
}

/** Loads data for an admin screen, showing loading and errors in the usual way. */
async function adminLoad(action, params, retry) {
  renderLoading();
  try {
    return await api(action, Object.assign({ token: storage.get(TOKEN_KEY) }, params));
  } catch (err) {
    if (err.code === 'signed_out') signOut();
    else if (err.code === 'not_admin') go('#/home');
    else renderError(err.message, retry);
    return null;
  }
}

/** Runs an admin change; shows the error in a panel if it fails. Returns true on success. */
async function adminDo(action, params) {
  try {
    await api(action, Object.assign({ token: storage.get(TOKEN_KEY) }, params));
    return true;
  } catch (err) {
    await showSheet({ title: "That didn't work", body: `<p class="sheet-help">${esc(err.message)}</p>`, buttons: [{ label: 'OK', value: 'ok', kind: 'secondary' }] });
    return false;
  }
}

function adminBack(hash, label) {
  return `<button type="button" class="back-btn" data-go="${esc(hash)}">← ${esc(label)}</button>`;
}

/** Shared click handling: [data-go] buttons navigate; others are handled per screen. */
function bindAdmin(handler) {
  document.getElementById('app').onclick = (e) => {
    const nav = e.target.closest('[data-go]');
    if (nav) {
      go(nav.dataset.go);
      return;
    }
    if (handler) handler(e);
  };
}

let adminOverviewCache = null;

async function adminHome() {
  const data = await adminLoad('adminOverview', {}, adminHome);
  if (!data) return;
  adminOverviewCache = data;
  render(`
    ${adminBack('#/home', 'Home')}
    <h1>Commissioner Tools</h1>
    <p class="lead">Only you can see this. Every change is recorded in the Sheet's AuditLog tab.</p>
    <nav class="home-buttons">
      <button type="button" class="big-btn" data-go="#/admin/pins">Players &amp; PINs</button>
      <button type="button" class="big-btn" data-go="#/admin/picks">Edit someone's picks</button>
      <button type="button" class="big-btn" data-go="#/admin/totals">Fix weekly totals</button>
      <button type="button" class="big-btn" data-go="#/admin/adjust">Season adjustments</button>
      <button type="button" class="big-btn" data-go="#/admin/results">Fix a game result</button>
      <button type="button" class="big-btn" data-email>Email me Week ${esc(data.currentWeek)}'s spreadsheet
        <small>It's also emailed automatically after each deadline</small></button>
      <button type="button" class="big-btn" data-go="#/admin/deadline">Change the deadline
        <small>Week ${esc(data.currentWeek)}: ${esc(data.deadlineLabel)}${data.deadlineOverridden ? ' (changed)' : ''}</small></button>
    </nav>
    <h2>Recent changes</h2>
    ${data.log.length
      ? `<ul class="audit-log">${data.log.map((l) => `<li><span class="when">${esc(l.when)}</span> <strong>${esc(l.action)}</strong>: ${esc(l.details)}</li>`).join('')}</ul>`
      : '<p>No changes yet.</p>'}
  `);
  bindAdmin(async (e) => {
    if (!e.target.closest('[data-email]')) return;
    const { value } = await showSheet({
      title: `Email Week ${data.currentWeek}'s spreadsheet?`,
      body: `<p class="sheet-help">An Excel file with everyone's Week ${data.currentWeek} picks so far will be sent to your email in a minute or two.</p>`,
      buttons: [{ label: 'Yes, email it', value: 'yes', kind: 'primary' }, { label: 'No, go back', value: 'no', kind: 'secondary' }],
    });
    if (value === 'yes' && (await adminDo('adminEmailSheet', { week: data.currentWeek }))) {
      await showSheet({ title: 'Sent! Check your email.', buttons: [{ label: 'OK', value: 'ok', kind: 'secondary' }] });
      adminHome();
    }
  });
}

async function overview() {
  if (adminOverviewCache) return adminOverviewCache;
  adminOverviewCache = await adminLoad('adminOverview', {}, () => route());
  return adminOverviewCache;
}

// ---- Players & PINs --------------------------------------------------------

async function adminPins() {
  const data = await adminLoad('adminOverview', {}, adminPins);
  if (!data) return;
  adminOverviewCache = data;
  const players = data.players.slice().sort((a, b) => a.name.localeCompare(b.name));
  render(`
    ${adminBack('#/admin', 'Commissioner Tools')}
    <h1>Players &amp; PINs</h1>
    <p class="lead">Resetting a PIN signs that person out everywhere. Next time they tap their name, they make a new PIN.</p>
    <ul class="admin-list">
      ${players.map((p) => `
        <li>
          <span class="name">${esc(p.name)}</span>
          <span class="badge ${p.hasPin ? 'done' : 'none'}">${p.hasPin ? 'Has PIN' : 'No PIN yet'}</span>
          ${p.hasPin ? `<button type="button" class="small-btn" data-reset="${esc(p.id)}">Reset PIN</button>` : '<span class="small-btn-space"></span>'}
        </li>`).join('')}
    </ul>
  `);
  bindAdmin(async (e) => {
    const btn = e.target.closest('[data-reset]');
    if (!btn) return;
    const player = players.find((p) => p.id === btn.dataset.reset);
    const { value } = await showSheet({
      title: `Reset ${player.name}'s PIN?`,
      body: `<p class="sheet-help">${esc(player.name)} will be signed out on every phone and computer, and will make a new PIN the next time they tap their name.</p>`,
      buttons: [{ label: 'Yes, reset PIN', value: 'yes', kind: 'danger' }, { label: 'No, go back', value: 'no', kind: 'secondary' }],
    });
    if (value === 'yes' && (await adminDo('adminResetPin', { playerId: player.id }))) adminPins();
  });
}

// ---- Choose a week / a player -------------------------------------------------

async function adminChooseWeek(section, title, prompt) {
  const data = await overview();
  if (!data) return;
  const weeks = section === 'totals' ? data.totalsWeeks : data.siteWeeks;
  render(`
    ${adminBack('#/admin', 'Commissioner Tools')}
    <h1>${esc(title)}</h1>
    <p class="lead">${esc(prompt)}</p>
    <div class="name-grid">
      ${weeks.map((w) => `<button type="button" class="name-btn" data-go="#/admin/${section}/${w}">Week ${w}${w === data.currentWeek ? '<br><small>this week</small>' : ''}</button>`).join('')}
    </div>
  `);
  bindAdmin();
}

async function adminChoosePlayer(week) {
  const data = await overview();
  if (!data) return;
  const players = data.players.slice().sort((a, b) => a.name.localeCompare(b.name));
  render(`
    ${adminBack('#/admin/picks', 'Choose another week')}
    <h1>Week ${week}: whose picks?</h1>
    <div class="name-grid">
      ${players.map((p) => `<button type="button" class="name-btn" data-go="#/admin/picks/${week}/${esc(p.id)}">${esc(p.name)}</button>`).join('')}
    </div>
  `);
  bindAdmin();
}

async function adminEditPicks(week, playerId) {
  const data = await adminLoad('adminWeek', { week, playerId }, () => adminEditPicks(week, playerId));
  if (!data) return;
  renderPicks(data, data.player);
}

// ---- Fix weekly totals --------------------------------------------------------

async function adminTotals(week) {
  const data = await adminLoad('adminTotals', { week }, () => adminTotals(week));
  if (!data) return;
  const players = data.players.slice().sort((a, b) => a.name.localeCompare(b.name));
  const explain = data.kind === 'imported'
    ? 'This week came from the old spreadsheet. Tap a name to change their total.'
    : 'Totals are scored automatically from picks. Tap a name to replace their total with your own number. Changed totals show a *. Fixing their picks or a game result is usually better, so the grid and total agree.';
  render(`
    ${adminBack('#/admin/totals', 'Choose another week')}
    <h1>Week ${week} totals</h1>
    <p class="lead">${esc(explain)}</p>
    <ul class="admin-list">
      ${players.map((p) => `
        <li>
          <button type="button" class="admin-row-btn" data-player="${esc(p.id)}">
            <span class="name">${esc(p.name)}</span>
            <span class="total">${p.points}${p.override ? '*' : ''}</span>
          </button>
          ${p.override ? `<div class="row-note">Automatic score: ${p.autoPoints}${p.note ? ` · ${esc(p.note)}` : ''}</div>` : ''}
        </li>`).join('')}
    </ul>
  `);
  bindAdmin(async (e) => {
    const btn = e.target.closest('[data-player]');
    if (!btn) return;
    const p = players.find((x) => x.id === btn.dataset.player);
    const buttons = [{ label: 'Save', value: 'save', kind: 'primary' }];
    if (p.override) buttons.push({ label: `Go back to automatic score (${p.autoPoints})`, value: 'auto', kind: 'secondary' });
    buttons.push({ label: 'Cancel', value: 'cancel', kind: 'secondary' });
    const { value, fields } = await showSheet({
      title: `${p.name}'s Week ${week} total`,
      body: `
        <label class="field-label" for="f-points">Points</label>
        <input id="f-points" class="text-field" name="points" type="number" inputmode="numeric" min="0" max="200" value="${p.points}">
        ${data.kind === 'site' ? `<label class="field-label" for="f-note">Reason (optional)</label>
        <input id="f-note" class="text-field" name="note" type="text" maxlength="200" value="${esc(p.note)}" placeholder="e.g. late picks by phone">` : ''}`,
      buttons,
    });
    let ok = false;
    if (value === 'save') ok = await adminDo('adminSetWeekTotal', { week, playerId: p.id, points: Number(fields.points), note: fields.note || '' });
    if (value === 'auto') ok = await adminDo('adminClearWeekTotal', { week, playerId: p.id });
    if (ok) adminTotals(week);
  });
}

// ---- Season adjustments -------------------------------------------------------

async function adminAdjustments() {
  const data = await adminLoad('adminAdjustments', {}, adminAdjustments);
  if (!data) return;
  const players = data.players.slice().sort((a, b) => a.name.localeCompare(b.name));
  const withAdj = players.filter((p) => p.adjustments.length);
  render(`
    ${adminBack('#/admin', 'Commissioner Tools')}
    <h1>Season adjustments</h1>
    <p class="lead">Add or take away points from someone's season total. Each adjustment shows in their standings with your reason.</p>
    <button type="button" class="big-btn" data-add>Add an adjustment</button>
    <h2>Current adjustments</h2>
    ${withAdj.length ? `<ul class="admin-list">
      ${withAdj.map((p) => p.adjustments.map((a) => `
        <li>
          <span class="name">${esc(p.name)}</span>
          <span class="total">${a.points > 0 ? '+' : ''}${a.points}</span>
          <button type="button" class="small-btn" data-remove="${esc(a.id)}">Remove</button>
          <div class="row-note">${esc(a.reason)}</div>
        </li>`).join('')).join('')}
    </ul>` : '<p>None yet.</p>'}
  `);
  bindAdmin(async (e) => {
    if (e.target.closest('[data-add]')) {
      const { value, fields } = await showSheet({
        title: 'Add a season adjustment',
        body: `
          <label class="field-label" for="f-player">Player</label>
          <select id="f-player" class="text-field" name="playerId">
            ${players.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}
          </select>
          <label class="field-label" for="f-points">Points (use a minus sign to take points away, like -5)</label>
          <input id="f-points" class="text-field" name="points" type="text" inputmode="numbers-and-punctuation" placeholder="5 or -5">
          <label class="field-label" for="f-reason">Reason</label>
          <input id="f-reason" class="text-field" name="reason" type="text" maxlength="200" placeholder="e.g. scoring fix, Week 2">`,
        buttons: [{ label: 'Add adjustment', value: 'add', kind: 'primary' }, { label: 'Cancel', value: 'cancel', kind: 'secondary' }],
      });
      if (value === 'add' && (await adminDo('adminAddAdjustment', { playerId: fields.playerId, points: Number(String(fields.points).replace('+', '').trim()), reason: fields.reason }))) adminAdjustments();
      return;
    }
    const remove = e.target.closest('[data-remove]');
    if (remove) {
      const { value } = await showSheet({
        title: 'Remove this adjustment?',
        buttons: [{ label: 'Yes, remove it', value: 'yes', kind: 'danger' }, { label: 'No, go back', value: 'no', kind: 'secondary' }],
      });
      if (value === 'yes' && (await adminDo('adminDeleteAdjustment', { adjustmentId: remove.dataset.remove }))) adminAdjustments();
    }
  });
}

// ---- Fix a game result --------------------------------------------------------

async function adminResults(week) {
  const data = await adminLoad('adminGames', { week }, () => adminResults(week));
  if (!data) return;
  render(`
    ${adminBack('#/admin/results', 'Choose another week')}
    <h1>Week ${week} results</h1>
    <p class="lead">Results come from ESPN automatically. Only change one if ESPN is wrong. Scores update right away.</p>
    ${data.games.map((g) => {
      const espn = g.espnWinner ? (g.espnWinner === 'TIE' ? 'Tie' : `${teamNickname(g.espnWinner)} won`) : 'Not finished';
      const current = g.winner;
      const opt = (value, label) => `<button type="button" class="result-btn ${current === value ? 'chosen' : ''}" data-game="${esc(g.id)}" data-result="${esc(value)}">${current === value ? '✓ ' : ''}${esc(label)}</button>`;
      return `
        <section class="game-card">
          <div class="game-time">${esc(g.day)} · ${esc(teamNickname(g.away.name))} at ${esc(teamNickname(g.home.name))}${g.awayScore !== null ? ` · ${g.awayScore}–${g.homeScore}` : ''}</div>
          <div class="result-row">
            ${opt(g.away.name, `${teamNickname(g.away.name)} won`)}
            ${opt('TIE', 'Tie')}
            ${opt(g.home.name, `${teamNickname(g.home.name)} won`)}
          </div>
          <div class="row-note">ESPN: ${esc(espn)}${g.override ? ` · <strong>You changed this.</strong> <button type="button" class="link-btn" data-game="${esc(g.id)}" data-result="">Use ESPN's result</button>` : ''}</div>
        </section>`;
    }).join('')}
  `);
  bindAdmin(async (e) => {
    const btn = e.target.closest('[data-result]');
    if (!btn) return;
    const game = data.games.find((g) => g.id === btn.dataset.game);
    const result = btn.dataset.result;
    if (result && result === game.winner && !game.override) return; // already ESPN's result
    const label = !result ? "go back to ESPN's result" : result === 'TIE' ? 'mark this game a tie' : `say the ${teamNickname(result)} won`;
    const { value } = await showSheet({
      title: `Change this result?`,
      body: `<p class="sheet-help">${esc(teamNickname(game.away.name))} at ${esc(teamNickname(game.home.name))}: ${esc(label)}. Everyone's scores for Week ${week} will update.</p>`,
      buttons: [{ label: 'Yes, change it', value: 'yes', kind: 'primary' }, { label: 'No, go back', value: 'no', kind: 'secondary' }],
    });
    if (value === 'yes' && (await adminDo('adminSetResult', { week, gameId: game.id, result }))) adminResults(week);
  });
}

// ---- Change the deadline ------------------------------------------------------

async function adminDeadline() {
  const data = await adminLoad('adminOverview', {}, adminDeadline);
  if (!data) return;
  adminOverviewCache = data;
  render(`
    ${adminBack('#/admin', 'Commissioner Tools')}
    <h1>Week ${esc(data.currentWeek)} deadline</h1>
    <div class="message">Picks are due <strong>${esc(data.deadlineLabel)}</strong>${data.deadlineOverridden ? ' (you changed this)' : ' (the normal deadline: 12:00 PM CT on the day of the first game)'}.</div>
    <label class="field-label" for="f-date">New date</label>
    <input id="f-date" class="text-field" type="date">
    <label class="field-label" for="f-time">New time (Central)</label>
    <input id="f-time" class="text-field" type="time" value="12:00">
    <button type="button" class="big-btn" data-save>Save new deadline</button>
    ${data.deadlineOverridden ? '<button type="button" class="secondary-btn clear-all-btn" data-normal>Go back to the normal deadline</button>' : ''}
    <p class="help">A changed deadline only applies to this week. Next week goes back to normal automatically.</p>
  `);
  bindAdmin(async (e) => {
    let value = null;
    if (e.target.closest('[data-save]')) {
      const date = document.getElementById('f-date').value;
      const time = document.getElementById('f-time').value;
      if (!date || !time) {
        await showSheet({ title: 'Choose a date and a time first.', buttons: [{ label: 'OK', value: 'ok', kind: 'secondary' }] });
        return;
      }
      value = `${date}T${time}`;
    } else if (e.target.closest('[data-normal]')) {
      value = '';
    } else {
      return;
    }
    if (await adminDo('adminSetDeadline', { value })) {
      adminOverviewCache = null;
      state.week = null;
      storage.remove(WEEK_KEY);
      adminDeadline();
    }
  });
}

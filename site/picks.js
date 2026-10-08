// Make My Picks: one card per game, big team buttons, a points picker where
// taking a used number moves it (so duplicates can't happen), and automatic
// saving on every tap.

const saver = { pending: new Map(), inFlight: false };

// The picks on screen: the signed-in player's own, or (in Commissioner Tools)
// someone else's, in which case admin = { id, name } of that player.
const pickCtx = { week: null, admin: null };

function ctxKey(ctx) {
  return `${ctx.admin ? ctx.admin.id : 'me'}|${ctx.week}`;
}

function hasUnsavedPicks() {
  return saver.inFlight || saver.pending.size > 0;
}

window.addEventListener('beforeunload', (e) => {
  if (hasUnsavedPicks()) e.preventDefault();
});

async function showPicks() {
  const known = state.week || cachedWeek();
  if (known && known.week) renderPicks(known);
  else renderLoading();

  try {
    const before = JSON.stringify(state.week);
    const fresh = await loadWeek();
    if (location.hash !== '#/picks' || hasUnsavedPicks()) return;
    if (!known || JSON.stringify(fresh) !== before) renderPicks(fresh);
  } catch (err) {
    if (!known) renderError(err.message, showPicks);
  }
}

function renderPicks(week, admin = null) {
  pickCtx.week = week;
  pickCtx.admin = admin;
  if (!admin) state.week = week;
  if (!week.week) {
    render(`
      <button type="button" class="back-btn" data-action="home">← Home</button>
      <div class="message">This week's games aren't ready yet. Check back soon.</div>
    `);
    bindPicks();
    return;
  }
  if (!admin && !isOpen(week)) {
    render(`
      <button type="button" class="back-btn" data-action="home">← Home</button>
      <h1>Week ${week.week} picks</h1>
      <div class="message">Week ${week.week} picks open <strong>${esc(week.opensLabel)}</strong>. Check back then!</div>
    `);
    bindPicks();
    return;
  }
  const locked = isLocked(week);
  const n = week.games.length;

  const days = [];
  week.games.forEach((g) => {
    if (!days.length || days[days.length - 1].day !== g.day) days.push({ day: g.day, games: [] });
    days[days.length - 1].games.push(g);
  });

  const intro = admin
    ? `<div class="admin-banner">Editing <strong>${esc(admin.name)}'s</strong> Week ${week.week} picks as commissioner. Changes save right away, even after the deadline.</div>`
    : '';
  render(`
    <button type="button" class="back-btn" data-action="home">${admin ? '← Choose another player' : '← Home'}</button>
    <h1>${admin ? `${esc(admin.name)}'s Week ${week.week} picks` : `Week ${week.week} picks`}</h1>
    ${intro}
    ${admin ? '' : locked
      ? `<div class="message">Picks are locked. The deadline was ${esc(week.deadlineLabel)}.</div>`
      : `<p class="lead">Tap the team you think will win each game. Then give each game points from 1 to ${n}: more points for games you're more sure about. Each number is used once.</p>
         <p class="due">Every tap saves automatically. Picks automatically submit at <strong>${esc(week.deadlineLabel)}</strong>.</p>`}
    ${days.map((d) => `
      <h2 class="day-heading">${esc(d.day)}</h2>
      ${d.games.map((g) => gameCardHtml(g, week, locked)).join('')}
    `).join('')}
    ${locked ? '' : `
      <button type="button" class="secondary-btn clear-all-btn" data-action="clear-all">${admin ? `Clear all of ${esc(admin.name)}'s picks` : 'Clear all my picks'}</button>
      <div class="pick-footer" role="status">
        <div id="pick-progress"></div>
        <div id="pick-notice" class="pick-notice"></div>
        <div id="save-status" class="save-status"></div>
      </div>`}
  `);
  bindPicks();
  updateFooter();
}

function gameCardHtml(g, week, locked) {
  const pick = week.picks[g.id] || {};
  const hasSpread = g.favorite && g.spread !== null;
  return `
    <section class="game-card" data-game="${esc(g.id)}">
      <div class="game-time">${esc(g.time)}</div>
      <div class="teams">
        ${teamButtonHtml(g, g.away, pick.team, locked)}
        <span class="at" aria-hidden="true">at</span>
        ${teamButtonHtml(g, g.home, pick.team, locked)}
      </div>
      <button type="button" class="points-btn ${pick.points ? 'has-points' : ''}" data-action="points" ${locked ? 'disabled' : ''}
        aria-label="${pick.points ? `${pick.points} points. Tap to change.` : 'Choose points'}">
        ${pick.points ? `<strong>${pick.points}</strong> points` : 'Choose points'}
      </button>
      ${hasSpread ? `<div class="spread-note">Spread from ${esc(g.spreadSource || 'sportsbook')} · for reference only</div>` : ''}
    </section>`;
}

function teamButtonHtml(game, team, pickedTeam, locked) {
  const selected = pickedTeam === team.name;
  const logo = teamLogo(team.abbr);
  return `
    <button type="button" class="team-btn ${selected ? 'selected' : ''}" data-action="team" data-team="${esc(team.name)}"
      aria-pressed="${selected}" ${locked ? 'disabled' : ''}>
      ${logo ? `<img class="team-logo" src="${esc(logo)}" alt="" width="40" height="40" onerror="this.remove()">` : ''}
      <span class="team-city">${esc(teamCity(team.name))}</span>
      <span class="team-name">${esc(teamNickname(team.name))}</span>
      ${team.record ? `<span class="team-record">${esc(team.record)}</span>` : ''}
      ${game.favorite === team.name && game.spread !== null ? `<span class="team-spread">Spread −${esc(game.spread)}</span>` : ''}
      <span class="team-check">${selected ? (pickCtx.admin ? '✓ Picked' : '✓ Your pick') : ''}</span>
    </button>`;
}

function bindPicks() {
  document.getElementById('app').onclick = (e) => {
    const target = e.target.closest('[data-action]');
    if (!target || target.disabled) return;
    const action = target.dataset.action;
    if (action === 'home') {
      go(pickCtx.admin ? `#/admin/picks/${pickCtx.week.week}` : '#/home');
      return;
    }
    if (action === 'clear-all') {
      if (!stopIfLocked()) confirmClearAll();
      return;
    }
    const card = target.closest('[data-game]');
    if (!card) return;
    if (stopIfLocked()) return;
    if (action === 'team') chooseTeam(card.dataset.game, target.dataset.team);
    if (action === 'points') openPointsPicker(card.dataset.game);
  };
}

/** If the deadline passed while the page was open, show the locked view instead. */
function stopIfLocked() {
  if (!isLocked(pickCtx.week)) return false;
  pickCtx.week.locked = true;
  renderPicks(pickCtx.week, pickCtx.admin);
  return true;
}

function chooseTeam(gameId, team) {
  const pick = pickCtx.week.picks[gameId] || { team: '', points: null };
  if (pick.team === team) return;
  pick.team = team;
  pickCtx.week.picks[gameId] = pick;
  refreshCards([gameId]);
  setNotice('');
  queueSave([gameId]);
}

function setPoints(gameId, value) {
  const picks = pickCtx.week.picks;
  const pick = picks[gameId] || { team: '', points: null };
  if ((pick.points || null) === value) return;
  const changed = [gameId];
  let notice = '';
  if (value !== null) {
    // The number moves here; the game that had it is left without points.
    const otherId = Object.keys(picks).find((id) => id !== gameId && picks[id].points === value);
    if (otherId) {
      picks[otherId].points = null;
      changed.push(otherId);
      const label = gameLabel(otherId);
      notice = `${value} moved here from the ${label} game. Pick a new number for the ${label} game.`;
    }
  }
  pick.points = value;
  picks[gameId] = pick;
  refreshCards(changed);
  setNotice(notice);
  queueSave(changed);
}

/** Short name for a game: the team picked, or both teams if none picked yet. */
function gameLabel(gameId) {
  const p = pickCtx.week.picks[gameId];
  const g = pickCtx.week.games.find((x) => x.id === gameId);
  if (p && p.team) return teamNickname(p.team);
  return g ? `${teamNickname(g.away.name)}/${teamNickname(g.home.name)}` : '';
}

function setNotice(text) {
  const box = document.getElementById('pick-notice');
  if (box) box.textContent = text || '';
}

function confirmClearAll() {
  const sheet = document.createElement('div');
  sheet.className = 'sheet-backdrop';
  sheet.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
      <h2 id="sheet-title">${pickCtx.admin ? `Clear all of ${esc(pickCtx.admin.name)}'s` : 'Clear all your'} Week ${pickCtx.week.week} picks?</h2>
      <p class="sheet-help">This removes every team and every points number so you can start over.</p>
      <div class="sheet-actions stacked">
        <button type="button" class="big-btn danger-btn" data-sheet="yes">Yes, clear everything</button>
        <button type="button" class="secondary-btn" data-sheet="no">No, go back</button>
      </div>
    </div>`;
  document.body.appendChild(sheet);
  document.body.classList.add('sheet-open');
  const close = () => {
    sheet.remove();
    document.body.classList.remove('sheet-open');
    document.onkeydown = null;
  };
  sheet.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-sheet]');
    if (e.target === sheet || (btn && btn.dataset.sheet === 'no')) return close();
    if (btn && btn.dataset.sheet === 'yes') {
      close();
      if (stopIfLocked()) return;
      const ids = Object.keys(pickCtx.week.picks).filter((id) => pickCtx.week.picks[id].team || pickCtx.week.picks[id].points);
      ids.forEach((id) => (pickCtx.week.picks[id] = { team: '', points: null }));
      refreshCards(ids);
      setNotice('All picks cleared.');
      if (ids.length) queueSave(ids);
      window.scrollTo(0, 0);
    }
  });
  document.onkeydown = (e) => {
    if (e.key === 'Escape') close();
  };
  sheet.querySelector('[data-sheet="no"]').focus();
}

function refreshCards(gameIds) {
  const locked = isLocked(pickCtx.week);
  gameIds.forEach((id) => {
    const card = document.querySelector(`[data-game="${CSS.escape(id)}"]`);
    const game = pickCtx.week.games.find((g) => g.id === id);
    if (card && game) card.outerHTML = gameCardHtml(game, pickCtx.week, locked);
  });
  updateFooter();
}

function updateFooter() {
  const box = document.getElementById('pick-progress');
  if (!box) return;
  const { n, done, left } = pickProgress(pickCtx.week);
  if (done === n) {
    box.innerHTML = pickCtx.admin
      ? `<strong class="ok-text">All ${n} picked ✓</strong>`
      : `<strong class="ok-text">All ${n} picked ✓ You're all set.</strong><br>You can change picks until ${esc(pickCtx.week.deadlineLabel)}.`;
  } else {
    box.innerHTML = `<strong>${done} of ${n} picked</strong>${left.length ? ` · Points left: ${left.join(', ')}` : ''}`;
  }
}

// ---- Points picker -------------------------------------------------------

function openPointsPicker(gameId) {
  const week = pickCtx.week;
  const game = week.games.find((g) => g.id === gameId);
  const pick = week.picks[gameId] || {};
  const n = week.games.length;

  const ownerOf = {};
  Object.keys(week.picks).forEach((id) => {
    const p = week.picks[id];
    if (p.points) ownerOf[p.points] = id;
  });

  const whose = pickCtx.admin ? `${pickCtx.admin.name}'s` : 'your';
  const title = pick.team
    ? `Points for ${whose} ${teamNickname(pick.team)} pick`
    : `Points for ${teamNickname(game.away.name)} at ${teamNickname(game.home.name)}`;

  const buttons = [];
  for (let value = 1; value <= n; value++) {
    const owner = ownerOf[value];
    if (!owner) {
      buttons.push(`<button type="button" class="pt free" data-value="${value}">${value}</button>`);
    } else if (owner === gameId) {
      buttons.push(`<button type="button" class="pt current" data-value="${value}" aria-label="${value}, this game"><span>${value}</span><small>This game</small></button>`);
    } else {
      const label = gameLabel(owner);
      buttons.push(`<button type="button" class="pt used" data-value="${value}" aria-label="${value}, used on ${esc(label)}. Tap to move it here."><span>${value}</span><small>${esc(label)}</small></button>`);
    }
  }

  const sheet = document.createElement('div');
  sheet.className = 'sheet-backdrop';
  sheet.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
      <h2 id="sheet-title">${esc(title)}</h2>
      <p class="sheet-help">Numbers with a team name under them are already used. Tapping one moves it to this game, and that game will need a new number.</p>
      <div class="points-grid">${buttons.join('')}</div>
      <div class="sheet-actions">
        ${pick.points ? '<button type="button" class="secondary-btn" data-sheet="clear">Remove points</button>' : ''}
        <button type="button" class="secondary-btn" data-sheet="cancel">Cancel</button>
      </div>
    </div>`;
  document.body.appendChild(sheet);
  document.body.classList.add('sheet-open');

  const close = () => {
    sheet.remove();
    document.body.classList.remove('sheet-open');
    document.onkeydown = null;
    const card = document.querySelector(`[data-game="${CSS.escape(gameId)}"] .points-btn`);
    if (card) card.focus();
  };
  sheet.addEventListener('click', (e) => {
    if (e.target === sheet) return close();
    const valueBtn = e.target.closest('[data-value]');
    const actionBtn = e.target.closest('[data-sheet]');
    if (valueBtn) {
      close();
      if (!stopIfLocked()) setPoints(gameId, Number(valueBtn.dataset.value));
    } else if (actionBtn) {
      close();
      if (actionBtn.dataset.sheet === 'clear' && !stopIfLocked()) setPoints(gameId, null);
    }
  });
  document.onkeydown = (e) => {
    if (e.key === 'Escape') close();
  };
  const first = sheet.querySelector('.pt.free') || sheet.querySelector('.pt');
  if (first) first.focus();
}

// ---- Saving --------------------------------------------------------------

function queueSave(gameIds) {
  const ctx = { admin: pickCtx.admin, week: pickCtx.week.week };
  gameIds.forEach((id) => {
    const p = pickCtx.week.picks[id] || {};
    saver.pending.set(`${ctxKey(ctx)}|${id}`, { ctx, gameId: id, team: p.team || '', points: p.points || null });
  });
  if (!ctx.admin) rememberWeek();
  setSaveStatus('saving');
  flushSaves();
}

async function flushSaves() {
  if (saver.inFlight || !saver.pending.size) return;
  // Send one person's changes at a time.
  const ctx = saver.pending.values().next().value.ctx;
  const entries = [...saver.pending.entries()].filter(([, v]) => ctxKey(v.ctx) === ctxKey(ctx));
  entries.forEach(([key]) => saver.pending.delete(key));
  const changes = entries.map(([, v]) => ({ gameId: v.gameId, team: v.team, points: v.points }));
  saver.inFlight = true;

  try {
    const token = storage.get(TOKEN_KEY);
    if (ctx.admin) await api('adminSavePicks', { token, week: ctx.week, playerId: ctx.admin.id, changes });
    else await api('savePicks', { token, week: ctx.week, changes });
    saver.inFlight = false;
    if (saver.pending.size) flushSaves();
    else setSaveStatus('saved');
  } catch (err) {
    saver.inFlight = false;
    if (['network', 'server', 'busy'].includes(err.code)) {
      // Keep the changes (unless a newer tap replaced them) and try again shortly.
      entries.forEach(([key, v]) => {
        if (!saver.pending.has(key)) saver.pending.set(key, v);
      });
      setSaveStatus('retry');
      setTimeout(flushSaves, 4000);
      return;
    }
    // The server said no (deadline passed, or picks changed elsewhere): show what's really saved.
    [...saver.pending.keys()].filter((k) => k.startsWith(ctxKey(ctx))).forEach((k) => saver.pending.delete(k));
    if (err.code === 'signed_out') {
      signOut();
      return;
    }
    try {
      if (ctx.admin) {
        const fresh = await api('adminWeek', { token: storage.get(TOKEN_KEY), week: ctx.week, playerId: ctx.admin.id });
        if (location.hash === `#/admin/picks/${ctx.week}/${ctx.admin.id}`) renderPicks(fresh, fresh.player);
      } else {
        const fresh = await loadWeek();
        if (location.hash === '#/picks') renderPicks(fresh);
      }
    } catch (reloadErr) {
      /* keep showing the local picks */
    }
    setSaveStatus('error', err.message);
  }
}

function setSaveStatus(kind, message) {
  const box = document.getElementById('save-status');
  if (!box) return;
  box.className = `save-status ${kind}`;
  box.textContent = {
    saving: 'Saving…',
    saved: 'Saved ✓',
    retry: "Not saved yet. Trying again… (check your internet)",
    error: message || 'That change was not saved.',
  }[kind];
}

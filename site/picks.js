// Make My Picks: one card per game, big team buttons, a points picker that
// swaps instead of allowing duplicates, and automatic saving on every tap.

const saver = { pending: new Map(), inFlight: false };

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

function renderPicks(week) {
  state.week = week;
  if (!week.week) {
    render(`
      <button type="button" class="back-btn" data-action="home">← Home</button>
      <div class="message">This week's games aren't ready yet. Check back soon.</div>
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

  render(`
    <button type="button" class="back-btn" data-action="home">← Home</button>
    <h1>Week ${week.week} picks</h1>
    ${locked
      ? `<div class="message">Picks are locked. The deadline was ${esc(week.deadlineLabel)}.</div>`
      : `<p class="lead">Tap the team you think will win each game. Then give each game points from 1 to ${n}: more points for games you're more sure about. Each number is used once.</p>
         <p class="due">Due <strong>${esc(week.deadlineLabel)}</strong>. Every tap saves automatically.</p>`}
    ${days.map((d) => `
      <h2 class="day-heading">${esc(d.day)}</h2>
      ${d.games.map((g) => gameCardHtml(g, week, locked)).join('')}
    `).join('')}
    ${locked ? '' : `
      <div class="pick-footer" role="status">
        <div id="pick-progress"></div>
        <div id="save-status" class="save-status"></div>
      </div>`}
  `);
  bindPicks();
  updateFooter();
}

function gameCardHtml(g, week, locked) {
  const pick = week.picks[g.id] || {};
  const spread = g.favorite && g.spread !== null
    ? `Spread: ${esc(teamNickname(g.favorite))} by ${esc(g.spread)}${g.spreadSource ? ` (${esc(g.spreadSource)})` : ''}`
    : 'Spread: not available';
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
      <div class="spread">${spread} · for reference only</div>
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
      <span class="team-check">${selected ? '✓ Your pick' : ''}</span>
    </button>`;
}

function bindPicks() {
  document.getElementById('app').onclick = (e) => {
    const target = e.target.closest('[data-action]');
    if (!target || target.disabled) return;
    const action = target.dataset.action;
    if (action === 'home') {
      go('#/home');
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
  if (!isLocked(state.week)) return false;
  state.week.locked = true;
  renderPicks(state.week);
  return true;
}

function chooseTeam(gameId, team) {
  const pick = state.week.picks[gameId] || { team: '', points: null };
  if (pick.team === team) return;
  pick.team = team;
  state.week.picks[gameId] = pick;
  refreshCards([gameId]);
  queueSave([gameId]);
}

function setPoints(gameId, value) {
  const picks = state.week.picks;
  const pick = picks[gameId] || { team: '', points: null };
  const old = pick.points || null;
  if (old === value) return;
  const changed = [gameId];
  if (value !== null) {
    // Swap: the game that had this number takes this game's old number (or none).
    const otherId = Object.keys(picks).find((id) => id !== gameId && picks[id].points === value);
    if (otherId) {
      picks[otherId].points = old;
      changed.push(otherId);
    }
  }
  pick.points = value;
  picks[gameId] = pick;
  refreshCards(changed);
  queueSave(changed);
}

function refreshCards(gameIds) {
  const locked = isLocked(state.week);
  gameIds.forEach((id) => {
    const card = document.querySelector(`[data-game="${CSS.escape(id)}"]`);
    const game = state.week.games.find((g) => g.id === id);
    if (card && game) card.outerHTML = gameCardHtml(game, state.week, locked);
  });
  updateFooter();
}

function updateFooter() {
  const box = document.getElementById('pick-progress');
  if (!box) return;
  const { n, done, left } = pickProgress(state.week);
  if (done === n) {
    box.innerHTML = `<strong class="ok-text">All ${n} picked ✓ You're all set.</strong><br>You can change picks until ${esc(state.week.deadlineLabel)}.`;
  } else {
    box.innerHTML = `<strong>${done} of ${n} picked</strong>${left.length ? ` · Points left: ${left.join(', ')}` : ''}`;
  }
}

// ---- Points picker -------------------------------------------------------

function openPointsPicker(gameId) {
  const week = state.week;
  const game = week.games.find((g) => g.id === gameId);
  const pick = week.picks[gameId] || {};
  const n = week.games.length;

  const ownerOf = {};
  Object.keys(week.picks).forEach((id) => {
    const p = week.picks[id];
    if (p.points) ownerOf[p.points] = id;
  });
  const labelFor = (id) => {
    const p = week.picks[id];
    const g = week.games.find((x) => x.id === id);
    if (p && p.team) return teamNickname(p.team);
    return g ? `${g.away.abbr} / ${g.home.abbr}` : '';
  };

  const title = pick.team
    ? `Points for your ${teamNickname(pick.team)} pick`
    : `Points for ${teamNickname(game.away.name)} at ${teamNickname(game.home.name)}`;

  const buttons = [];
  for (let value = 1; value <= n; value++) {
    const owner = ownerOf[value];
    if (!owner) {
      buttons.push(`<button type="button" class="pt free" data-value="${value}">${value}</button>`);
    } else if (owner === gameId) {
      buttons.push(`<button type="button" class="pt current" data-value="${value}" aria-label="${value}, this game"><span>${value}</span><small>This game</small></button>`);
    } else {
      const label = labelFor(owner);
      buttons.push(`<button type="button" class="pt used" data-value="${value}" aria-label="${value}, used on ${esc(label)}. Tap to swap."><span>${value}</span><small>${esc(label)}</small></button>`);
    }
  }

  const sheet = document.createElement('div');
  sheet.className = 'sheet-backdrop';
  sheet.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
      <h2 id="sheet-title">${esc(title)}</h2>
      <p class="sheet-help">Bold numbers are free. Grey numbers are already used; tapping one swaps it with that game.</p>
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
  gameIds.forEach((id) => {
    const p = state.week.picks[id] || {};
    saver.pending.set(id, { team: p.team || '', points: p.points || null });
  });
  rememberWeek();
  setSaveStatus('saving');
  flushSaves();
}

async function flushSaves() {
  if (saver.inFlight || !saver.pending.size) return;
  const week = state.week.week;
  const changes = [...saver.pending.entries()].map(([gameId, p]) => ({ gameId, team: p.team, points: p.points }));
  saver.pending.clear();
  saver.inFlight = true;

  try {
    await api('savePicks', { token: storage.get(TOKEN_KEY), week, changes });
    saver.inFlight = false;
    if (saver.pending.size) flushSaves();
    else setSaveStatus('saved');
  } catch (err) {
    saver.inFlight = false;
    if (['network', 'server', 'busy'].includes(err.code)) {
      // Keep the changes (unless a newer tap replaced them) and try again shortly.
      changes.forEach((c) => {
        if (!saver.pending.has(c.gameId)) saver.pending.set(c.gameId, { team: c.team, points: c.points });
      });
      setSaveStatus('retry');
      setTimeout(flushSaves, 4000);
      return;
    }
    // The server said no (deadline passed, or picks changed elsewhere): show what's really saved.
    saver.pending.clear();
    if (err.code === 'signed_out') {
      signOut();
      return;
    }
    try {
      const fresh = await loadWeek();
      if (location.hash === '#/picks') renderPicks(fresh);
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

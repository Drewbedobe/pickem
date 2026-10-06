// App start-up and screen routing. Screens live in the URL hash (#/home,
// #/pin/P05, …) so the phone's Back button behaves as people expect.

const TOKEN_KEY = 'pickem.token';
const SESSION_KEY = 'pickem.session'; // last known name + rules, so Home shows instantly
const PLAYERS_KEY = 'pickem.players'; // last known name list, so sign-in shows instantly

const state = {
  session: null, // { player, rulesText, commissionerName } once signed in
  week: null, // this week's games and my picks
  players: null, // name list for the sign-in screen
  commissionerName: '',
};

function go(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

function route() {
  document.onkeydown = null;
  document.getElementById('app').onclick = null;
  document.querySelectorAll('.sheet-backdrop').forEach((el) => el.remove());
  document.body.classList.remove('sheet-open');
  const hash = location.hash || '#/';
  const signedIn = Boolean(state.session);

  if (!signedIn) {
    const pin = hash.match(/^#\/pin\/(.+)$/);
    if (pin) showPin(decodeURIComponent(pin[1]));
    else showWhosPlaying();
    return;
  }
  if (hash === '#/picks') showPicks();
  else showHome(); // signed-in players skip the sign-in screens
}

function setSession(session) {
  state.session = session;
  if (session) storage.set(SESSION_KEY, JSON.stringify({ player: session.player, rulesText: session.rulesText, commissionerName: session.commissionerName }));
  else storage.remove(SESSION_KEY);
  const topbar = document.getElementById('topbar');
  const rules = document.getElementById('rules');

  if (!session) {
    topbar.hidden = true;
    rules.hidden = true;
    topbar.innerHTML = '';
    rules.innerHTML = '';
    return;
  }

  topbar.innerHTML = `Playing as <strong>${esc(session.player.name)}</strong> · <button type="button" class="link-btn" id="not-you">Not you?</button>`;
  topbar.hidden = false;
  document.getElementById('not-you').addEventListener('click', signOut);

  if (session.rulesText) {
    rules.innerHTML = `<h2>Pool rules</h2><div class="rules-text">${esc(session.rulesText)}</div>`;
    rules.hidden = false;
  } else {
    rules.hidden = true;
  }
}

function signOut() {
  const token = storage.get(TOKEN_KEY);
  storage.remove(TOKEN_KEY);
  storage.remove(WEEK_KEY);
  state.week = null;
  setSession(null);
  if (token) api('logout', { token }).catch(() => {});
  go('#/who');
}

async function start() {
  const token = storage.get(TOKEN_KEY);
  if (!token) {
    route();
    return;
  }

  // Show Home right away from what this device remembers, then check with the
  // server in the background (each server call takes a couple of seconds).
  const cached = readJson(SESSION_KEY);
  if (cached && cached.player) {
    setSession(cached);
    route();
    refreshSession(token);
    return;
  }

  renderLoading();
  try {
    setSession(await api('me', { token }));
  } catch (err) {
    if (err.code !== 'signed_out') {
      renderError(err.message, start);
      return;
    }
    storage.remove(TOKEN_KEY);
  }
  route();
}

async function refreshSession(token) {
  try {
    const fresh = await api('me', { token });
    const nameChanged = fresh.player.name !== state.session.player.name;
    setSession(fresh);
    if (nameChanged) route();
  } catch (err) {
    // Signed out elsewhere (e.g. the commissioner reset this device): back to sign-in.
    if (err.code === 'signed_out') signOut();
  }
}

function readJson(key) {
  try {
    return JSON.parse(storage.get(key) || 'null');
  } catch (err) {
    return null;
  }
}

window.addEventListener('hashchange', route);
start();

// App start-up and screen routing. Screens live in the URL hash (#/home,
// #/pin/P05, …) so the phone's Back button behaves as people expect.

const TOKEN_KEY = 'pickem.token';

const state = {
  session: null, // { player, rulesText, commissionerName } once signed in
  players: null, // name list for the sign-in screen
  commissionerName: '',
};

function go(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

function route() {
  document.onkeydown = null;
  const hash = location.hash || '#/';
  const signedIn = Boolean(state.session);

  if (!signedIn) {
    const pin = hash.match(/^#\/pin\/(.+)$/);
    if (pin) showPin(decodeURIComponent(pin[1]));
    else showWhosPlaying();
    return;
  }
  // Signed-in players skip the sign-in screens.
  showHome();
}

function setSession(session) {
  state.session = session;
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
  setSession(null);
  if (token) api('logout', { token }).catch(() => {});
  go('#/who');
}

async function start() {
  const token = storage.get(TOKEN_KEY);
  if (token) {
    renderLoading();
    try {
      setSession(await api('me', { token }));
    } catch (err) {
      if (err.code === 'signed_out') {
        storage.remove(TOKEN_KEY);
      } else {
        renderError(err.message, start);
        return;
      }
    }
  }
  route();
}

window.addEventListener('hashchange', route);
start();

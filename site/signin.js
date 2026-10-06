// Sign-in screens: "Who's playing?" name list, PIN pad, and first-time PIN creation.

async function showWhosPlaying() {
  // Show the remembered list instantly, then refresh it from the server.
  const cached = readJson(PLAYERS_KEY);
  if (cached && cached.players) renderNameList(cached);
  else renderLoading();

  let data;
  try {
    data = await loadPlayers();
  } catch (err) {
    if (!cached) renderError(err.message, showWhosPlaying);
    return;
  }
  const changed = !cached || JSON.stringify(cached.players) !== JSON.stringify(data.players);
  const stillOnList = ['', '#', '#/', '#/who'].includes(location.hash) && !state.session;
  if (changed && stillOnList) renderNameList(data);
}

async function loadPlayers() {
  const data = await api('players');
  state.players = data.players;
  state.commissionerName = data.commissionerName;
  storage.set(PLAYERS_KEY, JSON.stringify(data));
  return data;
}

function renderNameList(data) {
  state.players = data.players;
  state.commissionerName = data.commissionerName;
  render(`
    <h1>Who's playing?</h1>
    <p class="lead">Tap your name.</p>
    <div class="name-grid">
      ${data.players.map((p) => `<button type="button" class="name-btn" data-id="${esc(p.id)}">${esc(p.name)}</button>`).join('')}
    </div>
  `);
  document.querySelectorAll('.name-btn').forEach((btn) => {
    btn.addEventListener('click', () => go(`#/pin/${btn.dataset.id}`));
  });
}

async function showPin(playerId) {
  if (!state.players) {
    renderLoading();
    try {
      await loadPlayers();
    } catch (err) {
      renderError(err.message, () => showPin(playerId));
      return;
    }
  }
  const player = state.players.find((p) => p.id === playerId);
  if (!player) {
    go('#/who');
    return;
  }
  if (player.hasPin) enterPin(player);
  else createPin(player);
}

function enterPin(player) {
  pinPad({
    player,
    title: `Hi ${player.name}!`,
    prompt: 'Enter your 4-digit PIN.',
    onComplete: (pin) =>
      api('login', { playerId: player.id, pin })
        .then(signedIn)
        .catch((err) => {
          // The remembered name list was out of date: this player has no PIN yet.
          if (err.code !== 'no_pin') throw err;
          player.hasPin = false;
          createPin(player);
        }),
    help: forgotPinHelp(),
  });
}

function createPin(player) {
  pinPad({
    player,
    title: `Hi ${player.name}!`,
    prompt: "Welcome! Make up a 4-digit PIN you'll remember.",
    onComplete: (first) => {
      pinPad({
        player,
        title: `Hi ${player.name}!`,
        prompt: 'Enter the same PIN once more to make sure.',
        onComplete: (second) => {
          if (second !== first) {
            createPin(player);
            showPinMessage("Those didn't match. Let's start over: make up a 4-digit PIN.");
            return Promise.resolve();
          }
          return api('createPin', { playerId: player.id, pin: first })
            .then(signedIn)
            .catch((err) => {
              // The remembered name list was out of date: this player already has a PIN.
              if (err.code !== 'has_pin') throw err;
              player.hasPin = true;
              enterPin(player);
              showPinMessage('You already have a PIN. Please enter it.');
            });
        },
      });
      return Promise.resolve();
    },
    help: "You'll only need it again if you use a different phone or computer.",
  });
}

function forgotPinHelp() {
  const who = state.commissionerName || 'the commissioner';
  return `Forgot your PIN? Ask ${who} to reset it.`;
}

function signedIn(session) {
  storage.set(TOKEN_KEY, session.token);
  setSession(session);
  go('#/home');
}

/**
 * Shows the PIN pad. onComplete(pin) runs when 4 digits are entered and returns
 * a promise; if it fails, the error is shown and the pad clears for another try.
 */
function pinPad({ player, title, prompt, onComplete, help }) {
  let digits = '';
  let busy = false;

  render(`
    <button type="button" class="back-btn" id="back">← Back</button>
    <h1>${esc(title)}</h1>
    <p class="lead" id="pin-prompt">${esc(prompt)}</p>
    <div class="pin-dots" aria-hidden="true">${'<span></span>'.repeat(4)}</div>
    <p class="pin-message" id="pin-message" role="alert"></p>
    <div class="pin-pad">
      ${['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => `<button type="button" data-digit="${d}">${d}</button>`).join('')}
      <span></span>
      <button type="button" data-digit="0">0</button>
      <button type="button" data-delete aria-label="Delete">⌫</button>
    </div>
    ${help ? `<p class="help">${esc(help)}</p>` : ''}
  `);

  const dots = document.querySelectorAll('.pin-dots span');
  const message = document.getElementById('pin-message');
  const update = () => dots.forEach((dot, i) => dot.classList.toggle('filled', i < digits.length));

  const press = (digit) => {
    if (busy) return;
    if (digit === null) {
      digits = digits.slice(0, -1);
    } else if (digits.length < 4) {
      digits += digit;
      message.textContent = '';
    }
    update();
    if (digits.length === 4) submit();
  };

  const submit = () => {
    busy = true;
    message.className = 'pin-message';
    message.textContent = 'Checking… this takes a few seconds.';
    onComplete(digits).catch((err) => {
      busy = false;
      digits = '';
      update();
      message.className = 'pin-message error';
      message.textContent = err.message;
    });
  };

  document.getElementById('back').addEventListener('click', () => go('#/who'));
  document.querySelectorAll('[data-digit]').forEach((btn) => btn.addEventListener('click', () => press(btn.dataset.digit)));
  document.querySelector('[data-delete]').addEventListener('click', () => press(null));

  // Typing on a computer keyboard works too.
  document.onkeydown = (e) => {
    if (/^\d$/.test(e.key)) press(e.key);
    else if (e.key === 'Backspace') press(null);
  };
}

function showPinMessage(text) {
  const message = document.getElementById('pin-message');
  message.className = 'pin-message error';
  message.textContent = text;
}

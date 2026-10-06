// Sign-in screens: "Who's playing?" name list, PIN pad, and first-time PIN creation.

async function showWhosPlaying() {
  renderLoading();
  let data;
  try {
    data = await api('players');
  } catch (err) {
    renderError(err.message, showWhosPlaying);
    return;
  }
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
      const data = await api('players');
      state.players = data.players;
      state.commissionerName = data.commissionerName;
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
    onComplete: (pin) => api('login', { playerId: player.id, pin }).then(signedIn),
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
          return api('createPin', { playerId: player.id, pin: first }).then(signedIn);
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
    message.textContent = 'Checking…';
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

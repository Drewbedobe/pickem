/**
 * Sign-in without accounts: tap your name, enter a 4-digit PIN, and the device
 * is remembered with a random token. Only hashes of PINs and tokens are stored.
 */

const MAX_PIN_TRIES = 5;
const PAUSE_MINUTES = 5;
const LAST_SEEN_EVERY_MS = 60 * 60 * 1000;

function handlePlayers() {
  const config = getConfig();
  const players = readTable('Players')
    .rows.filter((p) => p.player_id && isTrue(p.active) && isTrue(p.is_player))
    .map((p) => ({ id: String(p.player_id), name: String(p.name).trim(), hasPin: Boolean(p.pin_hash) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { players, commissionerName: String(config.commissioner_name || '') };
}

function handleLogin(req) {
  const pin = checkPinFormat(req.pin);
  return withLock(() => {
    const players = readTable('Players');
    const player = findActivePlayer(players, req.playerId);
    if (!player.pin_hash) throw new UserError("You haven't made a PIN yet. Go back and tap your name again.", 'no_pin');

    const now = new Date();
    const pausedUntil = player.paused_until ? new Date(player.paused_until) : null;
    if (pausedUntil && pausedUntil > now) {
      const minutes = Math.ceil((pausedUntil - now) / 60000);
      throw new UserError(`Too many tries. Please wait ${minutes} minute${minutes === 1 ? '' : 's'} and try again.`);
    }

    if (hashPin(pin, player.pin_salt) !== player.pin_hash) {
      const tries = (Number(player.failed_tries) || 0) + 1;
      if (tries >= MAX_PIN_TRIES) {
        updateRow(players, player, { failed_tries: 0, paused_until: new Date(now.getTime() + PAUSE_MINUTES * 60000) });
        throw new UserError(`That's not it. Too many tries, so please wait ${PAUSE_MINUTES} minutes and try again.`);
      }
      updateRow(players, player, { failed_tries: tries });
      throw new UserError("That's not it, try again.");
    }

    if (player.failed_tries || player.paused_until) updateRow(players, player, { failed_tries: 0, paused_until: '' });
    return startSession(player);
  });
}

function handleCreatePin(req) {
  const pin = checkPinFormat(req.pin);
  return withLock(() => {
    const players = readTable('Players');
    const player = findActivePlayer(players, req.playerId);
    if (player.pin_hash) throw new UserError('You already have a PIN. Go back and tap your name to enter it.', 'has_pin');
    const salt = Utilities.getUuid();
    updateRow(players, player, { pin_salt: salt, pin_hash: hashPin(pin, salt), failed_tries: 0, paused_until: '' });
    return startSession(player);
  });
}

function handleMe(req) {
  const player = requirePlayer(req.token);
  const config = getConfig();
  return {
    player: publicPlayer(player),
    rulesText: String(config.rules_text || ''),
    commissionerName: String(config.commissioner_name || ''),
  };
}

function handleLogout(req) {
  if (!req.token) return {};
  withLock(() => {
    const devices = readTable('Devices');
    const device = devices.rows.find((d) => d.token_hash === hashToken(req.token));
    if (device) deleteRow(devices, device);
  });
  return {};
}

/** Returns the signed-in player's row, or throws if the token isn't valid. */
function requirePlayer(token) {
  if (!token) throw new UserError('Please sign in.', 'signed_out');
  const tokenHash = hashToken(token);
  const device = readTable('Devices').rows.find((d) => d.token_hash === tokenHash);
  const player = device && readTable('Players').rows.find((p) => String(p.player_id) === String(device.player_id));
  if (!player || !isTrue(player.active)) throw new UserError('Please sign in.', 'signed_out');

  const lastSeen = device.last_seen_at ? new Date(device.last_seen_at).getTime() : 0;
  if (Date.now() - lastSeen > LAST_SEEN_EVERY_MS) {
    withLock(() => {
      const devices = readTable('Devices');
      const fresh = devices.rows.find((d) => d.token_hash === tokenHash);
      if (fresh) updateRow(devices, fresh, { last_seen_at: new Date() });
    });
  }
  return player;
}

function startSession(player) {
  const token = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  const now = new Date();
  appendRecord('Devices', { token_hash: hashToken(token), player_id: player.player_id, created_at: now, last_seen_at: now });
  const config = getConfig();
  return {
    token,
    player: publicPlayer(player),
    rulesText: String(config.rules_text || ''),
    commissionerName: String(config.commissioner_name || ''),
  };
}

function findActivePlayer(players, playerId) {
  const player = players.rows.find((p) => String(p.player_id) === String(playerId) && isTrue(p.active));
  if (!player) throw new UserError("We couldn't find that name. Please go back and try again.");
  return player;
}

function publicPlayer(player) {
  return { id: String(player.player_id), name: String(player.name).trim(), isAdmin: isTrue(player.is_admin) };
}

function checkPinFormat(pin) {
  const value = String(pin || '');
  if (!/^\d{4}$/.test(value)) throw new UserError('Your PIN needs to be 4 numbers.');
  return value;
}

function hashPin(pin, salt) {
  return sha256Hex(String(salt) + ':' + pin);
}

function hashToken(token) {
  return sha256Hex(String(token));
}

function sha256Hex(text) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8)
    .map((b) => ((b + 256) % 256).toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Web API entry points.
 *
 * The website (GitHub Pages) calls this script with POST requests whose body is
 * JSON text like {"action": "ping"}. Every response is JSON:
 *   {"ok": true, "data": ...}  or  {"ok": false, "error": "Plain-language message"}
 *
 * Requests are sent as text/plain so browsers don't need a CORS preflight,
 * which Apps Script can't answer.
 */

const ACTIONS = {
  ping: handlePing,
  players: handlePlayers,
  login: handleLogin,
  createPin: handleCreatePin,
  me: handleMe,
  logout: handleLogout,
};

function doGet() {
  return respond(() => handlePing());
}

function doPost(e) {
  return respond(() => {
    let request;
    try {
      request = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    } catch (err) {
      throw new UserError('The request could not be read.');
    }
    const handler = ACTIONS[request.action];
    if (!handler) throw new UserError('Unknown request.');
    return handler(request);
  });
}

function handlePing() {
  return {
    message: "Hello from the Pick'em server",
    time: Utilities.formatDate(new Date(), 'America/Chicago', "EEE MMM d, h:mm a 'CT'"),
    tabs: SpreadsheetApp.getActiveSpreadsheet().getSheets().map((s) => s.getName()),
  };
}

/**
 * An error whose message is safe and friendly enough to show to players.
 * An optional code lets the website react (e.g. "signed_out" → show sign-in).
 */
class UserError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code || '';
  }
}

function respond(fn) {
  let body;
  try {
    body = { ok: true, data: fn() };
  } catch (err) {
    if (err instanceof UserError) {
      body = { ok: false, error: err.message, code: err.code };
    } else {
      console.error(err && err.stack ? err.stack : err);
      body = { ok: false, error: 'Something went wrong on the server. Please try again.' };
    }
  }
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
}

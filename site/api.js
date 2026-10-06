// Talks to the Apps Script server. Sent as text/plain so the browser skips the
// CORS preflight check, which Apps Script can't answer.
class ApiError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code || '';
  }
}

async function api(action, params = {}) {
  let response;
  try {
    response = await fetch(window.PICKEM_CONFIG.apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, ...params }),
    });
  } catch (err) {
    throw new ApiError("Can't reach the server. Check your internet connection and try again.", 'network');
  }
  let body;
  try {
    body = await response.json();
  } catch (err) {
    throw new ApiError('Something went wrong on the server. Please try again.', 'server');
  }
  if (!body.ok) throw new ApiError(body.error, body.code);
  return body.data;
}

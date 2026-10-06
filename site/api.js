// Talks to the Apps Script server. Sent as text/plain so the browser skips the
// CORS preflight check, which Apps Script can't answer.
async function api(action, params = {}) {
  let response;
  try {
    response = await fetch(window.PICKEM_CONFIG.apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, ...params }),
    });
  } catch (err) {
    throw new Error("Can't reach the server. Check your internet connection and try again.");
  }
  const body = await response.json();
  if (!body.ok) throw new Error(body.error);
  return body.data;
}

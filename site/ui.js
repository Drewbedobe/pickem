// Small shared helpers for building screens.

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function render(html) {
  document.getElementById('app').innerHTML = html;
  window.scrollTo(0, 0);
}

function renderLoading(message) {
  render(`<p class="loading" role="status">${esc(message || 'Loading… this can take a few seconds.')}</p>`);
}

function renderError(message, onRetry) {
  render(`
    <div class="message error" role="alert">${esc(message)}</div>
    <button type="button" class="big-btn" id="retry">Try again</button>
  `);
  document.getElementById('retry').addEventListener('click', onRetry);
}

// Browser storage can be unavailable (private browsing, blocked site data),
// so every access is wrapped and failure just means "not remembered".
const storage = {
  get(key) {
    try { return localStorage.getItem(key); } catch (err) { return null; }
  },
  set(key, value) {
    try { localStorage.setItem(key, value); } catch (err) { /* not remembered */ }
  },
  remove(key) {
    try { localStorage.removeItem(key); } catch (err) { /* nothing to remove */ }
  },
};

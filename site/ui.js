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

/**
 * Shows a panel from the bottom of the screen with buttons (and optional
 * form fields in body). Resolves with { value, fields } for the button
 * tapped, or { value: null } if dismissed. fields holds each [name] input.
 */
function showSheet({ title, body = '', buttons }) {
  return new Promise((resolve) => {
    const sheet = document.createElement('div');
    sheet.className = 'sheet-backdrop';
    sheet.innerHTML = `
      <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
        <h2 id="sheet-title">${esc(title)}</h2>
        ${body}
        <div class="sheet-actions stacked">
          ${buttons.map((b) => `<button type="button" class="${b.kind === 'secondary' ? 'secondary-btn' : `big-btn ${b.kind === 'danger' ? 'danger-btn' : ''}`}" data-sheet="${esc(b.value)}">${esc(b.label)}</button>`).join('')}
        </div>
      </div>`;
    document.body.appendChild(sheet);
    document.body.classList.add('sheet-open');

    const finish = (value) => {
      const fields = {};
      sheet.querySelectorAll('[name]').forEach((el) => (fields[el.name] = el.value));
      sheet.remove();
      document.body.classList.remove('sheet-open');
      document.onkeydown = null;
      resolve({ value, fields });
    };
    sheet.addEventListener('click', (e) => {
      if (e.target === sheet) return finish(null);
      const btn = e.target.closest('[data-sheet]');
      if (btn) finish(btn.dataset.sheet);
    });
    document.onkeydown = (e) => {
      if (e.key === 'Escape') finish(null);
    };
    const firstField = sheet.querySelector('input, select, textarea');
    if (firstField) firstField.focus({ preventScroll: true });
  });
}

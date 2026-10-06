// Phase 1: confirm the website can talk to the server.
async function checkConnection() {
  const status = document.getElementById('status');
  try {
    const data = await api('ping');
    status.className = 'status ok';
    status.textContent = `Connected ✓ ${data.message} (${data.time})`;
  } catch (err) {
    status.className = 'status error';
    status.textContent = err.message;
  }
}

checkConnection();

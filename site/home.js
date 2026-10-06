// Home screen: greeting, this week's status, and the three main buttons.

function showHome() {
  const me = state.session.player;
  render(`
    <h1>Hi ${esc(me.name)}!</h1>
    <div class="message">Picks for the next week will open here soon.</div>
    <nav class="home-buttons">
      <button type="button" class="big-btn" disabled>Make My Picks <small>Coming soon</small></button>
      <button type="button" class="big-btn" disabled>This Week's Picks <small>Coming soon</small></button>
      <button type="button" class="big-btn" disabled>Season Standings <small>Coming soon</small></button>
    </nav>
  `);
}

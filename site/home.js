// Home screen: greeting, this week's status, and the three main buttons.

function showHome() {
  const me = state.session.player;
  render(`
    <h1>Hi ${esc(me.name)}!</h1>
    <div class="message" id="week-status">${weekStatusHtml(state.week || cachedWeek())}</div>
    <nav class="home-buttons">
      <button type="button" class="big-btn" id="go-picks">Make My Picks</button>
      <button type="button" class="big-btn" disabled>This Week's Picks <small>Coming soon</small></button>
      <button type="button" class="big-btn" disabled>Season Standings <small>Coming soon</small></button>
    </nav>
  `);
  document.getElementById('go-picks').addEventListener('click', () => go('#/picks'));

  loadWeek()
    .then((week) => {
      const box = document.getElementById('week-status');
      if (box && location.hash === '#/home') box.innerHTML = weekStatusHtml(week);
    })
    .catch(() => {});
}

function weekStatusHtml(week) {
  if (!week) return 'Loading this week…';
  if (!week.week) return "This week's games aren't ready yet. Check back soon.";
  const { n, done } = pickProgress(week);
  if (isLocked(week)) return `Week ${week.week} picks are locked.`;
  const due = `Picks are due <strong>${esc(week.deadlineLabel)}</strong>.`;
  if (done === n) return `<span class="ok-text">Week ${week.week}: All ${n} picked ✓</span><br>You can change picks until ${esc(week.deadlineLabel)}.`;
  if (done === 0) return `Week ${week.week}: Not started.<br>${due}`;
  return `Week ${week.week}: ${done} of ${n} picked.<br>${due}`;
}

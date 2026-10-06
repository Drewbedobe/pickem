// This week's games and the signed-in player's picks, shared by Home and
// Make My Picks. Remembered on the device so screens can show instantly,
// then refreshed from the server.

const WEEK_KEY = 'pickem.week';

function cachedWeek() {
  const cached = readJson(WEEK_KEY);
  return cached && state.session && cached.playerId === state.session.player.id ? cached.data : null;
}

async function loadWeek() {
  const data = await api('week', { token: storage.get(TOKEN_KEY) });
  // Never replace picks the player just tapped that are still being saved.
  if (!hasUnsavedPicks()) {
    state.week = data;
    rememberWeek();
  }
  return data;
}

/** Remembers the latest local picks so a quick reload shows them. */
function rememberWeek() {
  if (state.week && state.session) storage.set(WEEK_KEY, JSON.stringify({ playerId: state.session.player.id, data: state.week }));
}

function isLocked(week) {
  return Boolean(week.locked || (week.deadline && Date.now() >= Date.parse(week.deadline)));
}

/** Counts games that have both a team and points. */
function pickProgress(week) {
  const n = week.games.length;
  let done = 0;
  const used = new Set();
  week.games.forEach((g) => {
    const p = week.picks[g.id];
    if (p && p.points) used.add(p.points);
    if (p && p.team && p.points) done++;
  });
  const left = [];
  for (let i = 1; i <= n; i++) if (!used.has(i)) left.push(i);
  return { n, done, left };
}

function teamNickname(fullName) {
  const words = String(fullName).trim().split(/\s+/);
  return words[words.length - 1];
}

function teamCity(fullName) {
  const words = String(fullName).trim().split(/\s+/);
  return words.slice(0, -1).join(' ');
}

function teamLogo(abbr) {
  if (!abbr) return '';
  const path = `/i/teamlogos/nfl/500/${abbr.toLowerCase()}.png`;
  return `https://a.espncdn.com/combiner/i?img=${encodeURIComponent(path)}&h=96&w=96`;
}

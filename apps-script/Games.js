/**
 * Games come from ESPN's public scoreboard feed (free, no key, unofficial).
 * A timer runs syncTick() every 15 minutes: it refreshes the current week's
 * games and, once every game is final, moves on to the next week.
 *
 * Kickoff times, records and spreads stop updating at the pick deadline so
 * everyone sees what they picked against. Scores and winners keep updating.
 * Hand edits: winner_override (team name or TIE) always beats ESPN's result.
 */

const TZ = 'America/Chicago';
// ESPN blocks Google's servers on site.api.espn.com but not on site.web.api.espn.com.
const ESPN_SCOREBOARDS = [
  'https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard',
  'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard',
];
const ESPN_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  Accept: 'application/json',
};
const LAST_REGULAR_SEASON_WEEK = 18;

function syncTick() {
  const config = getConfig();
  const week = Number(config.current_week);
  if (!week) return;
  withLock(() => syncWeekGames(week));

  // Last week may still have games finishing (e.g. if the week was moved on by hand).
  const previous = weekGames(week - 1);
  if (previous.some((g) => g.status !== 'post')) withLock(() => syncWeekGames(week - 1));
  if (previous.length) withLock(() => recordWeeklyTotals(week - 1));

  const games = weekGames(week);
  const allFinal = games.length > 0 && games.every((g) => g.status === 'post');
  if (allFinal) withLock(() => recordWeeklyTotals(week));
  if (allFinal && week < LAST_REGULAR_SEASON_WEEK) {
    withLock(() => {
      setConfigValue('current_week', week + 1);
      setConfigValue('deadline_override', '');
      syncWeekGames(week + 1);
    });
  }
}

/** Loads or refreshes one week's games from ESPN into the Games tab. */
function syncWeekGames(week) {
  const config = getConfig();
  const events = fetchEspnWeek(Number(config.season), week);

  const table = readTable('Games');
  const existing = {};
  table.rows.filter((g) => Number(g.week) === week).forEach((g) => (existing[String(g.game_id)] = g));
  const current = Object.keys(existing).map((id) => existing[id]);
  const deadline = current.length ? weekDeadline(current, config) : null;
  const frozen = deadline && new Date() >= deadline;

  events.forEach((event) => {
    const fields = gameFieldsFromEspn(event);
    const row = existing[fields.game_id];
    if (!row) {
      appendRecord('Games', Object.assign({ week }, fields));
      return;
    }
    const changes = {
      status: fields.status,
      away_score: fields.away_score,
      home_score: fields.home_score,
      winner: fields.winner,
    };
    if (!frozen) {
      Object.assign(changes, {
        kickoff: fields.kickoff,
        away_record: fields.away_record,
        home_record: fields.home_record,
        favorite: fields.favorite,
        spread: fields.spread,
        spread_source: fields.spread_source,
      });
    }
    const differs = Object.keys(changes).some((k) => row[k] instanceof Date !== changes[k] instanceof Date || String(row[k]) !== String(changes[k]));
    if (differs) updateRow(table, row, changes);
  });
}

function fetchEspnWeek(season, week) {
  const problems = [];
  for (const base of ESPN_SCOREBOARDS) {
    const url = `${base}?seasontype=2&week=${week}&dates=${season}`;
    const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true, headers: ESPN_HEADERS });
    if (response.getResponseCode() === 200) return JSON.parse(response.getContentText()).events || [];
    problems.push(`${base} returned ${response.getResponseCode()}`);
  }
  throw new Error(`Could not load week ${week} from ESPN: ${problems.join('; ')}`);
}

function gameFieldsFromEspn(event) {
  const comp = event.competitions[0];
  const away = comp.competitors.find((c) => c.homeAway === 'away');
  const home = comp.competitors.find((c) => c.homeAway === 'home');
  const odds = (comp.odds && comp.odds[0]) || {};
  const state = event.status && event.status.type ? event.status.type.state : 'pre';

  let favorite = '';
  if (odds.awayTeamOdds && odds.awayTeamOdds.favorite) favorite = away.team.displayName;
  else if (odds.homeTeamOdds && odds.homeTeamOdds.favorite) favorite = home.team.displayName;
  const spread = favorite && odds.spread !== undefined ? Math.abs(Number(odds.spread)) : '';

  let winner = '';
  if (state === 'post') {
    const a = Number(away.score);
    const h = Number(home.score);
    winner = a === h ? 'TIE' : a > h ? away.team.displayName : home.team.displayName;
  }

  return {
    game_id: String(event.id),
    kickoff: new Date(event.date),
    away_team: away.team.displayName,
    home_team: home.team.displayName,
    away_abbr: away.team.abbreviation,
    home_abbr: home.team.abbreviation,
    away_record: recordOf(away),
    home_record: recordOf(home),
    favorite,
    spread,
    spread_source: favorite && odds.provider ? odds.provider.name : '',
    status: state,
    away_score: state === 'pre' ? '' : Number(away.score),
    home_score: state === 'pre' ? '' : Number(home.score),
    winner,
  };
}

function recordOf(competitor) {
  const overall = (competitor.records || []).find((r) => r.type === 'total') || (competitor.records || [])[0];
  return overall ? overall.summary : '';
}

/** The week's games in kickoff order. */
function weekGames(week) {
  return readTable('Games')
    .rows.filter((g) => Number(g.week) === week && g.game_id)
    .sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff));
}

/** 6:00 AM Central on the day of the week's first game, unless Config has an override. */
function weekDeadline(games, config) {
  if (config.deadline_override instanceof Date) return config.deadline_override;
  if (!games.length) return null;
  const first = games.reduce((a, b) => (new Date(a.kickoff) <= new Date(b.kickoff) ? a : b));
  const day = Utilities.formatDate(new Date(first.kickoff), TZ, 'yyyy-MM-dd');
  return Utilities.parseDate(day + ' 06:00', TZ, 'yyyy-MM-dd HH:mm');
}

/** The result used for scoring: Jared's override if present, else ESPN's. */
function gameWinner(game) {
  return String(game.winner_override || game.winner || '').trim();
}

function setConfigValue(key, value) {
  const config = readTable('Config');
  const row = config.rows.find((r) => String(r.key).trim() === key);
  if (row) updateRow(config, row, { value });
  else appendRecord('Config', { key, value });
}

/** Run from the editor (or by setup) to start the 15-minute timer. Safe to run again. */
function installTriggers() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'syncTick')
    .forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('syncTick').timeBased().everyMinutes(15).create();
}

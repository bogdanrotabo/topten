#!/usr/bin/env node
/**
 * The NBA and NHL player lists, from the leagues' own numbers.
 *
 * These two were ten names each, written by hand into app.js. Ten is short and
 * hand-written is worse than short: a list somebody typed once is wrong the
 * season after a trade, and wrong quietly — the name is still a name, it is
 * just beside the wrong club, or belongs to somebody who has retired.
 *
 * So they are fetched. Fifty of each, ordered by what the season actually
 * says: points per game in the NBA, points in the NHL. The clubs and their
 * colours come from the team rosters already in app.js rather than from a
 * second table of colours, because two tables of the same thirty colours is
 * one table too many.
 *
 * What is NOT here is the jersey number. The NBA's stats host answers exactly
 * one endpoint from outside a browser and it does not carry the number; the
 * NHL's does. Half the list with numbers and half without reads as a bug, so
 * neither has them. The club is the useful half anyway: it tells two players
 * of the same name apart, which a number does not.
 *
 * This is a suggestion list, not a ranking. The board itself decides who is
 * biggest, by what was paid. Scoring order is just the least arbitrary way to
 * pick fifty out of five hundred.
 *
 *   node scripts/build-sport-rosters.mjs           writes scripts/sport-rosters.json
 *   node scripts/build-sport-rosters.mjs --check   fails if it is missing or old
 */
import { writeFileSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'scripts/sport-rosters.json');
const CATI = 50;
const MAX_AGE_DAYS = 120;
const UA = 'Mozilla/5.0 (compatible; TopTenOne/1.0; +https://topten.one)';

/* The season that has actually been played. Both leagues run October to June,
   so from October the current one is this year to next; before it, last year
   to this. Asked in September, that is the season that just finished, which is
   the one with a full set of numbers in it. */
function sezon(d = new Date()) {
  const an = d.getUTCFullYear();
  const de_la = d.getUTCMonth() >= 9 ? an : an - 1;
  return { nba: `${de_la}-${String((de_la + 1) % 100).padStart(2, '0')}`, nhl: `${de_la}${de_la + 1}` };
}

/* Abbreviation -> [club, ink, trim], read out of the team rosters in app.js.
   One table of colours, in the place that already had it. */
function echipe(board) {
  const src = readFileSync(join(root, 'app.js'), 'utf8');
  const m = new RegExp(`'${board}': \\[([\\s\\S]*?)\\n    \\],?`).exec(src);
  if (!m) { console.error(`build-sport-rosters: no ${board} list in app.js`); process.exit(2); }
  const map = new Map();
  for (const r of m[1].matchAll(/\[\s*'([^']*)',\s*'([^']*)',\s*'([^']*)',\s*'([^']*)'/g)) {
    map.set(r[2], [r[1], r[3], r[4]]);
  }
  return map;
}

const luat = async (u, ce) => {
  const r = await fetch(u, { headers: { 'user-agent': UA, accept: 'application/json' } });
  if (!r.ok) throw new Error(`${ce}: HTTP ${r.status}`);
  return r.json();
};

async function nba(season, teams) {
  const u = 'https://stats.nba.com/stats/leagueLeaders?LeagueID=00&PerMode=PerGame&Scope=S'
    + `&Season=${season}&SeasonType=Regular+Season&StatCategory=PTS`;
  const d = await luat(u, 'nba');
  const set = d.resultSet;
  const col = n => set.headers.indexOf(n);
  const iN = col('PLAYER'), iT = col('TEAM');
  if (iN < 0 || iT < 0) throw new Error('nba: the columns moved');
  return set.rowSet.slice(0, CATI).map(r => {
    const t = teams.get(r[iT]) || [r[iT], '#7c349a', '#ffffff'];
    return [r[iN], r[iT], t[1], t[2], t[0]];
  });
}

async function nhl(season, teams) {
  const sort = encodeURIComponent(JSON.stringify([{ property: 'points', direction: 'DESC' }]));
  const u = `https://api.nhle.com/stats/rest/en/skater/summary?limit=${CATI}&sort=${sort}`
    + `&cayenneExp=seasonId=${season}%20and%20gameTypeId=2`;
  const d = await luat(u, 'nhl');
  return (d.data || []).slice(0, CATI).map(p => {
    /* A player traded mid-season carries both clubs, newest last. */
    const ab = String(p.teamAbbrevs || '').split(',').pop().trim();
    const t = teams.get(ab) || [ab, '#7c349a', '#ffffff'];
    return [p.skaterFullName, ab, t[1], t[2], t[0]];
  });
}

const s = sezon();
const verifica = process.argv.includes('--check');

if (verifica) {
  if (!existsSync(OUT)) {
    console.error('build-sport-rosters: scripts/sport-rosters.json is missing — run node scripts/build-sport-rosters.mjs');
    process.exit(1);
  }
  const zile = (Date.now() - statSync(OUT).mtimeMs) / 86400000;
  const d = JSON.parse(readFileSync(OUT, 'utf8'));
  for (const b of ['nba-players', 'nhl-players']) {
    if (!Array.isArray(d[b]) || d[b].length < CATI) {
      console.error(`build-sport-rosters: ${b} has ${(d[b] || []).length} names, expected ${CATI}`);
      process.exit(1);
    }
  }
  /* Old is a note, not a failure. A season-old list is still fifty real
     players at their real clubs; a build that stops because a sports API is
     having a bad afternoon is worse than a list that is one trade behind. */
  console.log(zile > MAX_AGE_DAYS
    ? `build-sport-rosters: ${zile.toFixed(0)} days old — worth a rebuild.`
    : `build-sport-rosters: ${CATI} + ${CATI} names, ${zile.toFixed(1)} days old.`);
  process.exit(0);
}

const [nbaTeams, nhlTeams] = [echipe('nba-teams'), echipe('nhl-teams')];
const out = {};
let rele = 0;

for (const [cheie, fn, season, teams] of [
  ['nba-players', nba, s.nba, nbaTeams],
  ['nhl-players', nhl, s.nhl, nhlTeams],
]) {
  try {
    out[cheie] = await fn(season, teams);
    const fara = out[cheie].filter(r => !teams.has(r[1])).map(r => r[1]);
    console.log(`  ${cheie.padEnd(13)} ${out[cheie].length} names, season ${season}`
      + (fara.length ? `, clubs not in the team list: ${[...new Set(fara)].join(', ')}` : ''));
  } catch (e) {
    console.error(`  ${cheie}: ${e.message}`);
    rele++;
    /* Keep whatever is already on disk rather than shipping an empty board. */
    if (existsSync(OUT)) out[cheie] = JSON.parse(readFileSync(OUT, 'utf8'))[cheie] || [];
  }
}

if (rele === 2) { console.error('build-sport-rosters: both leagues failed, nothing written'); process.exit(1); }

writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
console.log(`build-sport-rosters: written to scripts/sport-rosters.json`);

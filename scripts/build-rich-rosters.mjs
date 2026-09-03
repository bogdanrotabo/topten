#!/usr/bin/env node
/**
 * The billionaire lists, one per country, from Forbes's own numbers.
 *
 * Twenty boards ask who should be #1 among a country's rich. The list each
 * offers is the people Forbes counts as billionaires with that citizenship,
 * richest first, thirty at most -- fetched from the real-time feed behind
 * forbes.com/real-time-billionaires, which is the same list the site shows
 * and changes every day the markets are open. A typed list of the rich is
 * wrong within the quarter: fortunes halve, founders die, somebody new sells
 * a company. This one is rebuilt with one command and checked by the build.
 *
 * Citizenship, not residence, because that is how Forbes files them and the
 * only thing that gives every country the same rule. The one exception is
 * the Emirates: eight Emiratis are billionaires, and the country's rich list
 * as anybody knows it is the people who live in Dubai and Abu Dhabi, most of
 * them holding another passport. So the UAE board takes its citizens first
 * and then its residents, and says so here.
 *
 * Each row is [name, initials, ink, trim, source, birth year]. The first five
 * are the roster row every other board uses -- the source stands where a
 * player's club would -- and the year is for the picture builder, which uses
 * it to make sure the Wikipedia article it found is this Ian Livingstone and
 * not the other one. rosters.mjs drops it before the list ships.
 *
 * This is a suggestion list, not a ranking. The board decides who is #1, by
 * what was paid. Forbes's order is just the least arbitrary way to pick
 * thirty out of nine hundred.
 *
 *   node scripts/build-rich-rosters.mjs           writes scripts/rich-rosters.json
 *   node scripts/build-rich-rosters.mjs --check   fails if it is missing or thin
 */
import { writeFileSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'scripts/rich-rosters.json');
const CATI = 30;
const MIN = 8;
const MAX_AGE_DAYS = 60;
const UA = 'Mozilla/5.0 (compatible; TopTenOne/1.0; +https://topten.one)';

/* board slug -> the country as Forbes spells it. The Emirates also name the
   cities whose residents count; nobody else does. */
export const TARI = {
  'us-billionaires':           { tara: 'United States' },
  'uk-billionaires':           { tara: 'United Kingdom' },
  'switzerland-billionaires':  { tara: 'Switzerland' },
  'uae-billionaires':          { tara: 'United Arab Emirates', orase: ['Dubai', 'Abu Dhabi', 'Sharjah', 'Ajman', 'Ras Al Khaimah'] },
  'japan-billionaires':        { tara: 'Japan' },
  'australia-billionaires':    { tara: 'Australia' },
  'china-billionaires':        { tara: 'China' },
  'israel-billionaires':       { tara: 'Israel' },
  'india-billionaires':        { tara: 'India' },
  'germany-billionaires':      { tara: 'Germany' },
  'france-billionaires':       { tara: 'France' },
  'canada-billionaires':       { tara: 'Canada' },
  'italy-billionaires':        { tara: 'Italy' },
  'brazil-billionaires':       { tara: 'Brazil' },
  'russia-billionaires':       { tara: 'Russia' },
  'saudi-arabia-billionaires': { tara: 'Saudi Arabia' },
  'singapore-billionaires':    { tara: 'Singapore' },
  'south-korea-billionaires':  { tara: 'South Korea' },
  'spain-billionaires':        { tara: 'Spain' },
  'mexico-billionaires':       { tara: 'Mexico' },
};

/* The same rule the claim form applies to a name, copied from app.js so a
   name that gets on the list is a name the form will take. */
const NAME_RE = /^(?=.{2,40}$)[\p{L}][\p{L}.'’-]*(?: [\p{L}.'’-]+){0,5}$/u;

const V = '#7c349a', W = '#ffffff';

/* "Rob Walton & family" is a Forbes accounting convention, not a name; so is
   the nickname in "Emanuele (Lino) Saputo". */
const curat = s => String(s || '')
  .replace(/\s*&\s*family\b/i, '')
  .replace(/\s*\([^)]*\)/g, '')
  .replace(/\s+/g, ' ')
  .trim();

const initiale = n => {
  const p = n.split(' ');
  return (p[0][0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
};

const sursa = s => {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t ? t[0].toUpperCase() + t.slice(1) : '';
};

const anul = ms => {
  const d = new Date(Number(ms));
  return Number.isFinite(d.getTime()) ? d.getUTCFullYear() : null;
};

if (process.argv.includes('--check')) {
  if (!existsSync(OUT)) {
    console.error('build-rich-rosters: scripts/rich-rosters.json is missing — run node scripts/build-rich-rosters.mjs');
    process.exit(1);
  }
  const d = JSON.parse(readFileSync(OUT, 'utf8'));
  for (const slug of Object.keys(TARI)) {
    if (!Array.isArray(d[slug]) || d[slug].length < MIN) {
      console.error(`build-rich-rosters: ${slug} has ${(d[slug] || []).length} names, expected at least ${MIN}`);
      process.exit(1);
    }
  }
  /* Every board named here has to be a board app.js offers, or the list is
     for a page that does not exist. */
  const app = readFileSync(join(root, 'app.js'), 'utf8');
  const lipsa = Object.keys(TARI).filter(s => !app.includes(`slug: '${s}'`));
  if (lipsa.length) {
    console.error(`build-rich-rosters: not in app.js PLATFORMS: ${lipsa.join(', ')}`);
    process.exit(1);
  }
  const zile = (Date.now() - statSync(OUT).mtimeMs) / 86400000;
  const n = Object.keys(TARI).reduce((a, s) => a + d[s].length, 0);
  console.log(zile > MAX_AGE_DAYS
    ? `build-rich-rosters: ${zile.toFixed(0)} days old — worth a rebuild.`
    : `build-rich-rosters: ${Object.keys(TARI).length} countries, ${n} names, ${zile.toFixed(1)} days old.`);
  process.exit(0);
}

const url = 'https://www.forbes.com/forbesapi/person/rtb/0/position/true.json'
  + '?fields=personName,finalWorth,countryOfCitizenship,source,birthDate,city,state&limit=3000';
let lista;
try {
  const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const d = await r.json();
  lista = d?.personList?.personsLists;
  if (!Array.isArray(lista) || lista.length < 1000) throw new Error(`only ${(lista || []).length} people in the feed — the shape has changed`);
} catch (e) {
  console.error(`build-rich-rosters: ${e.message}`);
  console.error(existsSync(OUT) ? '  keeping the file already on disk.' : '  nothing written.');
  process.exit(existsSync(OUT) ? 0 : 1);
}

/* The feed comes richest first, and stays that way through the filters. */
const out = {};
const rele = [];
for (const [slug, { tara, orase }] of Object.entries(TARI)) {
  const ai = new Set();
  const randuri = [];
  const ia = p => {
    const nume = curat(p.personName);
    if (!nume || ai.has(nume)) return;
    if (!NAME_RE.test(nume)) { rele.push(`${slug}: "${nume}"`); return; }
    ai.add(nume);
    randuri.push([nume, initiale(nume), V, W, sursa(p.source), anul(p.birthDate)]);
  };
  for (const p of lista) if (randuri.length < CATI && p.countryOfCitizenship === tara) ia(p);
  if (orase) for (const p of lista) if (randuri.length < CATI && orase.includes(p.city)) ia(p);
  out[slug] = randuri;
  console.log(`  ${slug.padEnd(28)} ${String(randuri.length).padStart(2)} names`);
}

if (rele.length) console.log(`  left out, not a name the form would take: ${rele.join('; ')}`);

writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
console.log(`build-rich-rosters: ${lista.length} billionaires read, written to scripts/rich-rosters.json`);

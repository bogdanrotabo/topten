#!/usr/bin/env node
/**
 * Every sitting Member of the European Parliament, from the Parliament's own
 * list, with the portrait Wikidata holds for each.
 *
 * The list is the Parliament's: europarl.europa.eu publishes the current
 * membership as one XML document -- name, country, political group, and the
 * member's directory number. 719 names, and the ones that change after a
 * resignation or an election change there first. A hand-written list of
 * MEPs would be wrong within the month, and wrong quietly.
 *
 * The faces come from Wikidata, joined on that same directory number (its
 * property P1186), which is how 719 rows meet 719 items without a single
 * name being matched by spelling. What Wikidata holds is a Commons file --
 * for nearly all of them the official 2024 portrait, which the Parliament
 * released freely -- and Commons is the one place this site takes a face
 * from. The picture builder reads the file name written here and asks
 * Commons for the thumbnail and the credit.
 *
 * Each row is [name, initials, ink, trim, "Country · Group", directory id,
 * Commons file]. The first five are the roster row every board uses -- the
 * country and group stand where a player's club would -- and the last two
 * are for the picture builder. rosters.mjs drops them before the list ships.
 *
 *   node scripts/build-eu-parliament.mjs           writes scripts/eu-parliament.json
 *   node scripts/build-eu-parliament.mjs --check   fails if it is missing or thin
 */
import { writeFileSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'scripts/eu-parliament.json');
const BOARD = 'eu-politicians';
const MIN = 600;
const MAX_AGE_DAYS = 30;
const UA = 'Mozilla/5.0 (compatible; TopTenOne/1.0; +https://topten.one)';
const LISTA = 'https://www.europarl.europa.eu/meps/en/full-list/xml';
const SPARQL = 'https://query.wikidata.org/sparql';

/* The Union's colours on the initials badge, for the nine without a face. */
const INK = '#003399', TRIM = '#ffcc00';

/* The group, as it is said rather than as it is registered. */
const GRUPURI = [
  [/European People's Party/i, 'EPP'],
  [/Socialists and Democrats/i, 'S&D'],
  [/Patriots for Europe/i, 'PfE'],
  [/Conservatives and Reformists/i, 'ECR'],
  [/Renew Europe/i, 'Renew'],
  [/Greens\/European Free Alliance/i, 'Greens/EFA'],
  [/The Left/i, 'The Left'],
  [/Sovereign Nations/i, 'ESN'],
  [/Non-attached/i, 'Non-attached'],
];
const grup = s => (GRUPURI.find(([re]) => re.test(s)) || [null, s])[1];

/* The same rule the claim form applies to a name, copied from app.js. */
const NAME_RE = /^(?=.{2,40}$)[\p{L}][\p{L}.'’-]*(?: [\p{L}.'’-]+){0,5}$/u;

/* "Maravillas ABADÍA JOVER" as the Parliament writes it, "Maravillas Abadía
   Jover" as anybody else does. Used only where Wikidata has no label to offer;
   a particle stays small and a hyphenated or apostrophed part is cased on
   both sides. */
const PARTICULE = new Set(['de', 'del', 'della', 'der', 'den', 'di', 'da', 'do', 'dos', 'du', 'la', 'le', 'van', 'von', 'y', 'e', 'af', 'av', 'ter', 'ten']);
function dinMajuscule(s) {
  return s.split(' ').map(w => {
    if (w !== w.toUpperCase() || !/\p{L}/u.test(w)) return w;
    const jos = w.toLowerCase();
    if (PARTICULE.has(jos)) return jos;
    return jos.replace(/(^|[-'’])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
  }).join(' ');
}
const initiale = n => { const p = n.split(' '); return (p[0][0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase(); };
const camp = (xml, tag) => (new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(xml) || [])[1] || '';
const dezxml = s => s.replace(/&amp;/g, '&').replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

if (process.argv.includes('--check')) {
  if (!existsSync(OUT)) {
    console.error('build-eu-parliament: scripts/eu-parliament.json is missing — run node scripts/build-eu-parliament.mjs');
    process.exit(1);
  }
  const d = JSON.parse(readFileSync(OUT, 'utf8'));
  const n = (d[BOARD] || []).length;
  if (n < MIN) { console.error(`build-eu-parliament: ${n} members, expected at least ${MIN}`); process.exit(1); }
  const zile = (Date.now() - statSync(OUT).mtimeMs) / 86400000;
  console.log(zile > MAX_AGE_DAYS
    ? `build-eu-parliament: ${zile.toFixed(0)} days old — members change. Rerun when convenient.`
    : `build-eu-parliament: ${n} members, ${d[BOARD].filter(r => r[6]).length} with a portrait, ${zile.toFixed(1)} days old.`);
  process.exit(0);
}

const iesi = (msg) => {
  console.error(`build-eu-parliament: ${msg}`);
  console.error(existsSync(OUT) ? '  keeping the file already on disk.' : '  nothing written.');
  process.exit(existsSync(OUT) ? 0 : 1);
};

/* The Parliament's server answers Node's fetch with a 202 and an empty body
   -- the front of it takes the request for a bot and hands back a challenge
   -- and answers curl, asking for the same thing, with the document. So the
   document is fetched the plain way first and, if that comes back empty, by
   curl; whichever of the two carries the list is the one read. */
let xml = '';
try {
  const r = await fetch(LISTA, { headers: { 'user-agent': UA, accept: 'application/xml' } });
  if (r.ok) xml = await r.text();
} catch (e) { /* the second way is below */ }
if (!/<mep>/.test(xml)) {
  try {
    const { execFileSync } = await import('node:child_process');
    xml = execFileSync('curl', ['-sS', '-m', '60', '-A', UA, LISTA], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (e) { iesi(`the Parliament's list: ${e.message}`); }
}
if (!/<mep>/.test(xml)) iesi("the Parliament's list came back without a single member in it");

const membri = [...xml.matchAll(/<mep>([\s\S]*?)<\/mep>/g)].map(m => ({
  nume: dezxml(camp(m[1], 'fullName')),
  tara: dezxml(camp(m[1], 'country')),
  grup: grup(dezxml(camp(m[1], 'politicalGroup'))),
  id: camp(m[1], 'id'),
})).filter(m => m.nume && m.id);
if (membri.length < MIN) iesi(`only ${membri.length} members in the list — the shape has changed`);

/* One query for every item that has ever carried a directory number, with
   its label and its picture. Bigger than the current Parliament and cheaper
   than 719 questions. */
let wd = new Map();
try {
  const q = 'SELECT ?epid ?mepLabel ?img WHERE { ?mep wdt:P1186 ?epid . OPTIONAL { ?mep wdt:P18 ?img } '
    + 'SERVICE wikibase:label { bd:serviceParam wikibase:language "en,fr,de,es,it,pl,ro,nl,pt,sv". } }';
  const r = await fetch(SPARQL + '?query=' + encodeURIComponent(q), {
    headers: { 'user-agent': UA, accept: 'application/sparql-results+json' } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  for (const b of (await r.json()).results.bindings) {
    const id = b.epid?.value;
    if (!id || wd.has(id) && wd.get(id).img) continue;
    const img = b.img?.value ? decodeURIComponent(b.img.value.replace(/^.*Special:FilePath\//, '')) : '';
    const label = b.mepLabel?.value || '';
    wd.set(id, { label: /^Q\d+$/.test(label) ? '' : label, img });
  }
} catch (e) { iesi(`Wikidata: ${e.message}`); }

const randuri = [];
let cuPoza = 0, fara = 0;
for (const m of membri) {
  const w = wd.get(m.id) || { label: '', img: '' };
  let nume = w.label && NAME_RE.test(w.label) ? w.label : dinMajuscule(m.nume);
  if (!NAME_RE.test(nume)) { fara++; console.warn(`  not a name the form would take, left out: "${nume}"`); continue; }
  if (w.img) cuPoza++;
  randuri.push([nume, initiale(nume), INK, TRIM, `${m.tara} · ${m.grup}`, m.id, w.img]);
}

writeFileSync(OUT, JSON.stringify({ [BOARD]: randuri }, null, 1) + '\n');
console.log(`build-eu-parliament: ${randuri.length} sitting members, ${cuPoza} with a portrait on Commons`
  + (fara ? `, ${fara} left out` : '') + ', written to scripts/eu-parliament.json');

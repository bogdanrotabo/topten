#!/usr/bin/env node
/**
 * Photographs for the Actors board, from Wikimedia Commons — and only from
 * Commons.
 *
 * Wikipedia serves two kinds of image from the same host and the path says
 * which: /wikipedia/commons/ is Wikimedia Commons, where everything is freely
 * licensed, and /wikipedia/en/ is the English Wikipedia's local upload area,
 * which exists precisely to hold non-free files it uses under US fair use.
 * Film posters live in the second one. Fair use on an encyclopaedia does not
 * carry over to a site that sells rank, so this script takes the first and
 * refuses the second — mechanically, on the URL, not on judgement.
 *
 * Commons licences are mostly CC-BY-SA, which wants the author credited. So
 * the author and the licence come along with the file and the site shows
 * them. A photograph used without its credit is not a free photograph.
 *
 *   node scripts/build-people-art.mjs
 *   node scripts/build-people-art.mjs --check
 */
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'people-art.json');
const MAX_AGE_DAYS = 60;
const GAP = 700;
const UA = 'TopTenOne/1.0 (https://topten.one; support@rotabo.app)';

const fold = s => String(s).toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[$.'’-]/g, '')
  .replace(/\s+/g, ' ')
  .trim();

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* Every board whose subject is a person or an organisation with a page. Kept
   in one file but keyed by board, because a name can mean two different
   things on two different boards and each should get its own picture. */
const BOARDS = ['actors', 'us-politicians', 'us-parties', 'football-players',
                'f1-drivers', 'golf-players', 'artists'];

/* Both quote styles. A name with an apostrophe in it — Baldur's Gate,
   Schindler's List — has to be written with double quotes in the roster, and
   the first version of this only ever looked for single ones, so those names
   were silently skipped and their art never fetched. */
function wanted(board) {
  const src = readFileSync(join(root, 'scripts/rosters.mjs'), 'utf8');
  const re = new RegExp(`'?${board}'?: \\[([\\s\\S]*?)\\n  \\],`);
  const m = re.exec(src);
  if (!m) { console.error(`build-people-art: no ${board} list in scripts/rosters.mjs`); process.exit(2); }
  return [...m[1].matchAll(/\[\s*(?:'([^']*)'|"([^"]*)")/g)].map(x => x[1] ?? x[2]);
}

const get = async (u, attempt = 1) => {
  const r = await fetch(u, { headers: { accept: 'application/json', 'user-agent': UA } });
  if ((r.status === 429 || r.status >= 500) && attempt <= 4) {
    await sleep(1500 * attempt);
    return get(u, attempt + 1);
  }
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
};

/** The file behind the summary thumbnail, and what Commons says about it. */
async function look(name) {
  const title = encodeURIComponent(name.replace(/ /g, '_'));
  const sum = await get(`https://en.wikipedia.org/api/rest_v1/page/summary/${title}`);
  const thumb = (sum.thumbnail || {}).source || '';

  /* The whole rule, in one line. Anything not on Commons is not ours. */
  if (!/\/wikipedia\/commons\//.test(thumb)) return null;

  const file = decodeURIComponent(
    (/\/commons\/(?:thumb\/)?[0-9a-f]\/[0-9a-f]{2}\/([^/]+)/.exec(thumb) || [])[1] || '');
  if (!file) return null;

  await sleep(GAP);
  const meta = await get('https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*'
    + '&prop=imageinfo&iiprop=extmetadata|url&titles=' + encodeURIComponent('File:' + file));
  const page = Object.values(meta.query?.pages || {})[0] || {};
  const ex = page.imageinfo?.[0]?.extmetadata || {};
  const plain = v => String(v?.value || '').replace(/<[^>]*>/g, '').trim();

  return {
    img: thumb.split('?')[0],
    autor: plain(ex.Artist) || 'Unknown',
    licenta: plain(ex.LicenseShortName) || plain(ex.License) || 'see Commons',
    pagina: 'https://commons.wikimedia.org/wiki/' + encodeURIComponent('File:' + file)
  };
}

if (process.argv.includes('--check')) {
  if (!existsSync(OUT)) {
    console.error('build-people-art: people-art.json is missing. Run: node scripts/build-people-art.mjs');
    process.exit(1);
  }
  let age = Infinity;
  try {
    const t = Date.parse(JSON.parse(readFileSync(OUT, 'utf8')).builtAt);
    if (Number.isFinite(t)) age = (Date.now() - t) / 86400000;
  } catch (e) { /* unreadable is as good as undated */ }
  if (age > MAX_AGE_DAYS) console.warn(`build-people-art: ${age.toFixed(0)} days old. Rerun when convenient.`);
  else console.log(`build-people-art: ${age.toFixed(1)} days old, fine.`);
  process.exit(0);
}

const art = {};
let gasit = 0, refuzat = 0;

for (const board of BOARDS) {
  art[board] = {};
  let g = 0, r = 0;
  for (const n of wanted(board)) {
    try {
      const hit = await look(n);
      if (hit) { art[board][fold(n)] = hit; g++; }
      else r++;
    } catch (e) {
      console.warn(`  ${board}/${n}: ${e.message}`);
    }
    await sleep(GAP);
  }
  gasit += g; refuzat += r;
  console.log(`  ${board.padEnd(18)} ${String(g).padStart(2)} from Commons`
    + (r ? `, ${r} not free to use` : ''));
}

writeFileSync(OUT, JSON.stringify({ builtAt: new Date().toISOString(), art }));
console.log(`build-people-art: ${gasit} pictures across ${BOARDS.length} boards`
  + (refuzat ? `, ${refuzat} skipped — not on Commons, so not ours to use` : ''));

#!/usr/bin/env node
/**
 * The real cover art for the games on the Games board.
 *
 * Steam's store search answers without a key and returns the publisher's own
 * capsule for each title, which is the art that game is recognised by. Same
 * shape as the coin map: built once, keyed on the folded name, exact matches
 * only — a listing paying for "Elden Ring" must not end up wearing the art
 * for "ELDEN RING NIGHTREIGN", which is what the search offers second.
 *
 * Not every game is on Steam. Minecraft, Fortnite and Roblox sell elsewhere,
 * so they are simply absent and keep their drawn badge — which is the honest
 * outcome and not a gap to be filled with something close.
 *
 *   node scripts/build-game-art.mjs
 *   node scripts/build-game-art.mjs --check
 */
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'game-art.json');
const MAX_AGE_DAYS = 30;   // box art changes about as often as a game is renamed
const GAP = 900;

const fold = s => String(s).toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[$.'’-]/g, '')
  .replace(/\s+/g, ' ')
  .trim();

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* The names come from the board's own suggestion list, so the two cannot
   drift: every game offered in the picker is a game this has looked up. */
function wanted() {
  const src = readFileSync(join(root, 'scripts/rosters.mjs'), 'utf8');
  const m = /games: \[([\s\S]*?)\n  \],/.exec(src);
  if (!m) { console.error('build-game-art: no games list in scripts/rosters.mjs'); process.exit(2); }
  return [...m[1].matchAll(/\['([^']+)'/g)].map(x => x[1]);
}

async function look(name, attempt = 1) {
  const u = 'https://store.steampowered.com/api/storesearch/?l=en&cc=US&term='
    + encodeURIComponent(name);
  const r = await fetch(u, { headers: { accept: 'application/json' } });
  if ((r.status === 429 || r.status >= 500) && attempt <= 4) {
    await sleep(2000 * attempt);
    return look(name, attempt + 1);
  }
  if (!r.ok) throw new Error(`Steam "${name}": HTTP ${r.status}`);
  const d = await r.json();
  const key = fold(name);
  /* Exact name match only. The search is happy to return an expansion, a
     soundtrack or a bundle, and any of those over a paid listing is worse
     than no art at all. */
  let hit = (d.items || []).find(i => fold(i.name) === key);

  /* One relaxation, and only one: a title whose full form adds a subtitle
     after a colon — "The Witcher 3" for "The Witcher 3: Wild Hunt", "PUBG"
     for "PUBG: BATTLEGROUNDS". That is the same game under its full name.
     
     A prefix without the colon is not, and this is where the rule earns its
     keep: "Elden Ring" is a prefix of "ELDEN RING NIGHTREIGN", which is a
     different game entirely, and putting its art on somebody's paid listing
     would be a lie with a price on it. */
  if (!hit) {
    hit = (d.items || []).find(i => {
      const full = String(i.name || '');
      const cut = full.indexOf(':');
      return cut > 0 && fold(full.slice(0, cut)) === key;
    });
  }
  if (!hit) return null;
  /* Its own capsule, without the ?t= cache-buster: same bytes, shorter file,
     and one fewer thing to go stale. */
  return { id: hit.id, img: String(hit.tiny_image || '').split('?')[0] };
}

async function build() {
  const names = wanted();
  const art = {};
  let found = 0;
  for (const n of names) {
    try {
      const hit = await look(n);
      if (hit && hit.img) { art[fold(n)] = hit.img; found++; }
    } catch (e) {
      console.warn(`  ${n}: ${e.message}`);
    }
    await sleep(GAP);
  }
  return { builtAt: new Date().toISOString(), games: names.length, found, art };
}

if (process.argv.includes('--check')) {
  if (!existsSync(OUT)) {
    console.error('build-game-art: game-art.json is missing. Run: node scripts/build-game-art.mjs');
    process.exit(1);
  }
  let age = Infinity;
  try {
    const t = Date.parse(JSON.parse(readFileSync(OUT, 'utf8')).builtAt);
    if (Number.isFinite(t)) age = (Date.now() - t) / 86400000;
  } catch (e) { /* unreadable is as good as missing a date */ }
  if (age > MAX_AGE_DAYS) {
    console.warn(`build-game-art: ${age.toFixed(0)} days old. Rerun when convenient — not a reason to block a deploy.`);
  } else {
    console.log(`build-game-art: ${age.toFixed(1)} days old, fine.`);
  }
  process.exit(0);
}

const data = await build();
writeFileSync(OUT, JSON.stringify(data));
console.log(`build-game-art: ${data.found} of ${data.games} games have their own art`);
for (const k of Object.keys(data.art)) console.log('  ' + k);

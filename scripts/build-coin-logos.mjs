#!/usr/bin/env node
/**
 * The real logo for every coin somebody is likely to list.
 *
 * A coin's logo is its own mark, published by the project and served by
 * CoinGecko's API for exactly this. What is not fine is guessing: a wrong logo
 * on a paid listing is worse than no logo, so the map is keyed on both the
 * coin's name and its ticker, and anything that does not match falls back to
 * the drawn badge rather than to something close.
 *
 * Built rather than fetched at runtime. A lookup per row would be ten API
 * calls per page view against a rate-limited free endpoint, and the answer
 * changes about as often as a coin is renamed.
 *
 *   node scripts/build-coin-logos.mjs          # rebuild coin-logos.json
 *   node scripts/build-coin-logos.mjs --check  # exit 1 if it is missing/stale
 *
 * Attribution: CoinGecko's free API requires it, and index.html carries it.
 */
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
/* Two files, not one. The logos are needed whenever a coin is drawn, which is
   most page views; the picker list is needed only when somebody opens the
   claim form on a crypto board, which is far fewer. Shipping them together
   would put 56 KB of names on every visit that never asks for them. */
const OUT = join(root, 'coin-logos.json');
const OUT_LIST = join(root, 'coin-list.json');
const PAGES = 4;            // 4 x 250 = the top 1000 by market cap
const PER = 250;
const BASE = 'https://coin-images.coingecko.com/coins/images/';

/* The same fold app.js uses, so "dogwifhat", "Dogwifhat" and "$WIF" all find
   their row. Kept in step by hand deliberately: this script must not import
   the browser bundle, and the rule is four lines. */
const fold = s => String(s).toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[$.'’-]/g, '')
  .replace(/\s+/g, ' ')
  .trim();

/* Every URL is <base><n>/small/<file>, and the ?<timestamp> the API appends is
   not needed — checked, the CDN serves the same bytes without it. Storing the
   two variable parts rather than the whole address is about half the file. */
function shorten(url) {
  const m = /coins\/images\/(\d+)\/[a-z]+\/([^?]+)/.exec(url || '');
  return m ? `${m[1]}/${m[2]}` : null;
}

async function fetchPage(page, category) {
  const u = 'https://api.coingecko.com/api/v3/coins/markets'
    + `?vs_currency=usd&order=market_cap_desc&per_page=${PER}&page=${page}`
    + (category ? `&category=${category}` : '');
  const r = await fetch(u, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`CoinGecko ${category || 'all'} page ${page}: HTTP ${r.status}`);
  return r.json();
}

async function build() {
  const map = {};
  /* The list the claim form offers, market-cap order. Not a closed set: these
     boards are not a league, new coins appear daily, and refusing one because
     it is not in a file built last Tuesday would turn away the exact listing
     somebody wants to pay for. What the list does is spelling and discovery —
     the same job the club roster does, without the veto. */
  const names = [];
  const meme = [];
  let coins = 0;

  for (let page = 1; page <= PAGES; page++) {
    const rows = await fetchPage(page);
    for (const c of rows) {
      const short = shorten(c.image);
      if (!short) continue;
      coins++;
      names.push([c.name, String(c.symbol || '').toUpperCase()]);
      /* Name first, symbol second, and neither overwrites an entry a
         higher-ranked coin already claimed. Dozens of coins call themselves
         BTC; the one at rank 1 is the one somebody typing BTC means. */
      for (const key of [fold(c.name), fold(c.symbol)]) {
        if (key && !(key in map)) map[key] = short;
      }
    }
    if (page < PAGES) await new Promise(r => setTimeout(r, 2500)); // free tier
  }

  /* The memecoin board gets its own list, because "all the memecoins" is a
     question CoinGecko already answers and picking them out of the top 1000
     by eye is not something a build script can do. */
  await new Promise(r => setTimeout(r, 2500));
  for (let page = 1; page <= 2; page++) {
    for (const c of await fetchPage(page, 'meme-token')) {
      const short = shorten(c.image);
      if (short) for (const key of [fold(c.name), fold(c.symbol)]) {
        if (key && !(key in map)) map[key] = short;
      }
      meme.push([c.name, String(c.symbol || '').toUpperCase()]);
    }
    if (page < 2) await new Promise(r => setTimeout(r, 2500));
  }

  if (coins < PAGES * PER * 0.9) {
    console.error(`build-coin-logos: only ${coins} coins came back, expected ~${PAGES * PER}.`);
    process.exit(2);
  }
  return { base: BASE, size: 'small', coins, logos: map, names, meme };
}

const data = await build();
const logos = { base: data.base, size: data.size, coins: data.coins, logos: data.logos };
const lists = { names: data.names, meme: data.meme };
const json = JSON.stringify(logos);
const jsonList = JSON.stringify(lists);

if (process.argv.includes('--check')) {
  if (!existsSync(OUT) || !existsSync(OUT_LIST)) {
    console.error('build-coin-logos: coin-logos.json is missing. Run scripts/build-coin-logos.mjs');
    process.exit(1);
  }
  const have = JSON.parse(readFileSync(OUT, 'utf8'));
  const missing = Object.keys(logos.logos).filter(k => !(k in have.logos));
  if (missing.length > 50) {
    console.error(`build-coin-logos: ${missing.length} coins are not in coin-logos.json. Rebuild it.`);
    process.exit(1);
  }
  console.log(`build-coin-logos: ${Object.keys(have.logos).length} keys, current enough (${missing.length} new).`);
  process.exit(0);
}

writeFileSync(OUT, json);
writeFileSync(OUT_LIST, jsonList);
console.log(`build-coin-logos: ${data.coins} coins`);
console.log(`  coin-logos.json  ${Object.keys(data.logos).length} keys, ${(json.length / 1024).toFixed(0)} KB`);
console.log(`  coin-list.json   ${data.names.length} coins + ${data.meme.length} memecoins, ${(jsonList.length / 1024).toFixed(0)} KB`);

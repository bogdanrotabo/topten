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
 *   node scripts/build-coin-logos.mjs          # rebuild both files
 *   node scripts/build-coin-logos.mjs --check  # used by sync-routes.sh
 *
 * --check is deliberately hard to fail on. A missing file is a hard error,
 * because the site fetches it and would 404. Data younger than MAX_AGE_DAYS
 * passes without touching the network at all, so most deploys never call
 * CoinGecko. Older than that, it asks — and if the answer does not arrive it
 * says so and lets the deploy through: their outage is not a reason this site
 * cannot ship a CSS fix. The only thing that fails a deploy on live data is
 * having none.
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
const MAX_AGE_DAYS = 10;
const GAP = 6000;          // between pages, well inside the free tier's budget
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

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* CoinGecko's free tier is rate limited per IP, and a GitHub runner's IP is
   shared with everybody else's workflows — the first scheduled run failed on
   a 429 that never happens from a laptop. So: back off and try again, and
   believe their Retry-After when they send one. Five attempts spanning about
   two and a half minutes; past that it really is not going to work now. */
/* The exchanges CoinGecko ranks, with their own marks. Kept in a namespace of
   their own rather than poured into the coin map: "Gate" and "Bitget" are
   exchange names a coin could also carry, and a listing on the exchange board
   must never end up wearing a token's logo because the two folded together.
   Two maps, and no collision to arbitrate. */
async function fetchExchanges(attempt = 1) {
  const r = await fetch('https://api.coingecko.com/api/v3/exchanges?per_page=30&page=1',
    { headers: { accept: 'application/json' } });
  if ((r.status === 429 || r.status >= 500) && attempt <= 5) {
    const told = Number(r.headers.get('retry-after'));
    await sleep(Number.isFinite(told) && told > 0 ? told * 1000 : 6000 * 2 ** (attempt - 1));
    return fetchExchanges(attempt + 1);
  }
  if (!r.ok) throw new Error(`CoinGecko exchanges: HTTP ${r.status}`);
  return r.json();
}

async function fetchPage(page, category, attempt = 1) {
  const u = 'https://api.coingecko.com/api/v3/coins/markets'
    + `?vs_currency=usd&order=market_cap_desc&per_page=${PER}&page=${page}`
    + (category ? `&category=${category}` : '');
  const r = await fetch(u, { headers: { accept: 'application/json' } });

  if (r.status === 429 && attempt <= 5) {
    const told = Number(r.headers.get('retry-after'));
    const wait = Number.isFinite(told) && told > 0 ? told * 1000 : 6000 * 2 ** (attempt - 1);
    console.warn(`  rate limited on ${category || 'all'} page ${page}, waiting ${(wait / 1000).toFixed(0)}s (try ${attempt}/5)`);
    await sleep(wait);
    return fetchPage(page, category, attempt + 1);
  }

  if (!r.ok) throw new Error(`CoinGecko ${category || 'all'} page ${page}: HTTP ${r.status}`);
  return r.json();
}

/* A key is only worth answering if it can only mean one coin — but "only one"
 * is a different question for a name than for a ticker.
 *
 * Names are strict. The market holds "USDai" and "USD.AI", "USDa" and "USDA",
 * "IOTA" and "iota": different projects whose names fold together, with no
 * honest way to pick between them. Those keys answer nothing, and the badge
 * with the coin's letters on it stands.
 *
 * Tickers are not. Dozens of coins claim DOGE and a meme coin's ticker is
 * literally BITCOIN, but somebody typing DOGE means Dogecoin — market rank is
 * a real signal of what a ticker means, where two spellings of a name are
 * just two spellings. So the highest-ranked claimant takes it.
 *
 * What no ticker may do is take a key a name already ruled ambiguous. That
 * was the hole in the first version of this: USD.AI and USDai cancelled each
 * other out at the name level and then one of their tickers quietly picked
 * the key back up, which is the exact wrong answer wearing a rule.
 */
function resolve(byName, bySym) {
  const nume = new Map();
  for (const [key, name, short] of byName) {
    if (!key) continue;
    const had = nume.get(key);
    if (!had) nume.set(key, { name, short });
    else if (had.name !== name) had.ambiguous = true;
  }

  const map = {};
  for (const [key, v] of nume) if (!v.ambiguous) map[key] = v.short;

  /* byName and bySym arrive in market-cap order, so the first claimant of a
     ticker is the biggest coin that calls itself that. */
  for (const [key, , short] of bySym) {
    if (!key || key in map || nume.has(key)) continue;
    map[key] = short;
  }
  return map;
}

async function build() {
  const byName = [], bySym = [];
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
      /* Collected, not decided. Two passes below work out which keys are safe
         to answer, because deciding here — first writer wins — quietly hands
         one coin another coin's logo whenever their names fold together. */
      byName.push([fold(c.name), c.name, short]);
      bySym.push([fold(c.symbol), c.name, short]);
    }
    if (page < PAGES) await sleep(GAP); // free tier
  }

  /* The memecoin board gets its own list, because "all the memecoins" is a
     question CoinGecko already answers and picking them out of the top 1000
     by eye is not something a build script can do. */
  await sleep(GAP);
  for (let page = 1; page <= 2; page++) {
    for (const c of await fetchPage(page, 'meme-token')) {
      const short = shorten(c.image);
      if (short) {
        byName.push([fold(c.name), c.name, short]);
        bySym.push([fold(c.symbol), c.name, short]);
      }
      meme.push([c.name, String(c.symbol || '').toUpperCase()]);
    }
    if (page < 2) await sleep(GAP);
  }

  if (coins < PAGES * PER * 0.9) {
    console.error(`build-coin-logos: only ${coins} coins came back, expected ~${PAGES * PER}.`);
    process.exit(2);
  }
  /* Their images live under /markets/ rather than /coins/, so they carry the
     whole address instead of the two-part shorthand the coins use. Thirty of
     them is not worth a second encoding. */
  await sleep(GAP);
  const exchanges = {};
  const exchangeNames = [];
  try {
    for (const e of await fetchExchanges()) {
      const nume = String(e.name || '').trim();
      const img = String(e.image || '').split('?')[0];
      if (!nume || !img) continue;
      exchangeNames.push([nume, nume.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase()]);
      const k = fold(nume);
      if (k && !(k in exchanges)) exchanges[k] = img;
    }
  } catch (err) {
    console.warn(`  exchanges: ${err.message} — keeping whatever was built last`);
  }

  const map = resolve(byName, bySym);
  const toate = new Set(byName.map(x => x[0]).concat(bySym.map(x => x[0])));
  toate.delete('');
  const pierdute = toate.size - Object.keys(map).length;
  if (pierdute) console.log(`  ${pierdute} names two projects could both mean — dropped rather than guessed`);
  return { base: BASE, size: 'small', coins, logos: map, names, meme, exchanges, exchangeNames };
}

function split(data) {
  const builtAt = new Date().toISOString();
  return [
    { builtAt, base: data.base, size: data.size, coins: data.coins,
      logos: data.logos, exchanges: data.exchanges },
    { builtAt, names: data.names, meme: data.meme, exchanges: data.exchangeNames }
  ];
}

const ageDays = f => {
  try {
    const t = Date.parse(JSON.parse(readFileSync(f, 'utf8')).builtAt);
    return Number.isFinite(t) ? (Date.now() - t) / 86400000 : Infinity;
  } catch (e) { return Infinity; }
};

if (process.argv.includes('--check')) {
  if (!existsSync(OUT) || !existsSync(OUT_LIST)) {
    console.error('build-coin-logos: coin-logos.json or coin-list.json is missing —');
    console.error('  the site fetches both. Run: node scripts/build-coin-logos.mjs');
    process.exit(1);
  }

  const age = Math.max(ageDays(OUT), ageDays(OUT_LIST));
  if (age <= MAX_AGE_DAYS) {
    console.log(`build-coin-logos: ${age.toFixed(1)} days old, fresh enough (no API call).`);
    process.exit(0);
  }

  /* Old enough to ask. Not old enough to stop a deploy over. */
  let live;
  try {
    live = await build();
  } catch (e) {
    console.warn(`build-coin-logos: ${age.toFixed(0)} days old and CoinGecko did not answer (${e.message}).`);
    console.warn('  Shipping the data we have. Rerun the script when they are back.');
    process.exit(0);
  }
  const have = JSON.parse(readFileSync(OUT, 'utf8'));
  const noi = Object.keys(live.logos).filter(k => !(k in have.logos));
  if (noi.length > 50) {
    console.error(`build-coin-logos: ${age.toFixed(0)} days old and ${noi.length} coins are missing.`);
    console.error('  Run: node scripts/build-coin-logos.mjs');
    process.exit(1);
  }
  console.log(`build-coin-logos: ${age.toFixed(0)} days old, only ${noi.length} new coins. Fine.`);
  process.exit(0);
}

const data = await build();
const [logos, lists] = split(data);
const json = JSON.stringify(logos);
const jsonList = JSON.stringify(lists);

writeFileSync(OUT, json);
writeFileSync(OUT_LIST, jsonList);
console.log(`build-coin-logos: ${data.coins} coins`);
console.log(`  coin-logos.json  ${Object.keys(data.logos).length} keys, ${(json.length / 1024).toFixed(0)} KB`);
console.log(`  coin-list.json   ${data.names.length} coins + ${data.meme.length} memecoins + ${data.exchangeNames.length} exchanges, ${(jsonList.length / 1024).toFixed(0)} KB`);

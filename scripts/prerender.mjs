#!/usr/bin/env node
/**
 * The ten, written into the page before anybody asks for it.
 *
 * Every board page is the same index.html with a different head, and the ten
 * are drawn by app.js after it has talked to Supabase. A person never notices;
 * a crawler gets 15,700 bytes of markup with nothing in <main> at all. Asked
 * for /crypto/ without JavaScript, the answer had zero characters of text
 * inside #view -- and the same was true of all seventy-two, which is why
 * Search Console reported them "discovered, not indexed": it fetched a page,
 * found nothing to index, and stopped.
 *
 * So the ten are written in here, at build time, from the same board the site
 * reads. What goes where matters:
 *
 *   inside  #view   the heading and the ten. app.js replaces this the moment
 *                   it loads, with the same rows and the live figures, so
 *                   nobody is shown one thing and told another -- it is the
 *                   same content, arriving twice.
 *   outside <main>  the board's own paragraph, which app.js never touches, so
 *                   it stays on the screen for a reader as well as a crawler.
 *                   Text that only a crawler can see is cloaking and costs
 *                   more than it pays.
 *
 * The figures go stale between deploys, by design: the site rebuilds whenever
 * anything changes, the browser corrects the page in the first second, and a
 * number that was true at build time is a fair thing to publish.
 *
 *   node scripts/prerender.mjs            writes the ten into every board page
 *   node scripts/prerender.mjs --check    fails if a page has no ten in it
 *   node scripts/prerender.mjs --dry-run  says what it would write
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const COPY = join(root, 'scripts/board-copy.json');

const verifica = process.argv.includes('--check');
const uscat = process.argv.includes('--dry-run');

/* --------------------------------------------------------------- markers */
/* Everything this writes sits between a pair of these, so a second run
   replaces its own work instead of stacking a copy under it. */
const M = (nume) => [`<!-- ${nume} -->`, `<!-- /${nume} -->`];
const [TEN_A, TEN_Z] = M('ten');
const [COPY_A, COPY_Z] = M('board-copy');
const [LD_A, LD_Z] = M('board-ld');

function pune(html, [a, z], continut, dupa) {
  const i = html.indexOf(a);
  if (i >= 0) {
    const j = html.indexOf(z, i);
    if (j < 0) throw new Error(`opening ${a} with no ${z}`);
    return html.slice(0, i) + a + continut + z + html.slice(j + z.length);
  }
  const k = html.indexOf(dupa);
  if (k < 0) throw new Error(`nowhere to put ${a}: no ${dupa} in the page`);
  const capat = k + dupa.length;
  return html.slice(0, capat) + '\n' + a + continut + z + html.slice(capat);
}

const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const bani = c => '$' + (Number(c || 0) / 100).toLocaleString('en-US',
  { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/\.00$/, '');

/* ------------------------------------------------------------- the boards */
/* Names and nouns out of sync-routes.sh, which is the list that generated the
   directories in the first place -- one list, not a second one to keep in
   step with it. */
function boarduri() {
  const sh = readFileSync(join(root, 'scripts/sync-routes.sh'), 'utf8');
  const m = /^PLATFORMS="(.*)"$/m.exec(sh);
  if (!m) { console.error('prerender: no PLATFORMS in sync-routes.sh'); process.exit(2); }
  return m[1].trim().split(/\s+/).map(e => {
    const [slug, nume, subst] = e.split('|');
    return { slug, nume: nume.replace(/-/g, ' ').replace(/\+/g, '&'), subst: subst.replace(/-/g, ' ') };
  });
}

/* ---------------------------------------------------------------- the ten */
async function board() {
  const cfg = readFileSync(join(root, 'config.js'), 'utf8');
  const url = (/SUPABASE_URL:\s*"([^"]+)"/.exec(cfg) || [])[1];
  const key = (/SUPABASE_ANON_KEY:\s*"([^"]+)"/.exec(cfg) || [])[1];
  if (!url || !key) throw new Error('config.js has no Supabase url or key');

  const r = await fetch(`${url}/rest/v1/board?select=platform,handle,tagline,link,total_cents,rank&order=platform,total_cents.desc&limit=2000`,
    { headers: { apikey: key, authorization: `Bearer ${key}` } });
  if (!r.ok) throw new Error(`board view: HTTP ${r.status}`);

  const pe = new Map();
  for (const row of await r.json()) {
    if (!pe.has(row.platform)) pe.set(row.platform, []);
    pe.get(row.platform).push(row);
  }
  for (const [, rows] of pe) {
    rows.sort((a, b) => b.total_cents - a.total_cents);
    rows.splice(10);
  }
  return pe;
}

/* --------------------------------------------------------------- the html */
function zece(b, randuri) {
  if (!randuri || !randuri.length) {
    return `\n<div class="shell prerender">
  <h1>Top 10 on ${esc(b.nume)}</h1>
  <p>Nobody has taken this board yet. $2 makes you #1 &mdash; and #1 is the row everybody sees first.</p>
</div>\n`;
  }
  const li = randuri.map((r, i) => `    <li><span class="pr__r">#${i + 1}</span> <span class="pr__h">${esc(r.handle)}</span>`
    + `${r.tagline ? ` <span class="pr__t">${esc(r.tagline)}</span>` : ''}`
    + ` <span class="pr__a">${bani(r.total_cents)}</span></li>`).join('\n');
  return `\n<div class="shell prerender">
  <h1>Top 10 on ${esc(b.nume)}</h1>
  <ol class="pr__list">
${li}
  </ol>
  <p>Ranked by money paid, most first. Pay more than the ${esc(b.subst.replace(/s$/, ''))} above you and you are above them.</p>
</div>\n`;
}

function ld(b, randuri) {
  if (!randuri || !randuri.length) return '';
  const items = randuri.map((r, i) => ({
    '@type': 'ListItem', position: i + 1, name: String(r.handle),
  }));
  return `\n<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org', '@type': 'ItemList',
    name: `Top 10 on ${b.nume}`, url: `https://topten.one/${b.slug}/`,
    numberOfItems: items.length, itemListOrder: 'https://schema.org/ItemListOrderDescending',
    itemListElement: items,
  }).replace(/</g, '\\u003c')}</script>\n`;
}

/* The front page has the same hole in it, and it is the page that matters
   most: the hero and the whole-market table are both drawn by app.js, so
   what a crawler was given was a heading-less document. Written here from
   the same rows, sorted the way the market is -- most paid first. */
function acasa(toate) {
  const randuri = toate.slice(0, 10);
  const li = randuri.map((r, i) => `    <li><span class="pr__r">#${i + 1}</span> <span class="pr__h">${esc(r.handle)}</span>`
    + ` <span class="pr__t">${esc(r.nume)}</span> <span class="pr__a">${bani(r.total_cents)}</span></li>`).join('\n');
  return `\n<div class="shell prerender">
  <p class="pr__tag">Be the one.</p>
  <h1>I am</h1>
  <p>Pay to be seen. Ten places on every board. No algorithm.</p>
${randuri.length ? `  <h2>The most paid for, across every board</h2>\n  <ol class="pr__list">\n${li}\n  </ol>` : ''}
</div>\n`;
}

/* The skeleton is three grey bars that stand in for the table while app.js is
   on its way. With the ten written above them they are three grey bars under
   a finished list, so on a page that has content they go. */
const FARA_SCHELET = /<div class="shell" style="padding-top:26px">[\s\S]*?<\/div>\s*(?=<\/main>)/;

/* ------------------------------------------------------------------- main */
const B = boarduri();
const text = existsSync(COPY) ? JSON.parse(readFileSync(COPY, 'utf8')) : {};

if (verifica) {
  let rele = 0, fara = [];
  for (const b of B) {
    const cale = join(root, b.slug, 'index.html');
    if (!existsSync(cale)) { console.error(`prerender: ${b.slug}/index.html is missing`); rele++; continue; }
    const html = readFileSync(cale, 'utf8');
    if (!html.includes(TEN_A) || !html.includes(`<h1>Top 10 on `)) {
      console.error(`prerender: ${b.slug}/index.html has no ten written into it`); rele++;
    }
    if (!text[b.slug]) fara.push(b.slug);
  }
  if (rele) { console.error('prerender: run node scripts/prerender.mjs'); process.exit(1); }
  console.log(`prerender: ${B.length} board pages carry their ten`
    + (fara.length ? `, ${fara.length} with no paragraph of their own: ${fara.slice(0, 6).join(', ')}${fara.length > 6 ? '…' : ''}` : ', all with a paragraph'));
  process.exit(0);
}

let date;
try {
  date = await board();
} catch (e) {
  /* A build must not depend on a database being up. The pages keep whatever
     was written into them last time, which is a month-old ten at worst and
     is still a page with content in it. */
  console.error(`prerender: ${e.message} — pages keep the ten they already have`);
  process.exit(0);
}

let scrise = 0, goale = 0;
for (const b of B) {
  const cale = join(root, b.slug, 'index.html');
  if (!existsSync(cale)) { console.error(`prerender: ${b.slug}/index.html is missing`); process.exit(2); }
  const randuri = date.get(b.slug) || [];
  if (!randuri.length) goale++;

  let html = readFileSync(cale, 'utf8');
  html = html.replace(FARA_SCHELET, '');
  html = pune(html, [TEN_A, TEN_Z], zece(b, randuri), '<main id="view" aria-live="polite">');
  /* Closed off before </main>: what is written above replaces the skeleton,
     and the skeleton is what the page shows while app.js is on its way. */
  const p = text[b.slug];
  html = pune(html, [COPY_A, COPY_Z],
    p ? `\n<section class="shell boardnote"><p>${esc(p)}</p></section>\n` : '\n', '</main>');
  /* After the title, not after `<link rel="canonical"` -- that anchor is the
     opening of a tag, and inserting behind it put the block inside the link
     element: the canonical was destroyed and its href printed itself at the
     top of the page as text. Caught by rendering the page with JavaScript
     off, which is the only way anybody would have seen it. */
  html = pune(html, [LD_A, LD_Z], ld(b, randuri), '</title>');

  const vechi = readFileSync(cale, 'utf8');
  if (html !== vechi && !uscat) writeFileSync(cale, html);
  if (html !== vechi) scrise++;
}

/* And the front page, from every row on every board at once. */
const NUME = new Map(B.map(b => [b.slug, b.nume]));
const toate = [...date.entries()]
  .flatMap(([slug, rows]) => rows.map(r => ({ ...r, nume: NUME.get(slug) || slug })))
  .sort((a, b) => b.total_cents - a.total_cents);

const acasaCale = join(root, 'index.html');
let h = readFileSync(acasaCale, 'utf8');
const inainte = h;
h = h.replace(FARA_SCHELET, '');
h = pune(h, [TEN_A, TEN_Z], acasa(toate), '<main id="view" aria-live="polite">');
h = pune(h, [COPY_A, COPY_Z], '\n', '</main>');
if (h !== inainte && !uscat) writeFileSync(acasaCale, h);

console.log(`prerender: ${scrise} of ${B.length} board pages ${uscat ? 'would be ' : ''}rewritten`
  + `, ${B.length - goale} with listings on them, ${goale} still empty`
  + `; the front page carries the ${Math.min(10, toate.length)} most paid for.`);

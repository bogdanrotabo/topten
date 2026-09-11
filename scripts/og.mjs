#!/usr/bin/env node
/**
 * The pictures a link shows when somebody pastes it.
 *
 *   node scripts/og.mjs
 *
 * Every page on this site is a question, and the card a link shows should be
 * that question. It was showing "King of the Hill -- One page. One king. Pay
 * more than them and it's yours." on every link on the site, which is a game
 * that was removed weeks ago: paste topten.one into X today and it advertises
 * something that no longer exists.
 *
 * Drawn in a browser rather than by an image library, because a browser is
 * what the site is written for and the card is the same typography as the
 * page. The font is a file in this repository rather than a request to Google:
 * a build that needs the network to produce the same bytes twice is not a
 * build. Nothing here reads the database -- a leader baked into a committed
 * PNG starts going stale the moment somebody pays -- so the cards carry what
 * does not change: the question, and where it is asked.
 *
 * Needs Playwright and a Chromium, which CI does not have, so this is run by
 * hand and its output is committed. It changes only when a question changes.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
/* Playwright is CommonJS and is not a dependency of this repository -- it is
   whatever the machine running this happens to have. Resolved by name so the
   path is not baked in, and named at the top so a missing one says so once. */
import { createRequire } from 'node:module';
const require_ = createRequire(import.meta.url);
const { chromium } = (() => {
  for (const p of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
    try { return require_(p); } catch (e) { /* try the next */ }
  }
  console.error('This needs Playwright and a Chromium. npm i -g playwright, then run it again.');
  process.exit(1);
})();

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const R = (p) => join(root, p);

const FONT = readFileSync(R('scripts/assets/archivo-latin.woff2')).toString('base64');
const registry = JSON.parse(readFileSync(R('boards.json'), 'utf8'));
const byGroup = new Map(registry.groups.map((g) => [g.id, g]));

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/* The crown from render.js, drawn at the size a card wants it. */
const CROWN = '<svg width="34" height="26" viewBox="0 0 38 28" aria-hidden="true">'
  + '<path fill="#8d6610" d="M2 8l7 6 10-12 10 12 7-6-4 18H6z"/></svg>';

const SWISS = '<svg viewBox="0 0 32 32" width="17" height="17">'
  + '<rect width="32" height="32" rx="4" fill="#DA291C"/>'
  + '<path fill="#fff" d="M13 6h6v7h7v6h-7v7h-6v-7H6v-6h7z"/></svg>';

/* #1 is set apart in gold everywhere else on the site; it is set apart here. */
const one = (q) => esc(q).split('#1').join('<em>#1</em>');

function card({ eyebrow, question, sub }) {
  return `<!doctype html><meta charset="utf-8"><style>
@font-face { font-family: Archivo; src: url(data:font/woff2;base64,${FONT}) format('woff2');
             font-weight: 100 900; font-display: block; }
* { box-sizing: border-box; margin: 0; }
html, body { width: 1200px; height: 630px; }
body {
  background: #faf9f7;
  font-family: Archivo, sans-serif;
  color: #1c1b19;
  padding: 62px 72px;
  display: flex; flex-direction: column; justify-content: space-between;
  position: relative; overflow: hidden;
}
/* The same warm wash the pages carry, so a card and the page it opens look
   like the same place. */
.wash { position: absolute; border-radius: 50%; pointer-events: none;
  top: -240px; right: -180px; width: 620px; height: 620px;
  background: radial-gradient(circle, rgba(141,102,16,.08), rgba(141,102,16,0) 68%); }
.rule { position: absolute; left: 0; right: 0; top: 0; height: 5px; background: #8d6610; }
.top { display: flex; align-items: center; gap: 13px; position: relative; }
.mark { font-size: 27px; font-weight: 800; letter-spacing: .02em; }
.eyebrow { margin-left: auto; font-size: 17px; font-weight: 800; letter-spacing: .18em;
  text-transform: uppercase; color: #75726d; }
.q { position: relative; font-size: ${question.length > 46 ? 74 : question.length > 30 ? 88 : 104}px;
  font-weight: 800; line-height: 1.02; letter-spacing: -.03em; }
.q em { font-style: normal; color: #8d6610; }
.foot { display: flex; align-items: center; gap: 11px; position: relative;
  font-size: 21px; font-weight: 600; color: #6b6864; }
.foot b { color: #1c1b19; font-weight: 700; }
.dot { color: #75726d; }
</style>
<div class="rule"></div><div class="wash"></div>
<div class="top">${CROWN}<span class="mark">TOPTEN.ONE</span>${
  eyebrow ? `<span class="eyebrow">${esc(eyebrow)}</span>` : ''}</div>
<div class="q">${one(question)}</div>
<div class="foot">${SWISS}<span><b>${esc(sub)}</b></span>
  <span class="dot">&middot;</span><span>Swiss made</span></div>`;
}

const jobs = [
  { path: 'og-image.png', ...{ eyebrow: '', question: 'WHO SHOULD BE #1?',
      sub: 'Pick a side. Move the ranking.' } },
  ...registry.boards.map((b) => ({
    path: `og/${b.slug}.png`,
    eyebrow: byGroup.get(b.group).name,
    question: b.q,
    sub: b.name,
  })),
];

/* The Chromium is whatever this machine has, like the Playwright above it:
   the container's baked path first, then the Chrome Windows keeps, then
   whatever Playwright itself would pick. */
const executablePath = [
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
].find((p) => existsSync(p));
const browser = await chromium.launch({ executablePath });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });

let n = 0;
for (const job of jobs) {
  await page.setContent(card(job), { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  const full = R(job.path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, await page.screenshot({ type: 'png' }));
  n += 1;
}
await browser.close();
console.log(`${n} cards written — og-image.png and og/ for ${registry.boards.length} rankings.`);

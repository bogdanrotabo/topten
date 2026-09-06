#!/usr/bin/env node
/**
 * What a link looks like when somebody shares it.
 *
 *   node scripts/card.mjs                       the front page and two rankings
 *   node scripts/card.mjs https://topten.one/crypto/    any address
 *
 * Reads the LIVE page the way a crawler reads it -- same user agent, same
 * fetch, no cache -- pulls out what the card is built from, checks the parts
 * that quietly break a card, and draws it as X, Facebook and WhatsApp draw it.
 *
 * It exists because there is no other way to be sure. X retired the validator
 * that used to show this, and every remaining answer is somebody's word for
 * it. This reads the bytes.
 *
 * What it cannot do is reach into a platform's cache. A preview showing old
 * words is that platform holding a card it crawled long ago; this says what
 * the page serves NOW, which is the half anybody can act on.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
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
const OUT = join(root, 'card-preview');

const urls = process.argv.slice(2).length ? process.argv.slice(2)
  : ['https://topten.one/', 'https://topten.one/crypto/', 'https://topten.one/youtube/'];

/* The agent matters: some sites answer a crawler differently from a browser,
   and if this asked as a browser it would be checking the wrong page. */
const AGENT = 'Twitterbot/1.0';

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const unent = (s) => String(s || '')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&mdash;/g, '—')
  .replace(/&middot;/g, '·').replace(/&nbsp;/g, ' ');

function metaOf(html) {
  const out = {};
  for (const m of html.matchAll(/<meta\s+[^>]*>/gi)) {
    const tag = m[0];
    const key = (tag.match(/(?:property|name)="([^"]+)"/i) || [])[1];
    const val = (tag.match(/content="([^"]*)"/i) || [])[1];
    if (key) out[key.toLowerCase()] = unent(val);
  }
  out.title = unent((html.match(/<title>([^<]*)<\/title>/i) || [])[1]);
  return out;
}

async function check(url) {
  const res = await fetch(url, { headers: { 'user-agent': AGENT }, redirect: 'follow' });
  const html = await res.text();
  const m = metaOf(html);

  const card = {
    url,
    status: res.status,
    finalUrl: res.url,
    type: m['twitter:card'] || '(none)',
    title: m['twitter:title'] || m['og:title'] || m.title || '',
    desc: m['twitter:description'] || m['og:description'] || m.description || '',
    image: m['twitter:image'] || m['og:image'] || '',
    alt: m['twitter:image:alt'] || m['og:image:alt'] || '',
    site: m['og:site_name'] || new URL(url).hostname,
    width: m['og:image:width'] || '',
    height: m['og:image:height'] || '',
  };

  /* The image is the half that fails silently: a card with a title and a dead
     picture is a card that renders as a bare link. */
  card.img = { ok: false };
  if (card.image) {
    try {
      const r = await fetch(card.image, { headers: { 'user-agent': AGENT } });
      const buf = Buffer.from(await r.arrayBuffer());
      const png = buf.length > 24 && buf[1] === 0x50 && buf[2] === 0x4e;
      card.img = {
        ok: r.ok,
        status: r.status,
        type: r.headers.get('content-type') || '',
        bytes: buf.length,
        w: png ? buf.readUInt32BE(16) : null,
        h: png ? buf.readUInt32BE(20) : null,
        /* Carried as bytes rather than as an address. The drawing has to show
           the picture a crawler actually receives, and a browser that cannot
           reach the site -- behind a proxy, offline, on a machine that has
           never heard of it -- would draw a broken-image icon and call it a
           preview. These are the same bytes the check above measured. */
        data: r.ok ? `data:${r.headers.get('content-type') || 'image/png'};base64,${buf.toString('base64')}` : '',
      };
    } catch (e) { card.img = { ok: false, status: 'unreachable' }; }
  }
  return card;
}

/* Drawn at each platform's own proportions rather than one mock for all three:
   the whole question is whether a title survives the crop, and they crop
   differently. */
function preview(c) {
  const host = new URL(c.finalUrl).hostname;
  const src = (c.img && c.img.data) || '';
  return `<!doctype html><meta charset="utf-8"><style>
* { box-sizing: border-box; margin: 0; }
body { width: 1240px; background: #0f1115; color: #e7e9ee; padding: 26px;
  font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; display: flex; gap: 24px; }
.col { width: 380px; }
.h { font-size: 12px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase;
  color: #8b93a7; margin-bottom: 10px; }

/* X, summary_large_image: the picture, then the host, title and description
   under it, all inside one rounded frame. */
.x { border: 1px solid #2f3336; border-radius: 16px; overflow: hidden; background: #000; }
.x img { display: block; width: 100%; aspect-ratio: 1200/628; object-fit: cover; }
.x .b { padding: 12px 14px; }
.x .u { font-size: 13px; color: #71767b; }
.x .t { font-size: 15px; color: #e7e9ea; margin-top: 2px;
  display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; overflow: hidden; }
.x .d { font-size: 15px; color: #71767b; margin-top: 2px;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }

/* Facebook: the host above the title, description last, on grey. */
.f { border: 1px solid #dadde1; border-radius: 8px; overflow: hidden; background: #f0f2f5; color: #050505; }
.f img { display: block; width: 100%; aspect-ratio: 1.91/1; object-fit: cover; }
.f .b { padding: 10px 12px; }
.f .u { font-size: 12px; color: #65676b; text-transform: uppercase; }
.f .t { font-size: 16px; font-weight: 600; margin-top: 3px;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.f .d { font-size: 14px; color: #65676b; margin-top: 2px;
  display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; overflow: hidden; }

/* WhatsApp: a bubble, and the tightest crop of the three. */
.w { background: #005c4b; border-radius: 10px; padding: 4px; width: 330px; }
.w .in { background: rgba(0,0,0,.16); border-radius: 8px; overflow: hidden; }
.w img { display: block; width: 100%; aspect-ratio: 1.91/1; object-fit: cover; }
.w .b { padding: 8px 10px; }
.w .t { font-size: 13.5px; font-weight: 600; color: #e9edef;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.w .d { font-size: 12.5px; color: #8696a0; margin-top: 2px;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.w .u { font-size: 12px; color: #8696a0; margin-top: 3px; }
</style>
<div class="col"><div class="h">X</div>
  <div class="x">${src ? `<img src="${src}">` : ''}
    <div class="b"><div class="u">From ${esc(host)}</div>
      <div class="t">${esc(c.title)}</div><div class="d">${esc(c.desc)}</div></div></div></div>
<div class="col"><div class="h">Facebook / LinkedIn</div>
  <div class="f">${src ? `<img src="${src}">` : ''}
    <div class="b"><div class="u">${esc(host)}</div>
      <div class="t">${esc(c.title)}</div><div class="d">${esc(c.desc)}</div></div></div></div>
<div class="col"><div class="h">WhatsApp / Telegram</div>
  <div class="w"><div class="in">${src ? `<img src="${src}">` : ''}
    <div class="b"><div class="t">${esc(c.title)}</div>
      <div class="d">${esc(c.desc)}</div><div class="u">${esc(host)}</div></div></div></div></div>`;
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 1240, height: 460 }, deviceScaleFactor: 2 });
mkdirSync(OUT, { recursive: true });

let problems = 0;
for (const url of urls) {
  const c = await check(url);
  const slug = new URL(c.finalUrl).pathname.replace(/\//g, '-').replace(/^-|-$/g, '') || 'home';

  /* The image has to be reachable BY THE BROWSER for the drawing to mean
     anything, so it is fetched here rather than linked. */
  await page.setContent(preview(c), { waitUntil: 'networkidle' });
  const file = join(OUT, `${slug}.png`);
  writeFileSync(file, await page.screenshot({ fullPage: true }));

  const say = [];
  if (c.status !== 200) say.push(`page answered ${c.status}`);
  if (c.type !== 'summary_large_image') say.push(`card type is "${c.type}", not summary_large_image`);
  if (!c.image) say.push('no image');
  else if (!c.img.ok) say.push(`image answered ${c.img.status}`);
  else if (!/^image\//.test(c.img.type)) say.push(`image is ${c.img.type}`);
  else if (c.img.w && c.img.w < 300) say.push(`image is only ${c.img.w}px wide`);
  if (!c.alt) say.push('no alt text on the image');
  if (c.width && c.img.w && String(c.img.w) !== String(c.width))
    say.push(`says ${c.width}px wide, is ${c.img.w}px`);
  problems += say.length;

  console.log(`\n${c.finalUrl}`);
  console.log(`  card      ${c.type}`);
  console.log(`  title     "${c.title}"  (${c.title.length} chars)`);
  console.log(`  text      "${c.desc}"  (${c.desc.length} chars)`);
  console.log(`  image     ${c.image}`);
  console.log(`            ${c.img.status} ${c.img.type} ${c.img.w}x${c.img.h} ${c.img.bytes} bytes`);
  console.log(`  alt       ${c.alt || '(none)'}`);
  console.log(`  drawn     ${file.replace(root + '/', '')}`);
  console.log(say.length ? `  PROBLEMS  ${say.join('; ')}` : '  nothing wrong with it');
}
await browser.close();
console.log(`\n${urls.length} link${urls.length > 1 ? 's' : ''} read from the live site, ${problems} problem${problems === 1 ? '' : 's'}.`);

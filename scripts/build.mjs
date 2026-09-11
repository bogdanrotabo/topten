#!/usr/bin/env node
/**
 * Write the whole site.
 *
 *   node scripts/build.mjs
 *
 * Every page is generated here, with the ranking already in it: a crawler, a
 * link preview and a reader whose JavaScript never arrives all get the real
 * numbers rather than an empty shell. app.js then re-reads the same views in
 * the browser and redraws the same regions with the same functions from
 * render.js, so the two cannot say different things.
 *
 * It needs the network. Without one it stops rather than writing a site full
 * of empty rankings over a good one.
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

import { esc, money, shortDate, situation, costToOpen, MIN_CENTS } from '../lib.js';
import { topTwo, amounts, row, battle, trend, openOne, move, ticker, tally, CROWN } from '../render.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const R = (p) => join(root, p);

/* ------------------------------------------------------------- the data --- */

const cfg = (() => {
  const src = readFileSync(R('config.js'), 'utf8');
  const pick = (k) => (src.match(new RegExp(k + ':\\s*"([^"]*)"')) || [])[1] || '';
  return {
    url: pick('SUPABASE_URL'),
    key: pick('SUPABASE_ANON_KEY'),
    pay: pick('STRIPE_PAYMENT_LINK'),
    ga: pick('GA_MEASUREMENT_ID'),
    mail: pick('CONTACT_EMAIL'),
  };
})();

async function read(path, init) {
  const res = await fetch(`${cfg.url}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}`, 'Content-Type': 'application/json',
               ...(init && init.headers) },
  });
  if (!res.ok) throw new Error(`${path} ${res.status}: ${await res.text()}`);
  return res.json();
}

const registry = JSON.parse(readFileSync(R('boards.json'), 'utf8'));
const byGroup = new Map(registry.groups.map((g) => [g.id, g]));
const bySlug = new Map(registry.boards.map((b) => [b.slug, b]));

console.log('reading the rankings…');
const [rows, market, numbers] = await Promise.all([
  read('board?select=id,platform,handle,tagline,link,total_cents,last_paid_at,created_at,rank'
       + '&order=platform.asc,rank.asc&limit=2000'),
  read('rpc/market', { method: 'POST', body: '{}' }),
  read('rpc/site_numbers', { method: 'POST', body: '{}' }),
]);

/* Every board the registry knows about, whether or not anybody has paid. */
const boards = registry.boards.map((b) => {
  const mine = rows.filter((r) => r.platform === b.slug);
  return { ...b, rows: mine, s: situation(mine), groupName: byGroup.get(b.group).name };
});
const live = boards.filter((b) => b.rows.length);
const openBoards = boards.filter((b) => !b.rows.length);

/* The races where the smallest sum changes the top. Cheapest first, because
   the price is the whole invitation. */
const battles = live
  .filter((b) => b.s.two)
  .map((b) => ({ slug: b.slug, boardName: b.name, one: b.s.one, two: b.s.two, price: b.s.price }))
  .sort((a, b) => a.price - b.price || b.one.total_cents - a.one.total_cents);

/* What actually moved in seven days, from the same buckets the database uses. */
const trending = market
  .filter((m) => m.d7_cents > 0 && bySlug.has(m.platform))
  .map((m) => ({ ...m, slug: m.platform, boardName: bySlug.get(m.platform).name }))
  .sort((a, b) => b.d7_cents - a.d7_cents)
  .slice(0, 5);

const groups = registry.groups.map((g) => {
  const mine = live.filter((b) => b.group === g.id);
  const listed = mine.reduce((n, b) => n + b.rows.length, 0);
  const cents = mine.reduce((n, b) => n + b.rows.reduce((m, r) => m + r.total_cents, 0), 0);
  const top = mine.flatMap((b) => b.rows.map((r) => ({ ...r, boardName: b.name })))
    .sort((a, b) => b.total_cents - a.total_cents)[0];
  return { ...g, listed, cents, top, boards: mine.length };
}).filter((g) => g.listed > 0).sort((a, b) => b.cents - a.cents);

/* The most recent payments, as sentences. Only what the tables can prove. */
const recent = [...rows]
  .filter((r) => r.last_paid_at)
  .sort((a, b) => new Date(b.last_paid_at) - new Date(a.last_paid_at))
  .slice(0, 3)
  .map((r) => {
    const b = bySlug.get(r.platform);
    const s = boards.find((x) => x.slug === r.platform).s;
    const isOne = s.one && s.one.id === r.id;
    return {
      when: shortDate(r.last_paid_at),
      html: '<b>' + esc(r.handle) + '</b> '
        + (isOne ? 'holds #1 on ' : 'moved on ')
        + '<a href="/' + esc(b.slug) + '/">' + esc(b.name) + '</a> with '
        + '<span class="num">' + esc(money(r.total_cents)) + '</span>.',
    };
  });

/* Everybody who has paid, newest payment first, for the strip that runs across
   the top. The rank each name carries is its rank on its own ranking, worked
   out before this is sorted, so a name that is #4 on Crypto still says #4
   wherever it lands on the strip. Only the strip's order changed.

   Capped at forty. The track is printed twice, so forty names is eighty cells
   of markup in every page on the site; past that the strip is carrying weight
   nobody reads to the end of. */
const ticks = rows
  .filter((r) => r.last_paid_at && bySlug.has(r.platform))
  .sort((a, b) => new Date(b.last_paid_at) - new Date(a.last_paid_at))
  .slice(0, 40)
  .map((r) => ({
    handle: r.handle,
    boardName: bySlug.get(r.platform).name,
    rank: r.rank,
    cents: r.total_cents,
  }));

console.log(`  ${rows.length} listings across ${live.length} rankings, `
  + `${openBoards.length} still open, ${battles.length} races with a challenger`);

/* ------------------------------------------------------ what changed --- */

/* A stamp on every address the browser caches.
 *
 * This site is served with two different lifetimes: the HTML expires in ten
 * minutes and the stylesheet and scripts in four hours. So for up to four
 * hours after a deploy, anybody who has been here recently gets NEW markup
 * with OLD rules -- and markup whose rules have not arrived is not a slightly
 * stale page, it is a broken one. The strip that runs across the top landed
 * as sixteen hundred pixels of names run together above the title, in the
 * previous palette, because .ticker did not exist in the stylesheet the
 * browser still had.
 *
 * The stamp is the content's own hash, so the address changes when and only
 * when the file does. Four hours of caching is right for a file that has not
 * changed and wrong for one that has; this is the difference.
 *
 * The three modules share one stamp on purpose. app.js imports lib.js and
 * render.js by their own addresses, which a query on app.js cannot reach, so
 * the import lines are rewritten below to carry the same stamp -- and it has
 * to be a stamp over all three, or a change in lib.js alone would leave a
 * cached app.js still asking for the previous one.
 */
const stamp = (text) => createHash('sha256').update(text).digest('hex').slice(0, 10);

/* The version markers a previous build wrote, taken back off before hashing,
   so the stamp is of the source and not of the last build's output. */
const bare = (text) => text.replace(/(from\s+['"]\.\/[\w.-]+\.js)\?v=[a-f0-9]+(['"])/g, '$1$2');

const V = (() => {
  const js = ['app.js', 'lib.js', 'render.js'].map((f) => bare(readFileSync(R(f), 'utf8')));
  return {
    css: stamp(readFileSync(R('styles.css'), 'utf8')),
    js: stamp(js.join('\n')),
    cfg: stamp(readFileSync(R('config.js'), 'utf8')),
    dash: stamp(readFileSync(R('dashboard.js'), 'utf8')),
  };
})();

/* app.js reaches lib.js and render.js by address, and render.js reaches lib.js
   the same way, so every one of those addresses carries the stamp. app.js
   alone was rewritten before, which left render.js importing a bare ./lib.js:
   the four-hour cache then held that lib.js stale across a deploy that changed
   it, and a cached render.js asking for the previous lib.js is the exact "new
   markup, old rules" this stamp exists to stop. Written back to the file each
   was read from: this is build output living in a source file, worth one line
   of noise in a diff and the only place a module's own imports can be versioned
   without an import map -- and an import map would need an inline script, which
   is the one thing the policy below does not allow. */
for (const f of ['app.js', 'render.js']) {
  const original = readFileSync(R(f), 'utf8');
  const out = bare(original).replace(/(from\s+['"]\.\/[\w.-]+\.js)(['"])/g, `$1?v=${V.js}$2`);
  if (out !== original) writeFileSync(R(f), out);
}

/* ------------------------------------------------------------ the shell --- */

const SITE = 'https://topten.one';

/* The content security policy.
 *
 * There is no inline script on any page any more -- config.js and app.js are
 * both files -- so script-src is a flat 'self' with no hash to keep in step
 * with an edit, which is what used to break. Inline STYLE attributes are how
 * the markup is written, so style-src-attr has to allow them; that is a much
 * smaller door than an inline script, and the one that matters is shut.
 *
 * connect-src names the database and nothing else. A page that started talking
 * to anywhere else would be stopped by the browser before it could.
 */
function csp() {
  const connect = ["'self'", cfg.url].concat(
    cfg.ga ? ['https://*.google-analytics.com', 'https://*.analytics.google.com'] : []).join(' ');
  const script = ["'self'"].concat(cfg.ga ? ['https://www.googletagmanager.com'] : []).join(' ');
  return [
    "default-src 'self'",
    `script-src ${script}`,
    "style-src 'self' https://fonts.googleapis.com",
    "style-src-attr 'unsafe-inline'",
    'font-src https://fonts.gstatic.com',
    "img-src 'self' data:",
    `connect-src ${connect}`,
    "base-uri 'self'",
    "form-action 'self'",
    /* frame-ancestors is header-only; a meta tag carrying it is ignored and
       warns in the console on every page. GitHub Pages sets no headers, so
       this is a gap rather than a setting -- named here so it is not
       rediscovered as a surprise. */
    "object-src 'none'",
    "manifest-src 'self'",
  ].join('; ');
}

/* Google Analytics, when config names a property. The site keeps its own count
   in site_visits either way; this is the owner's existing measurement, and
   dropping it silently would throw away the history it has already gathered. */
function ga() {
  if (!cfg.ga) return '';
  return `<script async src="https://www.googletagmanager.com/gtag/js?id=${esc(cfg.ga)}"></script>
<script src="/ga.js"></script>`;
}

function head({ title, description, path, image }) {
  return `<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${esc(csp())}">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${SITE}${path}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700;800&display=swap">
<link rel="stylesheet" href="/styles.css?v=${V.css}">
<link rel="icon" href="/icons/icon-192.png" sizes="192x192">
<link rel="apple-touch-icon" href="/icons/icon-192.png">
<link rel="manifest" href="/manifest.json">
<meta name="theme-color" content="#faf9f7">
<meta property="og:type" content="website">
<meta property="og:site_name" content="TopTen.one">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${SITE}${path}">
<meta property="og:image" content="${SITE}${image || '/og-image.png'}">
<!-- The size, said rather than left to be discovered. A crawler that knows the
     dimensions before it has the file can lay the card out on the first pass;
     one that does not sometimes falls back to the small square card, which is
     the difference between a headline somebody reads and a thumbnail nobody
     does. Every card this site writes is 1200x630. -->
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:type" content="image/png">
<meta property="og:image:alt" content="${esc(title)}">
<meta property="og:locale" content="en">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${SITE}${image || '/og-image.png'}">
<meta name="twitter:image:alt" content="${esc(title)}">`;
}

const ICON = {
  search: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
  menu: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M3 6h18M3 12h18M3 18h18"/></svg>',
  back: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
  share: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12v7a1 1 0 001 1h14a1 1 0 001-1v-7"/><path d="M12 3v13M8 7l4-4 4 4"/></svg>',
  link: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 007 0l3-3a5 5 0 00-7-7l-1 1"/><path d="M14 11a5 5 0 00-7 0l-3 3a5 5 0 007 7l1-1"/></svg>',
};

/* "Which coin should be #1?" with the #1 in gold. The question is escaped
   whole and the marker put back afterwards, so the only markup that survives
   is the one this function put there. */
function question(q) {
  return esc(q).split('#1').join('<em>#1</em>');
}

/* Where the site is made. Drawn rather than written as an emoji: a flag
   character renders as two letters on most of Windows, which is how this
   line came to say "CH" on a PC the last time it was tried. */
const SWISS = '<svg class="swiss__flag" viewBox="0 0 32 32" width="14" height="14" aria-hidden="true">'
  + '<rect width="32" height="32" rx="4" fill="#DA291C"/>'
  + '<path fill="#fff" d="M13 6h6v7h7v6h-7v7h-6v-7H6v-6h7z"/></svg>';

const swissLine = `<p class="swiss">${SWISS}<span>Swiss made &middot; Available worldwide</span></p>`;

const wordmark = `<a class="wordmark" href="/"><span style="color:var(--gold)">${CROWN}</span>TOPTEN.ONE</a>`;

function masthead({ back = false, share = false } = {}) {
  return `<header class="masthead above">
  <div class="masthead__left">${back ? `<a class="ico" href="/" aria-label="Back">${ICON.back}</a>` : ''}${wordmark}</div>
  <div class="masthead__tools">${share
      ? `<button type="button" class="ico" id="share" aria-label="Share this ranking">${ICON.share}</button>`
      : `<a class="ico" href="/find/" aria-label="Search">${ICON.search}</a>`}
    <a class="ico" href="/find/" aria-label="All rankings">${ICON.menu}</a>
  </div>
</header>`;
}

function footer() {
  return `<footer class="foot">
  <div class="foot__line">No algorithm. No editors.<br>Only what people paid.</div>
  <nav class="foot__nav">
    <a href="/about.html">About</a><a href="/terms.html">Terms</a>
    <a href="/privacy.html">Privacy</a>
  </nav>
  <!-- The address itself, not the word "Contact". An address somebody can read
       is an address somebody can use from their phone, write down, or check
       against the one an email claiming to be us came from. -->
  <!-- The comments are not decoration. Cloudflare's Email Address Obfuscation
       rewrites every address it finds in the HTML into a "[email protected]"
       placeholder that only its own script can turn back into an address, so
       the live footer read "Write to [email protected]" -- the one thing this
       line exists not to say. email_off is the documented way to exempt a
       fragment, and it needs no change to anybody's Cloudflare settings. -->
  <p class="foot__mail">Write to <!--email_off--><a href="mailto:${esc(cfg.mail)}">${esc(cfg.mail)}</a><!--email_on--></p>
  <p class="foot__legal">Payments are final and buy a position on a public ranking. Not an investment,
  not a vote, not an endorsement. Minimum payment ${esc(money(MIN_CENTS))}.</p>
</footer>`;
}

function page({ title, description, path, image, body, cls = '', shell = '' }) {
  return `<!doctype html>
<html lang="en">
<head>
${head({ title, description, path, image })}
</head>
<body${cls ? ` class="${cls}"` : ''}>
<main class="shell${shell ? ' ' + shell : ''}">
${body}
</main>
<script src="/config.js?v=${V.cfg}"></script>
<script type="module" src="/app.js?v=${V.js}"></script>
${ga()}
</body>
</html>
`;
}

/* -------------------------------------------------------------- the home -- */

function homeBody() {
  const n = numbers;
  const lead = battles[0];
  const leadBoard = lead ? boards.find((b) => b.slug === lead.slug) : null;

  return `<div class="wash wash--violet"></div><div class="wash wash--magenta"></div>
${masthead()}
${tally(numbers)}
${ticker(ticks)}

<div class="home-col">
<section class="hero above">
  ${swissLine}
  <h1 class="hero__q">WHO SHOULD<br>BE <em>#1</em>?</h1>
  <p class="hero__sub">Pick a side. Move the ranking.</p>
  <a class="cta" href="${leadBoard ? '/' + esc(leadBoard.slug) + '/' : '/find/'}" style="margin-top:28px">Explore now</a>
  <div class="search-wrap">${ICON.search.replace('width="20" height="20"', 'width="17" height="17"')}
    <input class="search" id="q" type="search" placeholder="Find anyone or anything" aria-label="Find anyone or anything" autocomplete="off">
  </div>
  <div id="q-out"></div>
</section>
</div>

<div class="home-col home-col--side">
<section class="sect" id="groups">
  <h2 class="eyebrow">What are you into</h2>
  <div class="grid2">${groups.map((g) => `<a class="glass tile" href="/find/#${esc(g.id)}">
    <div class="tile__name">${esc(g.name)}</div>
    <div class="tile__sub num">${g.listed} &middot; ${esc(money(g.cents))}</div></a>`).join('')}</div>
</section>
</div>

<section class="sect" id="every">
  <div class="sect__head"><h2 class="eyebrow">Every ranking</h2>
    <span class="sect__note num">${registry.boards.length} of them</span></div>
  ${registry.groups.map((g) => {
    const mine = boards.filter((b) => b.group === g.id);
    return mine.length ? `<div class="every__group">
    <h3 class="every__label">${esc(g.name)}</h3>
    <div class="pills">${mine.map((b) => `<a class="pill" href="/${esc(b.slug)}/">${esc(b.name)}${
      b.rows.length ? '' : ' <span style="color:var(--gold)">&middot;</span>'}</a>`).join('')}</div>
  </div>` : '';
  }).join('')}
  <p class="fine">A gold dot marks a ranking nobody has paid into yet. There ${openBoards.length === 1 ? 'is' : 'are'}
    ${openBoards.length} of them, and the first ${esc(money(costToOpen()))} takes the top of any one.</p>
</section>

<section class="sect" id="happening">
  <div class="sect__head"><h2 class="eyebrow">Happening now</h2>
    <span class="sect__note">Most recent payments</span></div>
  <div class="glass moves">${recent.map((m, i) => (i ? '<hr class="hr" style="margin:16px 0">' : '') + move(m)).join('')}</div>
</section>

<div class="home-col home-col--battles">
<section class="sect" id="battles">
  <div class="sect__head"><h2 class="eyebrow">Closest battles</h2>
    <a class="sect__link" href="/find/">See all</a></div>
  ${lead ? `<div style="margin-top:16px">${topTwo(leadBoard.s)}
    <div style="margin-top:14px"><a class="cta" href="/${esc(lead.slug)}/">Back ${esc(lead.two.handle)}</a>
    ${amounts(leadBoard.s, leadBoard.name, payTo(lead.two.id))}</div></div>` : ''}
  <div style="margin-top:14px">${battles.slice(1, 4).map(battle).join('')}</div>
  <p class="fine">The gap plus one cent, or ${esc(money(MIN_CENTS))} &mdash; whichever is larger. A tie stays below.</p>
</section>
</div>

<div class="home-col home-col--after">
<section class="sect" id="trending">
  <div class="sect__head"><h2 class="eyebrow">Trending</h2>
    <span class="sect__note">Money moved, 7 days</span></div>
  <div class="stack">${trending.map((t, i) => trend(t, i + 1)).join('')}</div>
</section>

<section class="sect" id="open">
  <div class="sect__head"><h2 class="eyebrow">Open #1</h2>
    <span class="sect__note num">${openBoards.length} of ${registry.boards.length}</span></div>
  <p class="lede">Nobody has paid into these yet. The first
    <span class="num" style="color:var(--gold);font-weight:700">${esc(money(costToOpen()))}</span> takes the top.</p>
  <div class="stack">${openBoards.slice(0, 3).map(openOne).join('')}</div>
  <a class="ghost" href="/find/" style="margin-top:12px">See the other ${openBoards.length - 3}</a>
</section>

${partners()}
</div>

<section class="sect" id="spread">
  <h2 class="eyebrow">Bring someone in</h2>
  <p class="lede">Nothing here moves until the other side hears about it.</p>
  ${shareBar(SITE + '/', 'Who should be #1? On TopTen.one the only thing that moves a ranking is money.')}
</section>


${footer()}`;
}

/* ------------------------------------------------------------- a ranking -- */

/* What a ranking says when somebody puts it in front of their own people.
   Where it stands, not a slogan -- a position with a figure on it is an
   argument, and an argument is what gets forwarded. */
function shareLine(b) {
  const s = b.s;
  if (s.empty) return `${b.q} Nobody has paid into this one yet -- the first ${money(MIN_CENTS)} takes #1.`;
  if (!s.two) return `${b.q} ${s.one.handle} holds #1 with ${money(s.one.total_cents)}.`;
  return `${b.q} ${s.one.handle} holds #1 with ${money(s.one.total_cents)}, `
    + `${s.two.handle} is ${money(s.price)} behind.`;
}

function boardBody(b) {
  const s = b.s;
  const rest = s.list.slice(2);

  /* Who the button pays for, and the link that carries them. On a ranking
     nobody has paid into there is nobody, and the button used to say so and
     then do nothing -- a dead end with the only way forward folded shut below
     a full ranking. So an empty ranking's first action is the one that is
     actually available: put a name on it. */
  const target = s.two || s.one || null;
  const href = target ? payTo(target.id) : null;

  return `<div class="wash wash--gold"></div>
${masthead({ back: true, share: true })}
${tally(numbers)}
${ticker(ticks)}

<section class="hero above" style="padding-top:40px">
  ${swissLine}
  <div class="eyebrow">${esc(b.groupName)}</div>
  <h1 class="page-title">${question(b.q)}</h1>
  <p class="fine num" style="margin-top:14px">${b.rows.length} listed &middot;
    ${esc(money(b.rows.reduce((n, r) => n + r.total_cents, 0)))} backed</p>
</section>

<section class="sect" id="top" style="margin-top:26px">${topTwo(s)}</section>

<section class="sect" id="back" style="margin-top:18px">
  ${target
    ? `<a class="cta" id="pay"${href ? ` href="${esc(href)}"` : ' aria-disabled="true"'}>Back ${esc(target.handle)}</a>`
    : `<a class="cta" id="pay" href="#add-name">Add the first name</a>`}
  ${amounts(s, b.name, href)}
</section>

<section class="sect" id="add">
  <details class="add"${s.empty ? ' open' : ''}>
    <summary class="ghost">Add a name to this ranking</summary>
    <div class="add__body">
      <p class="lede">Anything can be listed here. Adding it is free; holding a position is not
        &mdash; a listing appears on the ranking once a payment lands on it, and the first one
        can be ${esc(money(MIN_CENTS))}.</p>
      <form id="add-form" novalidate>
        <label class="field"><span class="field__k">Name</span>
          <input class="field__i" id="add-name" maxlength="40" required
                 placeholder="${esc(b.example || 'The name as people write it')}" autocomplete="off"></label>
        <label class="field"><span class="field__k">Link, if it has one</span>
          <input class="field__i" id="add-link" maxlength="200" type="url" inputmode="url"
                 placeholder="https://" autocomplete="off"></label>
        <button type="submit" class="cta" style="margin-top:14px">Add and back it</button>
        <div id="add-out"></div>
      </form>
      <p class="fine">You will be sent to Stripe to pay. Nothing is listed publicly until a
        payment lands, and the amount you type there is what it holds.</p>
    </div>
  </details>
</section>

${rest.length ? `<section class="sect" id="rest">
  <h2 class="eyebrow" style="padding-bottom:14px">Full ranking</h2>
  <div class="glass" style="overflow:hidden">${rest.map((r, i) =>
    (i ? '<hr class="hr">' : '') + row(r, i + 3)).join('')}</div>
</section>` : ''}

<section class="sect" id="spread">
  <h2 class="eyebrow">Bring someone in</h2>
  <p class="lede">A ranking only moves when the other side hears about it.</p>
  ${shareBar(SITE + '/' + b.slug + '/', shareLine(b))}
</section>

<section class="sect" id="how">
  <h2 class="eyebrow">How this works</h2>
  <p class="lede">Position is decided by the total paid towards a listing, and nothing else. Payments add up
    and cannot be moved, split or withdrawn. If two listings hold the same total, the one that reached it
    first stays above &mdash; so taking #1 costs a cent more than matching it, or ${esc(money(MIN_CENTS))},
    whichever is larger. A listing drops off 30 days after its last payment and keeps its total if it
    comes back.</p>
</section>

${footer()}`;
}

/* The band at the foot of the front page: the two other sites, side by side
 * and the same size, because neither is the bigger one.
 *
 * Both sit on gift.ceo's near-black. rotabo's own ground is lavender and it
 * had it here, which on a page this dark read as a white hole punched beside
 * the other card rather than as rotabo's colour -- two boxes that were not a
 * pair. The ground is shared now and each mark stays its own: gift.ceo's gold
 * on it, rotabo's violet and gold diamonds on it. Neither is redrawn in
 * TopTen's gold, because a mark that has been repainted is not that mark.
 *
 * There is no "Sponsors" over them. These are the owner's own two sites, and
 * calling them sponsors would be the band claiming something it does not have.
 * The line underneath says what the place is and that it is open, which is the
 * true version of the same invitation.
 */
/* The mark is the file rotabo.app ships as its own icon, cropped to the two
 * diamonds and nothing else -- not one diamond redrawn here from its path.
 * Redrawing it made it half a logo: rotabo's mark is a violet diamond AND a
 * gold one, and only the violet was ever on this page. */
const DIAMOND =
  '<img class="pb__mark" src="/icons/rotabo-mark.png" width="38" height="22"'
  + ' alt="" aria-hidden="true">';

function partners() {
  return `<section class="sect" id="partners">
  <h2 class="eyebrow">Elsewhere</h2>
  <div class="pb">
    <a class="pb__b pb__b--gift" href="https://gift.ceo" target="_blank" rel="noopener">
      <span class="pb__w">gift<b>.ceo</b></span>
      <span class="pb__t">Only CEOs give here.</span>
    </a>
    <a class="pb__b pb__b--rotabo" href="https://rotabo.app" target="_blank" rel="noopener">
      <span class="pb__w">${DIAMOND}Rotabo</span>
      <span class="pb__t">People need things. People have things.</span>
    </a>
  </div>
  <p class="fine">Two other sites by the same people. This place is held for an organisation
    that stands behind the idea &mdash; it costs nothing, and it never will.</p>
</section>`;
}

/* The share row, built the way rotabo.app builds its own.
 *
 * Every link is static markup and works with no script at all -- a share
 * button that needs JavaScript to have a destination is a share button that
 * does nothing on the one connection where sharing mattered.
 *
 * There is no Instagram, TikTok, YouTube or Snapchat button and there never
 * will be: none of them has a web address that opens a composer with a link
 * already in it, so a button could only ever look like it worked. The phone's
 * own share sheet reaches all four, and that is what "More" is -- hidden here
 * and revealed by app.js only on a browser that actually has one.
 *
 * The sentence is written per page rather than once for the site. "Who should
 * be #1 on Crypto? Hyperliquid holds it with $23" is a thing somebody might
 * argue with; "check out TopTen.one" is not.
 */
function shareBar(url, text) {
  const u = encodeURIComponent(url);
  const t = encodeURIComponent(text);
  const both = encodeURIComponent(text + ' ' + url);
  const at = (href, label) =>
    `<a class="sb" href="${esc(href)}" target="_blank" rel="noopener">${esc(label)}</a>`;
  return `<div class="sharebar" data-share-url="${esc(url)}" data-share-text="${esc(text)}">
  <button type="button" class="sb" data-share-copy>Copy link</button>
  ${at(`https://x.com/intent/post?text=${t}&url=${u}`, 'X')}
  ${at(`https://wa.me/?text=${both}`, 'WhatsApp')}
  ${at(`https://t.me/share/url?url=${u}&text=${t}`, 'Telegram')}
  ${at(`https://www.facebook.com/sharer/sharer.php?u=${u}`, 'Facebook')}
  ${at(`https://www.reddit.com/submit?url=${u}&title=${t}`, 'Reddit')}
  ${at(`https://www.linkedin.com/sharing/share-offsite/?url=${u}`, 'LinkedIn')}
  ${at(`https://www.threads.net/intent/post?text=${both}`, 'Threads')}
  ${at(`mailto:?subject=${t}&body=${both}`, 'Email')}
  <button type="button" class="sb" data-share-sheet hidden>More</button>
</div>`;
}

/* The Back button as it is written into the page.
 *
 * It carries the listing already, because a reader whose JavaScript never
 * arrives must still be able to pay -- and a payment that reaches Stripe with
 * no client_reference_id comes back naming no listing, which means money taken
 * and nothing credited. app.js replaces this href a moment later with the same
 * listing plus the visit that sent it, which is the half that only matters for
 * knowing where the traffic came from.
 */
function payTo(listingId) {
  if (!cfg.pay || !listingId) return null;
  const u = new URL(cfg.pay);
  u.searchParams.set('client_reference_id', listingId);
  return u.toString();
}

/* The manifest, written here rather than kept by hand.
 *
 * It still said "King of the Hill -- One page. One king. Pay more than them
 * and it's yours." That game was removed weeks ago, so anybody installing the
 * site to a home screen got the name of something that no longer exists. A
 * file describing the site that is not written by the thing that writes the
 * site will go stale, and this one did.
 */
function manifest() {
  return JSON.stringify({
    name: 'TopTen.one — who should be #1?',
    short_name: 'TopTen.one',
    description: `${registry.boards.length} rankings, and the only thing that moves you up is money. `
      + 'Pick a side. Move the ranking.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#faf9f7',
    theme_color: '#faf9f7',
    orientation: 'portrait-primary',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }, null, 2) + '\n';
}

/* --------------------------------------------------------------- writing -- */

function write(path, html) {
  const full = R(path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, html);
}

const seo = (b) => {
  const s = b.s;
  if (s.empty) return { t: `${b.name} — nobody is #1 yet | TopTen.one`,
    d: `${b.q} Nobody has paid into this ranking. The first ${money(costToOpen())} takes the top.` };
  if (!s.two) return { t: `${s.one.handle} is #1 — ${b.name} | TopTen.one`,
    d: `${s.one.handle} holds #1 in ${b.name} with ${money(s.one.total_cents)}. ${b.q}` };
  return { t: `${s.one.handle} is #1 — ${b.name} | TopTen.one`,
    d: `${s.one.handle} holds #1 with ${money(s.one.total_cents)}; ${s.two.handle} is `
       + `${money(s.price)} away. ${b.q}` };
};

write('index.html', page({
  title: 'Who should be #1? | TopTen.one',
  description: `Public rankings decided by money, not by an algorithm. ${numbers.listed} listings, `
    + `${money(numbers.backed_cents)} backed. Pick a side and move one.`,
  path: '/', body: homeBody(), shell: 'shell--home',
}));
console.log('  index.html');

for (const b of boards) {
  const { t, d } = seo(b);
  write(`${b.slug}/index.html`, page({ title: t, description: d, path: `/${b.slug}/`,
    /* The card a link to this ranking shows: its own question, drawn by
       scripts/og.mjs and committed. Not the leader -- a name baked into a
       committed picture starts going stale the moment somebody pays. */
    image: `/og/${b.slug}.png`,
    body: boardBody(b),
    /* A ranking nobody has paid into has no ranking to put beside the form, so
       the wide layout gives the form the width instead of standing it in a
       column next to nothing. */
    shell: b.s.empty ? 'shell--board shell--board-empty' : 'shell--board' }));
}
console.log(`  ${boards.length} ranking pages`);

/* Stripe sends a payer back to whichever address the Payment Link was set to,
   and that link is not ours to change. Every candidate address serves the same
   app, which reads the query string and works out what to say. */
const receipt = page({
  title: 'Your payment | TopTen.one',
  description: 'What your payment did to the ranking.',
  path: '/back/', body: `<div class="wash wash--green"></div>
${masthead()}
<section class="hero above"><div id="result" class="skeleton">Reading your payment…</div></section>
${footer()}`,
});
for (const p of ['back/index.html', 'thanks/index.html', 'claim/index.html']) write(p, receipt);
console.log('  back/, thanks/, claim/');

write('find/index.html', page({
  title: `All ${registry.boards.length} rankings | TopTen.one`,
  description: `Every ranking on TopTen.one: ${live.length} with money in them, ${openBoards.length} still open.`,
  path: '/find/', shell: 'shell--find', body: `<div class="wash wash--cyan"></div>
${masthead({ back: true })}
<section class="hero above" style="padding-top:40px">
  ${swissLine}
  <h1 class="page-title">FIND ANYONE<br>OR ANYTHING.</h1>
  <div class="search-wrap">${ICON.search.replace('width="20" height="20"', 'width="18" height="18"')}
    <input class="search" id="q" type="search" placeholder="Messi, Bitcoin, a city, a brand" aria-label="Search" autocomplete="off">
  </div>
  <div id="q-out"></div>
</section>

<section class="sect">
  <h2 class="eyebrow">Where the money is</h2>
  <div class="stack">${groups.map((g) => `<div class="glass row" style="border-radius:16px" id="${esc(g.id)}">
    <div class="row__main"><div class="row__name">${esc(g.name)}</div>
      <div class="row__sub num">${g.listed} listed &middot; ${g.top ? esc(g.top.handle) + ' ' + esc(money(g.top.total_cents)) + ' on ' + esc(g.top.boardName) : ''}</div></div>
    <div class="row__amt num">${esc(money(g.cents))}</div></div>`).join('')}</div>
  <p class="fine num">${groups.length} groups, ${numbers.listed} listings, ${esc(money(numbers.backed_cents))}.
    Every ranking on the site is in one of them.</p>
</section>

<section class="sect">
  <h2 class="eyebrow">Every ranking</h2>
  <div class="pills">${boards.map((b) => `<a class="pill" href="/${esc(b.slug)}/">${esc(b.name)}${
    b.rows.length ? '' : ' <span style="color:var(--gold)">·</span>'}</a>`).join('')}</div>
  <p class="fine">A gold dot marks a ranking nobody has paid into yet. There ${openBoards.length === 1 ? 'is' : 'are'}
    ${openBoards.length} of them, and the first ${esc(money(costToOpen()))} takes the top of any one.</p>
</section>

${footer()}` }));
console.log('  find/');

/* ------------------------------------------------------------- the rest --- */

/* The owner's page. Not in the sitemap, not linked from anywhere, and empty
   until somebody signs in with the one Google account listed in admin_emails. */
write('dashboard.html', `<!doctype html>
<html lang="en">
<head>
${head({ title: 'Growth | TopTen.one', description: 'For whoever runs the site.', path: '/dashboard.html' })}
<meta name="robots" content="noindex, nofollow">
</head>
<body>
<main class="shell">
<div class="wash wash--cyan"></div>
${masthead({ back: true })}
<section class="hero above" style="padding-top:40px">
  <h1 class="page-title">GROWTH</h1>
  <div id="gate" style="margin-top:20px"></div>
</section>
<div id="out"></div>
${footer()}
</main>
<script src="/config.js?v=${V.cfg}"></script>
<script src="/dashboard.js?v=${V.dash}"></script>
</body>
</html>
`);
console.log('  dashboard.html');

/* The three pages that say what a payment actually is.
 *
 * They were written for this business model in August, checked then, and were
 * left describing King of the Hill by the pivot -- so what comes back is the
 * August wording, changed only where the thing it describes has changed: there
 * are 72 rankings rather than 34, the whole ranking is shown rather than a top
 * ten with a waiting list under it, nothing draws an avatar any more, and the
 * price of #1 is now stated in the terms because the site states it everywhere
 * else.
 */
const legalPage = (title, body) => page({
  title: `${title} | TopTen.one`,
  description: `${title} — TopTen.one.`,
  path: `/${title.toLowerCase()}.html`,
  /* Prose keeps a reading measure however wide the window is: a paragraph
     stretched to 1120px is a paragraph nobody finishes a line of. */
  shell: 'shell--read',
  body: `<div class="wash wash--violet"></div>
${masthead({ back: true })}
<section class="hero above" style="padding-top:40px">
  ${swissLine}
  <h1 class="page-title">${esc(title.toUpperCase())}</h1>
</section>
<div class="prose">${body}</div>
${footer()}`,
});

write('about.html', legalPage('About', `

<p>Everything online is ranked by something nobody will explain: an algorithm, a follower
count, a paid partnership that does not admit to being one. TopTen.one does the opposite.
${registry.boards.length} rankings, and the only thing that moves you up is <b>money</b>.
Creators and the platforms they are on, crypto, football, fighters, artists, billionaires,
politics, cars, cities, pets.</p>

<h2>How it works</h2>
<p>Pick a ranking, say what you are listing &mdash; a profile, a coin, a club, a city, a dog
&mdash; and pay. Your listing appears at whatever position the money buys, immediately.
There is <b>no review, no waiting and no account to create</b>.</p>
<p>Payments are <b>cumulative</b>. A listing's position is the total ever paid towards it, so
${money(2000)} today and ${money(3000)} next week is a ${money(5000)} listing. Anyone can add money to any
listing &mdash; including someone else's, if they want to push a friend up.</p>
<p>The whole ranking is shown, not a top ten with everybody else hidden underneath. Beside
every listing is the figure that would take it past the one above.</p>

<h2>What #1 costs</h2>
<p>If two listings hold the same total, the one that <b>reached it first</b> stays above. So
taking a position costs a cent more than matching it &mdash; never the same, and never less.
The minimum payment is ${money(MIN_CENTS)}, so where that cent-perfect figure is smaller, the
minimum is what it actually costs. On most rankings here, the smallest payment the site takes
is also the one that wins.</p>

<h2>Listings expire</h2>
<p>Thirty days after its last payment a listing drops off. Its total is kept, so a single new
payment brings it back exactly where the money says it belongs. <b>Nobody owns a position
forever.</b></p>

<h2>Why it is honest</h2>
<p>Paid placement is everywhere; almost nowhere is it labelled. Here it is the whole
mechanism, printed next to every name. Nothing on this site is ranked by anything other than
what people paid, and no figure on it is invented &mdash; where the honest number is zero, the
page says so.</p>
<p>Questions: <!--email_off--><a href="mailto:${esc(cfg.mail)}">${esc(cfg.mail)}</a><!--email_on-->.</p>
`));

write('terms.html', legalPage('Terms', `
<p class="stamp">Last updated 6 September 2026.</p>
<p>TopTen.one is a set of public rankings. You pay to put something on one, and the money you
pay decides where it sits. By submitting a listing or paying towards one, you accept these
terms.</p>

<h2>Position is money, and nothing else</h2>
<p>Every ranking orders listings by <b>the total amount paid towards that listing</b>, highest
first. There is no algorithm, no editorial judgement, no quality score and no way to earn a
position without paying for it. If two listings hold the same total, <b>the one that reached
it first ranks higher</b> &mdash; so overtaking costs a cent more than matching, or
${money(MIN_CENTS)}, whichever is larger.</p>
<p>Anyone can add money to any listing at any time, including a listing they did not create.
Money added to a listing <b>belongs to that listing</b>. It cannot be moved, split, reassigned
or withdrawn.</p>

<h2>Payments are final</h2>
<p><b>There are no refunds, under any circumstances.</b> That includes being overtaken a
minute later, changing your mind, paying towards the wrong listing, a listing expiring, or a
listing being hidden for breaking the rules below. Payment buys a position on a public ranking
at the moment of payment and nothing more.</p>
<p>Payments are processed by <b>Stripe</b>; we never see or store your card details. The
minimum payment is <b>${money(MIN_CENTS)}</b>. Amounts are charged in US dollars.</p>

<h2>Listings expire after 30 days</h2>
<p>A listing stays on its ranking for <b>30 days from its most recent payment</b>. After that
it becomes inactive and stops appearing publicly. Its historical total is kept, and any new
payment reactivates it with that full total intact. We do not send reminders before a listing
expires.</p>

<h2>What we will hide</h2>
<p>We may hide any listing, <b>at any time, without notice and without a refund</b>, if in our
judgement it is illegal, hateful, adult or sexual, spam, deceptive, or impersonates a person or
organisation. We may also hide a listing if a platform, a rights holder or a competent
authority requires it. Hiding a listing does not entitle anyone who paid towards it to any
repayment.</p>
<p>Submitting something does not require the consent of the person behind it. If you are the
subject of a listing and want it removed, email
<!--email_off--><a href="mailto:${esc(cfg.mail)}">${esc(cfg.mail)}</a><!--email_on--> and we will take it down. No refund is
owed to whoever paid for it.</p>

<h2>No accounts, no guarantees</h2>
<p>There are no accounts and no logins. A listing can be edited only from the browser that
created it, using a key kept there; paying towards a listing does not grant the right to edit
it, because anybody may pay towards anything.</p>
<p>We do not guarantee visibility, traffic, followers, customers or any outcome whatsoever. A
position on a ranking is a position on a ranking.</p>

<h2>What a payment is not</h2>
<p>A payment here is <b>not an investment</b>, not a security, not a donation, not a
political contribution and not a vote. It buys nothing but a place in a ranking on this site,
and it confers no ownership of anything. Payments towards political listings are not political
contributions and are not made to any party, campaign or candidate. Payments towards crypto
listings buy no coin, token or interest of any kind.</p>
<p>Nothing here is an endorsement by us of anything listed, and a listing does not imply the
subject's involvement or approval.</p>
`));

write('privacy.html', legalPage('Privacy', `
<p class="stamp">Last updated 6 September 2026.</p>
<p>TopTen.one has no accounts and no logins. We collect as little as a public ranking can work
with.</p>

<h2>What we store</h2>
<p>For each listing: the <b>name</b> you submit, an optional link, the running total paid
towards it, and the time of the last payment. All of this is public by design &mdash; it is the
ranking.</p>
<p>For each payment: the Stripe session identifier, the amount and the currency, linked to the
listing it paid for. <b>This is not shown publicly.</b></p>
<p>For each visit: a random identifier kept in your browser, the address you landed on, the
site that sent you, your browser's language and a two-letter country. And, if you press them,
which buttons: a ranking opened, an amount chosen, a payment begun, a share pressed. No text
you type is ever recorded, and none of it is shown publicly.</p>

<h2>What we do not store</h2>
<p>No card numbers, no billing addresses, no email addresses, no passwords, no accounts, no IP
addresses. Payments are processed entirely by <a href="https://stripe.com/privacy"
target="_blank" rel="noopener">Stripe</a>, which acts as its own controller for the payment
data you give it. We receive back only the amount and a session identifier.</p>
<p>We do not ask who you are when you submit a listing, and we cannot tell you who paid
towards one.</p>

<h2>Where the country comes from</h2>
<p>The site sits behind Cloudflare, which tells the page which country the request came from.
That two-letter code is what we keep. Your address is not stored.</p>

<h2>Analytics</h2>
<p>We use Google Analytics 4 to count page views. It sets its own cookies and processes an
abbreviated IP address. See <a href="https://policies.google.com/privacy" target="_blank"
rel="noopener">Google's privacy policy</a>. Browser Do Not Track and content blockers are
respected &mdash; the site works fine without it.</p>

<h2>Removal</h2>
<p>Write to <!--email_off--><a href="mailto:${esc(cfg.mail)}">${esc(cfg.mail)}</a><!--email_on--> and we will take a listing
down. Payment records are kept, because they are an accounting record of money that changed
hands.</p>
`));
console.log('  about.html, terms.html, privacy.html');

write('manifest.json', manifest());
console.log('  manifest.json');

write('404.html', page({
  title: 'Nothing here | TopTen.one',
  description: 'That address does not exist on TopTen.one.',
  path: '/404.html', body: `<div class="wash wash--violet"></div>
${masthead()}
<section class="hero above">
  <h1 class="hero__q">NOTHING<br>HERE.</h1>
  <p class="hero__sub">That address does not exist. The rankings are this way.</p>
  <a class="cta" href="/" style="margin-top:28px">Go to the front page</a>
</section>
${footer()}` }));

/* /badge/ was an embeddable badge a listing could show off with. The feature
   is gone, and the address is the only one from the old site that no longer
   names anything, so it points at the finder rather than dying. A meta refresh
   because GitHub Pages serves files and not redirects. */
write('badge/index.html', `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="refresh" content="0; url=/find/">
<link rel="canonical" href="${SITE}/find/">
<meta name="robots" content="noindex">
<title>Moved | TopTen.one</title>
</head>
<body><p>The badge is gone. <a href="/find/">Every ranking is here.</a></p></body>
</html>
`);

/* Sitemap: the front page, the finder, the legal pages and every ranking.
 *
 * With a date on the ones that have a true one. A crawler asked to look at
 * seventy-seven addresses with nothing to tell them apart re-reads them on its
 * own schedule; one that can see which three moved since its last visit spends
 * its budget there. So lastmod is the day the page's content actually changed:
 * for a ranking, the last payment on it, because that is the only thing that
 * moves a ranking; for the front page and the finder, the last payment
 * anywhere, since both are drawn from all of them.
 *
 * The legal pages get none. Their content changes when somebody edits them and
 * the build does not know that day -- and a lastmod that is really "the day
 * this was rebuilt" is a page crying wolf on every deploy, which is worse than
 * saying nothing. An absent lastmod is a permitted and honest answer.
 */
const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const newest = (rs) => rs.reduce((a, r) => (r.last_paid_at && r.last_paid_at > a ? r.last_paid_at : a), '');

const siteNewest = day(newest(rows));
const urls = [
  { u: '/', at: siteNewest },
  { u: '/find/', at: siteNewest },
  { u: '/about.html' }, { u: '/terms.html' }, { u: '/privacy.html' },
  ...boards.map((b) => ({ u: `/${b.slug}/`, at: day(newest(b.rows)) })),
];
writeFileSync(R('sitemap.xml'),
  '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
  + urls.map(({ u, at }) => `  <url><loc>${SITE}${u}</loc>`
      + (at ? `<lastmod>${at}</lastmod>` : '') + '</url>').join('\n')
  + '\n</urlset>\n');

writeFileSync(R('robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`);
console.log(`  sitemap.xml (${urls.length} addresses), robots.txt`);

console.log('done.');

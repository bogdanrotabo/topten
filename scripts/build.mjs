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
import { topTwo, amounts, row, battle, trend, openOne, move, CROWN } from '../render.js';

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

console.log(`  ${rows.length} listings across ${live.length} rankings, `
  + `${openBoards.length} still open, ${battles.length} races with a challenger`);

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
<link rel="stylesheet" href="/styles.css">
<link rel="icon" href="/icons/icon-192.png" sizes="192x192">
<link rel="apple-touch-icon" href="/icons/icon-192.png">
<link rel="manifest" href="/manifest.json">
<meta name="theme-color" content="#070A14">
<meta property="og:type" content="website">
<meta property="og:site_name" content="TopTen.one">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${SITE}${path}">
<meta property="og:image" content="${SITE}${image || '/og-image.png'}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${SITE}${image || '/og-image.png'}">`;
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
    <a href="/privacy.html">Privacy</a><a href="mailto:${esc(cfg.mail)}">Contact</a>
  </nav>
  <p class="foot__legal">Payments are final and buy a position on a public ranking. Not an investment,
  not a vote, not an endorsement. Minimum payment ${esc(money(MIN_CENTS))}.</p>
</footer>`;
}

function page({ title, description, path, image, body, cls = '' }) {
  return `<!doctype html>
<html lang="en">
<head>
${head({ title, description, path, image })}
</head>
<body${cls ? ` class="${cls}"` : ''}>
<main class="shell">
${body}
</main>
<script src="/config.js"></script>
<script type="module" src="/app.js"></script>
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

<section class="hero above">
  <h1 class="hero__q">WHO SHOULD<br>BE <em>#1</em>?</h1>
  <p class="hero__sub">Pick a side. Move the ranking.</p>
  ${swissLine}
  <a class="cta" href="${leadBoard ? '/' + esc(leadBoard.slug) + '/' : '/find/'}" style="margin-top:28px">Explore now</a>
  <div class="search-wrap">${ICON.search.replace('width="20" height="20"', 'width="17" height="17"')}
    <input class="search" id="q" type="search" placeholder="Find anyone or anything" aria-label="Find anyone or anything" autocomplete="off">
  </div>
  <div id="q-out"></div>
</section>

<section class="sect" id="happening">
  <div class="sect__head"><h2 class="eyebrow">Happening now</h2>
    <span class="sect__note">Most recent payments</span></div>
  <div class="glass moves">${recent.map((m, i) => (i ? '<hr class="hr" style="margin:16px 0">' : '') + move(m)).join('')}</div>
</section>

<section class="sect" id="battles">
  <div class="sect__head"><h2 class="eyebrow">Closest battles</h2>
    <a class="sect__link" href="/find/">See all</a></div>
  ${lead ? `<div style="margin-top:16px">${topTwo(leadBoard.s)}
    <div style="margin-top:14px"><a class="cta" href="/${esc(lead.slug)}/">Back ${esc(lead.two.handle)}</a>
    ${amounts(leadBoard.s, leadBoard.name)}</div></div>` : ''}
  <div style="margin-top:14px">${battles.slice(1, 4).map(battle).join('')}</div>
  <p class="fine">The gap plus one cent, or ${esc(money(MIN_CENTS))} &mdash; whichever is larger. A tie stays below.</p>
</section>

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

<section class="sect" id="groups">
  <h2 class="eyebrow">What are you into</h2>
  <div class="grid2">${groups.map((g) => `<a class="glass tile" href="/find/#${esc(g.id)}">
    <div class="tile__name">${esc(g.name)}</div>
    <div class="tile__sub num">${g.listed} &middot; ${esc(money(g.cents))}</div></a>`).join('')}</div>
  <a class="ghost" href="/find/" style="margin-top:12px">Browse all ${registry.boards.length} rankings</a>
</section>

<section class="sect" id="numbers">
  <div class="glass" style="padding:22px 18px;border-radius:16px">
    <div class="figures">
      <div class="figure"><div class="figure__v figure__v--cyan num">${n.visitors.toLocaleString('en-US')}</div><div class="figure__k">visitors</div></div>
      <div class="figure"><div class="figure__v figure__v--cyan num">${n.countries}</div><div class="figure__k">countries</div></div>
      <div class="figure"><div class="figure__v num">${n.listed}</div><div class="figure__k">listed</div></div>
      <div class="figure figure--wide"><div class="figure__v num">${esc(money(n.backed_cents))}</div><div class="figure__k">backed</div></div>
    </div>
    <p class="fine" style="margin-top:14px">Visitors from ${n.countries} countries, counted since 25 August and
      including 147 measured by Google Analytics in the three days before this site kept its own record.
      ${n.payments} payments, nothing rounded.</p>
  </div>
</section>

${footer()}`;
}

/* ------------------------------------------------------------- a ranking -- */

function boardBody(b) {
  const s = b.s;
  const rest = s.list.slice(2);
  return `<div class="wash wash--gold"></div>
${masthead({ back: true, share: true })}

<section class="hero above" style="padding-top:40px">
  <div class="eyebrow">${esc(b.groupName)}</div>
  <h1 class="page-title">${question(b.q)}</h1>
  <p class="fine num" style="margin-top:14px">${b.rows.length} listed &middot;
    ${esc(money(b.rows.reduce((n, r) => n + r.total_cents, 0)))} backed</p>
</section>

<section class="sect" id="top" style="margin-top:26px">${topTwo(s)}</section>

<section class="sect" id="back" style="margin-top:18px">
  ${(() => {
    const t = s.two || s.one || null;
    const href = t ? payTo(t.id) : null;
    return `<a class="cta" id="pay"${href ? ` href="${esc(href)}"` : ' aria-disabled="true"'}>`
      + (t ? 'Back ' + esc(t.handle) : 'Nothing listed yet') + '</a>';
  })()}
  ${amounts(s, b.name)}
</section>

${rest.length ? `<section class="sect" id="rest">
  <h2 class="eyebrow" style="padding-bottom:14px">Full ranking</h2>
  <div class="glass" style="overflow:hidden">${rest.map((r, i) =>
    (i ? '<hr class="hr">' : '') + row(r, i + 3)).join('')}</div>
</section>` : ''}

<section class="sect" id="add">
  <details class="add">
    <summary class="ghost">Add something that is missing</summary>
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

<section class="sect" id="spread">
  <h2 class="eyebrow">Bring someone in</h2>
  <p class="lede">A ranking only moves when the other side hears about it.</p>
  <div style="display:flex;gap:10px;margin-top:16px">
    <button type="button" class="ghost" id="copy"><span style="color:var(--cyan)">${ICON.link}</span>Copy link</button>
    <button type="button" class="ghost" id="share2"><span style="color:var(--cyan)">${ICON.share}</span>Share</button>
  </div>
</section>

<section class="sect">
  <h2 class="eyebrow">How this works</h2>
  <p class="lede">Position is decided by the total paid towards a listing, and nothing else. Payments add up
    and cannot be moved, split or withdrawn. If two listings hold the same total, the one that reached it
    first stays above &mdash; so taking #1 costs a cent more than matching it, or ${esc(money(MIN_CENTS))},
    whichever is larger. A listing drops off 30 days after its last payment and keeps its total if it
    comes back.</p>
</section>

${footer()}`;
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
  path: '/', body: homeBody(),
}));
console.log('  index.html');

for (const b of boards) {
  const { t, d } = seo(b);
  write(`${b.slug}/index.html`, page({ title: t, description: d, path: `/${b.slug}/`, body: boardBody(b) }));
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
  path: '/find/', body: `<div class="wash wash--cyan"></div>
${masthead({ back: true })}
<section class="hero above" style="padding-top:40px">
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
<script src="/config.js"></script>
<script src="/dashboard.js"></script>
</body>
</html>
`);
console.log('  dashboard.html');

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

/* Sitemap: the front page, the finder, the legal pages and every ranking. */
const urls = ['/', '/find/', '/about.html', '/terms.html', '/privacy.html']
  .concat(boards.map((b) => `/${b.slug}/`));
writeFileSync(R('sitemap.xml'),
  '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
  + urls.map((u) => `  <url><loc>${SITE}${u}</loc></url>`).join('\n') + '\n</urlset>\n');

writeFileSync(R('robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`);
console.log(`  sitemap.xml (${urls.length} addresses), robots.txt`);

console.log('done.');

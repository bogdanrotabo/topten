#!/usr/bin/env node
/**
 * The king, written into the page before anybody asks for it.
 *
 * index.html is drawn by app.js after it has talked to Supabase. A person
 * never notices; a crawler is handed a document whose <main> says "the throne
 * is empty" no matter who is on it, and a link posted to X previews as a
 * generic card with no name and no figure on it. For a site that is one page
 * about one person, that is the whole of its search and social presence
 * missing.
 *
 * So the king is written in here, at build time, from the same views the site
 * reads at run time. Four places, each between a pair of markers so a second
 * run replaces its own work rather than stacking a copy under it:
 *
 *   <!-- king -->     the card: name, message, link, amount, how long.
 *   <!-- cta -->      the figure somebody has to beat, and the button.
 *   <!-- history -->  the former kings, fifty of them.
 *   <!-- og -->       title, description and the social card.
 *
 * app.js replaces the first three within a second of load, with the same rows
 * and live figures, so nobody is shown one thing and told another — it is the
 * same content arriving twice. The figures go stale between deploys by design:
 * a number that was true when the site was built is a fair thing to publish,
 * and the browser corrects it immediately.
 *
 *   node scripts/prerender.mjs            writes the king into the page
 *   node scripts/prerender.mjs --check    fails if the page has no king in it
 *   node scripts/prerender.mjs --dry-run  says what it would write
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = join(root, 'index.html');

const verifica = process.argv.includes('--check');
const uscat = process.argv.includes('--dry-run');

/* --------------------------------------------------------------- markers */

const M = (nume) => [`<!-- ${nume} -->`, `<!-- /${nume} -->`];
const [KING_A, KING_Z] = M('king');
const [CTA_A, CTA_Z] = M('cta');
const [HIST_A, HIST_Z] = M('history');
const [OG_A, OG_Z] = M('og');

function pune(html, [a, z], continut) {
  const i = html.indexOf(a);
  if (i < 0) throw new Error(`the page has no ${a} marker`);
  const j = html.indexOf(z, i);
  if (j < 0) throw new Error(`opening ${a} with no ${z}`);
  return html.slice(0, i) + a + continut + z + html.slice(j + z.length);
}

const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/* -------------------------------------------------------------- the money */

/* The same list app.js carries, and for the same reason: a currency Stripe
   reports without a minor unit must not be divided by a hundred. */
const ZERO_DECIMAL = new Set(['bif', 'clp', 'djf', 'gnf', 'jpy', 'kmf', 'krw',
  'mga', 'pyg', 'rwf', 'ugx', 'vnd', 'vuv', 'xaf', 'xof', 'xpf']);

function bani(cents, currency) {
  const cur = String(currency || 'usd').toLowerCase();
  const v = ZERO_DECIMAL.has(cur) ? Number(cents) : Number(cents) / 100;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency', currency: cur.toUpperCase(),
      minimumFractionDigits: 0, maximumFractionDigits: 2,
    }).format(v);
  } catch {
    return `${v} ${cur.toUpperCase()}`;
  }
}

function durata(secunde) {
  const s = Math.max(0, Math.floor(secunde));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  /* A zero component is dropped rather than printed: "1d 0h" is a worse way
     of saying a day. Same rule as app.js, which redraws this a second later. */
  if (d) return h ? `${d}d ${h}h` : `${d}d`;
  if (h) return m ? `${h}h ${m}m` : `${h}h`;
  if (m) return `${m}m`;
  return 'just now';
}

/* The word for a king who gave Stripe no name. Chosen here and in app.js and
   nowhere in the database, so a payer who fills their card in later is not
   overwriting something that looks like it was typed. */
const nume = r => (r && r.name) ? r.name : 'Anonymous';

/* -------------------------------------------------------------- the reads */

function config() {
  const cfg = readFileSync(join(root, 'config.js'), 'utf8');
  const camp = k => (new RegExp(`${k}:\\s*"([^"]*)"`).exec(cfg) || [])[1] || '';
  const url = camp('SUPABASE_URL'), key = camp('SUPABASE_ANON_KEY');
  if (!url || !key) throw new Error('config.js has no Supabase url or key');
  return { url, key, link: camp('STRIPE_PAYMENT_LINK') };
}

async function citeste({ url, key }, view, query) {
  const r = await fetch(`${url}/rest/v1/${view}?${query}`,
    { headers: { apikey: key, authorization: `Bearer ${key}` } });
  if (!r.ok) throw new Error(`${view}: HTTP ${r.status}`);
  return r.json();
}

/* --------------------------------------------------------------- the html */

const CROWN = '<svg class="king__crown" viewBox="0 0 38 28" aria-hidden="true">'
  + '<path fill="currentColor" d="M2 8l7 6 10-12 10 12 7-6-4 18H6z"/></svg>';

function cardul(k) {
  if (!k) {
    return `\n    <section class="king king--empty" id="king-card">
      ${CROWN}
      <span class="king__kicker">The throne is empty</span>
      <p class="king__name">Nobody</p>
      <p class="king__message">Nobody has taken this page yet. The first payment does it.</p>
    </section>\n    `;
  }
  const link = k.url
    ? `\n      <a class="king__link" href="${esc(k.url)}" target="_blank" rel="noopener nofollow ugc">`
      + `${esc(String(k.url).replace(/^https?:\/\//, '').replace(/\/$/, ''))}</a>`
    : '';
  const de = durata((Date.now() - new Date(k.crowned_at).getTime()) / 1000);
  return `\n    <section class="king" id="king-card">
      ${CROWN}
      <span class="king__kicker">Current king</span>
      <h1 class="king__name">${esc(nume(k))}</h1>${
        k.message ? `\n      <p class="king__message">${esc(k.message)}</p>` : ''}${link}
      <div class="king__figures">
        <span class="figure"><span class="figure__v figure__v--gold">${esc(bani(k.amount_cents, k.currency))}</span><span class="figure__k">Paid</span></span>
        <span class="figure"><span class="figure__v" id="reign-clock">${esc(de)}</span><span class="figure__k">Reigning for</span></span>
      </div>
    </section>\n    `;
}

function chemarea(k, link) {
  const text = k
    ? `Pay more than <b>${esc(bani(k.amount_cents, k.currency))}</b> to take the page. `
      + 'Pay less and you only get listed as an attempt. No refunds.'
    : 'Any payment takes the page while nobody holds it. Pay less than the king and you only '
      + 'get listed as an attempt. No refunds.';
  const eticheta = k ? 'Dethrone them' : 'Take the page';
  /* The href is written in rather than left to app.js, so the button works on
     a page whose JavaScript never arrives. */
  return `\n      <p class="cta__terms" id="cta-terms">${text}</p>
      <a class="btn" id="dethrone" href="${esc(link || '#')}">${eticheta}</a>\n      `;
}

function istoria(randuri) {
  if (!randuri.length) {
    return '\n      <div id="history"><p class="empty">Nobody has been dethroned yet.</p></div>\n      ';
  }
  const li = randuri.map(r => `        <li class="row"><span class="row__n">${esc(nume(r))}</span>`
    + `<span class="row__a">${esc(bani(r.amount_cents, r.currency))}</span>`
    + `<span class="row__t">${esc(durata(r.reigned_seconds))}</span></li>`).join('\n');
  return `\n      <div id="history">
        <ul class="rows">
${li}
        </ul>
      </div>\n      `;
}

/* The social card and the title. "Current king: {name} — {amount}" is what a
   search result and a shared link both say, which is the only sentence about
   this site that has to change every time somebody pays. */
function capul(k) {
  const titlu = k
    ? `Current king: ${nume(k)} — ${bani(k.amount_cents, k.currency)}`
    : 'TopTen.one — one page, one king';
  const descriere = (k && k.message)
    ? k.message
    : "One page. One king. Pay more than them and it's yours.";
  return `\n<meta property="og:type" content="website">
<meta property="og:site_name" content="TopTen.one">
<meta property="og:title" content="${esc(titlu)}">
<meta property="og:description" content="${esc(descriere)}">
<meta property="og:image" content="https://topten.one/og-image.png?v=3">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:url" content="https://topten.one/">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(titlu)}">
<meta name="twitter:description" content="${esc(descriere)}">
<meta name="twitter:image" content="https://topten.one/og-image.png?v=3">\n`;
}

function cap(html, k) {
  const titlu = k
    ? `Current king: ${nume(k)} — ${bani(k.amount_cents, k.currency)} — TopTen.one`
    : 'TopTen.one — one page, one king';
  const descriere = (k && k.message)
    ? `${nume(k)} holds topten.one for ${bani(k.amount_cents, k.currency)}. “${k.message}” `
      + 'Pay more than them and the page is yours.'
    : 'One page. One king. Whoever has paid the most holds it, and whoever pays more takes it. '
      + 'No accounts, no algorithm, no refunds.';
  return html
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(titlu)}</title>`)
    .replace(/<meta name="description" content="[^"]*">/,
             `<meta name="description" content="${esc(descriere.slice(0, 300))}">`);
}

/* ------------------------------------------------------------------- main */

if (verifica) {
  const html = readFileSync(PAGE, 'utf8');
  const lipsa = [[KING_A, 'king'], [CTA_A, 'cta'], [HIST_A, 'history'], [OG_A, 'og']]
    .filter(([m]) => !html.includes(m)).map(([, n]) => n);
  if (lipsa.length) {
    console.error(`prerender: index.html has no ${lipsa.join(', ')} marker`);
    process.exit(1);
  }
  const rege = /<h1 class="king__name">/.test(html);
  console.log(`prerender: markers in place; the page carries ${rege ? 'a king' : 'an empty throne'}.`);
  process.exit(0);
}

const cfg = config();

let rege = null, fosti = [];
try {
  const [k, f] = await Promise.all([
    citeste(cfg, 'king', 'select=id,amount_cents,currency,name,url,message,crowned_at&limit=1'),
    citeste(cfg, 'former_kings',
      'select=amount_cents,currency,name,reigned_seconds&order=dethroned_at.desc&limit=50'),
  ]);
  rege = k[0] || null;
  fosti = f || [];
} catch (e) {
  /* A build must not depend on a database being up. The page keeps whatever
     was written into it last time, which is a king who may since have been
     dethroned and is still a page with somebody on it. */
  console.error(`prerender: ${e.message} — the page keeps the king it already has`);
  process.exit(0);
}

const inainte = readFileSync(PAGE, 'utf8');
let html = inainte;
html = pune(html, [KING_A, KING_Z], cardul(rege));
html = pune(html, [CTA_A, CTA_Z], chemarea(rege, cfg.link));
html = pune(html, [HIST_A, HIST_Z], istoria(fosti));
html = pune(html, [OG_A, OG_Z], capul(rege));
html = cap(html, rege);

if (html !== inainte && !uscat) writeFileSync(PAGE, html);

console.log(`prerender: ${html === inainte ? 'no change' : (uscat ? 'would write' : 'wrote')}`
  + ` — ${rege ? `${nume(rege)} at ${bani(rege.amount_cents, rege.currency)}` : 'an empty throne'}`
  + `, ${fosti.length} former king${fosti.length === 1 ? '' : 's'}.`);

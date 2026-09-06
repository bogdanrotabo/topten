/* TopTen.one in the browser.
 *
 * The pages arrive with their rankings already written in, so this is not what
 * makes the site work -- it is what keeps it current, and what turns a reader
 * into a payer. It re-reads the same views the build read, redraws the same
 * regions with the same functions from render.js, and wires the one button
 * that leads to Stripe.
 *
 * Nothing here decides an amount or a position. The figure comes from Stripe,
 * the webhook writes it, and the database ranks it. This file can be wrong
 * about what it draws; it cannot be wrong about anybody's money.
 */

import { esc, money, situation, costToOpen, MIN_CENTS } from './lib.js';
import { topTwo, amounts, row, battle, trend, openOne, move } from './render.js';

const CFG = window.TOPTEN_CONFIG || {};
const $ = (s, el) => (el || document).querySelector(s);
const $$ = (s, el) => Array.prototype.slice.call((el || document).querySelectorAll(s));

/* ------------------------------------------------------------ the reads --- */

async function rest(path, init) {
  const res = await fetch(`${CFG.SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: CFG.SUPABASE_ANON_KEY, Authorization: `Bearer ${CFG.SUPABASE_ANON_KEY}`,
               'Content-Type': 'application/json', ...(init && init.headers) },
  });
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  return res.json();
}
const rpc = (name, args) => rest(`rpc/${name}`, { method: 'POST', body: JSON.stringify(args || {}) });

let REGISTRY = null;
async function registry() {
  if (!REGISTRY) REGISTRY = await fetch('/boards.json').then((r) => r.json());
  return REGISTRY;
}

/* ---------------------------------------------------------- who is here --- */

function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (crypto.getRandomValues(new Uint8Array(1))[0] % 16);
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function sessionId() {
  let id = null;
  try { id = localStorage.getItem('topten_sid'); } catch (e) { /* storage denied */ }
  if (!id || !/^[0-9a-f-]{36}$/.test(id)) {
    id = uuid();
    try { localStorage.setItem('topten_sid', id); } catch (e) { /* nothing to do */ }
  }
  return id;
}

/* The address as it arrived, minus anything that is a credential rather than a
   campaign. utm_* and the ad-click markers are the point of keeping the query
   string at all; a token in it is not analytics, it is a key. */
const SECRET_PARAM = /^(token|edit|edit_token|session_id|claim_ref|ref)$/i;
function safePath() {
  const u = new URL(location.href);
  const keep = new URLSearchParams();
  u.searchParams.forEach((v, k) => { if (!SECRET_PARAM.test(k)) keep.set(k, v); });
  const q = keep.toString();
  return (u.pathname + (q ? '?' + q : '')).slice(0, 300);
}

/* Cloudflare sits in front of this domain and will say which country a request
   came from. Nothing else here knows, and no address is stored. */
let CC = null;
async function country() {
  if (CC !== null) return CC;
  try { const s = sessionStorage.getItem('topten:cc'); if (s !== null) { CC = s; return CC; } } catch (e) {}
  try {
    const res = await fetch('/cdn-cgi/trace', { cache: 'no-store' });
    const m = /(?:^|\n)loc=([A-Z]{2})/.exec(res.ok ? await res.text() : '');
    CC = m ? m[1] : '';
  } catch (e) { CC = ''; }
  try { sessionStorage.setItem('topten:cc', CC); } catch (e) {}
  return CC;
}

async function recordVisit() {
  try {
    await rest('site_visits', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        session_id: sessionId(),
        path: safePath(),
        referrer: String(document.referrer || '').slice(0, 300) || null,
        language: String(navigator.language || '').slice(0, 12) || null,
        country: (await country()) || null,
      }),
    });
  } catch (e) { /* a visit that cannot be counted must never stop the page */ }
}

/* ---------------------------------------------------------- the payment --- */

/**
 * Where the Back button goes.
 *
 * client_reference_id carries the listing being backed and the visit that sent
 * the payer, joined by an underscore because Stripe allows letters, digits,
 * dashes and underscores and nothing else. The webhook splits it: the first
 * half decides which total moves, the second says which campaign to credit.
 */
function payHref(listingId) {
  const base = CFG.STRIPE_PAYMENT_LINK;
  if (!base || !listingId) return null;
  const u = new URL(base);
  u.searchParams.set('client_reference_id', `${listingId}_${sessionId()}`);
  return u.toString();
}

/* -------------------------------------------------------------- a board --- */

function slugFromPath() {
  const m = location.pathname.match(/^\/([a-z0-9][a-z0-9.-]*)\/?$/i);
  return m ? m[1] : null;
}

async function drawBoard(slug) {
  const reg = await registry();
  const board = reg.boards.find((b) => b.slug === slug);
  if (!board) return;

  const rows = await rest('board?select=id,platform,handle,tagline,link,total_cents,last_paid_at,rank'
    + `&platform=eq.${encodeURIComponent(slug)}&order=rank.asc&limit=200`);
  const s = situation(rows);

  const top = $('#top');
  if (top) top.innerHTML = topTwo(s);

  /* Who the button pays for. The challenger by default, because that is the
     move the page is inviting; any row can take its place. */
  let target = s.two || s.one || null;

  const back = $('#back');
  function drawBack() {
    if (!back) return;
    const alone = !s.two;
    const price = s.empty ? costToOpen() : (alone ? MIN_CENTS : s.price);
    const href = target ? payHref(target.id) : null;
    back.innerHTML =
      `<a class="cta" id="pay"${href ? ` href="${esc(href)}"` : ' aria-disabled="true"'}>`
      + (target ? 'Back ' + esc(target.handle) : 'Nothing listed yet') + '</a>'
      + amounts(target && s.one && target.id !== s.one.id
          ? s : { ...s, two: target && s.one && target.id === s.one.id ? null : s.two }, board.name);
    if (target && s.one && target.id !== s.one.id && target.id !== (s.two && s.two.id)) {
      /* Backing somebody further down: say what that costs from where they are. */
      const need = Math.max(MIN_CENTS, s.one.total_cents - target.total_cents + 1);
      const note = $('.note div', back);
      if (note) note.innerHTML = 'You type the amount on the payment page. '
        + `<span class="num">${esc(money(need))}</span> would put ${esc(target.handle)} at `
        + `<span class="num">${esc(money(target.total_cents + need))}</span>, past `
        + `${esc(s.one.handle)}.`;
    }
    void price;
  }
  drawBack();

  const rest_ = s.list.slice(2);
  const restEl = $('#rest .glass');
  if (restEl) restEl.innerHTML = rest_.map((r, i) => (i ? '<hr class="hr">' : '') + row(r, i + 3)).join('');

  /* Any row can become the one being backed. */
  $$('#rest .row, #top .top__one, #top .top__two').forEach((el, i) => {
    el.style.cursor = 'pointer';
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    const pick = () => {
      const name = ($('.row__name', el) || $('.top__name', el) || {}).textContent;
      const found = s.list.find((r) => r.handle === name);
      if (found) { target = found; drawBack(); $('#back').scrollIntoView({ block: 'nearest' }); }
    };
    el.addEventListener('click', pick);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
    void i;
  });
}

/* --------------------------------------------------------------- search --- */

async function wireSearch() {
  const input = $('#q');
  const out = $('#q-out');
  if (!input || !out) return;
  const reg = await registry();
  let rows = null;

  async function run() {
    const q = input.value.trim().toLowerCase();
    if (q.length < 2) { out.innerHTML = ''; return; }
    if (!rows) {
      rows = await rest('board?select=platform,handle,total_cents,rank&order=total_cents.desc&limit=2000');
    }
    const listings = rows.filter((r) => r.handle.toLowerCase().includes(q)).slice(0, 6);
    const boards = reg.boards.filter((b) => b.name.toLowerCase().includes(q)).slice(0, 4);

    if (!listings.length && !boards.length) {
      out.innerHTML = `<p class="empty">Nothing called &ldquo;${esc(input.value.trim())}&rdquo; yet.`
        + ` Any ranking will take it for ${esc(money(costToOpen()))}.</p>`;
      return;
    }
    const name = (slug) => (reg.boards.find((b) => b.slug === slug) || {}).name || slug;
    out.innerHTML = '<div class="glass results">'
      + listings.map((r) => `<a class="result" href="/${esc(r.platform)}/">`
          + `<div class="row__main"><div class="row__name">${esc(r.handle)}</div>`
          + `<div class="row__sub num">#${r.rank} on ${esc(name(r.platform))}</div></div>`
          + `<div class="row__amt num">${esc(money(r.total_cents))}</div></a>`).join('')
      + boards.map((b) => `<a class="result" href="/${esc(b.slug)}/">`
          + `<div class="row__main"><div class="row__name">${esc(b.name)}</div>`
          + `<div class="row__sub">${esc(b.q)}</div></div>`
          + '<span class="take num">Open</span></a>').join('')
      + '</div>';
  }

  let t = null;
  input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(run, 140); });
}

/* --------------------------------------------------------------- the home -- */

async function drawHome() {
  const reg = await registry();
  const bySlug = new Map(reg.boards.map((b) => [b.slug, b]));
  const [rows, market, numbers] = await Promise.all([
    rest('board?select=id,platform,handle,tagline,link,total_cents,last_paid_at,rank'
      + '&order=platform.asc,rank.asc&limit=2000'),
    rpc('market'),
    rpc('site_numbers'),
  ]);

  const boards = reg.boards.map((b) => {
    const mine = rows.filter((r) => r.platform === b.slug);
    return { ...b, rows: mine, s: situation(mine) };
  });

  const battles = boards.filter((b) => b.s.two)
    .map((b) => ({ slug: b.slug, boardName: b.name, one: b.s.one, two: b.s.two, price: b.s.price }))
    .sort((a, b) => a.price - b.price || b.one.total_cents - a.one.total_cents);

  const lead = battles[0];
  const leadBoard = lead ? boards.find((b) => b.slug === lead.slug) : null;
  if (leadBoard) {
    const el = $('#battles');
    const holder = el && el.children[1];
    if (holder) holder.innerHTML = topTwo(leadBoard.s)
      + `<div style="margin-top:14px"><a class="cta" href="/${esc(lead.slug)}/">Back ${esc(lead.two.handle)}</a>`
      + amounts(leadBoard.s, leadBoard.name) + '</div>';
    const list = el && el.children[2];
    if (list) list.innerHTML = battles.slice(1, 4).map(battle).join('');
  }

  const trending = market.filter((m) => m.d7_cents > 0 && bySlug.has(m.platform))
    .map((m) => ({ ...m, slug: m.platform, boardName: bySlug.get(m.platform).name }))
    .sort((a, b) => b.d7_cents - a.d7_cents).slice(0, 5);
  const tEl = $('#trending .stack');
  if (tEl) tEl.innerHTML = trending.map((t, i) => trend(t, i + 1)).join('');

  const open = boards.filter((b) => !b.rows.length);
  const oEl = $('#open .stack');
  if (oEl) oEl.innerHTML = open.slice(0, 3).map(openOne).join('');

  const recent = [...rows].filter((r) => r.last_paid_at)
    .sort((a, b) => new Date(b.last_paid_at) - new Date(a.last_paid_at)).slice(0, 3)
    .map((r) => {
      const b = bySlug.get(r.platform);
      const s = boards.find((x) => x.slug === r.platform).s;
      const isOne = s.one && s.one.id === r.id;
      return { when: new Date(r.last_paid_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
        html: `<b>${esc(r.handle)}</b> ${isOne ? 'holds #1 on ' : 'moved on '}`
          + `<a href="/${esc(b.slug)}/">${esc(b.name)}</a> with <span class="num">${esc(money(r.total_cents))}</span>.` };
    });
  const hEl = $('#happening .moves');
  if (hEl) hEl.innerHTML = recent.map((m, i) => (i ? '<hr class="hr" style="margin:16px 0">' : '') + move(m)).join('');

  const nEl = $('#numbers .figures');
  if (nEl) {
    nEl.innerHTML =
      `<div class="figure"><div class="figure__v figure__v--cyan num">${numbers.visitors.toLocaleString('en-US')}</div><div class="figure__k">visitors</div></div>`
      + `<div class="figure"><div class="figure__v figure__v--cyan num">${numbers.countries}</div><div class="figure__k">countries</div></div>`
      + `<div class="figure"><div class="figure__v num">${numbers.listed}</div><div class="figure__k">listed</div></div>`
      + `<div class="figure figure--wide"><div class="figure__v num">${esc(money(numbers.backed_cents))}</div><div class="figure__k">backed</div></div>`;
  }
}

/* ---------------------------------------------------- what the payment did -- */

/* Whichever receipt Stripe hands back. The Payment Link's success URL is not
   ours to change, so all the shapes it might use are read and the first one
   that means anything wins. */
function receipt() {
  const q = new URLSearchParams(location.search);
  const sid = (q.get('session_id') || '').trim();
  const ref = (q.get('client_reference_id') || q.get('ref') || q.get('listing') || '').trim();
  return {
    session_id: /^cs_(test|live)_[A-Za-z0-9]{8,120}$/.test(sid) ? sid : null,
    client_ref: /^[0-9a-fA-F_-]{16,200}$/.test(ref) ? ref : null,
  };
}

async function drawResult() {
  const el = $('#result');
  if (!el) return;
  const r = receipt();

  if (!r.session_id && !r.client_ref) {
    el.className = '';
    el.innerHTML = '<h1 class="hero__q">NO RECEIPT<br>HERE.</h1>'
      + '<p class="hero__sub">This address is where Stripe sends you back after a payment. '
      + 'Nothing came with it.</p>'
      + '<a class="cta" href="/" style="margin-top:28px">Go to the rankings</a>';
    return;
  }

  const reg = await registry();
  const name = (slug) => (reg.boards.find((b) => b.slug === slug) || {}).name || slug;

  /* Getting back from Stripe before the webhook does is ordinary, not an
     error. The page waits, and says it is waiting. */
  const started = Date.now();
  let out = null;
  while (Date.now() - started < 45000) {
    try {
      out = await rpc('payment_result', { p_session_id: r.session_id, p_client_ref: r.client_ref });
    } catch (e) { out = null; }
    if (out && out.outcome !== 'pending') break;
    await new Promise((go) => setTimeout(go, 1800));
  }

  el.className = '';

  /* Once there is a definitive answer the receipt leaves the address bar: a
     link shared from this page must not carry the key to somebody's payment.
     It stays while the answer is still pending, so a reload can still ask. */
  if (out && out.outcome !== 'pending') history.replaceState({}, '', location.pathname);

  if (!out || out.outcome === 'pending') {
    el.innerHTML = '<h1 class="hero__q">STILL<br>SETTLING.</h1>'
      + '<p class="hero__sub">Your payment has not reached us yet. It usually takes seconds. '
      + 'Reload in a minute &mdash; nothing is lost, and the ranking will show it when it lands.</p>'
      + '<a class="ghost" href="/" style="margin-top:24px">Back to the rankings</a>';
    return;
  }

  if (out.outcome === 'orphan') {
    el.innerHTML = '<h1 class="hero__q">PAYMENT<br>RECEIVED.</h1>'
      + `<p class="hero__sub">We have your <span class="num">${esc(money(out.amount_cents, out.currency))}</span>, `
      + 'but not which listing it was for &mdash; so it has been written down rather than credited. '
      + `Write to <a href="mailto:${esc(CFG.CONTACT_EMAIL || '')}">${esc(CFG.CONTACT_EMAIL || 'us')}</a> `
      + 'and it will be put where you meant it.</p>'
      + '<a class="ghost" href="/" style="margin-top:24px">Back to the rankings</a>';
    return;
  }

  /* The three things a payment can do, each read off the ranking before and
     after it landed. Nothing here is asserted: a move is only claimed when the
     two numbers differ. */
  const board = out.platform;
  const took = out.is_leader && (out.rank_before === null || out.rank_before > 1);
  const moved = out.rank_before !== null && out.rank_after < out.rank_before;
  const first = out.rank_before === null;

  let headline, story;
  if (took) {
    headline = `${esc(out.handle).toUpperCase()} IS<br><em>#1</em> IN ${esc(name(board)).toUpperCase()}.`;
    story = `Your <span class="num">${esc(money(out.amount_cents, out.currency))}</span> put it there. `
      + 'The ranking changed the moment your payment cleared.';
  } else if (first) {
    headline = `${esc(out.handle).toUpperCase()}<br>IS ON THE BOARD.`;
    story = `Your <span class="num">${esc(money(out.amount_cents, out.currency))}</span> put `
      + `${esc(out.handle)} at #${out.rank_after} in ${esc(name(board))}.`;
  } else if (moved) {
    headline = `${esc(out.handle).toUpperCase()} MOVED<br>TO <em>#${out.rank_after}</em>.`;
    story = `Your <span class="num">${esc(money(out.amount_cents, out.currency))}</span> took `
      + `${esc(out.handle)} from #${out.rank_before} to #${out.rank_after} in ${esc(name(board))}.`;
  } else {
    headline = `YOU BACKED<br>${esc(out.handle).toUpperCase()}.`;
    story = `<span class="num">${esc(money(out.amount_cents, out.currency))}</span> added, no move yet `
      + `&mdash; ${esc(out.handle)} is at <span class="num">${esc(money(out.total_cents))}</span> and still `
      + `#${out.rank_after}.`;
  }
  if (out.needed_cents) {
    story += ` <span class="num">${esc(money(out.needed_cents))}</span> more takes #1 from `
      + `${esc(out.leader)}.`;
  }

  const crown = '<svg width="18" height="14" viewBox="0 0 38 28" aria-hidden="true">'
    + '<path fill="currentColor" d="M2 8l7 6 10-12 10 12 7-6-4 18H6z"/></svg>';
  const badge = out.rank_after === 1
    ? `<div class="rk rk--1 rk--big">${crown}</div>`
    : `<div class="rk">${out.rank_after}</div>`;
  const under = (moved || took)
    ? `<div class="row__sub" style="color:var(--green)">MOVED ${out.rank_before} &rarr; ${out.rank_after}</div>`
    : `<div class="row__sub">#${out.rank_after} in ${esc(name(board))}</div>`;

  el.innerHTML = [
    '<div class="eyebrow" style="color:var(--green)">Payment confirmed</div>',
    `<h1 class="hero__q" style="margin-top:16px">${headline}</h1>`,
    `<p class="hero__sub">${story}</p>`,
    '<div style="margin-top:30px"><div class="glass" style="overflow:hidden">',
      '<div class="row"><div class="row__main"><div class="eyebrow">Now</div></div>',
      `<div class="row__amt num">${esc(money(out.total_cents, out.currency))}</div></div>`,
      '<hr class="hr">',
      '<div class="row" style="padding:18px">',
        badge,
        `<div class="row__main"><div class="top__name">${esc(out.handle)}</div>${under}</div>`,
      '</div>',
    '</div></div>',
    '<div style="margin-top:22px">',
      '<button type="button" class="cta" id="share2">Tell the other side</button>',
      `<a class="ghost" href="/${esc(board)}/" style="margin-top:10px">Back to ${esc(name(board))}</a>`,
    '</div>',
  ].join('');

  wireShare();
}

/* ------------------------------------------------------------- the share -- */

function wireShare() {
  const title = document.title.replace(' | TopTen.one', '');
  const url = location.origin + location.pathname;
  const go = async () => {
    if (navigator.share) { try { await navigator.share({ title, url }); return; } catch (e) { /* dismissed */ } }
    try { await navigator.clipboard.writeText(url); flash('Link copied.'); } catch (e) { flash('Copy this: ' + url); }
  };
  $$('#share, #share2').forEach((b) => b.addEventListener('click', go));
  const copy = $('#copy');
  if (copy) copy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(url); flash('Link copied.'); } catch (e) { flash('Copy this: ' + url); }
  });
}

function flash(text) {
  let el = $('#flash');
  if (!el) {
    el = document.createElement('div');
    el.id = 'flash';
    el.setAttribute('role', 'status');
    el.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:20;'
      + 'padding:12px 18px;border-radius:12px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.14);'
      + 'backdrop-filter:blur(24px);font-size:14px;font-weight:600;max-width:88vw;text-align:center';
    document.body.appendChild(el);
  }
  el.textContent = text;
  clearTimeout(flash.t);
  flash.t = setTimeout(() => { el.remove(); }, 3200);
}

/* -------------------------------------------------------------- the boot -- */

async function boot() {
  recordVisit();
  wireShare();
  wireSearch();

  const slug = slugFromPath();
  try {
    if ($('#result')) await drawResult();
    else if (location.pathname === '/' || location.pathname === '/index.html') await drawHome();
    else if (slug && !['find', 'back', 'thanks', 'claim'].includes(slug)) await drawBoard(slug);
  } catch (e) {
    /* The page already carries a ranking, written in at build time. Leaving it
       standing beats replacing a real one with an error. */
    console.error(e);
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

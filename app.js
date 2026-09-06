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
    if (location.pathname === '/' || location.pathname === '/index.html') await drawHome();
    else if (slug && !['find', 'back', 'thanks', 'claim'].includes(slug)) await drawBoard(slug);
  } catch (e) {
    /* The page already carries a ranking, written in at build time. Leaving it
       standing beats replacing a real one with an error. */
    console.error(e);
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

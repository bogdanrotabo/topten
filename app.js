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

import { esc, money, situation, costToOpen, listingKey, MIN_CENTS } from './lib.js?v=11f5c02fb1';
import { topTwo, amounts, row, battle, trend, openOne, move, ticker,
         figures, figuresNote, figureText } from './render.js?v=11f5c02fb1';

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

/* ---------------------------------------------------------- what happened -- */

/* What a visitor did, so a campaign that fails can be diagnosed instead of
   guessed at. Names only, never text anybody typed: the database refuses an
   event it does not recognise, which keeps this a measurement rather than a
   place to put things.
 *
 * Fire and forget. A count that cannot be recorded must never stop a page, and
 * must certainly never stop a payment. */
function event(name, extra) {
  try {
    const body = JSON.stringify({ session_id: sessionId(), name, ...(extra || {}) });
    const url = `${CFG.SUPABASE_URL}/rest/v1/site_events`;
    /* sendBeacon survives the page being replaced, which is exactly what
       happens on the click that matters most -- the one that leaves for
       Stripe. It cannot set headers, so the key rides in the query string,
       which is what PostgREST accepts there. */
    if (navigator.sendBeacon && (name === 'checkout_started' || name === 'back_clicked')) {
      const blob = new Blob([body], { type: 'application/json' });
      if (navigator.sendBeacon(`${url}?apikey=${encodeURIComponent(CFG.SUPABASE_ANON_KEY)}`, blob)) return;
    }
    fetch(url, {
      method: 'POST', keepalive: true,
      headers: { apikey: CFG.SUPABASE_ANON_KEY, Authorization: `Bearer ${CFG.SUPABASE_ANON_KEY}`,
                 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body,
    }).catch(() => {});
  } catch (e) { /* nothing here is worth an error */ }
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

/* ------------------------------------------------------------- numbers --- */

/* The four figures on the front page, and the light that says they are moving.
 *
 * They were read once when the page loaded and then stood still, which for a
 * count of visitors is a strange thing to print: the number was already wrong
 * by the time somebody had finished reading it. Now the page keeps asking.
 *
 * Every figure is a real reading from site_numbers(). Nothing here invents a
 * number, and nothing counts upwards on its own -- the animation only travels
 * between two figures the database actually returned. */

const NUMBERS_EVERY = 20000;

/* From one reading to the next, so a change is seen rather than blinked past.
   Rounded on the way, which for money means whole cents. */
function countTo(el, from, to, name) {
  const still = matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (still || from === to) { el.textContent = figureText(name, to); return; }
  const t0 = performance.now();
  const ms = 900;
  const step = (t) => {
    const k = Math.min(1, (t - t0) / ms);
    /* Fast at first and easing out, which is how a counter that is catching
       up looks, rather than a slider being dragged. */
    const eased = 1 - Math.pow(1 - k, 3);
    el.textContent = figureText(name, from + (to - from) * eased);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function paintNumbers(n) {
  const holder = $('#numbers .figures');
  if (!holder) return;

  /* First reading of the session: the cells the build wrote are already
     correct markup, so they are updated in place rather than replaced -- that
     way the animation has somewhere to count from. */
  if (!$('[data-figure]', holder)) holder.innerHTML = figures(n);

  $$('[data-figure]', holder).forEach((el) => {
    const name = el.dataset.figure;
    const to = Number(n[name]) || 0;
    const from = Number(el.dataset.value);
    if (Number.isFinite(from) && from !== to) {
      countTo(el, from, to, name);
      /* A brief mark on the one that moved, so which figure changed is
         visible even to somebody who looked up a second too late. */
      el.classList.remove('figure__v--moved');
      void el.offsetWidth;
      el.classList.add('figure__v--moved');
    } else if (!Number.isFinite(from)) {
      el.textContent = figureText(name, to);
    }
    el.dataset.value = String(to);
  });

  const note = $('#numbers-note');
  if (note) note.innerHTML = figuresNote(n);

  const light = $('#live');
  if (light) light.hidden = false;
}

/* Keep asking, while somebody is actually looking. A tab left open behind
   twenty others should not be polling a database for a number nobody can see,
   so this stops when the page is hidden and reads once on the way back. */
function watchNumbers() {
  if (!$('#numbers .figures')) return;
  let timer = null;

  const read = async () => {
    if (document.visibilityState !== 'visible') return;
    try { paintNumbers(await rpc('site_numbers')); }
    catch (e) {
      /* No reading, so the light goes out. An unlit light is the honest state
         and is never a stuck green one. */
      const light = $('#live');
      if (light) light.hidden = true;
    }
  };

  const start = () => { if (!timer) timer = setInterval(read, NUMBERS_EVERY); };
  const stop = () => { clearInterval(timer); timer = null; };

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { read(); start(); } else stop();
  });
  start();
}

/* -------------------------------------------------------------- ticker --- */

/* The strip across the top, from the newest payment down. Same shape the build
   writes, so the two cannot disagree; this only keeps it current. */
function tickList(rows, nameOf) {
  return rows
    .filter((r) => r.last_paid_at && nameOf(r.platform))
    .sort((a, b) => new Date(b.last_paid_at) - new Date(a.last_paid_at))
    .slice(0, 40)
    .map((r) => ({ handle: r.handle, boardName: nameOf(r.platform), rank: r.rank, cents: r.total_cents }));
}

/* How long one loop takes, from how far it actually has to go.
 *
 * The build writes an estimate estimated from how many names are on the strip;
 * this is the width they really took, once the font has arrived and the browser
 * has laid them out. Seventy pixels a second: a name crosses in about three and
 * a half seconds, quick enough to look alive and slow enough to read. The
 * clamps keep an almost-empty site from flickering and a very full one moving.
 */
function measureTicker() {
  const track = $('#ticker .ticker__track');
  if (!track) return;
  const half = track.scrollWidth / 2;
  if (!half) return;
  track.style.setProperty('--tick-dur', Math.min(600, Math.max(30, Math.round(half / 70))) + 's');
}

function paintTicker(items) {
  const el = $('#ticker');
  if (!el) return;
  if (items && items.length) {
    const holder = document.createElement('div');
    holder.innerHTML = ticker(items);
    const fresh = holder.firstElementChild;
    if (fresh) el.replaceWith(fresh);
  }
  measureTicker();
  /* Measured again once the webfont lands: Archivo is wider than the fallback,
     so a strip timed before it arrives runs slightly fast. */
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(measureTicker).catch(() => {});
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

  /* The ranking, and the newest payments anywhere on the site for the strip at
     the top. Two small reads rather than one large one: this page only needs
     its own two hundred rows, and the strip only needs the last forty. */
  const [rows, latest] = await Promise.all([
    rest('board?select=id,platform,handle,tagline,link,total_cents,last_paid_at,rank'
      + `&platform=eq.${encodeURIComponent(slug)}&order=rank.asc&limit=200`),
    rest('board?select=platform,handle,total_cents,last_paid_at,rank'
      + '&order=last_paid_at.desc.nullslast&limit=40').catch(() => null),
  ]);
  const s = situation(rows);

  const nameOf = (sl) => { const f = reg.boards.find((x) => x.slug === sl); return f ? f.name : null; };
  paintTicker(latest ? tickList(latest, nameOf) : null);

  const top = $('#top');
  if (top) top.innerHTML = topTwo(s);

  /* Who the button pays for. The challenger by default, because that is the
     move the page is inviting; any row can take its place. */
  let target = s.two || s.one || null;

  const back = $('#back');
  function drawBack() {
    if (!back) return;
    const href = target ? payHref(target.id) : null;
    /* Nothing on the ranking yet: the only move available is adding a name, so
       that is what the button does. It used to read "Nothing listed yet" and
       be switched off, with the form that could have fixed it folded shut
       further down the page -- which is a page that tells a reader what is
       missing and gives them no way to supply it. */
    back.innerHTML =
      (target
        ? `<a class="cta" id="pay"${href ? ` href="${esc(href)}"` : ' aria-disabled="true"'}>`
          + 'Back ' + esc(target.handle) + '</a>'
        : '<a class="cta" id="pay" href="#add-name">Add the first name</a>')
      + amounts(target && s.one && target.id !== s.one.id
          ? s : { ...s, two: target && s.one && target.id === s.one.id ? null : s.two },
        board.name, href);
    if (target && s.one && target.id !== s.one.id && target.id !== (s.two && s.two.id)) {
      /* Backing somebody further down: say what that costs from where they are. */
      const need = Math.max(MIN_CENTS, s.one.total_cents - target.total_cents + 1);
      const note = $('.note div', back);
      if (note) note.innerHTML = 'You type the amount on the payment page. '
        + `<span class="num">${esc(money(need))}</span> would put ${esc(target.handle)} at `
        + `<span class="num">${esc(money(target.total_cents + need))}</span>, past `
        + `${esc(s.one.handle)}.`;
    }
  }
  drawBack();

  const rest_ = s.list.slice(2);
  const restEl = $('#rest .glass');
  if (restEl) restEl.innerHTML = rest_.map((r, i) => (i ? '<hr class="hr">' : '') + row(r, i + 3)).join('');

  event('board_view', { board: slug });
  wireAdd(slug, board.name);

  /* Whether the browser is on its way to Stripe. Declared before both handlers
     below because a chip is a way out of the page too. */
  let leaving = false;

  /* The click that leads to Stripe, and the moment the browser actually
     leaves. They are usually the same second; when they are not -- a blocked
     navigation, a change of mind on the tap -- the difference is the whole
     point of recording both. */
  document.addEventListener('click', (e) => {
    const pay = e.target.closest && e.target.closest('#pay, .cta[href*="stripe"]');
    if (!pay || pay.getAttribute('aria-disabled')) return;
    leaving = true;
    event('back_clicked', { board: slug, listing_id: target ? target.id : null });
  });
  addEventListener('pagehide', () => {
    if (leaving) event('checkout_started', { board: slug, listing_id: target ? target.id : null });
  });

  /* Which amount was pressed. Every chip is a link to the same payment page
     the button leads to, so this records the figure the payer meant to type on
     their way out -- the intent, which is the interesting half anyway, and the
     only half this side of the site can ever know. The navigation is the
     browser's; nothing here interferes with it. */
  document.addEventListener('click', (e) => {
    const chip = e.target.closest && e.target.closest('.chip[data-amount]');
    if (!chip) return;
    leaving = true;
    event('amount_selected', { board: slug, amount_cents: Number(chip.dataset.amount) || 0 });
  });

  /* Any row can become the one being backed. */
  $$('#rest .row, #top .top__one, #top .top__two').forEach((el, i) => {
    el.style.cursor = 'pointer';
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    const pick = () => {
      const name = ($('.row__name', el) || $('.top__name', el) || {}).textContent;
      const found = s.list.find((r) => r.handle === name);
      if (found) {
        target = found; drawBack();
        event('listing_picked', { board: slug, listing_id: found.id });
        $('#back').scrollIntoView({ block: 'nearest' });
      }
    };
    el.addEventListener('click', pick);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
    void i;
  });
}

/* ------------------------------------------------------------- the adding -- */

/* The token a listing is edited with, kept in the browser that created the
   row and nowhere else. Paying towards a listing has never granted the right
   to edit it -- anybody may pay towards anything, and two dollars must not buy
   the pen -- so this is only ever written for a row this browser made. */
function keepToken(id, token) {
  if (!id || !token) return;
  try {
    const all = JSON.parse(localStorage.getItem('topten_tokens') || '{}');
    all[id] = token;
    localStorage.setItem('topten_tokens', JSON.stringify(all));
  } catch (e) { /* a browser that will not store it simply cannot edit later */ }
}

function wireAdd(slug, boardName) {
  const form = $('#add-form');
  if (!form) return;
  const out = $('#add-out');
  const say = (html, bad) => {
    out.innerHTML = `<div class="note${bad ? ' note--bad' : ''}">`
      + '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
      + 'stroke-width="1.9" stroke-linecap="round" aria-hidden="true">'
      + '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>'
      + `<div>${html}</div></div>`;
  };

  const holder = form.closest('details');
  if (holder) holder.addEventListener('toggle', () => { if (holder.open) event('add_opened', { board: slug }); });

  /* The button at the top of an empty ranking points at the name field. The
     jump alone is enough without a script -- the form is rendered open when
     there is nothing listed -- and with one, the form also opens wherever it
     is pressed from and the cursor is already in the field. */
  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a[href="#add-name"]');
    if (!a) return;
    if (holder && !holder.open) holder.open = true;
    const input = $('#add-name');
    if (input) setTimeout(() => input.focus({ preventScroll: true }), 60);
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    event('add_submitted', { board: slug });
    const name = $('#add-name').value.trim().slice(0, 40);
    let link = $('#add-link').value.trim();
    if (!name) { say('It needs a name.', true); return; }
    if (link && !/^[a-z][a-z0-9+.-]*:/i.test(link)) link = 'https://' + link;
    if (link && !/^https?:\/\/[a-z0-9][a-z0-9._-]*\.[a-z]{2,}/i.test(link)) {
      say('That link is not an address a browser can open. Leave it empty if there is not one.', true);
      return;
    }

    const btn = $('button[type=submit]', form);
    btn.setAttribute('aria-disabled', 'true');
    btn.textContent = 'Adding…';
    try {
      const r = await rpc('create_listing', {
        p_platform: slug,
        p_url: listingKey(slug, name),
        p_handle: name,
        p_tagline: null,
        p_link: link || null,
      });
      if (!r || !r.ok) { say('That could not be added. Try a different name.', true); return; }

      if (r.existing) {
        say(`<b>${esc(name)}</b> is already on ${esc(boardName)}. Back the listing that is there `
          + 'rather than starting a second one &mdash; the money would be split between them otherwise.');
        btn.textContent = 'Add and back it';
        btn.removeAttribute('aria-disabled');
        return;
      }

      keepToken(r.id, r.edit_token);
      const href = payHref(r.id);
      if (!href) { say('Added. Payments are not configured, so it cannot be backed yet.', true); return; }
      say(`<b>${esc(name)}</b> is ready. Sending you to Stripe &mdash; type at least `
        + `<span class="num">${esc(money(costToOpen()))}</span> and it goes on the ranking.`);
      setTimeout(() => { location.href = href; }, 900);
    } catch (err) {
      say('Something went wrong on our side. Nothing was charged.', true);
      btn.textContent = 'Add and back it';
      btn.removeAttribute('aria-disabled');
    }
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
    event('search_used');
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

  paintTicker(tickList(rows, (sl) => (bySlug.get(sl) || {}).name || null));

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
      + amounts(leadBoard.s, leadBoard.name, payHref(lead.two.id)) + '</div>';
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

  /* The first reading of the session, and then it keeps reading. The page was
     built with figures that were true when it was built; these are true now,
     and the ones twenty seconds from now will be true then. */
  paintNumbers(numbers);
  watchNumbers();
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

  event('result_seen');
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
    event('share_clicked');
    if (navigator.share) { try { await navigator.share({ title, url }); return; } catch (e) { /* dismissed */ } }
    try { await navigator.clipboard.writeText(url); flash('Link copied.'); } catch (e) { flash('Copy this: ' + url); }
  };
  $$('#share, #share2').forEach((b) => b.addEventListener('click', go));

  /* The share row. Every link in it is already a working link in the markup;
     these are the two things that cannot be written as an href.

     "More" is the phone's own sheet, which is the only way into Instagram,
     TikTok, YouTube and Snapchat -- none of which can be linked into with a
     message prepared. It ships hidden and is revealed here, because a button
     that opens nothing on a desktop browser is worse than no button. */
  $$('.sharebar').forEach((bar) => {
    const shareUrl = bar.dataset.shareUrl || url;
    const shareText = bar.dataset.shareText || title;

    const sheet = $('[data-share-sheet]', bar);
    if (sheet && navigator.share) sheet.hidden = false;

    bar.addEventListener('click', async (e) => {
      const target = e.target.closest && e.target.closest('a.sb, button.sb');
      if (!target) return;
      event('share_clicked', { where: target.dataset.shareCopy !== undefined ? 'copy'
        : target.dataset.shareSheet !== undefined ? 'sheet' : target.textContent.trim().toLowerCase() });

      if (target.dataset.shareSheet !== undefined) {
        e.preventDefault();
        /* Cancelling the sheet rejects, and somebody changing their mind is
           not an error worth reporting. */
        try { await navigator.share({ text: shareText, url: shareUrl }); } catch (err) { /* dismissed */ }
        return;
      }
      if (target.dataset.shareCopy === undefined) return;   // a real link: let it go

      e.preventDefault();
      const was = target.textContent;
      try {
        await navigator.clipboard.writeText(shareUrl);
        target.textContent = 'Copied';
      } catch (err) {
        target.textContent = 'Copy failed';
        flash('Copy this: ' + shareUrl);
      }
      setTimeout(() => { target.textContent = was; }, 1800);
    });
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

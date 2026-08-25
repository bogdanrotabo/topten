/* TopTen.one — pay-to-rank boards. Vanilla, no build step.
   The client renders and validates; only the Stripe webhook can move money. */
(() => {
  'use strict';

  const CFG = window.TOPTEN_CONFIG || {};
  const MIN_CENTS = 200;                 // Stripe fee floor: $2
  // Stripe refuses a custom_unit_amount above $10,000 per payment unless the
  // account asks support to raise it. Totals are cumulative, so this caps a
  // single payment, never how high a listing can climb.
  const MAX_CENTS = 1000000;
  const ACTIVE_DAYS = 30;
  const LS_LAST = 'topten:last-listing';

  const PLATFORMS = [
    { slug: 'x',         name: 'X',         color: '#e7e9ea', hosts: ['x.com', 'twitter.com'] },
    { slug: 'instagram', name: 'Instagram', color: '#e1306c', hosts: ['instagram.com'] },
    { slug: 'tiktok',    name: 'TikTok',    color: '#fe2c55', hosts: ['tiktok.com'] },
    { slug: 'youtube',   name: 'YouTube',   color: '#ff0000', hosts: ['youtube.com', 'youtu.be'] },
    { slug: 'twitch',    name: 'Twitch',    color: '#9146ff', hosts: ['twitch.tv'] },
    { slug: 'linkedin',  name: 'LinkedIn',  color: '#0a66c2', hosts: ['linkedin.com'] },
    { slug: 'threads',   name: 'Threads',   color: '#c9c9c9', hosts: ['threads.net', 'threads.com'] },
    { slug: 'facebook',  name: 'Facebook',  color: '#1877f2', hosts: ['facebook.com', 'fb.com'] }
  ];

  const BY_SLUG = Object.fromEntries(PLATFORMS.map(p => [p.slug, p]));

  const ICONS = {
    x: '<path d="M4 4l16 16M20 4L4 20" stroke="currentColor" stroke-width="2.6" fill="none" stroke-linecap="round"/>',
    instagram: '<rect x="3" y="3" width="18" height="18" rx="5.5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="4.2" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="17.2" cy="6.8" r="1.3" fill="currentColor"/>',
    tiktok: '<path d="M9.2 17.4a3.4 3.4 0 1 0 3.4-3.4V3.6c1 2.7 2.9 4.1 5.6 4.3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    youtube: '<rect x="2.5" y="5" width="19" height="14" rx="4.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M10.4 9.1l5.2 2.9-5.2 2.9z" fill="currentColor"/>',
    twitch: '<path d="M4 3h16v10.5L16 18h-3.2L9.6 21H8v-3H4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M11.2 8v4M15.2 8v4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    linkedin: '<rect x="3" y="3" width="18" height="18" rx="3.4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M7.6 10.6V17M11.6 17v-3.5a2.35 2.35 0 0 1 4.7 0V17" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/><circle cx="7.6" cy="7.4" r="1.15" fill="currentColor"/>',
    threads: '<path d="M12.2 21a9 9 0 1 1 8.8-9v1.4a2.7 2.7 0 0 1-5.4 0V12a3.3 3.3 0 1 0-1.1 2.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    facebook: '<path d="M14.4 21v-8h2.7l.5-3.2h-3.2V7.7c0-.9.3-1.5 1.7-1.5h1.7V3.3c-.3 0-1.3-.1-2.5-.1-2.5 0-4.2 1.5-4.2 4.2v2.4H8.4V13h2.7v8z" fill="currentColor"/>'
  };

  const $ = sel => document.querySelector(sel);
  const view = $('#view');
  const modal = $('#modal');
  const panel = $('#modal-panel');
  const sticky = $('#sticky');

  /* ------------------------------------------------------------- helpers */

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const icon = slug => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[slug] || ''}</svg>`;

  function money(cents) {
    const n = Number(cents || 0) / 100;
    return '$' + n.toLocaleString('en-US', {
      minimumFractionDigits: n % 1 ? 2 : 0,
      maximumFractionDigits: 2
    });
  }

  /** Smallest whole-dollar amount strictly greater than `cents`. */
  const nextDollarAbove = cents => Math.floor(Number(cents || 0) / 100) * 100 + 100;

  const clampMin = cents => Math.max(MIN_CENTS, Math.round(cents));

  function avatarUrl(platform, handle) {
    const h = String(handle || '').replace(/^@/, '');
    return `https://unavatar.io/${encodeURIComponent(platform)}/${encodeURIComponent(h)}?fallback=false`;
  }

  const FALLBACK_AV = 'data:image/svg+xml;utf8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 44 44"><rect width="44" height="44" rx="22" fill="#171a22"/><circle cx="22" cy="17" r="7" fill="#2b303b"/><path d="M8 42c2-8 7-12 14-12s12 4 14 12z" fill="#2b303b"/></svg>');

  function debounce(fn, ms) {
    let t;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  }

  /* -------------------------------------------------------- url handling */

  // Path segments that introduce a profile rather than being one. They are
  // per platform on purpose: /user/ names a channel on YouTube and nothing on X,
  // so a shared list would read x.com/user/status/123 as the profile "user".
  const PREFIXES = {
    youtube:  new Set(['c', 'user', 'channel']),
    linkedin: new Set(['in', 'company', 'school']),
    facebook: new Set(['people', 'pg'])
  };

  // A segment sitting after the handle that means "one piece of content".
  const POST_MARKER = new Set([
    'status', 'statuses', 'video', 'post', 'posts', 'photo', 'photos',
    'reel', 'reels', 'p', 'permalink'
  ]);

  /**
   * Normalize a pasted profile URL and pull the handle out of it.
   * Returns { ok, url, handle } or { ok:false, error }.
   */
  function parseProfile(raw, slug) {
    const p = BY_SLUG[slug];
    if (!p) return { ok: false, error: 'Pick a platform first.' };

    let input = String(raw || '').trim();
    if (!input) return { ok: false, error: '' };
    if (!/^https?:\/\//i.test(input)) input = 'https://' + input.replace(/^\/+/, '');

    let u;
    try { u = new URL(input); } catch { return { ok: false, error: 'That is not a link.' }; }

    let host = u.hostname.toLowerCase().replace(/^(www|m|mobile|web)\./, '');
    const hostOk = p.hosts.some(h => host === h || host.endsWith('.' + h));
    if (!hostOk) {
      return { ok: false, error: `That link is not ${p.name}. Expected ${p.hosts.join(' or ')}.` };
    }
    // Collapse the accepted aliases onto one canonical host so twitter.com and
    // x.com cannot hold two listings for the same person.
    host = p.hosts[0];

    const segments = u.pathname.split('/').map(s => decodeURIComponent(s).trim()).filter(Boolean);

    // facebook.com/profile.php?id=123 is the only profile shape that lives in
    // the query string, so it is the only query we keep.
    let keptQuery = '';
    if (slug === 'facebook' && /^profile\.php$/i.test(segments[0] || '')) {
      const id = u.searchParams.get('id');
      if (!id || !/^\d+$/.test(id)) return { ok: false, error: 'That Facebook link has no profile id.' };
      keptQuery = '?id=' + id;
      const url = `https://${host}/profile.php${keptQuery}`;
      return { ok: true, url, handle: '@' + id };
    }

    if (!segments.length) return { ok: false, error: `That is the ${p.name} homepage, not a profile.` };

    // youtube.com/watch, /shorts, /playlist point at content, not a person.
    if (slug === 'youtube' && ['watch', 'shorts', 'playlist', 'results'].includes(segments[0].toLowerCase())) {
      return { ok: false, error: 'Link the channel, not a video.' };
    }
    if (slug === 'x' && ['i', 'home', 'search', 'explore', 'messages'].includes(segments[0].toLowerCase())) {
      return { ok: false, error: 'Link the profile, not a page.' };
    }
    if (slug === 'instagram' && ['p', 'reel', 'reels', 'explore', 'stories'].includes(segments[0].toLowerCase())) {
      return { ok: false, error: 'Link the profile, not a post.' };
    }

    // Keep the meaningful part of the path: /in/name, /channel/UC…, /@name, /name
    const prefixes = PREFIXES[slug] || new Set();
    const kept = [];
    for (const seg of segments) {
      const low = seg.toLowerCase();
      if (!kept.length && prefixes.has(low)) { kept.push(low); continue; }
      kept.push(seg);
      break;
    }

    const last = kept[kept.length - 1];
    if (!last || prefixes.has(last.toLowerCase())) {
      return { ok: false, error: 'No profile name in that link.' };
    }
    if (!/^[@]?[A-Za-z0-9._\-]{1,40}$/.test(last)) {
      return { ok: false, error: 'That does not look like a profile name.' };
    }

    // /bogdan/status/123 is a post by @bogdan, not a way to list @bogdan.
    if (POST_MARKER.has((segments[kept.length] || '').toLowerCase())) {
      return { ok: false, error: 'Link the profile, not a post.' };
    }

    const url = `https://${host}/${kept.join('/')}`.replace(/\/+$/, '');
    const handle = last.startsWith('@') ? last : '@' + last;

    return { ok: true, url, handle };
  }

  /* ----------------------------------------------------------- supabase */

  let sb = null;
  let connectionError = '';

  function initSupabase() {
    if (!CFG.SUPABASE_URL || !CFG.SUPABASE_ANON_KEY) {
      connectionError = 'config';
      return null;
    }
    if (!window.supabase) { connectionError = 'sdk'; return null; }
    sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
      realtime: { params: { eventsPerSecond: 4 } }
    });
    return sb;
  }

  /* -------------------------------------------------------------- state */

  const state = {
    boards: Object.fromEntries(PLATFORMS.map(p => [p.slug, []])),
    platform: 'x',
    online: 1,
    loaded: false,
    prevRanks: {}
  };

  async function loadBoards() {
    if (!sb) return;
    const { data, error } = await sb
      .from('board')
      .select('id,platform,handle,url,tagline,total_cents,last_paid_at,rank')
      .order('platform', { ascending: true })
      .order('rank', { ascending: true })
      .limit(2000);

    if (error) { console.error('board load failed', error); connectionError = 'query'; return; }

    const next = Object.fromEntries(PLATFORMS.map(p => [p.slug, []]));
    for (const row of data || []) {
      if (next[row.platform]) next[row.platform].push(row);
    }
    for (const slug of Object.keys(next)) {
      next[slug].sort((a, b) =>
        b.total_cents - a.total_cents ||
        new Date(a.last_paid_at) - new Date(b.last_paid_at));
    }
    state.boards = next;
    state.loaded = true;
  }

  const board = slug => state.boards[slug] || [];
  const topCents = slug => board(slug)[0]?.total_cents || 0;
  const cutoffCents = slug => board(slug)[9]?.total_cents || 0;

  /** Where `totalCents` would land on `slug`. Ties lose: an equal total that is
      already on the board was paid earlier and keeps the higher position. */
  function rankFor(slug, totalCents, exceptId) {
    let ahead = 0;
    for (const row of board(slug)) {
      if (row.id === exceptId) continue;
      if (row.total_cents >= totalCents) ahead++;
    }
    return ahead + 1;
  }

  function stats() {
    let count = 0, total = 0, top = 0;
    for (const slug of Object.keys(state.boards)) {
      for (const r of state.boards[slug]) {
        count++;
        total += Number(r.total_cents);
        if (r.total_cents > top) top = r.total_cents;
      }
    }
    return { count, total, top };
  }

  /* ---------------------------------------------------------- rendering */

  function renderStats() {
    const s = stats();
    return `
    <div class="stats">
      <div class="stat"><span class="stat__v">${s.count}</span><span class="stat__k">Listings</span></div>
      <div class="stat"><span class="stat__v">${money(s.total)}</span><span class="stat__k">On the boards</span></div>
      <div class="stat"><span class="stat__v">${money(s.top)}</span><span class="stat__k">Highest</span></div>
      <div class="stat stat--live"><span class="stat__v"><span class="pulse"></span>${state.online}</span><span class="stat__k">Online</span></div>
    </div>`;
  }

  function renderTabs() {
    return `
    <div class="tabs"><div class="shell"><div class="tabs__scroll" role="tablist">
      ${PLATFORMS.map(p => {
        const on = p.slug === state.platform;
        const n = board(p.slug).length;
        return `<button class="tab" role="tab" aria-selected="${on}" data-tab="${p.slug}"
                  style="--tab-brand:${p.color}">${icon(p.slug)}${esc(p.name)}${n ? `<span class="tab__n">${n}</span>` : ''}</button>`;
      }).join('')}
    </div></div></div>`;
  }

  function renderRow(row, idx) {
    const p = BY_SLUG[row.platform];
    const rank = idx + 1;
    const cls = ['row', rank <= 10 ? 'row--top' : '', rank === 1 ? 'row--1' : ''].filter(Boolean).join(' ');
    const report = `mailto:${CFG.CONTACT_EMAIL || 'hello@topten.one'}?subject=${encodeURIComponent('Report listing ' + row.id)}&body=${encodeURIComponent('Listing: ' + row.id + '\nProfile: ' + row.url + '\n\nWhy this should be reviewed:\n')}`;
    return `
    <div class="${cls}" data-row="${esc(row.id)}">
      <div class="row__rank">${rank}</div>
      <img class="row__av" loading="lazy" width="44" height="44" alt=""
           src="${esc(avatarUrl(row.platform, row.handle))}" onerror="this.onerror=null;this.src='${FALLBACK_AV}'">
      <div class="row__main">
        <div class="row__handle">
          <a href="${esc(row.url)}" target="_blank" rel="nofollow noopener">${esc(row.handle)}</a>
        </div>
        ${row.tagline ? `<div class="row__tagline">${esc(row.tagline)}</div>` : ''}
      </div>
      <div class="row__right">
        <div class="row__amt">${money(row.total_cents)}</div>
        <button class="row__add" data-add="${esc(row.id)}">Add money</button>
      </div>
      <div class="row__meta">
        <a href="/badge/?p=${esc(row.platform)}&amp;h=${encodeURIComponent(row.handle)}" data-link>Badge</a>
        <a href="${esc(report)}">Report</a>
        <span>${esc(p?.name || row.platform)}</span>
      </div>
    </div>`;
  }

  function renderBoard() {
    const slug = state.platform;
    const p = BY_SLUG[slug];
    const rows = board(slug);
    const lead = rows[0];

    if (connectionError === 'config') {
      return `<div class="shell board"><div class="empty">
        <h3>Not connected yet</h3>
        <p>Fill in <code>config.js</code> with the Supabase URL, the anon key and the Stripe payment link, then reload.</p>
      </div></div>`;
    }

    const head = lead ? `
      <div class="tobeat">
        <div>
          <span class="tobeat__k">Holding #1 on ${esc(p.name)}</span>
          <span class="tobeat__v">${money(lead.total_cents)}</span>
          <span class="tobeat__who">${esc(lead.handle)}</span>
        </div>
        <button class="tobeat__cta" data-claim="1">Beat it for ${money(clampMin(nextDollarAbove(lead.total_cents)))}</button>
      </div>` : '';

    const top10 = rows.slice(0, 10);
    const rest = rows.slice(10);

    const body = top10.length
      ? `<div class="rows">${top10.map(renderRow).join('')}</div>`
      : `<div class="empty">
           <h3>No one on ${esc(p.name)} yet</h3>
           <p>The first listing takes #1 for ${money(MIN_CENTS)}.</p>
           <button class="btn" data-claim="1">Take #1 for ${money(MIN_CENTS)}</button>
         </div>`;

    const gap = rows.length >= 10 ? clampMin(nextDollarAbove(cutoffCents(slug))) : MIN_CENTS;

    const waiting = rest.length ? `
      <details class="waiting">
        <summary>
          <span>Waiting list · ${rest.length}</span>
          <span class="waiting__gap">${money(gap)} to reach #10</span>
        </summary>
        ${rest.map((r, i) => `
          <div class="wrow">
            <span class="wrow__rank">${i + 11}</span>
            <span class="wrow__h">${esc(r.handle)}</span>
            <span class="wrow__a">${money(r.total_cents)}</span>
            <button class="wrow__add" data-add="${esc(r.id)}">Add</button>
          </div>`).join('')}
      </details>` : '';

    return `<div class="shell board" style="--brand:${p.color}">${head}${body}${waiting}</div>`;
  }

  function renderHome() {
    view.innerHTML = `
      <div class="shell">
        <section class="hero">
          <h1>TopTen<em>.one</em></h1>
          <p class="hero__tag">Be the one.</p>
          <p class="hero__sub">Pay to be seen. Top 10 per platform. No algorithm.</p>
        </section>
        ${renderStats()}
      </div>
      ${renderTabs()}
      <div id="board-slot">${renderBoard()}</div>`;
    sticky.hidden = false;
    $('#cta-claim').textContent = board(state.platform).length
      ? `Take #1 on ${BY_SLUG[state.platform].name} for ${money(clampMin(nextDollarAbove(topCents(state.platform))))}`
      : 'Claim a spot';
    document.title = `Top 10 on ${BY_SLUG[state.platform].name} — TopTen.one`;
    // Baseline for the outbid animation. Must happen after the platform is
    // settled, or the first live change has nothing to compare against.
    snapshotRanks();
  }

  /** Re-render only the board, animating rows whose position moved. */
  function refreshBoard() {
    const slot = $('#board-slot');
    if (!slot) return;
    const before = state.prevRanks;
    slot.innerHTML = renderBoard();

    const now = {};
    board(state.platform).forEach((r, i) => { now[r.id] = i + 1; });
    for (const [id, rank] of Object.entries(now)) {
      const was = before[id];
      if (was === undefined || was === rank) continue;
      const el = slot.querySelector(`[data-row="${CSS.escape(id)}"]`);
      if (el) el.classList.add(rank < was ? 'row--bumped' : 'row--sunk');
    }
    state.prevRanks = now;

    const statsEl = document.querySelector('.stats');
    if (statsEl) statsEl.outerHTML = renderStats();
    PLATFORMS.forEach(p => {
      const tab = document.querySelector(`[data-tab="${p.slug}"] .tab__n`);
      const n = board(p.slug).length;
      if (tab) tab.textContent = String(n);
    });
    const cta = $('#cta-claim');
    if (cta) cta.textContent = board(state.platform).length
      ? `Take #1 on ${BY_SLUG[state.platform].name} for ${money(clampMin(nextDollarAbove(topCents(state.platform))))}`
      : 'Claim a spot';
  }

  /** Remember where every listing sits, so the next refresh can animate movement. */
  function snapshotRanks() {
    state.prevRanks = {};
    board(state.platform).forEach((r, i) => { state.prevRanks[r.id] = i + 1; });
  }

  /* ------------------------------------------------------------- modals */

  function openModal(html) {
    panel.innerHTML = html;
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
    const first = panel.querySelector('input, button');
    if (first) setTimeout(() => first.focus(), 40);
  }

  function closeModal() {
    modal.hidden = true;
    panel.innerHTML = '';
    document.body.style.overflow = '';
  }

  modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !modal.hidden) closeModal(); });

  /** Build the price ladder for a platform. `current` is the listing's existing
      total when adding money, 0 when submitting something new. */
  function ladder(slug, current, exceptId) {
    const rows = board(slug).filter(r => r.id !== exceptId);
    const opts = [];
    const push = (label, note, targetTotal) => {
      const wanted = clampMin(targetTotal - current);
      const delta = Math.min(wanted, MAX_CENTS);
      // A position can cost more than Stripe allows in one go. Say so rather
      // than offering a button that dies at checkout.
      opts.push({
        label,
        note: delta < wanted ? `${note} — more than one payment` : note,
        delta
      });
    };

    if (rows[0] && rows[0].total_cents >= current) {
      push('Take #1', exceptId ? 'Pass everyone above you' : 'Straight to the top of the board',
        nextDollarAbove(rows[0].total_cents));
    } else {
      push('Take #1', rows.length ? 'You are already #1 — extend the lead' : 'The board is empty',
        Math.max(nextDollarAbove(current), current + MIN_CENTS));
    }

    if (exceptId) {
      const myIndex = board(slug).findIndex(r => r.id === exceptId);
      const above = myIndex > 0 ? board(slug)[myIndex - 1] : null;
      if (above) {
        push(`Beat #${myIndex}`, `Pass ${above.handle}`, nextDollarAbove(above.total_cents));
      }
    } else if (rows[2]) {
      push('Take #3', `Pass ${rows[2].handle}`, nextDollarAbove(rows[2].total_cents));
    }

    if (rows.length >= 10) {
      const inTop = board(slug).findIndex(r => r.id === exceptId);
      if (!exceptId || inTop < 0 || inTop >= 10) {
        push('Enter the Top 10', `Pass ${rows[9].handle}`, nextDollarAbove(rows[9].total_cents));
      }
    } else if (!exceptId) {
      push('Enter the Top 10', 'Fewer than ten listings — a spot is open', MIN_CENTS);
    }

    // Same price twice reads as a bug; keep the first (better) label.
    const seen = new Set();
    return opts.filter(o => (seen.has(o.delta) ? false : seen.add(o.delta)));
  }

  function amountBlock(slug, current, exceptId) {
    const opts = ladder(slug, current, exceptId);
    return `
      <div class="amounts" id="amounts">
        ${opts.map((o, i) => `
          <button type="button" class="amt" data-amt="${o.delta}" aria-pressed="${i === 0}">
            <span><span class="amt__label">${esc(o.label)}</span><span class="amt__note">${esc(o.note)}</span></span>
            <span class="amt__price">${current ? '+' : ''}${money(o.delta)}</span>
          </button>`).join('')}
        <div class="free" id="free" aria-pressed="false">
          <span class="free__cur">$</span>
          <input id="free-input" type="number" inputmode="decimal" min="2" step="1"
                 max="${MAX_CENTS / 100}"
                 placeholder="Any amount" aria-label="Custom amount in US dollars">
        </div>
      </div>
      <div class="verdict" id="verdict"></div>`;
  }

  function submitModal(preslug) {
    state.draft = { slug: preslug || state.platform, url: '', handle: '', tagline: '', cents: 0 };
    const slug = state.draft.slug;
    openModal(`
      <div class="modal__head">
        <div>
          <h2 id="modal-title">Claim a spot</h2>
          <p>Paste a profile, pick an amount. The money is the rank.</p>
        </div>
        <button class="modal__x" data-close aria-label="Close">&times;</button>
      </div>

      <div class="field">
        <label>Platform</label>
        <div class="picker" id="picker">
          ${PLATFORMS.map(p => `
            <button type="button" class="pick" data-pick="${p.slug}" aria-pressed="${p.slug === slug}"
                    style="--pick-brand:${p.color}" title="${esc(p.name)}"
                    aria-label="${esc(p.name)}">${icon(p.slug)}</button>`).join('')}
        </div>
      </div>

      <div class="field">
        <label for="url-input">Profile link</label>
        <input class="input" id="url-input" type="url" inputmode="url" autocomplete="off"
               spellcheck="false" placeholder="https://x.com/yourname">
        <div class="hint" id="url-hint"></div>
      </div>

      <div class="field">
        <label for="tag-input">Tagline <span style="text-transform:none;letter-spacing:0">— optional, 80 characters</span></label>
        <input class="input" id="tag-input" maxlength="80" placeholder="One line about you">
      </div>

      <div class="field">
        <label>Amount</label>
        ${amountBlock(slug, 0, null)}
      </div>

      <button class="btn" id="go" disabled>Continue to payment</button>
      <ul class="finelist">
        <li>Payments are final. No refunds.</li>
        <li>A listing stays on the board for 30 days after its last payment.</li>
        <li>Anyone can add money to any listing, including yours.</li>
      </ul>`);

    wireAmounts(slug, 0, null);
    wireSubmit();
  }

  function addMoneyModal(row) {
    state.draft = { slug: row.platform, listingId: row.id, current: row.total_cents, cents: 0 };
    const pos = board(row.platform).findIndex(r => r.id === row.id) + 1;
    openModal(`
      <div class="modal__head">
        <div>
          <h2 id="modal-title">Add money to ${esc(row.handle)}</h2>
          <p>Currently ${money(row.total_cents)} · #${pos} on ${esc(BY_SLUG[row.platform].name)}.
             Money adds to the total, and the total is the rank.</p>
        </div>
        <button class="modal__x" data-close aria-label="Close">&times;</button>
      </div>

      <div class="field">
        <label>Amount to add</label>
        ${amountBlock(row.platform, row.total_cents, row.id)}
      </div>

      <button class="btn" id="go">Continue to payment</button>
      <ul class="finelist">
        <li>Payments are final. No refunds.</li>
        <li>This resets the listing's 30-day clock.</li>
      </ul>`);

    wireAmounts(row.platform, row.total_cents, row.id);
    $('#go').addEventListener('click', () => goToStripe(row.id));
  }

  function wireAmounts(slug, current, exceptId) {
    const wrap = $('#amounts');
    const free = $('#free');
    const freeInput = $('#free-input');
    const verdict = $('#verdict');

    const setVerdict = cents => {
      state.draft.cents = cents;
      if (!cents || cents < MIN_CENTS) {
        verdict.className = 'verdict verdict--bad';
        verdict.textContent = `Minimum ${money(MIN_CENTS)}.`;
        // Below the floor is never payable, whichever modal is open.
        const go = $('#go');
        if (go) go.disabled = true;
        return;
      }
      if (cents > MAX_CENTS) {
        verdict.className = 'verdict verdict--bad';
        verdict.textContent =
          `Stripe caps one payment at ${money(MAX_CENTS)}. Pay again after this one — totals add up.`;
        const go = $('#go');
        if (go) go.disabled = true;
        return;
      }
      const total = current + cents;
      const r = rankFor(slug, total, exceptId);
      verdict.className = 'verdict';
      verdict.innerHTML = r <= 10
        ? `This puts you at <b>#${r}</b> on ${esc(BY_SLUG[slug].name)}`
        : `This puts you at <b>#${r}</b> — ${money(clampMin(nextDollarAbove(cutoffCents(slug)) - current))} reaches the Top 10`;
      const go = $('#go');
      if (go) go.disabled = exceptId ? false : !state.draft.url;
    };

    wrap.addEventListener('click', e => {
      const btn = e.target.closest('[data-amt]');
      if (!btn) return;
      wrap.querySelectorAll('[data-amt]').forEach(b => b.setAttribute('aria-pressed', b === btn));
      free.setAttribute('aria-pressed', 'false');
      freeInput.value = '';
      setVerdict(Number(btn.dataset.amt));
    });

    freeInput.addEventListener('input', () => {
      wrap.querySelectorAll('[data-amt]').forEach(b => b.setAttribute('aria-pressed', 'false'));
      free.setAttribute('aria-pressed', 'true');
      const dollars = parseFloat(freeInput.value);
      setVerdict(Number.isFinite(dollars) ? Math.round(dollars * 100) : 0);
    });

    const first = wrap.querySelector('[data-amt]');
    if (first) setVerdict(Number(first.dataset.amt));
  }

  function wireSubmit() {
    const urlInput = $('#url-input');
    const hint = $('#url-hint');
    const tag = $('#tag-input');

    const validate = () => {
      const res = parseProfile(urlInput.value, state.draft.slug);
      if (!urlInput.value.trim()) {
        hint.className = 'hint'; hint.textContent = '';
        urlInput.removeAttribute('aria-invalid');
        state.draft.url = '';
      } else if (res.ok) {
        hint.className = 'hint hint--good';
        hint.textContent = `${res.handle} · ${res.url}`;
        urlInput.removeAttribute('aria-invalid');
        state.draft.url = res.url;
        state.draft.handle = res.handle;
      } else {
        hint.className = 'hint hint--bad';
        hint.textContent = res.error;
        urlInput.setAttribute('aria-invalid', 'true');
        state.draft.url = '';
      }
      $('#go').disabled = !state.draft.url || state.draft.cents < MIN_CENTS;
    };

    urlInput.addEventListener('input', validate);
    tag.addEventListener('input', () => { state.draft.tagline = tag.value.trim(); });

    $('#picker').addEventListener('click', e => {
      const b = e.target.closest('[data-pick]');
      if (!b) return;
      state.draft.slug = b.dataset.pick;
      $('#picker').querySelectorAll('[data-pick]').forEach(x => x.setAttribute('aria-pressed', x === b));
      urlInput.placeholder = `https://${BY_SLUG[state.draft.slug].hosts[0]}/yourname`;
      // The ladder is per platform, so rebuild it when the platform changes.
      const field = $('#amounts').parentElement;
      field.innerHTML = `<label>Amount</label>${amountBlock(state.draft.slug, 0, null)}`;
      wireAmounts(state.draft.slug, 0, null);
      validate();
    });

    $('#go').addEventListener('click', createAndPay);
  }

  /* ------------------------------------------------------------ payment */

  async function createAndPay() {
    const go = $('#go');
    go.disabled = true;
    go.textContent = 'Setting up…';

    const { slug, url, handle, tagline } = state.draft;
    const id = crypto.randomUUID();

    // Insert without .select(): the RLS SELECT policy hides an unpaid row, so
    // asking for it back would fail even though the insert succeeded.
    const { error } = await sb.from('listings').insert({
      id, platform: slug, url, handle, tagline: tagline || null
    }, { returning: 'minimal' });

    if (error) {
      const duplicate = error.code === '23505' || /duplicate key/i.test(error.message || '');
      if (duplicate) {
        const { data: existing } = await sb.rpc('lookup_listing', { p_platform: slug, p_url: url });
        if (existing) {
          const row = board(slug).find(r => r.id === existing);
          if (row) { addMoneyModal(row); return; }
          goToStripe(existing);           // listed but not on the board yet
          return;
        }
        go.textContent = 'That profile cannot be listed';
        return;
      }
      console.error('insert failed', error);
      go.disabled = false;
      go.textContent = 'Something went wrong — try again';
      return;
    }

    goToStripe(id);
  }

  function goToStripe(listingId) {
    const link = CFG.STRIPE_PAYMENT_LINK;
    if (!link) { alert('Payments are not configured yet.'); return; }
    // The success URL cannot be trusted to carry the id back, so remember it.
    try { localStorage.setItem(LS_LAST, listingId); } catch { /* private mode */ }
    const sep = link.includes('?') ? '&' : '?';
    window.location.href = `${link}${sep}client_reference_id=${encodeURIComponent(listingId)}`;
  }

  /* ------------------------------------------------------------- thanks */

  async function renderThanks() {
    sticky.hidden = true;
    const params = new URLSearchParams(location.search);
    let id = params.get('listing') || '';
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      try { id = localStorage.getItem(LS_LAST) || ''; } catch { id = ''; }
    }

    view.innerHTML = `<div class="shell center-wrap">
      <h2 style="margin:0;letter-spacing:-.02em">Payment received</h2>
      <p style="color:var(--muted)">Putting you on the board…</p>
      <div class="spinner"></div>
    </div>`;
    document.title = 'Thanks — TopTen.one';

    if (!id || !sb) return thanksFallback();

    // The webhook usually lands in a second or two; give it twenty.
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      const { data } = await sb.from('board')
        .select('id,platform,handle,total_cents,rank').eq('id', id).maybeSingle();
      if (data) return thanksSuccess(data);
      await new Promise(r => setTimeout(r, 1500));
    }
    thanksFallback();
  }

  function thanksSuccess(row) {
    const p = BY_SLUG[row.platform];
    const badge = `/badge/?p=${row.platform}&h=${encodeURIComponent(row.handle)}`;
    const shareText = `I'm #${row.rank} on ${p.name} at TopTen.one`;
    view.innerHTML = `<div class="shell center-wrap">
      <span style="color:var(--muted);text-transform:uppercase;letter-spacing:.12em;font-size:12px">You are</span>
      <div class="bigrank">#${row.rank}</div>
      <p style="margin:0;font-size:19px;font-weight:700">${esc(row.handle)} on ${esc(p.name)}</p>
      <p style="color:var(--muted);margin:6px 0 0">${money(row.total_cents)} on the board</p>
      <div class="share">
        <a href="https://x.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent('https://topten.one' + badge)}" target="_blank" rel="noopener">Post on X</a>
        <a href="${badge}" data-link>Get the badge</a>
        <a href="/?p=${row.platform}" data-link>Back to the board</a>
      </div>
    </div>`;
    document.title = `#${row.rank} on ${p.name} — TopTen.one`;
    confetti();
  }

  function thanksFallback() {
    view.innerHTML = `<div class="shell center-wrap">
      <h2 style="letter-spacing:-.02em">Payment received</h2>
      <p style="color:var(--muted);max-width:38ch">
        The board has not caught up yet. It usually takes a few seconds —
        open a board and your listing will be there.
      </p>
      <div class="share"><a href="/" data-link>Back to the boards</a></div>
    </div>`;
  }

  function confetti() {
    const c = $('#confetti');
    if (!c || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    c.hidden = false;
    const ctx = c.getContext('2d');
    const dpr = Math.min(devicePixelRatio || 1, 2);
    c.width = innerWidth * dpr; c.height = innerHeight * dpr;
    c.style.width = innerWidth + 'px'; c.style.height = innerHeight + 'px';
    ctx.scale(dpr, dpr);

    const colors = ['#ffc233', '#ffffff', '#fe2c55', '#9146ff', '#3ddc84'];
    const bits = Array.from({ length: 110 }, () => ({
      x: Math.random() * innerWidth,
      y: -20 - Math.random() * innerHeight * 0.4,
      w: 5 + Math.random() * 6,
      h: 8 + Math.random() * 8,
      vy: 2 + Math.random() * 3.4,
      vx: -1.2 + Math.random() * 2.4,
      rot: Math.random() * Math.PI,
      vr: -0.12 + Math.random() * 0.24,
      color: colors[(Math.random() * colors.length) | 0]
    }));

    const stop = Date.now() + 4200;
    (function frame() {
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      for (const b of bits) {
        b.x += b.vx; b.y += b.vy; b.rot += b.vr;
        ctx.save();
        ctx.translate(b.x, b.y); ctx.rotate(b.rot);
        ctx.fillStyle = b.color;
        ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);
        ctx.restore();
      }
      if (Date.now() < stop) requestAnimationFrame(frame);
      else { ctx.clearRect(0, 0, innerWidth, innerHeight); c.hidden = true; }
    })();
  }

  /* -------------------------------------------------------------- badge */

  function badgeParams() {
    const params = new URLSearchParams(location.search);
    let slug = params.get('p') || '';
    let handle = params.get('h') || '';
    if (!slug || !handle) {
      // /badge/<platform>/<handle> — served through the 404 fallback.
      const parts = location.pathname.split('/').filter(Boolean);
      if (parts[0] === 'badge') { slug = parts[1] || ''; handle = decodeURIComponent(parts[2] || ''); }
    }
    return { slug, handle: handle.startsWith('@') || !handle ? handle : '@' + handle };
  }

  function badgeSvg(rank, handle, platformName, color, amount) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 315" width="600" height="315" role="img" aria-label="#${rank} on ${platformName}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#12141b"/><stop offset="1" stop-color="#07080b"/>
    </linearGradient>
  </defs>
  <rect width="600" height="315" fill="url(#bg)"/>
  <rect x="0" y="0" width="600" height="4" fill="${color}"/>
  <text x="40" y="62" fill="#6b7280" font-family="system-ui,sans-serif" font-size="15" letter-spacing="3">TOPTEN.ONE</text>
  <text x="40" y="176" fill="#ffc233" font-family="ui-monospace,monospace" font-size="112" font-weight="800" letter-spacing="-6">#${rank}</text>
  <text x="40" y="222" fill="#f2f3f5" font-family="system-ui,sans-serif" font-size="27" font-weight="700">${esc(handle)}</text>
  <text x="40" y="252" fill="${color}" font-family="system-ui,sans-serif" font-size="17" font-weight="600">on ${esc(platformName)}</text>
  <text x="40" y="288" fill="#6b7280" font-family="ui-monospace,monospace" font-size="15">${esc(amount)} · Be the one.</text>
</svg>`;
  }

  async function renderBadge() {
    sticky.hidden = true;
    const { slug, handle } = badgeParams();
    const p = BY_SLUG[slug];

    if (!p || !handle) {
      view.innerHTML = `<div class="shell center-wrap"><h2>No badge here</h2>
        <p style="color:var(--muted)">That link is missing a platform or a handle.</p>
        <div class="share"><a href="/" data-link>Back to the boards</a></div></div>`;
      return;
    }

    if (!state.loaded) await loadBoards();
    const idx = board(slug).findIndex(r => r.handle.toLowerCase() === handle.toLowerCase());
    const row = idx >= 0 ? board(slug)[idx] : null;
    const rank = idx >= 0 ? idx + 1 : null;

    document.title = rank ? `#${rank} on ${p.name} — TopTen.one` : `${handle} — TopTen.one`;

    if (!row) {
      view.innerHTML = `<div class="shell center-wrap"><h2>${esc(handle)} is not on the ${esc(p.name)} board</h2>
        <p style="color:var(--muted)">It may have expired, or it was never paid for.</p>
        <div class="share"><a href="/?p=${slug}" data-link>See the board</a></div></div>`;
      return;
    }

    const svg = badgeSvg(rank, row.handle, p.name, p.color, money(row.total_cents));
    const shareText = `${row.handle} is #${rank} on ${p.name} at TopTen.one`;

    view.innerHTML = `<div class="shell badgewrap">
      <div class="badgecard" id="badgecard">${svg}</div>
      <div class="share">
        <button id="dl">Download PNG</button>
        <a href="https://x.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(location.origin + '/badge/?p=' + slug + '&h=' + encodeURIComponent(row.handle))}" target="_blank" rel="noopener">Post on X</a>
        <button id="copy">Copy link</button>
        <a href="/?p=${slug}" data-link>See the board</a>
      </div>
    </div>`;

    $('#dl').addEventListener('click', () => downloadPng(svg, `topten-${slug}-${rank}.png`));
    $('#copy').addEventListener('click', async e => {
      try { await navigator.clipboard.writeText(location.href); e.target.textContent = 'Copied'; }
      catch { e.target.textContent = 'Copy failed'; }
    });
  }

  function downloadPng(svg, filename) {
    const img = new Image();
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = 1200; c.height = 630;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, 1200, 630);
      URL.revokeObjectURL(url);
      c.toBlob(b => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(b);
        a.download = filename;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      }, 'image/png');
    };
    img.onerror = () => alert('Could not render the badge.');
    img.src = url;
  }

  /* ------------------------------------------------------------ routing */

  function route() {
    const path = location.pathname.replace(/\/+$/, '') || '/';
    if (path === '/thanks') return renderThanks();
    if (path === '/badge' || path.startsWith('/badge/')) return renderBadge();

    const p = new URLSearchParams(location.search).get('p');
    if (p && BY_SLUG[p]) state.platform = p;
    renderHome();
  }

  function navigate(href) {
    history.pushState({}, '', href);
    route();
    scrollTo({ top: 0, behavior: 'instant' });
  }

  addEventListener('popstate', route);

  document.addEventListener('click', e => {
    const link = e.target.closest('a[data-link]');
    if (link && link.origin === location.origin) {
      e.preventDefault();
      navigate(link.getAttribute('href'));
      return;
    }
    if (e.target.closest('[data-close]')) { closeModal(); return; }

    const tab = e.target.closest('[data-tab]');
    if (tab) {
      state.platform = tab.dataset.tab;
      history.replaceState({}, '', `/?p=${state.platform}`);
      renderHome();
      return;
    }

    const add = e.target.closest('[data-add]');
    if (add) {
      const row = Object.values(state.boards).flat().find(r => r.id === add.dataset.add);
      if (row) addMoneyModal(row);
      return;
    }

    if (e.target.closest('[data-claim]')) { submitModal(state.platform); return; }
  });

  $('#cta-claim').addEventListener('click', () => submitModal(state.platform));
  $('#foot-contact').addEventListener('click', e => {
    e.preventDefault();
    location.href = `mailto:${CFG.CONTACT_EMAIL || 'hello@topten.one'}`;
  });

  /* ------------------------------------------------------ live plumbing */

  const refresh = debounce(async () => { await loadBoards(); if (!modal.hidden) return; refreshBoard(); }, 450);

  function subscribe() {
    if (!sb) return;
    sb.channel('listings-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'listings' }, refresh)
      .subscribe();

    const presence = sb.channel('who', { config: { presence: { key: crypto.randomUUID() } } });
    presence
      .on('presence', { event: 'sync' }, () => {
        state.online = Object.keys(presence.presenceState()).length || 1;
        const el = document.querySelector('.stat--live .stat__v');
        if (el) el.innerHTML = `<span class="pulse"></span>${state.online}`;
      })
      .subscribe(status => { if (status === 'SUBSCRIBED') presence.track({ at: Date.now() }); });
  }

  function loadAnalytics() {
    const id = CFG.GA_MEASUREMENT_ID;
    if (!id) return;
    const s = document.createElement('script');
    s.async = true;
    s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
    document.head.appendChild(s);
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', id);
  }

  /* --------------------------------------------------------------- boot */

  (async function start() {
    initSupabase();
    loadAnalytics();
    if (sb) await loadBoards();
    route();
    subscribe();
    // Expired listings drop off silently, so re-read on a slow timer too.
    setInterval(() => { if (modal.hidden && document.visibilityState === 'visible') refresh(); }, 60000);
  })();

  // Exposed for the verification checklist.
  window.TopTen = { parseProfile, nextDollarAbove, clampMin, rankFor, money, PLATFORMS, state };
})();

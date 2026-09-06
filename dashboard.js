/* The growth dashboard.
 *
 * Nothing here is trusted with anything. Every figure comes from the `growth`
 * edge function, which runs as the service role behind a Google-only admin
 * gate; this file signs in, asks, and draws. A visitor who reaches this page
 * without an admin session sees a sign-in button and nothing else, because
 * there is nothing else to see until the function answers.
 *
 * The sign-in is written out by hand rather than pulled from a CDN. A script
 * tag pointing at somebody else's server would have to be allowed by the
 * content security policy on this page, and the whole point of that policy is
 * that no page on this site loads code from anywhere but this site.
 */

const CFG = window.TOPTEN_CONFIG || {};
const $ = (s) => document.querySelector(s);

function money(cents) {
  const n = Number(cents || 0) / 100;
  return '$' + n.toLocaleString('en-US', {
    minimumFractionDigits: Math.abs(n % 1) < 0.005 ? 0 : 2, maximumFractionDigits: 2 });
}
const ENT = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ENT[c]);

/* ------------------------------------------------------------ signing in -- */

function token() {
  try { return sessionStorage.getItem('topten_admin') || null; } catch (e) { return null; }
}

/* Supabase hands the tokens back in the fragment, which never reaches a
   server. Read once, kept for the tab, and wiped out of the address bar. */
function catchToken() {
  if (!location.hash.includes('access_token=')) return;
  const p = new URLSearchParams(location.hash.slice(1));
  const t = p.get('access_token');
  if (t) { try { sessionStorage.setItem('topten_admin', t); } catch (e) {} }
  history.replaceState({}, '', location.pathname);
}

function signIn() {
  const back = location.origin + '/dashboard.html';
  location.href = `${CFG.SUPABASE_URL}/auth/v1/authorize?provider=google`
    + `&redirect_to=${encodeURIComponent(back)}`;
}

function signOut() {
  try { sessionStorage.removeItem('topten_admin'); } catch (e) {}
  location.reload();
}

/* --------------------------------------------------------------- the ask -- */

async function report(days) {
  const res = await fetch(`${CFG.SUPABASE_URL}/functions/v1/growth?days=${days}`, {
    headers: { apikey: CFG.SUPABASE_ANON_KEY, Authorization: `Bearer ${token()}` },
  });
  if (res.status === 401) return { unauthorized: true };
  if (!res.ok) throw new Error(`growth ${res.status}`);
  return res.json();
}

/* -------------------------------------------------------------- drawing --- */

function tile(k, v, note) {
  return `<div class="glass tile"><div class="tile__sub">${esc(k)}</div>`
    + `<div class="figure__v num" style="margin-top:6px">${v}</div>`
    + (note ? `<div class="tile__sub" style="margin-top:6px">${esc(note)}</div>` : '')
    + '</div>';
}

function table(title, rows, cols) {
  if (!rows || !rows.length) {
    return `<section class="sect"><h2 class="eyebrow">${esc(title)}</h2>`
      + '<p class="empty">Nothing yet.</p></section>';
  }
  return `<section class="sect"><h2 class="eyebrow">${esc(title)}</h2>`
    + '<div class="glass" style="overflow:hidden;margin-top:14px">'
    + rows.map((r, i) => (i ? '<hr class="hr">' : '') + '<div class="row">'
        + `<div class="row__main"><div class="row__name">${esc(cols.name(r))}</div>`
        + (cols.sub ? `<div class="row__sub num">${esc(cols.sub(r))}</div>` : '') + '</div>'
        + `<div class="row__amt num">${esc(cols.amt(r))}</div></div>`).join('')
    + '</div></section>';
}

function draw(r, days) {
  const el = $('#out');
  const rate = (n) => Number(n).toFixed(2) + '%';
  el.innerHTML = `
<section class="sect">
  <div class="sect__head"><h2 class="eyebrow">The loop</h2>
    <span class="sect__note num">last ${days} days</span></div>
  <div class="grid2" style="margin-top:14px">
    ${tile('Visitors', r.visitors.toLocaleString('en-US'), `${r.pageviews.toLocaleString('en-US')} page views`)}
    ${tile('Returning', r.returning_visitors.toLocaleString('en-US'), 'seen before this window')}
    ${tile('Board views', r.board_views.toLocaleString('en-US'), `${r.searches} searches`)}
    ${tile('Back clicked', r.back_clicks.toLocaleString('en-US'), `${r.checkouts} reached Stripe`)}
    ${tile('Payments', String(r.payments), `${r.payers} distinct payers`)}
    ${tile('Revenue', money(r.revenue_cents), `average ${money(r.avg_payment_cents)}`)}
  </div>
</section>

<section class="sect">
  <h2 class="eyebrow">What decides whether to scale</h2>
  <div class="grid2" style="margin-top:14px">
    ${tile('Revenue per 1,000 visitors', money(r.revenue_per_1k_cents), 'the number to beat')}
    ${tile('Payment rate', rate(r.payment_rate), 'of visitors who paid')}
    ${tile('Checkout completion', rate(r.checkout_rate), 'reached Stripe and finished')}
    ${tile('Back → checkout', rate(r.back_to_checkout), 'clicked Back and got there')}
    ${tile('Shares', String(r.shares), 'share or copy pressed')}
    ${tile('Paid twice', String(r.repeat_payers), 'people who came back and paid again')}
  </div>
  <p class="fine">Where it breaks tells you what to fix. No visitors: the post.
    Visitors but no board views: the front page. Board views but no Back: the ranking is
    not worth moving. Back but no checkout: the amount or the trust. Checkout but no
    payment: Stripe. Payments but no shares: the moment after paying. Payments but
    nobody twice: there was no reason to return.</p>
</section>

${table('Revenue by source', r.top_sources, {
  name: (x) => x.source, sub: (x) => `${x.visitors} visitors · ${x.payments} payments`,
  amt: (x) => money(x.cents) })}

${table('Revenue by campaign', r.top_campaigns, {
  name: (x) => x.campaign, sub: (x) => `${x.visitors} visitors · ${x.payments} payments`,
  amt: (x) => money(x.cents) })}

${table('Revenue by ranking', r.top_boards, {
  name: (x) => x.board, sub: (x) => `${x.payments} payments`, amt: (x) => money(x.cents) })}

${table('Revenue by listing', r.top_listings, {
  name: (x) => x.handle, sub: (x) => x.board, amt: (x) => money(x.cents) })}

${table('Most viewed rankings', r.most_viewed_boards, {
  name: (x) => x.board, amt: (x) => String(x.views) })}

${table('Where they were', r.top_countries, {
  name: (x) => x.country, amt: (x) => String(x.visitors) })}
`;
}

/* ----------------------------------------------------------------- boot --- */

async function boot() {
  catchToken();
  const gate = $('#gate');
  const out = $('#out');

  if (!token()) {
    gate.innerHTML = '<p class="lede">This page is for whoever runs the site.</p>'
      + '<button type="button" class="cta" id="in" style="margin-top:20px">Sign in with Google</button>';
    $('#in').addEventListener('click', signIn);
    return;
  }

  gate.innerHTML = '<div class="amounts" id="windows">'
    + [1, 7, 30, 90].map((d) =>
        `<button type="button" class="chip num" data-days="${d}">${d}d</button>`).join('')
    + '</div>';

  let days = 7;
  async function show() {
    out.innerHTML = '<p class="skeleton">Reading…</p>';
    document.querySelectorAll('#windows .chip').forEach((c) =>
      c.classList.toggle('chip--on', Number(c.dataset.days) === days));
    try {
      const r = await report(days);
      if (r.unauthorized) {
        gate.innerHTML = '<p class="lede">That account cannot open this page.</p>'
          + '<button type="button" class="ghost" id="outb" style="margin-top:16px">Sign out</button>';
        $('#outb').addEventListener('click', signOut);
        out.innerHTML = '';
        return;
      }
      draw(r.report, r.days);
    } catch (e) {
      out.innerHTML = '<p class="empty">The report could not be built. Try again.</p>';
    }
  }
  document.querySelectorAll('#windows .chip').forEach((c) =>
    c.addEventListener('click', () => { days = Number(c.dataset.days); show(); }));
  show();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

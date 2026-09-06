/* TopTen.one — one position, one king.
 *
 * The whole site is this file, one page and two Edge Functions. What it does:
 *
 *   - reads the three public views (king, attempts_on_king, former_kings) and
 *     draws them;
 *   - keeps them current, first from Realtime and second from a slow poll,
 *     because a live socket that quietly fails looks exactly like a site where
 *     nobody is paying;
 *   - runs the claim: a browser coming back from Stripe with a session id asks
 *     the `claim` function what that payment bought, and either fills in the
 *     card it just won or is told what it would have taken.
 *
 * It never writes to the database. The anon key cannot: there is no insert or
 * update policy on either table, and the two columns that matter -- the edit
 * token and the Stripe session id -- are not readable with it at all. Money
 * moves in the webhook, the card is written by the `claim` function, and this
 * file only ever reads and asks.
 */
(function () {
  'use strict';

  var CFG = window.TOPTEN_CONFIG || {};
  var sb = null;

  /* Where a browser keeps the key to its own card. One object, keyed by reign
     id, so somebody who has held the page twice keeps both -- and so a former
     king can still fix a typo in a row that is now history. */
  var LS_TOKENS = 'topten_tokens';

  /* How long the page waits for the webhook after a checkout. Stripe usually
     calls within a second or two; a card that needs a bank redirect can take
     longer, and past this the page says so rather than spinning forever. */
  var CLAIM_TIMEOUT_MS = 45000;
  var CLAIM_POLL_MS = 2000;

  /* The safety net under Realtime. A socket blocked by a network, a policy or
     a proxy fails silently, and the only symptom is a page whose figures never
     move -- which is indistinguishable from a quiet day. */
  var POLL_MS = 25000;

  var PAGE = 50;   // former kings per page, as specified

  var $ = function (s, r) { return (r || document).querySelector(s); };

  /* ------------------------------------------------------------ formatting */

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* Currencies Stripe reports without a minor unit: their amount must not be
     divided by a hundred before a human reads it. */
  var ZERO_DECIMAL = ['bif', 'clp', 'djf', 'gnf', 'jpy', 'kmf', 'krw', 'mga',
    'pyg', 'rwf', 'ugx', 'vnd', 'vuv', 'xaf', 'xof', 'xpf'];

  function money(cents, currency) {
    var cur = String(currency || 'usd').toLowerCase();
    var v = ZERO_DECIMAL.indexOf(cur) >= 0 ? Number(cents) : Number(cents) / 100;
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency', currency: cur.toUpperCase(),
        minimumFractionDigits: 0, maximumFractionDigits: 2
      }).format(v);
    } catch (e) {
      return v + ' ' + cur.toUpperCase();
    }
  }

  /* "reigning for Xd Xh" — and below a day, hours and minutes, because "0d 4h"
     is a worse way of saying four hours. */
  function duration(seconds) {
    var s = Math.max(0, Math.floor(seconds));
    var d = Math.floor(s / 86400);
    var h = Math.floor((s % 86400) / 3600);
    var m = Math.floor((s % 3600) / 60);
    /* A zero component is dropped rather than printed: "2h 0m ago" is a worse
       way of saying two hours, and "1d 0h" is a worse way of saying a day. */
    if (d) return h ? d + 'd ' + h + 'h' : d + 'd';
    if (h) return m ? h + 'h ' + m + 'm' : h + 'h';
    if (m) return m + 'm';
    return 'just now';
  }

  function ago(iso) {
    var s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 60) return 'just now';
    return duration(s) + ' ago';
  }

  function nameOf(row) {
    /* The webhook stores what Stripe collected, or nothing. The word for
       nothing is chosen here, once, rather than written into the database as
       if somebody had typed it. */
    return (row && row.name) ? row.name : 'Anonymous';
  }

  /* ------------------------------------------------------------- the token */

  function tokens() {
    try { return JSON.parse(localStorage.getItem(LS_TOKENS) || '{}') || {}; }
    catch (e) { return {}; }
  }

  function rememberToken(reignId, token) {
    if (!reignId || !token) return;
    try {
      var all = tokens();
      all[reignId] = token;
      localStorage.setItem(LS_TOKENS, JSON.stringify(all));
    } catch (e) { /* private mode: the card is still theirs, just not from here */ }
  }

  function tokenFor(reignId) { return tokens()[reignId] || ''; }

  /* --------------------------------------------------------------- reading */

  function view(name, query) {
    var url = CFG.SUPABASE_URL + '/rest/v1/' + name + (query ? '?' + query : '');
    return fetch(url, {
      headers: {
        apikey: CFG.SUPABASE_ANON_KEY,
        authorization: 'Bearer ' + CFG.SUPABASE_ANON_KEY
      }
    }).then(function (r) {
      if (!r.ok) throw new Error(name + ': HTTP ' + r.status);
      return r.json();
    });
  }

  function callClaim(body) {
    return fetch(CFG.SUPABASE_URL + '/functions/v1/claim', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: CFG.SUPABASE_ANON_KEY,
        authorization: 'Bearer ' + CFG.SUPABASE_ANON_KEY
      },
      body: JSON.stringify(body)
    }).then(function (r) {
      return r.json().then(function (j) { return { status: r.status, body: j }; });
    });
  }

  /* ------------------------------------------------------------- the state */

  var state = { king: null, attempts: [], former: [], formerShown: PAGE, formerTotal: 0 };

  function load() {
    return Promise.all([
      view('king', 'select=id,amount_cents,currency,name,url,message,crowned_at&limit=1'),
      view('attempts_on_king', 'select=id,amount_cents,currency,name,created_at&order=created_at.desc&limit=50'),
      view('former_kings',
        'select=id,amount_cents,currency,name,url,message,crowned_at,dethroned_at,reigned_seconds'
        + '&order=dethroned_at.desc&limit=' + state.formerShown)
    ]).then(function (r) {
      state.king = r[0][0] || null;
      state.attempts = r[1] || [];
      state.former = r[2] || [];
      draw();
    }).catch(function (e) {
      /* The page already carries a king, written in at build time. Leaving it
         on the screen is better than replacing it with an apology: it is the
         same person, with figures that are minutes rather than seconds old. */
      console.error(e);
    });
  }

  /* ---------------------------------------------------------- the drawing */

  var CROWN = '<svg class="king__crown" viewBox="0 0 38 28" aria-hidden="true">'
    + '<path fill="currentColor" d="M2 8l7 6 10-12 10 12 7-6-4 18H6z"/></svg>';

  function drawKing() {
    var el = $('#king-card');
    if (!el) return;
    var k = state.king;

    /* The card reads as one sentence: a name, and what that name is. The
       kicker that used to sit above the name said "Current king", which is
       the same claim made twice once the line below says it in words. */
    if (!k) {
      el.className = 'king king--empty';
      el.innerHTML = CROWN
        + '<h1 class="king__name">Nobody</h1>'
        + '<p class="king__is">is King of the Hill</p>'
        + '<p class="king__message">The first payment takes the page.</p>';
      return;
    }

    el.className = 'king';
    var link = k.url
      ? '<a class="king__link" href="' + esc(k.url) + '" target="_blank" rel="noopener nofollow ugc">'
        + esc(String(k.url).replace(/^https?:\/\//, '').replace(/\/$/, '')) + '</a>'
      : '';
    var mine = tokenFor(k.id);

    el.innerHTML = CROWN
      + '<h1 class="king__name">' + esc(nameOf(k)) + '</h1>'
      + '<p class="king__is">is King of the Hill</p>'
      + (k.message ? '<p class="king__message">' + esc(k.message) + '</p>' : '')
      + link
      + '<div class="king__figures">'
      +   '<span class="figure"><span class="figure__v figure__v--gold">'
      +     esc(money(k.amount_cents, k.currency)) + '</span>'
      +     '<span class="figure__k">Paid</span></span>'
      +   '<span class="figure"><span class="figure__v" id="reign-clock">'
      +     esc(duration((Date.now() - new Date(k.crowned_at).getTime()) / 1000)) + '</span>'
      +     '<span class="figure__k">Reigning for</span></span>'
      + '</div>'
      + (mine ? '<p style="margin:16px 0 0"><a class="btn btn--ghost btn--small" href="/claim?edit='
          + esc(k.id) + '">Edit your card</a></p>' : '');
  }

  /* The clock is redrawn on its own so the rest of the card is not rebuilt
     every minute -- rebuilding it would drop a text selection and close a
     link somebody was about to open. */
  function tickClock() {
    var el = $('#reign-clock');
    if (!el || !state.king) return;
    el.textContent = duration((Date.now() - new Date(state.king.crowned_at).getTime()) / 1000);
  }

  function drawCta() {
    var el = $('#cta-terms');
    if (!el) return;
    var k = state.king;
    el.innerHTML = k
      ? 'Pay more than <b>' + esc(money(k.amount_cents, k.currency))
        + '</b> to take the page. Pay less and you only get listed as an attempt. No refunds.'
      : 'Any payment takes the page while nobody holds it. Pay less than the king and you only '
        + 'get listed as an attempt. No refunds.';

    var btn = $('#dethrone');
    if (btn) {
      if (CFG.STRIPE_PAYMENT_LINK) {
        btn.href = CFG.STRIPE_PAYMENT_LINK;
        btn.removeAttribute('aria-disabled');
        btn.textContent = k ? 'Dethrone them' : 'Take the page';
      } else {
        btn.removeAttribute('href');
        btn.setAttribute('aria-disabled', 'true');
        btn.textContent = 'Payments are not configured';
      }
    }
  }

  function drawAttempts() {
    var el = $('#attempts');
    if (!el) return;
    if (!state.attempts.length) {
      el.innerHTML = '<p class="empty">Nobody has tried yet.</p>';
      return;
    }
    el.innerHTML = '<ul class="rows">' + state.attempts.map(function (a) {
      return '<li class="row"><span class="row__n">' + esc(nameOf(a)) + '</span>'
        + '<span class="row__a">' + esc(money(a.amount_cents, a.currency)) + '</span>'
        + '<span class="row__t">' + esc(ago(a.created_at)) + '</span></li>';
    }).join('') + '</ul>';
  }

  function drawFormer() {
    var el = $('#history');
    if (!el) return;
    if (!state.former.length) {
      el.innerHTML = '<p class="empty">Nobody has been dethroned yet.</p>';
      return;
    }
    var rows = state.former.map(function (r) {
      return '<li class="row"><span class="row__n">' + esc(nameOf(r)) + '</span>'
        + '<span class="row__a">' + esc(money(r.amount_cents, r.currency)) + '</span>'
        + '<span class="row__t">' + esc(duration(r.reigned_seconds)) + '</span></li>';
    }).join('');
    /* One more page is offered whenever the last request came back full: a
       count would be a second round trip to tell somebody something the next
       click tells them anyway. */
    var more = state.former.length >= state.formerShown
      ? '<p class="more"><button class="btn btn--ghost btn--small" id="more">Show 50 more</button></p>'
      : '';
    el.innerHTML = '<ul class="rows">' + rows + '</ul>' + more;
    var b = $('#more');
    if (b) {
      b.addEventListener('click', function () {
        b.disabled = true;
        state.formerShown += PAGE;
        load();
      });
    }
  }

  function draw() {
    drawKing();
    drawCta();
    drawAttempts();
    drawFormer();
    document.title = state.king
      ? 'Current king: ' + nameOf(state.king) + ' — ' + money(state.king.amount_cents, state.king.currency)
        + ' — King of the Hill'
      : 'The throne is empty — King of the Hill';
  }

  /* ------------------------------------------------------------- the claim */

  function claimView(html) {
    var v = $('#view');
    if (v) v.innerHTML = '<div class="shell"><div class="panel">' + html + '</div></div>';
  }

  /* Whichever list the reign is in. A dethroned king may still edit the row
     they left behind, and handing them an empty form would mean their own
     save wiped the words they wrote. */
  function reignById(id) {
    if (state.king && state.king.id === id) return state.king;
    for (var i = 0; i < state.former.length; i++) {
      if (state.former[i].id === id) return state.former[i];
    }
    return null;
  }

  function backLink() {
    return '<p style="margin-top:18px"><a href="/">Back to the page</a></p>';
  }

  function renderClaim(sessionId, editId) {
    /* An "edit your card" click has no session id: this browser already holds
       the token and only wants the form back. */
    if (!sessionId && editId) {
      var t = tokenFor(editId);
      if (!t) {
        claimView('<h1>Nothing to edit here</h1><p>This browser does not hold the key to that card.</p>'
          + backLink());
        return;
      }
      editForm(t, reignById(editId));
      return;
    }

    claimView('<h1>Payment received</h1><p>Finding out what it bought…</p><div class="spinner"></div>');

    var deadline = Date.now() + CLAIM_TIMEOUT_MS;

    function ask() {
      callClaim({ action: 'status', session_id: sessionId }).then(function (r) {
        var b = r.body || {};

        if (r.status >= 400 && !b.outcome) {
          claimView('<h1>That link is not one of ours</h1>'
            + '<p>The address should carry the session id Stripe put on it after checkout.</p>'
            + backLink());
          return;
        }

        if (b.outcome === 'crowned') {
          if (b.edit_token) rememberToken(b.reign && b.reign.id, b.edit_token);
          var token = b.edit_token || tokenFor(b.reign && b.reign.id);
          /* The receipt has been spent. Taking it out of the address bar means
             a screenshot of this page, or a shared link, is no longer the key
             to somebody else's card. */
          try { history.replaceState(null, '', '/claim'); } catch (e) { /* ignore */ }
          if (token) return editForm(token, b.reign);
          return claimView('<h1>You are the king</h1>'
            + '<p>The card was already claimed by another browser, and the key was handed over '
            + 'once. If that was not you, write to '
            + '<a href="mailto:' + esc(CFG.CONTACT_EMAIL || '') + '">'
            + esc(CFG.CONTACT_EMAIL || 'us') + '</a>.</p>' + backLink());
        }

        if (b.outcome === 'attempt') {
          var paid = money(b.amount_cents, b.currency);
          var needed = money(b.needed_cents, b.currency);
          return claimView('<h1>The king survived</h1>'
            + '<p>You paid <b>' + esc(paid) + '</b>; you needed more than '
            + '<b>' + esc(money(b.king_amount_cents != null ? b.king_amount_cents : b.needed_cents - 1, b.currency))
            + '</b>. Your attempt is on the page under '
            + esc(b.king_name || 'the king') + '.</p>'
            + '<p>Taking the seat now costs ' + esc(needed) + ' or more. No refunds — that is '
            + 'the rule everybody who has ever paid here played by.</p>'
            + '<p><a class="btn" id="dethrone-again" href="'
            + esc(CFG.STRIPE_PAYMENT_LINK || '#') + '">Dethrone them</a></p>'
            + backLink());
        }

        if (Date.now() < deadline) return setTimeout(ask, CLAIM_POLL_MS);

        claimView('<h1>Payment received</h1>'
          + '<p>Stripe has not told us about it yet. Nothing is lost — the moment it does, '
          + 'the page updates by itself. Open this link again in a minute.</p>' + backLink());
      }).catch(function (e) {
        console.error(e);
        if (Date.now() < deadline) return setTimeout(ask, CLAIM_POLL_MS);
        claimView('<h1>Payment received</h1><p>We could not reach the site to confirm what it '
          + 'bought. Try this link again in a minute.</p>' + backLink());
      });
    }

    ask();
  }

  function editForm(token, reign) {
    var r = reign || {};
    claimView('<h1>The page is yours</h1>'
      + '<p>Write what everybody sees. You can come back and change it from this browser.</p>'
      + '<div class="field"><label for="f-name">Name</label>'
      +   '<input id="f-name" maxlength="40" value="' + esc(r.name || '') + '" placeholder="Anonymous">'
      +   '<small>Up to 40 characters.</small></div>'
      + '<div class="field"><label for="f-message">Message</label>'
      +   '<input id="f-message" maxlength="100" value="' + esc(r.message || '') + '" placeholder="Say something.">'
      +   '<small>Up to 100 characters.</small></div>'
      + '<div class="field"><label for="f-url">Link</label>'
      +   '<input id="f-url" maxlength="300" value="' + esc(r.url || '') + '" placeholder="https://">'
      +   '<small>Optional. http or https only.</small></div>'
      + '<p><button class="btn" id="f-save">Save</button></p>'
      + '<div id="f-out"></div>'
      + '<p class="note">The key to this card lives in this browser only. Clear the site data '
      + 'and you lose the ability to edit it — the reign itself is untouched.</p>'
      + backLink());

    var btn = $('#f-save');
    btn.addEventListener('click', function () {
      btn.disabled = true;
      $('#f-out').innerHTML = '';
      callClaim({
        action: 'save',
        edit_token: token,
        name: $('#f-name').value,
        message: $('#f-message').value,
        url: $('#f-url').value
      }).then(function (res) {
        btn.disabled = false;
        var b = res.body || {};
        if (b.ok) {
          if (b.reign) rememberToken(b.reign.id, token);
          $('#f-out').innerHTML = '<p class="note">Saved. It is on the page now.</p>';
          load();
          return;
        }
        var why = b.reason === 'bad_url' || b.error === 'bad_url'
          ? 'That link is not an http or https address.'
          : (b.reason === 'unknown_token' || b.error === 'bad_token')
            ? 'This browser’s key does not open that card any more.'
            : 'It did not save. Try again in a moment.';
        $('#f-out').innerHTML = '<p class="note note--bad">' + esc(why) + '</p>';
      }).catch(function (e) {
        console.error(e);
        btn.disabled = false;
        $('#f-out').innerHTML = '<p class="note note--bad">Could not reach the site. Try again.</p>';
      });
    });
  }

  /* ------------------------------------------------------------ live-ness */

  function listen() {
    if (!sb) return;
    /* Both tables, every event. The payload is deliberately not read: what
       changed is the whole database's answer to three questions, and asking
       them again costs one request and cannot drift out of step with itself. */
    sb.channel('throne')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reigns' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'attempts' }, load)
      .subscribe();
  }

  /* --------------------------------------------------------------- startup */

  function analytics() {
    var id = CFG.GA_MEASUREMENT_ID;
    if (!id) return;
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(id);
    document.head.appendChild(s);
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', id);
  }

  function start() {
    analytics();

    if (window.supabase && CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY) {
      sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
        auth: { persistSession: false }
      });
    }

    var params = new URLSearchParams(location.search);
    var sessionId = params.get('session_id') || '';
    var editId = params.get('edit') || '';

    /* The success URL is Stripe's to set, and it may point anywhere on this
       site. A session id in the query is what says "this browser has just
       paid", whatever path it arrives on. */
    if (sessionId || editId) {
      /* The lists are loaded underneath so an edit form opened from the card
         has the reign's current words to prefill from. */
      load().then(function () { renderClaim(sessionId, editId); });
      return;
    }

    if (location.pathname.replace(/\/$/, '') === '/claim') {
      claimView('<h1>Nothing to claim</h1>'
        + '<p>This address is where Stripe sends you after a payment.</p>' + backLink());
      return;
    }

    load();
    listen();

    setInterval(load, POLL_MS);
    setInterval(tickClock, 30000);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) load();
    });

    var contact = $('#foot-contact');
    if (contact && CFG.CONTACT_EMAIL) contact.href = 'mailto:' + CFG.CONTACT_EMAIL;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  /* For poking at the logic from the console, which is how most of the
     formatting above was checked. */
  window.TopTen = { money: money, duration: duration, ago: ago, state: state, load: load };
})();

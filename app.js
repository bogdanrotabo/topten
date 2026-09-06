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

  /* ------------------------------------------------------------ the receipt */

  /* Minted here, spent at /claim.

     A payer coming back from Stripe has to be able to say which payment was
     theirs, and what they carry is decided by the Payment Link's success URL.
     If it carries {CHECKOUT_SESSION_ID} they arrive with Stripe's own id and
     none of this is needed. The URL configured on the live link instead
     carries {CHECKOUT_SESSION_CLIENT_REFERENCE_ID}, which is filled in with
     whatever client_reference_id the checkout was opened with -- so the page
     mints one and passes it, and the link needs no change at all.

     A uuid, which is 122 bits of randomness: unguessable, and worth nothing to
     anybody but the browser that made it. */
  function mintRef() {
    try {
      if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    } catch (e) { /* not a secure context */ }
    /* Same shape, from getRandomValues, for a browser without randomUUID. */
    var b = new Uint8Array(16);
    (window.crypto && crypto.getRandomValues)
      ? crypto.getRandomValues(b)
      : b.forEach(function (_, i) { b[i] = Math.floor(Math.random() * 256); });
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    var h = [].map.call(b, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-'
         + h.slice(16, 20) + '-' + h.slice(20);
  }

  /* Where the Dethrone button actually goes. A fresh receipt each time: two
     tabs opened from this browser are two payments, and each has to be able to
     say which one it was. */
  function payLink() {
    var link = CFG.STRIPE_PAYMENT_LINK;
    if (!link) return '';
    return link + (link.indexOf('?') >= 0 ? '&' : '?')
      + 'client_reference_id=' + encodeURIComponent(mintRef());
  }

  /* The receipt on the way back, under whichever name the success URL used.
     `listing` is the name the live link has carried since before the pivot.

     Only ever out of the address bar. Keeping a copy in localStorage and
     falling back to it was worse than having nothing: the ref is minted when
     somebody clicks the button, not when they pay, so the copy proves a click
     and no more -- and it would answer a bare visit to /claim by somebody who
     abandoned checkout with "Payment received", spinning for forty-five
     seconds over a payment that never happened. */
  function receipt(params) {
    return {
      session_id: params.get('session_id') || '',
      claim_ref: params.get('listing') || params.get('ref') || params.get('claim_ref') || ''
    };
  }

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
      view('king', 'select=id,amount_cents,currency,name,url,message,logo,crowned_at&limit=1'),
      view('attempts_on_king', 'select=id,amount_cents,currency,name,message,url,created_at&order=created_at.desc&limit=50'),
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

  /* The marks the site will draw, and the whole of them.
   *
   * reigns.logo holds a slug, not a url. A payer-supplied image address would
   * mean widening img-src past 'self' to the whole web and moderating pictures
   * instead of a hundred characters of text; a slug that matches nothing here
   * simply draws nothing. Set from the dashboard, for a brand whose mark we
   * have agreed to carry -- never from the claim form.
   *
   * Each mark is its owner's own colours. Recolouring somebody's logo to match
   * a theme is not a theme, it is a different logo. */
  var MARKS = {
    'gift.ceo': '<svg class="king__mark" viewBox="0 0 64 64" width="46" height="46" aria-hidden="true"><rect x=".75" y=".75" width="62.5" height="62.5" rx="14" fill="#1c1b19" stroke="#4a4740" stroke-width="1.5"/><text x="30" y="45" font-family="Helvetica,Arial,sans-serif" font-size="38" font-weight="700" fill="#faf9f7" text-anchor="middle">g</text><circle cx="47" cy="42" r="5" fill="#d9a63c"/></svg>',
    'rotabo.app': '<svg class="king__mark" viewBox="0 0 430 260" width="60" height="36" aria-hidden="true"><defs><radialGradient id="ktRotabo" cx="50%" cy="50%" r="75%"><stop offset="0%" stop-color="#c264e0"/><stop offset="45%" stop-color="#a239c9"/><stop offset="100%" stop-color="#7c2596"/></radialGradient></defs><path fill="url(#ktRotabo)" d="M118.15,28.88 Q100,5 81.85,28.88 L23.15,106.12 Q5,130 23.15,153.88 L81.85,231.12 Q100,255 118.15,231.12 L176.85,153.88 Q195,130 176.85,106.12 Z"/><path fill="#ffd41a" transform="translate(230,0)" d="M118.15,28.88 Q100,5 81.85,28.88 L23.15,106.12 Q5,130 23.15,153.88 L81.85,231.12 Q100,255 118.15,231.12 L176.85,153.88 Q195,130 176.85,106.12 Z"/></svg>'
  };

  function markFor(slug) {
    return (slug && Object.prototype.hasOwnProperty.call(MARKS, slug)) ? MARKS[slug] : '';
  }


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
        + '<p class="king__is"><span>is</span>King of the Hill</p>'
        + '<p class="king__message">The first payment takes the page.</p>';
      return;
    }

    el.className = 'king';
    /* A king with a mark shows it where the crown goes. Both at once is two
       badges stacked saying the same thing; the sentence under the name is
       what says "throne" in words anyway. */
    var top = markFor(k.logo) || CROWN;
    var link = k.url
      ? '<a class="king__link" href="' + esc(k.url) + '" target="_blank" rel="noopener nofollow ugc">'
        + esc(String(k.url).replace(/^https?:\/\//, '').replace(/\/$/, '')) + '</a>'
      : '';
    var mine = tokenFor(k.id);

    el.innerHTML = top
      + '<h1 class="king__name">' + esc(nameOf(k)) + '</h1>'
      + '<p class="king__is"><span>is</span>King of the Hill</p>'
      + (k.message ? '<p class="king__message">' + esc(k.message) + '</p>' : '')
      + link
      + '<div class="king__figures">'
      +   '<span class="figure"><span class="figure__v figure__v--royal">'
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
        /* The href is set at click rather than now, so the receipt is minted
           when somebody actually goes. Prerendered, this button is the plain
           Payment Link and works with no JavaScript at all -- that payment
           counts, its payer simply has no receipt to claim their card with. */
        btn.href = CFG.STRIPE_PAYMENT_LINK;
        btn.removeAttribute('aria-disabled');
        btn.textContent = k ? 'Dethrone them' : 'Take the page';
        btn.onclick = function () { btn.href = payLink() || btn.href; };
      } else {
        btn.removeAttribute('href');
        btn.setAttribute('aria-disabled', 'true');
        btn.textContent = 'Payments are not configured';
      }
    }
  }

  /* One box per person who paid. The foot only exists when there is something
     to put in it, so a card with no link and no words is three lines rather
     than three lines and two empty ones. */
  function card(r, when) {
    var link = r.url
      ? '<a class="card__l" href="' + esc(r.url) + '" target="_blank" rel="noopener nofollow ugc">'
        + esc(String(r.url).replace(/^https?:\/\//, '').replace(/\/$/, '')) + '</a>'
      : '';
    return '<li class="card">'
      + '<div class="card__top"><span class="card__n">' + esc(nameOf(r)) + '</span>'
      +   '<span class="card__a">' + esc(money(r.amount_cents, r.currency)) + '</span></div>'
      + (r.message ? '<p class="card__m">' + esc(r.message) + '</p>' : '')
      + '<div class="card__foot">' + link
      +   '<span class="card__t">' + esc(when) + '</span></div>'
      + '</li>';
  }

  function drawAttempts() {
    var el = $('#attempts');
    if (!el) return;
    if (!state.attempts.length) {
      el.innerHTML = '<p class="empty">Nobody has tried yet.</p>';
      return;
    }
    el.innerHTML = '<ul class="rows">' + state.attempts.map(function (a) {
      return card(a, ago(a.created_at));
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
      return card(r, 'reigned ' + duration(r.reigned_seconds));
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

  /* --------------------------------------------------------- the ticker */

  /* The state of the page, on one line, moving. Built from what is loaded
     rather than written down: who holds it, what it cost, what it would take,
     then everybody who has tried and everybody who held it before.

     The track is printed twice and the animation moves it by exactly half its
     width, so the second copy is under the cursor at the moment the first
     runs out. One copy and it jumps. */
  function drawTicker() {
    var el = $('#ticker');
    if (!el) return;
    var k = state.king;
    var bits = [];

    if (k) {
      /* The title is gold here for the same reason it is gold on the card and
         in the masthead: it is the same three words naming the same thing,
         and a page that paints them differently in three places is three
         pages. */
      bits.push('<b>' + esc(nameOf(k)) + '</b> is <i>King of the Hill</i>');
      bits.push('paid <i>' + esc(money(k.amount_cents, k.currency)) + '</i>');
      bits.push('take it for more than <i>' + esc(money(k.amount_cents, k.currency)) + '</i>');
      bits.push('reigning for <b>'
        + esc(duration((Date.now() - new Date(k.crowned_at).getTime()) / 1000)) + '</b>');
    } else {
      bits.push('<i>King of the Hill</i> — the throne is empty');
      bits.push('the first payment takes the page');
    }

    state.attempts.slice(0, 8).forEach(function (a) {
      bits.push('<b>' + esc(nameOf(a)) + '</b> tried with <i>'
        + esc(money(a.amount_cents, a.currency)) + '</i>');
    });
    state.former.slice(0, 8).forEach(function (r) {
      bits.push('<b>' + esc(nameOf(r)) + '</b> held it '
        + esc(duration(r.reigned_seconds)) + ' for <i>'
        + esc(money(r.amount_cents, r.currency)) + '</i>');
    });

    bits.push('no accounts');
    bits.push('no expiry');
    bits.push('no refunds');

    var once = bits.map(function (b) { return '<span class="ticker__i">' + b + '</span>'; }).join('');
    el.innerHTML = '<div class="ticker__track">' + once + once + '</div>';
  }

  function draw() {
    drawTicker();
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

  function renderClaim(rec, editId) {
    /* An "edit your card" click has no session id: this browser already holds
       the token and only wants the form back. */
    /* An "edit your card" click is not a payment coming back, so it is
       answered first and on its own. Deciding it by "is there a receipt?"
       let the fallback receipt in localStorage -- minted by any earlier
       visit to a pay button -- shadow the id that was actually asked for,
       and the form never opened. */
    if (editId) {
      var t = tokenFor(editId);
      if (!t) {
        claimView('<h1>Nothing to edit here</h1><p>This browser does not hold the key to that card.</p>'
          + backLink());
        return;
      }
      editForm(t, reignById(editId), null);
      return;
    }

    claimView('<h1>Payment received</h1><p>Finding out what it bought…</p><div class="spinner"></div>');

    var deadline = Date.now() + CLAIM_TIMEOUT_MS;

    function ask() {
      callClaim({ action: 'status', session_id: rec.session_id, claim_ref: rec.claim_ref })
        .then(function (r) {
        var b = r.body || {};

        if (r.status >= 400 && !b.outcome) {
          claimView('<h1>That link is not one of ours</h1>'
            + '<p>The address should carry the receipt Stripe put on it after checkout.</p>'
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
          if (token) return editForm(token, b.reign, null);
          return claimView('<h1>You are the king</h1>'
            + '<p>The card was already claimed by another browser, and the key was handed over '
            + 'once. If that was not you, write to '
            + '<a href="mailto:' + esc(CFG.CONTACT_EMAIL || '') + '">'
            + esc(CFG.CONTACT_EMAIL || 'us') + '</a>.</p>' + backLink());
        }

        if (b.outcome === 'attempt') {
          if (b.edit_token) rememberToken(b.attempt && b.attempt.id, b.edit_token);
          var token = b.edit_token || tokenFor(b.attempt && b.attempt.id);
          try { history.replaceState(null, '', '/claim'); } catch (e) { /* ignore */ }
          /* Losing does not mean losing the card. They paid the same way the
             king did, their box is on the page under him, and they get the
             same hundred characters to put in it. */
          if (token) return editForm(token, b.attempt, b);
          return attemptView(b, '');
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

  /* What an attempt is told, with or without a form under it. */
  function attemptView(b, form) {
    var paid = money(b.amount_cents, b.currency);
    var needed = money(b.needed_cents, b.currency);
    var beat = money(b.king_amount_cents != null ? b.king_amount_cents : b.needed_cents - 1, b.currency);
    return '<h1>The king survived</h1>'
      + '<p>You paid <b>' + esc(paid) + '</b>; you needed more than <b>' + esc(beat)
      + '</b>. Your card is on the page under ' + esc(b.king_name || 'the king') + '.</p>'
      + form
      + '<p>Taking the seat costs ' + esc(needed) + ' or more. No refunds — that is the rule '
      + 'everybody who has ever paid here played by.</p>'
      + '<p><a class="btn" href="' + esc(payLink() || '#') + '">Dethrone them</a></p>'
      + backLink();
  }

  function editForm(token, reign, attempt) {
    var r = reign || {};
    var head = attempt
      ? '<h1>The king survived</h1>'
        + '<p>You paid <b>' + esc(money(attempt.amount_cents, attempt.currency)) + '</b>; you needed more '
        + 'than <b>' + esc(money(attempt.king_amount_cents != null
            ? attempt.king_amount_cents : attempt.needed_cents - 1, attempt.currency))
        + '</b>. Your card is on the page under ' + esc(attempt.king_name || 'the king')
        + ' — write what it says.</p>'
      : '<h1>The page is yours</h1>'
        + '<p>Write what everybody sees. You can come back and change it from this browser.</p>';
    claimView(head
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
      + 'and you lose the ability to edit it — what you paid for is untouched.</p>'
      + (attempt
          ? '<p style="margin-top:18px"><a class="btn" href="' + esc(payLink() || '#')
            + '">Dethrone them</a></p>'
          : '')
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
    var editId = params.get('edit') || '';
    var path = location.pathname.replace(/\/$/, '');
    /* The two paths a Payment Link can land on: the one the success URL uses
       today and the one it should use. Either works, under either receipt. */
    var onClaimPath = path === '/claim' || path === '/thanks';

    /* The lists load underneath every one of these, so a form has the reign's
       current words to prefill from. */

    /* 1. An explicit edit. Not a payment coming back; it needs no receipt and
          must not be answered with one. */
    if (editId) {
      load().then(function () { renderClaim(null, editId); });
      return;
    }

    /* 2. A payment coming back. The success URL is Stripe's to set and may
          name the receipt `session_id` or, on the link as configured today,
          `listing` -- and may point at any path on this site, so the receipt
          is honoured wherever it lands. */
    var rec = receipt(params);

    if (rec.session_id || rec.claim_ref) {
      load().then(function () { renderClaim(rec, ''); });
      return;
    }

    /* 3. A claim path with nothing on it at all. */
    if (onClaimPath) {
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

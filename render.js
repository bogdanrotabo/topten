/* The markup, written once.
 *
 * The build renders these into every page at deploy time; app.js calls the
 * same functions in the browser a moment later. There is one implementation of
 * a row, one of the card at the top of a ranking, one of a battle line -- so
 * the two renderings cannot drift apart, which is the failure this file
 * exists to make impossible rather than to detect.
 *
 * Everything that comes from a payer -- a handle, a tagline, a link -- goes
 * through esc() on its way in. The rule is escape first, wrap second.
 */

import { esc, money, since, situation, MIN_CENTS } from './lib.js?v=2955655bef';

export const CROWN =
  '<svg width="18" height="14" viewBox="0 0 38 28" aria-hidden="true">'
  + '<path fill="currentColor" d="M2 8l7 6 10-12 10 12 7-6-4 18H6z"/></svg>';

const INFO =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
  + 'stroke-width="1.9" stroke-linecap="round" aria-hidden="true">'
  + '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>';

/** A listing's outbound link, stripped to the domain it points at. */
function linkText(url) {
  return String(url || '').replace(/^https?:\/\//i, '').replace(/\/$/, '');
}

/** One line of a full ranking. */
export function row(r, rank) {
  const link = r.link
    ? '<a class="row__sub" href="' + esc(r.link) + '" target="_blank" rel="noopener nofollow ugc">'
      + esc(linkText(r.link)) + '</a>'
    : (r.tagline ? '<div class="row__sub">' + esc(r.tagline) + '</div>' : '');
  return '<div class="row">'
    + '<div class="rk' + (rank === 1 ? ' rk--1' : '') + '">' + (rank === 1 ? CROWN : rank) + '</div>'
    + '<div class="row__main"><div class="row__name">' + esc(r.handle) + '</div>' + link + '</div>'
    + '<div class="row__amt num">' + esc(money(r.total_cents, r.currency)) + '</div>'
    + '</div>';
}

/** The two at the top of a ranking, and how close the second one is. */
export function topTwo(s, opts = {}) {
  if (s.empty) {
    return '<div class="glass top"><div class="row" style="padding:26px 18px">'
      + '<div class="row__main"><div class="row__name">Nobody yet</div>'
      + '<div class="row__sub">The first ' + esc(money(MIN_CENTS)) + ' takes #1</div></div>'
      + '</div></div>';
  }
  const held = s.one.last_paid_at ? since(s.one.last_paid_at) : '';
  let out = '<div class="glass top">'
    + '<div class="top__one">'
    +   '<div class="rk rk--1 rk--big">' + CROWN + '</div>'
    +   '<div class="row__main"><div class="top__name">' + esc(s.one.handle) + '</div>'
    +     (held ? '<div class="top__sub">#1 for ' + esc(held) + '</div>' : '')
    +   '</div>'
    +   '<div class="top__amt num">' + esc(money(s.one.total_cents, s.one.currency)) + '</div>'
    + '</div>';

  if (s.two) {
    out += '<hr class="hr">'
      + '<div class="top__two">'
      +   '<div class="rk">2</div>'
      +   '<div class="row__main"><div class="top__name">' + esc(s.two.handle) + '</div>'
      +     '<div class="top__sub num">' + esc(money(s.price)) + ' takes #1</div>'
      +   '</div>'
      +   '<div class="top__amt num">' + esc(money(s.two.total_cents, s.two.currency)) + '</div>'
      + '</div>'
      + '<div style="padding:0 18px 18px">'
      +   '<div class="gap"><div class="gap__fill" style="width:' + s.percent.toFixed(1) + '%"></div></div>'
      +   (opts.label !== false
            ? '<div class="gap__label num">' + esc(s.two.handle) + ' is at '
              + s.percent.toFixed(1) + '% of the leader</div>'
            : '')
      + '</div>';
  }
  return out + '</div>';
}

/**
 * The amounts, and the sentence above them.
 *
 * Every chip is a link to the same payment page the big button leads to. They
 * used to be buttons that lit up and did nothing else, which is a promise the
 * page could not keep: a figure you can press has said it will be charged.
 *
 * What they cannot do is set the figure. A Stripe Payment Link with a custom
 * amount takes what the payer types on Stripe's own page and there is no way
 * to fill it in from a URL, so the sentence saying that comes FIRST -- above
 * the chips, where it is read before the tap rather than after it.
 *
 * @param s     the situation on this ranking
 * @param href  the payment link carrying the listing, or null when there is
 *              nothing on the ranking to pay towards yet
 */
export function amounts(s, boardName, href) {
  const price = s.empty ? MIN_CENTS : (s.two ? s.price : MIN_CENTS);

  let says;
  if (s.empty) {
    /* Nothing is listed, so nothing can be paid towards yet. Saying where the
       amount gets typed first would be answering a question nobody on this
       page has reached: the move here is putting a name down. */
    says = 'Put a name down first &mdash; that part is free. It goes on the ranking as soon as a '
      + 'payment lands on it, and the first ' + esc(money(MIN_CENTS)) + ' takes #1.';
  } else if (!s.two) {
    says = esc(money(price)) + ' is the smallest payment the site takes. '
      + esc(s.one.handle) + ' holds #1 with ' + esc(money(s.one.total_cents)) + '.';
  } else {
    const after = s.two.total_cents + price;
    says = '<span class="num">' + esc(money(price)) + '</span> puts ' + esc(s.two.handle)
      + ' at <span class="num">' + esc(money(after)) + '</span>, past ' + esc(s.one.handle) + '.'
      + (price === MIN_CENTS ? ' It is also the smallest payment the site takes.' : '');
  }

  const note = '<div class="note">' + INFO + '<div>'
    + (s.empty ? '' : 'You type the amount on Stripe\u2019s page &mdash; a payment link cannot '
                      + 'be filled in for you. ')
    + says + '</div></div>';

  if (!href) return note;

  /* Four figures at most: the one that actually takes #1 from where the
     ranking stands, then the round numbers above it. The winning amount is
     always the first chip and always the marked one -- a row of suggestions
     that does not contain the answer is decoration, and the old row could
     mark nothing at all whenever the price ran past $25. */
  const round = [200, 500, 1000, 2500, 5000, 10000];
  const list = [...new Set([price, ...round.filter((c) => c > price)])].slice(0, 4);

  const chips = list.map((c, i) =>
    '<a class="chip num' + (i === 0 ? ' chip--on' : '') + '" href="' + esc(href) + '"'
    + ' data-amount="' + c + '">' + esc(money(c)) + '</a>').join('')
    + '<a class="chip chip--any" href="' + esc(href) + '" data-amount="0">Any</a>';

  return note + '<div class="amounts">' + chips + '</div>';
}

/** A line in the closest-battles list on the front page. */
export function battle(b) {
  return '<a class="battle" href="/' + esc(b.slug) + '/">'
    + '<div class="row__main">'
    +   '<div class="battle__pair">' + esc(b.two.handle) + ' <span>vs</span> ' + esc(b.one.handle) + '</div>'
    +   '<div class="battle__where num">' + esc(b.boardName) + ' &middot; '
    +     esc(money(b.two.total_cents)) + ' vs ' + esc(money(b.one.total_cents)) + '</div>'
    + '</div>'
    + '<div class="battle__price num">' + esc(money(b.price)) + '</div>'
    + '</a>';
}

/** A line in the trending list: what actually moved, and by how much. */
export function trend(t, rank) {
  return '<a class="glass row" style="border-radius:16px" href="/' + esc(t.slug) + '/">'
    + '<div class="rk" style="color:var(--text)">' + rank + '</div>'
    + '<div class="row__main"><div class="row__name">' + esc(t.handle) + '</div>'
    +   '<div class="row__sub">' + esc(t.boardName) + '</div></div>'
    + '<div style="text-align:right">'
    +   '<div class="row__amt num" style="color:var(--green)">+' + esc(money(t.d7_cents)) + '</div>'
    +   '<div class="row__sub num">now ' + esc(money(t.total_cents)) + '</div>'
    + '</div>'
    + '</a>';
}

/** A ranking nobody has paid into. */
export function openOne(b) {
  return '<a class="glass row" style="border-radius:16px" href="/' + esc(b.slug) + '/">'
    + '<div class="row__main"><div class="row__name">' + esc(b.name) + '</div></div>'
    + '<span class="take num">Take #1</span>'
    + '</a>';
}

/** One of the moves under "Happening now". */
export function move(m) {
  return '<div class="move">'
    + '<div class="move__when num">' + esc(m.when) + '</div>'
    + '<div class="move__what">' + m.html + '</div>'
    + '</div>';
}

/* --------------------------------------------------------------- numbers -- */

/* How each figure is written. The animation between two readings has to be
   able to write the values in between, so the formatting lives here rather
   than inside the markup that happens to print the first one. */
export function figureText(name, v) {
  const n = Math.round(Number(v) || 0);
  return name === 'backed_cents' ? money(n) : n.toLocaleString('en-US');
}

/**
 * The four figures, as the band across the top of every page.
 *
 * They were a card at the bottom, under everything, which is a strange place
 * for the only numbers on the site that move while you are looking at them.
 * The first TopTen had a figures strip above the running one and it was right:
 * the first thing worth knowing about a leaderboard is that there are people
 * on it and money in it.
 *
 * Each cell carries its raw value in an attribute. The text is formatted and
 * cannot be read back reliably ("$1,450.54" is not a number), and the count
 * between two readings needs to know where it is counting from.
 */
export function figures(n) {
  const cell = (name, key) =>
    '<span class="tally__i">'
    + '<b class="num" data-figure="' + name + '" data-value="' + (Number(n[name]) || 0) + '">'
    +   esc(figureText(name, n[name])) + '</b>'
    + '<span class="tally__k">' + esc(key) + '</span></span>';
  return cell('visitors', 'visitors') + cell('countries', 'countries')
    + cell('listed', 'listed') + cell('backed_cents', 'backed');
}

/**
 * The band itself.
 *
 * The light is hidden here and lit by app.js only after a reading has actually
 * come back. A green light painted into the page is a claim rather than a
 * measurement -- it would go on saying "live" from a cached page with nothing
 * behind it.
 */
export function tally(n) {
  return '<div class="tally" id="numbers">'
    + '<span class="live" id="live" hidden><span class="live__dot"></span>Live</span>'
    + figures(n)
    /* Empty and hidden until a reading fills it. The build cannot write who
       paid last: it would be true when the page was built and a lie by the
       time anybody read it, which is the whole reason this band is live. */
    + '<span class="lp" id="lastpaid" hidden></span>'
    + '</div>';
}

/* ---------------------------------------------------------------- ticker -- */

/** One name on the strip: where it stands, on what, for how much. */
export function tick(t) {
  return '<span class="tick">'
    + '<span class="tick__r' + (t.rank === 1 ? ' tick__r--1' : '') + '">'
    +   (t.rank === 1 ? CROWN : '#' + t.rank) + '</span>'
    + '<span class="tick__h">' + esc(t.handle) + '</span>'
    + '<span class="tick__b">' + esc(t.boardName) + '</span>'
    + '<span class="tick__a num">' + esc(money(t.cents)) + '</span>'
    + '</span>';
}

/**
 * The strip itself, newest payment first.
 *
 * Printed twice, and the track slides exactly half its own width: when the
 * animation restarts the second copy is standing where the first was, so the
 * loop has no seam to see.
 *
 * The duration is a speed, not a time. It was a flat 45 seconds on the first
 * TopTen, which meant every listing added made the same 45 seconds cover more
 * ground and the strip read faster; five names ambled and fifteen went three
 * times quicker for no reason anybody could see. So: pixels per second, fixed,
 * worked out from how far the track has to travel. The estimate here is what a
 * reader sees first and app.js replaces it with the measured width.
 */
export function ticker(items) {
  if (!items || !items.length) return '';
  const cells = items.map(tick).join('');
  const seconds = Math.min(600, Math.max(30, Math.round(items.length * 170 / 70)));
  return '<div class="ticker" id="ticker" aria-hidden="true" style="--tick-dur:' + seconds + 's">'
    + '<div class="ticker__track">' + cells + cells + '</div></div>';
}

export { situation };

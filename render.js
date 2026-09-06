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

import { esc, money, since, situation, MIN_CENTS } from './lib.js';

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
 * The amounts, and the sentence under them.
 *
 * The chips are suggestions and say so: the Payment Link takes a figure the
 * payer types on Stripe's own page, and Stripe has no way to pre-fill it from
 * a URL. So the page says what to type and what it buys, rather than pretending
 * to set it. The chip matching the winning amount is the one marked.
 */
export function amounts(s, boardName) {
  const price = s.empty ? MIN_CENTS : (s.two ? s.price : MIN_CENTS);
  const preset = [200, 500, 1000, 2500];
  const chips = preset.map((c) =>
    '<button type="button" class="chip num' + (c === Math.min(...preset.filter((p) => p >= price)) ? ' chip--on' : '')
    + '" data-amount="' + c + '">' + esc(money(c)) + '</button>').join('')
    + '<button type="button" class="chip chip--any" data-amount="0">Any</button>';

  let says;
  if (s.empty) {
    says = esc(money(MIN_CENTS)) + ' is the smallest payment the site takes, and on an empty '
      + 'ranking it is also what takes #1.';
  } else if (!s.two) {
    says = esc(money(price)) + ' is the smallest payment the site takes. '
      + esc(s.one.handle) + ' holds #1 with ' + esc(money(s.one.total_cents)) + '.';
  } else {
    const after = s.two.total_cents + price;
    says = '<span class="num">' + esc(money(price)) + '</span> puts ' + esc(s.two.handle)
      + ' at <span class="num">' + esc(money(after)) + '</span>, past ' + esc(s.one.handle) + '.'
      + (price === MIN_CENTS ? ' It is also the smallest payment the site takes.' : '');
  }

  return '<div class="amounts">' + chips + '</div>'
    + '<div class="note">' + INFO + '<div>You type the amount on the payment page. ' + says + '</div></div>';
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

export { situation };

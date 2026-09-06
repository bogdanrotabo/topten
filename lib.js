/* Everything the build and the browser both have to agree about.
 *
 * The build writes each page once, at deploy time, so a crawler and a reader
 * without JavaScript get a real ranking rather than an empty shell. app.js
 * then redraws the same page from the same views a moment later. Two renderers
 * of one design is a standing invitation to drift, so every rule they share --
 * how money is written, what it costs to take #1, how a name is escaped --
 * lives here and nowhere else.
 */

/** The smallest payment the site takes. Stated in the Terms, enforced by Stripe. */
export const MIN_CENTS = 200;

/** $23, $8.01, $306.99: cents dropped when they are zero, kept when they are not. */
export function money(cents, currency = 'usd') {
  const n = Number(cents || 0) / 100;
  const sign = String(currency).toLowerCase() === 'usd' ? '$' : '';
  const whole = Math.abs(n % 1) < 0.005;
  return sign + n.toLocaleString('en-US', {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

/**
 * What it costs to overtake a position.
 *
 * Two rules meet here and both matter. A tie loses -- the listing that reached
 * the amount first stays above -- so matching the leader is never enough and
 * the answer is the gap plus one cent. And the site takes nothing under $2, so
 * when that cent-perfect figure is smaller than the minimum, the minimum is
 * what a payer actually has to send. In most races on this site the smallest
 * payment allowed is also the winning one.
 */
export function costToPass(leaderCents, mineCents) {
  const gap = Number(leaderCents || 0) - Number(mineCents || 0) + 1;
  return Math.max(MIN_CENTS, gap);
}

/** What a fresh listing pays to hold an empty ranking. */
export function costToOpen() {
  return MIN_CENTS;
}

const ENT = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escape before anything else touches a payer-supplied string. */
export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ENT[c]);
}

/** "2 Sep", the way a move is dated on the page. */
export function shortDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/** "3 days", for how long a listing has held its place. */
export function since(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '';
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return mins + (mins === 1 ? ' minute' : ' minutes');
  const hours = Math.floor(mins / 60);
  if (hours < 48) return hours + (hours === 1 ? ' hour' : ' hours');
  const days = Math.floor(hours / 24);
  if (days < 60) return days + (days === 1 ? ' day' : ' days');
  const months = Math.floor(days / 30);
  return months + (months === 1 ? ' month' : ' months');
}

/**
 * Rank a board's rows the way the database does: money first, and on a tie
 * whoever got there first. The view already returns `rank`; this exists so the
 * browser can re-sort a list it has just changed without asking again.
 */
export function ranked(rows) {
  return rows.slice().sort((a, b) => {
    if (b.total_cents !== a.total_cents) return b.total_cents - a.total_cents;
    return new Date(a.last_paid_at) - new Date(b.last_paid_at);
  });
}

/**
 * The competitive situation inside one board: who holds it, who is closest,
 * and what the chase costs. Everything the page says about a race is read off
 * this object, so the front page and the board page cannot disagree.
 */
export function situation(rows) {
  const list = ranked(rows);
  const one = list[0] || null;
  const two = list[1] || null;
  if (!one) return { empty: true, open: costToOpen(), list };
  if (!two) return { empty: false, one, two: null, list, open: costToOpen() };
  return {
    empty: false,
    one,
    two,
    list,
    price: costToPass(one.total_cents, two.total_cents),
    gapCents: one.total_cents - two.total_cents,
    /* How far up the leader the challenger stands. Drawn as a bar, so it has
       to be a real proportion and not a flourish. */
    percent: one.total_cents > 0 ? Math.min(100, (two.total_cents / one.total_cents) * 100) : 0,
  };
}

/**
 * The key that decides whether two submissions are the same thing.
 *
 * `listings` is unique on (platform, url), and on these boards the url is not
 * a web address -- it is the name, folded. "Bitcoin", "bitcoin" and " BITCOIN "
 * all key to `crypto:bitcoin`, so the second person to think of it is sent to
 * pay towards the first one's row instead of splitting the money across two.
 * Accents fold too, which is why Beyoncé keys to `artists:beyonce`: the row
 * that has been collecting since August is the one a new payment should join.
 */
export function listingKey(platform, handle) {
  const folded = String(handle || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
  return platform + ':' + folded;
}

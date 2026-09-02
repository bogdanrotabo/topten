/* topten.one/badge — the head of a shared badge, written for the listing.
 *
 * The site is static. Every page is the same index.html, so /badge/?p=x&h=name
 * shared to X, WhatsApp or LinkedIn previewed as the site itself: "TopTen.one
 * — rankings decided by money", the generic picture, and not one word about
 * who is first or what they paid. Somebody pays to be #1 and shares it, and
 * the share says nothing about them. That is the whole point of the badge and
 * it was the one thing missing.
 *
 * A crawler does not run JavaScript, so the fix cannot live in app.js. It has
 * to happen on the request. This runs at Cloudflare's edge in front of GitHub
 * Pages, reads the listing, and rewrites the eight tags in the head that a
 * preview reads. The body is untouched: the page a person lands on is exactly
 * the page that was there before.
 *
 * It is deliberately impossible for this to break the badge. Every failure
 * path -- no board, no listing, Supabase down, a thrown error -- returns the
 * origin's own response unmodified, which is what the site does today.
 */

import BOARDS from './boards.json';

const SITE = 'https://topten.one';

/* Public, and public on purpose: this is the same anon key config.js serves to
   every browser, protected by row-level security. Nothing here reads anything
   a visitor could not read by opening the page. */
const SUPABASE_URL = 'https://iezclmijwrtjibgflfqj.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImllemNsbWlqd3J0amliZ2ZsZnFqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc2NDA0ODMsImV4cCI6MjEwMzIxNjQ4M30.BmuhHNFFG28hlI0UkaFMXsEWkbYk0W_9VIlZVI_VKEA';

export default {
  async fetch(request, env, ctx) {
    const origine = await paginaStatica(request, env);
    try {
      return await badge(request, origine, env);
    } catch (e) {
      /* Whatever went wrong, the visitor still gets the page. A share preview
         that is merely generic is a disappointment; a badge that 500s is a
         broken link somebody paid for. */
      console.error('badge head rewrite failed:', e && e.stack || e);
      return origine;
    }
  },
};

/* The page as GitHub Pages serves it.

   In production this is the request itself: Cloudflare sends a Worker's
   subrequest to the origin rather than back through the Worker, so asking for
   the same URL returns the static file. ORIGIN exists because that is not true
   under `wrangler dev`, where a Worker fetching its own address would call
   itself until it ran out of subrequests -- pointed at a copy of the site on
   localhost, the whole rewrite can be tested without deploying it. */
function paginaStatica(request, env) {
  if (!env || !env.ORIGIN) return fetch(request);
  const u = new URL(request.url);
  return fetch(new URL(u.pathname + u.search, env.ORIGIN), { headers: request.headers });
}

async function badge(request, origine, env) {
  const url = new URL(request.url);

  const { slug, handle } = paramsBadge(url);
  const board = BOARDS[slug];
  if (!board || !handle) return origine;

  /* /badge/<board>/<handle> is a real page and always has been -- app.js reads
     the path and draws the badge -- but there is no such file on GitHub Pages,
     so the origin answers with 404.html and a 404 status. A person never
     notices; a crawler stops at the status and the link previews as nothing at
     all. The page it should have served is /badge/, so that is fetched
     instead, and the answer says 200 because the page is there. */
  if (origine.status === 404 && !url.searchParams.get('p')) {
    const adevarata = await paginaStatica(cerereCatre(request, '/badge/'), env);
    if (adevarata.ok) origine = new Response(adevarata.body, adevarata);
  }

  /* Only an HTML document is worth rewriting, and only a good one. Anything
     else -- a real error, an asset, a redirect -- keeps its own head and its
     own status. */
  const tip = origine.headers.get('content-type') || '';
  if (!origine.ok || !tip.includes('text/html')) return origine;

  const randuri = await listaBoard(slug, env);
  if (!randuri) return origine;

  /* Matched with the @ off both sides, the same way app.js matches it. Links
     have been shared with the @ and without it since the badge existed, and
     half the boards hold handles that never had one. */
  const gol = h => String(h || '').replace(/^@/, '').toLowerCase();
  const i = randuri.findIndex(r => gol(r.handle) === gol(handle));
  if (i < 0) return origine;

  const rand = randuri[i];
  const rang = i + 1;
  const nume = String(rand.handle);
  const bani = dolari(rand.total_cents);

  const titlu = `${nume} is #${rang} on ${board.name} — TopTen.one`;

  /* What the second line of a preview card has to earn: who, where, how much,
     and what the reader can do about it. The price to take the place is the
     live one -- a dollar more than what is being held -- because a number
     somebody can act on is worth more than an invitation. */
  const pret = dolari(rand.total_cents + 100);
  const descriere = rang === 1
    ? `${nume} holds #1 on the ${board.name} board with ${bani} paid. `
      + `Pay more than the person above you: ${pret} takes first place.`
    : `${nume} is #${rang} of ten on the ${board.name} board with ${bani} paid. `
      + `Pay more than the person above you and move up.`;

  const adresa = `${SITE}/badge/?p=${encodeURIComponent(slug)}&h=${encodeURIComponent(nume.replace(/^@/, ''))}`;

  return new HTMLRewriter()
    .on('title', new Continut(titlu))
    .on('meta[name="description"]', new Attr('content', descriere))
    .on('meta[property="og:title"]', new Attr('content', titlu))
    .on('meta[property="og:description"]', new Attr('content', descriere))
    .on('meta[property="og:url"]', new Attr('content', adresa))
    .on('meta[name="twitter:title"]', new Attr('content', titlu))
    .on('meta[name="twitter:description"]', new Attr('content', descriere))
    /* Not the canonical. /badge/ points at the homepage on purpose: one URL
       per listing has no business in a search index, and consolidating them is
       what that tag is for. A preview reads og:url, not canonical, so the two
       can disagree and each be right. */
    .transform(origine);
}

/* ?p= and ?h=, or the /badge/<board>/<handle> spelling that app.js also
   accepts. The second has never previewed at all -- GitHub Pages has no such
   file, so it answers 404 and a crawler stops there -- but a person who typed
   one by hand still lands on a working page through the 404 fallback, and if
   they share it the preview should say the same thing. */
/* The same request pointed at another path on the same host, so the origin
   fetch keeps whatever headers came with it. */
function cerereCatre(request, cale) {
  const u = new URL(request.url);
  u.pathname = cale;
  u.search = '';
  return new Request(u, request);
}

function paramsBadge(url) {
  let slug = url.searchParams.get('p') || '';
  let handle = url.searchParams.get('h') || '';
  if (!slug || !handle) {
    const parti = url.pathname.split('/').filter(Boolean);
    if (parti[0] === 'badge') {
      slug = parti[1] || '';
      try { handle = decodeURIComponent(parti[2] || ''); } catch (e) { handle = parti[2] || ''; }
    }
  }
  return { slug, handle };
}

/* The board, in the order the site ranks it: most paid first, and the earlier
   payment ahead on a tie. Ten rows, which is the whole board.

   Cached for a minute at the edge. A badge is shared once and then fetched by
   every crawler that sees the link, and they arrive together. */
async function listaBoard(slug, env) {
  const q = new URL(`${(env && env.SUPABASE_URL) || SUPABASE_URL}/rest/v1/board`);
  q.searchParams.set('platform', `eq.${slug}`);
  q.searchParams.set('select', 'handle,total_cents,last_paid_at');
  q.searchParams.set('order', 'total_cents.desc,last_paid_at.asc');
  q.searchParams.set('limit', '10');

  const cheie = (env && env.SUPABASE_ANON_KEY) || SUPABASE_ANON_KEY;
  const r = await fetch(q, {
    headers: { apikey: cheie, authorization: `Bearer ${cheie}` },
    cf: { cacheTtl: 60, cacheEverything: true },
  });
  if (!r.ok) return null;
  const rows = await r.json();
  return Array.isArray(rows) ? rows : null;
}

/* Cents to dollars, the way the site writes them: no cents when there are
   none, thousands separated. */
function dolari(cents) {
  const n = Number(cents) || 0;
  const intreg = n % 100 === 0;
  return '$' + (n / 100).toLocaleString('en-US', {
    minimumFractionDigits: intreg ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

class Attr {
  constructor(nume, valoare) { this.nume = nume; this.valoare = valoare; }
  element(el) { el.setAttribute(this.nume, this.valoare); }
}

/* Not a field called "text": HTMLRewriter reads a handler object's own
   text property as the handler for text nodes, so a class that stored the
   string there was rejected before it ever ran -- "the provided value is not
   of type function". The catch above turned that into the untouched page,
   which is how it was found. */
class Continut {
  constructor(valoare) { this.valoare = valoare; }
  element(el) { el.setInnerContent(this.valoare); }
}

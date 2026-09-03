#!/usr/bin/env node
/**
 * The content security policy, written into the head of every page.
 *
 * The site had no security headers at all: no policy, no nosniff, no
 * frame-ancestors. GitHub Pages does not let you set a header, so the two that
 * must be headers still cannot be set from here — they belong in a Cloudflare
 * transform rule and are named at the bottom of this comment. A policy,
 * though, is allowed in a meta tag, and a meta tag is a file in this
 * repository.
 *
 * What it is worth: this site takes money and prints text somebody else typed
 * — a tagline, a link, a handle. Every one of those paths is escaped and I
 * have checked them, but "I checked" is a claim about today. A policy is the
 * difference between a mistake in that escaping being a defacement and it
 * being nothing at all.
 *
 * It is only worth that if inline script is refused, and a policy that allows
 * four onerror= attributes allows every one an attacker could inject. Those
 * four are gone; the two <script> blocks that have to stay inline — the theme,
 * which must run before the first paint, and the share bar on the pages that
 * do not load app.js — are allowed by the hash of their own contents.
 *
 * Which is why this is generated rather than typed. A hash written by hand is
 * wrong the first time anybody edits the script it stands for, and the way it
 * is wrong is that the page stops working. Here it is computed from the bytes
 * in the file, every time, and --check refuses a stale one.
 *
 * Still missing, and only a header can carry them:
 *   X-Content-Type-Options: nosniff
 *   Content-Security-Policy: frame-ancestors 'none'   (meta ignores this one)
 *   Strict-Transport-Security
 *
 *   node scripts/build-csp.mjs           writes the meta into each page
 *   node scripts/build-csp.mjs --check   fails if any page is stale
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAGINI = ['index.html', 'about.html', 'terms.html', 'privacy.html', 'admin.html'];

const MARCA = '<!-- csp -->';

/* Everything the site actually asks for, and nothing else.
 *
 * script  jsdelivr carries the Supabase client; googletagmanager carries
 *         analytics, which app.js appends as a script element.
 * connect Supabase for every read and write, CoinGecko for the coin search in
 *         the claim form, Google's two analytics hosts for what it sends back.
 * img     https: at large, because a listing's picture is whatever host that
 *         profile lives on and there is no list of those. data: for the inline
 *         SVG marks. This is the one directive that cannot be narrow, and it
 *         is also the one that cannot execute anything.
 * frame   nothing on this site frames anything.
 * form    the pay button is a link to Stripe, not a form post, so nothing but
 *         this origin should ever be a form target.
 */
const REGULI = [
  ["default-src", "'self'"],
  ["base-uri", "'self'"],
  ["object-src", "'none'"],
  ["frame-src", "'none'"],
  ["form-action", "'self'"],
  ["script-src", "'self' https://cdn.jsdelivr.net https://www.googletagmanager.com"],
  ["style-src", "'self' 'unsafe-inline'"],
  ["img-src", "'self' data: https:"],
  ["font-src", "'self'"],
  /* Analytics is written with a wildcard on purpose. GA4 does not send to one
     host: it picks a regional one -- region1.google-analytics.com and its
     siblings -- by where the visitor is. Naming the two obvious hosts works
     in the country you tested from and silently drops the numbers everywhere
     else. */
  /* wss:// as well as https://, and it is not a detail. Supabase holds a
     websocket open for live updates -- a payment lands and the board moves
     without a reload -- and connect-src governs that socket. A policy that
     names only the https address kills it, the page still draws, and the
     only symptom is that the numbers stop moving. Which is how a policy
     breaks a site quietly, and why this was tested before it shipped. */
  ["connect-src", "'self' https://iezclmijwrtjibgflfqj.supabase.co "
    + "wss://iezclmijwrtjibgflfqj.supabase.co https://api.coingecko.com "
    + "https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com"],
  ["manifest-src", "'self'"],
];

/* style-src keeps 'unsafe-inline' and that is not an oversight. Every board
   colour, every club badge and every avatar ring is a custom property set in a
   style attribute on the element that uses it -- brandVars does this hundreds
   of times on a page. Hashing them is not possible for an attribute and
   nonces do not apply to them either. An inline style cannot run code; the
   worst it buys an attacker is the ability to move something on the page. */

const hashuri = html =>
  [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
    .map(m => "'sha256-" + createHash('sha256').update(m[1], 'utf8').digest('base64') + "'");

function politica(html) {
  const h = [...new Set(hashuri(html))];
  return REGULI
    .map(([k, v]) => k === 'script-src' ? `${k} ${v}${h.length ? ' ' + h.join(' ') : ''}` : `${k} ${v}`)
    .join('; ');
}

/* Written on one line and marked, so the next run finds its own tag rather
   than a second one appearing under it. */
const eticheta = p => `${MARCA}<meta http-equiv="Content-Security-Policy" content="${p}">`;

const verifica = process.argv.includes('--check');
let schimbate = 0, rele = 0;

for (const nume of PAGINI) {
  const cale = join(root, nume);
  const html = readFileSync(cale, 'utf8');

  /* The hashes have to be taken from the page without its own tag in it, or a
     policy would be hashing a policy. The tag carries no script, so removing
     it first is only tidiness -- but the removal is what makes the run
     repeatable. */
  const fara = html.replace(new RegExp(MARCA + '<meta http-equiv="Content-Security-Policy"[^>]*>\\n?', 'g'), '');

  /* The viewport tag, not the canonical: admin.html is noindex and has no
     canonical, so anchoring on that one skipped it silently -- the page that
     reads the live database was the one page with no policy on it, and
     nothing said so. Checked before anything else, because a missing anchor
     has to be an error and not a page quietly left out. */
  const ANCORA = '<meta name="viewport"';
  if (!fara.includes(ANCORA)) {
    console.error(`build-csp: ${nume} has no ${ANCORA} to sit under`);
    process.exit(2);
  }
  const i = fara.indexOf(ANCORA);
  const capat = fara.indexOf(">", i) + 1;
  const nou = fara.slice(0, capat) + '\n' + eticheta(politica(fara)) + fara.slice(capat);

  if (nou === html) continue;
  if (verifica) { console.error(`build-csp: ${nume} is stale`); rele++; }
  else { writeFileSync(cale, nou); schimbate++; }
}

if (verifica) {
  if (rele) { console.error('build-csp: run node scripts/build-csp.mjs'); process.exit(1); }
  console.log(`build-csp: ${PAGINI.length} pages, policy current.`);
} else {
  console.log(`build-csp: ${schimbate} of ${PAGINI.length} pages updated.`);
}

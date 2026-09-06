#!/usr/bin/env node
/**
 * Was scripts/sync-routes.sh run?
 *
 * It is the one mistake this repository invites. Editing index.html, app.js,
 * styles.css or config.js and pushing without running the build leaves two
 * things wrong, and neither of them looks wrong:
 *
 *   - the asset stamp still points at the old bytes, so a visitor spends ten
 *     minutes running the old app against the new page, which is exactly what
 *     "the deploy did not happen" looks like;
 *   - 404.html, thanks/index.html and claim/index.html still carry the
 *     previous page, so the address Stripe sends a payer back to is a version
 *     of the site that no longer exists.
 *
 * Both are invisible on localhost, where nothing is cached and the route
 * copies are never opened. So they are checked here instead.
 *
 * This deliberately does not run the prerender: that reads the live database,
 * and the king changes whenever somebody pays. A page whose baked figures are
 * an hour old is the design; a page whose JavaScript is a deploy old is a bug.
 *
 *   node scripts/check-build.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/* The three files the stamp is a hash of, and the four pages that carry it --
   the same lists sync-routes.sh works from. */
const ASSETS = ['app.js', 'styles.css', 'config.js'];
const PAGES = ['index.html', 'about.html', 'terms.html', 'privacy.html'];
const COPIES = ['404.html', 'thanks/index.html', 'claim/index.html'];

const rele = [];

/* ------------------------------------------------------------- the stamp */

const stamp = createHash('sha1')
  .update(Buffer.concat(ASSETS.map(f => readFileSync(join(root, f)))))
  .digest('hex').slice(0, 10);

for (const nume of PAGES) {
  const html = readFileSync(join(root, nume), 'utf8');
  const gasite = [...html.matchAll(/"\/(?:app|config)\.js\?v=([a-f0-9]+)"|"\/styles\.css\?v=([a-f0-9]+)"/g)]
    .map(m => m[1] || m[2]);
  if (!gasite.length) {
    rele.push(`${nume} carries no asset stamp at all`);
    continue;
  }
  const gresite = [...new Set(gasite)].filter(v => v !== stamp);
  if (gresite.length) {
    rele.push(`${nume} is stamped ${gresite.join(', ')}, but the assets hash to ${stamp}`);
  }
}

/* ------------------------------------------------------------ the copies */

const acasa = readFileSync(join(root, 'index.html'));
for (const nume of COPIES) {
  const cale = join(root, nume);
  if (!existsSync(cale)) { rele.push(`${nume} is missing`); continue; }
  if (!readFileSync(cale).equals(acasa)) {
    rele.push(`${nume} is not a copy of index.html`);
  }
}

/* ------------------------------------------------------------------ done */

if (rele.length) {
  for (const r of rele) console.error(`check-build: ${r}`);
  console.error('check-build: run  bash scripts/sync-routes.sh  and commit what it changes.');
  process.exit(1);
}

console.log(`check-build: assets stamped ${stamp} on ${PAGES.length} pages,`
  + ` ${COPIES.length} route copies current.`);

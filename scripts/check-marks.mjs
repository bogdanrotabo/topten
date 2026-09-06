#!/usr/bin/env node
/**
 * The two copies of the marks registry have to agree.
 *
 * app.js draws the king's card in the browser; scripts/prerender.mjs draws the
 * same card into the HTML at build time so a crawler and a reader without
 * JavaScript get it too. Both carry the registry of marks the site will draw,
 * because neither can import from the other -- one runs in a browser with no
 * bundler, the other in Node.
 *
 * Two copies is fine. Two copies that have quietly drifted is a king whose
 * logo appears a second after load, or disappears a second after load, and
 * nothing anywhere says why. So they are compared here, on every pull request.
 *
 *   node scripts/check-marks.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/* Every "'slug': '<svg …>'" pair inside the MARKS block of a file. */
function registru(cale) {
  const text = readFileSync(join(root, cale), 'utf8');
  const bloc = /(?:var|const) MARKS = \{([\s\S]*?)\n\s*\};/.exec(text);
  if (!bloc) throw new Error(`${cale} has no MARKS registry`);
  const out = new Map();
  for (const m of bloc[1].matchAll(/'([^']+)':\s*'([^']*)'/g)) out.set(m[1], m[2]);
  if (!out.size) throw new Error(`${cale} has an empty MARKS registry`);
  return out;
}

const a = registru('app.js');
const b = registru('scripts/prerender.mjs');
const rele = [];

for (const slug of new Set([...a.keys(), ...b.keys()])) {
  if (!a.has(slug)) rele.push(`${slug} is in the prerender and not in app.js`);
  else if (!b.has(slug)) rele.push(`${slug} is in app.js and not in the prerender`);
  else if (a.get(slug) !== b.get(slug)) rele.push(`${slug} is drawn differently in the two`);
}

/* The column that names them is checked too: a slug the database would refuse
   is a mark that can never be set, which is a mark nobody will notice is dead. */
const SLUG = /^[a-z0-9][a-z0-9.-]{0,39}$/;
for (const slug of a.keys()) {
  if (!SLUG.test(slug)) rele.push(`${slug} does not match the reigns.logo constraint`);
}

if (rele.length) {
  for (const r of rele) console.error(`check-marks: ${r}`);
  process.exit(1);
}

console.log(`check-marks: ${a.size} mark${a.size === 1 ? '' : 's'} (${[...a.keys()].join(', ')}),`
  + ' drawn the same way in app.js and the prerender.');

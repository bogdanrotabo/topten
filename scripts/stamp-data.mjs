#!/usr/bin/env node
/**
 * A version in the address of every data file app.js fetches.
 *
 * The six of them are asked for with `cache: 'force-cache'`, which is exactly
 * right for a file that never changes and exactly wrong for one that does:
 * force-cache returns a cached copy even when it is stale, so a browser that
 * has been here before keeps whatever it downloaded the first time. For as
 * long as the entry survives.
 *
 * That is not a theory about caching. Three fighting boards shipped with
 * thirty names each and a returning tablet showed no list at all on any of
 * them, because rosters.json in its cache was the one from before they
 * existed — and a board whose roster is missing draws no list and hides the
 * arrow that opens it. The same silence covered the fifty NBA and NHL players
 * that replaced ten, the Startups list, and every coin logo and photograph
 * added since whenever that browser last called.
 *
 * The assets have had a content hash in their query string for months, for
 * this reason. The data files never got one. They have one now, and the whole
 * arrangement becomes correct rather than merely quiet: a changed file is a
 * changed address, so it is fetched; an unchanged one keeps its address, so
 * force-cache serves it instantly and forever, which is what it is for.
 *
 * The chain that carries it: this rewrites app.js, so app.js's own stamp
 * changes, so index.html points at a new app.js, and a browser that fetches
 * the new app.js asks for the new data addresses. index.html is the only link
 * that has to be revalidated, and it carries max-age=600.
 *
 *   node scripts/stamp-data.mjs           writes the stamps into app.js
 *   node scripts/stamp-data.mjs --check   fails if any stamp is out of date
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP = join(root, 'app.js');

/* Found rather than listed: any file app.js fetches from the site root gets a
   stamp, so adding a seventh data file needs nothing done here. */
const CERUTE = /fetch\('\/([a-z0-9-]+\.json)(?:\?v=[0-9a-f]+)?'/g;

const hash = f => createHash('sha1').update(readFileSync(join(root, f))).digest('hex').slice(0, 10);

const app = readFileSync(APP, 'utf8');
const lipsa = [];
const stampe = [];

const nou = app.replace(CERUTE, (tot, fisier) => {
  if (!existsSync(join(root, fisier))) { lipsa.push(fisier); return tot; }
  const v = hash(fisier);
  stampe.push(`${fisier} ${v}`);
  return `fetch('/${fisier}?v=${v}'`;
});

if (lipsa.length) {
  console.error(`stamp-data: app.js fetches files that are not here: ${lipsa.join(', ')}`);
  process.exit(2);
}
if (!stampe.length) {
  console.error('stamp-data: no data fetches found in app.js — has the call shape changed?');
  process.exit(2);
}

if (process.argv.includes('--check')) {
  if (nou !== app) {
    console.error('stamp-data: data stamps in app.js are out of date — run node scripts/stamp-data.mjs');
    process.exit(1);
  }
  console.log(`stamp-data: ${stampe.length} data files, stamps current.`);
} else {
  if (nou !== app) writeFileSync(APP, nou);
  console.log(`stamp-data: ${stampe.length} data files stamped${nou === app ? ' (unchanged)' : ''}.`);
  for (const s of stampe) console.log(`  ${s}`);
}

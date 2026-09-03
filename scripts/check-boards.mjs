#!/usr/bin/env node
/**
 * The boards in app.js and the boards the database accepts must be the same
 * set — and so must the routes on disk, the footer links and the sitemap.
 *
 * This is not tidiness. A board drawn in the front end that the CHECK
 * constraint rejects lets somebody fill in the form, pay Stripe and have the
 * insert fail afterwards: money taken for a listing that cannot exist. A board
 * with no directory answers 404 to every share of it. Both failures are
 * invisible until a stranger hits them, which is the worst time to find out.
 *
 *   node scripts/check-boards.mjs
 *
 * Exits 1 and names what disagrees.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = f => readFileSync(join(root, f), 'utf8');

let ULTIMA_MIGRATIE = '?';
const set = a => new Set(a);
const lipsa = (a, b) => [...a].filter(x => !b.has(x));

/* app.js: the slugs inside the PLATFORMS literal. */
const app = (() => {
  const m = /const PLATFORMS = \[([\s\S]*?)\n  \];/.exec(read('app.js'));
  if (!m) { console.error('check-boards: PLATFORMS not found in app.js'); process.exit(2); }
  return [...m[1].matchAll(/slug: '([a-z0-9-]+)'/g)].map(x => x[1]);
})();

/* The newest migration that rewrites the constraint. */
const sql = (() => {
  /* The newest migration that writes the constraint, found rather than named.
     This used to name 0011 and would have gone on checking 0011 forever --
     a later migration adding a board would have been invisible to the one
     script whose job is to notice exactly that. */
  const dir = join(root, 'supabase/migrations');
  const fisier = readdirSync(dir).filter(f => f.endsWith('.sql')).sort().reverse()
    .find(f => readFileSync(join(dir, f), 'utf8').includes('listings_platform_check check ('));
  if (!fisier) { console.error('check-boards: no migration defines listings_platform_check'); process.exit(2); }
  const m = /listings_platform_check check \(([\s\S]*?)\n\);/.exec(read('supabase/migrations/' + fisier));
  if (!m) { console.error(`check-boards: constraint not found in ${fisier}`); process.exit(2); }
  ULTIMA_MIGRATIE = fisier;
  return [...m[1].matchAll(/'([a-z0-9-]+)'/g)].map(x => x[1]);
})();

/* sync-routes.sh: the list it generates directories and sitemap entries from. */
const rute = (() => {
  const m = /^PLATFORMS="(.*)"$/m.exec(read('scripts/sync-routes.sh'));
  if (!m) { console.error('check-boards: PLATFORMS not found in sync-routes.sh'); process.exit(2); }
  return m[1].trim().split(/\s+/).map(e => e.split('|')[0]);
})();

const subsol = [...read('index.html').matchAll(/href="\/([a-z0-9-]+)\/" data-link/g)].map(x => x[1]);
const harta = [...read('sitemap.xml').matchAll(/<loc>https:\/\/topten\.one\/([a-z0-9-]+)\/<\/loc>/g)].map(x => x[1]);

let rele = 0;
const cere = (nume, lista) => {
  const a = set(app), b = set(lista);
  const nu_e = lipsa(a, b), in_plus = lipsa(b, a);
  if (nu_e.length)    { console.error(`  ${nume}: missing ${nu_e.join(', ')}`); rele++; }
  if (in_plus.length) { console.error(`  ${nume}: has ${in_plus.join(', ')}, which app.js does not offer`); rele++; }
};

cere(`the database constraint (${ULTIMA_MIGRATIE})`, sql);
cere('scripts/sync-routes.sh', rute);
cere('the footer in index.html', subsol);
cere('sitemap.xml', harta);

for (const slug of app) {
  if (!existsSync(join(root, slug, 'index.html'))) {
    console.error(`  ${slug}/index.html is missing — run scripts/sync-routes.sh`);
    rele++;
  }
}

if (rele) {
  console.error(`\ncheck-boards: ${rele} problem${rele > 1 ? 's' : ''}. The boards do not agree.`);
  process.exit(1);
}
console.log(`check-boards: ${app.length} boards, and everything agrees.`);

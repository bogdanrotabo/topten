#!/usr/bin/env node
/**
 * worker/src/boards.json — the boards, for the Worker that rewrites the head
 * of a shared badge.
 *
 * The Worker runs at Cloudflare's edge and cannot read app.js, so it needs its
 * own copy of slug -> name and colour. A second hand-written list of forty-three
 * boards is exactly the thing that goes stale and takes a share link with it:
 * a board added to app.js and forgotten here would share as "undefined". So it
 * is generated from app.js and checked, the same way the routes are.
 *
 *   node scripts/build-worker-boards.mjs           writes the file
 *   node scripts/build-worker-boards.mjs --check   fails if it is out of date
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const iesire = join(root, 'worker/src/boards.json');

const app = readFileSync(join(root, 'app.js'), 'utf8');
const m = /const PLATFORMS = \[([\s\S]*?)\n  \];/.exec(app);
if (!m) { console.error('build-worker-boards: PLATFORMS not found in app.js'); process.exit(2); }

/* One entry per line in the literal, each with a slug, a name and a colour.
   The name is taken exactly as app.js writes it -- "Gifts & Airdrops" with a
   bare ampersand -- because the Worker puts it through HTMLRewriter, which
   escapes what it writes into an attribute. Escaping it here as well would
   share the board as "Gifts &amp;amp; Airdrops". */
const boards = {};
for (const linie of m[1].split('\n')) {
  const s = /slug: '([a-z0-9-]+)'/.exec(linie);
  const n = /name: '((?:[^'\\]|\\.)*)'/.exec(linie);
  const c = /color: '(#[0-9a-fA-F]{3,8})'/.exec(linie);
  if (s && n) boards[s[1]] = { name: n[1].replace(/\\'/g, "'"), color: c ? c[1] : '#8a1fb2' };
}

const n = Object.keys(boards).length;
if (n < 40) { console.error(`build-worker-boards: only ${n} boards parsed, which cannot be right`); process.exit(2); }

const text = JSON.stringify(boards, null, 2) + '\n';
const verifica = process.argv.includes('--check');

if (verifica) {
  const vechi = existsSync(iesire) ? readFileSync(iesire, 'utf8') : '';
  if (vechi !== text) {
    console.error('build-worker-boards: worker/src/boards.json is out of date — run node scripts/build-worker-boards.mjs');
    process.exit(1);
  }
  console.log(`build-worker-boards: ${n} boards, current.`);
} else {
  writeFileSync(iesire, text);
  console.log(`build-worker-boards: ${n} boards written to worker/src/boards.json`);
}

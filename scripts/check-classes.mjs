#!/usr/bin/env node
/**
 * Every class the page draws itself with has to exist in the stylesheet.
 *
 * The card is drawn twice -- once into the HTML by scripts/prerender.mjs at
 * build time, once again by app.js a second after load -- and styled once, by
 * styles.css. Three files, and nothing made them agree.
 *
 * They stopped agreeing. `.figure__v--gold` was renamed to `--royal` in the
 * stylesheet and in app.js; the prerender kept emitting the old name after a
 * `git checkout` of that file reverted the rename along with the mistake it
 * was meant to undo. Nothing failed. The amount simply drew in the default
 * colour on first paint, and in the right one a second later when app.js
 * replaced the card -- a flicker nobody would report and a permanently wrong
 * colour for a reader with no JavaScript.
 *
 * So: collect every class name the two files write into markup, and check the
 * stylesheet defines it. A class that is deliberately unstyled goes in
 * FARA_STIL below, with the reason.
 *
 *   node scripts/check-classes.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/* Classes that exist for something other than styling. */
const FARA_STIL = new Set([
  'prerender',   // marks build-time markup; the rules that use it are compound
]);

const css = readFileSync(join(root, 'styles.css'), 'utf8');
const definite = new Set([...css.matchAll(/\.([a-zA-Z][\w-]*)/g)].map(m => m[1]));

/* Every class="..." the file writes, template placeholders and all. */
function emise(cale) {
  const text = readFileSync(join(root, cale), 'utf8');
  const out = new Map();
  for (const m of text.matchAll(/class=\\?"([^"$`]*)\\?"/g)) {
    for (const c of m[1].split(/\s+/)) {
      if (c && /^[a-zA-Z][\w-]*$/.test(c)) {
        if (!out.has(c)) out.set(c, []);
        out.get(c).push(cale);
      }
    }
  }
  return out;
}

const rele = [];
const toate = new Map();
for (const cale of ['scripts/prerender.mjs', 'app.js', 'index.html']) {
  for (const [c, unde] of emise(cale)) {
    toate.set(c, (toate.get(c) || []).concat(unde));
  }
}

for (const [c, unde] of toate) {
  if (FARA_STIL.has(c) || definite.has(c)) continue;
  rele.push(`${c} is written by ${[...new Set(unde)].join(', ')} and styled nowhere`);
}

/* And the other way for the card's own classes: a style with no writer is
   dead weight, and the pair that matters most is the one that drifted. */
for (const c of definite) {
  if (!/^(king|figure)__/.test(c)) continue;
  if (!toate.has(c)) rele.push(`.${c} is styled and nothing writes it`);
}

if (rele.length) {
  for (const r of rele) console.error(`check-classes: ${r}`);
  process.exit(1);
}

console.log(`check-classes: ${toate.size} classes written, all of them styled.`);

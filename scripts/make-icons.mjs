#!/usr/bin/env node
/**
 * The mark, and the icons cut from it.
 *
 * One drawing: "#1" in white on the site's gold, set in the site's own
 * figures. It was violet on #000, then gold on warm near-black, and each
 * move happened because the page moved: the mark follows the page, or the
 * tab and the site are two brands. The page is paper now, and a paper tile
 * vanishes into a light tab bar -- so the tile is the gold itself, the one
 * square of the palette already measured to carry white figures (5.2:1).
 * The SVG favicon is that drawing; every PNG is that drawing rasterised at
 * a size.
 *
 * The share card is not drawn here any more: scripts/og.mjs draws all 73 of
 * them, one per page, from the boards themselves. The card() this file
 * carried was the design before that -- "King of the Hill", a game the site
 * stopped being -- and a generator nobody runs is exactly how a stale card
 * gets back onto every shared link. --check still watches og-image.png's
 * presence and size, because the manifest and every page point at it.
 *
 * What each file is for:
 *   favicon.svg               the tab, on browsers that take an SVG
 *   favicon-32.png            the tab, on browsers that do not
 *   apple-touch-icon-180.png  the home screen on iOS, which rounds the
 *                             corners itself, so this one is a full square
 *   icon-192 / icon-512.png   the manifest's "any" icons, rounded
 *   icon-512-maskable.png     the manifest's "maskable" icon: a full square
 *                             with the mark shrunk into the safe zone, because
 *                             the launcher cuts its own shape out of it
 *   og-image.png              drawn by scripts/og.mjs; only checked here
 *
 * Needs sharp, which is not kept in the repository -- this runs when the mark
 * changes, which is rarely, and a dependency tree for a script that runs
 * twice a year is not worth carrying:
 *
 *   npm i --no-save sharp
 *   node scripts/make-icons.mjs          writes everything
 *   node scripts/make-icons.mjs --check  fails if favicon.svg is stale or a
 *                                        PNG is missing or the wrong size;
 *                                        needs no sharp
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const icons = join(root, 'icons');

/* The gold button, as a tile. A #faf9f7 tile disappears into a light tab
   bar, so the icon is the one square the page already trusts on any ground:
   the gold, wearing the white its button wears. */
const GOLD = '#8d6610';        /* --gold, the daylight accent in styles.css */
const INK = '#ffffff';         /* --gold-ink: what writing on the gold wears */

/* The mono stack the site sets its figures in. The SVG favicon is drawn by
   the browser, so it says the stack; the PNGs are drawn here, by whatever the
   machine resolves "monospace" to. */
const MONO = 'ui-monospace, SF Mono, Cascadia Mono, Roboto Mono, DejaVu Sans Mono, Menlo, monospace';

/* The mark in a 64-unit box. `rx` is the corner; `scale` shrinks the figures
   toward the centre for the maskable icon, whose outer fifth may be cut away. */
function mark({ rx = 14, scale = 1 } = {}) {
  const t = scale === 1 ? '' : ` transform="translate(32 32) scale(${scale}) translate(-32 -32)"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <rect width="64" height="64" rx="${rx}" fill="${GOLD}"/>
  <text x="31" y="45" text-anchor="middle"${t}
        font-family="${MONO}"
        font-size="25" font-weight="800" letter-spacing="-1.8" fill="${INK}">#1</text>
</svg>
`;
}

/* file, size, drawing */
const PNGS = [
  ['favicon-32.png',           32, mark()],
  ['apple-touch-icon-180.png', 180, mark({ rx: 0 })],
  ['icon-192.png',            192, mark()],
  ['icon-512.png',            512, mark()],
  ['icon-512-maskable.png',   512, mark({ rx: 0, scale: 0.72 })],
];

/* Width and height out of a PNG's first chunk, so --check needs no library. */
function pngSize(buf) {
  if (buf.length < 24 || buf.toString('ascii', 1, 4) !== 'PNG') return null;
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}

if (process.argv.includes('--check')) {
  let rele = 0;
  const fav = join(icons, 'favicon.svg');
  if (!existsSync(fav) || readFileSync(fav, 'utf8') !== mark()) { console.error('make-icons: icons/favicon.svg is stale'); rele++; }
  for (const [f, size] of [...PNGS.map(([f, s]) => [join('icons', f), s]), ['og-image.png', [1200, 630]]]) {
    const cale = join(root, f);
    const vreau = Array.isArray(size) ? size : [size, size];
    const am = existsSync(cale) ? pngSize(readFileSync(cale)) : null;
    if (!am || am[0] !== vreau[0] || am[1] !== vreau[1]) {
      console.error(`make-icons: ${f} is ${am ? am.join('x') : 'missing'}, expected ${vreau.join('x')}`); rele++;
    }
  }
  if (rele) { console.error('make-icons: run npm i --no-save sharp && node scripts/make-icons.mjs'); process.exit(1); }
  console.log(`make-icons: favicon.svg, ${PNGS.length} icons and og-image.png present and current.`);
  process.exit(0);
}

let sharp;
try { sharp = (await import('sharp')).default; }
catch (e) {
  console.error('make-icons: needs sharp to draw the PNGs. Run: npm i --no-save sharp');
  process.exit(2);
}

/* Drawn at eight times the size and scaled down, so the edges of the figures
   are smooth at 32px rather than stepped. */
async function png(svg, size, out) {
  const box = svg.includes('viewBox="0 0 64 64"') ? 64 : 1200;
  const density = 72 * Math.max(1, (size * 2) / box);
  await sharp(Buffer.from(svg), { density }).resize(size).png({ compressionLevel: 9 }).toFile(out);
}

writeFileSync(join(icons, 'favicon.svg'), mark());
console.log('  icons/favicon.svg');
for (const [f, size, svg] of PNGS) {
  await png(svg, size, join(icons, f));
  console.log(`  icons/${f}  (${size} x ${size})`);
}
console.log('make-icons: done.');

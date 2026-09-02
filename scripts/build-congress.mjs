#!/usr/bin/env node
/**
 * Every sitting member of Congress, from the source that keeps them current.
 *
 * unitedstates/congress-legislators is the public-domain dataset the civic-tech
 * world keeps up to date — a hand-written list of 535 names would be wrong the
 * week after an election, and wrong quietly.
 *
 * The portraits come with them. Official congressional photographs are works
 * of the United States government and therefore public domain, which is why
 * this board can carry real faces where the party board mostly cannot: a
 * party's emblem is its committee's registered mark, a senator's official
 * portrait belongs to everyone.
 *
 * Only the bioguide id is stored. The address is built from it, so 537
 * portraits cost 537 short strings rather than 537 URLs.
 *
 *   node scripts/build-congress.mjs
 *   node scripts/build-congress.mjs --check
 */
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'congress.json');
const SRC = 'https://unitedstates.github.io/congress-legislators/legislators-current.json';
const PHOTOS = 'https://unitedstates.github.io/images/congress/225x275/';
const MAX_AGE_DAYS = 30;

async function build() {
  const r = await fetch(SRC, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`congress-legislators: HTTP ${r.status}`);
  const rows = await r.json();

  const membri = [];
  for (const m of rows) {
    const t = (m.terms || [])[m.terms.length - 1] || {};
    const nume = (m.name || {}).official_full
      || [m.name?.first, m.name?.last].filter(Boolean).join(' ');
    const id = (m.id || {}).bioguide;
    if (!nume || !id) continue;
    /* Senator or Representative, the state, and the party — the three things
       that tell two people with the same surname apart, which on a list this
       long is most of the job. */
    const rol = t.type === 'sen' ? 'Senator' : 'Representative';
    membri.push([nume, id, `${rol}, ${t.state || '??'}`, t.party || '']);
  }

  if (membri.length < 400) {
    console.error(`build-congress: only ${membri.length} members came back, expected ~535.`);
    process.exit(2);
  }
  membri.sort((a, b) => a[0].localeCompare(b[0]));
  return { builtAt: new Date().toISOString(), photos: PHOTOS, members: membri };
}

if (process.argv.includes('--check')) {
  if (!existsSync(OUT)) {
    console.error('build-congress: congress.json is missing. Run: node scripts/build-congress.mjs');
    process.exit(1);
  }
  let age = Infinity;
  try {
    const t = Date.parse(JSON.parse(readFileSync(OUT, 'utf8')).builtAt);
    if (Number.isFinite(t)) age = (Date.now() - t) / 86400000;
  } catch (e) { /* undated is as good as missing */ }
  if (age > MAX_AGE_DAYS) {
    console.warn(`build-congress: ${age.toFixed(0)} days old — members change. Rerun when convenient.`);
  } else {
    console.log(`build-congress: ${age.toFixed(1)} days old, fine.`);
  }
  process.exit(0);
}

const data = await build();
const json = JSON.stringify(data);
writeFileSync(OUT, json);
const sen = data.members.filter(m => m[2].startsWith('Senator')).length;
console.log(`build-congress: ${data.members.length} sitting members `
  + `(${sen} senators, ${data.members.length - sen} representatives), ${(json.length / 1024).toFixed(0)} KB`);

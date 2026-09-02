#!/usr/bin/env node
/**
 * Do the names I typed actually exist?
 *
 * Most of the lists on this site come from an API and correct themselves.
 * These do not: clubs, players, drivers, artists, films, marques, yards,
 * golfers, actors, cities, podcasts and the influencer handles were written
 * out by hand, and a misspelling in one of them is a name somebody has to
 * work around to pay.
 *
 * A Wikipedia page is not proof a name is current, and its absence is not
 * proof a name is wrong — a podcast or an Instagram handle may simply not
 * have one. What this finds is the class of mistake worth finding: a name
 * spelled in a way nothing in the world recognises.
 *
 *   node scripts/check-names.mjs            # everything hand-written
 *   node scripts/check-names.mjs actors     # one board
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const UA = 'TopTenOne/1.0 (https://topten.one; support@rotabo.app)';
const GAP = 220;

/* The handle boards are skipped: @khaby.lame has no encyclopaedia article and
   is not misspelled, so asking about it only produces noise. */
const SARI = new Set(['x-influencers', 'instagram-influencers', 'tiktok-influencers',
                      'youtube-influencers', 'facebook-influencers',
                      'us-parties', 'us-politicians']);

const sleep = ms => new Promise(r => setTimeout(r, ms));

const rosters = JSON.parse(readFileSync(join(root, 'rosters.json'), 'utf8'));
const cerute = process.argv.slice(2).filter(a => !a.startsWith('-'));
const boards = Object.keys(rosters).filter(b =>
  cerute.length ? cerute.includes(b) : !SARI.has(b));

async function exists(name) {
  const u = 'https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*'
    + '&list=search&srlimit=1&srsearch=' + encodeURIComponent(name);
  const r = await fetch(u, { headers: { accept: 'application/json', 'user-agent': UA } });
  if (!r.ok) return { ok: null, why: `HTTP ${r.status}` };
  const d = await r.json();
  const hit = (d.query?.search || [])[0];
  if (!hit) return { ok: false, why: 'nothing found' };
  /* An exact title match is a clean pass. Anything else is reported with what
     Wikipedia thought you meant, because that is usually the correction. */
  const same = hit.title.toLowerCase() === name.toLowerCase();
  return { ok: same, why: same ? '' : `closest: ${hit.title}` };
}

let suspecte = 0, verificate = 0;
for (const board of boards) {
  const rele = [];
  for (const row of rosters[board]) {
    const name = row[0];
    verificate++;
    try {
      const v = await exists(name);
      if (v.ok === false) rele.push(`${name}  — ${v.why}`);
    } catch (e) {
      rele.push(`${name}  — ${e.message}`);
    }
    await sleep(GAP);
  }
  if (rele.length) {
    suspecte += rele.length;
    console.log(`\n${board} (${rele.length} of ${rosters[board].length} worth a look)`);
    for (const r of rele) console.log('  ' + r);
  } else {
    console.log(`${board}: all ${rosters[board].length} match a Wikipedia title exactly`);
  }
}

console.log(`\ncheck-names: ${verificate} names, ${suspecte} worth a look.`);
console.log('An exact title match is a pass. Everything else is reported with what');
console.log('Wikipedia thought was meant — often the spelling, sometimes just a fuller title.');

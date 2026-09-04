#!/usr/bin/env node
/**
 * Tell the crawlers a page changed, instead of waiting for them to find out.
 *
 * IndexNow is one POST: the host, a key it can fetch from the site root to
 * prove the submission is ours, and the list of addresses. Bing, Yandex,
 * Seznam and Naver read it, and share it with each other. Google does not
 * take part -- it accepts URLs through Search Console and nowhere else -- so
 * nothing here does anything for Google, and saying otherwise would be the
 * easiest lie to tell about it.
 *
 * Run from the deploy workflow, after the site is actually serving the new
 * files. Submitting an address the crawler then finds unchanged is the one
 * thing IndexNow asks you not to do, so this submits only after a push that
 * changed something a visitor can see, and only addresses that answer 200.
 *
 *   node scripts/indexnow.mjs             submits
 *   node scripts/indexnow.mjs --dry-run   prints what it would submit
 *
 * INDEXNOW_HOST and INDEXNOW_KEY come from the workflow.
 */
import { execFileSync } from 'node:child_process';

const HOST = process.env.INDEXNOW_HOST || '';
const KEY = process.env.INDEXNOW_KEY || '';
const uscat = process.argv.includes('--dry-run');

if (!HOST || !KEY) {
  console.error('indexnow: INDEXNOW_HOST and INDEXNOW_KEY must be set');
  process.exit(2);
}

/* What a visitor can see. A change to the README, to a workflow, or to the
   scripts that generate things is not a change to the site, and a submission
   for it is noise the protocol explicitly asks us not to make. */
const CONTEAZA = /\.(html|css|js|json|xml|svg|png|jpe?g|webp|txt)$/i;
const NU_CONTEAZA = /^(\.github\/|scripts\/|supabase\/|tests\/|README|worker\/)/i;

function schimbate() {
  /* The push's own range when the workflow gives it, the last commit
     otherwise -- a first push, or a run started by hand, has no before. */
  const inainte = process.env.INDEXNOW_BEFORE || '';
  const gama = inainte && !/^0+$/.test(inainte) ? `${inainte}..HEAD` : 'HEAD~1..HEAD';
  try {
    return execFileSync('git', ['diff', '--name-only', gama], { encoding: 'utf8' })
      .split('\n').map(s => s.trim()).filter(Boolean);
  } catch (e) {
    /* A shallow clone with one commit in it: treat everything as changed
       rather than silently submitting nothing. */
    return ['index.html'];
  }
}

const fisiere = schimbate();
const vazut = fisiere.filter(f => CONTEAZA.test(f) && !NU_CONTEAZA.test(f));
if (!vazut.length) {
  console.log(`indexnow: ${fisiere.length} files changed, none of them the site. Nothing submitted.`);
  process.exit(0);
}

/* The sitemap is the list of what this site wants indexed, and it is
   generated, so it is always the current one. Every address in it is
   submitted rather than only the pages whose files changed: on these sites
   one stylesheet or one script is every page, and working out which of the
   two kinds of change happened is more ways to be wrong than it is worth. */
const sitemap = await (await fetch(`https://${HOST}/sitemap.xml`, {
  headers: { 'user-agent': `IndexNow/1.0 (+https://${HOST})` },
})).text();
const adrese = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1].trim());

if (!adrese.length) {
  console.error(`indexnow: no <loc> in https://${HOST}/sitemap.xml — nothing submitted`);
  process.exit(1);
}

/* Checked before they are announced. An address that 404s spends the site's
   credit with the crawler and is the reason a submission gets ignored. */
const bune = [];
for (let i = 0; i < adrese.length; i += 8) {
  await Promise.all(adrese.slice(i, i + 8).map(async u => {
    try {
      const r = await fetch(u, { headers: { 'user-agent': `IndexNow/1.0 (+https://${HOST})` } });
      if (r.ok) bune.push(u);
      else console.warn(`  ${u} answers ${r.status} — left out`);
    } catch (e) { console.warn(`  ${u}: ${e.message} — left out`); }
  }));
}

if (!bune.length) { console.error('indexnow: not one address answered — nothing submitted'); process.exit(1); }

console.log(`indexnow: ${vazut.length} of ${fisiere.length} changed files are the site; ${bune.length} of ${adrese.length} addresses answer.`);
if (uscat) { bune.forEach(u => console.log('  ' + u)); console.log('indexnow: --dry-run, nothing sent.'); process.exit(0); }

const r = await fetch('https://api.indexnow.org/indexnow', {
  method: 'POST',
  headers: { 'content-type': 'application/json; charset=utf-8' },
  body: JSON.stringify({ host: HOST, key: KEY, keyLocation: `https://${HOST}/${KEY}.txt`, urlList: bune }),
});

/* 200 and 202 both mean taken. Anything else is worth a red run: a 403 is
   the key file gone from the site root, and that is silent otherwise. */
if (r.status !== 200 && r.status !== 202) {
  console.error(`indexnow: ${HOST} -> HTTP ${r.status} ${r.statusText} ${(await r.text()).slice(0, 200)}`);
  process.exit(1);
}
console.log(`indexnow: ${bune.length} addresses submitted for ${HOST} — HTTP ${r.status}.`);

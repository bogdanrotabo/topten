#!/usr/bin/env node
/**
 * Photographs for the Actors board, from Wikimedia Commons — and only from
 * Commons.
 *
 * Wikipedia serves two kinds of image from the same host and the path says
 * which: /wikipedia/commons/ is Wikimedia Commons, where everything is freely
 * licensed, and /wikipedia/en/ is the English Wikipedia's local upload area,
 * which exists precisely to hold non-free files it uses under US fair use.
 * Film posters live in the second one. Fair use on an encyclopaedia does not
 * carry over to a site that sells rank, so this script takes the first and
 * refuses the second — mechanically, on the URL, not on judgement.
 *
 * Commons licences are mostly CC-BY-SA, which wants the author credited. So
 * the author and the licence come along with the file and the site shows
 * them. A photograph used without its credit is not a free photograph.
 *
 *   node scripts/build-people-art.mjs
 *   node scripts/build-people-art.mjs --check
 */
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'people-art.json');
const MAX_AGE_DAYS = 60;
const GAP = 1100;
const UA = 'TopTenOne/1.0 (https://topten.one; support@rotabo.app)';

const fold = s => String(s).toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[$.'’-]/g, '')
  .replace(/\s+/g, ' ')
  .trim();

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* Every board whose subject is a person or an organisation with a page. Kept
   in one file but keyed by board, because a name can mean two different
   things on two different boards and each should get its own picture. */
const TOATE = ['actors', 'us-politicians', 'us-parties', 'football-players',
               'f1-drivers', 'golf-players', 'artists',
               'nba-players', 'nhl-players', 'football-clubs',
               'ufc-fighters', 'mma-fighters', 'boxers',
               'bellator', 'one-championship', 'pfl', 'movements'];

/* Name boards on the command line to rebuild only those; without any, all of
   them. Rebuilding seven boards to check one costs ten minutes of somebody
   else's rate limit. Whatever is not rebuilt is carried over from the file
   that is already there, so a partial run never loses the rest. */
const cerute = process.argv.slice(2).filter(a => !a.startsWith('--'));
const BOARDS = cerute.length ? TOATE.filter(b => cerute.includes(b)) : TOATE;

/* A name that is not a board here was silently dropped, so a typo ran the
   script, printed a success line and changed nothing anybody asked for. */
const necunoscute = cerute.filter(b => !TOATE.includes(b));
if (necunoscute.length) {
  console.error('build-people-art: not a board with pictures: ' + necunoscute.join(', '));
  console.error('  the ones that are: ' + TOATE.join(', '));
  process.exit(2);
}

/* Both quote styles. A name with an apostrophe in it — Baldur's Gate,
   Schindler's List — has to be written with double quotes in the roster, and
   the first version of this only ever looked for single ones, so those names
   were silently skipped and their art never fetched. */
/* Three places hold rosters and all three are read. Most live in
   scripts/rosters.mjs; the NBA and NHL players are fetched from the leagues
   into scripts/sport-rosters.json; and a short list written straight into
   app.js is still possible. Looking in only the first place is why the two
   sport boards had no photographs at all -- not a decision, just a list the
   builder could not see -- so it now looks everywhere a roster can be. */
function wanted(board) {
  const sport = join(root, "scripts/sport-rosters.json");
  if (existsSync(sport)) {
    const d = JSON.parse(readFileSync(sport, "utf8"));
    if (Array.isArray(d[board]) && d[board].length) return d[board].map(r => r[0]);
  }
  for (const [fisier, adancime] of [["scripts/rosters.mjs", "  "], ["app.js", "    "]]) {
    const src = readFileSync(join(root, fisier), "utf8");
    const re = new RegExp(`'?${board}'?: \\[([\\s\\S]*?)\\n${adancime}\\],?`);
    const m = re.exec(src);
    if (!m) continue;
    const nume = [...m[1].matchAll(/\[\s*(?:'([^']*)'|"([^"]*)")/g)].map(x => x[1] ?? x[2]);
    if (nume.length) return nume;
  }
  console.error(`build-people-art: no ${board} list in scripts/rosters.mjs or app.js`);
  process.exit(2);
}

const get = async (u, attempt = 1) => {
  const r = await fetch(u, { headers: { accept: 'application/json', 'user-agent': UA } });
  if ((r.status === 429 || r.status >= 500) && attempt <= 4) {
    await sleep(1500 * attempt);
    return get(u, attempt + 1);
  }
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
};

/* Parties are looked up differently, and the reason is a trap I fell into.
 *
 * A party's Wikipedia article shows its official logo, and that logo is the
 * committee's registered mark — hosted locally, non-free, refused. Taking the
 * article thumbnail therefore found nothing for the Republicans, the
 * Democrats, the Libertarians or the Greens: the four that matter most.
 *
 * But Commons does hold party marks — "Republican Disc.svg" and the 2025
 * Democratic logo are both public domain there — they simply are not what the
 * article puts at the top. So this searches the file namespace by name, keeps
 * only what is freely licensed, and takes the file whose title is closest to
 * the party's own. A state chapter's logo is a near miss and a wrong answer,
 * so a title that folds to something other than the party name is refused.
 */
/* Files checked by hand because Commons search will not surface them.
 *
 * "Republican Disc.svg" is public domain and is the national mark, and the
 * search returns eight state chapters before it — ranking, not licensing. A
 * name in this list is not a guess: each was fetched and its licence read
 * before being written down. The search runs first regardless, so a better
 * answer found live still wins. */
const STIUTE = {
  'republican party': 'File:Republican Disc.svg'
};

async function lookParty(name) {
  /* Two searches, because the wording decides what comes back: "Republican
     Party logo" finds state chapters, and "Republican Party" finds the disc
     that is actually the national mark. Both, deduplicated, then judged. */
  const hits = [];
  for (const q of [`${name} logo`, name]) {
    try {
      const found = await get('https://commons.wikimedia.org/w/api.php?action=query&format=json'
        + '&origin=*&list=search&srnamespace=6&srlimit=8&srsearch=' + encodeURIComponent(q));
      for (const h of found.query?.search || []) if (!hits.includes(h.title)) hits.push(h.title);
    } catch (e) { /* one query failing is not both failing */ }
    await sleep(GAP);
  }
  if (!hits.length) return null;

  await sleep(GAP);
  const meta = await get('https://commons.wikimedia.org/w/api.php?action=query&format=json'
    + '&origin=*&prop=imageinfo&iiprop=extmetadata|url&iiurlwidth=200&titles='
    + encodeURIComponent(hits.slice(0, 12).join('|')));

  const cheie = fold(name);
  let best = null;
  for (const page of Object.values(meta.query?.pages || {})) {
    const ii = (page.imageinfo || [])[0];
    if (!ii) continue;
    const ex = ii.extmetadata || {};
    const plain = v => String(v?.value || '').replace(/<[^>]*>/g, '').trim();
    const lic = plain(ex.LicenseShortName) || plain(ex.License);
    /* Free or nothing. "Fair use" and "Non-free" are the words that matter. */
    if (!lic || /non-?free|fair use|copyright/i.test(lic)) continue;

    const titlu = fold(String(page.title || '')
      .replace(/^File:/i, '').replace(/\.(svg|png|jpe?g)$/i, '')
      .replace(/\b(logo|disc|symbol|emblem|seal|us|usa|united states|alternate|positive|profile|\d{4})\b/gi, ''));

    /* Every word in the file's title has to be a word in the party's name.
       "Republican Disc" keeps only "republican", which is in "republican
       party", so it passes; "Arizona Republican Party" carries "arizona",
       which is not, so it does not — and a state chapter's logo on the
       national party would be a near miss, which is the worst kind of wrong
       answer because it looks right. */
    const cuvinte = titlu.split(' ').filter(Boolean);
    const aleLui = new Set(cheie.split(' '));
    if (!cuvinte.length || !cuvinte.every(w => aleLui.has(w))) continue;

    /* More of the party's name matched is a better match, and an SVG beats a
       bitmap at 32px. */
    const scor = cuvinte.length * 10 + (/\.svg$/i.test(page.title) ? 2 : 1);
    if (!best || scor > best.scor) {
      /* Commons appends its own tracking query to thumbnails. It is not part
         of the address and it doubles the length of every one of them. */
      const curat = String(ii.thumburl || ii.url || '').split('?')[0];
      best = { scor, img: curat, autor: plain(ex.Artist) || 'Unknown',
               licenta: lic, pagina: ii.descriptionurl || ('https://commons.wikimedia.org/wiki/'
                 + encodeURIComponent(page.title)) };
    }
  }
  if (best) {
    const { scor, ...rest } = best;
    return rest;
  }

  const stiut = STIUTE[fold(name)];
  return stiut ? fisierStiut(stiut) : null;
}

/* One named file, fetched and checked. Even a file I looked at myself is
   checked again here: a licence can be re-tagged, and a name hard-coded into
   a script is exactly the kind of thing that stops being true without
   anybody noticing. */
async function fisierStiut(stiut) {
  await sleep(GAP);
  const m = await get('https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*'
    + '&prop=imageinfo&iiprop=extmetadata|url&iiurlwidth=200&titles=' + encodeURIComponent(stiut));
  const pg = Object.values(m.query?.pages || {})[0] || {};
  const ii = (pg.imageinfo || [])[0];
  if (!ii) return null;
  const ex = ii.extmetadata || {};
  const plain = v => String(v?.value || '').replace(/<[^>]*>/g, '').trim();
  const lic = plain(ex.LicenseShortName) || plain(ex.License);
  if (!lic || /non-?free|fair use|copyright/i.test(lic)) return null;
  return {
    img: String(ii.thumburl || ii.url || '').split('?')[0],
    autor: plain(ex.Artist) || 'Unknown',
    licenta: lic,
    pagina: ii.descriptionurl || ('https://commons.wikimedia.org/wiki/' + encodeURIComponent(stiut))
  };
}

/* The club crests, named one by one, and no search anywhere near them.

   Searching Commons for a crest is not merely unreliable, it is confidently
   wrong. Asked for Tottenham Hotspur it offers the Carolina Panthers logo,
   photographed at their stadium. Sevilla gets a newspaper, Celtic a music
   group, FC Porto a Brazilian club, Manchester City the city council, and
   "Ajax logo.svg" -- public domain, titled exactly right -- is the household
   cleaner. Every one of those looks like a hit and would put another
   organisation's mark on a board somebody paid to be on.

   So each of these was found, opened, and read: the categories and the
   description on the file's own page say which club it belongs to, and the
   licence is checked again below at build time in case it is ever re-tagged.

   The clubs that are not here are not here because their current crest is
   not freely licensed anywhere. For the English clubs there is nothing at
   all -- Commons has a Newton Heath badge from 1878 and photographs of a
   stand, and an 1878 badge presented as Manchester United is a worse answer
   than the two letters they have now. Real Madrid, Barcelona, Sevilla and
   Benfica are the same story with older crests. They keep their initials,
   which is honest. */
const CLUBURI = {
  'juventus': 'File:Juventus FC - logo black (Italy, 2020).svg',
  'ac milan': 'File:Logo of AC Milan.svg',
  'inter milan': 'File:Inter Milano 2021 logo with 2 stars.svg',
  'borussia dortmund': 'File:Borussia Dortmund logo.svg',
  'bayern munich': 'File:FC Bayern München logo (2017).svg',
  'paris saintgermain': 'File:Paris Saint-Germain F.C. logo (free version).svg',
  'olympique de marseille': 'File:Olympique de Marseille 2026 logo.svg',
  'galatasaray': 'File:Galatasaray S.K. Logo 2026.svg',
  'fenerbahce': 'File:Fenerbahçe Spor Kulübü (logo, 1923).svg',
  'boca juniors': 'File:Escudo del Club Atlético Boca Juniors 2012.svg',
  'river plate': 'File:Escudo rojo River Plate.png',
  'flamengo': 'File:Clube de Regatas do Flamengo logo.svg',
  'al hilal': 'File:Al-Hilal-Logo.png',
  'fcsb': 'File:Fcsb-logo.svg',
  'dinamo bucuresti': 'File:FC Dinamo București - logo 2026.svg',
};

/* Movement marks, named one by one for the same reason the club crests are.

   A movement is not an organisation and mostly has no mark at all -- what
   Commons holds under these names is photographs of people holding things.
   MAGA is the exception: the campaign wordmark carrying the slogan is public
   domain there, categorised under Make America Great Again, and it is the
   nearest thing to an official mark that exists. It is a campaign wordmark
   and not a movement logo, because the movement has no logo; that is worth
   knowing rather than papering over.

   Everything else on that board keeps its initials, which is honest: no
   search runs here, so nothing can quietly become the wrong organisation. */
const MISCARI = {
  'maga': 'File:Trump logo (red).png',
};

async function lookMovement(name) {
  const stiut = MISCARI[fold(name)];
  return stiut ? fisierStiut(stiut) : null;
}

async function lookClub(name) {
  const stiut = CLUBURI[fold(name)];
  if (!stiut) return null;
  return fisierStiut(stiut);
}

/** The file behind the summary thumbnail, and what Commons says about it. */
async function look(name) {
  const title = encodeURIComponent(name.replace(/ /g, '_'));
  const sum = await get(`https://en.wikipedia.org/api/rest_v1/page/summary/${title}`);
  const thumb = (sum.thumbnail || {}).source || '';

  /* The whole rule, in one line. Anything not on Commons is not ours. */
  if (!/\/wikipedia\/commons\//.test(thumb)) return null;

  const file = decodeURIComponent(
    (/\/commons\/(?:thumb\/)?[0-9a-f]\/[0-9a-f]{2}\/([^/]+)/.exec(thumb) || [])[1] || '');
  if (!file) return null;

  await sleep(GAP);
  const meta = await get('https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*'
    + '&prop=imageinfo&iiprop=extmetadata|url&titles=' + encodeURIComponent('File:' + file));
  const page = Object.values(meta.query?.pages || {})[0] || {};
  const ex = page.imageinfo?.[0]?.extmetadata || {};
  const plain = v => String(v?.value || '').replace(/<[^>]*>/g, '').trim();

  return {
    img: thumb.split('?')[0],
    autor: plain(ex.Artist) || 'Unknown',
    licenta: plain(ex.LicenseShortName) || plain(ex.License) || 'see Commons',
    pagina: 'https://commons.wikimedia.org/wiki/' + encodeURIComponent('File:' + file)
  };
}

if (process.argv.includes('--check')) {
  if (!existsSync(OUT)) {
    console.error('build-people-art: people-art.json is missing. Run: node scripts/build-people-art.mjs');
    process.exit(1);
  }
  let age = Infinity;
  try {
    const t = Date.parse(JSON.parse(readFileSync(OUT, 'utf8')).builtAt);
    if (Number.isFinite(t)) age = (Date.now() - t) / 86400000;
  } catch (e) { /* unreadable is as good as undated */ }
  if (age > MAX_AGE_DAYS) console.warn(`build-people-art: ${age.toFixed(0)} days old. Rerun when convenient.`);
  else console.log(`build-people-art: ${age.toFixed(1)} days old, fine.`);
  process.exit(0);
}

const art = existsSync(OUT)
  ? (JSON.parse(readFileSync(OUT, 'utf8')).art || {})
  : {};
let gasit = 0, refuzat = 0;

/* Every list found before a single request goes out. wanted() stops the
   script when a board has no list anywhere, and it used to be called inside
   the loop -- so naming two boards where the second had no list spent a
   minute fetching the first, then exited before writing anything, and the
   work was simply gone. Whatever is going to fail should fail before the
   work, not after it. */
const LISTE = new Map(BOARDS.map(b => [b, wanted(b)]));

for (const board of BOARDS) {
  art[board] = {};
  let g = 0, r = 0;
  for (const n of LISTE.get(board)) {
    try {
      const hit = board === 'us-parties' ? await lookParty(n)
                : board === 'movements' ? await lookMovement(n)
                : board === 'football-clubs' ? await lookClub(n)
                : await look(n);
      if (hit) { art[board][fold(n)] = hit; g++; }
      else r++;
    } catch (e) {
      console.warn(`  ${board}/${n}: ${e.message}`);
    }
    await sleep(GAP);
  }
  gasit += g; refuzat += r;
  console.log(`  ${board.padEnd(18)} ${String(g).padStart(2)} from Commons`
    + (r ? `, ${r} not free to use` : ''));
}

writeFileSync(OUT, JSON.stringify({ builtAt: new Date().toISOString(), art }));
console.log(`build-people-art: ${gasit} pictures across ${BOARDS.length} boards`
  + (refuzat ? `, ${refuzat} skipped — not on Commons, so not ours to use` : ''));

#!/usr/bin/env node
/**
 * The checks a change has to pass before it goes out.
 *
 *   node scripts/check.mjs
 *
 * The first one exists because of a real bug: a line of app.js was written as
 * `+ ? '…'`, which is a syntax error, and `node --check` waved it through --
 * it parses a file as a script, and app.js is a module. The whole result page
 * silently did nothing in the browser. So the browser files are parsed the way
 * a browser parses them, as modules.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const bad = [];

/* 1. Every file the browser loads as a module has to parse as one.
      The import is expected to FAIL at run time -- app.js reaches for `window`
      the moment it is evaluated, and there is no window here. A SyntaxError is
      the only failure that means the file is broken; anything else means it
      parsed, which is what is being asked. */
for (const f of ['lib.js', 'render.js', 'app.js']) {
  try {
    await import(pathToFileURL(join(root, f)).href);
  } catch (e) {
    if (e instanceof SyntaxError) bad.push(`${f} does not parse as a module: ${e.message}`);
  }
}

/* The three classic scripts, which are not modules and are checked as what
   they are. config.js is the one every page depends on.
   scripts/build.mjs is deliberately absent from both lists: importing it would
   RUN it, and a checker that rebuilds the site as a side effect of checking it
   is a checker nobody will trust. CI runs the build for real instead, which is
   a better check than parsing it. */
for (const f of ['config.js', 'dashboard.js', 'ga.js']) {
  try {
    new Function(readFileSync(join(root, f), 'utf8'));
  } catch (e) {
    bad.push(`${f} does not parse: ${e.message}`);
  }
}

/* 1b. Every name app.js uses from lib.js or render.js has to be imported.
      This exists because of a real bug: figures() and figuresNote() were added
      to render.js and called from app.js, and the import line was never
      updated -- it already carried a ?v= stamp from the build, so the edit
      that was meant to add them matched nothing and said so to nobody. The
      file parsed perfectly. The front page's numbers then threw
      "figuresNote is not defined" on every load, which is a class of mistake
      the parse check above cannot see, because it is not a parse error.

      Deliberately blunt: it asks whether a word that one of those modules
      exports appears in app.js without being on an import line. A name in a
      comment or a string would be a false alarm; a false alarm here costs one
      look, and the thing it prevents costs a broken page. */
{
  const app = readFileSync(join(root, 'app.js'), 'utf8');
  const imported = new Set(
    [...app.matchAll(/import\s*\{([^}]*)\}\s*from\s*'\.\/(?:lib|render)\.js[^']*'/g)]
      .flatMap((m) => m[1].split(',').map((x) => x.trim().split(/\s+as\s+/).pop().trim()))
      .filter(Boolean));

  const body = app.replace(/import\s*\{[^}]*\}\s*from\s*'[^']*';/g, '');
  for (const f of ['lib.js', 'render.js']) {
    const src = readFileSync(join(root, f), 'utf8');
    const names = [...src.matchAll(/export\s+(?:function|const|let)\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]);
    for (const n of names) {
      if (imported.has(n)) continue;
      if (new RegExp('(?<![\\w$.])' + n + '\\s*\\(').test(body)) {
        bad.push(`app.js calls ${n}() but never imports it from ${f}`);
      }
    }
  }
}

/* 2. The registry and the pages have to agree: one directory per board, and
      no board directory the registry has forgotten. */
const reg = JSON.parse(readFileSync(join(root, 'boards.json'), 'utf8'));
const slugs = new Set(reg.boards.map((b) => b.slug));
for (const b of reg.boards) {
  if (!existsSync(join(root, b.slug, 'index.html'))) bad.push(`${b.slug}/ has no page`);
}
const known = new Set(['icons', 'og', 'scripts', 'supabase', 'node_modules', '.git', '.github',
  'back', 'thanks', 'claim', 'find', 'badge']);
for (const d of readdirSync(root, { withFileTypes: true })) {
  if (!d.isDirectory() || known.has(d.name) || d.name.startsWith('.')) continue;
  if (!slugs.has(d.name)) bad.push(`${d.name}/ is a page the registry does not know about`);
}

/* 3. Every class the markup writes has to exist in the stylesheet. The old
      version of this check compared two renderers; there is one now, so what
      is left to catch is a class nobody styled. */
const css = readFileSync(join(root, 'styles.css'), 'utf8');
const styled = new Set([...css.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]));
const unstyled = new Set();
for (const f of ['render.js', 'app.js', 'scripts/build.mjs']) {
  const text = readFileSync(join(root, f), 'utf8');
  /* Only class attributes that are whole literals. A class built by
     concatenation puts the surrounding JavaScript inside the quotes, and
     reading that as class names finds an arrow-function parameter and calls
     it an unstyled class. */
  for (const m of text.matchAll(/class="([a-zA-Z][\w -]*)"/g)) {
    for (const c of m[1].split(/\s+/)) {
      if (c && /^[a-zA-Z][\w-]*$/.test(c) && !styled.has(c)) unstyled.add(`${c} (in ${f})`);
    }
  }
}
for (const c of unstyled) bad.push(`class ${c} is written and styled nowhere`);

if (bad.length) {
  for (const b of bad) console.error(`check: ${b}`);
  process.exit(1);
}
console.log(`check: ${reg.boards.length} boards, 6 script files, `
  + `${styled.size} styled classes — all present and parsing.`);

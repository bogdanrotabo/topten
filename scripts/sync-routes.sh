#!/usr/bin/env bash
# Everything that has to happen between editing this site and pushing it.
#
#   bash scripts/sync-routes.sh
#
# Four jobs, in this order, because each one depends on the last:
#
# 1. Write the king into the page.
#
#    index.html is drawn by app.js after it has talked to Supabase, so what a
#    crawler is handed says "the throne is empty" whoever is on it, and a link
#    posted anywhere previews with no name and no figure. scripts/prerender.mjs
#    bakes the current king, the former kings and the social card in from the
#    same views the site reads. It needs the network; without one it leaves the
#    page as it is and says so, and the build carries on.
#
# 2. Write the content security policy.
#
#    scripts/build-csp.mjs computes it, including the hash of the one inline
#    script each page carries. A hash typed by hand is wrong the first time
#    somebody edits the script it stands for, and the way it is wrong is that
#    the page stops working.
#
# 3. Stamp the asset URLs with a hash of their own contents.
#
#    GitHub Pages serves these with max-age=600 and Cloudflare caches on top,
#    so for ten minutes after a deploy a visitor can be running the old app
#    against the new page -- which looks exactly like the deploy not having
#    happened. A changed file gets a changed URL and is fetched at once; an
#    unchanged one still comes from cache. No purging, no waiting.
#
# 4. Give every route a real file.
#
#    /claim  -> claim/index.html    (200, where Stripe sends a payer back)
#    /thanks -> thanks/index.html   (200, the address the Payment Link used
#                                    before /claim existed, kept so an old
#                                    success URL still lands somewhere real)
#    anything else -> 404.html      (renders, with a 404 status)
#
#    All three are byte-identical copies of index.html. app.js reads the query
#    string and the path and decides what to draw, so a session id works on
#    whichever of them Stripe is pointed at.

set -euo pipefail
cd "$(dirname "$0")/.."

node scripts/prerender.mjs
node scripts/build-csp.mjs

STAMP=$(cat app.js styles.css config.js | sha1sum | cut -c1-10)
echo "  asset stamp: $STAMP"

for f in index.html about.html terms.html privacy.html; do
  # Replace any existing ?v=... and stamp the bare ones, in one pass.
  sed -i -E "s#(\"/(app|config)\.js|\"/styles\.css)(\?v=[a-f0-9]+)?\"#\1?v=$STAMP\"#g" "$f"
  echo "  stamped $f"
done

mkdir -p thanks claim

for target in 404.html thanks/index.html claim/index.html; do
  cp index.html "$target"
  echo "  $target"
done

echo "  done."

#!/usr/bin/env bash
# Two jobs, both of which must happen after any edit to index.html or the assets.
#
# 1. Stamp the asset URLs with a hash of their own contents.
#
#    GitHub Pages serves these with max-age=600 and Cloudflare caches them on
#    top, so for ten minutes after a deploy a visitor can be running the old
#    app against the new page — which looked exactly like "the change did not
#    happen". A content hash in the query string means a changed file is a
#    changed URL, so it is fetched immediately and an unchanged one still comes
#    from cache. No purging, no waiting.
#
# 2. Give every SPA route a real file.
#
#    /thanks -> thanks/index.html   (200, and Stripe redirects here)
#    /badge/ -> badge/index.html    (200, so link previews work)
#    anything else -> 404.html      (renders, but with a 404 status)
#
#    All three are byte-identical copies of index.html; app.js reads the path
#    and decides what to draw.
#
#     bash scripts/sync-routes.sh

set -euo pipefail
cd "$(dirname "$0")/.."

STAMP=$(cat app.js styles.css config.js | sha1sum | cut -c1-10)
echo "  asset stamp: $STAMP"

for f in index.html about.html terms.html privacy.html; do
  # Replace any existing ?v=... and stamp the bare ones, in one pass.
  sed -i -E "s#(\"/(app|config)\.js|\"/styles\.css)(\?v=[a-f0-9]+)?\"#\1?v=$STAMP\"#g" "$f"
  echo "  stamped $f"
done

mkdir -p thanks badge

for target in 404.html thanks/index.html badge/index.html; do
  cp index.html "$target"
  echo "  $target"
done

echo "Routes synced from index.html"

#!/usr/bin/env bash
# GitHub Pages serves static files only, so every SPA route needs a real file.
#
#   /thanks   -> thanks/index.html   (200, and Stripe redirects here)
#   /badge/   -> badge/index.html    (200, so link previews work)
#   anything else -> 404.html        (renders, but with a 404 status)
#
# All three are byte-identical copies of index.html; app.js reads the path and
# decides what to draw. Re-run this after editing index.html:
#
#     bash scripts/sync-routes.sh

set -euo pipefail
cd "$(dirname "$0")/.."

mkdir -p thanks badge

for target in 404.html thanks/index.html badge/index.html; do
  cp index.html "$target"
  echo "  $target"
done

echo "Routes synced from index.html"

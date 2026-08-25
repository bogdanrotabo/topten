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

# 3. Give every platform board a page of its own.
#
#    /?p=tiktok used to serve the same bytes as /?p=x and as the homepage, so a
#    crawler saw eleven URLs and one document, and indexed one. The board is
#    drawn by JavaScript after load, so the only thing that makes these separate
#    documents is a head of their own: title, description and canonical. Those
#    are rewritten here rather than kept in eleven hand-edited files.

PLATFORMS="x|X instagram|Instagram tiktok|TikTok youtube|YouTube facebook|Facebook telegram|Telegram snapchat|Snapchat twitch|Twitch linkedin|LinkedIn threads|Threads"

SITEMAP=sitemap.xml
{
  echo '<?xml version="1.0" encoding="UTF-8"?>'
  echo '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
  echo "  <url><loc>https://topten.one/</loc><changefreq>hourly</changefreq><priority>1.0</priority></url>"
} > "$SITEMAP"

for entry in $PLATFORMS; do
  slug="${entry%%|*}"
  name="${entry##*|}"
  title="Top 10 on $name — TopTen.one"
  desc="The ten most-paid $name profiles right now. Rank is decided by money paid, not by an algorithm. Add yours from \$2."
  # Trailing slash: GitHub Pages answers /x with a 301 to /x/, so declaring the
  # bare form canonical would point every board at a redirect.
  url="https://topten.one/$slug/"

  mkdir -p "$slug"
  sed -e "s|<title>.*</title>|<title>$title</title>|" \
      -e "s|<meta name=\"description\" content=\"[^\"]*\">|<meta name=\"description\" content=\"$desc\">|" \
      -e "s|<link rel=\"canonical\" href=\"[^\"]*\">|<link rel=\"canonical\" href=\"$url\">|" \
      -e "s|<meta property=\"og:title\" content=\"[^\"]*\">|<meta property=\"og:title\" content=\"$title\">|" \
      -e "s|<meta property=\"og:description\" content=\"[^\"]*\">|<meta property=\"og:description\" content=\"$desc\">|" \
      -e "s|<meta property=\"og:url\" content=\"[^\"]*\">|<meta property=\"og:url\" content=\"$url\">|" \
      -e "s|<meta name=\"twitter:title\" content=\"[^\"]*\">|<meta name=\"twitter:title\" content=\"$title\">|" \
      -e "s|<meta name=\"twitter:description\" content=\"[^\"]*\">|<meta name=\"twitter:description\" content=\"$desc\">|" \
      index.html > "$slug/index.html"

  echo "  <url><loc>$url</loc><changefreq>hourly</changefreq><priority>0.9</priority></url>" >> "$SITEMAP"
  echo "  $slug/index.html"
done

for page in about terms privacy; do
  echo "  <url><loc>https://topten.one/$page.html</loc><changefreq>monthly</changefreq><priority>0.3</priority></url>" >> "$SITEMAP"
done
echo '</urlset>' >> "$SITEMAP"
echo "  $SITEMAP"

echo "Routes synced from index.html"

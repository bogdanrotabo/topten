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

# slug|Board-Name|noun. Three fields, space separated, so every field is one
# word: a board name written with hyphens is put back with spaces below, and
# the noun is what that board actually lists. "The ten most-paid Crypto
# profiles" describes nothing -- coins do not have profiles.
PLATFORMS="x|X|profiles instagram|Instagram|profiles tiktok|TikTok|profiles youtube|YouTube|channels facebook|Facebook|pages telegram|Telegram|channels snapchat|Snapchat|profiles twitch|Twitch|streamers linkedin|LinkedIn|profiles threads|Threads|profiles playstation|PlayStation|gamertags xbox|Xbox|gamertags nintendo|Nintendo|friend-codes nba-teams|NBA-Teams|clubs nba-players|NBA-Players|players nhl-teams|NHL-Teams|clubs nhl-players|NHL-Players|players crypto|Crypto|coins memecoins|Memecoins|coins gifts|Gifts-and-Airdrops|giveaways football-clubs|Football-Clubs|clubs football-players|Football-Players|players f1-drivers|F1-Drivers|drivers artists|Artists|artists games|Games|games cities|Cities|cities pets|Pets|pets startups|Startups|startups restaurants|Restaurants|restaurants podcasts|Podcasts|podcasts x-influencers|X-Influencers|creators tiktok-influencers|TikTok-Influencers|creators youtube-influencers|YouTube-Influencers|creators facebook-influencers|Facebook-Influencers|creators"

SITEMAP=sitemap.xml
{
  echo '<?xml version="1.0" encoding="UTF-8"?>'
  echo '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
  echo "  <url><loc>https://topten.one/</loc><changefreq>hourly</changefreq><priority>1.0</priority></url>"
} > "$SITEMAP"

for entry in $PLATFORMS; do
  slug="${entry%%|*}"
  rest="${entry#*|}"
  name="${rest%%|*}"
  noun="${rest##*|}"
  # The list is space separated, so a two-word board name is written with a
  # hyphen and put back here. "Top 10 on NBA-Teams" is not a title.
  name="${name//-/ }"
  noun="${noun//-/ }"
  title="Top 10 on $name — TopTen.one"
  desc="The ten most-paid $name $noun right now. Rank is decided by money paid, not by an algorithm. Add yours from \$2."
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

# Check our own work before saying it is done.
#
# This script died halfway once because it was run as `sync-routes.sh | head -3`:
# under `set -o pipefail` the SIGPIPE from head killed it after the third line,
# so index.html got the new stamp while 404.html and every board page kept the
# old one and went on loading the previous app.js. The site looked deployed and
# the fix was not live. A partial run must fail loudly instead.

FOUND=$(grep -ohE 'app\.js\?v=[a-f0-9]+' \
          index.html 404.html thanks/index.html badge/index.html \
          about.html terms.html privacy.html ./*/index.html | sort -u)

if [ "$(printf '%s\n' "$FOUND" | wc -l)" -ne 1 ] || [ "$FOUND" != "app.js?v=$STAMP" ]; then
  echo "FAILED: pages disagree about which app.js to load" >&2
  printf '%s\n' "$FOUND" >&2
  exit 1
fi

# 4. And check that the boards actually agree, everywhere they are written
#    down. A board drawn in app.js that the database rejects takes somebody's
#    money for a listing that cannot be inserted; this is where that gets
#    caught, not in production.
node "$(dirname "$0")/check-boards.mjs"

echo "Routes synced from index.html — every page on $STAMP"

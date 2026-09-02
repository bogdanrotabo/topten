# The badge-preview Worker

## What it is for

Somebody pays to be #1, shares their badge, and the preview says **"TopTen.one
— rankings decided by money"** with the site's own picture. Not their name, not
their rank, not what they paid. The badge is the thing people share, and the
share said nothing about them.

The site is static: `/badge/?p=x&h=name` is the same `index.html` as every
other page, and its head is written before anybody knows which listing is being
asked for. A crawler does not run JavaScript, so app.js cannot fix it — the
head has to be right when the response leaves the server.

This Worker sits in front of GitHub Pages on `/badge` only. It reads the
listing, and rewrites the seven tags a preview reads:

| Before | After |
| --- | --- |
| TopTen.one — rankings decided by money | @supportrotabo is #1 on X — TopTen.one |
| 43 boards, ten places each… | @supportrotabo holds #1 on the X board with $306.99 paid. Pay more than the person above you: $307.99 takes first place. |

Everything else on the site goes straight to GitHub Pages, untouched, exactly
as it does today.

## Deploying it

```sh
cd worker
npx wrangler deploy
```

The first run opens a browser to log in. Nothing needs filling in: the routes
are in `wrangler.toml`, and the Supabase key it reads with is the same public
anon key `config.js` already hands to every browser.

To take it off again:

```sh
npx wrangler delete --name topten-badge
```

The site returns to what it does today. Nothing else depends on it.

## Trying it before deploying

```sh
python3 -m http.server 8899          # the site itself, from the repo root
cd worker && npx wrangler dev --var ORIGIN:http://127.0.0.1:8899
curl -s 'http://127.0.0.1:8787/badge/?p=x&h=supportrotabo' | grep '<title>'
```

`ORIGIN` exists only for this. In production the Worker fetches the request's
own URL, which Cloudflare sends to the origin rather than back through the
Worker; under `wrangler dev` that is not true and it would call itself for
ever.

## What cannot break

Every path out of this returns the origin's own response, unmodified:

- the board is not one of the 43
- there is no handle in the link
- the handle is not on that board
- Supabase is down, slow, or answers with anything but a list
- any exception at all, anywhere in the rewrite

That is not a theory. The first working version threw on every request — a
class field called `text` is read by HTMLRewriter as a text-node handler, not
as a string — and the only symptom was that the preview stayed generic. Which
is the failure this is supposed to have.

## `src/boards.json`

Generated from the `PLATFORMS` list in `app.js` by
`scripts/build-worker-boards.mjs`, and checked by `scripts/sync-routes.sh`. A
second hand-written list of forty-three boards is the kind of thing that goes
stale quietly: a board added to app.js and forgotten here would share as
`undefined`.

## What this does not do

`og:image` is still the site's own picture, the same for every badge. A picture
of the listing — the rank, the name, the amount, in the badge's own colours —
means rasterising an SVG on the request, which costs about 70ms of CPU. The
Workers **free** plan allows 10ms per request, so that needs the paid plan.
Everything above works on either.

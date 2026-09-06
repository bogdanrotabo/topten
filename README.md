# TopTen.one

**One page. One king. Pay more than them and it's yours.**

There is a single position on a single page. Whoever has paid the most for it
holds it — their name, their message and their link *are* the page — and the
only way to take it is to pay more than they did. A payment that does not beat
the sitting king is kept and shown publicly as an attempt. No accounts, no
algorithm, no expiry, no refunds.

**Live:** https://topten.one · **Stack:** static HTML/JS on GitHub Pages ·
Supabase (Postgres + RLS + Realtime + two Edge Functions) · Stripe Payment Link ·
Cloudflare DNS

> This replaced a pay-to-rank leaderboard: 72 boards, ten places on each, ranked
> by the total paid towards each listing. Everything about it — the boards, the
> per-platform pages, the profile-URL parsing, the rank window function, the
> admin console — is gone. `supabase/migrations/0019_king_of_the_hill.sql` is
> the whole of that removal and the whole of what replaced it.

---

## The mechanic

1. `reigns` holds every reign ever. Exactly one row has `dethroned_at is null`;
   that is the king.
2. A payment **greater than** the king's `amount_cents` crowns the payer at once
   and stamps `dethroned_at = now()` on the old king.
3. A payment **equal to or less than** it becomes a row in `attempts`, hung off
   the reign it failed against. The money is kept. Nothing is refunded.
4. On an empty throne, any payment of one whole unit of the currency or more
   takes it. (Stripe's own minimum on the link is higher, so this floor is never
   the thing that decides.)
5. A reign is **one payment**. There are no top-ups: a second payment is judged
   against whoever is king when it settles, which may be the payer themselves.
6. A reign lasts until it is outpaid. There is no expiry.

Three rules are the schema's job rather than the application's:

- **There is at most one king.** `reigns_one_king_idx` is a unique index on
  `(dethroned_at is null)`, partial `where dethroned_at is null`. Every row on
  the throne carries the same value in that expression, so the index admits one.
  A plain unique index on `dethroned_at` would admit all of them — nulls are
  distinct.
- **The browser never writes money.** There is no insert, update or delete
  policy for `anon` on either table. `crown_or_attempt()` is the only writer and
  only `service_role` may execute it.
- **`edit_token` and `stripe_session_id` never leave the server.** Three
  independent locks: `anon` has no column privilege on either; no public view
  selects them; and the replication stream carries an explicit column list that
  leaves them out, so they are not withheld from Realtime, they are never
  decoded into it.

---

## Files

| Path | What it is |
|---|---|
| `index.html` | The page. The only one with anything live on it. |
| `app.js` | Draws the king, the attempts and the history; runs the claim. |
| `styles.css` | Dark. Only dark — there is no theme switch any more. |
| `config.js` | The only file with environment values. **Not secret.** |
| `about.html`, `terms.html`, `privacy.html` | Flat pages. No JavaScript. |
| `404.html`, `thanks/`, `claim/` | Copies of `index.html` — see *Routing*. |
| `supabase/migrations/0019_king_of_the_hill.sql` | The pivot: tables, views, RLS, functions, realtime. |
| `supabase/functions/stripe-webhook/index.ts` | The only path that can crown anybody. |
| `supabase/functions/claim/index.ts` | Swaps a session id for the edit key, once; writes the card. |
| `scripts/prerender.mjs` | Bakes the king and the history into `index.html` at build time. |
| `scripts/sync-routes.sh` | The build. Run it after editing anything. |
| `scripts/build-csp.mjs` | Computes the content security policy, hashes included. |
| `scripts/stripe-setup.sh` / `.ts` | Creates the Stripe objects from scratch. **Not for the live account.** |
| `scripts/make-icons.mjs` | Draws the icons and `og-image.png` from one mark. |
| `scripts/serve.ps1` | Local static server that mimics GitHub Pages routing. |

### Routing

GitHub Pages serves static files only, so every route needs a real file.
`claim/index.html`, `thanks/index.html` and `404.html` are byte-identical copies
of `index.html`; `app.js` reads the query string and the path and decides what
to draw.

`/claim?session_id=…` is where Stripe sends a payer back. `/thanks` is the
address the Payment Link pointed at before the pivot and is kept as a copy so an
old success URL still lands on a page that works — **a session id is honoured on
whatever path it arrives on**, so the two are interchangeable.

**After editing anything, run:**

```bash
bash scripts/sync-routes.sh
```

It prerenders, writes the policy, stamps the asset URLs (`/app.js?v=…`) with a hash of
their own contents, and re-copies the three route files. GitHub Pages
serves the assets with `max-age=600` and Cloudflare caches on top, so without
the stamp a visitor spends ten minutes running the old app against the new page
— which is indistinguishable from the deploy not having happened.

### Why the king is baked into the HTML

`index.html` is drawn by `app.js` after it has talked to Supabase. A person
never notices; a crawler is handed a document whose `<main>` says *the throne is
empty* no matter who is on it, and a link posted anywhere previews as a card
with no name and no figure. For a site that is one page about one person, that
is the entire search and social presence missing.

`scripts/prerender.mjs` writes the king, the former kings, the figure to beat
and the social card into the page at build time, from the same views the site
reads at run time. `app.js` replaces the first three within a second of load
with the same content and live figures — the same thing arriving twice, not two
different claims. The figures go stale between deploys by design: a number that
was true when the site was built is a fair thing to publish.

The Open Graph title is `Current king: {name} — {amount}` and the description is
the king's own message, so a shared link says who is on the page and what it
cost them.

---

## Setup

### 1. Supabase

Project `topten`, region `eu-central-1`, ref `iezclmijwrtjibgflfqj`.

```bash
supabase link --project-ref <ref>
supabase db push
supabase functions deploy stripe-webhook --no-verify-jwt
supabase functions deploy claim
```

`--no-verify-jwt` on the webhook is required: Stripe cannot send a Supabase JWT,
so that function authenticates callers itself by verifying the Stripe signature.
`claim` keeps JWT verification **on** — the page calls it with the same
publishable key it already carries, so requiring one costs a visitor nothing and
keeps a bare `curl` from reaching the database.

Realtime needs both tables in the `supabase_realtime` publication; the migration
adds them, with a column list. If live updates ever stop, the page still corrects
itself every 25 seconds and whenever the tab is refocused — a socket that fails
quietly must not look like a quiet day.

Put the project URL and the **anon** key into `config.js`. Both are public; RLS
and the column privileges are what protect the data.

### 2. Stripe

**Nothing here creates or edits a Stripe object, and the pivot did not.** The
product, price, payment link and webhook endpoint on the live account are the
ones that were already there:

| | |
|---|---|
| Product | `prod_V8W8qy1wEaSS1r` |
| Price | `price_1U8F7b2eIfG2oegbO92AoF9x` (USD, `custom_unit_amount`, min $2) |
| Payment link | `plink_1U8F7c2eIfG2oegb4npVFInN` |
| Webhook | `we_1U8F7d2eIfG2oegbq6i4BACB` |
| Success URL | **must be** `https://topten.one/claim?session_id={CHECKOUT_SESSION_ID}` |

> **The success URL is the one thing that has to change by hand.** It was
> `https://topten.one/thanks?listing={CHECKOUT_SESSION_CLIENT_REFERENCE_ID}`,
> which named which listing to credit. There are no listings. A payer who comes
> back without a `session_id` cannot be told what their payment bought and cannot
> be given the key to their card — the payment still counts, and the page still
> updates, but they land on a page that can only say "nothing to claim".
> Edit it in the Stripe dashboard: Payment links → the link → Edit → After
> payment → Redirect to a URL.

The link is now opened **plain**, with no query string. It used to carry
`client_reference_id=<listing id>`; a payment says nothing but its own amount and
the webhook decides what that buys.

`scripts/stripe-setup.sh` rebuilds all of it from scratch on a *different*
account. It creates fresh objects every run, so running it against the live
account gives you a second payment link nobody is using. Two things the Stripe
API taught us the hard way, both handled in the script:

- **A tax code is mandatory.** Managed Payments is on by default and refuses to
  build a payment link for a product without one. The product carries
  `txcd_10000000` (General – Electronically Supplied Services).
- **A single payment is capped at $10,000** unless
  [Stripe support](https://support.stripe.com/contact/) lifts it. The script
  probes for the highest maximum the account will accept.

### 3. Google Analytics

`GA_MEASUREMENT_ID` in `config.js`. Empty disables analytics entirely — no
script is loaded.

### 4. GitHub Pages

Push to `main`, then Settings → Pages → Source: **Deploy from a branch**, branch
`main`, folder `/ (root)`. The `CNAME` file sets the custom domain. There is no
Cloudflare Pages project and no build command in a dashboard anywhere: the build
is `bash scripts/sync-routes.sh`, run before you commit.

### 5. DNS — Porkbun and Cloudflare

The domain is registered at **Porkbun**; DNS is served by **Cloudflare** (free
plan), which also fronts GitHub Pages.

| Type | Name | Content |
|---|---|---|
| A | `@` | `185.199.108.153` |
| A | `@` | `185.199.109.153` |
| A | `@` | `185.199.110.153` |
| A | `@` | `185.199.111.153` |
| CNAME | `www` | `bogdanrotabo.github.io` |

> **Start with the proxy OFF (grey cloud).** GitHub has to reach the domain
> directly to issue its TLS certificate and cannot do that through Cloudflare's
> proxy. Wait until GitHub Pages shows *"DNS check successful"* and **Enforce
> HTTPS** becomes tickable, then switch to proxied and set SSL/TLS → **Full**.
> Leaving it on *Flexible* with the proxy on causes a redirect loop.

**SSL/TLS → Edge Certificates → Always Use HTTPS: ON.** Without it Cloudflare
serves `http://topten.one` as a plain 200 and never upgrades the scheme; Chrome's
HTTPS-First mode then shows *"this site can't provide a secure connection"* on
mobile, and `crypto.randomUUID()` is undefined because the page is not a secure
context. A valid certificate is not enough; the redirect has to exist:

```bash
curl -sSI http://topten.one/ | grep -i '^location'   # must print https://topten.one/
```

---

## Local development

```bash
powershell -ExecutionPolicy Bypass -File scripts/serve.ps1
```

Serves the repo on <http://localhost:8080> with the same routing rules as GitHub
Pages. It talks to the real Supabase project, so anything you do locally is live
data.

`window.TopTen` exposes `money`, `duration`, `ago`, `state` and `load` in the
console.

Node 22+ is needed for `scripts/`, and only for the build.

---

## Moderation

There is no admin UI. A king writes their own name, message and link, and that
is the entire product — so the way to take something down is to blank it:

Supabase dashboard → Table Editor → `reigns` → set `name`, `message` and `url`
to null on the offending row. The page corrects itself within seconds and the
reign is untouched, which is what the terms promise: what somebody wrote can be
removed, what they paid is not refunded.

The same works on a row in the history. `attempts` carries only a name.

---

## Things worth knowing

- **The owner is told when somebody pays.** A trigger on each of `reigns` and
  `attempts` calls rotabo.app's `notify` function with nothing but a row id;
  that function reads the details back through `alerta_plata()`, which refuses
  anything older than thirty minutes. It used to hang off `payments`, which no
  longer exists. Same contract, same function name, so the alerts did not
  silently switch themselves off in the pivot.
- **The edit key is handed over exactly once.** `claim_reign()` stamps
  `token_claimed_at` the first time a session id is exchanged for it. A second
  visit to the same success URL gets the card and no key. The key lives in that
  browser's `localStorage` and nowhere else; there is no way to reissue it,
  which is the price of having no accounts.
- **A dethroned king may still edit their own row.** It is in the history for as
  long as the site exists, and refusing somebody the correction of their own
  typo forever is not a rule worth having.
- **Replays are safe.** `crown_or_attempt()` is idempotent on
  `stripe_session_id` and checks it under the lock, so two deliveries of the
  same event cannot both find nothing and both act.
- **Simultaneous payments are ordered, not raced.** A transaction-level advisory
  lock queues every crowning. Locking the king's row alone would be enough while
  a king exists and nothing at all on an empty throne, which is exactly when two
  first payments could collide. Verified with thirty concurrent payments: one
  king, every payment accounted for, the king holding the highest figure.
- **Delayed payments.** `checkout.session.completed` can arrive with
  `payment_status: unpaid`. Those are skipped; the
  `checkout.session.async_payment_succeeded` event for the same session is read
  the same way when the money settles.
- **Currency.** The link is USD. If Stripe ever converts via adaptive pricing,
  the figures are compared as plain minor units — wrong across currencies, and
  less wrong than dropping somebody's payment on the floor. It is loud in the
  function logs.
- **`site_visits`, `site_presence` and `admin_emails` are still there.** They
  counted visitors, not ranks, and dropping them would have thrown away the only
  record of how much traffic this domain has ever had. Nothing reads them now
  that the admin console is gone.

### The two Supabase advisor warnings are deliberate

1. **`claim_reign`, `edit_reign` and `crown_or_attempt` are `SECURITY DEFINER`.**
   They have to be: they read and write columns that no client role can see.
   `EXECUTE` is revoked from `public`, `anon` and `authenticated` on all three,
   so only the two Edge Functions — which hold the service role — can call them.
2. **`alerta_plata` is `SECURITY DEFINER` and callable by `anon`.** It has to
   be. rotabo.app's `notify` function holds this project's publishable key and
   nothing else, and the uuid it must already know is the real gate. What it
   returns is on the page for everyone to read anyway, and only for thirty
   minutes.

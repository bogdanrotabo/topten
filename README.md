# TopTen.one

A pay-to-rank leaderboard for social profiles. One Top 10 board per platform,
ranked purely by the total money paid towards each listing. No accounts, no
algorithm, no refunds.

**Live:** https://topten.one · **Stack:** static HTML/JS on GitHub Pages ·
Supabase (Postgres + RLS + Realtime + one Edge Function) · Stripe Payment Links ·
Cloudflare DNS

---

## How the money works

1. Someone pastes a profile URL and picks an amount. The browser inserts a
   listing row with `total_cents = 0` and sends them to a Stripe Payment Link
   carrying `client_reference_id = <listing id>`.
2. Stripe charges them and calls the `stripe-webhook` Edge Function.
3. The function verifies the Stripe signature, then calls `credit_payment()`,
   which records the payment and adds the amount to the listing in one
   transaction.
4. Rank is `total_cents DESC, last_paid_at ASC` within a platform. Realtime
   pushes the change to every open board.

**The browser never writes money.** `anon` has no `UPDATE` grant on `listings`,
and a `BEFORE INSERT` trigger overwrites `total_cents`, `last_paid_at` and
`hidden` on every insert. A forged insert claiming $999,999 lands as `0`.

A listing is visible only while `last_paid_at > now() - 30 days`. Expiring
preserves the total, so one new payment restores the full historical amount.

---

## Files

| Path | What it is |
|---|---|
| `index.html` | The single page. All routes render into it. |
| `app.js` | Boards, validation, price ladder, realtime, badge, confetti. |
| `styles.css` | Dark theme, gold accent, mobile first. |
| `config.js` | The only file with environment values. **Not secret.** |
| `404.html`, `thanks/`, `badge/` | Copies of `index.html` — see *Routing*. |
| `supabase/migrations/0001_init.sql` | Tables, view, RLS, trigger, functions, cron. |
| `supabase/functions/stripe-webhook/index.ts` | The only path that credits money. |
| `scripts/stripe-setup.sh` | Creates the Stripe objects with plain `curl`. |
| `scripts/stripe-setup.ts` | Same thing for Deno / Node 22+. |
| `scripts/make-icons.ps1` | Generates the PNG icons and `og-image.png`. |
| `scripts/serve.ps1` | Local static server that mimics GitHub Pages routing. |
| `scripts/sync-routes.sh` | Re-copies `index.html` into the route files. |

### Routing

GitHub Pages serves static files only, so every route needs a real file.
`thanks/index.html` and `badge/index.html` are byte-identical copies of
`index.html` that return **200** — which matters because Stripe redirects to
`/thanks` and because link previews ignore 404 responses. `404.html` catches
anything else so path-style badge links still render.

**After editing `index.html`, re-run:**

```bash
bash scripts/sync-routes.sh
```

---

## Setup

### 1. Supabase

Project `topten`, region `eu-central-1`, ref `iezclmijwrtjibgflfqj`. Already
created, migrated and deployed. To rebuild it from scratch elsewhere:

```bash
supabase link --project-ref <ref>
supabase db push
supabase functions deploy stripe-webhook --no-verify-jwt
```

`--no-verify-jwt` is required: Stripe cannot send a Supabase JWT, so the
function authenticates callers itself by verifying the Stripe signature.

Put the project URL and the **anon** key into `config.js`. Both are public;
RLS is what protects the data.

### 2. Stripe

Copy `.env.example` to `.env` and add a restricted key with write access to
Products, Prices, Payment Links and Webhook Endpoints. Then:

```bash
bash scripts/stripe-setup.sh
```

It creates the product, a price with `custom_unit_amount` (USD, minimum $2, and
the highest maximum Stripe accepts), a Payment Link, and the webhook endpoint
pointing at the Edge Function. It writes the payment link into `config.js` and
stores `STRIPE_WEBHOOK_SECRET` in Supabase Secrets, then prints everything.

`.env` is git-ignored. Never commit it.

**What already exists on the live account:**

| | |
|---|---|
| Product | `prod_V8W8qy1wEaSS1r` |
| Price | `price_1U8F7b2eIfG2oegbO92AoF9x` |
| Payment link | `plink_1U8F7c2eIfG2oegb4npVFInN` |
| Webhook | `we_1U8F7d2eIfG2oegbq6i4BACB` |
| Success URL | `https://topten.one/thanks?listing={CHECKOUT_SESSION_CLIENT_REFERENCE_ID}` |

Two things the Stripe API taught us the hard way, both now handled in the script:

- **A tax code is mandatory.** Managed Payments is enabled by default on new
  accounts and refuses to build a payment link for a product without one. The
  product carries `txcd_10000000` (General – Electronically Supplied Services).
- **A single payment is capped at $10,000.** `custom_unit_amount.maximum` will
  not accept anything higher without asking
  [Stripe support](https://support.stripe.com/contact/) to lift it. `MAX_CENTS`
  in `app.js` mirrors that limit, so the amount picker refuses larger figures
  instead of letting someone hit the wall at checkout. It caps one payment, not
  a listing: totals are cumulative, so paying repeatedly climbs as high as you
  like. If support ever raises the ceiling, bump `MAX_CENTS` — the setup script
  already probes for a higher one on each run.

### 3. Google Analytics

Put the GA4 measurement ID into `GA_MEASUREMENT_ID` in `config.js`. Leaving it
empty disables analytics entirely — no script is loaded.

### 4. GitHub Pages

Push to `main`, then Settings → Pages → Source: **Deploy from a branch**,
branch `main`, folder `/ (root)`. The `CNAME` file already sets the custom
domain to `topten.one`.

### 5. DNS — Porkbun and Cloudflare

The domain is registered at **Porkbun**; DNS is served by **Cloudflare** (free plan).

**Step 1 — Cloudflare.** Add `topten.one` as a site on the Free plan. Cloudflare
gives you two nameservers, something like `xxx.ns.cloudflare.com` and
`yyy.ns.cloudflare.com`.

**Step 2 — Porkbun.** Domain → `topten.one` → **Authoritative Nameservers** →
replace Porkbun's defaults with the two Cloudflare ones. Propagation is usually
minutes, sometimes hours.

**Step 3 — Cloudflare DNS records.** Create exactly these:

| Type | Name | Content | Proxy |
|---|---|---|---|
| A | `@` | `185.199.108.153` | see note |
| A | `@` | `185.199.109.153` | see note |
| A | `@` | `185.199.110.153` | see note |
| A | `@` | `185.199.111.153` | see note |
| CNAME | `www` | `bogdanrotabo.github.io` | see note |

> **Start with the proxy OFF (grey cloud).** GitHub has to reach the domain
> directly to issue its TLS certificate, and it cannot do that through
> Cloudflare's proxy. Wait until GitHub Pages shows *"DNS check successful"* and
> **Enforce HTTPS** becomes tickable, then switch the records to proxied
> (orange cloud) and set SSL/TLS → Overview → **Full**. Leaving it on *Flexible*
> with the proxy on causes a redirect loop.

Add `MX`/`TXT` records for `hello@topten.one` separately — email is not part
of this setup.

---

## Local development

No build step and no Node required.

```bash
powershell -ExecutionPolicy Bypass -File scripts/serve.ps1
```

Serves the repo on <http://localhost:8080> with the same routing rules as
GitHub Pages. It talks to the real Supabase project, so anything you submit
locally is live data.

`window.TopTen` exposes `parseProfile`, `nextDollarAbove`, `clampMin`,
`rankFor` and `money` in the browser console for poking at the logic.

---

## Moderation

There is no admin UI. To hide a listing, open the Supabase dashboard →
Table Editor → `listings` and set `hidden = true`. It disappears from the board
immediately and can never be relisted at that URL — `lookup_listing()` refuses
to return hidden rows, so a duplicate submission dead-ends instead of reviving it.

Every card has a **Report** link that opens a mailto to `hello@topten.one`
with the listing id filled in.

Unpaid listings are deleted after 24 hours by the `topten-purge-unpaid` pg_cron
job, so nobody can squat a `(platform, url)` slot for free.

---

## Things worth knowing

- **Badge link previews are generic.** `/badge/` returns 200 with the site-wide
  Open Graph image; the per-rank card is drawn client side. X and Facebook
  crawlers do not run JavaScript, so they show the generic image rather than a
  personalised one. A Cloudflare Worker in front of `/badge/*` that injects
  per-listing OG tags is the upgrade path.
- **Currency.** The payment link is USD. If Stripe ever converts via adaptive
  pricing, the webhook still credits `amount_total` and logs an error, rather
  than silently dropping a customer's payment off the board.
- **Delayed payments.** `checkout.session.completed` can arrive with
  `payment_status: unpaid`. Those are logged and skipped — unsettled money buys
  no rank.
- **Replays are safe.** `credit_payment()` is idempotent on
  `stripe_session_id`, so a redelivered webhook cannot double-credit.

### The three Supabase advisor warnings are deliberate

Running the database linter reports three items. All are the design, not defects:

1. **`payments` has RLS enabled with no policies.** That *is* the lock. RLS on
   plus zero policies means the anon key cannot read or write the table at all;
   only the service role, which the Edge Function uses, gets through.
2. **`lookup_listing` is `SECURITY DEFINER` and callable by `anon`.** It has to
   be. A duplicate submission needs the id of a row that RLS deliberately hides
   (unpaid, or expired). The function returns a bare uuid, refuses hidden rows,
   and requires the exact platform plus fully normalized URL. The uuid it
   returns only lets you *add money* to that listing, which anyone is allowed to
   do anyway.
3. Same warning again for the `authenticated` role — there are no accounts, so
   nothing ever holds that role.

`credit_payment` is also `SECURITY DEFINER`, but `EXECUTE` is revoked from
`public`, `anon` and `authenticated`, so it does not appear in the report.
Calling it with the anon key returns `permission denied for function`.

#!/usr/bin/env bash
# TopTen.one — create the Stripe objects and wire the webhook secret into Supabase.
#
# Runs on plain curl. No Node, no Deno, no Stripe CLI. From the repo root:
#
#     bash scripts/stripe-setup.sh
#
# Reads .env (git-ignored). Safe to re-run: it creates fresh objects each time,
# so only run it again if you actually want a new payment link.

set -euo pipefail
cd "$(dirname "$0")/.."

[ -f .env ] || { echo "No .env — copy .env.example to .env and fill it in."; exit 1; }
set -a; . ./.env; set +a

: "${STRIPE_SECRET_KEY:?STRIPE_SECRET_KEY missing from .env}"

API="https://api.stripe.com/v1"
SUCCESS_URL_TEMPLATE='https://topten.one/thanks?listing={CHECKOUT_SESSION_CLIENT_REFERENCE_ID}'
SUCCESS_URL_FALLBACK='https://topten.one/thanks?session={CHECKOUT_SESSION_ID}'

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
field() { grep -o "\"$1\": *\"[^\"]*\"" | head -n1 | sed 's/.*: *"\(.*\)"/\1/'; }
failed() { grep -q '"error"' <<<"$1"; }
errmsg() { grep -o '"message": *"[^"]*"' <<<"$1" | head -n1 | sed 's/.*: *"\(.*\)"/\1/'; }

# -u takes "key:" so curl sends the key as the basic-auth user with no password.
post() { # post <path> <curl form args...>
  local path="$1"; shift
  curl -sS -X POST "$API/$path" -u "$STRIPE_SECRET_KEY:" "$@"
}

# --------------------------------------------------------------- product ----

say "1/5  Product"
# The tax code is not optional: Managed Payments is on by default for new
# accounts, and it refuses to build a payment link for a product without one.
# txcd_10000000 = General - Electronically Supplied Services, which is what a
# paid position on a board is.
PRODUCT_JSON=$(post products \
  -d "name=TopTen.one rank" \
  -d "description=A position on a TopTen.one leaderboard. Rank is the total paid." \
  -d "tax_code=txcd_10000000")

if failed "$PRODUCT_JSON"; then
  echo "Stripe refused the product: $(errmsg "$PRODUCT_JSON")"; exit 1
fi
PRODUCT_ID=$(field id <<<"$PRODUCT_JSON")
echo "     $PRODUCT_ID"

# ----------------------------------------------------------------- price ----
# custom_unit_amount lets the buyer name the amount. Stripe caps the maximum at
# $10,000.00 per payment by default and only raises it if you ask support, so
# walk down from optimistic values until one sticks. The high values stay in the
# ladder on purpose: if the cap is ever lifted for this account, the script picks
# the higher ceiling up on its own.

say "2/5  Price (customer-chosen amount, USD, min \$2)"
PRICE_ID=""
CHOSEN_MAX=""
for MAX in 99999999 9999999 1000000 999999; do
  PRICE_JSON=$(post prices \
    -d "currency=usd" \
    -d "product=$PRODUCT_ID" \
    -d "custom_unit_amount[enabled]=true" \
    -d "custom_unit_amount[minimum]=200" \
    -d "custom_unit_amount[maximum]=$MAX")
  if failed "$PRICE_JSON"; then
    echo "     maximum=$MAX rejected: $(errmsg "$PRICE_JSON")"
    continue
  fi
  PRICE_ID=$(field id <<<"$PRICE_JSON")
  CHOSEN_MAX=$MAX
  break
done

[ -n "$PRICE_ID" ] || { echo "Could not create a price at any maximum."; exit 1; }
printf '     %s  (max %s cents = $%s)\n' "$PRICE_ID" "$CHOSEN_MAX" "$((CHOSEN_MAX / 100))"

# ---------------------------------------------------------- payment link ----

say "3/5  Payment link"
LINK_JSON=$(post payment_links \
  -d "line_items[0][price]=$PRICE_ID" \
  -d "line_items[0][quantity]=1" \
  -d "after_completion[type]=redirect" \
  -d "after_completion[redirect][url]=$SUCCESS_URL_TEMPLATE")

SUCCESS_USED="$SUCCESS_URL_TEMPLATE"
if failed "$LINK_JSON"; then
  echo "     {CHECKOUT_SESSION_CLIENT_REFERENCE_ID} rejected: $(errmsg "$LINK_JSON")"
  echo "     retrying with {CHECKOUT_SESSION_ID}"
  LINK_JSON=$(post payment_links \
    -d "line_items[0][price]=$PRICE_ID" \
    -d "line_items[0][quantity]=1" \
    -d "after_completion[type]=redirect" \
    -d "after_completion[redirect][url]=$SUCCESS_URL_FALLBACK")
  SUCCESS_USED="$SUCCESS_URL_FALLBACK"
fi

if failed "$LINK_JSON"; then
  echo "Stripe refused the payment link: $(errmsg "$LINK_JSON")"; exit 1
fi

LINK_ID=$(field id <<<"$LINK_JSON")
LINK_URL=$(grep -o '"url": *"https://buy\.stripe\.com[^"]*"' <<<"$LINK_JSON" | head -n1 | sed 's/.*: *"\(.*\)"/\1/')
echo "     $LINK_ID"
echo "     $LINK_URL"

# --------------------------------------------------------------- webhook ----

say "4/5  Webhook endpoint"
WEBHOOK_URL="${SUPABASE_URL:?SUPABASE_URL missing from .env}/functions/v1/stripe-webhook"
HOOK_JSON=$(post webhook_endpoints \
  -d "url=$WEBHOOK_URL" \
  -d "enabled_events[]=checkout.session.completed" \
  -d "description=TopTen.one rank crediting")

if failed "$HOOK_JSON"; then
  echo "Stripe refused the webhook: $(errmsg "$HOOK_JSON")"; exit 1
fi
HOOK_ID=$(field id <<<"$HOOK_JSON")
HOOK_SECRET=$(grep -o '"secret": *"whsec_[^"]*"' <<<"$HOOK_JSON" | head -n1 | sed 's/.*: *"\(.*\)"/\1/')
echo "     $HOOK_ID -> $WEBHOOK_URL"

# ------------------------------------------------- write the results back ----

say "5/5  Writing config.js and Supabase secrets"

if [ -n "$LINK_URL" ]; then
  # Replace the empty STRIPE_PAYMENT_LINK value, leaving the rest of the file alone.
  tmp=$(mktemp)
  sed "s|STRIPE_PAYMENT_LINK: \"[^\"]*\"|STRIPE_PAYMENT_LINK: \"$LINK_URL\"|" config.js > "$tmp"
  mv "$tmp" config.js
  echo "     config.js updated"
fi

if [ -n "${SUPABASE_ACCESS_TOKEN:-}" ] && [ -n "${SUPABASE_PROJECT_REF:-}" ] && [ -n "$HOOK_SECRET" ]; then
  SECRET_RES=$(curl -sS -X POST \
    "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/secrets" \
    -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d "[{\"name\":\"STRIPE_WEBHOOK_SECRET\",\"value\":\"$HOOK_SECRET\"}]")
  if grep -q '"message"' <<<"$SECRET_RES"; then
    echo "     Supabase refused the secret: $SECRET_RES"
    echo "     Set it by hand: Dashboard -> Edge Functions -> Secrets -> STRIPE_WEBHOOK_SECRET"
  else
    echo "     STRIPE_WEBHOOK_SECRET stored in Supabase"
  fi
else
  echo "     No SUPABASE_ACCESS_TOKEN in .env — set the secret by hand:"
  echo "     Dashboard -> Edge Functions -> Secrets -> STRIPE_WEBHOOK_SECRET = $HOOK_SECRET"
fi

# ---------------------------------------------------------------- report ----

cat <<REPORT

────────────────────────────────────────────────────────
  Payment link   $LINK_URL
  Link id        $LINK_ID
  Price id       $PRICE_ID
  Max amount     $CHOSEN_MAX cents  (\$$((CHOSEN_MAX / 100)))
  Min amount     200 cents  (\$2)
  Webhook id     $HOOK_ID
  Webhook url    $WEBHOOK_URL
  Success url    $SUCCESS_USED
────────────────────────────────────────────────────────

The site opens the link as:
  $LINK_URL?client_reference_id=<listing_id>

REPORT

/**
 * TopTen.one — create the Stripe objects and wire the webhook secret into Supabase.
 *
 *   deno run --allow-net --allow-read --allow-write --allow-env scripts/stripe-setup.ts
 *   node --experimental-strip-types scripts/stripe-setup.ts        (Node 22+)
 *
 * Identical in effect to scripts/stripe-setup.sh, which needs only curl.
 * Reads .env from the repo root. Never commit that file.
 *
 * Creates fresh objects on every run, so re-run it only when you actually
 * want a new payment link.
 */

const API = "https://api.stripe.com/v1";
const SUCCESS_TEMPLATE = "https://topten.one/thanks?listing={CHECKOUT_SESSION_CLIENT_REFERENCE_ID}";
const SUCCESS_FALLBACK = "https://topten.one/thanks?session={CHECKOUT_SESSION_ID}";

// Stripe does not document the per-currency ceiling for custom_unit_amount,
// so try the largest plausible value and walk down until one is accepted.
const MAX_CANDIDATES = [99_999_999, 9_999_999, 999_999];
const MIN_CENTS = 200;

type Json = Record<string, any>;

async function readEnvFile(): Promise<Record<string, string>> {
  const fs = await import("node:fs/promises");
  let raw: string;
  try {
    raw = await fs.readFile(new URL("../.env", import.meta.url), "utf8");
  } catch {
    throw new Error("No .env — copy .env.example to .env and fill it in.");
  }
  const out: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

/** Stripe takes form-encoded bodies, including for nested keys like a[b][c]. */
function form(params: Record<string, string | number>): string {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
}

async function stripe(key: string, path: string, params: Record<string, string | number>): Promise<Json> {
  const res = await fetch(`${API}/${path}`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + btoa(`${key}:`),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form(params),
  });
  return await res.json() as Json;
}

const bold = (s: string) => `\n\x1b[1m${s}\x1b[0m`;

async function main() {
  const env = await readEnvFile();
  const key = env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY missing from .env");
  if (!env.SUPABASE_URL) throw new Error("SUPABASE_URL missing from .env");

  // ------------------------------------------------------------ product ---
  console.log(bold("1/5  Product"));
  const product = await stripe(key, "products", {
    name: "TopTen.one rank",
    description: "A position on a TopTen.one leaderboard. Rank is the total paid.",
  });
  if (product.error) throw new Error(`product: ${product.error.message}`);
  console.log(`     ${product.id}`);

  // -------------------------------------------------------------- price ---
  console.log(bold("2/5  Price (customer-chosen amount, USD, min $2)"));
  let price: Json | null = null;
  let chosenMax = 0;
  for (const max of MAX_CANDIDATES) {
    const attempt = await stripe(key, "prices", {
      currency: "usd",
      product: product.id,
      "custom_unit_amount[enabled]": "true",
      "custom_unit_amount[minimum]": MIN_CENTS,
      "custom_unit_amount[maximum]": max,
    });
    if (attempt.error) {
      console.log(`     maximum=${max} rejected: ${attempt.error.message}`);
      continue;
    }
    price = attempt;
    chosenMax = max;
    break;
  }
  if (!price) throw new Error("Could not create a price at any maximum.");
  console.log(`     ${price.id}  (max ${chosenMax} cents = $${chosenMax / 100})`);

  // ------------------------------------------------------- payment link ---
  console.log(bold("3/5  Payment link"));
  let successUsed = SUCCESS_TEMPLATE;
  let link = await stripe(key, "payment_links", {
    "line_items[0][price]": price.id,
    "line_items[0][quantity]": 1,
    "after_completion[type]": "redirect",
    "after_completion[redirect][url]": SUCCESS_TEMPLATE,
  });
  if (link.error) {
    console.log(`     {CHECKOUT_SESSION_CLIENT_REFERENCE_ID} rejected: ${link.error.message}`);
    console.log("     retrying with {CHECKOUT_SESSION_ID}");
    successUsed = SUCCESS_FALLBACK;
    link = await stripe(key, "payment_links", {
      "line_items[0][price]": price.id,
      "line_items[0][quantity]": 1,
      "after_completion[type]": "redirect",
      "after_completion[redirect][url]": SUCCESS_FALLBACK,
    });
  }
  if (link.error) throw new Error(`payment link: ${link.error.message}`);
  console.log(`     ${link.id}\n     ${link.url}`);

  // ------------------------------------------------------------ webhook ---
  console.log(bold("4/5  Webhook endpoint"));
  const webhookUrl = `${env.SUPABASE_URL.replace(/\/+$/, "")}/functions/v1/stripe-webhook`;
  const hook = await stripe(key, "webhook_endpoints", {
    url: webhookUrl,
    "enabled_events[]": "checkout.session.completed",
    description: "TopTen.one rank crediting",
  });
  if (hook.error) throw new Error(`webhook: ${hook.error.message}`);
  console.log(`     ${hook.id} -> ${webhookUrl}`);

  // ------------------------------------------------- write results back ---
  console.log(bold("5/5  Writing config.js and Supabase secrets"));
  const fs = await import("node:fs/promises");
  const configPath = new URL("../config.js", import.meta.url);
  const config = await fs.readFile(configPath, "utf8");
  await fs.writeFile(
    configPath,
    config.replace(/STRIPE_PAYMENT_LINK: "[^"]*"/, `STRIPE_PAYMENT_LINK: "${link.url}"`),
    "utf8",
  );
  console.log("     config.js updated");

  if (env.SUPABASE_ACCESS_TOKEN && env.SUPABASE_PROJECT_REF && hook.secret) {
    const res = await fetch(
      `https://api.supabase.com/v1/projects/${env.SUPABASE_PROJECT_REF}/secrets`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify([{ name: "STRIPE_WEBHOOK_SECRET", value: hook.secret }]),
      },
    );
    console.log(res.ok
      ? "     STRIPE_WEBHOOK_SECRET stored in Supabase"
      : `     Supabase refused the secret (${res.status}) — set it by hand.`);
  } else {
    console.log("     No SUPABASE_ACCESS_TOKEN in .env — set the secret by hand:");
    console.log(`     Edge Functions -> Secrets -> STRIPE_WEBHOOK_SECRET = ${hook.secret}`);
  }

  console.log(`
────────────────────────────────────────────────────────
  Payment link   ${link.url}
  Link id        ${link.id}
  Price id       ${price.id}
  Max amount     ${chosenMax} cents  ($${chosenMax / 100})
  Min amount     ${MIN_CENTS} cents  ($${MIN_CENTS / 100})
  Webhook id     ${hook.id}
  Webhook url    ${webhookUrl}
  Success url    ${successUsed}
────────────────────────────────────────────────────────

The site opens the link as:
  ${link.url}?client_reference_id=<listing_id>
`);
}

main().catch((err) => {
  console.error(`\n${err.message}\n`);
  (globalThis as any).process?.exit?.(1);
});

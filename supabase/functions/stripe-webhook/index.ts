// TopTen.one — Stripe webhook.
//
// The only path that can move money into a ranking. Nothing the browser sends
// decides an amount: the figure comes from Stripe and nowhere else, and what
// it credits is decided by credit_payment() inside one transaction.
//
// client_reference_id carries the listing the payer is backing. The page puts
// it there when it opens the Payment Link, Stripe hands it back untouched, and
// it is the only thing that says which of the listings this payment belongs
// to. Stripe restricts the field to letters, digits, dashes and underscores,
// so the format is:
//
//   <listing uuid>                    a plain payment
//   <listing uuid>_<visit uuid>       the same, with the visit that sent it
//
// The second half is for attribution and is ignored here; the first half is
// the money.
//
// A payment that arrives with no reference, or with one naming no listing, is
// NOT dropped. credit_payment() refuses to invent a row to credit -- correctly
// -- and the fact then goes into unmatched_payments, because the money was
// taken and somebody has to be able to find it. A log line is not a record.
//
// Deploy with verify_jwt = false: Stripe cannot send a Supabase JWT, so this
// function authenticates the caller itself by verifying the Stripe signature
// below. An unsigned or stale request never reaches the database.

const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const TOLERANCE_SECONDS = 300;

// A signed 32-bit integer, which is what amount_cents is. $10,000 is Stripe's
// cap on one payment; this is the cap on what the column can hold, and a
// figure above it is a bug somewhere rather than a customer.
const MAX_CENTS = 2147483647;

const encoder = new TextEncoder();

/** Constant-time comparison so a wrong signature leaks nothing through timing. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Verify a `Stripe-Signature` header the same way stripe.constructEvent does:
 * HMAC-SHA256 over `${timestamp}.${rawBody}`, compared against every v1
 * signature present, with a replay window.
 *
 * The returned reason is for our logs only. Callers get a flat "invalid
 * signature" — telling an unauthenticated stranger the secret's length, or a
 * fingerprint of it, hands them a way to confirm guesses.
 */
async function verifyStripeSignature(
  rawBody: string,
  header: string | null,
  secret: string,
): Promise<{ ok: boolean; reason: string }> {
  if (!secret) return { ok: false, reason: "STRIPE_WEBHOOK_SECRET is not set" };
  if (!header) return { ok: false, reason: "no stripe-signature header" };

  let timestamp = "";
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key === "t") timestamp = value;
    else if (key === "v1") signatures.push(value);
  }
  if (!timestamp || signatures.length === 0) {
    return { ok: false, reason: "malformed signature header" };
  }

  const age = Math.floor(Date.now() / 1000) - Number(timestamp);
  if (!Number.isFinite(age) || Math.abs(age) > TOLERANCE_SECONDS) {
    return { ok: false, reason: `timestamp ${age}s outside the ${TOLERANCE_SECONDS}s window` };
  }

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`${timestamp}.${rawBody}`),
  );
  const expected = toHex(mac);

  return signatures.some((sig) => safeEqual(sig, expected))
    ? { ok: true, reason: "ok" }
    : { ok: false, reason: "signature does not match the configured secret" };
}

/** Stripe's own uuid shape. Anything else is not a listing id. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Call one of the two money functions as the service role. */
async function rpc(name: string, args: Record<string, unknown>): Promise<Response> {
  return await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify(args),
  });
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405 });
  }

  const rawBody = await req.text();
  const verdict = await verifyStripeSignature(
    rawBody,
    req.headers.get("stripe-signature"),
    STRIPE_WEBHOOK_SECRET,
  );

  if (!verdict.ok) {
    // The detail goes to the function logs, never to the caller.
    console.error(`signature rejected: ${verdict.reason}`);
    return new Response("invalid signature", { status: 400 });
  }

  let event: { type?: string; data?: { object?: Record<string, unknown> } };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return new Response("bad json", { status: 400 });
  }

  // Two events carry a paid session. `checkout.session.completed` is the
  // ordinary one, a card cleared while the payer waited. A method that
  // settles later -- a bank debit, a redirect the payer finished after
  // closing the tab -- completes the session unpaid and confirms it with
  // `checkout.session.async_payment_succeeded`. Both are read the same way;
  // the payment_status check below is what decides, and it is on the session
  // in both.
  //
  // Anything else is acknowledged and dropped, so Stripe does not retry
  // events we deliberately ignore.
  if (
    event.type !== "checkout.session.completed" &&
    event.type !== "checkout.session.async_payment_succeeded"
  ) {
    console.log(`ignored ${event.type}`);
    return new Response(JSON.stringify({ ignored: event.type }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const session = (event.data?.object ?? {}) as Record<string, unknown>;
  const sessionId = String(session.id ?? "");
  const amount = Number(session.amount_total ?? 0);
  const currency = String(session.currency ?? "usd").toLowerCase();
  const paymentStatus = String(session.payment_status ?? "");
  const reference = String(session.client_reference_id ?? "").trim().slice(0, 200);

  // A completed session can still be unpaid when a delayed payment method is
  // used. Money that has not settled must not move a ranking; the
  // async_payment_succeeded event for the same session arrives when it has.
  if (paymentStatus !== "paid") {
    console.log(`session ${sessionId} ${event.type} but payment_status=${paymentStatus}`);
    return new Response(JSON.stringify({ skipped: "unpaid" }), { status: 200 });
  }

  if (!sessionId || !Number.isFinite(amount) || amount <= 0 || amount > MAX_CENTS) {
    console.error(`unusable session ${sessionId}: amount=${amount}`);
    return new Response(JSON.stringify({ skipped: "unusable" }), { status: 200 });
  }

  // The payment link is created in USD. If Stripe ever converts (adaptive
  // pricing), the figure is still added as plain minor units, which is wrong
  // across currencies and less wrong than dropping somebody's payment on the
  // floor. Loud in the logs so it is not discovered from a complaint.
  if (currency !== "usd") {
    console.error(`currency ${currency} on session ${sessionId} — credited as-is`);
  }

  // `<listing uuid>` or `<listing uuid>_<visit uuid>`.
  const listingId = reference.split("_")[0] ?? "";
  const cents = Math.round(amount);

  /** Write the payment down somewhere, when it cannot be credited. */
  const orphan = async (reason: string): Promise<Response> => {
    const res = await rpc("record_orphan_payment", {
      p_session_id: sessionId,
      p_amount_cents: cents,
      p_currency: currency,
      p_client_reference: reference || null,
      p_reason: reason,
    });
    if (!res.ok) {
      // Nothing was written anywhere. Make Stripe try again rather than
      // acknowledging a payment we have no record of.
      console.error(`record_orphan_payment failed (${res.status}): ${await res.text()}`);
      return new Response("could not record the payment", { status: 500 });
    }
    console.error(`unmatched ${cents} ${currency} on ${sessionId}: ${reason} (ref="${reference}")`);
    return new Response(JSON.stringify({ unmatched: reason }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  if (!UUID_RE.test(listingId)) {
    return await orphan(reference ? "bad_reference" : "no_reference");
  }

  const res = await rpc("credit_payment", {
    p_listing_id: listingId,
    p_session_id: sessionId,
    p_amount_cents: cents,
    p_currency: currency,
  });

  if (!res.ok) {
    // Return non-2xx so Stripe retries: the payment happened and nothing was
    // written down.
    console.error(`credit_payment failed (${res.status}): ${await res.text()}`);
    return new Response("crediting failed", { status: 500 });
  }

  const result = await res.json() as Record<string, unknown>;

  // The listing was deleted between checkout opening and the webhook landing,
  // or the reference names a row that never existed. Either way the money is
  // real, so it goes to unmatched_payments instead of into a log line.
  if (result?.reason === "unknown_listing") {
    return await orphan("unknown_listing");
  }

  console.log(`${cents} ${currency} -> ${listingId}: ${JSON.stringify(result)}`);

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});

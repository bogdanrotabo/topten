// TopTen.one — Stripe webhook.
//
// The only path that can move money onto a listing. Everything the browser
// sends is ignored here; the amount comes from Stripe and nowhere else.
//
// Deploy with verify_jwt = false: Stripe cannot send a Supabase JWT, so this
// function authenticates the caller itself by verifying the Stripe signature
// below. An unsigned or stale request never reaches the database.

const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const TOLERANCE_SECONDS = 300;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  // `checkout.session.async_payment_succeeded`, which used to be dropped here
  // as noise: money taken, rank never bought, nothing in the logs but
  // "ignored". Both are read the same way; the payment_status check below is
  // what decides, and it is on the session in both.
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
  const listingId = String(session.client_reference_id ?? "");
  const sessionId = String(session.id ?? "");
  const amount = Number(session.amount_total ?? 0);
  const currency = String(session.currency ?? "usd");
  const paymentStatus = String(session.payment_status ?? "");

  // A completed session can still be unpaid when a delayed payment method is
  // used. Money that has not settled must not buy a rank; the
  // async_payment_succeeded event for the same session arrives when it has.
  if (paymentStatus !== "paid") {
    console.log(`session ${sessionId} ${event.type} but payment_status=${paymentStatus}`);
    return new Response(JSON.stringify({ skipped: "unpaid" }), { status: 200 });
  }

  if (!UUID_RE.test(listingId) || !sessionId || !Number.isFinite(amount) || amount <= 0) {
    console.error(`unusable session ${sessionId}: ref=${listingId} amount=${amount}`);
    return new Response(JSON.stringify({ skipped: "no_listing" }), { status: 200 });
  }

  // The payment link is created in USD. If Stripe ever converts (adaptive
  // pricing), credit the payer anyway and make the mismatch loud in the logs
  // rather than silently keeping their money off the board.
  if (currency !== "usd") {
    console.error(`currency ${currency} on session ${sessionId} — credited as-is`);
  }

  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/credit_payment`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({
      p_listing_id: listingId,
      p_session_id: sessionId,
      p_amount_cents: Math.round(amount),
      p_currency: currency,
    }),
  });

  if (!res.ok) {
    // Return non-2xx so Stripe retries: the payment happened, the credit did not.
    const detail = await res.text();
    console.error(`credit_payment failed (${res.status}): ${detail}`);
    return new Response("credit failed", { status: 500 });
  }

  const result = await res.json();
  console.log(`credited ${amount} ${currency} to ${listingId}: ${JSON.stringify(result)}`);

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});

// TopTen.one — the card on the throne, filled in by whoever paid for it.
//
// Two questions, one endpoint:
//
//   {action:"status", session_id | claim_ref}      what did that payment buy?
//   {action:"save", edit_token, name, url, message} write the card
//
// Two receipts, either of which answers the first question, because which one
// a payer comes back holding is decided by the Payment Link's success URL:
//
//   session_id  Stripe's own, when the URL carries {CHECKOUT_SESSION_ID}
//   claim_ref   the one the page minted before checkout and passed as
//               client_reference_id, which the URL that was already
//               configured hands straight back
//
// Both are unguessable and held only by the browser that paid, and both are
// worth exactly one thing: the edit token, handed over on the first ask and
// never again. Everything after that
// is the token's, which is why it goes into that browser's localStorage and
// why losing it means writing to hello@topten.one rather than clicking a
// "forgot" link that would have to trust somebody's word.
//
// Neither the token nor the session id is ever readable from the database
// with the anon key — anon has no column privilege on either. This function
// holds the service role, and the two SQL functions it calls (claim_reign,
// edit_reign) are the only things granted execute on it. That is the whole
// reason this function exists rather than the page talking to PostgREST.
//
// Deployed with JWT verification ON, unlike the webhook: the page calls it
// with the same publishable anon key it already carries, so requiring one
// costs a visitor nothing and keeps a bare curl from reaching the database.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// Stripe's own shape for a Checkout Session id. Anything else is refused
// before a connection to the database is opened: the ids are unguessable, so
// nothing is learned by asking, but nothing should have to be spent finding
// that out either.
const SESSION_RE = /^cs_(test|live)_[A-Za-z0-9]{8,120}$/;

// What the page mints: a uuid, hyphens and all. Anything else is refused
// before a connection to the database is opened.
const REF_RE = /^[0-9a-fA-F-]{16,200}$/;

// 64 hex characters, which is what the column's default produces. Checked
// here so a malformed token is a 400 rather than a query.
const TOKEN_RE = /^[0-9a-f]{32,128}$/;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

/** Call one of the two SECURITY DEFINER functions as the service role. */
async function rpc(name: string, args: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    // The detail is for the logs. A caller gets "try again", because the
    // shape of a database error is not theirs to read.
    throw new Error(`${name} ${res.status}: ${await res.text()}`);
  }
  return await res.json();
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad_json" }, 400);
  }

  const action = String(body.action ?? "status");

  // ---------------------------------------------------------------- status --
  //
  // Three answers, and the third is the interesting one. "pending" means
  // neither table has heard of this session, which almost always means the
  // browser got back from Stripe before the webhook did — so the page polls
  // rather than telling somebody who has just paid that nothing happened.
  if (action === "status") {
    const sessionId = String(body.session_id ?? "").trim();
    const claimRef = String(body.claim_ref ?? "").trim();

    const haveSession = sessionId !== "" && SESSION_RE.test(sessionId);
    const haveRef = claimRef !== "" && REF_RE.test(claimRef);
    if (!haveSession && !haveRef) return json({ error: "bad_receipt" }, 400);

    try {
      return json(await rpc("claim_reign", {
        p_session_id: haveSession ? sessionId : null,
        p_claim_ref: haveRef ? claimRef : null,
      }));
    } catch (e) {
      console.error(e);
      return json({ error: "unavailable" }, 503);
    }
  }

  // ------------------------------------------------------------------ save --
  //
  // Length and shape are enforced again in the database — edit_reign() trims
  // to 40 and 100 and refuses a url that is not http(s), and the column
  // constraints refuse it a second time. Checking here as well is what turns
  // "the write silently did something else" into a message somebody can read.
  if (action === "save") {
    const token = String(body.edit_token ?? "");
    if (!TOKEN_RE.test(token)) return json({ error: "bad_token" }, 400);

    const name = String(body.name ?? "").trim().slice(0, 40);
    const message = String(body.message ?? "").trim().slice(0, 100);
    let url = String(body.url ?? "").trim();

    // Typed by hand, so a bare topten.one is meant as a link and not as a
    // mistake. Anything already carrying a scheme is left alone, which is
    // what makes javascript: fall to the check below instead of becoming
    // https://javascript:….
    if (url && !/^[a-z][a-z0-9+.-]*:/i.test(url)) url = `https://${url}`;
    if (url && !/^https?:\/\/[^\s<>"]{3,}$/i.test(url)) return json({ error: "bad_url" }, 400);
    if (url.length > 300) return json({ error: "bad_url" }, 400);

    try {
      const result = await rpc("edit_reign", {
        p_token: token,
        p_name: name || null,
        p_url: url || null,
        p_message: message || null,
      }) as Record<string, unknown>;
      // unknown_token is the ordinary failure — a token from a browser whose
      // reign was refunded away, or one somebody typed. 403, not 500.
      if (!result?.ok) return json(result, result?.reason === "unknown_token" ? 403 : 400);
      return json(result);
    } catch (e) {
      console.error(e);
      return json({ error: "unavailable" }, 503);
    }
  }

  return json({ error: "unknown_action" }, 400);
});

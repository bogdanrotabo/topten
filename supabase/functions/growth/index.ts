// TopTen.one — the growth report.
//
// One endpoint, one question: what did the last N days do. Everything it
// answers with is computed by growth_report() in the database, which is
// service_role only; this function is the door, and the lock below is the same
// one the old admin dashboard used, kept because it was the right lock and
// rewriting a working lock is how you end up with a worse one.
//
// Pinned rather than floating. The version this was lifted from asked for
// "@2", so it typechecked against whatever esm.sh served that hour: it
// passed locally against a cached older build and failed in CI against
// 2.115.0, whose types are stricter about User.email. A version that can
// change under the same source is not a dependency, it is a coin toss.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.115.0";

// One way in: a Supabase session made by signing in with Google, on an address
// listed in admin_emails. This function reads with the service role, past every
// RLS policy, so the check below is the whole lock.
//
// There is no password door and there never was one here. Not a shared secret
// in the environment, not an Auth session made by typing a password. A password
// can be guessed, reused from a site that leaked it, filled in by a browser
// that saved it years ago, or read over a shoulder, and every one of those is
// somebody else holding it. Nothing this function accepts can be typed.
//
// Three conditions, all required:
//
//   1. The session was made by a provider, not by a typed password. This is
//      asked of the database rather than read from the token. GoTrue records
//      the method in auth.mfa_amr_claims, one row per session, and the row
//      outlives every hourly refresh. The token does carry an amr claim saying
//      the same thing, and reading it would have been one line, but a claim is
//      only as good as the assumption that it is present: if it ever moved,
//      this check would either fail open or lock the only admin out of their
//      own dashboard, and neither is a thing to find out in production.
//   2. The account carries a Google identity. The recorded method says "oauth"
//      without naming the provider, and Google is the only one configured on
//      this project; this pins it even if a second is ever turned on.
//   3. The address is in admin_emails -- one row, on a table with RLS enabled
//      and no policy at all, so every client role sees it empty and can write
//      nothing to it. Adding an admin takes the keys, not a request.
//
// All three failures answer with the same 401. Telling them apart would make
// this endpoint a way to find out who the admins are.

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(supabaseUrl, serviceRoleKey);

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

// The session the token was minted for.
//
// This reads the payload without checking the signature, which is safe only
// because nothing is decided on it alone. getUser() below hands the same token
// to Auth, which does check it, so a forged or edited token is rejected there;
// and the id read here is spent on a question the database answers, not on a
// claim about who the holder is. A token cannot carry a session id other than
// its own without breaking its signature.
function sessionIdOf(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    let b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    b64 += "=".repeat((4 - (b64.length % 4)) % 4);
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const payload = JSON.parse(new TextDecoder().decode(bytes));
    const sid = payload?.session_id;
    return typeof sid === "string" && /^[0-9a-f-]{36}$/i.test(sid) ? sid : null;
  } catch {
    return null;
  }
}

async function isAuthorized(token: string): Promise<boolean> {
  if (!token) return false;

  const sessionId = sessionIdOf(token);
  if (!sessionId) return false;

  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  const user = userData?.user;
  // Held in its own const so the narrowing survives being passed along: an
  // account with no address cannot be in admin_emails, so this is the same
  // refusal the original made, said in a way the type checker can follow.
  const email = user?.email;
  if (userError || !user || !email) return false;

  const { data: byProvider, error: rpcError } = await supabase
    .rpc("session_made_by_oauth", { p_session: sessionId });
  if (rpcError || byProvider !== true) return false;

  const providers = (user.app_metadata?.providers ?? []) as string[];
  if (!providers.includes("google")) return false;

  const { data: adminRow } = await supabase
    .from("admin_emails")
    .select("email")
    .ilike("email", email)
    .maybeSingle();

  return !!adminRow;
}

function fail(message: string, status = 500): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...CORS_HEADERS, "content-type": "application/json" },
  });
}

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...CORS_HEADERS, "content-type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "GET" && req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: CORS_HEADERS });
  }

  const auth = req.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!(await isAuthorized(token))) {
    // The same answer for every way of failing. Telling them apart would make
    // this endpoint a way to find out who the admins are.
    return fail("not authorized", 401);
  }

  // The window. Days back from now, because that is how the question is
  // actually asked -- today, yesterday, 7, 30 -- and a pair of timestamps is
  // what the report takes.
  const url = new URL(req.url);
  const days = Math.min(400, Math.max(1, Number(url.searchParams.get("days") || 7)));
  const skip = Math.min(400, Math.max(0, Number(url.searchParams.get("skip") || 0)));
  const to = new Date(Date.now() - skip * 86400000);
  const from = new Date(to.getTime() - days * 86400000);

  const { data, error } = await supabase.rpc("growth_report", {
    p_from: from.toISOString(),
    p_to: to.toISOString(),
  });
  if (error) {
    console.error("growth_report", error);
    return fail("the report could not be built", 500);
  }

  return ok({ days, skip, report: data });
});

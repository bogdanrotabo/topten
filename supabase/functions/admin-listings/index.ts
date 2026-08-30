import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

// A Google Ads click always lands with a gclid in the query string, so that
// single marker is what separates paid traffic from organic everywhere.
const GCLID_PATTERN = "%gclid=%";

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
  if (userError || !userData?.user?.email) return false;
  const user = userData.user;

  const { data: byProvider, error: rpcError } = await supabase
    .rpc("session_made_by_oauth", { p_session: sessionId });
  if (rpcError || byProvider !== true) return false;

  const providers = (user.app_metadata?.providers ?? []) as string[];
  if (!providers.includes("google")) return false;

  const { data: adminRow } = await supabase
    .from("admin_emails")
    .select("email")
    .ilike("email", user.email)
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
    return fail("unauthorized", 401);
  }

  /* Hiding a listing, which is the one thing this dashboard writes.
     The terms promise that illegal, hateful, adult, spam and impersonation
     listings come down without a refund, and until now there was no way to
     keep that promise short of opening the database by hand.

     Hidden, not deleted, and deliberately so. The money is real and the
     payments table refers to the listing by id: deleting the row would either
     break that reference or take the receipt with it, and "we took this down"
     is a different statement from "this never happened". A hidden listing
     keeps its total, so unhiding puts it back exactly where the money says it
     belongs -- which matters when something is hidden by mistake. */
  if (req.method === "POST") {
    let body: any;
    try {
      body = await req.json();
    } catch {
      return fail("invalid json", 400);
    }

    const id = typeof body.id === "string" ? body.id : "";
    if (!/^[0-9a-f-]{36}$/i.test(id)) return fail("bad id", 400);

    if (body.action === "hide" || body.action === "unhide") {
      const { error } = await supabase
        .from("listings")
        .update({ hidden: body.action === "hide" })
        .eq("id", id);
      if (error) return fail(error.message);
      return ok({ ok: true });
    }

    return fail("unknown action", 400);
  }

  const url = new URL(req.url);
  const resource = url.searchParams.get("resource") || "listings";

  if (resource === "visits") {
    // The rows are only the recent slice the table shows -- PostgREST clamps
    // any select to db.max_rows -- so they are never used to derive totals.
    // The counters come from site_visit_stats(), which aggregates over every
    // row in SQL.
    const tzParam = url.searchParams.get("tz") || "UTC";
    const tz = /^[A-Za-z0-9_+\-\/]{1,64}$/.test(tzParam) ? tzParam : "UTC";

    // The paid/organic split happens here and not in the browser, for the same
    // clamp reason: a day of heavy ad traffic fills all 1000 rows with paid
    // visits, and filtering that slice client-side would report the organic
    // segment as empty on precisely the day it mattered.
    const segParam = url.searchParams.get("segment") || "all";
    const segment = segParam === "paid" || segParam === "organic" ? segParam : "all";

    let rowsQuery = supabase
      .from("site_visits")
      .select("id, path, country, referrer, language, session_id, created_at")
      .order("created_at", { ascending: false })
      .limit(1000);

    if (segment === "paid") {
      rowsQuery = rowsQuery.ilike("path", GCLID_PATTERN);
    } else if (segment === "organic") {
      rowsQuery = rowsQuery.not("path", "ilike", GCLID_PATTERN);
    }

    const [rowsRes, statsRes] = await Promise.all([
      rowsQuery,
      supabase.rpc("site_visit_stats", { p_tz: tz }),
    ]);

    if (rowsRes.error) return fail(rowsRes.error.message);
    if (statsRes.error) return fail(statsRes.error.message);

    const s = Array.isArray(statsRes.data) ? statsRes.data[0] : statsRes.data;
    const stats = {
      total: Number(s?.total ?? 0),
      unique_visitors: Number(s?.unique_visitors ?? 0),
      today: Number(s?.today ?? 0),
      paid_total: Number(s?.paid_total ?? 0),
      paid_unique: Number(s?.paid_unique ?? 0),
      paid_today: Number(s?.paid_today ?? 0),
      organic_total: Number(s?.organic_total ?? 0),
      organic_unique: Number(s?.organic_unique ?? 0),
      organic_today: Number(s?.organic_today ?? 0),
    };

    return ok({ data: rowsRes.data, stats, segment });
  }

  /* What the ads delivered, read from the addresses they landed on.

     Google Ads reports what it billed for; this reports who actually arrived,
     from where, and whether they stayed past the first page. Until the visit
     tracking was fixed this table could not answer either question -- the
     query string was dropped before the row was written and the country was
     never filled -- so two campaigns spent for days with nothing on this side
     able to say which of them, or which country, any visitor came from. */
  if (resource === "ads") {
    const daysParam = Number(url.searchParams.get("days") || "30");
    const days = Number.isFinite(daysParam) ? Math.min(Math.max(daysParam, 1), 365) : 30;

    const { data, error } = await supabase.rpc("ad_traffic_stats", { p_days: days });
    if (error) return fail(error.message);

    const rows = (data ?? []) as any[];
    return ok({
      data: rows,
      stats: {
        clicks: rows.reduce((n, r) => n + Number(r.clicks || 0), 0),
        visitors: rows.reduce((n, r) => n + Number(r.visitors || 0), 0),
        bounced: rows.reduce((n, r) => n + Number(r.bounced || 0), 0),
        campaigns: new Set(rows.map((r) => r.campaign)).size,
        countries: new Set(rows.map((r) => r.country)).size,
        days,
      },
    });
  }

  if (resource === "payments") {
    // One row per completed checkout, with the listing it moved. The listing
    // is joined rather than looked up afterwards because a payment identified
    // only by a uuid tells you nothing about what was bought.
    const [rowsRes, statsRes] = await Promise.all([
      supabase
        .from("payments")
        .select(
          "id, created_at, amount_cents, currency, stripe_session_id, listing_id, " +
          "listings(platform, handle, url, tagline, total_cents, hidden)",
        )
        .order("created_at", { ascending: false })
        .limit(1000),
      supabase.rpc("payment_stats"),
    ]);

    if (rowsRes.error) return fail(rowsRes.error.message);
    if (statsRes.error) return fail(statsRes.error.message);

    const p = Array.isArray(statsRes.data) ? statsRes.data[0] : statsRes.data;
    const stats = {
      total: Number(p?.total ?? 0),
      listings_paid: Number(p?.listings_paid ?? 0),
      by_currency: p?.by_currency ?? {},
    };

    return ok({ data: rowsRes.data, stats });
  }

  // The listings are the boards themselves, and unlike the visits they are the
  // whole record rather than a recent slice: every counter about them is
  // derived from these rows plus listing_stats(). Page through until a page
  // comes back short, with an id tiebreaker so the order is total and no row
  // is repeated or skipped across pages.
  const PAGE_SIZE = 1000;
  const LISTING_COLUMNS =
    "id, platform, handle, url, tagline, link, total_cents, last_paid_at, hidden, created_at";
  const listings: unknown[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("listings")
      .select(LISTING_COLUMNS)
      .order("total_cents", { ascending: false })
      .order("id", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);

    if (error) return fail(error.message);

    listings.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) break;
  }

  const { data: statsData, error: statsErr } = await supabase.rpc("listing_stats");
  if (statsErr) return fail(statsErr.message);
  const l = Array.isArray(statsData) ? statsData[0] : statsData;

  return ok({
    data: listings,
    stats: {
      total: Number(l?.total ?? 0),
      live: Number(l?.live ?? 0),
      hidden: Number(l?.hidden ?? 0),
      paid: Number(l?.paid ?? 0),
      cents_on_board: Number(l?.cents_on_board ?? 0),
      cents_taken: Number(l?.cents_taken ?? 0),
    },
  });
});

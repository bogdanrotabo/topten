-- Three things a security pass found, in order of how much they matter.
--
-- 1. ANYBODY COULD WRITE ANYTHING INTO THE VISITOR COUNT.
--
--    The insert policy on site_visits was `true`. Not "a visit that looks like
--    a visit" -- anything. The publishable key is public by design, so anyone
--    could POST rows with invented session ids and invented countries, and the
--    two figures the front page prints in its top band are
--    `147 + count(distinct session_id)` and `count(distinct country)`.
--
--    A site whose whole claim is "no algorithm, no editors, only what people
--    paid -- nothing rounded" cannot have a public number that a stranger can
--    pump. And the band was just moved to the top of every page, which makes
--    the number more prominent rather than less.
--
--    So the policy now asks for the shape of a real visit, exactly as the one
--    on site_events already does. Checked against all 3,114 rows recorded so
--    far before it was written: 0 malformed session ids, 0 malformed
--    countries, longest path 190 characters, longest referrer 54, longest
--    language 11. Every real visit ever recorded passes this. It is a shape
--    check and nothing more -- it does not stop somebody minting fresh UUIDs,
--    and the honest fix for that is to route visits through a function that
--    can see an IP and rate-limit it. That is a bigger change than this file
--    and is written down rather than done quietly.
--
-- 2. A DEAD FUNCTION ANYONE COULD CALL.
--
--    alerta_plata() is SECURITY DEFINER, granted to anon, and reads
--    public.reigns and public.attempts -- tables 0023 dropped. It is King of
--    the Hill's payment alert, left behind by the pivot. Today it can only
--    error. What it did when those tables existed was return, to anyone who
--    could guess a UUID, a payer's name, the amount, and the Stripe session
--    id. A leftover like that is how a closed hole reopens: somebody restores
--    a table with a familiar name and the door is already built.
--
-- 3. POLICIES THAT DO NOTHING, ON A SCHEMA THAT DOES NOT NEED THEM.
--
--    archive.reigns and archive.attempts each carry a policy saying "anyone
--    can read" while RLS is switched off, so the policy is inert and the table
--    is governed by grants alone. anon has neither USAGE on the schema nor
--    SELECT on the tables, so nothing is reachable today -- this is a trap
--    rather than a hole. It fires the day anybody grants schema usage for an
--    unrelated reason: the tables would become world-readable, with a policy
--    sitting there that seems to say that was intended. It was not. The
--    archive is the service role's business and nobody else's.

-- ---------------------------------------------------------------- 1 --------

drop policy if exists "anon can insert a visit" on public.site_visits;

create policy "a visit has to look like a visit"
  on public.site_visits
  for insert
  to anon, authenticated
  with check (
    session_id ~ '^[0-9a-f-]{36}$'
    and char_length(path) between 1 and 400
    and (country  is null or country ~ '^[A-Z]{2}$')
    and (referrer is null or char_length(referrer) <= 400)
    and (language is null or char_length(language) <= 35)
  );

-- ---------------------------------------------------------------- 2 --------

drop function if exists public.alerta_plata(uuid);

-- ---------------------------------------------------------------- 3 --------

drop policy if exists "anyone can read the reigns"   on archive.reigns;
drop policy if exists "anyone can read the attempts" on archive.attempts;

alter table archive.reigns   enable row level security;
alter table archive.attempts enable row level security;

-- No policy on either, which is the deny-all every other private table on this
-- project uses: the service role passes RLS, everybody else sees nothing.

comment on table archive.reigns is
  'King of the Hill, kept. RLS on with no policy: service role only.';
comment on table archive.attempts is
  'King of the Hill, kept. RLS on with no policy: service role only.';

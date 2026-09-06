-- TopTen.one — one position, one king.
--
-- The boards are gone. What replaces them is a single seat: whoever has paid
-- the most for it holds the page, and the only way to take it is to pay more
-- than they did. A payment that does not beat the sitting king is kept and
-- shown as an attempt; nothing is refunded and nothing is thrown away.
--
-- Three rules the schema, not the application, is responsible for:
--
--   1. There is at most one king. A partial unique index on a constant
--      expression is what says so — see reigns_one_king_idx.
--   2. Money is never written by a browser. Only crown_or_attempt() writes
--      these tables, only the service role may execute it, and only the
--      webhook holds the service role.
--   3. edit_token and stripe_session_id never leave the server. anon has no
--      column privilege on either, the public views do not select them, and
--      the replication stream carries a column list that leaves them out —
--      three independent locks, because one of them being wrong should not
--      be the same as the door being open.
--
-- Running this drops listings and payments. That is the pivot: the old rows
-- describe a product that no longer exists, and 137 listings ranked on 72
-- boards cannot be read as reigns on one seat. Take a backup first if the
-- history is wanted.

-- ============================================================ the old site --

-- Order matters. The cron job first, because it deletes from a table about to
-- go. Then the tables, whose cascade takes the board view, every policy and
-- both triggers with them. Only then the functions: listings_force_defaults()
-- is a trigger function, and dropping it while its trigger still stands is an
-- error rather than a no-op.

select cron.unschedule('topten-purge-unpaid')
where exists (select 1 from cron.job where jobname = 'topten-purge-unpaid');

drop view if exists public.board;
drop table if exists public.payments cascade;
drop table if exists public.listings cascade;

drop function if exists public.credit_payment(uuid, text, bigint, text);
drop function if exists public.update_listing(uuid, uuid, text, text);
drop function if exists public.lookup_listing(text, text);
drop function if exists public.listings_force_defaults();
drop function if exists public.listing_stats();
drop function if exists public.payment_stats();
drop function if exists public.market();
drop function if exists public.ad_traffic_stats(integer);

-- site_visits, site_presence, admin_emails and their functions are left
-- standing. They counted visitors, not ranks, and dropping them would throw
-- away the only record of how much traffic this domain has ever had. Nothing
-- reads them now that the admin console is gone; the rows keep.

-- =============================================================== the reign --

create table if not exists public.reigns (
  id                uuid primary key default gen_random_uuid(),
  stripe_session_id text unique not null,
  amount_cents      integer not null check (amount_cents > 0),
  currency          text not null,
  name              text check (char_length(name) <= 40),
  -- http(s) only, and short enough to print. The length is a second check
  -- rather than a repetition count in the pattern: Postgres refuses a regex
  -- bound over 255, and {3,300} is not rejected when the constraint is
  -- created — it is rejected the first time somebody saves a link.
  url               text check (url is null or
                      (url ~* '^https?://[^\s<>"]{3,}$' and char_length(url) <= 300)),
  message           text check (char_length(message) <= 100),
  crowned_at        timestamptz not null default now(),
  dethroned_at      timestamptz,
  -- 244 bits out of two v4 uuids. gen_random_uuid() is in pg_catalog, so this
  -- default still evaluates inside a function running with an empty
  -- search_path; gen_random_bytes() would not, and would need pgcrypto to be
  -- installed in a schema this file cannot assume.
  edit_token        text not null default
                      replace(gen_random_uuid()::text, '-', '')
                      || replace(gen_random_uuid()::text, '-', ''),
  -- Set the first time the token is handed to a browser. The card is claimed
  -- once; after that the holder of the token is the only one who can edit it,
  -- and somebody who merely knows a session id gets the card without the key.
  token_claimed_at  timestamptz,
  check (dethroned_at is null or dethroned_at >= crowned_at)
);

-- One king. Every row still on the throne carries the same value in this
-- expression — true — so a unique index over it admits exactly one of them.
-- A plain unique index on dethroned_at would not: nulls are distinct, and
-- every king would be allowed to reign at once.
create unique index if not exists reigns_one_king_idx
  on public.reigns ((dethroned_at is null))
  where dethroned_at is null;

-- The history page reads in this order and no other.
create index if not exists reigns_history_idx
  on public.reigns (dethroned_at desc)
  where dethroned_at is not null;

comment on column public.reigns.amount_cents is
  'What this reign was bought for, in the minor unit of its currency. One payment; there are no top-ups.';
comment on column public.reigns.edit_token is
  'Never leaves the server except once, to the browser that finished the checkout. anon has no privilege on this column and the replication stream does not carry it.';

-- ============================================================= the attempts --

create table if not exists public.attempts (
  id                uuid primary key default gen_random_uuid(),
  stripe_session_id text unique not null,
  amount_cents      integer not null check (amount_cents > 0),
  currency          text not null,
  name              text check (char_length(name) <= 40),
  created_at        timestamptz not null default now(),
  -- Which king survived it. Null only for an attempt made against an empty
  -- throne, which is a payment under the opening price and nothing else.
  --
  -- Not in the brief, and here because "attempts on this king" has to mean
  -- exactly that. Comparing created_at against crowned_at is the same answer
  -- almost always and the wrong one in the case that matters: two payments
  -- landing in the same instant, one of them crowning. A foreign key cannot
  -- be ambiguous about which reign an attempt failed against.
  reign_id          uuid references public.reigns(id) on delete set null
);

create index if not exists attempts_reign_idx
  on public.attempts (reign_id, created_at desc);

-- ================================================================== views --

-- security_invoker = true: the view runs with the caller's rights, so the
-- policies below decide what is readable rather than the view's owner. It is
-- also what lets Realtime evaluate RLS and stream changes to anon.
--
-- No view mentions edit_token or stripe_session_id. That is the second of the
-- three locks on them; the column grants further down are the first.

create or replace view public.king
with (security_invoker = true) as
  select r.id, r.amount_cents, r.currency, r.name, r.url, r.message, r.crowned_at
  from public.reigns r
  where r.dethroned_at is null;

create or replace view public.former_kings
with (security_invoker = true) as
  select r.id, r.amount_cents, r.currency, r.name, r.url, r.message,
         r.crowned_at, r.dethroned_at,
         extract(epoch from (r.dethroned_at - r.crowned_at))::bigint as reigned_seconds
  from public.reigns r
  where r.dethroned_at is not null;

-- Only the attempts made against whoever is sitting there now. An attempt on
-- a king who has since been dethroned belongs to that king's row in the
-- history, not to this list.
create or replace view public.attempts_on_king
with (security_invoker = true) as
  select a.id, a.amount_cents, a.currency, a.name, a.created_at
  from public.attempts a
  join public.reigns r on r.id = a.reign_id
  where r.dethroned_at is null;

-- =================================================================== rls ---

alter table public.reigns   enable row level security;
alter table public.attempts enable row level security;

revoke all on public.reigns   from anon, authenticated;
revoke all on public.attempts from anon, authenticated;

-- Column privileges, named one by one. Anything added to these tables later
-- is private until somebody comes back here and says otherwise, which is the
-- right way round for a table that holds a secret.
grant select (id, amount_cents, currency, name, url, message, crowned_at, dethroned_at)
  on public.reigns to anon, authenticated;
grant select (id, amount_cents, currency, name, created_at, reign_id)
  on public.attempts to anon, authenticated;

grant select on public.king             to anon, authenticated;
grant select on public.former_kings     to anon, authenticated;
grant select on public.attempts_on_king to anon, authenticated;

-- Everything on these two tables is public reading. What is not public is the
-- two columns above, and no policy can hand back a column the role has no
-- privilege on.
drop policy if exists "anyone can read the reigns" on public.reigns;
create policy "anyone can read the reigns"
  on public.reigns for select to anon, authenticated
  using (true);

drop policy if exists "anyone can read the attempts" on public.attempts;
create policy "anyone can read the attempts"
  on public.attempts for select to anon, authenticated
  using (true);

-- No insert, update or delete policy exists for anon or authenticated, so a
-- browser cannot crown itself, cannot move a reign and cannot erase an
-- attempt. The webhook writes through the function below, as the service
-- role, which RLS does not apply to.

-- ============================================================== the throne --

-- The whole mechanic, in one transaction.
--
-- Called once per settled Stripe session, by the webhook and by nothing else.
-- Idempotent on stripe_session_id: a redelivered event finds its own row and
-- returns what it did the first time.
create or replace function public.crown_or_attempt(
  p_session_id   text,
  p_amount_cents integer,
  p_currency     text,
  p_name         text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  -- The opening price: one whole unit of the link's currency. Stripe's own
  -- minimum on the payment link is higher than this, so in practice nothing
  -- ever fails here; it is the floor the rules describe, written down.
  c_opening constant integer := 100;
  v_king    public.reigns%rowtype;
  v_row     public.reigns%rowtype;
  v_att     public.attempts%rowtype;
  v_name    text := nullif(left(btrim(coalesce(p_name, '')), 40), '');
begin
  if p_session_id is null or p_session_id = '' then
    return jsonb_build_object('ok', false, 'reason', 'no_session');
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'bad_amount');
  end if;

  -- Everything that can crown somebody queues here. Locking the king's row
  -- alone would be enough while a king exists and would be nothing at all on
  -- an empty throne, which is exactly when two first payments could race.
  perform pg_advisory_xact_lock(hashtext('topten.throne'));

  -- Idempotency, under the lock rather than before it, so two deliveries of
  -- the same event cannot both find nothing and both act.
  select * into v_row from public.reigns where stripe_session_id = p_session_id;
  if found then
    return jsonb_build_object('ok', true, 'duplicate', true, 'outcome', 'crowned',
                              'reign_id', v_row.id, 'amount_cents', v_row.amount_cents);
  end if;
  select * into v_att from public.attempts where stripe_session_id = p_session_id;
  if found then
    return jsonb_build_object('ok', true, 'duplicate', true, 'outcome', 'attempt',
                              'attempt_id', v_att.id, 'amount_cents', v_att.amount_cents);
  end if;

  -- The sitting king, held for the rest of the transaction. Redundant beside
  -- the advisory lock and cheap, and it is the lock the rules ask for.
  select * into v_king from public.reigns where dethroned_at is null for update;

  -- Beat the king, or open the throne at a whole unit if nobody is on it.
  if v_king.id is null then
    if p_amount_cents < c_opening then
      insert into public.attempts (stripe_session_id, amount_cents, currency, name, reign_id)
      values (p_session_id, p_amount_cents, p_currency, v_name, null)
      returning * into v_att;
      return jsonb_build_object('ok', true, 'duplicate', false, 'outcome', 'attempt',
                                'attempt_id', v_att.id, 'needed_cents', c_opening);
    end if;
  elsif p_amount_cents <= v_king.amount_cents then
    insert into public.attempts (stripe_session_id, amount_cents, currency, name, reign_id)
    values (p_session_id, p_amount_cents, p_currency, v_name, v_king.id)
    returning * into v_att;
    return jsonb_build_object('ok', true, 'duplicate', false, 'outcome', 'attempt',
                              'attempt_id', v_att.id, 'needed_cents', v_king.amount_cents + 1);
  end if;

  -- Crowned. The old king steps down in the same statement pair, so there is
  -- no instant in which two rows carry a null dethroned_at — the unique index
  -- would refuse the second one anyway, which is the point of having it.
  if v_king.id is not null then
    update public.reigns set dethroned_at = now() where id = v_king.id;
  end if;

  insert into public.reigns (stripe_session_id, amount_cents, currency, name)
  values (p_session_id, p_amount_cents, p_currency, v_name)
  returning * into v_row;

  return jsonb_build_object('ok', true, 'duplicate', false, 'outcome', 'crowned',
                            'reign_id', v_row.id, 'amount_cents', v_row.amount_cents,
                            'dethroned', v_king.id);
end;
$fn$;

revoke all on function public.crown_or_attempt(text, integer, text, text)
  from public, anon, authenticated;
grant execute on function public.crown_or_attempt(text, integer, text, text) to service_role;

-- ================================================================= claims --

-- The card, filled in by the person who paid for it.
--
-- Two doors, both here rather than in the Edge Function, so the rules about
-- who may write what are in the database with the data.
--
--   claim_reign()  swaps a Stripe session id for the edit token, once. The
--                  session id is the receipt: only the browser Stripe
--                  redirected holds it.
--   edit_reign()   takes the token and writes the card.
--
-- Both are service_role only. The browser reaches them through the `claim`
-- Edge Function, which is the only thing holding that key.

create or replace function public.claim_reign(p_session_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row   public.reigns%rowtype;
  v_att   public.attempts%rowtype;
  v_king  public.reigns%rowtype;
  v_first boolean;
begin
  select * into v_row from public.reigns where stripe_session_id = p_session_id;
  if found then
    v_first := v_row.token_claimed_at is null;
    if v_first then
      update public.reigns set token_claimed_at = now() where id = v_row.id;
    end if;
    return jsonb_build_object(
      'outcome', 'crowned',
      'reign', jsonb_build_object(
        'id', v_row.id, 'amount_cents', v_row.amount_cents, 'currency', v_row.currency,
        'name', v_row.name, 'url', v_row.url, 'message', v_row.message,
        'crowned_at', v_row.crowned_at, 'dethroned_at', v_row.dethroned_at),
      -- Handed over exactly once. A second visit to the same success URL gets
      -- the card and no key; the browser that was there first kept it.
      'edit_token', case when v_first then v_row.edit_token else null end,
      'token_already_issued', not v_first);
  end if;

  select * into v_att from public.attempts where stripe_session_id = p_session_id;
  if found then
    select * into v_king from public.reigns where dethroned_at is null;
    return jsonb_build_object(
      'outcome', 'attempt',
      'amount_cents', v_att.amount_cents,
      'currency', v_att.currency,
      'created_at', v_att.created_at,
      'needed_cents', coalesce(v_king.amount_cents + 1, 100),
      'king_amount_cents', v_king.amount_cents,
      'king_name', v_king.name);
  end if;

  -- Neither table has heard of it. Almost always this is the browser
  -- arriving back from Stripe a moment before the webhook does.
  return jsonb_build_object('outcome', 'pending');
end;
$fn$;

create or replace function public.edit_reign(
  p_token   text,
  p_name    text,
  p_url     text,
  p_message text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row public.reigns%rowtype;
  v_url text := nullif(btrim(coalesce(p_url, '')), '');
begin
  if p_token is null or char_length(p_token) < 32 then
    return jsonb_build_object('ok', false, 'reason', 'bad_token');
  end if;

  if v_url is not null and
     (v_url !~* '^https?://[^\s<>"]{3,}$' or char_length(v_url) > 300) then
    return jsonb_build_object('ok', false, 'reason', 'bad_url');
  end if;

  -- A dethroned king may still edit their own row. It is on the page for as
  -- long as the site exists, in the history, and refusing somebody the
  -- correction of their own typo forever is not a rule worth having.
  update public.reigns
     set name    = nullif(left(btrim(coalesce(p_name, '')), 40), ''),
         url     = v_url,
         message = nullif(left(btrim(coalesce(p_message, '')), 100), '')
   where edit_token = p_token
  returning * into v_row;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'unknown_token');
  end if;

  return jsonb_build_object('ok', true, 'reign', jsonb_build_object(
    'id', v_row.id, 'amount_cents', v_row.amount_cents, 'currency', v_row.currency,
    'name', v_row.name, 'url', v_row.url, 'message', v_row.message,
    'crowned_at', v_row.crowned_at, 'dethroned_at', v_row.dethroned_at));
end;
$fn$;

revoke all on function public.claim_reign(text) from public, anon, authenticated;
grant execute on function public.claim_reign(text) to service_role;

revoke all on function public.edit_reign(text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.edit_reign(text, text, text, text) to service_role;

-- ============================================================== realtime ---

-- The publication carries a column list, which is the third lock on the two
-- private columns: they are not withheld from the socket, they are never
-- decoded into it. A column list requires the replica identity to be covered
-- by it, so these tables stay on the default identity — the primary key —
-- rather than the `replica identity full` the old listings table used.
alter table public.reigns   replica identity default;
alter table public.attempts replica identity default;

-- Dropped first so a re-run replaces the column list rather than failing on a
-- table already in the publication. Asked rather than caught: "not part of the
-- publication" and "no such publication" are different accidents and only one
-- of them is fine to ignore.
do $do$
declare t text;
begin
  foreach t in array array['reigns', 'attempts'] loop
    if exists (select 1 from pg_publication_tables
               where pubname = 'supabase_realtime'
                 and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime drop table public.%I', t);
    end if;
  end loop;
end;
$do$;

alter publication supabase_realtime add table public.reigns
  (id, amount_cents, currency, name, url, message, crowned_at, dethroned_at);

alter publication supabase_realtime add table public.attempts
  (id, amount_cents, currency, name, created_at, reign_id);

-- ========================================================== owner alerts ---

-- The doorbell from 0018, re-hung. It used to sit on public.payments, which
-- no longer exists; every payment now ends as a row in one of these two
-- tables, exactly once per Stripe session, so that is where it belongs.
--
-- The mail is sent by rotabo.app's `notify` function, which holds this
-- project's publishable key and calls alerta_plata() back with nothing but a
-- uuid. Keeping that contract — same function name, same signature, same
-- shape of answer — is what stops this pivot from silently switching the
-- alerts off.
create or replace function public.alerta_plata(p_ref uuid)
returns jsonb
language sql
security definer
set search_path = ''
stable
as $fn$
  with r as (
    select 'crowned'::text as kind, id, amount_cents, currency, name, stripe_session_id
    from public.reigns
    where id = p_ref and crowned_at > now() - interval '30 minutes'
    union all
    select 'attempt'::text, id, amount_cents, currency, name, stripe_session_id
    from public.attempts
    where id = p_ref and created_at > now() - interval '30 minutes'
  ),
  k as (select amount_cents, name from public.reigns where dethroned_at is null)
  select jsonb_build_object(
    'amount_cents', r.amount_cents,
    'currency',     r.currency,
    'what', case when r.kind = 'crowned'
                 then 'NEW KING · ' || coalesce(r.name, 'Anonymous')
                 else 'attempt · ' || coalesce(r.name, 'Anonymous') end,
    'lines', jsonb_build_array(
      'outcome:    ' || r.kind,
      'name:       ' || coalesce(r.name, '-'),
      'paid:       ' || (r.amount_cents / 100.0)::text || ' ' || upper(r.currency),
      'king now:   ' || coalesce((select (amount_cents / 100.0)::text from k), '-')
                     || ' · ' || coalesce((select name from k), 'Anonymous'),
      'row:        ' || r.id::text,
      'session:    ' || r.stripe_session_id,
      'page:       https://topten.one/'
    ))
  from r;
$fn$;

revoke all on function public.alerta_plata(uuid) from public;
grant execute on function public.alerta_plata(uuid) to anon, authenticated, service_role;

drop trigger if exists anunta_plata on public.reigns;
create trigger anunta_plata
  after insert on public.reigns
  for each row execute function public.anunta_plata();

drop trigger if exists anunta_plata on public.attempts;
create trigger anunta_plata
  after insert on public.attempts
  for each row execute function public.anunta_plata();

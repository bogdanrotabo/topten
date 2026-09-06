-- The boards come back, and the money with them.
--
-- 0019 archived the old product rather than deleting it, on the grounds that
-- the reversible version of a pivot costs nothing. This is the reverse: the
-- 137 listings and 147 payments move back into public with every column, every
-- total and every timestamp exactly as they were, and the functions that made
-- them a product are rebuilt from 0001, 0003, 0009, 0010 and 0018.
--
-- Nothing here computes, rounds, backfills or reinterprets an amount. The
-- money is carried, not recalculated -- and the block at the end refuses to
-- commit if a single cent moved during the carry.
--
-- Rollback, if this has to be undone:
--
--   begin;
--   drop view if exists public.board;
--   alter table public.listings set schema archive;
--   alter table public.payments set schema archive;
--   commit;
--
-- Nothing here removes anything the site is currently reading. King of the
-- Hill keeps its tables, its views and its webhook until 0023 takes them
-- down, which is what lets this be applied to a live site that is still
-- serving the old one.
--
-- ONE THING IS NOT A FAITHFUL RESTORE, deliberately: edit_token.
--
-- The old schema kept the token on the listings row and gave anon a
-- table-wide SELECT, because the browser had to receive its own token back
-- from the INSERT. The effect was that
--
--   GET /rest/v1/listings?select=id,edit_token
--
-- answered, to anybody with the publishable key, with the edit token of every
-- listing on the site -- and update_listing() takes nothing but that token.
-- Any visitor could have rewritten the tagline and the outbound link of the
-- $306.99 listing. The same column also travelled in the realtime stream.
--
-- So the token moves to a table of its own, with no grants and no policy, and
-- reaches a browser exactly once: from create_listing(), to whoever created
-- the row. The token VALUES are unchanged, so a browser still holding one in
-- localStorage keeps working. Nothing else about the old design moves.

-- ============================================================ the carrying ==

create temp table _inainte as
  select (select count(*)                         from archive.listings) as listari,
         (select coalesce(sum(total_cents), 0)    from archive.listings) as listari_cents,
         (select count(*)                         from archive.payments) as plati,
         (select coalesce(sum(amount_cents), 0)   from archive.payments) as plati_cents;

do $do$
begin
  if to_regclass('archive.listings') is not null then
    execute 'alter table archive.listings set schema public';
  end if;
  if to_regclass('archive.payments') is not null then
    execute 'alter table archive.payments set schema public';
  end if;
end;
$do$;

-- ================================================================ the lock ==

alter table public.listings enable row level security;
alter table public.payments enable row level security;

revoke all on public.listings from anon, authenticated;
revoke all on public.payments from anon, authenticated;

-- The token leaves the row it used to sit on. Same values, somewhere anon has
-- no privilege on and no policy for -- which is also why it is not `create
-- table as`: the column keeps its type and the rows keep their identity.
create table if not exists public.listing_tokens (
  listing_id uuid primary key references public.listings(id) on delete cascade,
  token      uuid not null,
  created_at timestamptz not null default now()
);

insert into public.listing_tokens (listing_id, token)
  select id, edit_token from public.listings
   where edit_token is not null
  on conflict (listing_id) do nothing;

alter table public.listings drop column if exists edit_token;

alter table public.listing_tokens enable row level security;
revoke all on public.listing_tokens from public, anon, authenticated;

-- listings has no secret column left, so the old table-wide read is restored
-- as it was. What anon may read is still decided by the policy below.
grant select on public.listings to anon, authenticated;

-- INSERT is no longer granted: create_listing() is the way in, because it is
-- the only thing that can hand a token back now.
-- payments keeps RLS on with no policy and no grant: unreachable with the
-- publishable key, exactly as before.

drop policy if exists "anyone can submit a listing" on public.listings;

drop policy if exists "anyone can read active listings" on public.listings;
create policy "anyone can read active listings"
  on public.listings for select to anon, authenticated
  using (
    hidden = false
    and last_paid_at is not null
    and last_paid_at > now() - interval '30 days'
  );

-- ================================================================= the view =

-- 0003's version, verbatim: rank by money, ties to whoever reached the amount
-- first, which is what the Terms have always said. `link` sits beside the
-- tagline it accompanies.
drop view if exists public.board;

create view public.board
with (security_invoker = true)
as
  select
    id,
    platform,
    url,
    handle,
    tagline,
    link,
    total_cents,
    last_paid_at,
    created_at,
    rank() over (partition by platform
                 order by total_cents desc, last_paid_at) as rank
  from public.listings l
  where hidden = false
    and last_paid_at is not null
    and last_paid_at > now() - interval '30 days';

grant select on public.board to anon, authenticated;

-- ============================================================== the guards ==

-- 0003's trigger, minus the token minting, which create_listing() now does.
-- Everything a client could send that touches money or moderation is still
-- overwritten here, so the guard holds even if a future path inserts directly.
create or replace function public.listings_force_defaults()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $fn$
begin
  new.total_cents  := 0;
  new.last_paid_at := null;
  new.hidden       := false;
  new.created_at   := now();
  new.handle       := left(btrim(new.handle), 40);
  new.tagline      := nullif(left(btrim(coalesce(new.tagline, '')), 80), '');

  new.link := nullif(btrim(coalesce(new.link, '')), '');
  if new.link is not null then
    if new.link !~* '^https?://[a-z0-9][a-z0-9._-]*\.[a-z]{2,}' then
      raise exception 'link must be an http or https URL';
    end if;
    new.link := left(new.link, 200);
  end if;

  if new.handle = '' then
    raise exception 'handle required';
  end if;

  return new;
end;
$fn$;

drop trigger if exists listings_force_defaults_trg on public.listings;
create trigger listings_force_defaults_trg
  before insert on public.listings
  for each row execute function public.listings_force_defaults();

-- ============================================================ getting in ====

-- Submitting a listing, and the one moment its token is readable.
--
-- Returns the existing row instead of failing when the (platform, url) pair is
-- already taken, because a duplicate submission means "I want to pay towards
-- this", not "something went wrong" -- but it hands back no token in that
-- case: the row is somebody else's.
create or replace function public.create_listing(
  p_platform text,
  p_url      text,
  p_handle   text,
  p_tagline  text default null,
  p_link     text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_id    uuid;
  v_token uuid;
begin
  select id into v_id
    from public.listings
   where platform = p_platform and url = p_url and hidden = false
   limit 1;

  if found then
    return jsonb_build_object('ok', true, 'id', v_id, 'existing', true);
  end if;

  insert into public.listings (platform, url, handle, tagline, link)
  values (p_platform, p_url, p_handle, p_tagline, p_link)
  returning id into v_id;

  v_token := gen_random_uuid();
  insert into public.listing_tokens (listing_id, token) values (v_id, v_token);

  return jsonb_build_object('ok', true, 'id', v_id, 'existing', false,
                            'edit_token', v_token);
exception
  -- Two browsers submitting the same profile in the same instant: the loser
  -- gets the winner's row, which is the same answer the check above gives.
  when unique_violation then
    select id into v_id from public.listings
     where platform = p_platform and url = p_url limit 1;
    return jsonb_build_object('ok', true, 'id', v_id, 'existing', true);
end;
$fn$;

revoke all on function public.create_listing(text, text, text, text, text) from public;
grant execute on function public.create_listing(text, text, text, text, text)
  to anon, authenticated;

-- 0001's version, verbatim. A hidden listing returns null on purpose: a
-- moderated profile cannot be relisted.
create or replace function public.lookup_listing(p_platform text, p_url text)
returns uuid
language sql
security definer
stable
set search_path = ''
as $fn$
  select id
  from public.listings
  where platform = p_platform
    and url = p_url
    and hidden = false
  limit 1;
$fn$;

revoke all on function public.lookup_listing(text, text) from public;
grant execute on function public.lookup_listing(text, text) to anon, authenticated;

-- ============================================================== the edit ====

-- 0003's version, reading the token from its own table now. Still only
-- tagline and link; money is not reachable from here, and a hidden row stays
-- hidden so moderation is not undoable by its owner.
create or replace function public.update_listing(
  p_id uuid, p_token uuid, p_tagline text, p_link text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_tagline text;
  v_link    text;
  v_rows    int;
begin
  if p_token is null then
    return jsonb_build_object('ok', false, 'reason', 'no_token');
  end if;

  v_tagline := nullif(left(btrim(coalesce(p_tagline, '')), 80), '');
  v_link    := nullif(btrim(coalesce(p_link, '')), '');

  if v_link is not null then
    if v_link !~* '^https?://[a-z0-9][a-z0-9._-]*\.[a-z]{2,}' then
      return jsonb_build_object('ok', false, 'reason', 'bad_link');
    end if;
    v_link := left(v_link, 200);
  end if;

  update public.listings l
     set tagline = v_tagline,
         link    = v_link
   where l.id = p_id
     and l.hidden = false
     and exists (select 1 from public.listing_tokens t
                  where t.listing_id = p_id and t.token = p_token);

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    -- Wrong token, wrong id, or hidden. The caller is told the same thing in
    -- every case, so this cannot be used to probe which listings exist.
    return jsonb_build_object('ok', false, 'reason', 'not_yours');
  end if;

  return jsonb_build_object('ok', true, 'tagline', v_tagline, 'link', v_link);
end;
$fn$;

revoke all on function public.update_listing(uuid, uuid, text, text) from public;
grant execute on function public.update_listing(uuid, uuid, text, text)
  to anon, authenticated;

-- ============================================================ the crediting =

-- 0001's version, verbatim and unchanged. The webhook's only write path.
-- Idempotent on stripe_session_id; the payment row and the running total move
-- in one transaction; service_role only.
create or replace function public.credit_payment(
  p_listing_id   uuid,
  p_session_id   text,
  p_amount_cents bigint,
  p_currency     text default 'usd'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_inserted int;
  v_total    bigint;
begin
  if p_amount_cents is null or p_amount_cents <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'bad_amount');
  end if;

  if not exists (select 1 from public.listings where id = p_listing_id) then
    return jsonb_build_object('ok', false, 'reason', 'unknown_listing');
  end if;

  insert into public.payments (listing_id, stripe_session_id, amount_cents, currency)
  values (p_listing_id, p_session_id, p_amount_cents, coalesce(p_currency, 'usd'))
  on conflict (stripe_session_id) do nothing;

  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    select total_cents into v_total from public.listings where id = p_listing_id;
    return jsonb_build_object('ok', true, 'duplicate', true, 'total_cents', v_total);
  end if;

  update public.listings
     set total_cents  = total_cents + p_amount_cents,
         last_paid_at = now()
   where id = p_listing_id
  returning total_cents into v_total;

  return jsonb_build_object('ok', true, 'duplicate', false, 'total_cents', v_total);
end;
$fn$;

revoke all on function public.credit_payment(uuid, text, bigint, text)
  from public, anon, authenticated;
grant execute on function public.credit_payment(uuid, text, bigint, text) to service_role;

-- ============================================================ the orphans ===

-- A payment that cannot be matched to a listing.
--
-- credit_payment() answers 'unknown_listing' and writes nothing, which is
-- correct -- it must not invent a row to credit. But the money was taken, so
-- the fact has to land somewhere that is not a log line: the site is changing
-- shape, the receipt a payer carries is whatever the page put in
-- client_reference_id at the time, and a checkout opened straight from the
-- Payment Link carries none at all.
--
-- The webhook writes here when it has nowhere else to write, and the row is
-- what lets somebody be refunded or credited by hand instead of discovering
-- the payment in Stripe a month later with nothing to attach it to.
create table if not exists public.unmatched_payments (
  id                uuid primary key default gen_random_uuid(),
  stripe_session_id text unique not null,
  amount_cents      bigint not null check (amount_cents > 0),
  currency          text not null default 'usd',
  client_reference  text,
  reason            text not null,
  created_at        timestamptz not null default now(),
  settled_at        timestamptz,
  note              text
);

alter table public.unmatched_payments enable row level security;
revoke all on public.unmatched_payments from public, anon, authenticated;

create or replace function public.record_orphan_payment(
  p_session_id text,
  p_amount_cents bigint,
  p_currency text default 'usd',
  p_client_reference text default null,
  p_reason text default 'unknown_listing'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare v_id uuid;
begin
  insert into public.unmatched_payments
    (stripe_session_id, amount_cents, currency, client_reference, reason)
  values (p_session_id, p_amount_cents, coalesce(p_currency, 'usd'),
          p_client_reference, p_reason)
  on conflict (stripe_session_id) do nothing
  returning id into v_id;

  -- Same idempotency as credit_payment: Stripe retries, and a retry must not
  -- become a second row.
  if v_id is null then
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;
  return jsonb_build_object('ok', true, 'duplicate', false, 'id', v_id);
end;
$fn$;

revoke all on function public.record_orphan_payment(text, bigint, text, text, text)
  from public, anon, authenticated;
grant execute on function public.record_orphan_payment(text, bigint, text, text, text)
  to service_role;

-- ============================================================== the market ==

-- 0010's version, verbatim. All three numbers come from the same seven rolling
-- 24h buckets, so sum(spark) = d7_cents for every row by construction.
create or replace function public.market()
returns table (
  id uuid, platform text, url text, handle text, tagline text, link text,
  total_cents bigint, last_paid_at timestamptz, created_at timestamptz,
  d1_cents bigint, d7_cents bigint, spark bigint[]
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with live as (
    select l.id, l.platform, l.url, l.handle, l.tagline, l.link,
           l.total_cents, l.last_paid_at, l.created_at
      from listings l
     where l.hidden = false
       and l.last_paid_at is not null
       and l.last_paid_at > now() - interval '30 days'
  ),
  buckets as (
    select live.id, b.i,
           now() - ((7 - b.i) * interval '24 hours') as lo,
           now() - ((6 - b.i) * interval '24 hours') as hi
      from live cross join generate_series(0, 6) as b(i)
  ),
  per_bucket as (
    select b.id, b.i, coalesce(sum(p.amount_cents), 0)::bigint as cents
      from buckets b
      left join payments p
        on p.listing_id = b.id
       and p.created_at >= b.lo
       and p.created_at <  b.hi
     group by b.id, b.i
  ),
  shaped as (
    select id,
           array_agg(cents order by i) as spark,
           sum(cents)::bigint as d7,
           max(cents) filter (where i = 6)::bigint as d1
      from per_bucket
     group by id
  )
  select live.*, shaped.d1, shaped.d7, shaped.spark
    from live
    join shaped on shaped.id = live.id;
$$;

revoke all on function public.market() from public;
grant execute on function public.market() to anon, authenticated;

-- =============================================================== the stats ==

-- 0009's two, verbatim. service_role only; the dashboard reads them.
create or replace function public.listing_stats()
returns table (
  total bigint, live bigint, hidden bigint, paid bigint,
  cents_on_board bigint, cents_taken bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select count(*) from public.listings)::bigint,
    (select count(*) from public.listings
      where last_paid_at > now() - interval '30 days')::bigint,
    (select count(*) from public.listings where hidden)::bigint,
    (select count(*) from public.listings where total_cents > 0)::bigint,
    (select coalesce(sum(total_cents), 0) from public.listings)::bigint,
    (select coalesce(sum(amount_cents), 0) from public.payments)::bigint;
$$;

create or replace function public.payment_stats()
returns table (total bigint, listings_paid bigint, by_currency jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select count(*) from public.payments)::bigint,
    (select count(distinct listing_id) from public.payments)::bigint,
    (select coalesce(jsonb_object_agg(currency, cents), '{}'::jsonb)
     from (select currency, sum(amount_cents)::bigint as cents
             from public.payments group by currency) per_currency);
$$;

revoke all on function public.listing_stats() from public, anon, authenticated;
revoke all on function public.payment_stats() from public, anon, authenticated;
grant execute on function public.listing_stats() to service_role;
grant execute on function public.payment_stats() to service_role;

-- =============================================================== the alert ==

-- 0018's trigger. The function survived the pivot; only the trigger went.
drop trigger if exists anunta_plata on public.payments;
create trigger anunta_plata
  after insert on public.payments
  for each row execute function public.anunta_plata();

-- ============================================================= the stream ===

alter table public.listings replica identity full;

do $do$
begin
  alter publication supabase_realtime add table public.listings;
exception
  when duplicate_object then null;
end;
$do$;

-- listing_tokens is deliberately absent from the publication.

-- ============================================================== the sweeper =

-- A listing submitted and never paid for is invisible forever, so it is
-- dropped after 24 h rather than squatting a (platform, url) slot for free.
create extension if not exists pg_cron;

select cron.unschedule('topten-purge-unpaid')
where exists (select 1 from cron.job where jobname = 'topten-purge-unpaid');

select cron.schedule(
  'topten-purge-unpaid',
  '17 * * * *',
  $cron$
    delete from public.listings
    where last_paid_at is null
      and created_at < now() - interval '24 hours'
  $cron$
);

-- ============================================================== the count ===

-- Nothing above was allowed to touch an amount. If one moved anyway, this
-- transaction does not commit.
do $do$
declare
  b            record;
  v_listari    bigint;
  v_lcents     bigint;
  v_plati      bigint;
  v_pcents     bigint;
begin
  select * into b from _inainte;

  execute 'select count(*), coalesce(sum(total_cents), 0) from public.listings'
     into v_listari, v_lcents;
  execute 'select count(*), coalesce(sum(amount_cents), 0) from public.payments'
     into v_plati, v_pcents;

  if v_listari <> b.listari or v_lcents <> b.listari_cents
     or v_plati <> b.plati or v_pcents <> b.plati_cents then
    raise exception
      'the money moved during the restore: listings %/% -> %/%, payments %/% -> %/%',
      b.listari, b.listari_cents, v_listari, v_lcents,
      b.plati, b.plati_cents, v_plati, v_pcents;
  end if;

  raise notice 'restored: % listings holding % cents, % payments totalling % cents',
    v_listari, v_lcents, v_plati, v_pcents;
end;
$do$;

drop table _inainte;

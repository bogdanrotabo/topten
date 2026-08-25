-- TopTen.one — initial schema
-- Money is the only thing that sets rank. The client is never trusted with it.

-- ---------------------------------------------------------------- tables ----

create table if not exists public.listings (
  id           uuid primary key default gen_random_uuid(),
  platform     text not null check (platform in
                 ('x','instagram','tiktok','youtube','twitch','linkedin','threads','facebook')),
  url          text not null,
  handle       text not null,
  tagline      text check (char_length(tagline) <= 80),
  total_cents  bigint not null default 0 check (total_cents >= 0),
  last_paid_at timestamptz,
  created_at   timestamptz not null default now(),
  hidden       boolean not null default false,   -- admin moderation, set from the dashboard
  unique (platform, url)
);

create table if not exists public.payments (
  id                uuid primary key default gen_random_uuid(),
  listing_id        uuid not null references public.listings(id) on delete cascade,
  stripe_session_id text unique not null,
  amount_cents      bigint not null check (amount_cents > 0),
  currency          text not null default 'usd',
  created_at        timestamptz not null default now()
);

-- Board reads always filter by platform and sort by money, then age.
create index if not exists listings_board_idx
  on public.listings (platform, total_cents desc, last_paid_at asc)
  where hidden = false and last_paid_at is not null;

create index if not exists listings_unpaid_idx
  on public.listings (created_at)
  where last_paid_at is null;

create index if not exists payments_listing_idx on public.payments (listing_id);

-- ------------------------------------------------- insert-time hard limits ---

-- Anon inserts a listing directly, so the trigger — not the client — decides
-- every field that could buy a rank. Anything the client sends for money,
-- payment time or moderation is overwritten here.
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

-- ------------------------------------------------------------------ view ----

-- security_invoker = true: the view runs with the caller's rights, so the
-- SELECT policy below (not the view owner) decides which rows are readable.
-- This also lets Realtime evaluate RLS and stream board updates to anon.
create or replace view public.board
with (security_invoker = true) as
  select
    l.id,
    l.platform,
    l.url,
    l.handle,
    l.tagline,
    l.total_cents,
    l.last_paid_at,
    l.created_at,
    rank() over (
      partition by l.platform
      order by l.total_cents desc, l.last_paid_at asc
    ) as rank
  from public.listings l
  where l.hidden = false
    and l.last_paid_at is not null
    and l.last_paid_at > now() - interval '30 days';

-- ------------------------------------------------------------------- rls ----

alter table public.listings enable row level security;
alter table public.payments enable row level security;

revoke all on public.listings from anon, authenticated;
revoke all on public.payments from anon, authenticated;

grant select, insert on public.listings to anon, authenticated;
grant select on public.board to anon, authenticated;

drop policy if exists "anyone can submit a listing" on public.listings;
create policy "anyone can submit a listing"
  on public.listings for insert to anon, authenticated
  with check (true);

-- Exactly the WHERE clause of the view: unpaid, hidden and expired rows are
-- invisible whether you read the view or the table.
drop policy if exists "anyone can read active listings" on public.listings;
create policy "anyone can read active listings"
  on public.listings for select to anon, authenticated
  using (
    hidden = false
    and last_paid_at is not null
    and last_paid_at > now() - interval '30 days'
  );

-- No update and no delete policy exists for anon, so total_cents, last_paid_at
-- and hidden cannot be written from the browser under any circumstances.
-- payments has RLS on and zero policies: unreachable with the anon key.

-- --------------------------------------------------------------- lookups ----

-- A duplicate submission must land on "add money" for the existing listing.
-- The existing row may be unpaid or expired, and therefore invisible, so this
-- returns the id and nothing else. Hidden listings return null on purpose:
-- a moderated profile cannot be relisted.
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

-- -------------------------------------------------------------- crediting ---

-- The webhook's only write path. Idempotent on stripe_session_id, and the
-- payment row plus the running total move in one transaction.
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

revoke all on function public.credit_payment(uuid, text, bigint, text) from public, anon, authenticated;
grant execute on function public.credit_payment(uuid, text, bigint, text) to service_role;

-- -------------------------------------------------------------- realtime ----

alter table public.listings replica identity full;

do $do$
begin
  alter publication supabase_realtime add table public.listings;
exception
  when duplicate_object then null;
end;
$do$;

-- --------------------------------------------------------------- cleanup ----

-- A listing that was submitted but never paid is invisible forever. Drop it
-- after 24 h so the unique (platform, url) slot is not squatted for free.
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

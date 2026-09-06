create role anon nologin;  create role authenticated nologin;  create role service_role nologin;
create publication supabase_realtime;
-- Supabase grants this out of the box; this box does not
grant usage on schema public to anon, authenticated, service_role;

-- stand-ins for the two Supabase extensions this box has not got
create schema cron;
create table cron.job (jobname text);
create function cron.unschedule(text) returns boolean language sql as $$ select true $$;
create function cron.schedule(text,text,text) returns bigint language sql as $$ select 1::bigint $$;
create schema net;
create function net.http_post(url text, body jsonb, headers jsonb)
  returns bigint language sql as $$ select 1::bigint $$;

-- the old product, as 0001+0003 built it
create table public.listings (
  id uuid primary key default gen_random_uuid(),
  platform text not null check (platform in ('x','crypto','artists','us-parties','football-players')),
  url text not null, handle text not null,
  tagline text check (char_length(tagline) <= 80),
  total_cents bigint not null default 0 check (total_cents >= 0),
  last_paid_at timestamptz, created_at timestamptz not null default now(),
  hidden boolean not null default false,
  link text check (link is null or char_length(link) <= 200),
  edit_token uuid,
  unique (platform, url));
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  stripe_session_id text unique not null,
  amount_cents bigint not null check (amount_cents > 0),
  currency text not null default 'usd',
  created_at timestamptz not null default now());

-- what 0004/0005 built: the site's own record of who arrived
create table public.site_visits (
  id uuid primary key default gen_random_uuid(),
  path text, referrer text, language text,
  session_id text, country text,
  created_at timestamptz not null default now());
create table public.site_presence (
  session_id text primary key, last_seen timestamptz not null default now());
alter table public.site_visits enable row level security;
grant insert on public.site_visits to anon;
create policy "anon can insert a visit" on public.site_visits for insert to anon with check (true);
create function public.site_visitors() returns bigint language sql stable security definer
  set search_path = public as $$ select 147 + count(distinct session_id) from public.site_visits $$;
grant execute on function public.site_visitors() to anon;

create function public.anunta_plata() returns trigger language plpgsql as $fn$
begin return new; end; $fn$;

-- five listings, nine payments, money that must survive to the cent
insert into public.listings (platform,url,handle,tagline,total_cents,last_paid_at,link,edit_token) values
 ('x','https://x.com/a','@a','one',30699,now()-interval '2 days','https://a.com',gen_random_uuid()),
 ('x','https://x.com/b','@b','two',30699,now()-interval '5 days',null,gen_random_uuid()),
 ('crypto','https://c.io/sol','Solana',null,2300,now()-interval '1 day',null,gen_random_uuid()),
 ('crypto','https://c.io/btc','Bitcoin',null,2299,now()-interval '3 hours',null,gen_random_uuid()),
 ('artists','https://a.fm/x','Someone',null,1400,now()-interval '40 days',null,gen_random_uuid());
insert into public.payments (listing_id,stripe_session_id,amount_cents)
  select id, 'cs_live_'||replace(id::text,'-',''), total_cents from public.listings;
insert into public.payments (listing_id,stripe_session_id,amount_cents)
  select id, 'cs_live_x'||replace(id::text,'-',''), 0+1 from public.listings limit 4;
update public.listings l set total_cents = (select sum(amount_cents) from public.payments p where p.listing_id=l.id);

-- and the King of the Hill tables 0022 is meant to archive
create table public.reigns (id uuid primary key default gen_random_uuid(), amount_cents bigint, dethroned_at timestamptz);
create table public.attempts (id uuid primary key default gen_random_uuid(), amount_cents bigint);
create view public.king as select * from public.reigns where dethroned_at is null;
alter table public.reigns enable row level security;
alter table public.attempts enable row level security;
insert into public.reigns (amount_cents) values (800);
insert into public.attempts (amount_cents) values (500);

-- now the pivot, as 0019 did it
create schema archive;
alter table public.listings set schema archive;
alter table public.payments set schema archive;
alter table archive.listings disable row level security;
alter table archive.payments disable row level security;

select count(*) as listari, sum(total_cents) as cents from archive.listings;

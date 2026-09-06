-- Measuring the loop.
--
-- The question this site exists to answer is not how many people came. It is:
-- will somebody who does not know us see a ranking they care about and pay a
-- small amount to change it -- and then will they share it, come back, and pay
-- again. Every figure here is chosen to tell one of those apart from the next,
-- so that a campaign that fails can be diagnosed rather than guessed at:
--
--   the post got no clicks           acquisition
--   clicks arrived, they left        the landing
--   they looked, did not click Back  motivation
--   Back but no checkout             trust, or the amount
--   checkout but no payment          friction at Stripe
--   payments but no sharing          the post-payment moment
--   payments but nobody returns      retention
--
-- site_visits already records arrivals with the query string intact, so the
-- campaign markers are there. What was missing is what a visitor did between
-- arriving and paying, and that is what site_events holds.

-- --------------------------------------------------------------- the events --

create table if not exists public.site_events (
  id           bigserial primary key,
  session_id   text not null,
  name         text not null,
  board        text,
  listing_id   uuid,
  amount_cents bigint,
  created_at   timestamptz not null default now()
);

create index if not exists site_events_when_idx  on public.site_events (created_at desc);
create index if not exists site_events_what_idx  on public.site_events (name, created_at desc);
create index if not exists site_events_who_idx   on public.site_events (session_id);
create index if not exists site_events_board_idx on public.site_events (board) where board is not null;

alter table public.site_events enable row level security;
revoke all on public.site_events from anon, authenticated;
grant insert on public.site_events to anon, authenticated;
grant usage on sequence public.site_events_id_seq to anon, authenticated;

-- Write-only, and only the events the site actually sends. A table anybody can
-- insert anything into is free storage for somebody else; naming the events
-- keeps it a measurement rather than a guestbook.
drop policy if exists "anyone can record a site event" on public.site_events;
create policy "anyone can record a site event"
  on public.site_events for insert to anon, authenticated
  with check (
    name in ('board_view', 'listing_picked', 'back_clicked', 'amount_selected',
             'checkout_started', 'add_opened', 'add_submitted', 'search_used',
             'share_clicked', 'result_seen')
    and session_id ~ '^[0-9a-f-]{36}$'
    and (board is null or char_length(board) <= 60)
    and (amount_cents is null or (amount_cents >= 0 and amount_cents <= 2147483647))
  );

comment on table public.site_events is
  'What a visitor did between arriving and paying. Write-only for the site; read only by the growth report, which runs as service_role behind the Google-only admin gate.';

-- --------------------------------------------------------------- the report --

-- Everything the owner needs to decide whether to stop, continue or scale,
-- in one call over one window.
--
-- service_role only. It reads visits, events, payments and the campaign a
-- payment came from, and none of that is anybody else's business.
create or replace function public.growth_report(p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v jsonb;
begin
  return (
  with
  -- Arrivals in the window, with the campaign markers pulled out of the address
  -- they landed on. The first visit of a session is the one that says where the
  -- session came from; later ones carry no query string of their own.
  visits as (
    select session_id, created_at, country, referrer, path,
           substring(path from 'utm_source=([^&]+)')   as utm_source,
           substring(path from 'utm_medium=([^&]+)')   as utm_medium,
           substring(path from 'utm_campaign=([^&]+)') as utm_campaign,
           substring(path from 'utm_content=([^&]+)')  as utm_content,
           (path like '%gclid=%') as paid_click,
           row_number() over (partition by session_id order by created_at) as nth
      from public.site_visits
     where created_at >= p_from and created_at < p_to
  ),
  firsts as (select * from visits where nth = 1),
  -- Where a session came from, in one word, so the report can be read.
  sources as (
    select session_id,
           coalesce(
             nullif(utm_source, ''),
             case when paid_click then 'google-ads' end,
             case when referrer is null or referrer = '' then 'direct'
                  else regexp_replace(regexp_replace(referrer, '^https?://', ''), '/.*$', '') end
           ) as source,
           coalesce(nullif(utm_campaign, ''), '(none)') as campaign
      from firsts
  ),
  ev as (
    select * from public.site_events
     where created_at >= p_from and created_at < p_to
  ),
  -- A payment in the window, and the visit that sent it. The link is
  -- payment_refs.visit_session, which the webhook wrote from the second half
  -- of client_reference_id.
  pays as (
    select p.id, p.amount_cents, p.created_at, p.listing_id,
           r.visit_session, l.platform, l.handle
      from public.payments p
      left join public.payment_refs r on r.stripe_session_id = p.stripe_session_id
      left join public.listings l on l.id = p.listing_id
     where p.created_at >= p_from and p.created_at < p_to
  ),
  -- A session that had already been seen before this window opened.
  returning_sessions as (
    select distinct v.session_id
      from visits v
     where exists (select 1 from public.site_visits o
                    where o.session_id = v.session_id and o.created_at < p_from)
  ),
  -- Somebody who has paid more than once, ever.
  repeat_payers as (
    select r.visit_session
      from public.payment_refs r
     where r.visit_session is not null
     group by r.visit_session
    having count(*) > 1
  ),
  n as (
    select
      (select count(distinct session_id) from visits)                              as visitors,
      (select count(*) from visits)                                                as pageviews,
      (select count(distinct session_id) from returning_sessions)                  as returning_visitors,
      (select count(*) from ev where name = 'board_view')                          as board_views,
      (select count(*) from ev where name = 'search_used')                         as searches,
      (select count(*) from ev where name = 'back_clicked')                        as back_clicks,
      (select count(*) from ev where name = 'checkout_started')                    as checkouts,
      (select count(*) from ev where name = 'share_clicked')                       as shares,
      (select count(*) from ev where name = 'add_submitted')                       as adds,
      (select count(*) from pays)                                                  as payments,
      (select coalesce(sum(amount_cents), 0) from pays)                            as revenue_cents,
      (select count(distinct visit_session) from pays where visit_session is not null) as payers,
      (select count(*) from repeat_payers)                                         as repeat_payers
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'visitors',           n.visitors,
    'pageviews',          n.pageviews,
    'returning_visitors', n.returning_visitors,
    'board_views',        n.board_views,
    'searches',           n.searches,
    'back_clicks',        n.back_clicks,
    'checkouts',          n.checkouts,
    'shares',             n.shares,
    'adds',               n.adds,
    'payments',           n.payments,
    'revenue_cents',      n.revenue_cents,
    'payers',             n.payers,
    'repeat_payers',      n.repeat_payers,
    'avg_payment_cents',  case when n.payments > 0 then round(n.revenue_cents::numeric / n.payments) else 0 end,
    -- The two that decide whether to scale. Per thousand, because per visitor
    -- is a number with too many zeros to compare at a glance.
    'revenue_per_1k_cents', case when n.visitors > 0
                                 then round(n.revenue_cents::numeric * 1000 / n.visitors) else 0 end,
    'payment_rate',       case when n.visitors > 0
                               then round(n.payments::numeric * 100 / n.visitors, 2) else 0 end,
    'checkout_rate',      case when n.checkouts > 0
                               then round(n.payments::numeric * 100 / n.checkouts, 2) else 0 end,
    'back_to_checkout',   case when n.back_clicks > 0
                               then round(n.checkouts::numeric * 100 / n.back_clicks, 2) else 0 end,
    'top_boards', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select platform as board, count(*) as payments, sum(amount_cents) as cents
          from pays where platform is not null
         group by platform order by sum(amount_cents) desc limit 10) x),
    'top_listings', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select handle, platform as board, count(*) as payments, sum(amount_cents) as cents
          from pays where handle is not null
         group by handle, platform order by sum(amount_cents) desc limit 10) x),
    'top_sources', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select s.source, count(distinct s.session_id) as visitors,
               coalesce(sum(p.amount_cents), 0) as cents,
               count(p.id) as payments
          from sources s left join pays p on p.visit_session = s.session_id
         group by s.source order by coalesce(sum(p.amount_cents), 0) desc,
                                   count(distinct s.session_id) desc limit 10) x),
    'top_campaigns', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select s.campaign, count(distinct s.session_id) as visitors,
               coalesce(sum(p.amount_cents), 0) as cents,
               count(p.id) as payments
          from sources s left join pays p on p.visit_session = s.session_id
         group by s.campaign order by coalesce(sum(p.amount_cents), 0) desc,
                                      count(distinct s.session_id) desc limit 10) x),
    'top_countries', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select country, count(distinct session_id) as visitors
          from visits where country is not null and country <> ''
         group by country order by count(distinct session_id) desc limit 10) x),
    'most_viewed_boards', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select board, count(*) as views from ev
         where name = 'board_view' and board is not null
         group by board order by count(*) desc limit 10) x)
  ) from n);
end;
$fn$;

revoke all on function public.growth_report(timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.growth_report(timestamptz, timestamptz) to service_role;

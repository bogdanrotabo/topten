-- The dashboard's numbers, counted in SQL rather than in the browser.
--
-- Not an optimisation. PostgREST clamps every select to db.max_rows, which is
-- 1000 here, so any counter derived from the rows a page received is right
-- only while there are fewer than a thousand of them and silently wrong from
-- the thousand-and-first -- and it goes wrong quietly, showing a plausible
-- number rather than an error. Counting happens where all the rows are.
--
-- All three are SECURITY DEFINER and executable by service_role alone. The
-- edge function is the only caller; nothing in the browser can reach them.

-- Listings, and whether the board still adds up.
--
-- cents_on_board is the sum of what every listing says it has been paid.
-- cents_taken is the sum of the payments actually recorded. They are two
-- different columns on two different tables kept in step by the Stripe
-- webhook, and they should be equal. When they are not, a payment landed
-- without moving the board or a listing carries money nobody paid, and the
-- dashboard should say so rather than show one number and imply the other.
create or replace function public.listing_stats()
returns table (
  total bigint,
  live bigint,
  hidden bigint,
  paid bigint,
  cents_on_board bigint,
  cents_taken bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select count(*) from public.listings)::bigint,
    -- Thirty days after its last payment a listing drops off the board.
    (select count(*) from public.listings
      where last_paid_at > now() - interval '30 days')::bigint,
    (select count(*) from public.listings where hidden)::bigint,
    (select count(*) from public.listings where total_cents > 0)::bigint,
    (select coalesce(sum(total_cents), 0) from public.listings)::bigint,
    (select coalesce(sum(amount_cents), 0) from public.payments)::bigint;
$$;

-- Payments, split by currency because adding two currencies into one number
-- is how a ledger starts lying. The site charges in one today; the shape
-- holds if that ever stops being true.
create or replace function public.payment_stats()
returns table (
  total bigint,
  listings_paid bigint,
  by_currency jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select count(*) from public.payments)::bigint,
    (select count(distinct listing_id) from public.payments)::bigint,
    (select coalesce(
       jsonb_object_agg(currency, cents),
       '{}'::jsonb)
     from (
       select currency, sum(amount_cents)::bigint as cents
       from public.payments
       group by currency
     ) per_currency);
$$;

-- Visits, and the paid/organic split.
--
-- A Google Ads click always lands with a gclid in the query string, and that
-- single marker is what separates the two everywhere. No visit here carries
-- one yet -- the ads are written up but not running -- and the split is built
-- in anyway: it is the same code either way, and retrofitting a counter after
-- the traffic arrives means a gap in the only record of where it came from.
--
-- A pageview counts as paid when the visit it belongs to ever carried a
-- gclid, not only on the one hit that happened to show it: the marker is on
-- the landing page and the four pages read afterwards are just as bought.
-- Rows with no session id fall back to their own path.
create or replace function public.site_visit_stats(p_tz text default 'UTC')
returns table (
  total bigint,
  unique_visitors bigint,
  today bigint,
  paid_total bigint,
  paid_unique bigint,
  paid_today bigint,
  organic_total bigint,
  organic_unique bigint,
  organic_today bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  tz text := coalesce(p_tz, 'UTC');
begin
  -- An unknown timezone name raises rather than returning null, and a
  -- dashboard that answers 500 because a browser reported something odd is
  -- worse than one that counts the day in UTC.
  begin
    perform now() at time zone tz;
  exception when others then
    tz := 'UTC';
  end;

  return query
  with v as (
    select
      sv.session_id,
      coalesce(sv.path, '') ilike '%gclid=%' as row_is_paid,
      (sv.created_at at time zone tz)::date = (now() at time zone tz)::date as is_today
    from public.site_visits sv
  ),
  per_session as (
    select session_id, bool_or(row_is_paid) as is_paid
    from v
    where session_id is not null
    group by session_id
  ),
  rows_marked as (
    select v.is_today, coalesce(ps.is_paid, v.row_is_paid) as is_paid
    from v left join per_session ps on ps.session_id = v.session_id
  )
  select
    (select count(*) from rows_marked)::bigint,
    (select count(*) from per_session)::bigint,
    (select count(*) from rows_marked where is_today)::bigint,
    (select count(*) from rows_marked where is_paid)::bigint,
    (select count(*) from per_session where is_paid)::bigint,
    (select count(*) from rows_marked where is_paid and is_today)::bigint,
    (select count(*) from rows_marked where not is_paid)::bigint,
    (select count(*) from per_session where not is_paid)::bigint,
    (select count(*) from rows_marked where not is_paid and is_today)::bigint;
end;
$$;

revoke all on function public.listing_stats() from public, anon, authenticated;
revoke all on function public.payment_stats() from public, anon, authenticated;
revoke all on function public.site_visit_stats(text) from public, anon, authenticated;

grant execute on function public.listing_stats() to service_role;
grant execute on function public.payment_stats() to service_role;
grant execute on function public.site_visit_stats(text) to service_role;

-- The numbers the front page is allowed to print.
--
-- The page shows visitors, countries, listings and the total backed. Three of
-- those the publishable key can already work out; the fourth it cannot, and
-- should not: site_visits carries a country and a referrer per row, and anon
-- has no policy on it for good reason. A count of distinct countries is not
-- that table -- it is one integer with nobody in it.
--
-- So the four are computed here, in one call, and the page prints what this
-- returns rather than a figure baked in at build time that starts ageing the
-- moment it is written.
--
-- visitors comes from site_visitors(), which carries the documented Google
-- Analytics baseline of 147 from the three days before site_visits existed
-- (see 0005). It is a real measurement of real people, and it is stated on
-- the page as such rather than passed off as a live count.

create or replace function public.site_numbers()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $fn$
  select jsonb_build_object(
    'visitors',     public.site_visitors(),
    'countries',    (select count(distinct country) from public.site_visits
                      where country is not null and country <> ''),
    'listed',       (select count(*) from public.listings
                      where hidden = false and last_paid_at is not null
                        and last_paid_at > now() - interval '30 days'),
    'backed_cents', (select coalesce(sum(amount_cents), 0) from public.payments),
    'payments',     (select count(*) from public.payments),
    'boards_live',  (select count(distinct platform) from public.listings
                      where hidden = false and last_paid_at is not null
                        and last_paid_at > now() - interval '30 days')
  );
$fn$;

revoke all on function public.site_numbers() from public;
grant execute on function public.site_numbers() to anon, authenticated;

comment on function public.site_numbers() is
  'The four figures the front page prints. Counts only -- no row from site_visits leaves this function.';

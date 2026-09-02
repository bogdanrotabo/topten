-- The market table needs movement, not just a standing total.
--
-- The `board` view answers "who is on this board and for how much", which was
-- everything the tile grid could show. The front page is now one ranked table
-- with a 24h column, a 7d column and a seven-day sparkline, and a view cannot
-- carry an array per row without a lateral join per request.
--
-- The one thing that had to be got right: all three numbers come from the same
-- seven rolling 24h buckets. The first version measured 7d over a rolling 168
-- hours and drew the chart over UTC calendar days, so the top listing read $17
-- above a $13 chart -- both correct, neither the same question. Now
-- sum(spark) = d7_cents for every row, by construction.
--
-- Applied to production on 2026-09-02 as `0003_market_same_window`.
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

-- security definer, so it reads `payments` on the caller's behalf. `payments`
-- itself stays unreachable: RLS on, no policy, no grant to anon. What leaves
-- this function is seven daily sums per listing and nothing that identifies
-- who paid them.
revoke all on function public.market() from public;
grant execute on function public.market() to anon, authenticated;

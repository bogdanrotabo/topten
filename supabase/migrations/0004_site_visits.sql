-- TopTen.one kept no record of who came by, so the masthead could only ever
-- show who was connected this second -- a number that reads "1" and argues
-- against the boards it sits above. This is the shape Rotabo already uses:
-- anon may write a row and may never read one, and the only thing that comes
-- back out is a count.

create table if not exists public.site_visits (
  id          uuid primary key default gen_random_uuid(),
  path        text not null,
  referrer    text,
  language    text,
  session_id  text,
  country     text,
  created_at  timestamptz not null default now()
);

create index if not exists site_visits_created_at_idx on public.site_visits (created_at);
create index if not exists site_visits_session_idx    on public.site_visits (session_id);

alter table public.site_visits enable row level security;

drop policy if exists "anon can insert a visit" on public.site_visits;
create policy "anon can insert a visit"
  on public.site_visits for insert to anon with check (true);

-- Distinct sessions rather than rows: one person refreshing five times is
-- one visitor. security definer because anon cannot read the table at all,
-- which is the point -- the only thing that leaves is the number.
create or replace function public.site_visitors()
returns bigint
language sql
security definer
set search_path = public
stable
as $$
  select count(distinct session_id) from public.site_visits;
$$;

revoke all on function public.site_visitors() from public;
grant execute on function public.site_visitors() to anon, authenticated;

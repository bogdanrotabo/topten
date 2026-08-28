-- RULEAZA MANUAL in Supabase (proiectul "topten", iezclmijwrtjibgflfqj),
-- SQL Editor. Blocat de clasificatorul din modul automat, deci nu a fost
-- aplicat de mine.
--
-- The site went live on 25 August 2026 and this table only came into being
-- on the 28th, so counting from here alone would tell a visitor that three
-- days of real traffic never happened.
--
-- Google Analytics measured it: 143 active users on property 551474282
-- between launch and the moment this table started counting, of which 143
-- were new -- so 143 is everyone who had been here at all. That figure is
-- carried in as a baseline rather than written into the table as invented
-- rows, so the number stays a real measurement and the code says where it
-- came from and as of when.
--
-- One known imprecision, stated rather than hidden: somebody who visited
-- before the cutover and comes back afterwards is counted once by Google
-- and once here. Over three days and 143 people the overlap is small, and
-- it errs by at most a few.

create or replace function public.site_visitors()
returns bigint
language sql
security definer
set search_path = public
stable
as $$
  select 143 + count(distinct session_id) from public.site_visits;
$$;

revoke all on function public.site_visitors() from public;
grant execute on function public.site_visitors() to anon, authenticated;

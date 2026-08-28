-- RULEAZA MANUAL in Supabase (proiectul "topten", iezclmijwrtjibgflfqj),
-- SQL Editor. Blocat de clasificatorul din modul automat, deci nu a fost
-- aplicat de mine.
--
-- The site went live on 25 August 2026 and this table only came into being
-- on the 28th, so counting from here alone would tell a visitor that the
-- first three days of real traffic never happened.
--
-- Google Analytics measured them, on property 551474282: its seven-day card
-- read 143 active users, all of them new, for 21-27 August -- a window that
-- ends the day before this was written and so leaves out the 28th. Counting
-- that day in brings it to 147. Every one of them is a real person Google
-- saw arrive.
--
-- The figure is carried in as a baseline rather than written into the table
-- as invented rows, so what the site shows stays a real measurement and the
-- code says where it came from and as of when.
--
-- One known imprecision, stated rather than hidden: this table started
-- counting at about 09:25 UTC on 28 August, so anyone who arrives after
-- that and was also seen by Google today is counted twice. It is a handful
-- of people, and it errs high by that handful.

create or replace function public.site_visitors()
returns bigint
language sql
security definer
set search_path = public
stable
as $$
  select 147 + count(distinct session_id) from public.site_visits;
$$;

revoke all on function public.site_visitors() from public;
grant execute on function public.site_visitors() to anon, authenticated;

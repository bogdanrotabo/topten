-- site_pulse decides the "Online now" figure on the front page, and it took
-- any text between 1 and 100 characters as a session.
--
-- The browser sends a uuid and always has. Anything else arriving is either a
-- mistake or somebody writing rows by hand, and rows written by hand are rows
-- counted as people: the number on the page is a claim about how many humans
-- are here, and it should be as hard to fake as it is cheap to make it so.
--
-- This does not make the figure unfakeable — a script can mint uuids as
-- easily as anything else — but it closes the version of the hole that takes
-- no thought, and it keeps the table free of junk keys. Rate limiting is the
-- real answer and belongs at the edge, not here.
--
-- Everything else is unchanged: same upsert, same 2% sampled cleanup (which
-- is indexed and deliberate — a delete on every heartbeat would make every
-- visitor pay for the tidying), same 90-second window.
--
-- Applied to production on 2026-09-02 as `0009_site_pulse_uuid_only`.
create or replace function public.site_pulse(p_session text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_session is null
     or p_session !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'invalid session';
  end if;

  insert into public.site_presence (session_id, last_seen)
  values (p_session, now())
  on conflict (session_id) do update set last_seen = now();

  if random() < 0.02 then
    delete from public.site_presence where last_seen < now() - interval '1 hour';
  end if;

  return (select count(*)::int from public.site_presence
          where last_seen > now() - interval '90 seconds');
end;
$$;

revoke all on function public.site_pulse(text) from public;
grant execute on function public.site_pulse(text) to anon, authenticated;

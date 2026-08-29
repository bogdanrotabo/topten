-- The admin dashboard: who may open it, and how that is decided.
--
-- Two objects, and between them they are the whole lock. Everything the
-- dashboard reads it reads through an edge function running as the service
-- role, past every RLS policy, so nothing else stands between a request and
-- every listing, payment and visit on the site.

-- Who. One address per row, and no policy on the table at all.
--
-- RLS is on and there is deliberately nothing to satisfy it: no select, no
-- insert, no update, no delete. Every client role -- anon and authenticated
-- alike -- therefore sees an empty table and can write nothing to it. The
-- edge function reads it with the service role, which is not subject to RLS,
-- and that is the only way this table is ever read. Adding an admin is a
-- deliberate act performed by somebody with the keys, not something the site
-- can be talked into.
create table if not exists public.admin_emails (
  email text primary key
);

alter table public.admin_emails enable row level security;

insert into public.admin_emails (email)
values ('bogdan.tanase.ch@gmail.com')
on conflict (email) do nothing;

-- How. The admin signs in with Google and only with Google, so something has
-- to be able to tell a Google session from one made by typing a password.
--
-- The access token carries an amr claim that says exactly that, and reading it
-- would have been one line -- but a claim is only as good as the assumption
-- that it is present, and a check that either fails open or locks the only
-- admin out of their own dashboard is not a thing to discover in production.
--
-- auth.mfa_amr_claims is where GoTrue writes it instead: one row per session
-- per method, 'oauth' for a provider sign-in and 'password' for a typed one.
-- The rows outlive the token, surviving every hourly refresh, and they go away
-- when the session does -- so signing out stops the session being an admin one
-- immediately rather than at the end of the token's hour.
--
-- The auth schema is not reachable through PostgREST, hence this function. It
-- is SECURITY DEFINER and narrow because of it: one boolean, about a session
-- id the caller must already hold, executable by service_role alone. It cannot
-- be used to enumerate anything -- a session that does not exist and one made
-- by password give the same answer.
create or replace function public.session_made_by_oauth(p_session uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from auth.mfa_amr_claims c
    where c.session_id = p_session
      and c.authentication_method = 'oauth'
  );
$$;

revoke all on function public.session_made_by_oauth(uuid) from public;
revoke all on function public.session_made_by_oauth(uuid) from anon;
revoke all on function public.session_made_by_oauth(uuid) from authenticated;
grant execute on function public.session_made_by_oauth(uuid) to service_role;

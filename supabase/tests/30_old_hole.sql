-- Reconstruieste EXACT vechea schema (0001+0003) si intreaba ce vede anon.
create schema old;
grant usage on schema old to anon;
create table old.listings (
  id uuid primary key default gen_random_uuid(),
  platform text not null, url text not null, handle text not null,
  tagline text, total_cents bigint not null default 0,
  last_paid_at timestamptz, created_at timestamptz not null default now(),
  hidden boolean not null default false, link text, edit_token uuid);
insert into old.listings (platform,url,handle,total_cents,last_paid_at,edit_token)
  values ('x','https://x.com/a','@a',30699, now(), gen_random_uuid());

alter table old.listings enable row level security;
revoke all on old.listings from anon;
-- 0001, linia 103, verbatim:
grant select, insert on old.listings to anon;
-- 0001, linia 114, verbatim:
create policy "anyone can read active listings" on old.listings for select to anon
  using (hidden = false and last_paid_at is not null
         and last_paid_at > now() - interval '30 days');

do $$
declare v_tok uuid;
begin
  set local role anon;
  select edit_token into v_tok from old.listings limit 1;
  set local role postgres;
  if v_tok is not null then
    raise notice 'GAURA CONFIRMATA: anon a citit edit_token = %', v_tok;
  else
    raise notice 'anon nu a primit niciun token';
  end if;
exception when insufficient_privilege then
  set local role postgres;
  raise notice 'refuzat: anon nu poate citi edit_token in vechea schema';
end $$;
drop schema old cascade;

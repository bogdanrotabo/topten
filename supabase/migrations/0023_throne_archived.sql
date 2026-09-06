-- The throne comes down.
--
-- Applied at the swap, not before: 0022 restored the boards without touching
-- anything King of the Hill was using, so the site kept working on the old
-- schema while the new one was built beside it. This is the half that breaks
-- the old page, and it goes out together with the page that replaces it.
--
-- Archived, not deleted, the same way 0019 archived the boards. Its two rows
-- were seeded by hand and are not payments -- no money is being moved here --
-- but the shape is worth keeping and keeping it costs nothing.
--
-- Rollback:
--
--   begin;
--   alter table archive.reigns   set schema public;
--   alter table archive.attempts set schema public;
--   commit;
--
--   ...then re-run 0019's view, grant and policy blocks, and redeploy the
--   King of the Hill webhook. 0019, 0020 and 0021 are still in this directory.

-- ============================================================== the throne ==

-- King of the Hill leaves the site the same way the boards did: archived, not
-- deleted. Its two rows were seeded by hand and are not payments, but the
-- shape of the thing is worth keeping, and archiving costs nothing.
do $do$
begin
  if to_regclass('public.king') is not null then
    execute 'drop view public.king';
  end if;
  if to_regclass('public.former_kings') is not null then
    execute 'drop view public.former_kings';
  end if;
  if to_regclass('public.attempts_on_king') is not null then
    execute 'drop view public.attempts_on_king';
  end if;

  if exists (select 1 from pg_publication_tables
             where pubname = 'supabase_realtime' and tablename = 'reigns') then
    execute 'alter publication supabase_realtime drop table public.reigns';
  end if;
  if exists (select 1 from pg_publication_tables
             where pubname = 'supabase_realtime' and tablename = 'attempts') then
    execute 'alter publication supabase_realtime drop table public.attempts';
  end if;

  if to_regclass('public.reigns') is not null then
    execute 'alter table public.reigns set schema archive';
    execute 'revoke all on archive.reigns from anon, authenticated';
    execute 'alter table archive.reigns disable row level security';
  end if;
  if to_regclass('public.attempts') is not null then
    execute 'alter table public.attempts set schema archive';
    execute 'revoke all on archive.attempts from anon, authenticated';
    execute 'alter table archive.attempts disable row level security';
  end if;
end;
$do$;

drop function if exists public.crown_or_attempt(text, bigint, text, text, text);
drop function if exists public.claim_reign(text, text);
drop function if exists public.edit_reign(text, text, text, text);


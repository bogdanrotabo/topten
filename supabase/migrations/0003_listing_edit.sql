-- Letting somebody edit their own listing.
--
-- Paying cannot be what grants edit rights. Anyone may pay towards any listing,
-- so if payment carried ownership, two dollars would buy the right to rewrite
-- the link on a ten-thousand-dollar listing. Instead each row carries a secret
-- `edit_token` minted at insert time; the browser keeps it in localStorage and
-- hands it back to `update_listing()`. No accounts, and still no way to edit a
-- row you never created.
--
-- Only `tagline` and `link` are writable. Money columns are untouchable from
-- here, exactly as they are from the insert path.
--
-- These objects were applied to the live database by hand while the feature was
-- being built. This file exists so a rebuild from migrations produces the same
-- schema rather than silently losing the ability to edit.

-- ---------------------------------------------------------------- columns ---

alter table public.listings
  add column if not exists link text;

alter table public.listings
  add column if not exists edit_token uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'listings_link_len') then
    alter table public.listings
      add constraint listings_link_len
      check (link is null or char_length(link) <= 200);
  end if;
end $$;

-- ---------------------------------------------------------------- trigger ---

-- Same guard as before, now also normalising the link and minting the token.
-- The browser may send `link` and `edit_token`; both are overwritten or
-- validated here, so a forged value gains nothing.
create or replace function public.listings_force_defaults()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $fn$
begin
  new.total_cents  := 0;
  new.last_paid_at := null;
  new.hidden       := false;
  new.created_at   := now();
  new.handle       := left(btrim(new.handle), 40);
  new.tagline      := nullif(left(btrim(coalesce(new.tagline, '')), 80), '');

  new.link := nullif(btrim(coalesce(new.link, '')), '');
  if new.link is not null then
    if new.link !~* '^https?://[a-z0-9][a-z0-9._-]*\.[a-z]{2,}' then
      raise exception 'link must be an http or https URL';
    end if;
    new.link := left(new.link, 200);
  end if;

  if new.handle = '' then
    raise exception 'handle required';
  end if;

  -- A listing with no token could never be edited by anybody, so mint one
  -- rather than letting a client submit without.
  if new.edit_token is null then
    new.edit_token := gen_random_uuid();
  end if;

  return new;
end;
$fn$;

-- ------------------------------------------------------------------- view ---

-- `link` has to reach the board, so the view is rebuilt rather than replaced:
-- `create or replace view` can only append columns, and `link` belongs beside
-- the tagline it accompanies. `edit_token` is deliberately absent — it is the
-- one column the public must never read.
drop view if exists public.board;

create view public.board
with (security_invoker = true)
as
  select
    id,
    platform,
    url,
    handle,
    tagline,
    link,
    total_cents,
    last_paid_at,
    created_at,
    rank() over (partition by platform
                 order by total_cents desc, last_paid_at) as rank
  from public.listings l
  where hidden = false
    and last_paid_at is not null
    and last_paid_at > now() - interval '30 days';

grant select on public.board to anon, authenticated;

-- --------------------------------------------------------------- function ---

-- SECURITY DEFINER because `anon` has no UPDATE grant on `listings` and must
-- not get one: this function is the only writable path, and it can only reach
-- two columns of one row whose secret token the caller already holds.
create or replace function public.update_listing(
  p_id uuid, p_token uuid, p_tagline text, p_link text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_tagline text;
  v_link    text;
  v_rows    int;
begin
  if p_token is null then
    return jsonb_build_object('ok', false, 'reason', 'no_token');
  end if;

  v_tagline := nullif(left(btrim(coalesce(p_tagline, '')), 80), '');
  v_link    := nullif(btrim(coalesce(p_link, '')), '');

  if v_link is not null then
    if v_link !~* '^https?://[a-z0-9][a-z0-9._-]*\.[a-z]{2,}' then
      return jsonb_build_object('ok', false, 'reason', 'bad_link');
    end if;
    v_link := left(v_link, 200);
  end if;

  -- A hidden row stays hidden: moderation must not be undoable by its owner.
  update public.listings
     set tagline = v_tagline,
         link    = v_link
   where id = p_id
     and edit_token = p_token
     and hidden = false;

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    -- Wrong token, wrong id, or hidden. The caller is told the same thing in
    -- every case, so this cannot be used to probe which listings exist.
    return jsonb_build_object('ok', false, 'reason', 'not_yours');
  end if;

  return jsonb_build_object('ok', true, 'tagline', v_tagline, 'link', v_link);
end;
$fn$;

grant execute on function public.update_listing(uuid, uuid, text, text)
  to anon, authenticated;

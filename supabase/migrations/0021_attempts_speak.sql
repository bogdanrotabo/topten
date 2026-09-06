-- An attempt gets a card too.
--
-- Somebody who paid and did not take the page has still paid. Until now their
-- row carried a name, a figure and a time, and there was nowhere for them to
-- say anything -- the page took their money and gave them a line of statistics
-- about themselves.
--
-- So attempts get what reigns have: a message, a link, and a key to write them
-- with, handed over exactly once against the receipt they came back from
-- Stripe holding. Same rules, same limits, same lock.
--
-- The edit token is the same shape and the same secret as the one on reigns:
-- no column privilege for anon, absent from every view, absent from the
-- replication stream.

alter table public.attempts
  add column if not exists message text check (char_length(message) <= 100),
  add column if not exists url text check (url is null or
    (url ~* '^https?://[^\s<>"]{3,}$' and char_length(url) <= 300)),
  add column if not exists edit_token text not null default
    replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  add column if not exists token_claimed_at timestamptz;

comment on column public.attempts.edit_token is
  'Never leaves the server except once, to the browser that paid. Same standing as reigns.edit_token.';

-- What the list shows. The attempt's own words go in the card the page draws
-- for it, so the view has to carry them. Dropped and rebuilt, not replaced:
-- `create or replace view` can only append a column and refuses one put in the
-- middle -- the same trap 0020 hit.
drop view if exists public.attempts_on_king;
create view public.attempts_on_king
with (security_invoker = true) as
  select a.id, a.amount_cents, a.currency, a.name, a.message, a.url, a.created_at
  from public.attempts a
  join public.reigns r on r.id = a.reign_id
  where r.dethroned_at is null;

grant select (message, url) on public.attempts to anon, authenticated;
grant select on public.attempts_on_king to anon, authenticated;

-- ------------------------------------------------------------ the claim ----

-- Now hands the key over for an attempt as well, on the same terms: once, to
-- whoever comes back holding the receipt.
create or replace function public.claim_reign(
  p_session_id text default null,
  p_claim_ref  text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row   public.reigns%rowtype;
  v_att   public.attempts%rowtype;
  v_king  public.reigns%rowtype;
  v_first boolean;
  v_sid   text := nullif(btrim(coalesce(p_session_id, '')), '');
  v_ref   text := nullif(btrim(coalesce(p_claim_ref, '')), '');
begin
  if v_sid is null and v_ref is null then
    return jsonb_build_object('outcome', 'pending');
  end if;

  select * into v_row from public.reigns
   where (v_sid is not null and stripe_session_id = v_sid)
      or (v_ref is not null and claim_ref = v_ref)
   order by crowned_at desc
   limit 1;
  if found then
    v_first := v_row.token_claimed_at is null;
    if v_first then
      update public.reigns set token_claimed_at = now() where id = v_row.id;
    end if;
    return jsonb_build_object(
      'outcome', 'crowned',
      'reign', jsonb_build_object(
        'id', v_row.id, 'amount_cents', v_row.amount_cents, 'currency', v_row.currency,
        'name', v_row.name, 'url', v_row.url, 'message', v_row.message,
        'crowned_at', v_row.crowned_at, 'dethroned_at', v_row.dethroned_at),
      'edit_token', case when v_first then v_row.edit_token else null end,
      'token_already_issued', not v_first);
  end if;

  select * into v_att from public.attempts
   where (v_sid is not null and stripe_session_id = v_sid)
      or (v_ref is not null and claim_ref = v_ref)
   order by created_at desc
   limit 1;
  if found then
    select * into v_king from public.reigns where dethroned_at is null;
    v_first := v_att.token_claimed_at is null;
    if v_first then
      update public.attempts set token_claimed_at = now() where id = v_att.id;
    end if;
    return jsonb_build_object(
      'outcome', 'attempt',
      'amount_cents', v_att.amount_cents,
      'currency', v_att.currency,
      'created_at', v_att.created_at,
      'needed_cents', coalesce(v_king.amount_cents + 1, 100),
      'king_amount_cents', v_king.amount_cents,
      'king_name', v_king.name,
      -- The attempt's own card, so the form can be filled in rather than blank.
      'attempt', jsonb_build_object(
        'id', v_att.id, 'name', v_att.name, 'url', v_att.url, 'message', v_att.message),
      'edit_token', case when v_first then v_att.edit_token else null end,
      'token_already_issued', not v_first);
  end if;

  return jsonb_build_object('outcome', 'pending');
end;
$fn$;

-- ------------------------------------------------------------- the edit ----

-- One token, two tables. Which one it belongs to is not the caller's business
-- and not something they can steer: the token is looked for in reigns first
-- and then in attempts, and 244 bits of randomness do not collide.
create or replace function public.edit_reign(
  p_token   text,
  p_name    text,
  p_url     text,
  p_message text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row  public.reigns%rowtype;
  v_att  public.attempts%rowtype;
  v_url  text := nullif(btrim(coalesce(p_url, '')), '');
  v_name text := nullif(left(btrim(coalesce(p_name, '')), 40), '');
  v_msg  text := nullif(left(btrim(coalesce(p_message, '')), 100), '');
begin
  if p_token is null or char_length(p_token) < 32 then
    return jsonb_build_object('ok', false, 'reason', 'bad_token');
  end if;

  if v_url is not null and
     (v_url !~* '^https?://[^\s<>"]{3,}$' or char_length(v_url) > 300) then
    return jsonb_build_object('ok', false, 'reason', 'bad_url');
  end if;

  update public.reigns
     set name = v_name, url = v_url, message = v_msg
   where edit_token = p_token
  returning * into v_row;

  if found then
    return jsonb_build_object('ok', true, 'kind', 'reign', 'reign', jsonb_build_object(
      'id', v_row.id, 'amount_cents', v_row.amount_cents, 'currency', v_row.currency,
      'name', v_row.name, 'url', v_row.url, 'message', v_row.message,
      'crowned_at', v_row.crowned_at, 'dethroned_at', v_row.dethroned_at));
  end if;

  update public.attempts
     set name = v_name, url = v_url, message = v_msg
   where edit_token = p_token
  returning * into v_att;

  if found then
    return jsonb_build_object('ok', true, 'kind', 'attempt', 'reign', jsonb_build_object(
      'id', v_att.id, 'amount_cents', v_att.amount_cents, 'currency', v_att.currency,
      'name', v_att.name, 'url', v_att.url, 'message', v_att.message,
      'created_at', v_att.created_at));
  end if;

  return jsonb_build_object('ok', false, 'reason', 'unknown_token');
end;
$fn$;

revoke all on function public.claim_reign(text, text) from public, anon, authenticated;
grant execute on function public.claim_reign(text, text) to service_role;
revoke all on function public.edit_reign(text, text, text, text) from public, anon, authenticated;
grant execute on function public.edit_reign(text, text, text, text) to service_role;

-- ---------------------------------------------------------- the stream -----

do $do$
begin
  if exists (select 1 from pg_publication_tables
             where pubname = 'supabase_realtime'
               and schemaname = 'public' and tablename = 'attempts') then
    alter publication supabase_realtime drop table public.attempts;
  end if;
end;
$do$;

alter publication supabase_realtime add table public.attempts
  (id, amount_cents, currency, name, message, url, created_at, reign_id);

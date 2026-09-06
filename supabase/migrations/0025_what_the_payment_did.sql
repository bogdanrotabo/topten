-- What a payment did, told to the person who made it.
--
-- "Payment successful" is the least interesting true sentence a page can end
-- on. The payer wants to know whether the ranking moved, and the honest answer
-- has to be worked out from the ranking before and after their money landed --
-- never asserted, and never flattering.
--
-- Two things were missing for that.
--
-- The first is the receipt. Stripe hands a payer back to whatever success URL
-- the Payment Link carries, and that link is not ours to change: it may return
-- the Checkout Session id, or the client_reference_id the page sent, or
-- nothing at all. credit_payment() records the session id, so a session-id
-- receipt already works; a client_reference receipt had nowhere to be matched
-- against. payment_refs is that place.
--
-- The second is the ranking as it stood a moment earlier. The listing's total
-- has already moved by the time anybody asks, so "before" is reconstructed:
-- subtract this payment from this listing, and put its last_paid_at back to
-- whatever the previous payment set it to. That second half matters more than
-- it looks -- position is settled on money first and arrival second, so a
-- reconstruction that kept the new timestamp would report the wrong side of
-- every tie.

-- ------------------------------------------------------------ the receipt --

create table if not exists public.payment_refs (
  stripe_session_id text primary key,
  listing_id        uuid references public.listings(id) on delete set null,
  visit_session     text,
  client_reference  text,
  created_at        timestamptz not null default now()
);

create index if not exists payment_refs_client_idx on public.payment_refs (client_reference);
create index if not exists payment_refs_visit_idx  on public.payment_refs (visit_session);

alter table public.payment_refs enable row level security;
revoke all on public.payment_refs from public, anon, authenticated;

comment on table public.payment_refs is
  'What a payment came in holding: the listing, the visit that sent it, the raw client_reference. Read by payment_result() and by the revenue-by-campaign figures. Never readable with the publishable key.';

-- Written by the webhook, beside credit_payment() rather than inside it: the
-- money path stays exactly the audited thing it was, and a failure to record
-- a receipt can never fail a payment.
create or replace function public.record_payment_ref(
  p_session_id text,
  p_listing_id uuid default null,
  p_visit      text default null,
  p_reference  text default null
)
returns void
language sql
security definer
set search_path = ''
as $fn$
  insert into public.payment_refs (stripe_session_id, listing_id, visit_session, client_reference)
  values (p_session_id, p_listing_id, nullif(btrim(coalesce(p_visit, '')), ''),
          nullif(btrim(coalesce(p_reference, '')), ''))
  on conflict (stripe_session_id) do nothing;
$fn$;

revoke all on function public.record_payment_ref(text, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.record_payment_ref(text, uuid, text, text) to service_role;

-- ------------------------------------------------------------- the answer --

-- Given a receipt, what happened.
--
-- Granted to anon on purpose. A Checkout Session id and a client_reference are
-- both unguessable and both held only by the browser that paid; what comes
-- back is one payment's own story and nothing that is not already on the
-- public board. No token is handed over here and none ever will be: paying
-- towards a listing has never granted the right to edit it, because anybody
-- may pay towards anything and two dollars must not buy the pen.
create or replace function public.payment_result(
  p_session_id text default null,
  p_client_ref text default null
)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $fn$
declare
  v_sid    text := nullif(btrim(coalesce(p_session_id, '')), '');
  v_ref    text := nullif(btrim(coalesce(p_client_ref, '')), '');
  v_pay    public.payments%rowtype;
  v_lst    public.listings%rowtype;
  v_prev   timestamptz;
  v_before int;
  v_after  int;
  v_leader public.listings%rowtype;
  v_need   bigint;
begin
  if v_sid is null and v_ref is null then
    return jsonb_build_object('outcome', 'nothing');
  end if;

  select p.* into v_pay
    from public.payments p
   where (v_sid is not null and p.stripe_session_id = v_sid)
      or (v_ref is not null and p.stripe_session_id in
            (select r.stripe_session_id from public.payment_refs r
              where r.client_reference = v_ref))
   order by p.created_at desc
   limit 1;

  if not found then
    -- Almost always the browser getting back from Stripe before the webhook
    -- did. The page polls rather than telling somebody who has just paid that
    -- nothing happened.
    return jsonb_build_object('outcome', 'pending');
  end if;

  select * into v_lst from public.listings where id = v_pay.listing_id;
  if not found then
    return jsonb_build_object('outcome', 'orphan', 'amount_cents', v_pay.amount_cents,
                              'currency', v_pay.currency);
  end if;

  -- What last_paid_at held before this payment overwrote it. Position is money
  -- first and arrival second, so this is what decides the ties.
  select max(created_at) into v_prev
    from public.payments
   where listing_id = v_pay.listing_id and created_at < v_pay.created_at;

  with live as (
    select l.id, l.total_cents, l.last_paid_at
      from public.listings l
     where l.platform = v_lst.platform
       and l.hidden = false
       and l.last_paid_at is not null
       and l.last_paid_at > now() - interval '30 days'
  ),
  now_rank as (
    select id, rank() over (order by total_cents desc, last_paid_at) as rk from live
  ),
  then_rank as (
    select id, rank() over (order by total_cents desc, last_paid_at) as rk
      from (select id,
                   case when id = v_pay.listing_id then total_cents - v_pay.amount_cents
                        else total_cents end as total_cents,
                   case when id = v_pay.listing_id then coalesce(v_prev, last_paid_at)
                        else last_paid_at end as last_paid_at
              from live
             -- A listing that only exists because of this payment did not
             -- stand anywhere before it.
             where id <> v_pay.listing_id or total_cents - v_pay.amount_cents > 0) z
  )
  select (select rk from then_rank where id = v_pay.listing_id),
         (select rk from now_rank  where id = v_pay.listing_id)
    into v_before, v_after;

  select l.* into v_leader
    from public.listings l
   where l.platform = v_lst.platform and l.hidden = false
     and l.last_paid_at is not null and l.last_paid_at > now() - interval '30 days'
   order by l.total_cents desc, l.last_paid_at
   limit 1;

  v_need := case when v_leader.id = v_lst.id then null
                 else greatest(200, v_leader.total_cents - v_lst.total_cents + 1) end;

  return jsonb_build_object(
    'outcome',       'done',
    'amount_cents',  v_pay.amount_cents,
    'currency',      v_pay.currency,
    'paid_at',       v_pay.created_at,
    'platform',      v_lst.platform,
    'handle',        v_lst.handle,
    'total_cents',   v_lst.total_cents,
    'rank_before',   v_before,
    'rank_after',    v_after,
    'leader',        v_leader.handle,
    'leader_cents',  v_leader.total_cents,
    'is_leader',     v_leader.id = v_lst.id,
    'needed_cents',  v_need);
end;
$fn$;

revoke all on function public.payment_result(text, text) from public;
grant execute on function public.payment_result(text, text) to anon, authenticated;

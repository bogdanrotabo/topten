-- The owner is told when somebody pays.
--
-- Every payment on this site ends as one row in public.payments, written
-- by credit_payment() and by nothing else, exactly once per Stripe
-- session. That row is therefore the one honest place to hang an
-- announcement -- earlier than it, and money that never cleared would be
-- announced; later, and there is nowhere left to hang it.
--
-- The mail itself is sent by rotabo.app's `notify` function, because that
-- is where the sending account and the one verified sending domain live.
-- This site does not send it the details, only the id of the payment: the
-- function reads them back through alerta_plata() below, so a forged POST
-- cannot put words into an email. To get one sent at all you would have
-- to already know the uuid of a payment made in the last half hour.
--
-- Nothing here may cost anybody their rank: the trigger runs after the
-- row is in, hands the request to pg_net's queue without waiting for it,
-- and swallows its own failures with a warning.

create extension if not exists pg_net;

-- What the alert may say, straight from the source of truth. Fresh only:
-- a payment older than half an hour has already been announced, and an
-- id that has leaked since is not a doorbell.
create or replace function public.alerta_plata(p_ref uuid)
returns jsonb
language sql
security definer
set search_path = ''
stable
as $fn$
  select jsonb_build_object(
    'amount_cents', p.amount_cents,
    'currency',     p.currency,
    'what',         coalesce(l.platform, '?') || ' · ' || coalesce(l.handle, '?'),
    'lines',        jsonb_build_array(
      'board:      ' || coalesce(l.platform, '-'),
      'name:       ' || coalesce(l.handle, '-'),
      'tagline:    ' || coalesce(l.tagline, '-'),
      'link:       ' || coalesce(l.link, l.url, '-'),
      'now at:     ' || coalesce((l.total_cents / 100.0)::text, '?') || ' on that board',
      'listing:    ' || p.listing_id::text,
      'session:    ' || p.stripe_session_id,
      'page:       https://topten.one/' || coalesce(l.platform, '')
    )
  )
  from public.payments p
  left join public.listings l on l.id = p.listing_id
  where p.id = p_ref
    and p.created_at > now() - interval '30 minutes';
$fn$;

-- Callable by anon on purpose: rotabo.app's notify function has this
-- site's publishable key and nothing else, and the uuid it must already
-- hold is the real gate. Nothing personal is returned -- a handle and a
-- tagline are on the board for everyone to read.
revoke all on function public.alerta_plata(uuid) from public;
grant execute on function public.alerta_plata(uuid) to anon, authenticated, service_role;

create or replace function public.anunta_plata()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  perform net.http_post(
    url     := 'https://caqfbpzwdgnwjoaedjrg.supabase.co/functions/v1/notify',
    body    := jsonb_build_object('kind', 'payment', 'site', 'topten.one', 'ref', new.id),
    headers := jsonb_build_object('Content-Type', 'application/json')
  );
  return new;
exception when others then
  raise warning 'anunta_plata failed for %: %', new.id, sqlerrm;
  return new;
end;
$fn$;

revoke all on function public.anunta_plata() from public, anon, authenticated;

drop trigger if exists anunta_plata on public.payments;
create trigger anunta_plata
  after insert on public.payments
  for each row execute function public.anunta_plata();

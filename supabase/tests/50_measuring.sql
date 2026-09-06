-- What the growth report can and cannot tell the owner.
--
-- The fixture already carries payments, so what is checked here is the
-- DIFFERENCE one measured payment makes, plus the attribution -- which is the
-- part that is specific to the visit that sent it and therefore assertable
-- absolutely.
create or replace function ok(lbl text, cond boolean) returns void language plpgsql as $$
begin if cond then raise notice '  ok   %', lbl; else raise exception 'FAILED: %', lbl; end if; end $$;

\echo '— trei vizitatori: o campanie, o trimitere, un clic platit —'
insert into public.site_visits (session_id, path, referrer, country) values
 ('11111111-1111-4111-8111-111111111111', '/crypto/?utm_source=tiktok&utm_campaign=messi-a', null, 'RO'),
 ('11111111-1111-4111-8111-111111111111', '/crypto/', null, 'RO'),
 ('22222222-2222-4222-8222-222222222222', '/', 'https://news.ycombinator.com/item?id=1', 'US'),
 ('33333333-3333-4333-8333-333333333333', '/artists/?gclid=abc123', null, 'DE');

insert into public.site_events (session_id, name, board) values
 ('11111111-1111-4111-8111-111111111111', 'board_view', 'crypto'),
 ('11111111-1111-4111-8111-111111111111', 'back_clicked', 'crypto'),
 ('11111111-1111-4111-8111-111111111111', 'checkout_started', 'crypto'),
 ('22222222-2222-4222-8222-222222222222', 'board_view', 'crypto'),
 ('22222222-2222-4222-8222-222222222222', 'share_clicked', 'crypto');

create temp table _inainte as
  select growth_report(now() - interval '1 day', now() + interval '1 day') as r;

select credit_payment((select id from public.listings where handle='Solana'), 'cs_live_masurat', 500);
select record_payment_ref('cs_live_masurat',
  (select id from public.listings where handle='Solana'),
  '11111111-1111-4111-8111-111111111111', null);

do $$
declare a jsonb; b jsonb;
begin
  select r into a from _inainte;
  b := growth_report(now() - interval '1 day', now() + interval '1 day');
  raise notice '  vizitatori %, plati % -> %, venit % -> %',
    b->>'visitors', a->>'payments', b->>'payments', a->>'revenue_cents', b->>'revenue_cents';

  perform ok('numara vizitatorii distincti, nu afisarile', (b->>'visitors')::int = 3);
  perform ok('si afisarile separat', (b->>'pageviews')::int = 4);
  perform ok('numara clicurile pe Back', (b->>'back_clicks')::int = 1);
  perform ok('si inceputurile de checkout', (b->>'checkouts')::int = 1);
  perform ok('numara si share-urile', (b->>'shares')::int = 1);
  perform ok('vede plata noua', (b->>'payments')::int = (a->>'payments')::int + 1);
  perform ok('si exact cei 500 de centi', (b->>'revenue_cents')::int = (a->>'revenue_cents')::int + 500);
  perform ok('raporteaza rata de ducere la capat a checkoutului', (b->>'checkout_rate')::numeric > 0);

  perform ok('sursa tiktok are exact banii ei',
    (select (x->>'cents')::int from jsonb_array_elements(b->'top_sources') x where x->>'source'='tiktok') = 500);
  perform ok('si exact o plata',
    (select (x->>'payments')::int from jsonb_array_elements(b->'top_sources') x where x->>'source'='tiktok') = 1);
  perform ok('un clic cu gclid e recunoscut ca google-ads',
    exists (select 1 from jsonb_array_elements(b->'top_sources') x where x->>'source'='google-ads'));
  perform ok('o trimitere e vazuta dupa domeniu',
    exists (select 1 from jsonb_array_elements(b->'top_sources') x where x->>'source'='news.ycombinator.com'));
  perform ok('campania e numita si are banii',
    (select (x->>'cents')::int from jsonb_array_elements(b->'top_campaigns') x where x->>'campaign'='messi-a') = 500);
  perform ok('tarile sunt numarate', (select count(*) from jsonb_array_elements(b->'top_countries')) = 3);
  perform ok('boardul apare in topul veniturilor',
    exists (select 1 from jsonb_array_elements(b->'top_boards') x where x->>'board'='crypto'));
end $$;

\echo '— cine poate ce —'
do $$
begin
  perform ok('anon poate scrie un eveniment', has_table_privilege('anon','public.site_events','insert'));
  perform ok('dar nu il poate citi', not has_table_privilege('anon','public.site_events','select'));
  perform ok('si nu poate cere raportul',
    not has_function_privilege('anon','public.growth_report(timestamptz,timestamptz)','execute'));
end $$;

do $$
begin
  set local role anon;
  begin
    insert into public.site_events (session_id, name)
    values ('11111111-1111-4111-8111-111111111111','orice_vreau_eu');
    set local role postgres;
    raise exception 'FAILED: politica a lasat un eveniment necunoscut';
  exception when insufficient_privilege or check_violation then
    set local role postgres;
    raise notice '  ok   un eveniment care nu e pe lista e refuzat';
  end;
end $$;
\echo ''
\echo 'toate au trecut'

create or replace function ok(lbl text, cond boolean) returns void language plpgsql as $$
begin
  if cond then raise notice '  ok   %', lbl;
  else raise exception 'FAILED: %', lbl; end if;
end $$;

\echo '— o plata care nu misca pe nimeni —'
do $$
declare id uuid; r jsonb;
begin
  select l.id into id from public.listings l where l.handle='Bitcoin';   -- 2299+1 = 2300, e #4 din 5? verificam
  perform credit_payment(id, 'cs_live_r1', 200);
  perform record_payment_ref('cs_live_r1', id, 'vizita-1', id::text||'_vizita-1');
  r := payment_result('cs_live_r1', null);
  raise notice '  %', r::text;
  perform ok('gaseste plata', r->>'outcome' = 'done');
  perform ok('spune suma', (r->>'amount_cents')::int = 200);
  perform ok('are un rang inainte si unul dupa', (r->>'rank_before') is not null and (r->>'rank_after') is not null);
end $$;

\echo '— o plata care doar egaleaza, si una care trece —'
-- Fiecare plata e o instructiune separata, deci o tranzactie separata, deci
-- un now() separat. In productie fiecare webhook e la fel: propria tranzactie.
select credit_payment((select id from public.listings where handle='@b'), 'cs_live_boost', 500);
select credit_payment(
  (select id from public.listings where handle='@a'), 'cs_live_egal',
  (select total_cents from public.listings where handle='@b')
  - (select total_cents from public.listings where handle='@a'));
select record_payment_ref('cs_live_egal', (select id from public.listings where handle='@a'), 'vizita-2', null);

do $$
declare r jsonb;
begin
  r := payment_result('cs_live_egal', null);
  raise notice '  egal: rang % -> %, lider %, mai trebuie %',
    r->>'rank_before', r->>'rank_after', r->>'leader', coalesce(r->>'needed_cents','-');
  perform ok('sumele sunt acum egale',
    (select total_cents from public.listings where handle='@a')
    = (select total_cents from public.listings where handle='@b'));
  perform ok('si totusi egalul NU ia locul 1', (r->>'is_leader')::boolean = false);
  perform ok('ramane pe 2', (r->>'rank_after')::int = 2);
  perform ok('i se spune ca mai trebuie exact minimul', (r->>'needed_cents')::bigint = 200);
end $$;

select credit_payment((select id from public.listings where handle='@a'), 'cs_live_peste', 200);
select record_payment_ref('cs_live_peste', (select id from public.listings where handle='@a'), 'vizita-3', null);

do $$
declare r jsonb;
begin
  r := payment_result('cs_live_peste', null);
  raise notice '  peste: rang % -> %, lider %', r->>'rank_before', r->>'rank_after', r->>'is_leader';
  perform ok('acum ia locul 1', (r->>'is_leader')::boolean and (r->>'rank_after')::int = 1);
  perform ok('si venea de pe locul 2', (r->>'rank_before')::int = 2);
  perform ok('nu mai are nevoie de nimic', (r->>'needed_cents') is null);
end $$;

\echo '— prima plata pe o listare noua —'
do $$
declare nou jsonb; id uuid; r jsonb;
begin
  nou := create_listing('crypto','https://c.io/nou','Noul','','');
  id := (nou->>'id')::uuid;
  perform credit_payment(id, 'cs_live_nou', 200);
  perform record_payment_ref('cs_live_nou', id, 'vizita-4', null);
  r := payment_result('cs_live_nou', null);
  raise notice '  nou: rang % -> %', coalesce(r->>'rank_before','(niciunul)'), r->>'rank_after';
  perform ok('nu avea rang inainte', (r->>'rank_before') is null);
  perform ok('are unul acum', (r->>'rank_after')::int > 0);
end $$;

\echo '— chitanta prin client_reference —'
do $$
declare r jsonb;
begin
  r := payment_result(null, (select id::text from public.listings where handle='Bitcoin')||'_vizita-1');
  perform ok('se gaseste si dupa client_reference', r->>'outcome' = 'done');
end $$;

\echo '— o chitanta care nu inseamna nimic —'
do $$
begin
  perform ok('o sesiune necunoscuta e "pending"', payment_result('cs_live_habarnam', null)->>'outcome' = 'pending');
  perform ok('fara nimic in mana, "nothing"', payment_result(null, null)->>'outcome' = 'nothing');
end $$;

\echo '— cine poate chema ce —'
do $$
begin
  perform ok('anon poate cere rezultatul', has_function_privilege('anon','public.payment_result(text,text)','execute'));
  perform ok('anon NU poate scrie chitante', not has_function_privilege('anon','public.record_payment_ref(text,uuid,text,text)','execute'));
  perform ok('anon NU vede tabelul chitantelor', not has_table_privilege('anon','public.payment_refs','select'));
end $$;
\echo ''
\echo 'toate au trecut'

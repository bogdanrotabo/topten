\set ON_ERROR_STOP on
\pset pager off
create or replace function ok(lbl text, cond boolean) returns void language plpgsql as $$
begin
  if cond then raise notice '  ok   %', lbl;
  else raise exception 'FAILED: %', lbl; end if;
end $$;

\echo '— rangul si regula de departajare —'
do $$
declare a text; b text; ra int; rb int;
begin
  select handle, rank into a, ra from public.board where platform='x' order by rank limit 1;
  select handle, rank into b, rb from public.board where platform='x' order by rank desc limit 1;
  -- @a and @b both hold 30700; @b paid 5 days ago, @a 2 days ago -> @b is first
  perform ok('doua listari egale nu impart locul 1', ra <> rb);
  perform ok('cel care a ajuns primul la suma sta deasupra', b = '@a' and a = '@b');
end $$;

\echo '— cat costa sa treci peste #1 —'
do $$
declare v_top bigint; v_me bigint; v_need bigint;
begin
  select total_cents into v_top from public.board where platform='crypto' and rank=1;
  select total_cents into v_me  from public.board where platform='crypto' and rank=2;
  v_need := v_top - v_me + 1;
  perform ok('un egal nu ajunge: trebuie diferenta + 1 cent', v_need = 2);
  perform ok('sub minimul de $2 raspunsul ramane $2', greatest(v_need, 200) = 200);
end $$;

\echo '— expirare si reactivare —'
do $$
declare v_inainte bigint; v_dupa bigint; v_vizibil int;
begin
  select count(*) into v_vizibil from public.board where handle='Someone';
  perform ok('o listare de acum 40 de zile nu e pe board', v_vizibil = 0);
  select total_cents into v_inainte from public.listings where handle='Someone';
  perform ok('dar randul ei si totalul ei sunt acolo', v_inainte > 0);
  perform credit_payment((select id from public.listings where handle='Someone'), 'cs_live_reactivare', 200);
  select count(*) into v_vizibil from public.board where handle='Someone';
  select total_cents into v_dupa from public.listings where handle='Someone';
  perform ok('o plata o readuce pe board', v_vizibil = 1);
  perform ok('cu totalul istoric pastrat, nu resetat', v_dupa = v_inainte + 200);
end $$;

\echo '— creditarea unei plati —'
do $$
declare v_id uuid; r jsonb; t1 bigint; t2 bigint;
begin
  select id into v_id from public.listings where handle='Bitcoin';
  select total_cents into t1 from public.listings where id=v_id;
  r := credit_payment(v_id, 'cs_live_noua', 500);
  select total_cents into t2 from public.listings where id=v_id;
  perform ok('plata se aduna la total', t2 = t1 + 500);
  perform ok('si raspunde cu totalul nou', (r->>'total_cents')::bigint = t2);

  r := credit_payment(v_id, 'cs_live_noua', 500);
  perform ok('acelasi webhook livrat de doua ori nu numara de doua ori',
             (r->>'duplicate')::boolean and (select total_cents from public.listings where id=v_id) = t2);

  r := credit_payment(gen_random_uuid(), 'cs_live_fantoma', 500);
  perform ok('o listare care nu exista nu creeaza bani', r->>'reason' = 'unknown_listing');

  r := credit_payment(v_id, 'cs_live_zero', 0);
  perform ok('o suma de zero e refuzata', r->>'reason' = 'bad_amount');
  r := credit_payment(v_id, 'cs_live_neg', -500);
  perform ok('si una negativa la fel', r->>'reason' = 'bad_amount');
end $$;

\echo '— o listare noua, si cheia ei —'
do $$
declare r jsonb; r2 jsonb; v_tok uuid;
begin
  r := create_listing('crypto','https://c.io/eth','Ethereum','the other one','https://ethereum.org');
  perform ok('o listare noua se creeaza', (r->>'ok')::boolean and not (r->>'existing')::boolean);
  perform ok('si primeste o cheie, o singura data', (r->>'edit_token') is not null);
  v_tok := (r->>'edit_token')::uuid;

  perform ok('porneste de la zero, orice ar fi trimis clientul',
             (select total_cents from public.listings where id=(r->>'id')::uuid) = 0);
  perform ok('deci nu e pe board pana nu plateste cineva',
             (select count(*) from public.board where handle='Ethereum') = 0);

  r2 := create_listing('crypto','https://c.io/eth','Altcineva',null,null);
  perform ok('a doua trimitere pentru acelasi url gaseste randul existent',
             (r2->>'id') = (r->>'id') and (r2->>'existing')::boolean);
  perform ok('si NU primeste cheia altuia', (r2->>'edit_token') is null);

  perform ok('cheia buna scrie randul',
             (update_listing((r->>'id')::uuid, v_tok, 'schimbat', 'https://b.com')->>'ok')::boolean);
  perform ok('o cheie gresita nu scrie nimic',
             (update_listing((r->>'id')::uuid, gen_random_uuid(), 'furat', null)->>'reason') = 'not_yours');
  perform ok('si textul chiar s-a schimbat',
             (select tagline from public.listings where id=(r->>'id')::uuid) = 'schimbat');
end $$;

\echo '— ce poate citi cineva cu cheia publica —'
do $$
declare n int;
begin
  set local role anon;
  select count(*) into n from public.board;
  perform ok('anon vede boardul', n > 0);
  set local role postgres;
end $$;

do $$
declare gasit boolean;
begin
  select exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='listings' and column_name='edit_token')
    into gasit;
  perform ok('coloana edit_token nu mai sta pe listings', not gasit);

  select has_table_privilege('anon','public.listing_tokens','select') into gasit;
  perform ok('anon nu are voie sa citeasca tabelul cheilor', not gasit);
  select has_table_privilege('anon','public.payments','select') into gasit;
  perform ok('si nici platile', not gasit);
  select has_table_privilege('anon','public.listings','insert') into gasit;
  perform ok('nu mai poate insera direct in listings', not gasit);
  select has_function_privilege('anon','public.credit_payment(uuid,text,bigint,text)','execute') into gasit;
  perform ok('si nu poate chema creditarea', not gasit);
end $$;

do $$
declare n int;
begin
  set local role anon;
  begin
    select count(*) into n from public.listing_tokens;
    set local role postgres;
    raise exception 'FAILED: anon a citit listing_tokens';
  exception when insufficient_privilege then
    set local role postgres;
    raise notice '  ok   incercarea lui anon de a citi cheile e refuzata de Postgres';
  end;
end $$;

\echo '— banii nu se pot scrie din browser —'
do $$
declare n int;
begin
  set local role anon;
  begin
    update public.listings set total_cents = 999999 where handle='Bitcoin';
    set local role postgres;
    raise exception 'FAILED: anon a scris in total_cents';
  exception when insufficient_privilege then
    set local role postgres;
    raise notice '  ok   anon nu poate atinge total_cents';
  end;
end $$;

\echo '— tronul a plecat —'
do $$
begin
  perform ok('reigns nu mai e in public', to_regclass('public.reigns') is null);
  perform ok('attempts nu mai e in public', to_regclass('public.attempts') is null);
  perform ok('dar amandoua sunt in archive',
             to_regclass('archive.reigns') is not null and to_regclass('archive.attempts') is not null);
  perform ok('view-ul king a disparut', to_regclass('public.king') is null);
end $$;

\echo ''
\echo 'toate au trecut'

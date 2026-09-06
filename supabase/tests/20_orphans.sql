do $$
declare r jsonb; n int;
begin
  r := record_orphan_payment('cs_live_orfan', 500, 'usd', 'ceva-vechi', 'unknown_listing');
  if not (r->>'ok')::boolean or (r->>'duplicate')::boolean then raise exception 'FAILED: prima scriere'; end if;
  raise notice '  ok   o plata fara listare se scrie undeva';
  r := record_orphan_payment('cs_live_orfan', 500, 'usd', 'ceva-vechi', 'unknown_listing');
  if not (r->>'duplicate')::boolean then raise exception 'FAILED: duplicat'; end if;
  select count(*) into n from public.unmatched_payments where stripe_session_id='cs_live_orfan';
  if n <> 1 then raise exception 'FAILED: % randuri', n; end if;
  raise notice '  ok   si un retry de la Stripe nu o scrie a doua oara';
  if has_table_privilege('anon','public.unmatched_payments','select') then
    raise exception 'FAILED: anon vede platile orfane'; end if;
  raise notice '  ok   nimeni cu cheia publica nu le vede';
end $$;

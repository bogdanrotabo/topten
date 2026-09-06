#!/usr/bin/env bash
# The same suite as run.sh, against the Postgres a CI runner hands us.
#
# run.sh starts a throwaway cluster because a laptop has no database waiting;
# a runner does, as a service container, so the only difference between the two
# is how psql is reached. The tests themselves are the same files.
set -euo pipefail
cd "$(dirname "$0")/../.."

PSQL=${PSQL:-psql -h 127.0.0.1 -p 5432 -U postgres}

work=$(mktemp -d); trap 'rm -rf "$work"' EXIT
cp supabase/tests/*.sql "$work/"
for m in 0022_boards_return 0023_throne_archived 0025_what_the_payment_did 0026_measuring; do
  short=${m%%_*}
  cp "supabase/migrations/$m.sql" "$work/$short.sql"
  # pg_cron is a Supabase extension and not on a plain postgres:16 image. The
  # two lines that use it are copied verbatim from 0001, which has been in
  # production since August, and are the only thing stubbed here.
  sed -i 's/^create extension if not exists pg_cron;/-- not on this image/' "$work/$short.sql"
  { echo 'begin;'; cat "$work/$short.sql"; echo 'commit;'; } > "$work/$short.tx.sql"
done

echo "— the fixture —"
$PSQL -v ON_ERROR_STOP=1 -q -f "$work/00_fixture.sql" > /dev/null

echo "— the migrations —"
for m in 0022 0023 0025 0026; do
  $PSQL -v ON_ERROR_STOP=1 -q -f "$work/$m.tx.sql" 2>&1 | grep -i 'restored\|error' || true
done

fail=0
for t in 10_money 20_orphans 30_old_hole 40_result 50_measuring; do
  echo "— $t —"
  out=$($PSQL -v ON_ERROR_STOP=1 -q -f "$work/$t.sql" 2>&1) || fail=1
  echo "$out" | sed 's/psql:[^ ]* NOTICE: *//' \
    | grep -v '^CREATE FUNCTION$\|^DO$\|^DROP\|^CREATE\|^GRANT\|^REVOKE\|^INSERT\|^ALTER\|^SELECT\|drop cascades\|^-\+$\|^ *$\|^(1 row)$'
  echo "$out" | grep -q 'FAILED\|ERROR' && fail=1
done
exit $fail

#!/usr/bin/env bash
# The economic path, checked on a throwaway Postgres.
#
#   bash supabase/tests/run.sh
#
# Builds a small replica of the pre-restore database -- the old listings and
# payments sitting in `archive`, King of the Hill sitting in `public` -- then
# applies 0022 and 0023 to it and asks the questions that matter about money:
# does a payment add up, does a duplicate webhook delivery add up twice, does
# a tie lose, does an expired listing keep its total, and can anybody holding
# the publishable key reach a secret or a cent.
#
# It needs a local PostgreSQL 16 and a user to run it as; it never touches the
# real database. pg_cron and pg_net are stubbed, because this box has neither
# and the two lines that use them are copied verbatim from 0001 and 0018,
# which have been in production since August.
set -euo pipefail
cd "$(dirname "$0")/../.."

PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
PGDIR=${PGDIR:-/tmp/topten-test-db}
PGUSER_RUN=${PGUSER_RUN:-pgtest}
PORT=${PORT:-5433}

run() { su "$PGUSER_RUN" -c "$PGBIN/psql -h /tmp -p $PORT -U postgres $*"; }

if ! run "-tAc 'select 1'" >/dev/null 2>&1; then
  echo "starting a throwaway cluster in $PGDIR"
  rm -rf "$PGDIR"; mkdir -p "$PGDIR"
  chown "$PGUSER_RUN":"$PGUSER_RUN" "$PGDIR"; chmod 700 "$PGDIR"
  su "$PGUSER_RUN" -c "$PGBIN/initdb -D $PGDIR -A trust -U postgres" >/dev/null
  su "$PGUSER_RUN" -c "$PGBIN/pg_ctl -D $PGDIR -o '-p $PORT -c listen_addresses= -c unix_socket_directories=/tmp -c wal_level=logical' -l $PGDIR.log start" >/dev/null
  sleep 2
fi

work=$(mktemp -d); trap 'rm -rf "$work"' EXIT
cp supabase/tests/*.sql "$work/"
cp supabase/migrations/0022_boards_return.sql "$work/0022.sql"
cp supabase/migrations/0023_throne_archived.sql "$work/0023.sql"
cp supabase/migrations/0025_what_the_payment_did.sql "$work/0025.sql"
sed -i 's/^create extension if not exists pg_cron;/-- stubbed for the test box/' "$work/0022.sql"
# Each migration goes in as one transaction, which is how the money check at
# the end of 0022 gets to be a gate rather than a report.
for m in 0022 0023 0025; do
  { echo 'begin;'; cat "$work/$m.sql"; echo 'commit;'; } > "$work/$m.tx.sql"
done
chmod 644 "$work"/*.sql; chmod 755 "$work"

run "-q -c 'drop schema if exists public cascade; drop schema if exists archive cascade;
            drop schema if exists cron cascade; drop schema if exists net cascade;
            create schema public;'" >/dev/null 2>&1 || true
run "-q -c 'drop publication if exists supabase_realtime;
            drop role if exists anon; drop role if exists authenticated;
            drop role if exists service_role;'" >/dev/null 2>&1 || true

run "-v ON_ERROR_STOP=1 -q -f $work/00_fixture.sql" >/dev/null
echo "— the restore —"
run "-v ON_ERROR_STOP=1 -q -f $work/0022.tx.sql" 2>&1 | grep -i 'restored' | sed 's/.*NOTICE: */  /'
run "-v ON_ERROR_STOP=1 -q -f $work/0023.tx.sql" >/dev/null
run "-v ON_ERROR_STOP=1 -q -f $work/0025.tx.sql" >/dev/null

fail=0
for t in 10_money 20_orphans 30_old_hole 40_result; do
  out=$(run "-v ON_ERROR_STOP=1 -q -f $work/$t.sql" 2>&1) || fail=1
  echo "$out" | sed 's/psql:[^ ]* NOTICE: *//' | grep -v '^CREATE FUNCTION$\|^DO$\|^DROP\|^CREATE\|^GRANT\|^REVOKE\|^INSERT\|^ALTER\|drop cascades'
  echo "$out" | grep -q 'FAILED\|ERROR' && fail=1
done
exit $fail

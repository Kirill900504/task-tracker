#!/usr/bin/env bash
# Поднимает временный Postgres для scripts/test-schema.mjs.
#
# Not a development database and not a copy of production: an empty server
# that lives in a scratch directory, so that migrations can be applied from
# nothing and thrown away. Everything real still lives in Supabase.
#
#   scripts/start-test-db.sh && node scripts/test-schema.mjs
set -euo pipefail

PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
PGDATA=${PGDATA:-/tmp/rokas-test-db}
PORT=${PORT:-5433}

if [ ! -x "$PGBIN/initdb" ]; then
  echo "Postgres не найден в $PGBIN — задайте PGBIN или установите postgresql" >&2
  exit 1
fi

if "$PGBIN/pg_isready" -h localhost -p "$PORT" >/dev/null 2>&1; then
  echo "База уже слушает порт $PORT"
  exit 0
fi

rm -rf "$PGDATA"
mkdir -p "$PGDATA"
"$PGBIN/initdb" -D "$PGDATA" -U postgres --auth=trust >/dev/null
"$PGBIN/pg_ctl" -D "$PGDATA" -o "-c listen_addresses=localhost -p $PORT" -l "$PGDATA/log" start
echo "Postgres поднят на порту $PORT"

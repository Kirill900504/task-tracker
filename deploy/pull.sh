#!/usr/bin/env bash
# Fetch and switch to the newest build, once a minute (/etc/cron.d).
#
# deploy.yml publishes every main build to the server-build pre-release;
# the server pulls it rather than GitHub pushing in, so no key to this
# machine exists anywhere outside it. A build that failed to start is
# remembered and not retried every minute — the tracker stays on the
# previous one until the next push brings a new build.
set -euo pipefail

APP=/srv/tracker
BASE=https://github.com/Kirill900504/task-tracker/releases/download/server-build

exec 9>"$APP/pull.lock"
flock -n 9 || exit 0

SHA="$(curl -fsSL -m 20 "$BASE/build.sha?t=$(date +%s)" | tr -dc 'a-f0-9')"
[ -n "$SHA" ] || exit 0
[ "$SHA" = "$(cat "$APP/deployed.sha" 2>/dev/null || true)" ] && exit 0
[ "$SHA" = "$(cat "$APP/failed.sha" 2>/dev/null || true)" ] && exit 0

curl -fsSL -m 300 -o "$APP/incoming.tgz" "$BASE/build.tgz?t=$(date +%s)"
if "$APP/bin/activate" "$SHA"; then
  echo "$SHA" > "$APP/deployed.sha"
else
  echo "$SHA" > "$APP/failed.sha"
  exit 1
fi

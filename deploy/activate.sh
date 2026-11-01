#!/usr/bin/env bash
# Switch the tracker to a freshly uploaded build:  activate <sha>
# Called by deploy.yml after it uploads /srv/tracker/incoming.tgz.
#
# Each build gets its own folder and `current` is a symlink, so going back
# is one command — `activate <older sha>` with a folder that is still there —
# which is what Vercel's instant rollback used to give us. If the new build
# does not answer /api/version within thirty seconds, the previous one is
# put back on its own: a broken deploy must not stay live while nobody looks.
set -euo pipefail

APP=/srv/tracker
SHA="$1"
NEW="$APP/releases/$SHA"
PREV="$(readlink -f "$APP/current" 2>/dev/null || true)"

if [ -f "$APP/incoming.tgz" ]; then
  rm -rf "$NEW"
  mkdir -p "$NEW"
  tar -xzf "$APP/incoming.tgz" -C "$NEW"
  rm "$APP/incoming.tgz"
fi
[ -f "$NEW/server.js" ] || { echo "Нет сборки $SHA"; exit 1; }

ln -sfn "$NEW" "$APP/current"
sudo /usr/bin/systemctl restart rokas-tracker

for _ in $(seq 1 30); do
  if curl -fsS -m 2 http://127.0.0.1:3000/api/version >/dev/null 2>&1; then
    # Keep the five newest builds for rollback, drop the rest.
    ls -1dt "$APP"/releases/*/ | tail -n +6 | xargs -r rm -rf
    echo "Работает сборка $SHA"
    exit 0
  fi
  sleep 1
done

echo "Сборка $SHA не ответила — возвращаю прежнюю"
if [ -n "$PREV" ] && [ -d "$PREV" ]; then
  ln -sfn "$PREV" "$APP/current"
  sudo /usr/bin/systemctl restart rokas-tracker
fi
exit 1

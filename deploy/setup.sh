#!/usr/bin/env bash
# One-time setup of the tracker's own server (Timeweb Cloud, Moscow, Ubuntu
# 24.04), run as root:  bash setup.sh
#
# Why a server at all: on 31.10.2026 Vercel's free plan switched the whole
# site off for the month (fair-use limit on CPU time), and with it both bots.
# Why Moscow and MAX only: api.telegram.org does not answer from Russian data
# centres (0 of 10 measured on 01.11.2026), while MAX, GigaChat and Supabase
# all do — and a Russian address is not cut off by Russian networks the way
# *.vercel.app is.
#
# Safe to run again: every step checks before it changes anything.
set -euo pipefail

NODE_VERSION=24.11.1
APP=/srv/tracker
DOMAIN=tracker.rokass.ru

export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q caddy curl ufw unattended-upgrades xz-utils

# Node from nodejs.org rather than a third-party apt repository: one file,
# a pinned version, nothing else to trust.
if ! node --version 2>/dev/null | grep -q "v$NODE_VERSION"; then
  curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-linux-x64.tar.xz" -o /tmp/node.tar.xz
  tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1
  rm /tmp/node.tar.xz
fi

# Swap: the speech model (Whisper, lib/speechToText) takes a few hundred MB
# while it runs, and 2 GB of RAM with no swap turns a memory spike into the
# kernel killing the tracker.
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q /swapfile /etc/fstab || echo "/swapfile none swap sw 0 0" >> /etc/fstab
fi

id tracker >/dev/null 2>&1 || useradd --system --create-home --home-dir "$APP" --shell /bin/bash tracker
mkdir -p "$APP/releases" "$APP/bin"

install -m 755 "$(dirname "$0")/activate.sh" "$APP/bin/activate"
install -m 755 "$(dirname "$0")/pull.sh" "$APP/bin/pull"
install -m 755 "$(dirname "$0")/cron.sh" "$APP/bin/cron"
chown -R tracker:tracker "$APP"

# Secrets live here and nowhere else on the server; filled in once by hand
# (or by the session that set the server up), never committed.
if [ ! -f /etc/rokas-tracker.env ]; then
  install -m 640 -o root -g tracker /dev/null /etc/rokas-tracker.env
fi

install -m 644 "$(dirname "$0")/rokas-tracker.service" /etc/systemd/system/rokas-tracker.service
systemctl daemon-reload
systemctl enable rokas-tracker >/dev/null

# The deploy user may restart the tracker and nothing else.
echo "tracker ALL=(root) NOPASSWD: /usr/bin/systemctl restart rokas-tracker, /usr/bin/systemctl is-active rokas-tracker" > /etc/sudoers.d/rokas-tracker
chmod 440 /etc/sudoers.d/rokas-tracker

install -m 644 "$(dirname "$0")/Caddyfile" /etc/caddy/Caddyfile
systemctl reload caddy || systemctl restart caddy

# What Vercel did for us besides serving pages: deploying every push (now
# pulled, see pull.sh), the reminders pinger (every five minutes) and the
# weekly backup (vercel.json, Mondays 06:00 UTC).
cat > /etc/cron.d/rokas-tracker <<CRON
* * * * * tracker $APP/bin/pull >> $APP/pull.log 2>&1
*/5 * * * * tracker $APP/bin/cron reminders
0 6 * * 1 tracker $APP/bin/cron backup
CRON
chmod 644 /etc/cron.d/rokas-tracker

ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null

echo "Готово. Сайт: https://$DOMAIN (сертификат придёт сам, как только DNS укажет сюда)."

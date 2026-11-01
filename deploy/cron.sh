#!/usr/bin/env bash
# The tracker's own scheduled calls (see /etc/cron.d/rokas-tracker):
#   cron reminders — every five minutes: reminders, briefs, escalation
#   cron backup    — Mondays: the weekly JSON backup to every messenger
# Straight to the local port: the call never leaves the machine, and it does
# not depend on DNS or the certificate being in order.
set -euo pipefail
set -a
# shellcheck disable=SC1091
. /etc/rokas-tracker.env
set +a
exec curl -fsS -m 280 -o /dev/null -H "Authorization: Bearer $CRON_SECRET" "http://127.0.0.1:3000/api/cron/$1"

#!/bin/sh
# Remove the outer "mkdir heartbeat.lock && ... ; rmdir heartbeat.lock" gate
# from the agent cron entry. Idempotent.
set -eu
CRONTAB=/etc/config/crontab
BACKUP=/etc/config/crontab.bak.$(date +%Y%m%d_%H%M%S)

if [ "$(id -u)" != "0" ]; then
  echo "This script must be run as root (sudo)." >&2
  exit 1
fi

cp "$CRONTAB" "$BACKUP"
echo "Backup: $BACKUP"

# Pattern: " && mkdir /share/CACHEDEV1_DATA/ai-server-agent/data/heartbeat.lock 2>/dev/null"
# Pattern: "; rmdir data/heartbeat.lock"
# Using | as sed delimiter since paths contain /
sed -i \
  -e 's| && mkdir /share/CACHEDEV1_DATA/ai-server-agent/data/heartbeat.lock 2>/dev/null||g' \
  -e 's|; rmdir data/heartbeat.lock||g' \
  "$CRONTAB"

echo "--- new agent line ---"
grep ai-server-agent "$CRONTAB" || true
echo "----------------------"

# Also clear any stale lock on disk before crond reloads.
rm -rf /share/CACHEDEV1_DATA/ai-server-agent/data/heartbeat.lock 2>/dev/null || true

crontab "$CRONTAB"
/etc/init.d/crond.sh restart
echo "crond restarted."

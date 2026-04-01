#!/bin/sh
# setup-cron.sh — register gomes cron jobs (agent heartbeat + news generation)
# Safe to call as root (from autorun.sh) or as gomes directly.
#
# Add to /etc/config/autorun.sh for reboot persistence (run once as admin):
#   echo "/share/CACHEDEV1_DATA/ai-server-agent/setup-cron.sh" >> /etc/config/autorun.sh

AGENT_HOME="$(cd "$(dirname "$0")" && pwd)"
CRON_PATH=/share/CACHEDEV1_DATA/.qpkg/container-station/bin
ACTIVE_CRONTAB=/tmp/cron/crontabs/gomes

# If running as root: create gomes crontab file if missing
if [ "$(id -u)" = "0" ]; then
  if [ ! -f "$ACTIVE_CRONTAB" ]; then
    touch "$ACTIVE_CRONTAB"
    chown gomes "$ACTIVE_CRONTAB"
    chmod 600 "$ACTIVE_CRONTAB"
  fi
fi

# Clean up stale agent lock
rmdir "${AGENT_HOME}/data/heartbeat.lock" 2>/dev/null || true

AGENT_ENTRY="*/30 * * * * mkdir -p ${AGENT_HOME}/data && mkdir ${AGENT_HOME}/data/heartbeat.lock 2>/dev/null && (export PATH=/share/CACHEDEV1_DATA/.local/bin:${CRON_PATH}:/opt/bin:\$PATH; cd ${AGENT_HOME} && ./start.sh --once >> logs/agent.log 2>&1; rmdir data/heartbeat.lock) || true"

NEWS_HOME=/share/CACHEDEV1_DATA/claude-news
NEWS_CMD="/usr/local/lib/docker/cli-plugins/docker-compose -f ${NEWS_HOME}/docker-compose.yml run --rm claude-news >> ${NEWS_HOME}/logs/news.log 2>&1"
NEWS_ENTRY_AM="0 9 * * * ${NEWS_CMD}"
NEWS_ENTRY_PM="0 21 * * * ${NEWS_CMD}"

changed=0

add_if_missing() {
  local marker="$1"
  local entry="$2"
  if ! grep -qF "$marker" "$ACTIVE_CRONTAB" 2>/dev/null; then
    echo "$entry" >> "$ACTIVE_CRONTAB"
    echo "Added: $marker"
    changed=1
  fi
}

add_if_missing "ai-server-agent"  "$AGENT_ENTRY"
add_if_missing "9 * * * * /usr/local"  "$NEWS_ENTRY_AM"
add_if_missing "21 * * * * /usr/local" "$NEWS_ENTRY_PM"

if [ "$changed" = "1" ]; then
  /etc/init.d/crond.sh restart 2>/dev/null || true
  echo "crond restarted."
else
  echo "All cron entries already active, nothing to do."
fi

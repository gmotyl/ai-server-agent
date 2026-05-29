#!/bin/sh
# setup-cron.sh — register the gomes agent-heartbeat cron job.
# News generation is handled by the soft cron (data/schedules.json: generate-news,
# 0 12 * * *), evaluated by the heartbeat — NOT by a hardcoded system crontab entry.
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

# Clean up stale agent lock left behind by a crashed/killed previous run.
# start.sh's own stale-pid reclaim only fires if it actually starts — so we
# always clear any orphan lock here before reinstalling the cron entry.
rm -rf "${AGENT_HOME}/data/heartbeat.lock" 2>/dev/null || true

# Cron entry: delegate lock handling entirely to start.sh.
# Earlier versions wrapped the call in `mkdir .../heartbeat.lock && (... ; rmdir ...)`,
# which made the outer mkdir a silent gate: any leftover lock (reboot, SIGKILL)
# short-circuited the && chain forever and start.sh's stale-pid reclaim never ran.
AGENT_ENTRY="*/30 * * * * mkdir -p ${AGENT_HOME}/data && (export PATH=/share/CACHEDEV1_DATA/.local/bin:${CRON_PATH}:/opt/bin:\$PATH; cd ${AGENT_HOME} && ./start.sh --once >> logs/agent.log 2>&1) || true"

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

if [ "$changed" = "1" ]; then
  /etc/init.d/crond.sh restart 2>/dev/null || true
  echo "crond restarted."
else
  echo "All cron entries already active, nothing to do."
fi

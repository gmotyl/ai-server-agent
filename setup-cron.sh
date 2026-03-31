#!/bin/sh
# setup-cron.sh — add ai-server-agent heartbeat to the gomes user crontab
# Run once manually as gomes, or call from /etc/config/autorun.sh for persistence.
#
# To survive reboots automatically (run this once as admin):
#   echo 'su gomes -c "/share/CACHEDEV1_DATA/ai-server-agent/setup-cron.sh"' | sudo tee -a /etc/config/autorun.sh
#
# If called from autorun.sh as root, it switches to gomes automatically.

AGENT_HOME="$(cd "$(dirname "$0")" && pwd)"
MARKER="ai-server-agent"
CRON_PATH=/share/CACHEDEV1_DATA/.qpkg/container-station/bin
ACTIVE_CRONTAB=/tmp/cron/crontabs/gomes

# If running as root, re-exec as gomes
if [ "$(id -u)" = "0" ]; then
  exec su gomes -c "\"$0\""
fi

ENTRY="*/30 * * * * mkdir -p ${AGENT_HOME}/data && mkdir ${AGENT_HOME}/data/heartbeat.lock 2>/dev/null && (export PATH=/share/CACHEDEV1_DATA/.local/bin:${CRON_PATH}:/opt/bin:\$PATH; cd ${AGENT_HOME} && ./start.sh --once >> logs/agent.log 2>&1; rmdir data/heartbeat.lock) || true"

# Clean up stale lock from a previous crashed/killed run
rmdir "${AGENT_HOME}/data/heartbeat.lock" 2>/dev/null || true

# Ensure entry is in gomes's active (in-memory) crontab
if ! grep -q "$MARKER" "$ACTIVE_CRONTAB" 2>/dev/null; then
  echo "$ENTRY" >> "$ACTIVE_CRONTAB"
  /etc/init.d/crond.sh restart
  echo "Cron entry added to $ACTIVE_CRONTAB and crond restarted."
else
  echo "Cron entry already active, nothing to do."
fi

#!/bin/sh
# setup-cron.sh — add ai-server-agent heartbeat to system crontab
# Run once manually, or call from /etc/config/autorun.sh for persistence across reboots.
#
# QNAP resets /etc/config/crontab on firmware updates. To survive reboots automatically:
#   echo "/path/to/ai-server-agent/setup-cron.sh" | sudo tee -a /etc/config/autorun.sh

AGENT_HOME="$(cd "$(dirname "$0")" && pwd)"
CRONTAB=/etc/config/crontab
MARKER="ai-server-agent"
CRON_PATH=/share/CACHEDEV1_DATA/.qpkg/container-station/bin

ENTRY="*/30 * * * * mkdir ${AGENT_HOME}/data/heartbeat.lock 2>/dev/null && (export PATH=/share/CACHEDEV1_DATA/.local/bin:${CRON_PATH}:/opt/bin:\$PATH; cd ${AGENT_HOME} && ./start.sh --once >> logs/agent.log 2>&1; rmdir data/heartbeat.lock) || true"

ACTIVE_CRONTAB=/tmp/cron/crontabs/admin

# Ensure entry is in the persistent config
if ! grep -q "$MARKER" "$CRONTAB" 2>/dev/null; then
  echo "$ENTRY" >> "$CRONTAB"
  echo "Cron entry added to $CRONTAB."
fi

# Ensure entry is in the active (in-memory) crontab without replacing other entries
if ! grep -q "$MARKER" "$ACTIVE_CRONTAB" 2>/dev/null; then
  echo "$ENTRY" >> "$ACTIVE_CRONTAB"
  /etc/init.d/crond.sh restart
  echo "Cron entry added to $ACTIVE_CRONTAB and crond restarted."
else
  echo "Cron entry already active, nothing to do."
fi

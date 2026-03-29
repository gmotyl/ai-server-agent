#!/bin/bash
# install.sh — server deployment: build Docker, configure cron
set -euo pipefail

AGENT_HOME="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "=== ai-server-agent installer ==="
echo "Location: ${AGENT_HOME}"

# 1. Create runtime directories
mkdir -p "${AGENT_HOME}"/{memory/topics,data,logs,git}

# 2. Config check
if [[ ! -f "${AGENT_HOME}/config/agent.conf" ]]; then
  cp "${AGENT_HOME}/config/agent.conf.example" "${AGENT_HOME}/config/agent.conf"
  echo ""
  echo "Created config/agent.conf from template."
  echo "Edit it with your Telegram bot token and group ID, then re-run this script."
  exit 0
fi

source "${AGENT_HOME}/config/agent.conf"

# Validate required config
if [[ -z "${TELEGRAM_BOT_TOKEN:-}" ]]; then
  echo "ERROR: TELEGRAM_BOT_TOKEN is empty in config/agent.conf"
  exit 1
fi
if [[ -z "${TELEGRAM_GROUP_ID:-}" ]]; then
  echo "ERROR: TELEGRAM_GROUP_ID is empty in config/agent.conf"
  exit 1
fi

# 3. Build default provider Docker image
echo ""
echo "Building Docker image for provider: ${DEFAULT_PROVIDER}"
docker compose -f "${AGENT_HOME}/docker/docker-compose.yml" build "${DEFAULT_PROVIDER}"

# 4. Initialize state files (if not exist)
if [[ ! -f "${AGENT_HOME}/data/state.json" ]]; then
  echo '{"last_update_id":0,"topics":{},"topic_providers":{},"topic_workdirs":{},"schedule_topics":{},"schedules_last_run":{}}' \
    | jq . > "${AGENT_HOME}/data/state.json"
fi

if [[ ! -f "${AGENT_HOME}/data/schedules.json" ]]; then
  echo '[]' > "${AGENT_HOME}/data/schedules.json"
fi

touch "${AGENT_HOME}/memory/MEMORY.md"

# 5. Make scripts executable
chmod +x "${AGENT_HOME}"/bin/*.sh

# 6. Print cron instructions
INTERVAL="${HEARTBEAT_INTERVAL_MIN:-30}"
CRON_LINE="*/${INTERVAL} * * * * cd ${AGENT_HOME} && flock -n data/heartbeat.lock ./start.sh --once >> logs/agent.log 2>&1"

echo ""
echo "=== Server setup complete ==="
echo ""
echo "Add this line to your crontab (runs every ${INTERVAL}m with adaptive polling):"
echo ""
echo "  ${CRON_LINE}"
echo ""
echo "On QNAP:"
echo "  sudo vi /etc/config/crontab"
echo "  sudo crontab /etc/config/crontab"
echo "  sudo /etc/init.d/crond.sh restart"
echo ""
echo "Or run locally: ./start.sh"
echo ""

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

# 2b. Docker Compose check
if [[ ! -f "${AGENT_HOME}/docker/docker-compose.yml" ]]; then
  cp "${AGENT_HOME}/docker/docker-compose.example.yml" "${AGENT_HOME}/docker/docker-compose.yml"
  echo ""
  echo "Created docker/docker-compose.yml from template."
  echo "Edit it with your host-specific paths (GIT_DIR, CONTAINER_GIT_DIR, AGENT_HOME, SSH path), then re-run this script."
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

# 3. Build runtime Docker image
echo ""
echo "Building Docker image for service: ai-agent"
if docker compose version >/dev/null 2>&1; then
  docker compose -f "${AGENT_HOME}/docker/docker-compose.yml" build ai-agent
else
  /usr/local/lib/docker/cli-plugins/docker-compose -f "${AGENT_HOME}/docker/docker-compose.yml" build ai-agent
fi

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
chmod +x "${AGENT_HOME}"/bin/*.sh "${AGENT_HOME}/start.sh" "${AGENT_HOME}/setup-cron.sh"

# 6. Register the heartbeat cron + QNAP reboot persistence
echo ""
if [[ "$(id -u)" == "0" ]]; then
  echo "Registering heartbeat cron + reboot persistence (setup-cron.sh)..."
  bash "${AGENT_HOME}/setup-cron.sh"
else
  echo "=== Almost done — register the cron as root ==="
  echo ""
  echo "Run this once. It installs the */30 heartbeat watchdog and makes it survive"
  echo "reboots (enables QNAP autorun, wires autorun.sh via bash, clears stale locks):"
  echo ""
  echo "  sudo bash ${AGENT_HOME}/setup-cron.sh"
  echo ""
fi

echo "=== Server setup complete ==="
echo "  - Heartbeat: */30 start.sh --once  (start.sh owns its own lock — no mkdir gate)"
echo "  - News:      soft cron only — data/schedules.json (generate-news, 0 12 * * *)"
echo "  - Manual:    ./start.sh  (interactive, Ctrl+C to stop)"
echo ""

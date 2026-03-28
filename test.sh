#!/bin/bash
# test.sh — local development loop (macOS/Linux)
# Runs heartbeat in a tight loop for testing prompt tweaks and integration.
# Press Ctrl+C to stop.
set -euo pipefail

AGENT_HOME="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INTERVAL="${1:-60}"  # seconds between beats, default 60, pass as argument

echo "=== ai-server-agent local test mode ==="
echo "Location: ${AGENT_HOME}"
echo "Interval: ${INTERVAL}s (pass seconds as argument to change)"
echo "Press Ctrl+C to stop"
echo ""

# Ensure runtime dirs exist
mkdir -p "${AGENT_HOME}"/{memory/topics,data,logs,git}

# Initialize state if needed
if [[ ! -f "${AGENT_HOME}/data/state.json" ]]; then
  echo '{"last_update_id":0,"topics":{},"topic_providers":{},"topic_workdirs":{},"schedule_topics":{},"schedules_last_run":{}}' \
    | jq . > "${AGENT_HOME}/data/state.json"
fi

if [[ ! -f "${AGENT_HOME}/data/schedules.json" ]]; then
  echo '[]' > "${AGENT_HOME}/data/schedules.json"
fi

touch "${AGENT_HOME}/memory/MEMORY.md"

# Config check
if [[ ! -f "${AGENT_HOME}/config/agent.conf" ]]; then
  cp "${AGENT_HOME}/config/agent.conf.example" "${AGENT_HOME}/config/agent.conf"
  echo "Created config/agent.conf from template."
  echo "Edit it with your Telegram bot token and group ID, then re-run."
  exit 0
fi

# Validate config
source "${AGENT_HOME}/config/agent.conf"
if [[ -z "${TELEGRAM_BOT_TOKEN:-}" || -z "${TELEGRAM_GROUP_ID:-}" ]]; then
  echo "ERROR: TELEGRAM_BOT_TOKEN and TELEGRAM_GROUP_ID must be set in config/agent.conf"
  exit 1
fi

echo "Config OK. Starting heartbeat loop..."
echo ""

beat=0
while true; do
  beat=$((beat + 1))
  echo "--- Beat #${beat} @ $(date '+%H:%M:%S') ---"
  "${AGENT_HOME}/bin/heartbeat.sh" 2>&1 | tee -a "${AGENT_HOME}/logs/agent.log"
  echo "--- Sleeping ${INTERVAL}s (Ctrl+C to stop) ---"
  echo ""
  sleep "$INTERVAL"
done

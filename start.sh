#!/bin/bash
# start.sh — run the ai-server-agent with long polling
#
# Usage:
#   ./start.sh              # interactive mode, loops forever
#   ./start.sh --once       # cron mode: listen for configured interval, then exit
#   ./start.sh --once -i 900  # cron mode with custom interval (seconds)
#
# Long polling:
#   Uses Telegram's long polling (30s timeout) for near-instant message pickup.
#   In interactive mode, heartbeat runs in a tight loop — no sleep between beats.
#   In --once mode, heartbeat loops until the interval expires, then exits.

set -euo pipefail

AGENT_HOME="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODE="loop"

# --- Parse arguments ---
while [[ $# -gt 0 ]]; do
  case "$1" in
    --once) MODE="once"; shift ;;
    *)      echo "Unknown option: $1"; exit 1 ;;
  esac
done

# --- Ensure runtime dirs and state ---
mkdir -p "${AGENT_HOME}"/{memory/topics,data,logs}

if [[ ! -f "${AGENT_HOME}/data/state.json" ]]; then
  echo '{"last_update_id":0,"topics":{},"topic_providers":{},"topic_workdirs":{},"schedule_topics":{},"schedules_last_run":{}}' \
    | jq . > "${AGENT_HOME}/data/state.json"
fi

if [[ ! -f "${AGENT_HOME}/data/schedules.json" ]]; then
  echo '[]' > "${AGENT_HOME}/data/schedules.json"
fi

touch "${AGENT_HOME}/memory/MEMORY.md"

# --- Config check ---
if [[ ! -f "${AGENT_HOME}/config/agent.conf" ]]; then
  cp "${AGENT_HOME}/config/agent.conf.example" "${AGENT_HOME}/config/agent.conf"
  echo "Created config/agent.conf from template."
  echo "Edit it with your Telegram bot token and group ID, then re-run."
  exit 0
fi

source "${AGENT_HOME}/config/agent.conf"
if [[ -z "${TELEGRAM_BOT_TOKEN:-}" || -z "${TELEGRAM_GROUP_ID:-}" ]]; then
  echo "ERROR: TELEGRAM_BOT_TOKEN and TELEGRAM_GROUP_ID must be set in config/agent.conf"
  exit 1
fi

# --- Lock cleanup on exit ---
# The cron wrapper creates data/heartbeat.lock before invoking this script.
# Register a trap so the lock is always removed even if we crash or are killed.
trap "rmdir '${AGENT_HOME}/data/heartbeat.lock' 2>/dev/null || true" EXIT
trap "exit 130" INT TERM

# --- Long polling config ---
export POLL_TIMEOUT=30

# --- Banner ---
if [[ "$MODE" == "loop" ]]; then
  echo "=== ai-server-agent ==="
  echo "Location: ${AGENT_HOME}"
  echo "Mode:     interactive (Ctrl+C to stop)"
  echo "Polling:  long poll (${POLL_TIMEOUT}s timeout)"
  echo ""
elif [[ "$MODE" == "once" ]]; then
  echo "=== ai-server-agent (watchdog) ==="
  echo "Running continuously. Cron restarts if crashed."
fi

# --- Main ---
# Both modes run the same continuous loop.
# In watchdog (--once) mode the cron holds a lock file; the trap above releases
# it on exit so the next cron invocation can detect the crash and restart.
while true; do
  "${AGENT_HOME}/bin/heartbeat.sh" 2>&1 || true
done

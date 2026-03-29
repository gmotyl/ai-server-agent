#!/bin/bash
# start.sh — run the ai-server-agent with long polling
#
# Usage:
#   ./start.sh              # interactive mode, loops forever (default 10m)
#   ./start.sh --once       # single cycle, then exit (for cron)
#   ./start.sh -i 300       # custom interval in seconds
#
# Long polling:
#   Uses Telegram's long polling (30s timeout) for near-instant message pickup.
#   In interactive mode, heartbeat runs in a tight loop — no sleep between beats.
#   In --once mode, heartbeat loops until the interval expires, then exits.

set -euo pipefail

AGENT_HOME="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODE="loop"
INTERVAL=""

# --- Parse arguments ---
while [[ $# -gt 0 ]]; do
  case "$1" in
    --once) MODE="once"; shift ;;
    -i)     [[ -z "${2:-}" ]] && echo "Error: -i requires an interval in seconds" && exit 1
            INTERVAL="$2"; shift 2 ;;
    *)      echo "Unknown option: $1"; exit 1 ;;
  esac
done

# Validate -i value if provided
if [[ -n "$INTERVAL" ]] && ! [[ "$INTERVAL" =~ ^[0-9]+$ ]]; then
  echo "Error: interval must be a positive integer (seconds)"
  exit 1
fi

# --- Resolve interval ---
# Priority: -i flag > config file > mode default (600s interactive, 1800s cron)
if [[ -z "$INTERVAL" ]]; then
  if [[ -f "${AGENT_HOME}/config/agent.conf" ]]; then
    source "${AGENT_HOME}/config/agent.conf"
    if [[ -n "${HEARTBEAT_INTERVAL_MIN:-}" ]]; then
      INTERVAL=$((HEARTBEAT_INTERVAL_MIN * 60))
    fi
  fi
fi

if [[ -z "$INTERVAL" ]]; then
  if [[ "$MODE" == "once" ]]; then
    INTERVAL=1800  # 30m default for cron
  else
    INTERVAL=600   # 10m default for interactive
  fi
fi

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

# --- Long polling config ---
export POLL_TIMEOUT=30

# --- Banner ---
if [[ "$MODE" == "loop" ]]; then
  echo "=== ai-server-agent ==="
  echo "Location:  ${AGENT_HOME}"
  echo "Mode:      interactive (Ctrl+C to stop)"
  echo "Polling:   long poll (${POLL_TIMEOUT}s timeout)"
  echo ""
fi

# --- Main ---
if [[ "$MODE" == "once" ]]; then
  # Run heartbeat in a loop until interval expires
  deadline=$(( $(date +%s) + INTERVAL ))
  while [[ $(date +%s) -lt $deadline ]]; do
    "${AGENT_HOME}/bin/heartbeat.sh" 2>&1 || true
  done
else
  # Interactive: tight loop, long polling handles the wait
  while true; do
    "${AGENT_HOME}/bin/heartbeat.sh" 2>&1 || true
  done
fi

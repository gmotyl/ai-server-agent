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
mkdir -p "${AGENT_HOME}"/{memory/topics,data,logs,git}

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
  # Check if a backup exists (recover from accidental deletion)
  if [[ -f "${AGENT_HOME}/config/agent.conf.bak" ]]; then
    cp "${AGENT_HOME}/config/agent.conf.bak" "${AGENT_HOME}/config/agent.conf"
    echo "WARNING: config/agent.conf was missing — restored from agent.conf.bak"
  else
    cp "${AGENT_HOME}/config/agent.conf.example" "${AGENT_HOME}/config/agent.conf"
    echo "Created config/agent.conf from template."
    echo "Edit it with your Telegram bot token and group ID, then re-run."
    exit 0
  fi
fi

# Always keep a backup of working config
cp "${AGENT_HOME}/config/agent.conf" "${AGENT_HOME}/config/agent.conf.bak"

source "${AGENT_HOME}/config/agent.conf"
if [[ -z "${TELEGRAM_BOT_TOKEN:-}" || -z "${TELEGRAM_GROUP_ID:-}" ]]; then
  echo "ERROR: TELEGRAM_BOT_TOKEN and TELEGRAM_GROUP_ID must be set in config/agent.conf"
  exit 1
fi

# --- Singleton lock ---
# Both interactive and cron modes use the same lock directory.
# If it already exists, another instance is running — exit immediately.
LOCK_DIR="${AGENT_HOME}/data/heartbeat.lock"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  # Check if the lock holder is still alive
  LOCK_PID_FILE="${LOCK_DIR}/pid"
  if [[ -f "$LOCK_PID_FILE" ]]; then
    old_pid=$(cat "$LOCK_PID_FILE" 2>/dev/null)
    if [[ -n "$old_pid" ]] && kill -0 "$old_pid" 2>/dev/null; then
      echo "Agent already running (PID ${old_pid}). Exiting."
      exit 0
    fi
    echo "Stale lock found (PID ${old_pid} dead). Reclaiming."
    rmdir "$LOCK_DIR" 2>/dev/null || rm -rf "$LOCK_DIR"
    mkdir "$LOCK_DIR"
  else
    echo "Lock exists but no PID file. Removing stale lock."
    rmdir "$LOCK_DIR" 2>/dev/null || rm -rf "$LOCK_DIR"
    mkdir "$LOCK_DIR"
  fi
fi
echo $$ > "${LOCK_DIR}/pid"

# --- Kill stale instances ---
# Kill any leftover heartbeat/start.sh processes from previous runs
# Use ps + grep (pgrep not available on all systems e.g. QNAP)
stale_pids=$(ps aux 2>/dev/null | grep -E "${AGENT_HOME}/bin/heartbeat.sh|${AGENT_HOME}/start.sh" | grep -v grep | awk '{print $1}' | grep -v "^$$\$" || true)
if [[ -n "$stale_pids" ]]; then
  echo "Killing stale agent processes: ${stale_pids//$'\n'/ }"
  echo "$stale_pids" | xargs kill -9 2>/dev/null || true
  sleep 1
fi

# --- Lock cleanup on exit ---
cleanup() {
  [[ -n "${PANEL_PID:-}" ]] && kill "$PANEL_PID" 2>/dev/null || true
  rm -f "${LOCK_DIR}/pid"
  rmdir "${LOCK_DIR}" 2>/dev/null || true
}
trap cleanup EXIT
trap "exit 130" INT TERM

# --- Start admin panel ---
PANEL_PID=""
if [[ -n "${ADMIN_TOKEN:-}" ]]; then
  # Find node: prefer PATH, fallback to known QNAP locations
  NODE_BIN=$(command -v node 2>/dev/null \
    || echo "/share/CACHEDEV1_DATA/.qpkg/Entware/bin/node")
  if [[ -x "$NODE_BIN" ]]; then
    AGENT_HOME="${AGENT_HOME}" "$NODE_BIN" "${AGENT_HOME}/panel/server.cjs" &
    PANEL_PID=$!
    echo "Admin panel: http://0.0.0.0:${PANEL_PORT:-3000} (PID ${PANEL_PID})"
  else
    echo "WARNING: node not found — admin panel disabled"
  fi
fi

# --- Process queued Telegram updates ---
# Process service messages (topic created/closed/reopened) from the queue,
# then advance the offset. This preserves topic state even across restarts.
source "${AGENT_HOME}/lib/utils.sh"
last_offset=$(read_state '.last_update_id')
last_offset=${last_offset:-0}
queued=$(curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates" \
  -d "offset=${last_offset}" -d "timeout=0" -d "limit=100")
queued_count=$(echo "$queued" | jq '.result | length' 2>/dev/null)

if [[ -n "$queued_count" && "$queued_count" != "null" && "$queued_count" -gt 0 ]] 2>/dev/null; then
  echo "Processing ${queued_count} queued updates for service messages..."
  for ((i=0; i<queued_count; i++)); do
    update=$(echo "$queued" | jq -c ".result[$i]")
    tid=$(echo "$update" | jq -r '.message.message_thread_id // ""')
    [[ -z "$tid" ]] && continue

    # Topic created
    tname=$(echo "$update" | jq -r '.message.forum_topic_created.name // ""')
    [[ -n "$tname" ]] && write_state ".topic_names.\"${tid}\"" "$tname"

    # Topic closed
    closed=$(echo "$update" | jq -r 'if .message | has("forum_topic_closed") then "1" else "" end')
    [[ "$closed" == "1" ]] && write_state_raw ".topics.\"${tid}\".active" "false"

    # Topic reopened
    reopened=$(echo "$update" | jq -r 'if .message | has("forum_topic_reopened") then "1" else "" end')
    [[ "$reopened" == "1" ]] && write_state_raw ".topics.\"${tid}\".active" "true"
  done

  # Advance offset past all queued updates
  new_offset=$(echo "$queued" | jq '[.result[].update_id] | max + 1')
  write_state_raw '.last_update_id' "$new_offset"
  echo "Flushed ${queued_count} queued updates (offset → ${new_offset})"
fi

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
  sleep 1  # prevent tight-loop spinning between beats
done

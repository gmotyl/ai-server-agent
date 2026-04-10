#!/bin/bash
# lib/utils.sh — shared utilities

# Resolve AGENT_HOME to repo root (parent of lib/)
AGENT_HOME="${AGENT_HOME:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
export AGENT_HOME

STATE_FILE="${AGENT_HOME}/data/state.json"
STATE_LOCKDIR="${AGENT_HOME}/data/state.lock"
STATE_DEFAULT='{"last_update_id":0,"topics":{},"topic_providers":{},"topic_workdirs":{},"schedule_topics":{},"schedules_last_run":{}}'

# Ensure state.json exists and is valid JSON
_ensure_state() {
  if [[ ! -s "$STATE_FILE" ]] || ! jq empty "$STATE_FILE" 2>/dev/null; then
    echo "$STATE_DEFAULT" | jq . > "$STATE_FILE"
  fi
}

# Load config
load_config() {
  local config_file="${AGENT_HOME}/config/agent.conf"
  if [[ ! -f "$config_file" ]]; then
    log "ERROR" "Config not found: $config_file"
    exit 1
  fi
  source "$config_file"
  # Defaults
  GIT_DIR="${GIT_DIR:-${AGENT_HOME}/git}"
  CONTAINER_GIT_DIR="${CONTAINER_GIT_DIR:-${GIT_DIR}}"
  export GIT_DIR
  export CONTAINER_GIT_DIR
  MAX_MESSAGE_LENGTH="${MAX_MESSAGE_LENGTH:-4096}"
  HEARTBEAT_TIMEOUT_SEC="${HEARTBEAT_TIMEOUT_SEC:-3600}"
}

# Logging: timestamp + level + message
log() {
  local level="$1"
  shift
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] [$level] $*"
}

# Acquire exclusive lock (mkdir is atomic on all platforms)
_state_lock() {
  local attempts=0
  while ! mkdir "$STATE_LOCKDIR" 2>/dev/null; do
    attempts=$((attempts + 1))
    if (( attempts > 50 )); then
      # Stale lock — remove and retry
      rm -rf "$STATE_LOCKDIR"
      continue
    fi
    sleep 0.1
  done
}

_state_unlock() {
  rmdir "$STATE_LOCKDIR" 2>/dev/null || true
}

# Read JSON field from state.json
read_state() {
  local key="$1"
  _state_lock
  _ensure_state
  local val
  val=$(jq -r "$key" "$STATE_FILE" 2>/dev/null || echo "")
  _state_unlock
  echo "$val"
}

# Write JSON field to state.json (string value)
write_state() {
  local key="$1"
  local value="$2"
  _state_lock
  _ensure_state
  local tmp="${STATE_FILE}.tmp.$$"
  if jq --arg v "$value" "$key = \$v" "$STATE_FILE" > "$tmp" 2>/dev/null; then
    mv "$tmp" "$STATE_FILE"
  else
    rm -f "$tmp"
  fi
  _state_unlock
}

# Write JSON field to state.json (raw/numeric value)
write_state_raw() {
  local key="$1"
  local value="$2"
  _state_lock
  _ensure_state
  local tmp="${STATE_FILE}.tmp.$$"
  if jq --argjson v "$value" "$key = \$v" "$STATE_FILE" > "$tmp" 2>/dev/null; then
    mv "$tmp" "$STATE_FILE"
  else
    rm -f "$tmp"
  fi
  _state_unlock
}

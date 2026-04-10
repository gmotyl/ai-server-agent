#!/bin/bash
# lib/utils.sh — shared utilities

# Resolve AGENT_HOME to repo root (parent of lib/)
AGENT_HOME="${AGENT_HOME:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
export AGENT_HOME

STATE_LOCK="${AGENT_HOME}/data/state.lock"

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

# Read JSON field from state.json (locked to prevent reading mid-write)
read_state() {
  local key="$1"
  (
    flock -s 200
    jq -r "$key" "${AGENT_HOME}/data/state.json" 2>/dev/null || echo ""
  ) 200>"$STATE_LOCK"
}

# Write JSON field to state.json (string value, exclusive lock)
write_state() {
  local key="$1"
  local value="$2"
  (
    flock -x 200
    local tmp="${AGENT_HOME}/data/state.json.tmp.$$"
    jq --arg v "$value" "$key = \$v" "${AGENT_HOME}/data/state.json" > "$tmp" && mv "$tmp" "${AGENT_HOME}/data/state.json"
  ) 200>"$STATE_LOCK"
}

# Write JSON field to state.json (raw/numeric value, exclusive lock)
write_state_raw() {
  local key="$1"
  local value="$2"
  (
    flock -x 200
    local tmp="${AGENT_HOME}/data/state.json.tmp.$$"
    jq --argjson v "$value" "$key = \$v" "${AGENT_HOME}/data/state.json" > "$tmp" && mv "$tmp" "${AGENT_HOME}/data/state.json"
  ) 200>"$STATE_LOCK"
}

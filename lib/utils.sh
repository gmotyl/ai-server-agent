#!/bin/bash
# lib/utils.sh — shared utilities

# Resolve AGENT_HOME to repo root (parent of lib/)
AGENT_HOME="${AGENT_HOME:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
export AGENT_HOME

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
  MAX_MESSAGE_LENGTH="${MAX_MESSAGE_LENGTH:-4096}"
  HEARTBEAT_TIMEOUT_SEC="${HEARTBEAT_TIMEOUT_SEC:-3600}"
}

# Logging: timestamp + level + message
log() {
  local level="$1"
  shift
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] [$level] $*"
}

# Read JSON field from state.json
read_state() {
  local key="$1"
  jq -r "$key" "${AGENT_HOME}/data/state.json" 2>/dev/null || echo ""
}

# Write JSON field to state.json (string value)
write_state() {
  local key="$1"
  local value="$2"
  local tmp="${AGENT_HOME}/data/state.json.tmp"
  jq --arg v "$value" "$key = \$v" "${AGENT_HOME}/data/state.json" > "$tmp" && mv "$tmp" "${AGENT_HOME}/data/state.json"
}

# Write JSON field to state.json (raw/numeric value)
write_state_raw() {
  local key="$1"
  local value="$2"
  local tmp="${AGENT_HOME}/data/state.json.tmp"
  jq --argjson v "$value" "$key = \$v" "${AGENT_HOME}/data/state.json" > "$tmp" && mv "$tmp" "${AGENT_HOME}/data/state.json"
}

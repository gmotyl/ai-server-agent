#!/bin/bash
# lib/provider.sh — AI provider abstraction

# Get provider command template for a given provider name
get_provider_cmd() {
  local provider="$1"
  local var_name="PROVIDER_CMD_${provider}"
  echo "${!var_name}"
}

# Run a provider with a prompt in a workdir
# Returns: provider output on stdout, exit code
run_provider() {
  local provider="$1"
  local prompt="$2"
  local workdir="${3:-${GIT_DIR:-/git}}"

  local cmd_template
  cmd_template=$(get_provider_cmd "$provider")

  if [[ -z "$cmd_template" ]]; then
    log "ERROR" "No command configured for provider: ${provider}"
    echo "Error: provider '${provider}' not configured. Check PROVIDER_CMD_${provider} in agent.conf."
    return 1
  fi

  # Write prompt to temp file — prompt content NEVER enters command string
  local prompt_file
  prompt_file=$(mktemp)
  echo "$prompt" > "$prompt_file"
  chmod 600 "$prompt_file"

  # Replace placeholders with safe values (paths only, no user content)
  local cmd="${cmd_template}"
  cmd="${cmd//\{workdir\}/${workdir}}"
  cmd="${cmd//\{prompt_file\}/${prompt_file}}"

  log "INFO" "Running provider '${provider}' in ${workdir}" >&2

  local output
  local exit_code
  # Use gtimeout on macOS (brew install coreutils), timeout on Linux
  local timeout_cmd="timeout"
  command -v timeout &>/dev/null || timeout_cmd="gtimeout"
  if ! command -v "$timeout_cmd" &>/dev/null; then
    log "WARN" "No timeout/gtimeout found, running without timeout" >&2
    timeout_cmd=""
  fi

  if [[ -n "$timeout_cmd" ]]; then
    output=$("$timeout_cmd" "${HEARTBEAT_TIMEOUT_SEC}" bash -c "$cmd" 2>&1)
  else
    output=$(bash -c "$cmd" 2>&1)
  fi
  exit_code=$?

  rm -f "$prompt_file"

  if [[ $exit_code -eq 124 ]]; then
    log "WARN" "Provider '${provider}' timed out after ${HEARTBEAT_TIMEOUT_SEC}s" >&2
    echo "${output}"$'\n\n'"[TIMEOUT: execution exceeded ${HEARTBEAT_TIMEOUT_SEC}s limit]"
    return 124
  fi

  echo "$output"
  return $exit_code
}

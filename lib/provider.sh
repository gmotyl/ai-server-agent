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
  local workdir="${3:-/git}"

  local cmd_template
  cmd_template=$(get_provider_cmd "$provider")

  if [[ -z "$cmd_template" ]]; then
    log "ERROR" "No command configured for provider: ${provider}"
    echo "Error: provider '${provider}' not configured. Check PROVIDER_CMD_${provider} in agent.conf."
    return 1
  fi

  # Replace placeholders
  local cmd="${cmd_template}"
  cmd="${cmd//\{workdir\}/${workdir}}"

  # Write prompt to temp file to avoid shell escaping issues
  local prompt_file
  prompt_file=$(mktemp)
  echo "$prompt" > "$prompt_file"

  # Replace {prompt} with file-based input
  # Provider commands use "{prompt}" — replace with contents via cat
  cmd="${cmd//\{prompt\}/$(cat "$prompt_file")}"

  log "INFO" "Running provider '${provider}' in ${workdir}"
  log "INFO" "Command: ${cmd}"

  local output
  local exit_code
  output=$(timeout "${HEARTBEAT_TIMEOUT_SEC}" bash -c "$cmd" 2>&1)
  exit_code=$?

  rm -f "$prompt_file"

  if [[ $exit_code -eq 124 ]]; then
    log "WARN" "Provider '${provider}' timed out after ${HEARTBEAT_TIMEOUT_SEC}s"
    echo "${output}"$'\n\n'"[TIMEOUT: execution exceeded ${HEARTBEAT_TIMEOUT_SEC}s limit]"
    return 124
  fi

  echo "$output"
  return $exit_code
}

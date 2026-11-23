#!/bin/bash
# lib/provider.sh — AI provider abstraction

# Get provider command template for a given provider name
get_provider_cmd() {
  local provider="$1"
  local var_name="PROVIDER_CMD_${provider}"
  echo "${!var_name}"
}

# Tear down any agent-browser Chrome the provider left running.
# agent-browser keeps a headless Chrome alive in the background between CLI calls
# and only releases it on an explicit `agent-browser close`. A provider that
# exits — or is timeout-killed — without closing it orphans that Chrome: it is
# daemonized (reparented to init), so it lives outside the provider's process
# group and the run's `timeout` SIGTERM never reaches it. A runaway renderer then
# pegs the CPU indefinitely. Tasks run one-at-a-time under flock, so once a run is
# done no agent-browser Chrome should remain — sweeping every match is safe.
cleanup_browser_sessions() {
  local to="timeout"
  command -v timeout &>/dev/null || to="gtimeout"
  command -v "$to" &>/dev/null || to=""
  # Graceful first (lets agent-browser flush state), bounded so a wedged browser
  # can't hang the heartbeat. Best-effort; the kill below is the real backstop.
  if command -v agent-browser &>/dev/null; then
    if [[ -n "$to" ]]; then "$to" 15 agent-browser close &>/dev/null || true
    else agent-browser close &>/dev/null || true; fi
  fi
  # Hard backstop: kill anything still bound to an agent-browser profile dir, then
  # reap the leftover profile dirs so /tmp doesn't grow across runs.
  pkill -9 -f 'agent-browser-chrome-' 2>/dev/null || true
  rm -rf /tmp/agent-browser-chrome-* 2>/dev/null || true
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
    output=$("$timeout_cmd" "${HEARTBEAT_TIMEOUT_SEC}" bash -c "$cmd" < /dev/null 2>&1)
  else
    output=$(bash -c "$cmd" < /dev/null 2>&1)
  fi
  exit_code=$?

  rm -f "$prompt_file"

  # Always reap any browser the provider left behind — normal exit or timeout.
  cleanup_browser_sessions

  if [[ $exit_code -eq 124 ]]; then
    log "WARN" "Provider '${provider}' timed out after ${HEARTBEAT_TIMEOUT_SEC}s" >&2
    echo "${output}"$'\n\n'"[TIMEOUT: execution exceeded ${HEARTBEAT_TIMEOUT_SEC}s limit]"
    return 124
  fi

  echo "$output"
  return $exit_code
}

# Run a scheduled task's acceptance check in its workdir.
# Returns: combined stdout+stderr on stdout, the check's exit code (124 on timeout).
#
# The provider's own exit code proves nothing — a single-shot run that backgrounds
# its work and ends its turn still exits 0. This asserts the task's goal was reached.
#
# GIT_DIR/GIT_WORK_TREE are unset: agent.conf exports GIT_DIR as the repo *root*,
# which collides with git's own GIT_DIR and breaks every git command in a check.
run_verify() {
  local verify_cmd="$1"
  local workdir="$2"
  local timeout_sec="${VERIFY_TIMEOUT_SEC:-300}"

  local script
  script="unset GIT_DIR GIT_WORK_TREE; cd $(printf '%q' "$workdir") || exit 2
${verify_cmd}"

  local timeout_cmd="timeout"
  command -v timeout &>/dev/null || timeout_cmd="gtimeout"
  command -v "$timeout_cmd" &>/dev/null || timeout_cmd=""

  if [[ -n "$timeout_cmd" ]]; then
    "$timeout_cmd" "$timeout_sec" bash -c "$script" < /dev/null 2>&1
  else
    bash -c "$script" < /dev/null 2>&1
  fi
}

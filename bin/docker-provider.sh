#!/bin/bash
# bin/docker-provider.sh — run a provider inside the shared Docker runtime
set -euo pipefail

AGENT_HOME="${AGENT_HOME:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
provider="${1:-}"
prompt_file="${2:-}"
workdir="${3:-/git}"
extra="${4:-}"

# Hard cap on a single provider run. Without it, a hung claude/qwen holds the
# heartbeat singleton lock indefinitely and wedges the whole agent (and leaves an
# orphaned `docker-compose run` container on the host). Enforced INSIDE the
# container so timeout kills the actual process and --rm reaps the container — a
# host-side timeout would only kill the compose client and orphan the container.
# Exit code 124 propagates to lib/provider.sh, which reports it as a timeout.
PROVIDER_TIMEOUT_SEC="${PROVIDER_TIMEOUT_SEC:-${HEARTBEAT_TIMEOUT_SEC:-3600}}"

if [[ -z "$provider" || -z "$prompt_file" ]]; then
  echo "Usage: $0 <provider> <prompt-file> [workdir] [extra]" >&2
  echo "  extra: for 'opencode' provider, the model name (e.g. opencode/minimax-m2.5-free)" >&2
  exit 1
fi

if [[ ! -f "$prompt_file" ]]; then
  echo "Prompt file not found: $prompt_file" >&2
  exit 1
fi

if docker compose version >/dev/null 2>&1; then
  compose_cmd=(docker compose)
else
  compose_cmd=(/usr/local/lib/docker/cli-plugins/docker-compose)
fi

# Safety check for the "extra" arg used by claude/qwen/opencode dispatchers:
# restrict to chars that can't inject shell metachars (no $, ;, &, |, backticks…).
validate_extra() {
  if [[ -n "$extra" && ! "$extra" =~ ^[A-Za-z0-9_./:=,-]+(\ +[A-Za-z0-9_./:=,-]+)*$ ]]; then
    echo "Invalid extra arg for $provider: $extra" >&2
    exit 1
  fi
}

case "$provider" in
  claude)
    # extra (optional): flags appended after --dangerously-skip-permissions,
    # e.g. "--model claude-haiku-4-5" lets you register claude-haiku/claude-opus
    # as separate providers without touching this script.
    validate_extra
    if [[ -n "$extra" ]]; then
      base_cmd="claude --dangerously-skip-permissions ${extra} -p \"\$(cat)\""
    else
      base_cmd='claude --dangerously-skip-permissions -p "$(cat)"'
    fi
    ;;
  qwen)
    # extra (optional): additional flags (e.g. --model qwen3-coder).
    validate_extra
    if [[ -n "$extra" ]]; then
      base_cmd="qwen ${extra} -y -p \"\$(cat)\""
    else
      base_cmd='qwen -y -p "$(cat)"'
    fi
    ;;
  opencode)
    # Generic opencode dispatcher: model is REQUIRED as the 4th positional arg.
    # Adding a new opencode-backed provider is ONE line in agent.conf:
    #   PROVIDER_CMD_<name>='"${AGENT_HOME}/bin/docker-provider.sh" opencode {prompt_file} {workdir} opencode/<model>'
    if [[ -z "$extra" ]]; then
      echo "opencode provider requires a model as 4th arg (e.g. opencode/minimax-m2.5-free)" >&2
      exit 1
    fi
    validate_extra
    base_cmd="opencode run -m ${extra} \"\$(cat)\""
    ;;
  *)
    echo "Unsupported Docker provider: $provider" >&2
    exit 1
    ;;
esac

# Wrap with an in-container `timeout` when the image provides one (coreutils or
# busybox both do); otherwise run unguarded. `exec` so signals reach the provider.
guarded_cmd="if command -v timeout >/dev/null 2>&1; then exec timeout ${PROVIDER_TIMEOUT_SEC} ${base_cmd}; else exec ${base_cmd}; fi"

"${compose_cmd[@]}" \
  -f "${AGENT_HOME}/docker/docker-compose.yml" \
  run --rm -i -w "$workdir" ai-agent sh -c "$guarded_cmd" < "$prompt_file"

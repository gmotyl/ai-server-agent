#!/bin/bash
# bin/docker-provider.sh — run a provider inside the shared Docker runtime
set -euo pipefail

AGENT_HOME="${AGENT_HOME:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
provider="${1:-}"
prompt_file="${2:-}"
workdir="${3:-/git}"
extra="${4:-}"

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

case "$provider" in
  claude)
    container_cmd='claude --dangerously-skip-permissions -p "$(cat)"'
    ;;
  qwen)
    container_cmd='qwen -y -p "$(cat)"'
    ;;
  opencode)
    # Generic opencode dispatcher: model is passed as the 4th positional arg.
    # Add a new opencode-backed provider by adding ONE line to agent.conf:
    #   PROVIDER_CMD_<name>='"${AGENT_HOME}/bin/docker-provider.sh" opencode {prompt_file} {workdir} opencode/<model>'
    if [[ -z "$extra" ]]; then
      echo "opencode provider requires a model as 4th arg (e.g. opencode/minimax-m2.5-free)" >&2
      exit 1
    fi
    # Safety: model names are restricted to safe chars so they can't inject shell metachars.
    if [[ ! "$extra" =~ ^[A-Za-z0-9_./:-]+$ ]]; then
      echo "Invalid opencode model name: $extra" >&2
      exit 1
    fi
    container_cmd="opencode run -m ${extra} \"\$(cat)\""
    ;;
  *)
    echo "Unsupported Docker provider: $provider" >&2
    exit 1
    ;;
esac

"${compose_cmd[@]}" \
  -f "${AGENT_HOME}/docker/docker-compose.yml" \
  run --rm -i -w "$workdir" ai-agent sh -c "$container_cmd" < "$prompt_file"

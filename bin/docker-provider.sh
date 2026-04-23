#!/bin/bash
# bin/docker-provider.sh — run a provider inside the shared Docker runtime
set -euo pipefail

AGENT_HOME="${AGENT_HOME:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
provider="${1:-}"
prompt_file="${2:-}"
workdir="${3:-/git}"

if [[ -z "$provider" || -z "$prompt_file" ]]; then
  echo "Usage: $0 <provider> <prompt-file> [workdir]" >&2
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
  *)
    echo "Unsupported Docker provider: $provider" >&2
    exit 1
    ;;
esac

"${compose_cmd[@]}" \
  -f "${AGENT_HOME}/docker/docker-compose.yml" \
  run --rm -i -w "$workdir" ai-agent sh -c "$container_cmd" < "$prompt_file"

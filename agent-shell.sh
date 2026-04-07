#!/bin/bash
# agent-shell.sh — interactive shell inside the agent's Docker container
set -euo pipefail

AGENT_HOME="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ ! -f "${AGENT_HOME}/config/agent.conf" ]]; then
  echo "ERROR: config/agent.conf not found. Copy config/agent.conf.example and configure it first."
  exit 1
fi
source "${AGENT_HOME}/config/agent.conf"

if docker compose version >/dev/null 2>&1; then
  docker compose \
    -f "${AGENT_HOME}/docker/docker-compose.yml" \
    run --rm -it --entrypoint /bin/bash ai-agent
else
  /usr/local/lib/docker/cli-plugins/docker-compose \
    -f "${AGENT_HOME}/docker/docker-compose.yml" \
    run --rm -it --entrypoint /bin/bash ai-agent
fi

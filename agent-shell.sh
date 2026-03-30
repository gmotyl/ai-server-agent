#!/bin/bash
# agent-shell.sh — interactive shell inside the agent's Docker container
# Same image, volumes, and credentials as the agent uses
set -euo pipefail

AGENT_HOME="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ ! -f "${AGENT_HOME}/config/agent.conf" ]]; then
  echo "ERROR: config/agent.conf not found. Copy config/agent.conf.example and configure it first."
  exit 1
fi
source "${AGENT_HOME}/config/agent.conf"

/usr/local/lib/docker/cli-plugins/docker-compose \
  -f "${AGENT_HOME}/docker/docker-compose.yml" \
  run --rm -it --entrypoint /bin/bash claude

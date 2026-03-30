#!/bin/bash
# agent-shell.sh — interactive shell inside the agent's Docker container
# Same image, volumes, and credentials as the agent uses
set -euo pipefail

AGENT_HOME="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${AGENT_HOME}/config/agent.conf"

/usr/local/lib/docker/cli-plugins/docker-compose \
  -f "${AGENT_HOME}/docker/docker-compose.yml" \
  run --rm -it --entrypoint /bin/bash claude

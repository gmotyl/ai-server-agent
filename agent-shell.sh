#!/bin/bash
# agent-shell.sh — interactive shell inside the agent's Docker container
set -euo pipefail

AGENT_HOME="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ ! -f "${AGENT_HOME}/config/agent.conf" ]]; then
  echo "ERROR: config/agent.conf not found. Copy config/agent.conf.example and configure it first."
  exit 1
fi
source "${AGENT_HOME}/config/agent.conf"

# Determine docker path (QNAP NAS)
DOCKER="${DOCKER:-docker}"
command -v "$DOCKER" &>/dev/null || DOCKER="/share/CACHEDEV1_DATA/.qpkg/container-station/usr/bin/.libs/docker"

# Ensure the agent-home volume exists
VOLUME_NAME="ai-server-agent-home"
if ! "$DOCKER" volume inspect "$VOLUME_NAME" &>/dev/null; then
  echo "Creating volume: $VOLUME_NAME"
  "$DOCKER" volume create "$VOLUME_NAME"
fi

# Run interactive shell directly — no compose overhead
"$DOCKER" run --rm -it \
  -v "${GIT_DIR}:/git" \
  -v "${AGENT_HOME}:/git/ai-server-agent" \
  -v "$VOLUME_NAME:/home/agent" \
  -v ~/.ssh:/home/agent/.ssh:ro \
  -v "${AGENT_HOME}/memory:/memory" \
  --network bridge \
  --workdir /git \
  --entrypoint /bin/bash \
  ai-agent

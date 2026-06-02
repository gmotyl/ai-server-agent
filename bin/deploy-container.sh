#!/bin/bash
# Deploy the persistent agent as a Container Station service.
# Idempotent: rebuilds the image and (re)starts the long-running ai-agent container
# with its restart policy. Container Station auto-starts it on every reboot.
set -euo pipefail
AGENT_HOME="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1090
[ -f "${AGENT_HOME}/config/agent.conf" ] && . "${AGENT_HOME}/config/agent.conf" || true
COMPOSE="${AGENT_HOME}/docker/docker-compose.yml"
export PATH="/share/CACHEDEV1_DATA/.qpkg/container-station/bin:/opt/bin:$PATH"

if docker compose version >/dev/null 2>&1; then
  COMPOSE_CMD=(docker compose)
else
  COMPOSE_CMD=(/usr/local/lib/docker/cli-plugins/docker-compose)
fi

echo "[deploy] stopping any host-mode supervisor (frees the lock + port 3000)…"
pkill -f 'bash ./start.sh' 2>/dev/null || true
rm -rf "${AGENT_HOME}/data/heartbeat.lock" 2>/dev/null || true

echo "[deploy] building image…"
"${COMPOSE_CMD[@]}" -f "$COMPOSE" build ai-agent

echo "[deploy] starting persistent supervisor…"
"${COMPOSE_CMD[@]}" -f "$COMPOSE" up -d ai-agent

"${COMPOSE_CMD[@]}" -f "$COMPOSE" ps
echo "[deploy] done. Panel: http://<nas-ip>:${PANEL_PORT:-3000}"

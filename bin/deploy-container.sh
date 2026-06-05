#!/bin/bash
# Deploy the persistent agent as a Container Station service.
# Idempotent: rebuilds the image and (re)starts the long-running ai-agent container
# with its restart policy. Container Station auto-starts it on every reboot.
set -euo pipefail
AGENT_HOME="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE="${AGENT_HOME}/docker/docker-compose.yml"
# Read ONLY PANEL_PORT (for the final hint). Do NOT source agent.conf wholesale —
# it exports container-side AGENT_HOME/GIT_DIR which would clobber the host paths
# this script relies on.
PANEL_PORT="$(sed -n 's/^PANEL_PORT=//p' "${AGENT_HOME}/config/agent.conf" 2>/dev/null | tr -d '"' | tail -1)"
export PATH="/share/CACHEDEV1_DATA/.qpkg/container-station/bin:/opt/bin:$PATH"

if docker compose version >/dev/null 2>&1; then
  COMPOSE_CMD=(docker compose)
else
  COMPOSE_CMD=(/usr/local/lib/docker/cli-plugins/docker-compose)
fi

echo "[deploy] stopping any host-mode supervisor (frees the lock + port 3000)…"
# Kill host-mode start.sh/heartbeat.sh only. On QNAP the persistent container's
# own processes are visible in host `ps`, so skip anything in a docker cgroup —
# a blind `pkill -f start.sh` would kill the running container's supervisor.
for pid in $(ps -eo pid,args 2>/dev/null | grep -E '[s]tart\.sh|[h]eartbeat\.sh' | awk '{print $1}'); do
  grep -qa docker "/proc/${pid}/cgroup" 2>/dev/null && continue
  kill "$pid" 2>/dev/null || true
done
rm -rf "${AGENT_HOME}/data/heartbeat.lock" 2>/dev/null || true

echo "[deploy] building image…"
"${COMPOSE_CMD[@]}" -f "$COMPOSE" build ai-agent

echo "[deploy] starting persistent supervisor…"
"${COMPOSE_CMD[@]}" -f "$COMPOSE" up -d ai-agent

"${COMPOSE_CMD[@]}" -f "$COMPOSE" ps
echo "[deploy] done. Panel: http://<nas-ip>:${PANEL_PORT:-3000}"

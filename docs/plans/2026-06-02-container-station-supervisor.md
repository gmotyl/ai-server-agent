# Container Station Persistent Supervisor — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the FOUNDATION1 agent auto-recover after every NAS reboot by running the `start.sh` supervisor as a single long-running Container Station container with `restart: unless-stopped`, executing providers (claude/qwen/opencode) in-process — eliminating the fragile host-cron + `su gomes` + autorun-timing chain.

**Architecture:** Today `start.sh` runs on the host and spawns a fresh `ai-agent` container per task via `docker compose run --rm` (`bin/docker-provider.sh`). New model: ONE persistent `ai-agent` container runs `start.sh` itself (panel + heartbeat loop), and providers run as **local in-container commands** (the image already bakes claude/qwen/opencode/agent-browser/node). Container Station restarts `unless-stopped` containers on boot *after* the volume mounts — proven on this box by the `homeassistant` container (survived the 2026-06-01 reboot, Up 12h). No docker socket, no docker-in-docker.

**Tech Stack:** QNAP Container Station (docker + compose v2), bash, Node 22 panel, Telegram long-poll.

**Why this is low-risk:** the provider already runs inside this exact image today (past generate-news pushes prove SSH/git/claude work in-container). The only behavioral change is *who launches the loop* (persistent container vs host cron) and *how the provider is invoked* (local cmd vs nested `docker run`).

---

## Pre-flight facts (verified 2026-06-02)
- Image `ai-server-agent:latest` exists (1.76GB, built 5 weeks ago).
- `homeassistant` runs `restart=unless-stopped`, auto-started after reboot → autostart pattern proven.
- `/var/run/docker.sock` is `admin:administrators` `srw-rw----`; gomes is gid 100 `everyone` but `docker images/ps/inspect` succeed as gomes (only a harmless `~/.docker/config.json` write warning).
- NAS `docker/docker-compose.yml` `ai-agent` service: `entrypoint: []`, no `command`, no `ports`, mounts `/git`, `/git/ai-server-agent`, `agent-home`, `.ssh:ro`, `memory`; env has BRAVE/SERPER keys.
- NAS `config/agent.conf` providers are all Docker-mode (`bin/docker-provider.sh ...`). `PANEL_PORT=3000`. `AGENT_HOME=/share/CACHEDEV1_DATA/ai-server-agent`, `GIT_DIR=/share/CACHEDEV1_DATA/git`, `CONTAINER_GIT_DIR=/git`.
- `schedules.json`: `generate-news`, `0 12 * * *`, provider `claude`, workdir `/git/motyl-dev`. motyl-dev remote is SSH, `user.email=grzegorz@motyl.dev`.
- agent.conf and docker-compose.yml are **gitignored on NAS** (live edits); repo carries `.example` variants.

> Convention reminder: NEVER overwrite live NAS config in place — back up first, then edit (see [[feedback_never_overwrite_config]]).

---

### Task 1: Feature branch

**Step 1:** In `/Users/gmotyl/git/prv/ai-server-agent`, create branch.

```bash
cd /Users/gmotyl/git/prv/ai-server-agent
git checkout -b feat/container-station-supervisor
```

**Step 2: Commit nothing yet** — proceed.

---

### Task 2: Long-running service in the compose example

**Files:**
- Modify: `docker/docker-compose.example.yml`

**Step 1:** Add a persistent-supervisor service variant. The `ai-agent` base (used by `docker-provider.sh run --rm`) stays for backward-compat / local dev; add the long-running role via `command`, `restart`, `ports`, `init`. Edit the `ai-agent` service to:

```yaml
services:
  ai-agent:
    build:
      context: .
      dockerfile: docker/Dockerfile
    image: ai-server-agent
    # Persistent supervisor: run the agent loop in-container (panel + heartbeat).
    # Container Station restarts unless-stopped containers AFTER the volume mounts
    # on boot — the reboot-proof autostart mechanism (no host cron / su / autorun).
    command: ["./start.sh"]
    working_dir: /git/ai-server-agent
    restart: unless-stopped
    init: true                       # tini reaps provider grandchild processes
    stop_grace_period: 30s
    volumes:
      - ${GIT_DIR:-/your/git/dir}:/git
      - ${AGENT_HOME:-/your/agent/home}:/git/ai-server-agent
      - agent-home:/home/agent
      - /your/home/.ssh:/home/agent/.ssh:ro
      - ${AGENT_HOME:-/your/agent/home}/memory:/memory
    ports:
      - "${PANEL_PORT:-3000}:${PANEL_PORT:-3000}"   # panel now runs IN the container
    network_mode: bridge
```

> Note: `entrypoint: []` is dropped — we now run `command: ./start.sh`. `docker-provider.sh`'s `run --rm ... sh -c` overrides `command` per-invocation, so the base image still works for any remaining `run --rm` callers. With `network_mode: bridge`, `ports:` is honored.

**Step 2: Verify YAML parses**

Run: `docker compose -f docker/docker-compose.example.yml config -q && echo OK`
Expected: `OK` (no error). If `docker compose` unavailable locally, skip — validated on NAS in Task 7.

**Step 3: Commit**

```bash
git add docker/docker-compose.example.yml
git commit -m "feat(deploy): persistent Container Station supervisor service (restart:unless-stopped)"
```

---

### Task 3: In-container (local-mode) provider commands in the example config

**Files:**
- Modify: `config/agent.conf.example`

**Step 1:** Replace the Docker-mode `PROVIDER_CMD_*` lines with in-container local-mode equivalents (the supervisor is now already inside the image; nested `docker run` would fail — no docker in the container). Keep the `timeout` guard inline so a hung provider still can't wedge the loop.

```sh
# In-container local mode — supervisor runs INSIDE the ai-agent container, so
# providers execute as direct CLIs (no nested docker). timeout guards a hung run
# (exit 124 → lib/provider.sh reports a timeout). PROVIDER_TIMEOUT_SEC default 3600.
PROVIDER_CMD_claude='cd {workdir} && timeout ${PROVIDER_TIMEOUT_SEC:-3600} claude --dangerously-skip-permissions -p "$(cat {prompt_file})"'
PROVIDER_CMD_qwen='cd {workdir} && timeout ${PROVIDER_TIMEOUT_SEC:-3600} qwen -y -p "$(cat {prompt_file})"'
PROVIDER_CMD_minimax='cd {workdir} && timeout ${PROVIDER_TIMEOUT_SEC:-3600} opencode run -m opencode/minimax-m2.5-free "$(cat {prompt_file})"'
PROVIDER_CMD_pickle='cd {workdir} && timeout ${PROVIDER_TIMEOUT_SEC:-3600} opencode run -m opencode/big-pickle "$(cat {prompt_file})"'
```

**Step 2:** Confirm `lib/provider.sh` substitutes `{workdir}`/`{prompt_file}` and `eval`s the template (it does today for both modes). Read `lib/provider.sh` `run_provider` to confirm no Docker-specific assumptions remain on the happy path. No code change expected.

**Step 3: Commit**

```bash
git add config/agent.conf.example
git commit -m "feat(config): in-container local-mode provider commands for persistent supervisor"
```

---

### Task 4: Retire host-cron autostart from setup-cron.sh + install.sh

**Files:**
- Modify: `setup-cron.sh`
- Modify: `install.sh`
- Create: `bin/deploy-container.sh`

**Step 1:** Add `bin/deploy-container.sh` — the new one-command deploy (build if needed + bring up the persistent container). Idempotent.

```bash
#!/bin/bash
# Deploy the persistent agent as a Container Station service.
# Idempotent: rebuilds the image and (re)starts the long-running ai-agent container
# with its restart policy. Container Station auto-starts it on every reboot.
set -euo pipefail
AGENT_HOME="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE="${AGENT_HOME}/docker/docker-compose.yml"
export PATH="/share/CACHEDEV1_DATA/.qpkg/container-station/bin:/opt/bin:$PATH"

echo "[deploy] stopping any host-mode supervisor (frees the lock + port 3000)…"
pkill -f 'bash ./start.sh' 2>/dev/null || true
rm -rf "${AGENT_HOME}/data/heartbeat.lock" 2>/dev/null || true

echo "[deploy] building image…"
docker compose -f "$COMPOSE" build ai-agent

echo "[deploy] starting persistent supervisor…"
docker compose -f "$COMPOSE" up -d ai-agent

docker compose -f "$COMPOSE" ps
echo "[deploy] done. Panel: http://<nas-ip>:${PANEL_PORT:-3000}"
```

**Step 2:** In `setup-cron.sh`, REMOVE the hard-cron watchdog block (section c) and the autorun/`*/10`/`su gomes` machinery — the container model makes them obsolete and a host-side `start.sh` would now collide on the lock and on port 3000. Keep only the soft-cron note. Add a header line pointing to `bin/deploy-container.sh`. (Leave the file present so existing installs that call it become a no-op + print the migration hint.)

Replace the body with:

```sh
#!/bin/bash
# DEPRECATED for FOUNDATION1: the agent now runs as a persistent Container Station
# container (docker/docker-compose.yml, restart: unless-stopped) which QNAP auto-
# starts after the volume mounts on boot. Use bin/deploy-container.sh instead.
# News is still soft-cron only (data/schedules.json: generate-news 0 12 * * *).
echo "setup-cron.sh is deprecated. Deploy with: bin/deploy-container.sh"
echo "Reboot persistence is handled by Container Station (restart: unless-stopped)."
exit 0
```

**Step 3:** In `install.sh`, replace the `setup-cron.sh` invocation/instructions with a call to `bin/deploy-container.sh` (when docker/compose present) and chmod it +x.

**Step 4: chmod the new script executable in git**

```bash
chmod +x bin/deploy-container.sh
git update-index --chmod=+x bin/deploy-container.sh 2>/dev/null || true
```

**Step 5: Commit**

```bash
git add setup-cron.sh install.sh bin/deploy-container.sh
git commit -m "feat(deploy): Container Station deploy script; retire host-cron watchdog"
```

---

### Task 5: Update deployment docs

**Files:**
- Modify: `docs/qnap-deployment.md`

**Step 1:** Rewrite §8 (cron/reboot section) around the Container Station model:
- Deploy: `bin/deploy-container.sh` (build + `up -d`).
- Reboot persistence: `restart: unless-stopped` + Container Station autostart (reference home-assistant as proof).
- Provider mode: in-container local commands (no nested docker).
- Troubleshooting: `docker compose ps`, `docker logs ai-agent-<...>`, panel not up → `docker compose up -d ai-agent`.
- Note the OLD host-cron/autorun/`su gomes` mechanism is removed; if upgrading an old install, remove the `*/10` watchdog from `/etc/config/crontab` (root) — see Task 6.

**Step 2: Commit**

```bash
git add docs/qnap-deployment.md
git commit -m "docs: Container Station deployment + reboot persistence; drop host-cron"
```

---

### Task 6: Deploy to NAS + manual functional verification (CHECKPOINT — review before reboot)

> Done over SSH (`ssh foundation1`). agent.conf / docker-compose.yml are gitignored on NAS — back up before editing.

**Step 1:** Pull repo on NAS.

```bash
ssh foundation1 'cd /share/CACHEDEV1_DATA/ai-server-agent && /opt/bin/git fetch && /opt/bin/git checkout feat/container-station-supervisor && /opt/bin/git pull'
```

**Step 2:** Edit live NAS `docker/docker-compose.yml` to match the example's persistent-service shape (`command: ./start.sh`, `working_dir: /git/ai-server-agent`, `restart: unless-stopped`, `init: true`, `ports: "3000:3000"`). Back up first:
`cp docker/docker-compose.yml docker/docker-compose.yml.bak.20260602`.

**Step 3:** Edit live NAS `config/agent.conf` `PROVIDER_CMD_*` lines to the in-container local-mode form (Task 3). Back up first:
`cp config/agent.conf config/agent.conf.bak.20260602`.

**Step 4:** Deploy.

```bash
ssh foundation1 'cd /share/CACHEDEV1_DATA/ai-server-agent && bash bin/deploy-container.sh'
```

**Step 5: Verify container + panel**

```bash
ssh foundation1 'export PATH=/share/CACHEDEV1_DATA/.qpkg/container-station/bin:/opt/bin:$PATH; docker ps --format "{{.Names}} | {{.Status}} | restart={{.Labels}}" | grep ai-agent; docker inspect -f "{{.Name}} restart={{.HostConfig.RestartPolicy.Name}}" $(docker ps -q --filter name=ai-agent)'
curl -s -m 8 -o /dev/null -w "panel=%{http_code}\n" http://192.168.10.155:3000/
```
Expected: container Up, `restart=unless-stopped`, `panel=200`.

**Step 6: Verify heartbeat + Telegram poll in container logs**

```bash
ssh foundation1 'export PATH=/share/CACHEDEV1_DATA/.qpkg/container-station/bin:/opt/bin:$PATH; docker logs --tail 30 $(docker ps -q --filter name=ai-agent)'
```
Expected: panel listening banner + heartbeat/long-poll lines, no crash loop.

**Step 7: Manual provider smoke test** — trigger one generate-news run (or a trivial prompt) via the panel or by invoking the heartbeat schedule, and confirm a provider runs in-container, produces output, and (for generate-news) commits+pushes. Watch `docker logs`.
Expected: provider runs locally (NOT `docker compose run`), exit 0.

**STOP — report results to Greg before the reboot step.**

---

### Task 7: Reboot validation (Greg triggers reboot)

**Step 1:** Greg reboots the NAS (or waits for the next natural reboot).

**Step 2: After boot, verify auto-recovery (no manual action)**

```bash
ssh foundation1 'uptime'
curl -s -m 8 -o /dev/null -w "panel=%{http_code}\n" http://192.168.10.155:3000/
ssh foundation1 'export PATH=/share/CACHEDEV1_DATA/.qpkg/container-station/bin:/opt/bin:$PATH; docker ps --format "{{.Names}} {{.Status}}" | grep ai-agent'
```
Expected within a few min of boot: `panel=200`, ai-agent `Up`. No setsid, no manual start.

**Step 3:** Remove the now-dead OLD host-cron watchdog (root, Greg — sudo needs password on NAS):

```bash
sudo sed -i '/start.sh --once/d' /etc/config/crontab
sudo crontab /etc/config/crontab
```
Then confirm `grep -c 'start.sh --once' /etc/config/crontab` → `0`.

**Step 4: Update memory + progress, open PR**
- Update `project_foundation1_agent_cron.md` memory: autostart is now Container Station `restart:unless-stopped`, host-cron/autorun/su retired.
- `GH_TOKEN="" gh pr create` to gmotyl/ai-server-agent (personal account).

---

## Rollback
If the container model misbehaves: `docker compose down ai-agent`, restore `config/agent.conf.bak.20260602` + `docker-compose.yml.bak.20260602`, relaunch the host loop (`setsid bash ./start.sh …`). The OLD `/etc/config/crontab` watchdog is only removed in Task 7 Step 3 — until then it remains as a (currently-dormant) fallback.

## Open questions / risks
- **agent-home volume shadows in-image CLIs?** Dockerfile installs claude/qwen under `/home/agent/.npm-global` & `.local`, but `agent-home:/home/agent` volume could shadow them. The image has run providers fine via `run --rm` (same volume), so they resolve — confirm in Task 6 Step 7. If shadowed, providers were installed to image layers that the named volume masks; mitigation = install to `/usr/local/bin` (already done for opencode).
- **Panel auth/env in-container:** start.sh sources `config/agent.conf` (mounted) for ADMIN_TOKEN/Telegram tokens — confirm panel comes up authenticated in Task 6.
- **PID-namespace lock staleness across container restart:** `init: true` + start.sh stale-lock reclaim handles it; confirm a `docker restart` cleanly re-acquires.

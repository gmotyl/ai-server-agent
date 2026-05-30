# Deploying ai-server-agent on QNAP NAS

Step-by-step guide for deploying the agent on a QNAP NAS. Tested on QNAP with QTS 5.x (aarch64).

## Prerequisites

### 1. Enable SSH on QNAP

1. Open QTS web interface (e.g. `http://192.168.10.155:8080`)
2. Go to **Control Panel > Network & File Services > Telnet / SSH**
3. Check **Allow SSH connection**
4. Set port (default 22)
5. Apply

Connect from your machine:

```bash
ssh your_user@NAS_IP
```

### 2. Install Container Station (Docker)

1. Open **App Center** in QTS
2. Search for **Container Station**
3. Install it

This provides Docker at `/share/CACHEDEV1_DATA/.qpkg/container-station/bin/docker` and docker-compose as a CLI plugin at `/usr/local/lib/docker/cli-plugins/docker-compose`.

> **Important:** QNAP's Docker does not support `docker compose` (space) as a subcommand. Use the full path to docker-compose instead:
> ```bash
> /usr/local/lib/docker/cli-plugins/docker-compose ...
> ```

### 3. Install jq

QNAP does not ship with `jq`. Download the static binary:

```bash
# Check your architecture
uname -m   # aarch64 or x86_64

# For aarch64 (ARM):
curl -fsSL -o /tmp/jq https://github.com/jqlang/jq/releases/download/jq-1.7.1/jq-linux-arm64

# For x86_64 (Intel):
curl -fsSL -o /tmp/jq https://github.com/jqlang/jq/releases/download/jq-1.7.1/jq-linux-amd64

chmod +x /tmp/jq
mkdir -p /share/CACHEDEV1_DATA/.local/bin
cp /tmp/jq /share/CACHEDEV1_DATA/.local/bin/jq
```

### 4. Set up PATH

QNAP's default PATH is minimal. Add tools to your `.profile`:

```bash
echo 'export PATH="/share/CACHEDEV1_DATA/.local/bin:/opt/bin:/share/CACHEDEV1_DATA/.qpkg/container-station/bin:$PATH"' >> ~/.profile
source ~/.profile
```

Verify:

```bash
jq --version    # jq-1.7.1
docker --version  # Docker version 27.x
git --version     # git version 2.x (via /opt/bin)
```

> **Note on git:** QNAP's git (via Entware at `/opt/bin/git`) may not have HTTPS support (`git-remote-https` missing). If `git clone https://...` fails, transfer the repo via `scp` from your workstation instead.

## Deployment

### 1. Transfer the repo

Since git HTTPS may not work, use scp from your workstation:

```bash
scp -r /path/to/ai-server-agent user@NAS_IP:/share/CACHEDEV1_DATA/ai-server-agent
```

Optional convenience symlink:

```bash
# On the NAS:
ln -s /share/CACHEDEV1_DATA/ai-server-agent ~/ai-server-agent
```

### 2. Create a Telegram bot and group

1. Message [@BotFather](https://t.me/BotFather) on Telegram and create a new bot (`/newbot`)
2. Save the bot token
3. Create a Telegram **group** (or supergroup)
4. Enable **Topics** (group settings > Topics > toggle on)
5. Add the bot to the group and make it **admin** (needs permission to post in topics)
6. Get the group ID: send a message in the group, then check:
   ```bash
   curl -s "https://api.telegram.org/bot<TOKEN>/getUpdates" | jq '.result[-1].message.chat.id'
   ```
   The group ID is a negative number (e.g., `-1001234567890`).

### 3. Build the Docker image

The repository ships a single runtime image with Claude Code and Qwen installed for a generic non-root `agent` user. Build it with:

```bash
cd /share/CACHEDEV1_DATA/ai-server-agent
/usr/local/lib/docker/cli-plugins/docker-compose -f docker/docker-compose.yml build ai-agent
```

This builds from `docker/Dockerfile`.

> **Tip:** If you already have a working agent runtime image (e.g., from another project), you can reuse it. Update `docker/docker-compose.yml` to reference that image and set `entrypoint: []` to override any default entrypoint:
> ```yaml
> services:
>   ai-agent:
>     image: your-existing-agent-image
>     entrypoint: []
>     volumes:
>       - /share/homes/your_user/git:/git   # host ~/git → container /git
>       - agent-home:/home/agent
>       - ~/.ssh:/home/agent/.ssh:ro
>     working_dir: /git
>
> volumes:
>   agent-home:
>     name: your-existing-volume   # reuse credentials
> ```

### 4. Authenticate providers inside the runtime shell

Open the same runtime shell the agent uses:

```bash
/usr/local/lib/docker/cli-plugins/docker-compose -f docker/docker-compose.yml \
  run --rm -it --entrypoint /bin/bash ai-agent
```

Inside the shell, run `claude` and complete login. If you also want to prepare Qwen, run `qwen` there too. Credentials are persisted in the `agent-home` Docker volume.

If reusing an existing volume that's already authenticated, skip this step.

### 5. Configure the agent

```bash
cp config/agent.conf.example config/agent.conf
```

Edit `config/agent.conf`:

```bash
# System PATH for QNAP (add this at the top)
export PATH="/share/CACHEDEV1_DATA/.local/bin:/share/CACHEDEV1_DATA/.qpkg/container-station/bin:/opt/bin:$PATH"

# Telegram
TELEGRAM_BOT_TOKEN="your-token-here"
TELEGRAM_GROUP_ID="-100xxxxxxxxxx"

# Provider commands — QNAP-specific:
#   Wrapper script auto-selects `docker compose` or the QNAP plugin path
#   Prompt is passed via stdin (-i), no bind mount needed — temp file stays mode 600
PROVIDER_CMD_claude='"${AGENT_HOME}/bin/docker-provider.sh" claude {prompt_file}'
PROVIDER_CMD_qwen='"${AGENT_HOME}/bin/docker-provider.sh" qwen {prompt_file}'

# Paths (must be exported — provider runs in a bash -c subprocess)
export AGENT_HOME="/share/CACHEDEV1_DATA/ai-server-agent"
export GIT_DIR="/share/CACHEDEV1_DATA/git"
export CONTAINER_GIT_DIR="/git"
```

#### Git repos volume mapping

The agent mounts your local `~/git` directory into the container as `/git`. Any repos already there are immediately available to the agent. Files created or modified inside the container are reflected on the host.

`docker/docker-compose.yml` controls the mount and the starting directory:

```yaml
volumes:
  - /share/homes/your_user/git:/git   # host ~/git → container /git
  - ${AGENT_HOME}:/git/ai-server-agent
  - agent-home:/home/agent
  - ~/.ssh:/home/agent/.ssh:ro
  - ${AGENT_HOME}/memory:/memory
working_dir: /git   # where the agent starts; change to e.g. /git/projects if preferred
```

Set `GIT_DIR` to the host repo root and `CONTAINER_GIT_DIR="/git"` to the in-container mount path.

#### PROVIDER_CMD gotchas on QNAP

| Issue | Cause | Fix |
|-------|-------|-----|
| `cat: Permission denied` or empty prompt | Bind-mount approach: `$(cat /tmp/prompt)` runs on host before Docker starts, or Docker can't read the temp file | Use stdin approach: `-i … sh -c 'claude -p "$(cat)"' < {prompt_file}` |
| `docker compose: unknown command` | QNAP doesn't support `docker compose` (space) | Use `/usr/local/lib/docker/cli-plugins/docker-compose` |
| `claude: not found` | Claude binary not in container PATH | Ensure the image has claude in PATH, or prefix with `sh -c 'export PATH=...; claude ...'` |
| Agent starts in wrong directory | `-w {workdir}` in PROVIDER_CMD overrides docker-compose `working_dir` with a host path that doesn't exist in the container | Remove `-w` from PROVIDER_CMD; set `working_dir` in docker-compose.yml instead |
| Docker network creation errors | QNAP vswitch conflicts | Add `network_mode: bridge` to docker-compose.yml |

### 6. Set permissions and initialize

```bash
chmod +x bin/*.sh start.sh setup-cron.sh
mkdir -p memory/topics data logs
```

### 7. Test manually

```bash
# Single heartbeat — should show "No new messages"
bash bin/heartbeat.sh

# Interactive mode — Ctrl+C to stop
./start.sh
```

Send a message in a Telegram topic. The agent should respond within seconds.

### 8. Register the heartbeat cron (and make it survive reboots)

One command does everything — registers the `*/30` watchdog that (re)starts the agent, enables QNAP autorun, and wires `autorun.sh` so the cron is re-created after every reboot:

```bash
sudo bash /share/CACHEDEV1_DATA/ai-server-agent/setup-cron.sh
```

What it does (all idempotent — safe to re-run):

- Writes the heartbeat entry to `/tmp/cron/crontabs/<user>` (the user who owns the agent files) and restarts crond:
  ```
  */30 * * * * mkdir -p .../data && (export PATH=…; cd … && ./start.sh --once >> logs/agent.log 2>&1) || true
  ```
- `setcfg Misc Autorun TRUE` — enables QTS **"Run user defined processes during startup"**.
- Appends `bash .../setup-cron.sh` to `/etc/config/autorun.sh` so the cron is re-registered at boot.
- Clears any stale `data/heartbeat.lock` from a crashed/SIGKILLed/rebooted run.

> **Why `/tmp/cron/crontabs/<user>` + autorun, not `/etc/config/crontab`:** crond runs each file under `/tmp/cron/crontabs` as that named user, so the agent (and the Docker container it spawns) run as the file owner — same uid that owns `memory/`, avoiding `Permission denied`. `/tmp` is wiped on reboot, so autorun re-runs `setup-cron.sh` to recreate it.

> **The `bash` prefix in autorun.sh is mandatory.** The script may not carry the execute bit on the data share (the bit isn't reliably preserved across `git pull`/`rsync`/`scp`), so a direct `/share/.../setup-cron.sh` at boot dies with `Permission denied`. Calling it via `bash` is immune to that.

> **Never wrap the cron call in `mkdir heartbeat.lock && (...) ; rmdir heartbeat.lock`.** That pattern looks defensive but it's a trap: if the agent is SIGKILLed or the NAS reboots mid-heartbeat, the lock directory survives and the outer `mkdir` fails silently forever after. `start.sh` already owns the lock and reclaims stale ones by PID — let it do its job.

> **News generation is the soft cron, not a system crontab entry.** It lives in `data/schedules.json` (`generate-news`, `0 12 * * *`) and is evaluated by the heartbeat. Do **not** add a hardcoded news entry to the system crontab.

Verify it's wired correctly **without rebooting**:

```bash
AGENT_USER=$(stat -c %U /share/CACHEDEV1_DATA/ai-server-agent)
cat /tmp/cron/crontabs/$AGENT_USER     # heartbeat line present
getcfg Misc Autorun                    # TRUE
grep setup-cron.sh /etc/config/autorun.sh   # bash .../setup-cron.sh
sh /etc/config/autorun.sh              # "All cron entries already active, nothing to do."
```

## Troubleshooting

### Logs

```bash
# Recent agent activity
tail -50 ~/ai-server-agent/logs/agent.log

# Current state (last processed message, topics, etc.)
cat ~/ai-server-agent/data/state.json | jq .
```

### Agent processes old messages after restart

The agent tracks `last_update_id` in `data/state.json`. If you reset this to 0, it will reprocess old messages. To skip to current:

```bash
source config/agent.conf
LAST=$(curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates?timeout=1" | jq '.result[-1].update_id')
cat data/state.json | jq ".last_update_id = $LAST" > /tmp/state.json && mv /tmp/state.json data/state.json
```

### Docker permission errors

If you see `permission denied` on Docker config:

```bash
mkdir -p ~/.docker
echo '{}' > ~/.docker/config.json
```

### Agent doesn't start after a reboot

Symptoms: panel (`:3000`) unreachable, no new lines in `logs/agent.log`, and `/tmp/cron/crontabs/<user>` missing.

Root cause is almost always the reboot-persistence wiring (the cron lives in volatile `/tmp` and is only recreated by autorun → `setup-cron.sh`). Check all three:

```bash
getcfg Misc Autorun                        # must be TRUE
ls -l /etc/config/autorun.sh               # must be executable (-rwxr-xr-x) with a #!/bin/sh shebang
grep setup-cron.sh /etc/config/autorun.sh  # must be:  bash .../setup-cron.sh
```

> **`autorun.sh` must be executable AND start with a shebang** — QNAP silently skips it at boot otherwise (a non-executable `autorun.sh` is the sneakiest version of this failure: autorun is "enabled" but the script never runs). `setup-cron.sh` enforces both on every run.

If any are wrong, just re-run the setup — it fixes all of them and is idempotent:

```bash
sudo bash /share/CACHEDEV1_DATA/ai-server-agent/setup-cron.sh
```

To restore service immediately (without waiting for the next `*/30` fire), launch the agent by hand — note QNAP's BusyBox has **no `nohup`; use `setsid`**:

```bash
cd /share/CACHEDEV1_DATA/ai-server-agent
setsid bash ./start.sh < /dev/null >> logs/agent.log 2>&1 &
```

### After a reboot: SSH key rejected / home dir gone / `cd` fails

If after a reboot SSH **public-key auth is rejected**, `cd` (→ `$HOME`) fails, and `/share/homes/<user>` is missing — this is **not data loss**. The QNAP **Home Folders** feature came up disabled, so `/share/homes` isn't linked and `~/.ssh/authorized_keys` can't be read.

Confirm the data volume is actually fine first:

```bash
df -h | grep CACHEDEV1_DATA   # mounted, with your data
cat /proc/mdstat              # data array shows [UU] (healthy), not a failed/resyncing disk
```

Then re-enable it: **QTS → Control Panel → Privilege → Users → Home Folders → Enable → select CACHEDEV1_DATA → Apply.** `/share/homes/<user>` (and your `~/.ssh`) returns.

The **agent itself does not need the home dir** — it runs from `/share/CACHEDEV1_DATA/ai-server-agent` and stores provider credentials in the `agent-home` Docker volume, so you can start it (and it auto-starts via cron) even while Home Folders is off.

### Stale lock file

If the agent stops running and `data/heartbeat.lock/` exists on disk, a previous run was killed mid-heartbeat (or the NAS rebooted mid-run). `setup-cron.sh` clears it on every run; to clear it by hand:

```bash
rm -rf /share/CACHEDEV1_DATA/ai-server-agent/data/heartbeat.lock
```

With the current cron entry (no outer `mkdir .../heartbeat.lock` gate), `start.sh` detects stale locks via the PID file and reclaims them automatically — you should only need this command if the agent still won't run after the next scheduled fire.

### A provider task hangs for hours / wedges the agent

Provider runs currently execute **without a timeout** (`bin/docker-provider.sh` logs `No timeout/gtimeout found, running without timeout`). A stuck `claude`/`qwen` run holds the singleton lock, so every later heartbeat skips and the agent appears dead. Until a timeout guard is added, recover with:

```bash
docker ps                                    # find the long-running ai-agent run container
docker stop <container>                      # stop the hung provider
rm -rf /share/CACHEDEV1_DATA/ai-server-agent/data/heartbeat.lock
```

The next `*/30` heartbeat (or a manual `setsid bash ./start.sh &`) then resumes; the schedule catch-up re-runs any window that was missed while it was wedged.

## Updating

Since git HTTPS may not work, pull updates from your workstation:

```bash
# From your workstation:
cd /path/to/ai-server-agent
git pull
rsync -av --exclude='config/agent.conf' --exclude='data/' --exclude='logs/' --exclude='memory/' \
  ./ user@NAS_IP:/share/CACHEDEV1_DATA/ai-server-agent/
```

Or if git works on your NAS (with Entware git over SSH):

```bash
cd ~/ai-server-agent
git pull
```

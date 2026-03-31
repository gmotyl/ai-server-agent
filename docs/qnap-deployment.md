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

You need a Docker image with Claude Code (or your preferred AI CLI) installed. Build one:

```bash
cd /share/CACHEDEV1_DATA/ai-server-agent
/usr/local/lib/docker/cli-plugins/docker-compose -f docker/docker-compose.yml build claude
```

This builds from `docker/claude/Dockerfile` — a node:22-slim image with Claude Code installed.

> **Tip:** If you already have a working Claude Docker image (e.g., from another project), you can reuse it. Update `docker/docker-compose.yml` to reference that image and set `entrypoint: []` to override any default entrypoint:
> ```yaml
> services:
>   claude:
>     image: your-existing-claude-image
>     entrypoint: []
>     volumes:
>       - /share/homes/your_user/git:/git   # host ~/git → container /git
>       - claude-home:/home/claude
>       - ~/.ssh:/home/claude/.ssh:ro
>     working_dir: /git
>
> volumes:
>   claude-home:
>     external: true
>     name: your-existing-volume   # reuse credentials
> ```

### 4. Authenticate Claude Code

The Claude CLI needs authentication. Run it once interactively:

```bash
docker run -it -v claude-agent-home:/home/agent your-claude-image claude
```

Follow the login flow. Credentials are persisted in the Docker volume.

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

# Provider command — QNAP-specific:
#   1. Use full path to docker-compose (not 'docker compose')
#   2. Prompt is passed via stdin (-i), no bind mount needed — temp file stays mode 600
#   3. No -w flag — working_dir comes from docker-compose.yml
PROVIDER_CMD_claude='/usr/local/lib/docker/cli-plugins/docker-compose -f ${AGENT_HOME}/docker/docker-compose.yml run --rm -i claude sh -c '"'"'claude --dangerously-skip-permissions -p "$(cat)" ; chmod -R a+rw /memory/ 2>/dev/null'"'"' < {prompt_file}'

# Paths (must be exported — provider runs in a bash -c subprocess)
export AGENT_HOME="/share/CACHEDEV1_DATA/ai-server-agent"

# GIT_DIR: path to your git repos *inside the container* (not the host path).
# The host path is set in docker-compose.yml volumes (e.g. ~/git:/git).
export GIT_DIR="/git"
```

#### Git repos volume mapping

The agent mounts your local `~/git` directory into the container as `/git`. Any repos already there are immediately available to the agent. Files created or modified inside the container are reflected on the host.

`docker/docker-compose.yml` controls the mount and the starting directory:

```yaml
volumes:
  - /share/homes/your_user/git:/git   # host ~/git → container /git
  - ${AGENT_HOME}:/git/ai-server-agent
  - claude-home:/home/claude
  - ~/.ssh:/home/claude/.ssh:ro
  - ${AGENT_HOME}/memory:/memory
working_dir: /git   # where the agent starts; change to e.g. /git/projects if preferred
```

Set `GIT_DIR="/git"` in `agent.conf` — this tells Claude where to find repos inside the container, and matches the volume mount above.

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
chmod +x bin/*.sh start.sh
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

### 8. Set up cron

Add entries to `/etc/config/crontab` using `su your_user` so the agent runs as the deployment user. This survives reboots reliably without timing issues.

Replace `your_user` with the non-root user who owns the agent files (e.g. the user you SSH in as):

```bash
sudo tee -a /etc/config/crontab << 'EOF'
*/30 * * * * su your_user -c 'mkdir -p /share/CACHEDEV1_DATA/ai-server-agent/data && mkdir /share/CACHEDEV1_DATA/ai-server-agent/data/heartbeat.lock 2>/dev/null && (export PATH=/share/CACHEDEV1_DATA/.local/bin:/share/CACHEDEV1_DATA/.qpkg/container-station/bin:/opt/bin:$PATH; cd /share/CACHEDEV1_DATA/ai-server-agent && ./start.sh --once >> logs/agent.log 2>&1; rmdir data/heartbeat.lock) || true'
EOF

sudo crontab /etc/config/crontab
sudo /etc/init.d/crond.sh restart
```

> **Why `su your_user`:** Docker container runs as the same uid as the deployment user. Running the shell as that user ensures both write the same uid to memory files, avoiding `Permission denied` errors.

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

### Stale lock file

If the agent doesn't run and `data/heartbeat.lock` directory exists:

```bash
rmdir ~/ai-server-agent/data/heartbeat.lock
```

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

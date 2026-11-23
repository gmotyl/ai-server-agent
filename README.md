# ai-server-agent

A provider-agnostic AI agent that runs on any Docker host (NAS, VPS, etc.), communicates via Telegram, and executes tasks autonomously.

The bundled Docker runtime ships with Claude Code and Qwen, and runs both under a generic non-root `agent` user so interactive shell auth and Telegram execution use the same credentials.

## Admin Panel

A web UI for managing topics, schedules, and agent memory at runtime. Runs alongside the agent on port `3000`.

- Browse and manage Telegram topics (rename, archive, sync from Telegram)
- Create and trigger scheduled tasks
- Edit `MEMORY.md` directly in the browser

See **[panel/README.md](panel/README.md)** for setup, tab overview, and API reference.

## Quick Start (Local)

1. Clone this repo
2. Copy `config/agent.conf.example` to `config/agent.conf`
3. Fill in your Telegram bot token and group ID
4. Run:

```bash
./start.sh
```

The agent connects to your Telegram group and starts listening. Messages are picked up **near-instantly** via Telegram's long polling.

## Server Deployment (Cron)

For a persistent server (NAS, VPS):

1. Clone this repo on your server
2. Edit `config/agent.conf` with your values
3. Run `./install.sh` — builds Docker image, prints cron line
4. Add the cron line to your crontab

The cron job runs `./start.sh --once` which listens for the configured interval (default **30 minutes**, set `HEARTBEAT_INTERVAL_MIN` in config), then exits. The next cron invocation picks up where it left off.

### Platform-specific guides

- **[QNAP NAS](docs/qnap-deployment.md)** — full walkthrough: SSH setup, Docker (Container Station), missing tools (jq, flock), cron on QTS, and common gotchas

## How It Works

The agent uses **Telegram long polling** for near-instant message delivery:

```
./start.sh
  └─ heartbeat loop (tight, no sleep)
       ├─ check scheduled tasks
       ├─ poll Telegram (blocks up to 30s, returns instantly on message)
       ├─ process messages → dispatch to AI provider
       │    └─ "typing..." indicator shown while LLM is working
       └─ repeat
```

- **No fixed interval or polling delay** — Telegram holds the connection open and pushes updates as soon as they arrive
- **Typing indicator** — while the AI provider is generating a response, Telegram shows "typing..." in the chat (persists for the full duration, not just 5 seconds)
- **Interactive mode** (`./start.sh`) — loops forever, Ctrl+C to stop
- **Cron mode** (`./start.sh --once`) — listens for the configured interval (default 30m), then exits

## Requirements

- bash, curl, jq (on host)
- Docker + Docker Compose (for server deployment, not needed locally)
- Telegram Bot (create via @BotFather)
- Telegram Group with Topics enabled

## Configuration

Copy `config/agent.conf.example` to `config/agent.conf`:

| Variable | Description | Default |
|----------|-------------|---------|
| `TELEGRAM_BOT_TOKEN` | Bot token from @BotFather | (required) |
| `TELEGRAM_GROUP_ID` | Group ID (negative number) | (required) |
| `DEFAULT_PROVIDER` | AI provider name | `claude` |
| `HEARTBEAT_INTERVAL_MIN` | Cron mode listen duration (minutes) | `30` |
| `HEARTBEAT_TIMEOUT_SEC` | Max provider execution time | `3600` |
| `GIT_DIR` | Host path where repos live | `$AGENT_HOME/git` |
| `CONTAINER_GIT_DIR` | Repo mount path inside Docker | same as `GIT_DIR` |
| `PROVIDER_CMD_<name>` | Command template per provider | — |

### Adding Providers

Each provider needs a command template in `config/agent.conf`:

```bash
# Local (runs CLI directly):
PROVIDER_CMD_claude='cd {workdir} && claude --dangerously-skip-permissions -p "$(cat {prompt_file})"'

# Docker (for server deployment):
PROVIDER_CMD_claude='"${AGENT_HOME}/bin/docker-provider.sh" claude {prompt_file}'
```

The unified runtime image lives in `docker/Dockerfile`.

## Scheduled Tasks

Edit `data/schedules.json`:

```json
[
  {
    "name": "news-generation",
    "cron": "0 9,21 * * *",
    "provider": "claude",
    "workdir": "/git/motyl-dev",
    "prompt": "/generate-news-summary all",
    "topic_name": "Scheduled: News Generation",
    "verify": "test -z \"$(git status --porcelain)\"",
    "verify_retries": 1
  }
]
```

### Acceptance checks (`verify`)

The provider's exit code proves nothing. Providers run single-shot (`claude -p …`), so a run
that generates its output, backgrounds the slow part and ends its turn "waiting for results"
still exits 0 — with the work unfinished. That silently swallowed five days of news generation
in Aug 2026.

`verify` is an optional shell command run in the task's `workdir` after the provider, asserting
the task's actual goal was reached. Non-zero means the task did not complete:

- the provider is re-run once with a **repair prompt** carrying the check command and its
  output, told to finish the outstanding work rather than restart the task
  (`verify_retries`, default `1`);
- if it still fails, the task logs `ERROR`, posts `❌ Scheduled task <name> did not complete`
  to its Telegram topic, and exits 1;
- the outcome is recorded in `state.json` under `schedules_last_status.<name>`.

`GIT_DIR` and `GIT_WORK_TREE` are unset for the check — `agent.conf` exports `GIT_DIR` as the
repo *root*, which collides with git's own variable and breaks git commands inside it.

`schedules_last_run` is written even on failure, so a broken task does not re-fire on every
heartbeat for the rest of the day.

## Special Commands

Send these in any Telegram topic:

| Command | Description |
|---------|-------------|
| `/clone <url>` | Clone a repo into the git directory |
| `/provider <name>` | Switch AI provider for this topic |
| `/claude` | Switch this topic and new topics to Claude |
| `/qwen` | Switch this topic and new topics to Qwen |
| `/close` | Deactivate this topic |
| `/status` | List open topics and default provider |

## License

MIT

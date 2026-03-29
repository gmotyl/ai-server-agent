# ai-server-agent

A provider-agnostic AI agent that runs on any Docker host (NAS, VPS, etc.), communicates via Telegram, and executes tasks autonomously.

Supports Claude Code, Gemini CLI, Codex, or any CLI tool with auto-approve mode.

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
- **Cron mode** (`./start.sh --once -i 1800`) — listens for 30 minutes, then exits

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
| `HEARTBEAT_INTERVAL_MIN` | Heartbeat interval in minutes | `30` |
| `HEARTBEAT_TIMEOUT_SEC` | Max provider execution time | `3600` |
| `GIT_DIR` | Working directory for repos | `$AGENT_HOME/git` |
| `PROVIDER_CMD_<name>` | Command template per provider | — |

### Adding Providers

Each provider needs a command template in `config/agent.conf`:

```bash
# Local (runs CLI directly):
PROVIDER_CMD_claude='cd {workdir} && claude --dangerously-skip-permissions -p "$(cat {prompt_file})"'

# Docker (for server deployment):
PROVIDER_CMD_claude='docker compose -f ${AGENT_HOME}/docker/docker-compose.yml run --rm -v {prompt_file}:/tmp/prompt:ro -w {workdir} claude claude -p "$(cat /tmp/prompt)"'
```

Dockerfiles live in `docker/<provider>/`.

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
    "topic_name": "Scheduled: News Generation"
  }
]
```

## Special Commands

Send these in any Telegram topic:

| Command | Description |
|---------|-------------|
| `/clone <url>` | Clone a repo into the git directory |
| `/provider <name>` | Switch AI provider for this topic |
| `/close` | Deactivate this topic |
| `/status` | List open topics and current provider |

## License

MIT

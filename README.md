# ai-server-agent

A provider-agnostic AI agent that runs on any Docker host (NAS, VPS, etc.), communicates via Telegram, and executes tasks autonomously.

Supports Claude Code, Gemini CLI, Codex, or any CLI tool with a yolo/auto-approve mode.

## Quick Start

1. Clone this repo on your server
2. Run `./install.sh` — creates config template
3. Edit `config/agent.conf` with your Telegram bot token and group ID
4. Run `./install.sh` again — builds Docker image
5. Add the printed cron line to your crontab
6. Send a message in your Telegram group — the agent will pick it up on next heartbeat

## Requirements

- Docker + Docker Compose
- bash, curl, jq (on host)
- Telegram Bot (create via @BotFather)
- Telegram Group with Topics enabled

## Configuration

Copy `config/agent.conf.example` to `config/agent.conf` and fill in your values.

### Adding Providers

Each provider has its own Dockerfile in `docker/<provider>/`. To add a new one:

1. Create `docker/<provider>/Dockerfile`
2. Add a service in `docker/docker-compose.yml`
3. Add `PROVIDER_CMD_<provider>` to your `config/agent.conf`
4. Build: `docker compose -f docker/docker-compose.yml build <provider>`

### Scheduled Tasks

Edit `data/schedules.json` to add recurring tasks:

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

### Special Commands

Send these in any Telegram topic:

- `/clone <repo-url>` — clone a repo into `/git/`
- `/provider <name>` — switch AI provider for this topic
- `/close` — deactivate this topic
- `/status` — list open topics and next scheduled run

## License

MIT

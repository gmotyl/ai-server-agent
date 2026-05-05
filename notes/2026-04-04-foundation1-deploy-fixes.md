# Foundation1 NAS Deploy Fixes — 2026-04-04

## Issues Found & Fixed

### 1. Telegram Markdown parse failure (silent message loss)
- **Symptom:** Agent shows "typing" but response never arrives
- **Cause:** Provider output has unmatched Markdown (`*`, `_`), Telegram rejects with `can't parse entities`, response silently dropped
- **Fix:** `lib/telegram.sh` — `telegram_send` retries as plain text when Markdown fails
- **Commit:** `00822f7` on main

### 2. Missing docker-compose.yml
- **Symptom:** `stat docker-compose.yml: no such file or directory`
- **Cause:** Original `docker-compose.yml` was renamed to `.example.yml` and gitignored during NAS deploy PR (`7e05f15`). Never committed the actual file.
- **Fix:** Added `agent` service to shared compose at `/share/CACHEDEV1_DATA/claude-news/docker-compose.yml`. Both `claude-news` (newsletter) and `agent` (server agent) services share the same image and `claude-home` volume.

### 3. PROVIDER_CMD pointing to wrong compose/service
- **Fix:** `config/agent.conf` updated:
  ```
  PROVIDER_CMD_claude='... -f /share/CACHEDEV1_DATA/claude-news/docker-compose.yml run --rm -i agent ...'
  ```

### 4. agent-shell.sh broken
- **Fix:** Updated to use shared compose + `agent` service

### 5. Agent hallucinating about permission blocks
- **Symptom:** Agent says "harness blocks access", "requires approval", refuses to use git/gh
- **Cause:** Multiple layers:
  - System prompt didn't mention `--dangerously-skip-permissions` or unrestricted access
  - Stale `settings.local.json` files in `/git/projects/` and `/git/motyl-dev/` with narrow allow-lists from previous sessions
  - Sonnet model requires explicit allow-list to confidently use tools
- **Fixes:**
  - `lib/memory.sh` prompt: added "non-interactive mode", "all tools pre-approved", "no directory restrictions" — commits `af71eff`, `4908faf`
  - Removed stale `settings.local.json` from `/git/projects/.claude/` and `/git/motyl-dev/.claude/`
  - Set `/home/claude/.claude/settings.json` in container (persisted in `claude-home` volume):
    ```json
    {
      "permissions": {
        "allow": ["Bash(*)", "Read(*)", "Write(*)", "Edit(*)", "Glob(*)", "Grep(*)"]
      }
    }
    ```
  - Created `/git/.claude/settings.local.json` with same allow-all permissions

## Current Setup (working)

- **Shared compose:** `/share/CACHEDEV1_DATA/claude-news/docker-compose.yml`
  - `claude-news` service — newsletter generation
  - `agent` service — ai-server-agent, `working_dir: /git`, full repo access
- **PROVIDER_CMD** → shared compose, `agent` service
- **agent-shell.sh** → shared compose, `agent` service
- **Claude home volume** (`claude-home`) — shared between both services, has permissive `settings.json`
- **Deploy:** just `git pull` on foundation1, config/compose are gitignored

## Key Learnings

- `--dangerously-skip-permissions` bypasses interactive prompts but **sonnet still self-restricts** if it doesn't see an explicit allow-list in `settings.json`
- `settings.local.json` files from previous Claude Code sessions persist on disk and affect future runs — clean them up
- QNAP has no `python3`, `timeout`, or `pgrep` — only `sed`, `bash`, `curl`, `jq` available natively
- Docker path on QNAP: `/usr/local/lib/docker/cli-plugins/docker-compose` (not in default PATH)

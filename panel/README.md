# Admin Panel

A lightweight web UI for managing the ai-server-agent at runtime. Built with React + Vite on the frontend and a zero-dependency Node.js HTTP server on the backend.

## Accessing the Panel

The panel runs on port `3000` by default (configurable via `PANEL_PORT` in `agent.conf`).

```
http://<your-host>:3000
```

On first load you'll be prompted for an `ADMIN_TOKEN` (set in `agent.conf`). The token is stored in `localStorage` — no session management needed.

## Tabs

### Topics

Manage Telegram thread topics the agent is tracking.

- **Active / Archive tabs** — topics are split into active and archived; each tab shows the count
- **Inline rename** — hover a topic title, click the pencil icon, type, press Enter to save
- **Archive** — click the box icon to move a topic to Archive (stays in state, no longer receives messages)
- **Unarchive** — restore an archived topic back to Active
- **Delete** — remove a topic from state entirely
- **Sync from Telegram** — fetches pending Telegram updates to discover new topic names and closed threads

Clicking a topic opens its **message history** (right panel) and the full **context file** used as agent memory for that thread.

### Schedules

Create and manage scheduled tasks that run automatically.

- **List** — shows all schedules from `data/schedules.json` with name, cron expression, provider, workdir
- **Create / Edit** — form with fields: name, cron, provider, workdir, prompt, topic name
- **Delete** — removes the schedule
- **Run now** — triggers the schedule immediately regardless of cron timing

Cron expressions follow standard 5-field format (`minute hour dom month dow`).

### Memory

Edit the agent's persistent memory file (`memory/MEMORY.md`) directly in the browser.

- Full-height textarea editor
- **Unsaved changes** indicator when content differs from saved version
- **Save** — writes back to `MEMORY.md` on disk
- **Reload** — discards unsaved edits and fetches current file content

### Settings

View and update runtime configuration.

- Lists active providers and current default provider
- Allows updating `DEFAULT_PROVIDER` and other writable settings via `PUT /api/settings`

## API Reference

All endpoints require `Authorization: Bearer <ADMIN_TOKEN>` header.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/topics` | List all topics (active + archived) |
| GET | `/api/topics/:id/messages` | Message history for a topic |
| GET | `/api/topics/:id/context` | Context file content for a topic |
| DELETE | `/api/topics/:id` | Delete topic from state |
| POST | `/api/topics/:id/close` | Mark topic as inactive |
| POST | `/api/topics/:id/archive` | Archive a topic |
| POST | `/api/topics/:id/unarchive` | Restore archived topic |
| PUT | `/api/topics/:id/rename` | Rename topic (`{"name": "..."}`) |
| POST | `/api/topics/sync` | Sync topic names/status from Telegram |
| GET | `/api/schedules` | List all schedules |
| POST | `/api/schedules` | Create schedule |
| PUT | `/api/schedules/:name` | Update schedule |
| DELETE | `/api/schedules/:name` | Delete schedule |
| POST | `/api/schedules/:name/run` | Run schedule immediately |
| GET | `/api/memory` | Get `MEMORY.md` content |
| PUT | `/api/memory` | Save `MEMORY.md` content (`{"content": "..."}`) |
| GET | `/api/providers` | List configured providers |
| GET | `/api/status` | Agent status summary |
| PUT | `/api/settings` | Update agent settings |

## Development

```bash
cd panel
npm install
npm run dev        # Vite dev server on :5173, proxies /api to :3000
node server.cjs    # Start backend on :3000
```

Build for production:

```bash
npm run build      # Outputs to panel/dist/
```

The backend serves `panel/dist/` as static files in production. No separate web server needed.

## Path Resolution

`server.cjs` resolves `AGENT_HOME` in two passes:

1. Reads `config/agent.conf` relative to `__dirname` to find the configured `AGENT_HOME`
2. Verifies the path exists (handles container mounts where host path ≠ container path)
3. Falls back to `__dirname/..` (repo root) if configured path is unavailable

All data files (`data/state.json`, `data/schedules.json`, `memory/MEMORY.md`) are derived from the resolved `AGENT_HOME`.

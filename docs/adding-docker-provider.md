# Adding a new provider to the Docker image

The panel's **Settings → Providers** UI only edits `config/agent.conf` lines —
it never touches the Docker image. That means when you register a provider
whose dispatcher isn't baked into the shared image, the agent will invoke a CLI
that doesn't exist in the container and the run will fail.

Dispatchers that *are* preconfigured (checked against `PRECONFIGURED_DISPATCHERS`
in `panel/server.cjs`):

- `claude` — Anthropic Claude Code
- `qwen` — Alibaba Qwen Code
- `opencode` — SST OpenCode (generic; model is passed as the "extra" arg)

The UI flags any other dispatcher with a warning and links here.

## Adding a new dispatcher (e.g. `kilo`, `gemini`, `aider`)

### 1. Install the CLI in `docker/Dockerfile`

Add the install step in the same block as the other CLIs (as the `agent` user
if the tool supports user-level install, or before `USER agent` into
`/usr/local/bin` if it needs root — see how `opencode` does the latter).

```dockerfile
# Example: install kilo-code as the agent user (npm global bin already on PATH)
RUN npm install -g kilo-code@latest
```

### 2. Add a case branch in `bin/docker-provider.sh`

```bash
kilo)
  validate_extra
  if [[ -n "$extra" ]]; then
    container_cmd="kilo ${extra} --prompt \"\$(cat)\""
  else
    container_cmd='kilo --prompt "$(cat)"'
  fi
  ;;
```

Pick an in-container command pattern that reads the prompt from stdin via
`"$(cat)"` — the heartbeat pipes the temp prompt file in that way.

### 3. Register the dispatcher in the panel

Open `panel/server.cjs` and append your dispatcher name to
`PRECONFIGURED_DISPATCHERS`:

```js
const PRECONFIGURED_DISPATCHERS = ['claude', 'qwen', 'opencode', 'kilo'];
```

(That's the list the UI checks to decide whether to show the "not in Docker
image" warning.)

### 4. Rebuild the image

```bash
/usr/local/lib/docker/cli-plugins/docker-compose \
  -f docker/docker-compose.yml build ai-agent
```

### 5. Extract fresh `panel/dist` (only if the panel source changed)

```bash
cid=$(docker create ai-server-agent)
docker cp "$cid:/home/agent/panel/dist/." panel/dist/
docker rm "$cid"
```

### 6. Restart the panel

```bash
pid=$(netstat -tlnp 2>/dev/null | awk '/:3000/ {split($7,a,"/"); print a[1]}')
kill "$pid"
setsid env AGENT_HOME="$PWD" node panel/server.cjs \
  >> logs/agent.log 2>&1 < /dev/null &
```

## Adding a new *model* for an existing dispatcher

No code changes required. Just add a provider from the panel UI using the
existing dispatcher and set the model / flags in the "extra" field.

Examples:

| Provider name | Dispatcher | Extra |
|---------------|------------|-------|
| `claude-haiku` | `claude` | `--model claude-haiku-4-5` |
| `claude-opus`  | `claude` | `--model claude-opus-4-7` |
| `minimax`      | `opencode` | `opencode/minimax-m2.5-free` |
| `pickle`       | `opencode` | `opencode/big-pickle` |

The panel writes the corresponding `PROVIDER_CMD_<name>` line into
`agent.conf` and reloads its in-memory config.

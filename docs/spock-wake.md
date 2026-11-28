# Wake SPOCK

The panel's **Wake SPOCK** tab asks an ESP32 BLE keyboard to wake the Windows PC SPOCK and,
optionally, type the Windows PIN. It works only over HTTPS (the NAS's `tailscale serve`
URL) or localhost; see *HTTPS only*. Flow:

1. `POST /api/spock/wake` (Bearer `SPOCK_WAKE_TOKEN`, JSON body `{}`, `{"pin":"…"}`, optionally
   with `"force": true`).
2. Probe `${SPOCK_URL}/api/health`; if it already answers, stop (`already_awake`). The UI then
   warns that the screen may still be off or locked (WSL can answer from Modern Standby) and
   offers **Send anyway**, which repeats the request with `force: true`.
3. Seal the step list into an AES-256-GCM frame (nonce = 4 zero bytes ‖ 8-byte BE counter)
   and send it by UDP to `ESP_IP:ESP_PORT`.
4. Probe every 3 s until `SPOCK_WAKE_TIMEOUT_MS` elapses.

With `force: true` step 2 is skipped; after sending, the panel waits for the steps to play
(sum of pauses + 80 ms per key/character + 2 s) and probes once: `awake` or `not_responding`.

Code: `panel/spock-wake.cjs` (waker + HTTP handler), wired in `panel/server.cjs`; UI in
`panel/src/components/WakeSpock.tsx`.

## Configuration

Set in `config/agent.conf` (or the environment; the config file wins). In
`config/agent.conf.example` these lines are commented out so that `start.sh` sourcing a copied
example never overrides values set only in the environment: uncomment and fill the ones you
keep in the config file.

| Variable | Required | Default | Meaning |
|---|---|---|---|
| `SPOCK_WAKE_TOKEN` | yes | — | Bearer token for the route. Empty: route answers 503. |
| `SPOCK_ALLOWED_HOSTS` | yes | — | Comma-separated `Host` values allowed to call the route. Empty: every call is **403** (fail-closed). |
| `FRAME_KEY` | yes | — | 64 hex chars, AES-256 key shared with the ESP32 firmware. |
| `ESP_IP` | yes | — | ESP32 waker IP. |
| `ESP_PORT` | no | `9` | ESP32 UDP port. |

Non-numeric or ≤ 0 values for `ESP_PORT` and `SPOCK_WAKE_TIMEOUT_MS` fall back to the defaults;
for `SPOCK_PIN_COOLDOWN_MS`, 0 means off and non-numeric or negative values fall back to 0.
| `SPOCK_URL` | yes | — | SPOCK panel base URL, probed at `/api/health`. |
| `SPOCK_STEPS_JSON` | no | built-in | JSON step list for PIN wakes (see below). Invalid JSON/steps: wake reports `not_configured`. |
| `SPOCK_WAKE_TIMEOUT_MS` | no | `120000` | Probe window, starting after the frame is sent. |
| `SPOCK_PIN_COOLDOWN_MS` | no | `0` (off) | When > 0: after a PIN wake times out, further PIN wakes are refused this long (PIN-less wakes still allowed). Off by default: a timeout does not mean a wrong PIN, and Windows locks out wrong PINs itself. |
| `SPOCK_COUNTER_FILE` | no | `$AGENT_HOME/data/spock-wake-counter` | Last frame counter used (see *Counter*). Must be readable and writable; if not, nothing is sent. |

If any required wake variable (`FRAME_KEY`, `ESP_IP`, `SPOCK_URL`) is missing the route answers 503.

### `SPOCK_ALLOWED_HOSTS`

The `Host` header must match an entry exactly, or match it after dropping the port. List every
address the panel is opened from, e.g.:

```
SPOCK_ALLOWED_HOSTS="foundation1.tailXXXX.ts.net"
```

- the tailnet name served by `tailscale serve` (HTTPS, port 443 implied);
- the LAN address `192.168.10.155:3000` only if you reach the panel there through an HTTPS proxy
  (plain HTTP is refused, see below);
- `localhost:5173` when testing through the Vite dev server.

A missing entry gives **403 Forbidden**. Requests with an `Origin` header must also be same-origin.

### Steps

Each step is an object with **exactly one** of:

| Step | Wire op | Meaning |
|---|---|---|
| `{"key": n}` | `0x01 n` | tap HID usage `n` (0–255) |
| `{"gui": n}` | `0x04 n` | Win + HID usage `n` |
| `{"pause": ms}` | `0x02 hi lo` | wait 0–65535 ms |
| `{"text": "…"}` | `0x03 len …` | type ASCII (≤ 255 bytes); `"$PIN"` is replaced by the PIN |

A PIN-less wake always sends just Space. The default PIN flow is Space, pause 8000, Escape,
pause 300, Escape, pause 300, Escape, pause 700, `$PIN`, Enter. Escape does not cancel the
Windows Hello face scan; the PIN prompt shows ~8 s after wake, and the Escapes leave a
"Sign-in options" view when one is shown instead. Custom steps without a `{"text":"$PIN"}` step refuse PIN wakes.

## HTTPS only

The wake token (and PIN) must never cross the LAN in cleartext, so **every** wake request, with
or without a PIN, needs an `Origin` of `https://…` or a localhost origin (`http://localhost`,
`127.0.0.1`, `[::1]`); otherwise the route answers **403 `{"error":"https_required"}`**.
A missing `Origin` is refused too (scripts must send one). The UI disables the whole wake form
when the page is not a secure context ("Wake SPOCK needs the HTTPS (tailnet) URL").

Serve the panel over HTTPS on the tailnet from the NAS:

```
tailscale serve --bg 3000
```

Then open `https://<nas>.<tailnet>.ts.net/` and add that hostname to `SPOCK_ALLOWED_HOSTS`.

## Rate limits

- 5 bad tokens from one IP (a streak resets after 60 s without failures) lock that IP out for 60 s (429, all wakes).
- Only when `SPOCK_PIN_COOLDOWN_MS` > 0: a PIN wake that times out starts the PIN cooldown
  (429 `cooldown` for PIN wakes only).
- Both 429 responses, and a PIN timeout with a cooldown set, carry `retryAfterMs`; the UI counts down from it.
  The lockout response has `status: "locked_out"`, the PIN cooldown `status: "cooldown"`.
- One wake at a time (409 `busy`).

## Counter

The frame counter is the GCM nonce, so it must never repeat for a given `FRAME_KEY`. The
panel uses `max(Date.now(), last persisted + 1)` and writes it to `SPOCK_COUNTER_FILE`
before sending (temp file, fsync, rename, directory fsync), so restarts, crashes and clock steps
backwards do not reuse a nonce. A missing file is a fresh start; an unreadable file or one that
is not a plain non-negative integer blocks sending (`not_sent`, logged) until fixed.

**`FRAME_KEY` must have exactly one sender.** Two panels (or tools) sharing a key can produce
the same counter, which breaks AES-GCM. Give each sender its own key.

## Known limitation: panel liveness is not Windows sign-in

"Awake" means SPOCK's panel answered `/api/health` with 200 or 401 (it returns 401 to
non-localhost callers; anything else, such as a proxy 5xx, is not the panel). That proves the machine and WSL are up, not that the Windows PIN was
accepted or that a user is signed in: WSL and the panel can run before sign-in, and a wrong
PIN still leaves the panel reachable. Conversely, a correct PIN can end in `timeout` if WSL or
Windows Tailscale (not in unattended mode) only starts after sign-in. After a PIN wake, check
the screen. This is by design: no sign-in signal is available to the NAS.

## Saved token and PIN

The Wake SPOCK tab saves the wake token and the PIN in the browser's `localStorage` for the HTTPS origin, so the installed phone app wakes with one tap. "Forget token & PIN" clears both. Anyone who can open the panel in that browser can wake and unlock SPOCK, so rely on the phone's own lock screen.

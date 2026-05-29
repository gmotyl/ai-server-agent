#!/bin/sh
# setup-cron.sh — register the agent heartbeat cron AND wire QNAP reboot persistence.
#
# News generation is handled by the soft cron (data/schedules.json: generate-news,
# 0 12 * * *), evaluated by the heartbeat — NOT by a hardcoded system crontab entry.
#
# Run as root for the FULL setup (enables QNAP autorun + wires autorun.sh so the
# cron is re-registered after every reboot):
#   sudo bash /share/CACHEDEV1_DATA/ai-server-agent/setup-cron.sh
# Run as the agent user to only (re)register the cron for the current boot.
#
# Idempotent — safe to run repeatedly.

AGENT_HOME="$(cd "$(dirname "$0")" && pwd)"
CRON_PATH=/share/CACHEDEV1_DATA/.qpkg/container-station/bin
# QNAP crond runs each file in /tmp/cron/crontabs as the matching user.
AGENT_USER="$(stat -c %U "$AGENT_HOME" 2>/dev/null || echo gomes)"
ACTIVE_CRONTAB="/tmp/cron/crontabs/${AGENT_USER}"
AUTORUN=/etc/config/autorun.sh

IS_ROOT=0
[ "$(id -u)" = "0" ] && IS_ROOT=1

# --- QNAP reboot persistence (root only) -----------------------------------
# /tmp/cron/crontabs is wiped on every reboot, so the agent cron survives only if
# QNAP autorun re-runs this script at boot. That requires BOTH:
#   (a) the "Autorun" flag enabled, and
#   (b) autorun.sh to invoke this script via `bash` — the file may not carry the
#       execute bit on the data share, and a direct call dies "Permission denied".
if [ "$IS_ROOT" = "1" ] && [ -d /etc/config ]; then
  # (a) enable autorun
  if command -v setcfg >/dev/null 2>&1; then
    if [ "$(getcfg Misc Autorun -d FALSE 2>/dev/null)" != "TRUE" ]; then
      setcfg Misc Autorun TRUE && echo "Enabled QNAP autorun (Misc/Autorun=TRUE)."
    fi
  fi
  # (b) wire autorun.sh to call this script via bash (idempotent)
  [ -f "$AUTORUN" ] || { printf '#!/bin/sh\n' > "$AUTORUN"; chmod +x "$AUTORUN"; }
  AUTORUN_LINE="bash ${AGENT_HOME}/setup-cron.sh"
  if ! grep -qF "$AUTORUN_LINE" "$AUTORUN" 2>/dev/null; then
    # drop any older (possibly non-bash, exec-bit-dependent) reference first
    sed -i "\#${AGENT_HOME}/setup-cron.sh#d" "$AUTORUN" 2>/dev/null || true
    echo "$AUTORUN_LINE" >> "$AUTORUN"
    echo "Wired autorun.sh to run setup-cron.sh via bash at boot."
  fi
  # create the per-user crontab file if missing (crond reads it as $AGENT_USER)
  if [ ! -f "$ACTIVE_CRONTAB" ]; then
    mkdir -p /tmp/cron/crontabs
    touch "$ACTIVE_CRONTAB"
    chown "$AGENT_USER" "$ACTIVE_CRONTAB"
    chmod 600 "$ACTIVE_CRONTAB"
  fi
fi

# Keep this script executable so a direct ./setup-cron.sh also works.
chmod +x "${AGENT_HOME}/setup-cron.sh" 2>/dev/null || true

# Clean up a stale agent lock left behind by a crashed/killed/rebooted run.
# start.sh's own stale-pid reclaim only fires once it starts — clear orphans here.
rm -rf "${AGENT_HOME}/data/heartbeat.lock" 2>/dev/null || true

# Cron entry: delegate lock handling entirely to start.sh.
# Do NOT wrap in `mkdir .../heartbeat.lock && (... ; rmdir ...)` — a leftover lock
# (reboot, SIGKILL) short-circuits the && chain forever and start.sh's stale-pid
# reclaim never runs.
AGENT_ENTRY="*/30 * * * * mkdir -p ${AGENT_HOME}/data && (export PATH=/share/CACHEDEV1_DATA/.local/bin:${CRON_PATH}:/opt/bin:\$PATH; cd ${AGENT_HOME} && ./start.sh --once >> logs/agent.log 2>&1) || true"

changed=0

add_if_missing() {
  marker="$1"
  entry="$2"
  if ! grep -qF "$marker" "$ACTIVE_CRONTAB" 2>/dev/null; then
    echo "$entry" >> "$ACTIVE_CRONTAB"
    echo "Added: $marker"
    changed=1
  fi
}

add_if_missing "ai-server-agent" "$AGENT_ENTRY"

if [ "$changed" = "1" ]; then
  /etc/init.d/crond.sh restart 2>/dev/null || true
  echo "crond restarted."
else
  echo "All cron entries already active, nothing to do."
fi

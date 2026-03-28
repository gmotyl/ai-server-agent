#!/bin/bash
# bin/schedule-check.sh — evaluate which scheduled tasks are due
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/../lib/utils.sh"
load_config

SCHEDULES_FILE="${AGENT_HOME}/data/schedules.json"

if [[ ! -f "$SCHEDULES_FILE" ]] || [[ "$(cat "$SCHEDULES_FILE")" == "[]" ]]; then
  echo "[]"
  exit 0
fi

# Current time components
NOW_MIN=$(date '+%-M')
NOW_HOUR=$(date '+%-H')
NOW_DOM=$(date '+%-d')
NOW_MON=$(date '+%-m')
NOW_DOW=$(date '+%-u')  # 1=Mon, 7=Sun

# Check if a cron field matches current value
# Supports: *, specific number, comma-separated, */step
cron_field_matches() {
  local field="$1"
  local current="$2"

  [[ "$field" == "*" ]] && return 0

  # Handle */step
  if [[ "$field" == *"/"* ]]; then
    local step="${field#*/}"
    (( current % step == 0 )) && return 0
    return 1
  fi

  # Handle comma-separated values
  IFS=',' read -ra values <<< "$field"
  for v in "${values[@]}"; do
    [[ "$v" -eq "$current" ]] && return 0
  done
  return 1
}

# Check if a cron expression matches now
cron_matches_now() {
  local cron_expr="$1"
  read -r c_min c_hour c_dom c_mon c_dow <<< "$cron_expr"

  cron_field_matches "$c_min" "$NOW_MIN" || return 1
  cron_field_matches "$c_hour" "$NOW_HOUR" || return 1
  cron_field_matches "$c_dom" "$NOW_DOM" || return 1
  cron_field_matches "$c_mon" "$NOW_MON" || return 1
  cron_field_matches "$c_dow" "$NOW_DOW" || return 1
  return 0
}

# Check each schedule, output due ones
due_tasks="[]"
count=$(jq 'length' "$SCHEDULES_FILE")
for ((i=0; i<count; i++)); do
  cron_expr=$(jq -r ".[$i].cron" "$SCHEDULES_FILE")
  name=$(jq -r ".[$i].name" "$SCHEDULES_FILE")

  if cron_matches_now "$cron_expr"; then
    # Check if already run in this time window
    last_run=$(read_state ".schedules_last_run.\"${name}\"")
    current_window=$(date '+%Y-%m-%d-%H-%M')

    if [[ "$last_run" != "$current_window" ]]; then
      due_tasks=$(echo "$due_tasks" | jq ". + [$(jq ".[$i]" "$SCHEDULES_FILE")]")
      log "INFO" "Schedule '${name}' is due"
    else
      log "INFO" "Schedule '${name}' already ran this window, skipping"
    fi
  fi
done

echo "$due_tasks"

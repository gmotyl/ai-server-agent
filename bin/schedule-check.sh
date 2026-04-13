#!/bin/bash
# bin/schedule-check.sh — evaluate which scheduled tasks are due
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/../lib/utils.sh"
load_config

SCHEDULES_FILE="${AGENT_HOME}/data/schedules.json"

if [[ ! -f "$SCHEDULES_FILE" ]] || [[ $(jq 'length' "$SCHEDULES_FILE") -eq 0 ]]; then
  echo "[]"
  exit 0
fi

# Current time components (strip leading zeros for arithmetic — works on both GNU and BSD date)
NOW_MIN=$((10#$(date '+%M')))
NOW_HOUR=$((10#$(date '+%H')))
NOW_DOM=$((10#$(date '+%d')))
NOW_MON=$((10#$(date '+%m')))
# Day of week: GNU date %u = 1-7 (Mon-Sun), macOS date %u also works on modern macOS
NOW_DOW=$(date '+%u')

# Previous minute — catch tasks due during Telegram poll gap (up to 55s)
if (( NOW_MIN > 0 )); then
  PREV_MIN=$((NOW_MIN - 1))
  PREV_HOUR=$NOW_HOUR
else
  PREV_MIN=59
  PREV_HOUR=$(( (NOW_HOUR + 23) % 24 ))
fi

# Check if a cron field matches current value
# Supports: *, specific number, comma-separated, */step
cron_field_matches() {
  local field="$1"
  local current="$2"

  [[ "$field" == "*" ]] && return 0

  # Handle */step
  if [[ "$field" == *"/"* ]]; then
    local step="${field#*/}"
    (( step != 0 && current % step == 0 )) && return 0
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

# Portable date helpers (GNU/Linux, BusyBox/QNAP, macOS)
_date_to_epoch() {
  # Input: "YYYY-MM-DD HH:MM:SS"
  date -d "$1" +%s 2>/dev/null \
    || date -j -f "%Y-%m-%d %H:%M:%S" "$1" +%s 2>/dev/null \
    || return 1
}

_epoch_to_parts() {
  # Input: epoch seconds → Output: "H D M DOW" (no leading zeros)
  date -d "@$1" '+%-H %-d %-m %u' 2>/dev/null \
    || date -j -f "%s" "$1" '+%-H %-d %-m %u' 2>/dev/null \
    || return 1
}

# Catch-up check: was the task due at any point since last_run?
# Iterates hours (not minutes) for efficiency — at most 48 date calls.
catchup_is_due() {
  local cron_expr="$1" last_run="$2"
  [[ -z "$last_run" || "$last_run" == "null" ]] && return 1

  read -r c_min c_hour c_dom c_mon c_dow <<< "$cron_expr"

  # Convert last_run (YYYY-MM-DD-HH-MM) to epoch
  local lr_str="${last_run:0:4}-${last_run:5:2}-${last_run:8:2} ${last_run:11:2}:${last_run:14:2}:00"
  local lr_epoch now_epoch
  lr_epoch=$(_date_to_epoch "$lr_str") || return 1
  now_epoch=$(date +%s)

  # Only catch up gaps > 2 minutes (normal check covers ±1 min)
  (( now_epoch - lr_epoch <= 120 )) && return 1

  # Cap at 48 hours
  local start_epoch=$lr_epoch
  (( now_epoch - start_epoch > 48 * 3600 )) && start_epoch=$((now_epoch - 48 * 3600))

  # Align to start of the hour after last_run
  local h_epoch=$(( start_epoch - (start_epoch % 3600) + 3600 ))

  while (( h_epoch <= now_epoch )); do
    local h_parts
    h_parts=$(_epoch_to_parts "$h_epoch") || { h_epoch=$((h_epoch + 3600)); continue; }
    local h d mo dow
    read -r h d mo dow <<< "$h_parts"

    if cron_field_matches "$c_hour" "$h" \
      && cron_field_matches "$c_dom" "$d" \
      && cron_field_matches "$c_mon" "$mo" \
      && cron_field_matches "$c_dow" "$dow"; then
      # Check each minute in this hour
      for (( m=0; m<60; m++ )); do
        local t=$((h_epoch + m * 60))
        # Must be after last_run and not in the future
        (( t <= lr_epoch || t > now_epoch )) && continue
        if cron_field_matches "$c_min" "$m"; then
          return 0
        fi
      done
    fi
    h_epoch=$((h_epoch + 3600))
  done
  return 1
}

# Check each schedule, collect due ones
due_tasks_parts=()
current_window=$(date '+%Y-%m-%d-%H-%M')

while IFS= read -r task_json; do
  cron_expr=$(echo "$task_json" | jq -r '.cron')
  name=$(echo "$task_json" | jq -r '.name')
  last_run=$(read_state ".schedules_last_run.\"${name}\"")

  # Check current minute AND previous minute (covers poll gap up to 55s)
  # schedules_last_run dedup prevents double execution
  is_due=false
  if cron_matches_now "$cron_expr"; then
    is_due=true
  else
    # Check previous minute with same dom/mon/dow
    read -r c_min c_hour c_dom c_mon c_dow <<< "$cron_expr"
    if cron_field_matches "$c_min" "$PREV_MIN" \
      && cron_field_matches "$c_hour" "$PREV_HOUR" \
      && cron_field_matches "$c_dom" "$NOW_DOM" \
      && cron_field_matches "$c_mon" "$NOW_MON" \
      && cron_field_matches "$c_dow" "$NOW_DOW"; then
      is_due=true
    fi
  fi

  # Catch-up: if the normal ±1 min check missed it, check since last_run
  if ! $is_due; then
    if catchup_is_due "$cron_expr" "$last_run"; then
      is_due=true
      log "INFO" "Schedule '${name}' missed its window, catching up" >&2
    fi
  fi

  if $is_due; then
    prev_window=$(printf '%s-%02d-%02d' "$(date '+%Y-%m-%d')" "$PREV_HOUR" "$PREV_MIN")

    if [[ "$last_run" != "$current_window" && "$last_run" != "$prev_window" ]]; then
      due_tasks_parts+=("$task_json")
      log "INFO" "Schedule '${name}' is due" >&2
    else
      log "INFO" "Schedule '${name}' already ran this window, skipping" >&2
    fi
  fi
done < <(jq -c '.[]' "$SCHEDULES_FILE")

if (( ${#due_tasks_parts[@]} > 0 )); then
  printf '%s\n' "${due_tasks_parts[@]}" | jq -s '.'
else
  echo "[]"
fi

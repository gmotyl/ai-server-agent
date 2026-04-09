#!/bin/bash
# bin/schedule-run.sh — run a single scheduled task by name
# Called by: heartbeat.sh (due tasks), panel API (run now), telegram /schedule run
#
# Usage: schedule-run.sh <task-name>
# Exit: 0 on success, 1 on task-not-found

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/../lib/utils.sh"
source "${SCRIPT_DIR}/../lib/telegram.sh"
source "${SCRIPT_DIR}/../lib/memory.sh"
source "${SCRIPT_DIR}/../lib/provider.sh"
source "${SCRIPT_DIR}/../lib/response.sh"
load_config

task_name="${1:-}"
if [[ -z "$task_name" ]]; then
  echo "Usage: schedule-run.sh <task-name>" >&2
  exit 1
fi

SCHEDULES_FILE="${AGENT_HOME}/data/schedules.json"
if [[ ! -f "$SCHEDULES_FILE" ]]; then
  log "ERROR" "schedules.json not found"
  exit 1
fi

# Find task by name
task=$(jq -c --arg n "$task_name" '.[] | select(.name == $n)' "$SCHEDULES_FILE")
if [[ -z "$task" ]]; then
  log "ERROR" "Schedule '${task_name}' not found"
  exit 1
fi

# Resolve default provider: persisted default > config default
effective_default=$(read_state '.default_provider')
[[ -z "$effective_default" || "$effective_default" == "null" ]] && effective_default="$DEFAULT_PROVIDER"

eval "$(echo "$task" | jq -r --arg dp "$effective_default" '@sh "
  name=\(.name)
  provider=\(.provider // $dp)
  workdir=\(.workdir // "/git")
  prompt=\(.prompt)
  topic_name=\(.topic_name // ("Scheduled: " + .name))
"')"

log "INFO" "Running scheduled task: ${name}"

# Get or create topic for this schedule
topic_id=$(read_state ".schedule_topics.\"${name}\"")
if [[ -z "$topic_id" || "$topic_id" == "null" ]]; then
  topic_id=$(telegram_create_topic "$topic_name")
  write_state_raw ".schedule_topics.\"${name}\"" "$topic_id"
  log "INFO" "Created topic ${topic_id} for schedule '${name}'"
fi

telegram_send "$topic_id" "Running scheduled task: *${name}*"

# Build prompt with memory
full_prompt=$(build_prompt "$topic_id" "$prompt")
ensure_topic_dir "$topic_id" > /dev/null

# Run provider with typing indicator
telegram_typing_start "$topic_id"
output=$(run_provider "$provider" "$full_prompt" "$workdir") || true
telegram_typing_stop

# Post result and update memory
if response_is_html "$output"; then
  summary=$(response_extract_summary "$output")
  html=$(response_extract_html "$output")
  html_file=$(response_save_html "$topic_id" "$html")
  telegram_send "$topic_id" "$summary"
  telegram_send_document "$topic_id" "$html_file"
  append_topic_context "$topic_id" "[scheduled] $prompt" "$summary" "$provider"
else
  telegram_send "$topic_id" "$output"
  append_topic_context "$topic_id" "[scheduled] $prompt" "${output:0:1000}" "$provider"
fi
log_message "$topic_id" "schedule" "$prompt"
log_message "$topic_id" "$provider" "$output"

# Mark as run
current_window=$(date '+%Y-%m-%d-%H-%M')
write_state ".schedules_last_run.\"${name}\"" "${current_window}"

log "INFO" "Scheduled task '${name}' completed"

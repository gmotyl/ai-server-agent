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
  verify=\(.verify // "")
  verify_retries=\(.verify_retries // 1)
"')"

log "INFO" "Running scheduled task: ${name}"

# Get or create topic for this schedule
topic_id=$(read_state ".schedule_topics.\"${name}\"")
if [[ -z "$topic_id" || "$topic_id" == "null" ]]; then
  topic_id=$(telegram_create_topic "$topic_name")
  write_state_raw ".schedule_topics.\"${name}\"" "$topic_id"
  log "INFO" "Created topic ${topic_id} for schedule '${name}'"
fi

# Send start message; recreate topic if thread is closed/deleted
result=$(telegram_send "$topic_id" "Running scheduled task: *${name}*")
if echo "$result" | grep -q '"ok":false'; then
  log "WARN" "Topic ${topic_id} unreachable, creating new topic for '${name}'"
  topic_id=$(telegram_create_topic "$topic_name")
  write_state_raw ".schedule_topics.\"${name}\"" "$topic_id"
  log "INFO" "Created replacement topic ${topic_id} for schedule '${name}'"
  telegram_send "$topic_id" "Running scheduled task: *${name}*"
fi

# Build prompt with memory
full_prompt=$(build_prompt "$topic_id" "$prompt")
ensure_topic_dir "$topic_id" > /dev/null

# Post provider output to the topic and record it as context
post_output() {
  local task_prompt="$1" text="$2"
  if response_is_html "$text"; then
    local summary html html_file
    summary=$(response_extract_summary "$text")
    html=$(response_extract_html "$text")
    html_file=$(response_save_html "$topic_id" "$html")
    telegram_send "$topic_id" "$summary"
    telegram_send_document "$topic_id" "$html_file"
    append_topic_context "$topic_id" "[scheduled] $task_prompt" "$summary" "$provider"
  else
    telegram_send "$topic_id" "$text"
    append_topic_context "$topic_id" "[scheduled] $task_prompt" "${text:0:1000}" "$provider"
  fi
  log_message "$topic_id" "schedule" "$task_prompt"
  log_message "$topic_id" "$provider" "$text"
}

# Run provider with typing indicator
telegram_typing_start "$topic_id"
output=$(run_provider "$provider" "$full_prompt" "$workdir") && provider_rc=0 || provider_rc=$?
telegram_typing_stop

post_output "$prompt" "$output"

status="ok"
detail=""
if (( provider_rc != 0 )); then
  status="failed"
  detail="provider '${provider}' exited ${provider_rc}"
  log "ERROR" "Scheduled task '${name}': ${detail}"
fi

# --- Acceptance check --------------------------------------------------------
# The provider's exit code proves nothing: a single-shot run that backgrounds its
# work and ends its turn also exits 0. 'verify' asserts the task's actual goal was
# reached; a retry finishes work the provider left hanging instead of restarting it.
if [[ -n "$verify" ]]; then
  attempt=0
  while :; do
    verify_out=$(run_verify "$verify" "$workdir") && verify_rc=0 || verify_rc=$?

    if (( verify_rc == 0 )); then
      status="ok"
      detail=""
      break
    fi

    log "WARN" "Scheduled task '${name}': acceptance check failed (exit ${verify_rc})"

    if (( attempt >= verify_retries )); then
      status="failed"
      detail="acceptance check failed (exit ${verify_rc}): ${verify_out:0:500}"
      break
    fi

    attempt=$((attempt + 1))
    log "INFO" "Scheduled task '${name}': repair attempt ${attempt}/${verify_retries}"
    telegram_send "$topic_id" "⚠️ Acceptance check failed — repair attempt ${attempt}/${verify_retries}"

    repair_prompt=$(printf '%s\n' \
      "[REPAIR RUN] The previous run of the scheduled task '${name}' ended without meeting its acceptance check." \
      "" \
      "Acceptance check: ${verify}" \
      "Check output:" \
      "${verify_out:0:2000}" \
      "" \
      "Do NOT start the task over. Finish only the outstanding work so the check passes, then report what you did." \
      "" \
      "Original task:" \
      "${prompt}")

    telegram_typing_start "$topic_id"
    output=$(run_provider "$provider" "$(build_prompt "$topic_id" "$repair_prompt")" "$workdir") \
      && provider_rc=0 || provider_rc=$?
    telegram_typing_stop

    post_output "$repair_prompt" "$output"
  done
fi

# Mark as run. Written even on failure — otherwise catch-up re-fires all day.
current_window=$(date '+%Y-%m-%d-%H-%M')
write_state ".schedules_last_run.\"${name}\"" "${current_window}"
write_state_raw ".schedules_last_status.\"${name}\"" \
  "$(jq -n --arg s "$status" --arg d "$detail" --arg w "$current_window" \
     '{status:$s,detail:$d,at:$w}')"

if [[ "$status" == "ok" ]]; then
  log "INFO" "Scheduled task '${name}' completed"
else
  log "ERROR" "Scheduled task '${name}' FAILED: ${detail}"
  telegram_send "$topic_id" "❌ Scheduled task *${name}* did not complete: ${detail}"
  exit 1
fi

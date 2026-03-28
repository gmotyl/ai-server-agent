#!/bin/bash
# bin/heartbeat.sh — main heartbeat entry point, called by cron
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/../lib/utils.sh"
source "${SCRIPT_DIR}/../lib/telegram.sh"
source "${SCRIPT_DIR}/../lib/memory.sh"
source "${SCRIPT_DIR}/../lib/provider.sh"
load_config

log "INFO" "=== Heartbeat start ==="

# --- 1. Scheduled tasks ---
due_tasks=$("${SCRIPT_DIR}/schedule-check.sh")
due_count=$(echo "$due_tasks" | jq 'length')

for ((i=0; i<due_count; i++)); do
  task=$(echo "$due_tasks" | jq -c ".[$i]")
  eval "$(echo "$task" | jq -r --arg dp "$DEFAULT_PROVIDER" '@sh "
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

  # Run provider
  output=$(run_provider "$provider" "$full_prompt" "$workdir") || true

  # Post result and update memory
  telegram_send "$topic_id" "$output"
  append_topic_context "$topic_id" "[scheduled] $prompt" "$output" "$provider"
  log_message "$topic_id" "schedule" "$prompt"
  log_message "$topic_id" "$provider" "$output"

  # Mark as run
  current_window=$(date '+%Y-%m-%d-%H-%M')
  write_state ".schedules_last_run.\"${name}\"" "${current_window}"
done

# --- 2. Poll Telegram ---
last_offset=$(read_state '.last_update_id')
last_offset=${last_offset:-0}

updates=$(telegram_poll "$last_offset")
update_count=$(echo "$updates" | jq '.result | length')

if [[ "$update_count" -eq 0 ]]; then
  log "INFO" "No new messages"
  log "INFO" "=== Heartbeat end ==="
  exit 0
fi

# Update offset to highest update_id + 1
new_offset=$(echo "$updates" | jq '[.result[].update_id] | max + 1')
write_state_raw '.last_update_id' "$new_offset"

# --- 3. Process messages ---
for ((i=0; i<update_count; i++)); do
  update=$(echo "$updates" | jq -c ".result[$i]")
  eval "$(echo "$update" | jq -r '@sh "
    msg_text=\(.message.text // empty)
    topic_id=\(.message.message_thread_id // empty)
    from_user=\(.message.from.first_name // "unknown")
  "')"

  # Skip if no text or no topic
  [[ -z "$msg_text" || -z "$topic_id" ]] && continue

  log "INFO" "Message from ${from_user} in topic ${topic_id}: ${msg_text:0:50}..."

  # --- 4. Handle special commands ---
  case "$msg_text" in
    /clone\ *)
      repo_url="${msg_text#/clone }"
      log "INFO" "Cloning: ${repo_url}"
      clone_output=$(git -C "${GIT_DIR}" clone -- "$repo_url" 2>&1) || true
      telegram_send "$topic_id" "Clone result:\n${clone_output}"
      continue
      ;;
    /provider\ *)
      new_provider="${msg_text#/provider }"
      write_state ".topic_providers.\"${topic_id}\"" "${new_provider}"
      telegram_send "$topic_id" "Provider set to: ${new_provider}"
      continue
      ;;
    /close)
      write_state_raw ".topics.\"${topic_id}\".active" "false"
      telegram_send "$topic_id" "Topic closed. Send a new message to reopen."
      continue
      ;;
    /status)
      status_msg="Open topics: $(read_state '.topics | keys | length')\nDefault provider: ${DEFAULT_PROVIDER}"
      telegram_send "$topic_id" "$status_msg"
      continue
      ;;
  esac

  # --- 5. Normal message: dispatch to AI provider ---
  # Determine provider (topic override or default)
  provider=$(read_state ".topic_providers.\"${topic_id}\"")
  [[ -z "$provider" || "$provider" == "null" ]] && provider="$DEFAULT_PROVIDER"

  # Prepare memory
  ensure_topic_dir "$topic_id" > /dev/null
  log_message "$topic_id" "user" "$msg_text"

  # Build prompt
  full_prompt=$(build_prompt "$topic_id" "$msg_text")

  # Determine workdir (topic override or default)
  workdir=$(read_state ".topic_workdirs.\"${topic_id}\"")
  [[ -z "$workdir" || "$workdir" == "null" ]] && workdir="/git"

  # Send typing indicator
  telegram_api "sendChatAction" \
    -d "chat_id=${TELEGRAM_GROUP_ID}" \
    -d "message_thread_id=${topic_id}" \
    -d "action=typing" > /dev/null 2>&1

  # Run provider
  log "INFO" "Dispatching to ${provider}..."
  output=$(run_provider "$provider" "$full_prompt" "$workdir") || true

  if [[ -z "$output" ]]; then
    output="(no output from ${provider})"
  fi

  # Post response
  telegram_send "$topic_id" "$output"

  # Update memory
  append_topic_context "$topic_id" "$msg_text" "${output:0:500}" "$provider"
  log_message "$topic_id" "$provider" "$output"

  log "INFO" "Response posted to topic ${topic_id}"
done

log "INFO" "=== Heartbeat end ==="

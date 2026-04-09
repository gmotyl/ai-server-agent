#!/bin/bash
# bin/heartbeat.sh — main heartbeat entry point, called by cron
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/../lib/utils.sh"
source "${SCRIPT_DIR}/../lib/telegram.sh"
source "${SCRIPT_DIR}/../lib/memory.sh"
source "${SCRIPT_DIR}/../lib/provider.sh"
source "${SCRIPT_DIR}/../lib/response.sh"
load_config

# --- 1. Scheduled tasks ---
due_tasks=$("${SCRIPT_DIR}/schedule-check.sh")
due_count=$(echo "$due_tasks" | jq 'length')

for ((i=0; i<due_count; i++)); do
  name=$(echo "$due_tasks" | jq -r ".[$i].name")
  "${SCRIPT_DIR}/schedule-run.sh" "$name" || true
done

# --- 2. Poll Telegram ---
last_offset=$(read_state '.last_update_id')
last_offset=${last_offset:-0}

updates=$(telegram_poll "$last_offset")
update_count=$(echo "$updates" | jq '.result | length')

if [[ "$update_count" -eq 0 ]]; then
  exit 0
fi

log "INFO" "=== Heartbeat start ==="

# Update offset to highest update_id + 1
new_offset=$(echo "$updates" | jq '[.result[].update_id] | max + 1')
write_state_raw '.last_update_id' "$new_offset"

# --- 3. Process messages ---
for ((i=0; i<update_count; i++)); do
  update=$(echo "$updates" | jq -c ".result[$i]")
  eval "$(echo "$update" | jq -r '@sh "
    msg_text=\(.message.text // "")
    topic_id=\(.message.message_thread_id // "")
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
      write_state ".default_provider" "${new_provider}"
      telegram_send "$topic_id" "Provider set to: *${new_provider}* (default for new topics)"
      continue
      ;;
    /claude)
      write_state ".topic_providers.\"${topic_id}\"" "claude"
      write_state ".default_provider" "claude"
      telegram_send "$topic_id" "Provider set to: *claude* (default for new topics)"
      continue
      ;;
    /qwen)
      write_state ".topic_providers.\"${topic_id}\"" "qwen"
      write_state ".default_provider" "qwen"
      telegram_send "$topic_id" "Provider set to: *qwen* (default for new topics)"
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
    "/schedule list")
      sched_file="${AGENT_HOME}/data/schedules.json"
      if [[ ! -f "$sched_file" ]] || [[ $(jq 'length' "$sched_file") -eq 0 ]]; then
        telegram_send "$topic_id" "No scheduled tasks configured."
      else
        sched_msg="*Scheduled Tasks:*"$'\n'
        while IFS= read -r sj; do
          sn=$(echo "$sj" | jq -r '.name')
          sc=$(echo "$sj" | jq -r '.cron')
          sp=$(echo "$sj" | jq -r '.provider // "default"')
          last_run=$(read_state ".schedules_last_run.\"${sn}\"")
          [[ -z "$last_run" || "$last_run" == "null" ]] && last_run="never"
          sched_msg+="• *${sn}* \`${sc}\` (${sp}) — last: ${last_run}"$'\n'
        done < <(jq -c '.[]' "$sched_file")
        telegram_send "$topic_id" "$sched_msg"
      fi
      continue
      ;;
    /schedule\ show\ *)
      sched_name="${msg_text#/schedule show }"
      sched_file="${AGENT_HOME}/data/schedules.json"
      sched_detail=$(jq -c --arg n "$sched_name" '.[] | select(.name == $n)' "$sched_file" 2>/dev/null)
      if [[ -z "$sched_detail" ]]; then
        telegram_send "$topic_id" "Schedule '${sched_name}' not found."
      else
        eval "$(echo "$sched_detail" | jq -r '@sh "
          sd_name=\(.name)
          sd_cron=\(.cron)
          sd_prompt=\(.prompt)
          sd_provider=\(.provider // "default")
          sd_workdir=\(.workdir // "/git")
        "')"
        last_run=$(read_state ".schedules_last_run.\"${sd_name}\"")
        [[ -z "$last_run" || "$last_run" == "null" ]] && last_run="never"
        detail_msg="*${sd_name}*"$'\n'
        detail_msg+="Cron: \`${sd_cron}\`"$'\n'
        detail_msg+="Provider: ${sd_provider}"$'\n'
        detail_msg+="Workdir: \`${sd_workdir}\`"$'\n'
        detail_msg+="Prompt: ${sd_prompt}"$'\n'
        detail_msg+="Last run: ${last_run}"
        telegram_send "$topic_id" "$detail_msg"
      fi
      continue
      ;;
    /schedule\ run\ *)
      sched_name="${msg_text#/schedule run }"
      sched_file="${AGENT_HOME}/data/schedules.json"
      if ! jq -e --arg n "$sched_name" '.[] | select(.name == $n)' "$sched_file" > /dev/null 2>&1; then
        telegram_send "$topic_id" "Schedule '${sched_name}' not found."
      else
        telegram_send "$topic_id" "Running *${sched_name}*..."
        "${SCRIPT_DIR}/schedule-run.sh" "$sched_name"
      fi
      continue
      ;;
    "/schedule help"|"/schedule")
      help_msg="*Scheduler Commands:*"$'\n'
      help_msg+="/schedule list — show all scheduled tasks"$'\n'
      help_msg+="/schedule show <name> — show task details"$'\n'
      help_msg+="/schedule run <name> — run task now"$'\n'
      help_msg+="/schedule help — this message"
      telegram_send "$topic_id" "$help_msg"
      continue
      ;;
  esac

  # --- 5. Normal message: dispatch to AI provider ---
  # Determine provider (topic override > persisted default > config default)
  provider=$(read_state ".topic_providers.\"${topic_id}\"")
  if [[ -z "$provider" || "$provider" == "null" ]]; then
    provider=$(read_state '.default_provider')
  fi
  if [[ -z "$provider" || "$provider" == "null" ]]; then
    provider="$DEFAULT_PROVIDER"
  fi

  # Prepare memory
  ensure_topic_dir "$topic_id" > /dev/null
  log_message "$topic_id" "user" "$msg_text"

  # Build prompt
  full_prompt=$(build_prompt "$topic_id" "$msg_text")

  # Determine workdir (topic override or default)
  workdir=$(read_state ".topic_workdirs.\"${topic_id}\"")
  [[ -z "$workdir" || "$workdir" == "null" ]] && workdir="${CONTAINER_GIT_DIR:-${GIT_DIR}}"

  # Start persistent typing indicator
  telegram_typing_start "$topic_id"

  # Run provider
  log "INFO" "Dispatching to ${provider}..."
  output=$(run_provider "$provider" "$full_prompt" "$workdir") || true

  # Stop typing indicator
  telegram_typing_stop

  if [[ -z "$output" ]]; then
    output="(no output from ${provider})"
  fi

  # Post response — HTML with attachment or plain text
  if response_is_html "$output"; then
    summary=$(response_extract_summary "$output")
    html=$(response_extract_html "$output")
    html_file=$(response_save_html "$topic_id" "$html")
    telegram_send "$topic_id" "$summary"
    telegram_send_document "$topic_id" "$html_file"
    append_topic_context "$topic_id" "$msg_text" "$summary" "$provider"
  else
    telegram_send "$topic_id" "$output"
    append_topic_context "$topic_id" "$msg_text" "${output:0:1000}" "$provider"
  fi
  log_message "$topic_id" "$provider" "$output"

  log "INFO" "Response posted to topic ${topic_id}"
done

# Signal to start.sh that we processed messages (extend deadline for follow-ups)
touch "${AGENT_HOME}/data/.had_activity"
log "INFO" "=== Heartbeat end ==="

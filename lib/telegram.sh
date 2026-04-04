#!/bin/bash
# lib/telegram.sh — Telegram Bot API functions

# Base API call
telegram_api() {
  local method="$1"
  shift
  curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}" "$@"
}

# Poll for new messages since last offset
# Uses POLL_TIMEOUT env var (default 5s). Set higher for long polling.
telegram_poll() {
  local offset="$1"
  telegram_api "getUpdates" \
    -d "offset=${offset}" \
    -d "timeout=${POLL_TIMEOUT:-5}" \
    -d "allowed_updates=[\"message\"]"
}

# Start persistent typing indicator (background loop).
# Sets TYPING_PID variable. Call telegram_typing_stop to clean up.
telegram_typing_start() {
  local topic_id="$1"
  (
    while true; do
      telegram_api "sendChatAction" \
        -d "chat_id=${TELEGRAM_GROUP_ID}" \
        -d "message_thread_id=${topic_id}" \
        -d "action=typing" > /dev/null 2>&1
      sleep 4
    done
  ) &
  TYPING_PID=$!
}

# Stop persistent typing indicator
telegram_typing_stop() {
  if [[ -n "${TYPING_PID:-}" ]]; then
    kill "$TYPING_PID" 2>/dev/null || true
    wait "$TYPING_PID" 2>/dev/null || true
    TYPING_PID=""
  fi
}

# Send text message to a topic
telegram_send() {
  local topic_id="$1"
  local text="$2"
  local length=${#text}
  local max_len=${MAX_MESSAGE_LENGTH:-4096}

  if [[ $length -le $max_len ]]; then
    telegram_api "sendMessage" \
      -d "chat_id=${TELEGRAM_GROUP_ID}" \
      -d "message_thread_id=${topic_id}" \
      --data-urlencode "text=${text}" \
      -d "parse_mode=Markdown"
  else
    # Split into chunks
    while [[ -n "$text" ]]; do
      local chunk="${text:0:$max_len}"
      telegram_api "sendMessage" \
        -d "chat_id=${TELEGRAM_GROUP_ID}" \
        -d "message_thread_id=${topic_id}" \
        --data-urlencode "text=${chunk}" \
        -d "parse_mode=Markdown"
      text="${text:$max_len}"
    done
  fi
}

# Create a new forum topic
telegram_create_topic() {
  local name="$1"
  local result
  result=$(telegram_api "createForumTopic" \
    -d "chat_id=${TELEGRAM_GROUP_ID}" \
    --data-urlencode "name=${name}")
  echo "$result" | jq -r '.result.message_thread_id'
}

# Send a file as a document to a topic
# Usage: telegram_send_document TOPIC_ID FILE_PATH [CAPTION]
telegram_send_document() {
  local topic_id="$1"
  local file_path="$2"
  local caption="${3:-}"
  local args=(
    -F "chat_id=${TELEGRAM_GROUP_ID}"
    -F "message_thread_id=${topic_id}"
    -F "document=@${file_path}"
  )
  if [[ -n "$caption" ]]; then
    args+=(-F "caption=${caption}")
  fi
  telegram_api "sendDocument" "${args[@]}"
}

# Get messages from a specific topic (filter from poll results)
telegram_filter_topic_messages() {
  local updates="$1"
  local topic_id="$2"
  echo "$updates" | jq -c "[.result[] | select(.message.message_thread_id == ${topic_id})]"
}

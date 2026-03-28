#!/bin/bash
# lib/telegram.sh — Telegram Bot API functions

# Base API call
telegram_api() {
  local method="$1"
  shift
  curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}" "$@"
}

# Poll for new messages since last offset
telegram_poll() {
  local offset="$1"
  telegram_api "getUpdates" \
    -d "offset=${offset}" \
    -d "timeout=5" \
    -d "allowed_updates=[\"message\"]"
}

# Send text message to a topic
telegram_send() {
  local topic_id="$1"
  local text="$2"
  local length=${#text}

  if [[ $length -le $MAX_MESSAGE_LENGTH ]]; then
    telegram_api "sendMessage" \
      -d "chat_id=${TELEGRAM_GROUP_ID}" \
      -d "message_thread_id=${topic_id}" \
      -d "text=${text}" \
      -d "parse_mode=Markdown"
  else
    # Split into chunks
    while [[ -n "$text" ]]; do
      local chunk="${text:0:$MAX_MESSAGE_LENGTH}"
      telegram_api "sendMessage" \
        -d "chat_id=${TELEGRAM_GROUP_ID}" \
        -d "message_thread_id=${topic_id}" \
        -d "text=${chunk}"
      text="${text:$MAX_MESSAGE_LENGTH}"
    done
  fi
}

# Create a new forum topic
telegram_create_topic() {
  local name="$1"
  local result
  result=$(telegram_api "createForumTopic" \
    -d "chat_id=${TELEGRAM_GROUP_ID}" \
    -d "name=${name}")
  echo "$result" | jq -r '.result.message_thread_id'
}

# Get messages from a specific topic (filter from poll results)
telegram_filter_topic_messages() {
  local updates="$1"
  local topic_id="$2"
  echo "$updates" | jq -c "[.result[] | select(.message.message_thread_id == ${topic_id})]"
}

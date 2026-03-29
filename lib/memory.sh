#!/bin/bash
# lib/memory.sh — global + per-topic memory management

# Ensure topic memory directory exists
ensure_topic_dir() {
  local topic_id="$1"
  local dir="${AGENT_HOME}/memory/topics/${topic_id}"
  mkdir -p "$dir"
  [[ -f "${dir}/context.md" ]] || echo "# Task Context" > "${dir}/context.md"
  [[ -f "${dir}/messages.jsonl" ]] || touch "${dir}/messages.jsonl"
  echo "$dir"
}

# Read global memory
read_global_memory() {
  local mem_file="${AGENT_HOME}/memory/MEMORY.md"
  [[ -f "$mem_file" ]] && cat "$mem_file" || echo "(no global memory yet)"
}

# Read topic context
read_topic_context() {
  local topic_id="$1"
  local ctx_file="${AGENT_HOME}/memory/topics/${topic_id}/context.md"
  [[ -f "$ctx_file" ]] && cat "$ctx_file" || echo "(new topic, no context yet)"
}

# Append exchange to topic context
append_topic_context() {
  local topic_id="$1"
  local user_msg="$2"
  local agent_response="$3"
  local provider="$4"
  local ctx_file="${AGENT_HOME}/memory/topics/${topic_id}/context.md"

  cat >> "$ctx_file" <<EOF

## Beat $(date '+%Y-%m-%d %H:%M')
**User:** ${user_msg}
**Agent [${provider}]:** ${agent_response}
EOF
}

# Append raw message to JSONL log
log_message() {
  local topic_id="$1"
  local from="$2"
  local text="$3"
  local log_file="${AGENT_HOME}/memory/topics/${topic_id}/messages.jsonl"
  echo "{\"ts\":\"$(date -u '+%Y-%m-%dT%H:%M:%SZ')\",\"from\":\"${from}\",\"text\":$(echo "$text" | jq -Rs .)}" >> "$log_file"
}

# Build full prompt with memory injection
build_prompt() {
  local topic_id="$1"
  local user_message="$2"
  local global_mem
  local topic_ctx
  global_mem=$(read_global_memory)
  topic_ctx=$(read_topic_context "$topic_id")

  cat <<EOF
You are an AI agent running on a server.
Your home directory is ${AGENT_HOME}. You have access to repos in ${GIT_DIR}.
Write any persistent learnings to ${AGENT_HOME}/memory/MEMORY.md.

=== PERSISTENT MEMORY ===
${global_mem}

=== TASK CONTEXT ===
${topic_ctx}

=== NEW MESSAGE ===
${user_message}
EOF
}

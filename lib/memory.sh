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
  local saved_responses=""
  global_mem=$(read_global_memory)
  topic_ctx=$(read_topic_context "$topic_id")

  # List saved HTML responses if any exist
  local responses_dir="${AGENT_HOME}/memory/topics/${topic_id}/responses"
  if [[ -d "$responses_dir" ]]; then
    local html_files
    html_files=$(ls "$responses_dir"/*.html 2>/dev/null)
    if [[ -n "$html_files" ]]; then
      saved_responses="
=== SAVED RESPONSES ===
The following detailed HTML responses from earlier turns are saved on disk.
You can read these files for detailed context from earlier turns:
$(echo "$html_files" | while read -r f; do echo "- ${f}"; done)
"
    fi
  fi

  # Use printf to avoid heredoc command injection via untrusted content
  printf '%s\n' \
    "You are an AI agent running on a server in non-interactive mode with --dangerously-skip-permissions." \
    "All tools (Bash, Read, Write, Edit, etc.) are pre-approved — never ask the user for permission or approval. Just use them." \
    "You have FULL unrestricted filesystem access. There are NO directory restrictions — you can read, write, and execute anywhere on the filesystem (not just the working directory)." \
    "Your home directory is ${AGENT_HOME}. Repos are in ${GIT_DIR} and ${GIT_DIR}/projects." \
    "Write any persistent learnings to ${AGENT_HOME}/memory/MEMORY.md." \
    "" \
    "=== RESPONSE FORMAT ===" \
    "For simple responses (confirmations, short answers), reply in plain text. Keep under 4000 characters." \
    "" \
    "For complex responses (explanations, analysis, code walkthroughs, comparisons), produce a self-contained HTML document:" \
    "- Start with <summary>A concise summary of key facts, decisions, and what was done (500-1000 chars)</summary>" \
    "- Follow with the full HTML document starting with <!DOCTYPE html>" \
    "- The HTML must be self-contained (inline CSS), mobile-friendly (responsive layout)" \
    "- Use native HTML tables, SVG diagrams, code blocks with syntax highlighting where they help" \
    "- Prefer visual structure over walls of text" \
    "" \
    "The summary is what appears in the chat and is stored as context for future turns. Make it information-dense — include specific names, paths, values, decisions. The HTML file is saved and attached for detailed reference." \
    "" \
    "=== CONVERSATION CONTINUITY ===" \
    "The TASK CONTEXT section below contains prior exchanges in this conversation." \
    "- Always name specific files, paths, variables, and values in your response — never say \"the file\" when you can say \"hello.ts\"" \
    "- Reference details from earlier turns explicitly so the user can follow the thread" \
    "- Never re-ask questions that were already answered" \
    "" \
    "=== PERSISTENT MEMORY ==="
  printf '%s\n' "$global_mem"
  printf '%s\n' "" "=== TASK CONTEXT ==="
  printf '%s\n' "$topic_ctx"
  if [[ -n "$saved_responses" ]]; then
    printf '%s\n' "$saved_responses"
  fi
  printf '%s\n' "=== NEW MESSAGE ==="
  printf '%s\n' "$user_message"
}

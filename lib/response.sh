#!/bin/bash
# lib/response.sh — parse agent responses into summary + HTML

# Check if response contains HTML document
response_is_html() {
  local output="$1"
  [[ "$output" == *"<summary>"* && "$output" == *"<!DOCTYPE html>"* ]]
}

# Extract summary text from <summary> tags
response_extract_summary() {
  local output="$1"
  # Get text between first <summary> and </summary> (multi-line safe)
  local summary="${output#*<summary>}"
  echo "${summary%%</summary>*}"
}

# Extract HTML document (from <!DOCTYPE html> onward)
response_extract_html() {
  local output="$1"
  echo "$output" | sed -n '/<!DOCTYPE html>/,$p'
}

# Save HTML to topic responses directory, echo the file path
response_save_html() {
  local topic_id="$1"
  local html_content="$2"
  local responses_dir="${AGENT_HOME}/memory/topics/${topic_id}/responses"
  mkdir -p "$responses_dir"
  local beat_num
  beat_num=$(ls "$responses_dir"/*.html 2>/dev/null | wc -l | tr -d ' ')
  local html_file="${responses_dir}/beat-${beat_num}.html"
  printf "%s" "$html_content" > "$html_file"
  echo "$html_file"
}

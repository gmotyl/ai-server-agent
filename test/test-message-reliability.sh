#!/bin/bash
# test/test-message-reliability.sh — verify heartbeat processes ALL messages without loss
#
# Creates a mock environment with 20 numbered messages, runs heartbeat,
# and checks that every message got a response.
#
# Usage: ./test/test-message-reliability.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TEST_DIR=$(mktemp -d /tmp/test-reliability-XXXXXX)
SEND_LOG="${TEST_DIR}/sent.log"
NUM_MESSAGES=20
TOPIC_ID=99999

echo "=== Message Reliability Test ==="
echo "Test dir: ${TEST_DIR}"
echo "Messages: ${NUM_MESSAGES}"
echo ""

# --- Setup mock environment ---
mkdir -p "${TEST_DIR}"/{memory/topics,data,logs,config}
touch "${TEST_DIR}/memory/MEMORY.md"

# Minimal state
echo '{"last_update_id":0,"topics":{},"topic_providers":{},"topic_workdirs":{},"schedule_topics":{},"schedules_last_run":{}}' \
  | jq . > "${TEST_DIR}/data/state.json"

# Empty schedules
echo '[]' > "${TEST_DIR}/data/schedules.json"

# --- Generate 20 fake Telegram updates as a JSON file ---
python3 -c "
import json
results = []
for i in range(1, ${NUM_MESSAGES}+1):
    results.append({
        'update_id': i,
        'message': {
            'text': f'MSG-{i}',
            'message_thread_id': ${TOPIC_ID},
            'from': {'first_name': 'TestUser'}
        }
    })
print(json.dumps({'ok': True, 'result': results}))
" > "${TEST_DIR}/updates.json"

# --- Write mock config ---
cat > "${TEST_DIR}/config/agent.conf" <<'CONF'
TELEGRAM_BOT_TOKEN="mock"
TELEGRAM_GROUP_ID="mock"
DEFAULT_PROVIDER="mock"
PROVIDER_CMD_mock='grep -o "MSG-[0-9]*" {prompt_file} | tail -1'
MAX_MESSAGE_LENGTH=4096
HEARTBEAT_TIMEOUT_SEC=60
CONF

# --- Write the mock heartbeat script (quoted heredoc — no expansion) ---
cat > "${TEST_DIR}/run-heartbeat.sh" <<'MOCKSCRIPT'
#!/bin/bash
set -euo pipefail

# These are set by the parent script via env vars
# AGENT_HOME, GIT_DIR, REPO_ROOT, SEND_LOG, UPDATES_FILE

# Source real libraries
source "${REPO_ROOT}/lib/utils.sh"
source "${REPO_ROOT}/lib/memory.sh"
source "${REPO_ROOT}/lib/provider.sh"
source "${REPO_ROOT}/lib/response.sh"

# Override AGENT_HOME (utils.sh auto-detects wrong path)
export AGENT_HOME="${AGENT_HOME}"

load_config

# --- Mock Telegram functions ---
POLL_CALLED=0
telegram_poll() {
  POLL_CALLED=$((POLL_CALLED + 1))
  if [[ $POLL_CALLED -eq 1 ]]; then
    cat "${UPDATES_FILE}"
  else
    echo '{"ok":true,"result":[]}'
  fi
}

telegram_send() {
  echo "SEND topic=$1 text=$2" >> "${SEND_LOG}"
}

telegram_send_document() {
  echo "DOC topic=$1 file=$2" >> "${SEND_LOG}"
}

telegram_typing_start() { :; }
telegram_typing_stop() { :; }
telegram_create_topic() { echo "12345"; }

# --- Message processing (mirrors heartbeat.sh) ---
last_offset=$(read_state '.last_update_id')
last_offset=${last_offset:-0}

updates=$(telegram_poll "$last_offset")
update_count=$(echo "$updates" | jq '.result | length')

if [[ "$update_count" -eq 0 ]]; then
  exit 0
fi

log "INFO" "=== Heartbeat start ($update_count messages) ==="

# Update offset to highest update_id + 1
new_offset=$(echo "$updates" | jq '[.result[].update_id] | max + 1')
write_state_raw '.last_update_id' "$new_offset"

# Process messages
for ((i=0; i<update_count; i++)); do
  update=$(echo "$updates" | jq -c ".result[$i]")
  msg_text=$(echo "$update" | jq -r '.message.text // ""')
  topic_id=$(echo "$update" | jq -r '.message.message_thread_id // ""')
  from_user=$(echo "$update" | jq -r '.message.from.first_name // "unknown"')

  [[ -z "$msg_text" || -z "$topic_id" ]] && continue

  log "INFO" "Processing: ${msg_text}"

  provider=$(read_state ".topic_providers.\"${topic_id}\"")
  [[ -z "$provider" || "$provider" == "null" ]] && provider="$DEFAULT_PROVIDER"

  ensure_topic_dir "$topic_id" > /dev/null
  log_message "$topic_id" "user" "$msg_text"

  full_prompt=$(build_prompt "$topic_id" "$msg_text")

  workdir=$(read_state ".topic_workdirs.\"${topic_id}\"")
  [[ -z "$workdir" || "$workdir" == "null" ]] && workdir="${GIT_DIR}"

  # Mock provider — extract MSG-N from prompt and echo it back
  output=$(echo "$full_prompt" | grep -o "MSG-[0-9]*" | tail -1) || true

  if [[ -z "$output" ]]; then
    output="(no output from ${provider})"
  fi

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

  log "INFO" "Done: ${msg_text}"
done

log "INFO" "=== Heartbeat end ==="
MOCKSCRIPT

chmod +x "${TEST_DIR}/run-heartbeat.sh"

# --- Run the test ---
touch "${SEND_LOG}"
echo "Running heartbeat with ${NUM_MESSAGES} messages..."

export AGENT_HOME="${TEST_DIR}"
export GIT_DIR="${TEST_DIR}"
export REPO_ROOT="${REPO_ROOT}"
export SEND_LOG="${SEND_LOG}"
export UPDATES_FILE="${TEST_DIR}/updates.json"

bash "${TEST_DIR}/run-heartbeat.sh" 2>&1

# --- Verify results ---
echo ""
echo "=== Results ==="

passed=0
failed=0
missing=()

for ((i=1; i<=NUM_MESSAGES; i++)); do
  if grep -q "MSG-${i}" "${SEND_LOG}" 2>/dev/null; then
    passed=$((passed + 1))
  else
    failed=$((failed + 1))
    missing+=("MSG-${i}")
  fi
done

echo "Sent:    ${NUM_MESSAGES}"
echo "Received: ${passed}"
echo "Lost:    ${failed}"

if [[ ${#missing[@]} -gt 0 ]]; then
  echo ""
  echo "Missing messages:"
  for m in "${missing[@]}"; do
    echo "  ✗ ${m}"
  done
fi

echo ""
if [[ $failed -eq 0 ]]; then
  echo "✓ ALL MESSAGES PROCESSED"
else
  echo "✗ MESSAGES LOST — ${failed}/${NUM_MESSAGES} missing"
fi

# --- Cleanup ---
rm -rf "${TEST_DIR}"

exit $failed

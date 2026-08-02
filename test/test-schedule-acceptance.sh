#!/bin/bash
# test/test-schedule-acceptance.sh — end-to-end run of bin/schedule-run.sh's acceptance loop
#
# Reproduces the 2026-07-29..08-02 failure: the provider exits 0 having left the real
# work undone. Asserts the acceptance check catches it, the repair run finishes the job,
# and an unrepairable task is reported as failed instead of logged as "completed".
#
# Runs the REAL schedule-run.sh against a shadow repo whose lib/telegram.sh is a mock.
#
# Usage: ./test/test-schedule-acceptance.sh
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TEST_DIR=$(mktemp -d /tmp/test-acceptance-XXXXXX)

echo "=== Schedule Acceptance Test ==="
echo "Test dir: ${TEST_DIR}"
echo ""

PASS=0
FAIL=0
check() {
  local label="$1" expected="$2" actual="$3"
  if [[ "$expected" == "$actual" ]]; then
    echo "  PASS: ${label}"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: ${label}"
    echo "        expected: ${expected}"
    echo "        actual:   ${actual}"
    FAIL=$((FAIL + 1))
  fi
}

# --- Shadow repo: real bin/ + lib/, mocked telegram.sh ---
SHADOW="${TEST_DIR}/repo"
mkdir -p "${SHADOW}/bin" "${SHADOW}/lib"
ln -s "${REPO_ROOT}/bin/schedule-run.sh" "${SHADOW}/bin/schedule-run.sh"
for f in utils.sh memory.sh provider.sh response.sh; do
  ln -s "${REPO_ROOT}/lib/${f}" "${SHADOW}/lib/${f}"
done

SEND_LOG="${TEST_DIR}/sent.log"
cat > "${SHADOW}/lib/telegram.sh" <<'MOCK'
#!/bin/bash
telegram_send()          { echo "SEND $2" >> "${SEND_LOG}"; echo '{"ok":true}'; }
telegram_send_document() { echo "DOC $2"  >> "${SEND_LOG}"; }
telegram_typing_start()  { :; }
telegram_typing_stop()   { :; }
telegram_create_topic()  { echo "12345"; }
MOCK

# --- Agent home ---
HOME_DIR="${TEST_DIR}/home"
mkdir -p "${HOME_DIR}"/{config,data,logs,memory/topics} "${TEST_DIR}/work"
touch "${HOME_DIR}/memory/MEMORY.md"
echo '{"last_update_id":0,"topics":{},"schedule_topics":{},"schedules_last_run":{}}' \
  | jq . > "${HOME_DIR}/data/state.json"

# Mock provider: "does the work" only once a marker file says the repair run is under way.
# First invocation leaves work/done.marker absent — exactly the real failure mode
# (generated the articles, backgrounded the tests, exited 0 without committing).
cat > "${TEST_DIR}/mock-provider.sh" <<'PROV'
#!/bin/bash
# $1 = prompt file, $2 = behaviour: "repairs" or "never"
prompt_file="$1"
behaviour="$2"
echo "run" >> "${TEST_DIR}/provider-calls.log"
if [[ "$behaviour" == "repairs" ]] && grep -q 'REPAIR RUN' "$prompt_file"; then
  touch "${TEST_DIR}/work/done.marker"
  echo "Repair done: work committed."
else
  echo "Articles generated. Tests running in the background. I'll wait for the results."
fi
exit 0
PROV
chmod +x "${TEST_DIR}/mock-provider.sh"

write_conf() {
  cat > "${HOME_DIR}/config/agent.conf" <<CONF
TELEGRAM_BOT_TOKEN="mock"
TELEGRAM_GROUP_ID="mock"
DEFAULT_PROVIDER="mock"
PROVIDER_CMD_mock='cd {workdir} && ${TEST_DIR}/mock-provider.sh {prompt_file} $1'
MAX_MESSAGE_LENGTH=4096
HEARTBEAT_TIMEOUT_SEC=60
CONF
}

write_schedule() {
  jq -n --arg wd "${TEST_DIR}/work" '[{
    name: "news",
    cron: "0 12 * * *",
    prompt: "generate the articles, then commit and push",
    provider: "mock",
    workdir: $wd,
    verify: "test -f done.marker || { echo \"work/done.marker missing — nothing was committed\"; exit 1; }",
    verify_retries: 1
  }]' > "${HOME_DIR}/data/schedules.json"
}

run_task() {
  ( export AGENT_HOME="${HOME_DIR}" TEST_DIR="${TEST_DIR}" SEND_LOG="${SEND_LOG}"
    "${SHADOW}/bin/schedule-run.sh" news ) > "${TEST_DIR}/run.log" 2>&1
}

status_of() { jq -r '.schedules_last_status.news.status' "${HOME_DIR}/data/state.json"; }

# --- Scenario 1: provider leaves the work undone, repair run finishes it ---
echo "[1] repairable failure"
write_conf repairs
write_schedule
: > "${TEST_DIR}/provider-calls.log"
: > "${SEND_LOG}"
run_task && rc=0 || rc=$?

check "exit code 0" "0" "$rc"
check "provider ran twice (original + repair)" "2" "$(wc -l < "${TEST_DIR}/provider-calls.log" | tr -d ' ')"
check "acceptance check now passes" "true" "$([[ -f "${TEST_DIR}/work/done.marker" ]] && echo true || echo false)"
check "status recorded ok" "ok" "$(status_of)"
check "last_run recorded" "true" "$([[ -n "$(jq -r '.schedules_last_run.news // ""' "${HOME_DIR}/data/state.json")" ]] && echo true || echo false)"
check "logged completed" "true" "$(grep -q "Scheduled task 'news' completed" "${TEST_DIR}/run.log" && echo true || echo false)"

# --- Scenario 2: provider never finishes — task must fail loudly ---
echo "[2] unrepairable failure"
rm -f "${TEST_DIR}/work/done.marker"
write_conf never
write_schedule
: > "${TEST_DIR}/provider-calls.log"
: > "${SEND_LOG}"
run_task && rc=0 || rc=$?

check "exit code 1" "1" "$rc"
check "provider ran twice then gave up" "2" "$(wc -l < "${TEST_DIR}/provider-calls.log" | tr -d ' ')"
check "status recorded failed" "failed" "$(status_of)"
check "detail names the check" "true" "$(jq -r '.schedules_last_status.news.detail' "${HOME_DIR}/data/state.json" | grep -q 'done.marker missing' && echo true || echo false)"
check "logged ERROR, not completed" "true" "$(grep -q "\[ERROR\] Scheduled task 'news' FAILED" "${TEST_DIR}/run.log" && echo true || echo false)"
check "alerted to Telegram" "true" "$(grep -q '❌ Scheduled task' "${SEND_LOG}" && echo true || echo false)"
check "last_run still recorded (no all-day catch-up loop)" "true" \
  "$([[ -n "$(jq -r '.schedules_last_run.news // ""' "${HOME_DIR}/data/state.json")" ]] && echo true || echo false)"

# --- Scenario 3: no verify configured — unchanged behaviour ---
echo "[3] no verify key"
write_conf never
jq 'map(del(.verify, .verify_retries))' "${HOME_DIR}/data/schedules.json" > "${HOME_DIR}/data/s.tmp" \
  && mv "${HOME_DIR}/data/s.tmp" "${HOME_DIR}/data/schedules.json"
: > "${TEST_DIR}/provider-calls.log"
run_task && rc=0 || rc=$?
check "exit code 0" "0" "$rc"
check "provider ran once" "1" "$(wc -l < "${TEST_DIR}/provider-calls.log" | tr -d ' ')"
check "status ok" "ok" "$(status_of)"

rm -rf "${TEST_DIR}"
echo ""
echo "=== ${PASS} passed, ${FAIL} failed ==="
[[ $FAIL -eq 0 ]]

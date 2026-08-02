#!/bin/bash
# test/test-schedule-verify.sh — verify run_verify (scheduled-task acceptance check)
#
# A provider exiting 0 proves nothing: a single-shot `claude -p` run that backgrounds
# its work and ends its turn also exits 0. run_verify is what actually asserts the
# task's goal was reached, so it has to be right about exit codes, output capture,
# workdir, and the GIT_DIR collision.
#
# Usage: ./test/test-schedule-verify.sh
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TEST_DIR=$(mktemp -d /tmp/test-verify-XXXXXX)

echo "=== Schedule Verify Test ==="
echo "Test dir: ${TEST_DIR}"
echo ""

log() { :; }  # stub — lib/provider.sh logs via utils.sh
# shellcheck source=../lib/provider.sh
source "${REPO_ROOT}/lib/provider.sh"

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

mkdir -p "${TEST_DIR}/work"
echo "marker" > "${TEST_DIR}/work/marker.txt"

# --- 1. Passing check returns 0 ---
echo "[1] passing check"
out=$(run_verify "exit 0" "${TEST_DIR}/work") && rc=0 || rc=$?
check "exit code is 0" "0" "$rc"

# --- 2. Failing check propagates its exit code and output ---
echo "[2] failing check"
out=$(run_verify 'echo "uncommitted: news/foo.md"; exit 1' "${TEST_DIR}/work") && rc=0 || rc=$?
check "exit code is 1" "1" "$rc"
check "output captured" "uncommitted: news/foo.md" "$out"

# --- 3. Runs in the schedule's workdir ---
echo "[3] workdir"
out=$(run_verify "cat marker.txt" "${TEST_DIR}/work") && rc=0 || rc=$?
check "relative path resolves in workdir" "marker" "$out"

# --- 4. GIT_DIR / GIT_WORK_TREE are neutralised ---
# agent.conf exports GIT_DIR as the repo *root* (/git). That collides with git's own
# GIT_DIR and breaks every git command a check might run.
echo "[4] git env collision"
export GIT_DIR="/git"
export GIT_WORK_TREE="/git"
out=$(run_verify 'echo "GIT_DIR=[${GIT_DIR:-}] GIT_WORK_TREE=[${GIT_WORK_TREE:-}]"' "${TEST_DIR}/work") && rc=0 || rc=$?
check "git env vars unset inside check" "GIT_DIR=[] GIT_WORK_TREE=[]" "$out"
unset GIT_DIR GIT_WORK_TREE

# --- 5. Missing workdir fails, does not run the check ---
echo "[5] missing workdir"
out=$(run_verify 'echo SHOULD_NOT_RUN' "${TEST_DIR}/nope") && rc=0 || rc=$?
check "non-zero exit" "true" "$([[ $rc -ne 0 ]] && echo true || echo false)"
check "check body did not run" "false" "$([[ "$out" == *SHOULD_NOT_RUN* ]] && echo true || echo false)"

# --- 6. Hanging check is killed by the timeout ---
# Needs timeout(1) — present on the Linux container, absent on a bare macOS dev box
# unless coreutils is installed (gtimeout).
echo "[6] timeout"
if command -v timeout &>/dev/null || command -v gtimeout &>/dev/null; then
  VERIFY_TIMEOUT_SEC=1
  export VERIFY_TIMEOUT_SEC
  start=$(date +%s)
  out=$(run_verify 'sleep 30' "${TEST_DIR}/work") && rc=0 || rc=$?
  elapsed=$(( $(date +%s) - start ))
  check "timed out (exit 124)" "124" "$rc"
  check "returned within 10s" "true" "$([[ $elapsed -lt 10 ]] && echo true || echo false)"
  unset VERIFY_TIMEOUT_SEC
else
  echo "  SKIP: no timeout/gtimeout on this host"
fi

# --- 7. Runtime contract is present in every prompt ---
echo "[7] runtime contract"
contract_hits=$(grep -c 'RUNTIME CONTRACT' "${REPO_ROOT}/lib/memory.sh")
check "build_prompt carries the single-shot contract" "true" "$([[ $contract_hits -ge 1 ]] && echo true || echo false)"

rm -rf "${TEST_DIR}"
echo ""
echo "=== ${PASS} passed, ${FAIL} failed ==="
[[ $FAIL -eq 0 ]]

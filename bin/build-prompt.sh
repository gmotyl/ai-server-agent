#!/bin/bash
# bin/build-prompt.sh — expose build_prompt for eval runner
# Usage: build-prompt.sh <topic_id> <message>
# Stdout: assembled prompt
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/../lib/utils.sh"
source "${SCRIPT_DIR}/../lib/memory.sh"
load_config
build_prompt "$1" "$2"

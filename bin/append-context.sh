#!/bin/bash
# bin/append-context.sh — expose append_topic_context for eval runner
# Usage: append-context.sh <topic_id> <user_msg> <response> <provider>
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/../lib/utils.sh"
source "${SCRIPT_DIR}/../lib/memory.sh"
load_config
ensure_topic_dir "$1" > /dev/null
append_topic_context "$1" "$2" "$3" "$4"

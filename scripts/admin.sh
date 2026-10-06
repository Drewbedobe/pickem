#!/bin/bash
# Runs a server maintenance task using the private admin key.
#   scripts/admin.sh status
#   scripts/admin.sh setup
#   scripts/admin.sh sync
#   scripts/admin.sh setConfig current_week 5
set -euo pipefail
cd "$(dirname "$0")/.."

KEY=$(sed -n "s/.*adminKey: '\([0-9a-f]*\)'.*/\1/p" apps-script/Private.js)
URL=$(sed -n "s/.*apiUrl: '\(.*\)'.*/\1/p" site/config.js)
TASK="${1:?task name required}"

if [ "$TASK" = "setConfig" ]; then
  BODY=$(python3 -c 'import json,sys; v=sys.argv[3]; print(json.dumps({"action":"adminTask","key":sys.argv[1],"task":"setConfig","configKey":sys.argv[2],"value":int(v) if v.isdigit() else v}))' "$KEY" "$2" "$3")
else
  BODY=$(python3 -c 'import json,sys; print(json.dumps({"action":"adminTask","key":sys.argv[1],"task":sys.argv[2]}))' "$KEY" "$TASK")
fi

curl -sL -H 'Content-Type: text/plain;charset=utf-8' --data "$BODY" "$URL" | python3 -m json.tool

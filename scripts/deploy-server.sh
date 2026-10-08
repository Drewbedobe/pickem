#!/bin/bash
# Uploads the Apps Script code, updates the live deployment (same address),
# then runs setup so new tabs/columns/settings are created automatically.
set -euo pipefail
cd "$(dirname "$0")/.."

# The site runs under Jared's Google account (the Sheet's owner). This Mac's
# clasp has a saved sign-in for him under the name "jared".
CLASP_USER="${CLASP_USER:-jared}"

DEPLOYMENT_ID=$(sed -n "s|.*macros/s/\([A-Za-z0-9_-]*\)/exec.*|\1|p" site/config.js)
npx clasp --user "$CLASP_USER" push --force
npx clasp --user "$CLASP_USER" update-deployment "$DEPLOYMENT_ID" --description "${1:-update}"
sleep 8 # the new version takes a few seconds to go live
scripts/admin.sh setup

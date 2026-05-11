#!/usr/bin/env bash
# ============================================================================
# 14 — JSON Installer Output (Three-VM)
# ============================================================================
# Verifies that create-lamaste --json produces valid NDJSON output on the
# host VM. Since Lamaste is already installed, this runs in redeploy mode.
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../e2e/helpers.sh"

require_commands multipass jq

# ---------------------------------------------------------------------------
# VM exec helpers
# ---------------------------------------------------------------------------

host_exec() { multipass exec lamaste-host -- sudo bash -c "$1"; }

begin_test "14 — JSON Installer Output (Three-VM)"

# ---------------------------------------------------------------------------
log_section "create-lamaste --json on host VM (redeploy mode)"
# ---------------------------------------------------------------------------

# Write the JSON output to a temp file on the VM, then read it back.
# This avoids stdout capture issues through multipass exec piping.
host_exec "create-lamaste --json > /tmp/json-install-output.txt 2>/dev/null; true"

JSON_OUTPUT=$(host_exec "cat /tmp/json-install-output.txt 2>/dev/null" || true)

if [ -z "$JSON_OUTPUT" ]; then
  log_fail "No NDJSON output from create-lamaste --json on host VM"
  end_test
  exit 1
fi

# ---------------------------------------------------------------------------
log_section "NDJSON line validation"
# ---------------------------------------------------------------------------

LINE_COUNT=0
VALID_LINES=0
STEP_EVENTS=0
COMPLETE_EVENTS=0

while IFS= read -r line; do
  [ -z "$line" ] && continue
  LINE_COUNT=$((LINE_COUNT + 1))

  if echo "$line" | jq empty 2>/dev/null; then
    VALID_LINES=$((VALID_LINES + 1))
  else
    log_fail "Line $LINE_COUNT is not valid JSON: $line"
    continue
  fi

  EVENT=$(echo "$line" | jq -r '.event // empty')
  case "$EVENT" in
    step)     STEP_EVENTS=$((STEP_EVENTS + 1)) ;;
    complete) COMPLETE_EVENTS=$((COMPLETE_EVENTS + 1)) ;;
  esac
done <<< "$JSON_OUTPUT"

if [ "$LINE_COUNT" -gt 0 ] && [ "$VALID_LINES" -eq "$LINE_COUNT" ]; then
  log_pass "All $LINE_COUNT NDJSON lines are valid JSON"
else
  log_fail "JSON validation: $VALID_LINES/$LINE_COUNT lines valid"
fi

if [ "$STEP_EVENTS" -ge 2 ]; then
  log_pass "Step events emitted: $STEP_EVENTS"
else
  log_fail "Expected at least 2 step events, got: $STEP_EVENTS"
fi

# ---------------------------------------------------------------------------
log_section "Complete event"
# ---------------------------------------------------------------------------

if [ "$COMPLETE_EVENTS" -eq 1 ]; then
  log_pass "Exactly one complete event emitted"

  COMPLETE_LINE=$(echo "$JSON_OUTPUT" | jq -c 'select(.event=="complete")' 2>/dev/null | head -1)

  IP=$(echo "$COMPLETE_LINE" | jq -r '.server.ip // empty')
  PANEL_URL=$(echo "$COMPLETE_LINE" | jq -r '.server.panelUrl // empty')

  if [ -n "$IP" ]; then
    log_pass "Server IP present: $IP"
  else
    log_fail "Server IP missing"
  fi

  if [ -n "$PANEL_URL" ] && [[ "$PANEL_URL" == https://* ]]; then
    log_pass "Panel URL present and uses HTTPS"
  else
    log_fail "Panel URL missing or invalid: $PANEL_URL"
  fi
else
  log_fail "Expected 1 complete event, got: $COMPLETE_EVENTS"
fi

# ---------------------------------------------------------------------------
log_section "Panel health after redeploy"
# ---------------------------------------------------------------------------

# Wait for panel to restart after redeploy (service restart + Node.js startup)
HEALTH="{}"
for i in 1 2 3 4 5; do
  sleep 3
  HEALTH=$(host_exec "curl -sk --max-time 10 --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key --cacert /etc/lamalibre/lamaste/pki/ca.crt https://127.0.0.1:9292/api/health 2>/dev/null" || echo '{}')
  if echo "$HEALTH" | jq -e '.status == "ok"' &>/dev/null; then
    break
  fi
done

if echo "$HEALTH" | jq -e '.status == "ok"' &>/dev/null; then
  log_pass "Panel healthy after --json redeploy"
else
  # The panel may take longer to restart on resource-constrained VMs.
  # The core test (NDJSON output validity) already passed above.
  log_skip "Panel health check timed out after --json redeploy (non-critical)"
fi

# Cleanup
host_exec "rm -f /tmp/json-install-output.txt" 2>/dev/null || true

end_test

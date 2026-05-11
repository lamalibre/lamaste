#!/usr/bin/env bash
# ============================================================================
# 18 — JSON Installer Output (--json flag)
# ============================================================================
# Verifies that create-lamaste --json produces valid NDJSON output:
# - Emits step events with running/complete/skipped status
# - Emits a complete event with server info on success
# - All lines are valid JSON
# - Server info includes expected fields (ip, panelUrl, p12Path, p12PasswordPath)
#
# Since the system already has Lamaste installed, this runs in redeploy mode.
# ============================================================================

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/helpers.sh"

require_commands node jq

begin_test "18 — JSON Installer Output"

# ---------------------------------------------------------------------------
log_section "create-lamaste --json (redeploy mode)"
# ---------------------------------------------------------------------------

# Run the installer in JSON mode and capture NDJSON output
INSTALLER_PATH="/opt/lamalibre/lamaste/create-lamaste/bin/create-lamaste.js"
if [ ! -f "$INSTALLER_PATH" ]; then
  # Fallback: find it via npx or global install
  INSTALLER_PATH=$(which create-lamaste 2>/dev/null || echo "")
  if [ -z "$INSTALLER_PATH" ]; then
    log_skip "create-lamaste not found in PATH or /opt/lamalibre/lamaste"
    end_test
    exit 0
  fi
fi

JSON_OUTPUT=$(node "$INSTALLER_PATH" --json 2>/dev/null || true)

if [ -z "$JSON_OUTPUT" ]; then
  log_fail "No NDJSON output from create-lamaste --json"
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
ERROR_EVENTS=0

while IFS= read -r line; do
  if [ -z "$line" ]; then
    continue
  fi
  LINE_COUNT=$((LINE_COUNT + 1))

  # Verify each line is valid JSON
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
    error)    ERROR_EVENTS=$((ERROR_EVENTS + 1)) ;;
  esac
done <<< "$JSON_OUTPUT"

if [ "$LINE_COUNT" -gt 0 ] && [ "$VALID_LINES" -eq "$LINE_COUNT" ]; then
  log_pass "All $LINE_COUNT lines are valid JSON"
else
  log_fail "JSON validation: $VALID_LINES/$LINE_COUNT lines valid"
fi

if [ "$STEP_EVENTS" -ge 2 ]; then
  log_pass "Step events emitted: $STEP_EVENTS"
else
  log_fail "Expected at least 2 step events, got: $STEP_EVENTS"
fi

# ---------------------------------------------------------------------------
log_section "Complete event validation"
# ---------------------------------------------------------------------------

if [ "$COMPLETE_EVENTS" -eq 1 ]; then
  log_pass "Exactly one complete event emitted"

  COMPLETE_LINE=$(echo "$JSON_OUTPUT" | grep '"event":"complete"' || echo "$JSON_OUTPUT" | grep '"complete"')

  # Verify server info fields
  IP=$(echo "$COMPLETE_LINE" | jq -r '.server.ip // empty')
  PANEL_URL=$(echo "$COMPLETE_LINE" | jq -r '.server.panelUrl // empty')
  P12_PATH=$(echo "$COMPLETE_LINE" | jq -r '.server.p12Path // empty')
  P12_PW_PATH=$(echo "$COMPLETE_LINE" | jq -r '.server.p12PasswordPath // empty')

  if [ -n "$IP" ]; then
    log_pass "Server IP present: $IP"
  else
    log_fail "Server IP missing from complete event"
  fi

  if [ -n "$PANEL_URL" ] && [[ "$PANEL_URL" == https://* ]]; then
    log_pass "Panel URL present and uses HTTPS: $PANEL_URL"
  else
    log_fail "Panel URL missing or not HTTPS: $PANEL_URL"
  fi

  if [ -n "$P12_PATH" ] && [[ "$P12_PATH" == /etc/lamalibre/lamaste/pki/* ]]; then
    log_pass "P12 path within expected directory: $P12_PATH"
  else
    log_fail "P12 path missing or unexpected: $P12_PATH"
  fi

  if [ -n "$P12_PW_PATH" ] && [[ "$P12_PW_PATH" == /etc/lamalibre/lamaste/pki/* ]]; then
    log_pass "P12 password path within expected directory: $P12_PW_PATH"
  else
    log_fail "P12 password path missing or unexpected: $P12_PW_PATH"
  fi
elif [ "$ERROR_EVENTS" -gt 0 ]; then
  log_fail "Installer emitted error event instead of complete"
else
  log_fail "Expected exactly one complete event, got: $COMPLETE_EVENTS"
fi

# ---------------------------------------------------------------------------
log_section "Step status validation"
# ---------------------------------------------------------------------------

# In redeploy mode, expect check_environment and redeploy_panel steps
HAS_ENV_CHECK=$(echo "$JSON_OUTPUT" | jq -r 'select(.event=="step" and .step=="check_environment") | .step' 2>/dev/null | head -1)
if [ -n "$HAS_ENV_CHECK" ]; then
  log_pass "check_environment step present"
else
  log_fail "check_environment step missing"
fi

# Verify step events have valid status values
INVALID_STATUS=$(echo "$JSON_OUTPUT" | jq -r 'select(.event=="step") | .status // "null"' 2>/dev/null | grep -v -E '^(running|complete|skipped|failed)$' | head -1 || true)
if [ -z "$INVALID_STATUS" ]; then
  log_pass "All step events have valid status values"
else
  log_fail "Invalid step status found: $INVALID_STATUS"
fi

# ---------------------------------------------------------------------------
log_section "Panel health after redeploy"
# ---------------------------------------------------------------------------

# Wait for the panel service to restart after redeploy
for i in 1 2 3 4 5; do
  HEALTH=$(curl -sk --cert "$CERT_PATH" --key "$KEY_PATH" --cacert "$CA_PATH" \
    --max-time "$CURL_TIMEOUT" "${BASE_URL}/api/health" 2>/dev/null || echo "")
  if echo "$HEALTH" | jq -e '.status == "ok"' &>/dev/null; then
    break
  fi
  sleep 1
done

if echo "$HEALTH" | jq -e '.status == "ok"' &>/dev/null; then
  log_pass "Panel healthy after --json redeploy"
else
  log_fail "Panel not healthy after --json redeploy: $HEALTH"
fi

end_test

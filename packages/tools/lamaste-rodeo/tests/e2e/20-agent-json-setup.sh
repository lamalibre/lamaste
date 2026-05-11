#!/usr/bin/env bash
# ============================================================================
# 20 — Agent JSON Setup Output (--json flag)
# ============================================================================
# Verifies that lamaste-agent setup --json produces valid NDJSON output:
# - Requires --panel-url when --json is active
# - Requires a token (env var or --token) when --json is active
# - Emits step events with running/complete/skipped status
# - Emits a complete event with agent info on success
# - All lines are valid JSON
# - Agent info includes expected fields (label, panelUrl, authMethod)
# - No sensitive data (token, p12Password) in NDJSON output
# ============================================================================

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/helpers.sh"

require_commands node jq

begin_test "20 — Agent JSON Setup Output"

# ---------------------------------------------------------------------------
log_section "Pre-flight: check onboarding is complete"
# ---------------------------------------------------------------------------

ONBOARDING_STATUS=$(api_get "onboarding/status" | jq -r '.status' 2>/dev/null || echo "unknown")
if [ "$ONBOARDING_STATUS" != "COMPLETED" ]; then
  log_skip "Skipping agent JSON setup — onboarding not complete"
  end_test
  exit $?
fi

# Find lamaste-agent binary
AGENT_BIN=$(which lamaste-agent 2>/dev/null || echo "")
if [ -z "$AGENT_BIN" ]; then
  # Try npm global prefix
  NPM_PREFIX=$(npm config get prefix 2>/dev/null || echo "")
  if [ -n "$NPM_PREFIX" ] && [ -f "$NPM_PREFIX/bin/lamaste-agent" ]; then
    AGENT_BIN="$NPM_PREFIX/bin/lamaste-agent"
  else
    log_skip "lamaste-agent not found in PATH"
    end_test
    exit $?
  fi
fi

log_pass "lamaste-agent found at: $AGENT_BIN"

# ---------------------------------------------------------------------------
log_section "--json requires token"
# ---------------------------------------------------------------------------

# Running --json without a token should fail with an error event
NO_TOKEN_OUTPUT=$(LAMALIBRE_LAMASTE_ENROLLMENT_TOKEN="" "$AGENT_BIN" setup --json --panel-url https://127.0.0.1:9292 2>/dev/null || true)

if echo "$NO_TOKEN_OUTPUT" | jq -e 'select(.event=="error")' &>/dev/null; then
  log_pass "--json without token emits error event"
else
  log_fail "--json without token should emit error event"
fi

# ---------------------------------------------------------------------------
log_section "Generate enrollment token"
# ---------------------------------------------------------------------------

AGENT_LABEL="json-test-agent"

# Clean up any existing agent cert with this label
api_delete "certs/agent/$AGENT_LABEL" &>/dev/null || true

TOKEN_RESPONSE=$(api_post "certs/agent/enroll" "{\"label\":\"$AGENT_LABEL\",\"capabilities\":[\"tunnels:read\"]}")

TOKEN=$(echo "$TOKEN_RESPONSE" | jq -r '.token // empty')
if [ -z "$TOKEN" ]; then
  log_fail "Failed to generate enrollment token: $TOKEN_RESPONSE"
  end_test
  exit 1
fi
log_pass "Enrollment token generated for $AGENT_LABEL"

# ---------------------------------------------------------------------------
log_section "lamaste-agent setup --json (token-based)"
# ---------------------------------------------------------------------------

JSON_OUTPUT=$(LAMALIBRE_LAMASTE_ENROLLMENT_TOKEN="$TOKEN" \
  "$AGENT_BIN" setup --json --label "$AGENT_LABEL" --panel-url "$BASE_URL" 2>/dev/null || true)

if [ -z "$JSON_OUTPUT" ]; then
  log_fail "No NDJSON output from lamaste-agent setup --json"
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

if [ "$STEP_EVENTS" -ge 5 ]; then
  log_pass "Step events emitted: $STEP_EVENTS"
else
  log_fail "Expected at least 5 step events, got: $STEP_EVENTS"
fi

# ---------------------------------------------------------------------------
log_section "Complete event validation"
# ---------------------------------------------------------------------------

if [ "$COMPLETE_EVENTS" -eq 1 ]; then
  log_pass "Exactly one complete event emitted"

  COMPLETE_LINE=$(echo "$JSON_OUTPUT" | jq -c 'select(.event=="complete")' 2>/dev/null | head -1)

  # Verify agent info fields
  LABEL=$(echo "$COMPLETE_LINE" | jq -r '.agent.label // empty')
  PANEL_URL=$(echo "$COMPLETE_LINE" | jq -r '.agent.panelUrl // empty')
  AUTH_METHOD=$(echo "$COMPLETE_LINE" | jq -r '.agent.authMethod // empty')

  if [ "$LABEL" = "$AGENT_LABEL" ]; then
    log_pass "Agent label matches: $LABEL"
  else
    log_fail "Agent label mismatch: expected $AGENT_LABEL, got $LABEL"
  fi

  if [ -n "$PANEL_URL" ] && [[ "$PANEL_URL" == https://* ]]; then
    log_pass "Panel URL present and uses HTTPS: $PANEL_URL"
  else
    log_fail "Panel URL missing or not HTTPS: $PANEL_URL"
  fi

  if [ -n "$AUTH_METHOD" ]; then
    log_pass "Auth method present: $AUTH_METHOD"
  else
    log_fail "Auth method missing from complete event"
  fi
elif [ "$ERROR_EVENTS" -gt 0 ]; then
  ERROR_MSG=$(echo "$JSON_OUTPUT" | jq -r 'select(.event=="error") | .message // "unknown"' 2>/dev/null | head -1)
  log_fail "Agent setup emitted error: $ERROR_MSG"
else
  log_fail "Expected exactly one complete event, got: $COMPLETE_EVENTS"
fi

# ---------------------------------------------------------------------------
log_section "No sensitive data in NDJSON output"
# ---------------------------------------------------------------------------

if echo "$JSON_OUTPUT" | grep -qi "$TOKEN"; then
  log_fail "Enrollment token found in NDJSON output"
else
  log_pass "Enrollment token not leaked in NDJSON output"
fi

if echo "$JSON_OUTPUT" | jq -r '.. | strings' 2>/dev/null | grep -qi "p12Password"; then
  log_fail "P12 password field found in NDJSON output"
else
  log_pass "No P12 password leaked in NDJSON output"
fi

# ---------------------------------------------------------------------------
log_section "Step status validation"
# ---------------------------------------------------------------------------

# Verify expected step keys are present
for STEP_KEY in create_directories generate_keypair enroll_panel save_config; do
  HAS_STEP=$(echo "$JSON_OUTPUT" | jq -r "select(.event==\"step\" and .step==\"$STEP_KEY\") | .step" 2>/dev/null | head -1)
  if [ -n "$HAS_STEP" ]; then
    log_pass "$STEP_KEY step present"
  else
    log_fail "$STEP_KEY step missing"
  fi
done

# Verify step events have valid status values
INVALID_STATUS=$(echo "$JSON_OUTPUT" | jq -r 'select(.event=="step") | .status // "null"' 2>/dev/null | grep -v -E '^(running|complete|skipped|failed)$' | head -1 || true)
if [ -z "$INVALID_STATUS" ]; then
  log_pass "All step events have valid status values"
else
  log_fail "Invalid step status found: $INVALID_STATUS"
fi

# ---------------------------------------------------------------------------
log_section "Cleanup: uninstall test agent"
# ---------------------------------------------------------------------------

# Uninstall the test agent
"$AGENT_BIN" uninstall --label "$AGENT_LABEL" &>/dev/null || true

# Revoke the agent cert
api_delete "certs/agent/$AGENT_LABEL" &>/dev/null || true

log_pass "Test agent cleaned up"

end_test

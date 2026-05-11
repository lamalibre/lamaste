#!/usr/bin/env bash
# ============================================================================
# 16 — Agent JSON Setup Output (Three-VM)
# ============================================================================
# Verifies that lamaste-agent setup --json produces valid NDJSON output on
# the agent VM when run with a token from the host panel.
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../e2e/helpers.sh"

require_commands multipass jq

# ---------------------------------------------------------------------------
# VM exec helpers
# ---------------------------------------------------------------------------

agent_exec() { multipass exec lamaste-agent -- sudo bash -c "$1"; }
host_exec() { multipass exec lamaste-host -- sudo bash -c "$1"; }

host_api_get() {
  host_exec "curl -skf --max-time 30 --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key --cacert /etc/lamalibre/lamaste/pki/ca.crt -H 'Accept: application/json' https://127.0.0.1:9292/api/$1"
}

host_api_post() {
  local path="$1"
  local body="$2"
  local b64body
  b64body=$(echo -n "$body" | base64)
  host_exec "curl -skf --max-time 30 --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key --cacert /etc/lamalibre/lamaste/pki/ca.crt -X POST -H 'Content-Type: application/json' -H 'Accept: application/json' -d \"\$(echo '$b64body' | base64 -d)\" https://127.0.0.1:9292/api/$path"
}

host_api_delete() {
  host_exec "curl -skf --max-time 30 --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key --cacert /etc/lamalibre/lamaste/pki/ca.crt -X DELETE -H 'Accept: application/json' https://127.0.0.1:9292/api/$1"
}

begin_test "16 — Agent JSON Setup Output (Three-VM)"

# ---------------------------------------------------------------------------
log_section "Pre-flight: check onboarding is complete"
# ---------------------------------------------------------------------------

ONBOARDING=$(host_api_get "onboarding/status" || echo '{"status":"unknown"}')
STATUS=$(echo "$ONBOARDING" | jq -r '.status' 2>/dev/null || echo "unknown")
if [ "$STATUS" != "COMPLETED" ]; then
  log_skip "Onboarding not complete — skipping agent JSON setup tests"
  end_test
  exit $?
fi
log_pass "Onboarding is complete"

# Check lamaste-agent is available on agent VM
AGENT_BIN=$(agent_exec "which lamaste-agent 2>/dev/null" || echo "")
if [ -z "$AGENT_BIN" ]; then
  log_skip "lamaste-agent not found on agent VM"
  end_test
  exit $?
fi
log_pass "lamaste-agent found on agent VM: $AGENT_BIN"

# ---------------------------------------------------------------------------
log_section "--json requires token"
# ---------------------------------------------------------------------------

NO_TOKEN_OUTPUT=$(agent_exec "LAMALIBRE_LAMASTE_ENROLLMENT_TOKEN='' lamaste-agent setup --json --panel-url https://${HOST_IP}:9292 2>/dev/null; true")

if echo "$NO_TOKEN_OUTPUT" | jq -e 'select(.event=="error")' &>/dev/null; then
  log_pass "--json without token emits error event"
else
  log_fail "--json without token should emit error event"
fi

# ---------------------------------------------------------------------------
log_section "Generate enrollment token on host"
# ---------------------------------------------------------------------------

AGENT_LABEL="json-test-3vm"

# Clean up any existing agent cert with this label
host_api_delete "certs/agent/$AGENT_LABEL" 2>/dev/null || true

TOKEN_RESPONSE=$(host_api_post "certs/agent/enroll" "{\"label\":\"$AGENT_LABEL\",\"capabilities\":[\"tunnels:read\"]}")

TOKEN=$(echo "$TOKEN_RESPONSE" | jq -r '.token // empty')
if [ -z "$TOKEN" ]; then
  log_fail "Failed to generate enrollment token: $TOKEN_RESPONSE"
  end_test
  exit 1
fi
log_pass "Enrollment token generated for $AGENT_LABEL"

# ---------------------------------------------------------------------------
log_section "lamaste-agent setup --json on agent VM"
# ---------------------------------------------------------------------------

# Write output to temp file to avoid multipass piping issues
agent_exec "LAMALIBRE_LAMASTE_ENROLLMENT_TOKEN='$TOKEN' lamaste-agent setup --json --label '$AGENT_LABEL' --panel-url 'https://${HOST_IP}:9292' > /tmp/agent-json-setup.txt 2>/dev/null; true"

JSON_OUTPUT=$(agent_exec "cat /tmp/agent-json-setup.txt 2>/dev/null" || true)

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

  LABEL=$(echo "$COMPLETE_LINE" | jq -r '.agent.label // empty')
  PANEL_URL=$(echo "$COMPLETE_LINE" | jq -r '.agent.panelUrl // empty')
  AUTH_METHOD=$(echo "$COMPLETE_LINE" | jq -r '.agent.authMethod // empty')

  if [ "$LABEL" = "$AGENT_LABEL" ]; then
    log_pass "Agent label matches: $LABEL"
  else
    log_fail "Agent label mismatch: expected $AGENT_LABEL, got $LABEL"
  fi

  if [ -n "$PANEL_URL" ] && [[ "$PANEL_URL" == https://* ]]; then
    log_pass "Panel URL present and uses HTTPS"
  else
    log_fail "Panel URL missing or not HTTPS: $PANEL_URL"
  fi

  if [ -n "$AUTH_METHOD" ]; then
    log_pass "Auth method present: $AUTH_METHOD"
  else
    log_fail "Auth method missing"
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

# ---------------------------------------------------------------------------
log_section "Step status validation"
# ---------------------------------------------------------------------------

for STEP_KEY in create_directories generate_keypair enroll_panel save_config; do
  HAS_STEP=$(echo "$JSON_OUTPUT" | jq -r "select(.event==\"step\" and .step==\"$STEP_KEY\") | .step" 2>/dev/null | head -1)
  if [ -n "$HAS_STEP" ]; then
    log_pass "$STEP_KEY step present"
  else
    log_fail "$STEP_KEY step missing"
  fi
done

INVALID_STATUS=$(echo "$JSON_OUTPUT" | jq -r 'select(.event=="step") | .status // "null"' 2>/dev/null | grep -v -E '^(running|complete|skipped|failed)$' | head -1 || true)
if [ -z "$INVALID_STATUS" ]; then
  log_pass "All step events have valid status values"
else
  log_fail "Invalid step status found: $INVALID_STATUS"
fi

# ---------------------------------------------------------------------------
log_section "Cleanup: uninstall test agent"
# ---------------------------------------------------------------------------

if agent_exec "lamaste-agent uninstall --label '$AGENT_LABEL' 2>/dev/null; true"; then
  log_pass "Agent uninstalled on agent VM"
else
  log_fail "Agent uninstall failed on agent VM (exit $?)"
fi

DELETE_RESULT=$(host_api_delete "certs/agent/$AGENT_LABEL" 2>/dev/null) || true
DELETE_STATUS=$(echo "$DELETE_RESULT" | jq -r '.ok // .error // "unknown"' 2>/dev/null || echo "unknown")
if [ "$DELETE_STATUS" = "true" ]; then
  log_pass "Agent cert revoked on host"
elif echo "$DELETE_RESULT" | jq -e '.error' &>/dev/null; then
  log_info "Agent cert revocation: $DELETE_STATUS (may already be revoked)"
else
  log_info "Agent cert revocation returned: $DELETE_STATUS"
fi

agent_exec "rm -f /tmp/agent-json-setup.txt" || true

end_test

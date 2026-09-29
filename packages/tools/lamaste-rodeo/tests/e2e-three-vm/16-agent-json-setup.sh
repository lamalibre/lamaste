#!/usr/bin/env bash
# ============================================================================
# 16 — Agent JSON Setup Output (Three-VM)
# ============================================================================
# Verifies that lamaste-agent setup --json produces valid NDJSON output on
# the agent VM when run with a token from the host panel, and what setup
# leaves behind:
# - A copy of the CLI outside npm's global root (what npx runs) refuses to set
#   up, before the single-use enrollment token is spent
# - Setup installs the sync timer (a oneshot service every 30 seconds)
# - An agent with no tunnel keeps its chisel client stopped — not
#   crash-looping — across several sync runs
# - Uninstall removes the sync timer
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

# user_systemctl <args> — systemctl --user for root on the agent VM
# (lingering is enabled by setup-agent.sh; multipass exec is not a PAM session)
user_systemctl() {
  agent_exec "XDG_RUNTIME_DIR=/run/user/0 systemctl --user $1"
}

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
log_section "A copy outside npm's global root refuses, keeping the token"
# ---------------------------------------------------------------------------

# The sync timer runs the installed program every 30 seconds, so setup refuses
# to run from anywhere npm does not manage globally (an npx cache copy can
# vanish). A copy of the global install, with its node_modules, stands in for
# such a copy.
agent_exec "rm -rf /tmp/e2e-16-copy && cp -a \"\$(npm root -g)/@lamalibre/lamaste-agent\" /tmp/e2e-16-copy"
COPY_OUTPUT=$(agent_exec "LAMALIBRE_LAMASTE_ENROLLMENT_TOKEN='$TOKEN' node /tmp/e2e-16-copy/bin/lamaste-agent.js setup --json --label '$AGENT_LABEL' --panel-url 'https://${HOST_IP}:9292' 2>/dev/null; true")
COPY_ERROR=$(echo "$COPY_OUTPUT" | jq -r 'select(.event=="error") | .message' 2>/dev/null | head -1 || echo "")
assert_contains "$COPY_ERROR" "must be installed globally" "Setup from a non-global copy emits an error event naming the global install" || true
COPY_ENROLLED=$(echo "$COPY_OUTPUT" | jq -r 'select(.event=="step" and .step=="enroll_panel") | .step' 2>/dev/null | head -1 || echo "")
assert_eq "$COPY_ENROLLED" "" "Non-global setup never reached the enrollment step" || true
COPY_DIR=$(agent_exec "test -e /root/.lamalibre/lamaste/agents/${AGENT_LABEL} && echo yes || echo no")
assert_eq "$COPY_DIR" "no" "Non-global setup created no agent directory" || true
agent_exec "rm -rf /tmp/e2e-16-copy" || true

# The token is still unspent: lookup does not consume it, enrollment would
LOOKUP_BODY=$(jq -cn --arg t "$TOKEN" '{token:$t}')
LOOKUP_RESPONSE=$(host_exec "curl -sk --max-time 30 -X POST -H 'Content-Type: application/json' -d '${LOOKUP_BODY}' https://127.0.0.1:9292/api/enroll/lookup" 2>/dev/null || echo '{}')
assert_json_field "$LOOKUP_RESPONSE" '.label' "$AGENT_LABEL" "Enrollment token still valid after the refused setup" || true

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

  # setup-agent.sh enables lingering for root (the user this setup runs as),
  # so the chisel user unit starts at boot without a login
  BOOT_PERSISTENCE=$(echo "$COMPLETE_LINE" | jq -r '.agent.bootPersistence // empty')
  assert_eq "$BOOT_PERSISTENCE" "enabled" "Complete event reports bootPersistence: enabled (lingering on)" || true
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
log_section "Sync timer installed by setup"
# ---------------------------------------------------------------------------

SYNC_TIMER="lamalibre-lamaste-sync-${AGENT_LABEL}.timer"
SYNC_SERVICE="lamalibre-lamaste-sync-${AGENT_LABEL}.service"
CHISEL_SERVICE="lamalibre-lamaste-chisel-${AGENT_LABEL}.service"
USER_UNIT_DIR="/root/.config/systemd/user"

SYNC_TIMER_ACTIVE=$(user_systemctl "is-active ${SYNC_TIMER} 2>/dev/null || true")
assert_eq "$SYNC_TIMER_ACTIVE" "active" "Sync timer ${SYNC_TIMER} is active after setup" || true
SYNC_TIMER_ENABLED=$(user_systemctl "is-enabled ${SYNC_TIMER} 2>/dev/null || true")
assert_eq "$SYNC_TIMER_ENABLED" "enabled" "Sync timer ${SYNC_TIMER} is enabled (survives reboot with lingering)" || true

TIMER_UNIT=$(agent_exec "cat '${USER_UNIT_DIR}/${SYNC_TIMER}' 2>/dev/null" || echo "")
assert_contains "$TIMER_UNIT" "OnActiveSec=5s" "Sync timer first fires 5 seconds after activation" || true
assert_contains "$TIMER_UNIT" "OnUnitInactiveSec=30s" "Sync timer fires 30 seconds after each run" || true

SERVICE_UNIT=$(agent_exec "cat '${USER_UNIT_DIR}/${SYNC_SERVICE}' 2>/dev/null" || echo "")
assert_contains "$SERVICE_UNIT" "Type=oneshot" "Sync service is a oneshot" || true
# It runs the globally installed CLI by its resolved path, never an npx copy
GLOBAL_AGENT_SCRIPT=$(agent_exec "realpath \"\$(command -v lamaste-agent)\"" 2>/dev/null || echo "")
assert_contains "$SERVICE_UNIT" "\"${GLOBAL_AGENT_SCRIPT}\" \"sync\" \"--label\" \"${AGENT_LABEL}\" \"--quiet\"" "Sync service runs '<global lamaste-agent> sync --label ${AGENT_LABEL} --quiet'" || true
assert_contains "$SERVICE_UNIT" "/.lamalibre/lamaste/agents/${AGENT_LABEL}/logs/sync.log" "Sync service logs to the agent's sync.log" || true

# ---------------------------------------------------------------------------
log_section "No tunnel assigned: the chisel client stays stopped"
# ---------------------------------------------------------------------------

# The first sync runs 5 seconds after setup; it records its outcome
SYNC_STATE_FILE="/root/.lamalibre/lamaste/agents/${AGENT_LABEL}/sync-state.json"
SYNC_STATE=""
for _ in $(seq 1 30); do
  SYNC_STATE=$(agent_exec "cat '${SYNC_STATE_FILE}' 2>/dev/null" 2>/dev/null || echo "")
  if [ -n "$SYNC_STATE" ] && [ "$(echo "$SYNC_STATE" | jq -r '.lastOkAt // empty' 2>/dev/null)" != "" ]; then
    break
  fi
  sleep 2
done
assert_json_field "$SYNC_STATE" '.lastState' "idle" "sync-state.json records the agent idle (no tunnel assigned)" || true
assert_json_field "$SYNC_STATE" '.tunnels' "0" "sync-state.json records 0 tunnels" || true
assert_json_field "$SYNC_STATE" '.lastError' "null" "sync-state.json records no sync error" || true

# Chisel exits at once without a remote; a unit left running would crash-loop.
# Watch across more than one sync cycle (45 s): it must never be (re)started.
CHISEL_EVER_STARTED=no
for _ in $(seq 1 9); do
  CHISEL_STATE=$(user_systemctl "show -p ActiveState --value ${CHISEL_SERVICE} 2>/dev/null || true")
  case "$CHISEL_STATE" in
    active|activating|reloading|deactivating) CHISEL_EVER_STARTED="$CHISEL_STATE" ;;
  esac
  sleep 5
done
assert_eq "$CHISEL_EVER_STARTED" "no" "Chisel unit of a tunnel-less agent never started across 45 s of syncs" || true
CHISEL_RESTARTS=$(user_systemctl "show -p NRestarts --value ${CHISEL_SERVICE} 2>/dev/null || true")
case "$CHISEL_RESTARTS" in
  ""|0) log_pass "Chisel unit of a tunnel-less agent has not been restarted (NRestarts: ${CHISEL_RESTARTS:-n/a})" ;;
  *) log_fail "Chisel unit of a tunnel-less agent restarted ${CHISEL_RESTARTS} time(s)" ;;
esac

IDLE_STATUS=$(agent_exec "lamaste-agent status --label '$AGENT_LABEL' 2>&1 || true")
IDLE_SYNC_LINE=$(echo "$IDLE_STATUS" | grep "Sync:" | head -1 || true)
assert_contains "$IDLE_SYNC_LINE" "no tunnels assigned" "Status Sync: line reports no tunnels assigned" || true

# ---------------------------------------------------------------------------
log_section "Cleanup: uninstall test agent"
# ---------------------------------------------------------------------------

if agent_exec "lamaste-agent uninstall --label '$AGENT_LABEL' 2>/dev/null; true"; then
  log_pass "Agent uninstalled on agent VM"
else
  log_fail "Agent uninstall failed on agent VM (exit $?)"
fi

# Uninstall removes the sync timer — it would otherwise keep running sync
TIMER_AFTER=$(user_systemctl "is-active ${SYNC_TIMER} 2>/dev/null || true")
assert_not_eq "$TIMER_AFTER" "active" "Sync timer stopped after uninstall (state: ${TIMER_AFTER})" || true
TIMER_FILE_AFTER=$(agent_exec "test -e '${USER_UNIT_DIR}/${SYNC_TIMER}' && echo yes || echo no")
assert_eq "$TIMER_FILE_AFTER" "no" "Sync timer unit file removed by uninstall" || true

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

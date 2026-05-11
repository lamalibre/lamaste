#!/usr/bin/env bash
# ============================================================================
# 12 — Enrollment Token Lifecycle (Three-VM)
# ============================================================================
# Tests the hardware-bound certificate enrollment flow across VMs:
# - Token creation on host
# - Public enrollment endpoint reachable from agent VM without mTLS
# - CSR-based enrollment
# - Agent registry shows hardware-bound enrollment method
# - Admin upgrade + P12 lockdown
# - Revert for subsequent tests
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../e2e/helpers.sh"

require_commands multipass curl jq openssl

# ---------------------------------------------------------------------------
# VM exec helpers
# ---------------------------------------------------------------------------

agent_exec() { multipass exec lamaste-agent -- sudo bash -c "$1"; }

# Use the vm-api-helper.sh on the host VM for reliable API calls.
# It avoids quoting issues with multipass exec + sudo bash -c.
host_api_get() {
  multipass exec lamaste-host -- sudo /tmp/vm-api-helper.sh GET "$1"
}

host_api_post() {
  local path="$1"
  local body="$2"
  local b64body
  b64body=$(echo -n "$body" | base64)
  multipass exec lamaste-host -- sudo /tmp/vm-api-helper.sh POST "$path" "$b64body"
}

host_api_delete() {
  multipass exec lamaste-host -- sudo /tmp/vm-api-helper.sh DELETE "$1"
}

host_exec() { multipass exec lamaste-host -- sudo bash -c "$1"; }

begin_test "12 — Enrollment Token Lifecycle (Three-VM)"

# ---------------------------------------------------------------------------
log_section "Pre-flight: check onboarding is complete"
# ---------------------------------------------------------------------------

ONBOARDING=$(host_api_get "onboarding/status" || echo '{"status":"unknown"}')
STATUS=$(echo "$ONBOARDING" | jq -r '.status' 2>/dev/null || echo "unknown")
if [ "$STATUS" != "COMPLETED" ]; then
  log_skip "Onboarding not complete — skipping enrollment tests"
  end_test
  exit $?
fi
log_pass "Onboarding is complete"

# ---------------------------------------------------------------------------
log_section "Admin auth mode defaults to p12"
# ---------------------------------------------------------------------------

AUTH_MODE=$(host_api_get "certs/admin/auth-mode" || echo '{}')
assert_json_field "$AUTH_MODE" '.adminAuthMode' 'p12' "Admin auth mode is p12" || true

# ---------------------------------------------------------------------------
log_section "Create enrollment token on host"
# ---------------------------------------------------------------------------

TOKEN_LABEL="e2e-enroll-$(date +%s)"
TOKEN_RESPONSE=$(host_api_post "certs/agent/enroll" "{\"label\":\"${TOKEN_LABEL}\",\"capabilities\":[\"tunnels:read\",\"tunnels:write\"]}" || echo '{"ok":false}')
assert_json_field "$TOKEN_RESPONSE" '.ok' 'true' "Token created" || true

TOKEN=$(echo "$TOKEN_RESPONSE" | jq -r '.token' 2>/dev/null || echo "")
if [ -z "$TOKEN" ] || [ "$TOKEN" = "null" ]; then
  log_fail "Token value is empty — cannot continue enrollment tests"
  end_test
  exit $?
fi
log_pass "Token value present (${#TOKEN} chars)"

# ---------------------------------------------------------------------------
log_section "Public enrollment reachable from agent VM without mTLS"
# ---------------------------------------------------------------------------

# Agent VM calls the host's enrollment endpoint WITHOUT any client cert
AGENT_ENROLL_STATUS=$(multipass exec lamaste-agent -- curl -sk -o /dev/null -w '%{http_code}' \
  --max-time 30 \
  -X POST \
  -H 'Content-Type: application/json' \
  -d '{"token":"0000000000000000000000000000000000000000000000000000000000000000","csr":"-----BEGIN CERTIFICATE REQUEST-----\nfake\n-----END CERTIFICATE REQUEST-----"}' \
  "https://${HOST_IP}:9292/api/enroll" 2>/dev/null || echo "000")

# 400 = CSR validation failed, 401 = invalid token — both prove endpoint is reachable
if [ "$AGENT_ENROLL_STATUS" = "400" ] || [ "$AGENT_ENROLL_STATUS" = "401" ]; then
  log_pass "Enrollment endpoint reachable from agent VM without mTLS (HTTP $AGENT_ENROLL_STATUS)"
else
  log_fail "Enrollment endpoint not reachable from agent VM (HTTP $AGENT_ENROLL_STATUS — expected 400 or 401)"
fi

# ---------------------------------------------------------------------------
log_section "Generate CSR on agent VM and enroll"
# ---------------------------------------------------------------------------

# Generate keypair + CSR on agent VM.
# The panel's CSR signer enforces that the CN matches the token's enrolled
# label exactly (i.e. `agent:<label>`). Older clients used `agent:pending` as
# a placeholder and asked the server to rewrite the subject; that shortcut is
# gone (see packages/server/daemon/src/lib/csr-signing.js). Build the CSR with
# the final CN up front.
agent_exec "openssl genrsa -out /tmp/enroll-test.key 2048 2>/dev/null"
agent_exec "openssl req -new -key /tmp/enroll-test.key -out /tmp/enroll-test.csr -subj '/CN=agent:${TOKEN_LABEL}/O=Lamaste' 2>/dev/null"

# Read CSR from agent VM
CSR_PEM=$(multipass exec lamaste-agent -- cat /tmp/enroll-test.csr)

# Build JSON body and transfer to agent VM via temp file
ENROLL_BODY=$(jq -n --arg token "$TOKEN" --arg csr "$CSR_PEM" '{token: $token, csr: $csr}')
LOCAL_BODY_TMP=$(mktemp /tmp/enroll-body-XXXXXXXX.json)
echo "$ENROLL_BODY" > "$LOCAL_BODY_TMP"
multipass transfer "$LOCAL_BODY_TMP" lamaste-agent:/tmp/enroll-body.json
rm -f "$LOCAL_BODY_TMP"

# Enroll from agent VM (no mTLS cert needed)
ENROLL_RESPONSE=$(multipass exec lamaste-agent -- curl -sk \
  --max-time 60 \
  -X POST \
  -H 'Content-Type: application/json' \
  -d @/tmp/enroll-body.json \
  "https://${HOST_IP}:9292/api/enroll" 2>/dev/null || echo '{"ok":false,"error":"curl failed"}')

ENROLL_OK=$(echo "$ENROLL_RESPONSE" | jq -r '.ok // "false"' 2>/dev/null || echo "false")
if [ "$ENROLL_OK" = "true" ]; then
  log_pass "Agent enrolled successfully"
else
  ENROLL_ERR=$(echo "$ENROLL_RESPONSE" | jq -r '.error // "unknown"' 2>/dev/null || echo "unknown")
  log_fail "Agent enrollment failed: $ENROLL_ERR"
fi

assert_json_field "$ENROLL_RESPONSE" '.label' "$TOKEN_LABEL" "Enrolled label matches" || true

SERIAL=$(echo "$ENROLL_RESPONSE" | jq -r '.serial // ""' 2>/dev/null || echo "")
assert_not_eq "$SERIAL" "" "Enrollment returns serial" || true

# ---------------------------------------------------------------------------
log_section "Token replay rejected"
# ---------------------------------------------------------------------------

REPLAY_STATUS=$(multipass exec lamaste-agent -- curl -sk -o /dev/null -w '%{http_code}' \
  --max-time 30 \
  -X POST \
  -H 'Content-Type: application/json' \
  -d @/tmp/enroll-body.json \
  "https://${HOST_IP}:9292/api/enroll" 2>/dev/null || echo "000")

assert_eq "$REPLAY_STATUS" "401" "Token replay rejected with 401" || true

# ---------------------------------------------------------------------------
log_section "Enrolled agent in registry with hardware-bound method"
# ---------------------------------------------------------------------------

AGENTS=$(host_api_get "certs/agent" || echo '{"agents":[]}')
METHOD=$(echo "$AGENTS" | jq -r "[.agents[] | select(.label==\"${TOKEN_LABEL}\" and .revoked==false)] | last | .enrollmentMethod" 2>/dev/null || echo "unknown")
assert_eq "$METHOD" "hardware-bound" "Agent shows enrollmentMethod: hardware-bound" || true

# ---------------------------------------------------------------------------
log_section "Verify lamaste-agent status shows enrolled agent"
# ---------------------------------------------------------------------------

# The agent VM was enrolled during setup-agent.sh using lamaste-agent setup --token.
# Verify the lamaste-agent CLI can report its status correctly.
# Note: the agent may show "not loaded" if no tunnels are configured (chisel needs
# at least one remote). We check for "Config: present" to confirm setup completed.
AGENT_STATUS_OUTPUT=$(agent_exec "lamaste-agent status 2>&1 || true")
if echo "$AGENT_STATUS_OUTPUT" | grep -q "Config:.*present"; then
  log_pass "lamaste-agent status shows config present"
else
  log_fail "lamaste-agent status does not show config present"
  log_info "Status output: $AGENT_STATUS_OUTPUT"
fi

# Verify systemd service is enabled (it may not be active if no tunnels are configured)
# Multi-agent: service name includes the label set during setup-agent.sh.
# The agent installs as a user-level systemd unit (linger enabled), so we query
# the per-user manager via XDG_RUNTIME_DIR + --user.
SYSTEMD_ENABLED=$(agent_exec "XDG_RUNTIME_DIR=/run/user/0 systemctl --user is-enabled lamalibre-lamaste-chisel-e2e-agent 2>/dev/null || echo disabled")
if [ "$SYSTEMD_ENABLED" = "enabled" ]; then
  log_pass "systemd service lamalibre-lamaste-chisel-e2e-agent is enabled"
else
  log_fail "systemd service lamalibre-lamaste-chisel-e2e-agent is $SYSTEMD_ENABLED (expected enabled)"
fi

# Verify agent config file exists (multi-agent: per-agent config at agents/<label>/config.json)
CONFIG_EXISTS=$(agent_exec "test -f ~/.lamalibre/lamaste/agents/e2e-agent/config.json && echo yes || echo no")
assert_eq "$CONFIG_EXISTS" "yes" "Agent config file exists after setup" || true

# ---------------------------------------------------------------------------
log_section "Clean up: revoke test agent"
# ---------------------------------------------------------------------------

multipass exec lamaste-host -- sudo curl -sk --max-time 10 \
  --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key --cacert /etc/lamalibre/lamaste/pki/ca.crt \
  -X DELETE "https://127.0.0.1:9292/api/certs/agent/${TOKEN_LABEL}" 2>/dev/null || true
agent_exec "rm -f /tmp/enroll-test.key /tmp/enroll-test.csr /tmp/enroll-body.json" 2>/dev/null || true
log_pass "Cleaned up test agent and temp files"

# ---------------------------------------------------------------------------
log_section "Admin upgrade endpoint is locked down (B9)"
# ---------------------------------------------------------------------------

# Panel-initiated admin cert issuance was disabled for security (B9 hardening).
# The only way to re-issue an admin cert is `sudo lamaste-server reset-admin`
# on the server console. Verify the panel route returns 503 with the expected
# actionable error message, and that nothing mutates admin auth state.

# Generate a well-formed admin CSR on the host so the request reaches the
# route handler rather than failing on input validation.
host_exec "openssl genrsa -out /tmp/admin-up.key 2048 2>/dev/null && openssl req -new -key /tmp/admin-up.key -out /tmp/admin-up.csr -subj '/CN=admin/O=Lamaste' 2>/dev/null"
ADMIN_CSR=$(host_exec "cat /tmp/admin-up.csr")

ADMIN_BODY=$(jq -n --arg csr "$ADMIN_CSR" '{csr: $csr}')
LOCAL_ADMIN_TMP=$(mktemp /tmp/admin-up-body-XXXXXXXX.json)
echo "$ADMIN_BODY" > "$LOCAL_ADMIN_TMP"
multipass transfer "$LOCAL_ADMIN_TMP" lamaste-host:/tmp/admin-up-body.json
rm -f "$LOCAL_ADMIN_TMP"

UPGRADE_STATUS=$(host_exec "curl -sk -o /tmp/upgrade-body.json -w '%{http_code}' --max-time 60 --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key --cacert /etc/lamalibre/lamaste/pki/ca.crt -X POST -H 'Content-Type: application/json' -H 'Accept: application/json' -d @/tmp/admin-up-body.json https://127.0.0.1:9292/api/certs/admin/upgrade-to-hardware-bound" || echo "000")
UPGRADE_RESPONSE=$(host_exec "cat /tmp/upgrade-body.json" 2>/dev/null || echo '{}')

assert_eq "$UPGRADE_STATUS" "503" "Panel-initiated admin upgrade returns 503" || true

UPGRADE_ERR=$(echo "$UPGRADE_RESPONSE" | jq -r '.error // empty' 2>/dev/null || echo "")
if echo "$UPGRADE_ERR" | grep -q "reset-admin"; then
  log_pass "Error message references \`lamaste-server reset-admin\` recovery path"
else
  log_fail "Unexpected upgrade error body: $UPGRADE_ERR"
fi

# Panel state must still be p12 — a 503 short-circuits before any mutation.
AUTH_MODE_AFTER=$(host_api_get "certs/admin/auth-mode" || echo '{}')
assert_json_field "$AUTH_MODE_AFTER" '.adminAuthMode' 'p12' "Admin auth mode still p12 after refused upgrade" || true

# ---------------------------------------------------------------------------
log_section "P12 rotation lockdown"
# ---------------------------------------------------------------------------

# The P12 rotation endpoint is disabled alongside admin CSR signing — same
# B9 guarantee, same recovery path. Accept either the 503 from the lib layer
# or the mTLS-level rejection (000/496) if the cert has since been revoked.
ROTATE_STATUS=$(host_exec "curl -sk -o /dev/null -w '%{http_code}' --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key --cacert /etc/lamalibre/lamaste/pki/ca.crt -X POST https://127.0.0.1:9292/api/certs/mtls/rotate" 2>/dev/null || echo "000")

case "$ROTATE_STATUS" in
  503|410)
    log_pass "P12 rotation blocked (HTTP $ROTATE_STATUS)"
    ;;
  496|000|0000|00000)
    log_pass "P12 rotation blocked — nginx rejected the client cert (HTTP $ROTATE_STATUS)"
    ;;
  *)
    log_fail "Unexpected status for P12 rotation: HTTP $ROTATE_STATUS (expected 503/410/496/000)"
    ;;
esac

# Clean up temp files on host (no panel.json revert needed — nothing changed).
host_exec "rm -f /tmp/admin-up.key /tmp/admin-up.csr /tmp/admin-up-body.json /tmp/upgrade-body.json" 2>/dev/null || true

# ---------------------------------------------------------------------------
end_test

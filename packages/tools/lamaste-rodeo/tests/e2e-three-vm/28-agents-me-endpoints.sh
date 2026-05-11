#!/usr/bin/env bash
# ============================================================================
# 28 — Agents Me Endpoints (Three-VM)
# ============================================================================
# 28 — Agents /me/* self-service and chisel credential rotation (Three-VM)
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "/Users/onurdevrimvatan/lama/repositories/lamalibre/lamaste/packages/tools/lamaste-rodeo/tests/e2e/helpers.sh"

require_commands multipass curl jq

# ---------------------------------------------------------------------------
# VM exec helpers
# ---------------------------------------------------------------------------

host_exec() { multipass exec lamaste-host -- sudo bash -c "$1"; }

host_api_get() {
  host_exec "curl -skf --max-time 30 --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key --cacert /etc/lamalibre/lamaste/pki/ca.crt -H 'Accept: application/json' https://127.0.0.1:9292/api/$1"
}

host_api_post() {
  host_exec "curl -skf --max-time 30 --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key --cacert /etc/lamalibre/lamaste/pki/ca.crt -X POST -H 'Content-Type: application/json' -H 'Accept: application/json' -d '$2' https://127.0.0.1:9292/api/$1"
}

host_api_delete() {
  host_exec "curl -skf --max-time 30 --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key --cacert /etc/lamalibre/lamaste/pki/ca.crt -X DELETE -H 'Accept: application/json' https://127.0.0.1:9292/api/$1"
}

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

AGENT_LABEL="agents-me-28"

begin_test "28 — Agents Me Endpoints (Three-VM)"

# ---------------------------------------------------------------------------
# Cleanup function — always runs on exit
# ---------------------------------------------------------------------------

cleanup() {
  log_info "Cleaning up test resources..."
  host_api_delete "certs/agent/${AGENT_LABEL}" 2>/dev/null || true
  host_exec "shred -u /tmp/e2e-agents-me-28-cert.pem /tmp/e2e-agents-me-28-key.pem 2>/dev/null || rm -f /tmp/e2e-agents-me-28-cert.pem /tmp/e2e-agents-me-28-key.pem" 2>/dev/null || true
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
log_section "1. Pre-flight — verify onboarding is complete"
# ---------------------------------------------------------------------------

ONBOARDING_STATUS=$(host_api_get "onboarding/status" | jq -r '.status' 2>/dev/null || echo "")
assert_eq "$ONBOARDING_STATUS" "COMPLETED" "Onboarding status is COMPLETED"

# ---------------------------------------------------------------------------
log_section "2. Create agent cert with known capabilities + allowedSites"
# ---------------------------------------------------------------------------

CERT_RESPONSE=$(host_api_post "certs/agent" "{\"label\":\"agents-me-28\",\"capabilities\":[\"tunnels:read\",\"sites:read\"],\"allowedSites\":[\"site-alpha\",\"site-beta\"]}")
assert_json_field "$CERT_RESPONSE" '.ok' 'true' "POST /certs/agent returned ok: true" || true
assert_json_field "$CERT_RESPONSE" '.label' "$AGENT_LABEL" "Response label matches agent label" || true
P12_PASSWORD=$(echo "$CERT_RESPONSE" | jq -r '.p12Password' 2>/dev/null || echo "")
assert_json_field_not_empty "$CERT_RESPONSE" '.p12Password' "Response carries a p12Password" || true
P12_PATH="/etc/lamalibre/lamaste/pki/agents/${AGENT_LABEL}/client.p12"
AGENT_CERT_PATH="/tmp/e2e-agents-me-28-cert.pem"
AGENT_KEY_PATH="/tmp/e2e-agents-me-28-key.pem"
host_exec "openssl pkcs12 -in '${P12_PATH}' -clcerts -nokeys -out '${AGENT_CERT_PATH}' -passin 'pass:${P12_PASSWORD}' -legacy 2>/dev/null || openssl pkcs12 -in '${P12_PATH}' -clcerts -nokeys -out '${AGENT_CERT_PATH}' -passin 'pass:${P12_PASSWORD}'"
host_exec "openssl pkcs12 -in '${P12_PATH}' -nocerts -nodes -out '${AGENT_KEY_PATH}' -passin 'pass:${P12_PASSWORD}' -legacy 2>/dev/null || openssl pkcs12 -in '${P12_PATH}' -nocerts -nodes -out '${AGENT_KEY_PATH}' -passin 'pass:${P12_PASSWORD}'"
host_exec "chmod 0600 '${AGENT_CERT_PATH}' '${AGENT_KEY_PATH}'"
log_pass "Extracted PEM cert and key from .p12"

# ---------------------------------------------------------------------------
log_section "3. GET /agents/me/capabilities with agent cert"
# ---------------------------------------------------------------------------

ME_CAPS_RESPONSE=$(host_exec "curl -skf --max-time 30 --cert ${AGENT_CERT_PATH} --key ${AGENT_KEY_PATH} --cacert /etc/lamalibre/lamaste/pki/ca.crt -H 'Accept: application/json' https://127.0.0.1:9292/api/agents/me/capabilities")
assert_json_field "$ME_CAPS_RESPONSE" '.role' 'agent' "/me/capabilities returns role=agent for an agent cert" || true
assert_contains "$ME_CAPS_RESPONSE" "tunnels:read" "/me/capabilities response contains tunnels:read" || true
assert_contains "$ME_CAPS_RESPONSE" "sites:read" "/me/capabilities response contains sites:read" || true
ME_CAPS_COUNT=$(echo "$ME_CAPS_RESPONSE" | jq '.capabilities | length' 2>/dev/null || echo "0")
assert_eq "$ME_CAPS_COUNT" "2" "/me/capabilities returns exactly 2 capabilities (the set admin provided)" || true
assert_contains "$ME_CAPS_RESPONSE" "site-alpha" "/me/capabilities allowedSites includes site-alpha" || true
assert_contains "$ME_CAPS_RESPONSE" "site-beta" "/me/capabilities allowedSites includes site-beta" || true
ME_SITES_COUNT=$(echo "$ME_CAPS_RESPONSE" | jq '.allowedSites | length' 2>/dev/null || echo "0")
assert_eq "$ME_SITES_COUNT" "2" "/me/capabilities returns exactly 2 allowedSites (the set admin provided)" || true

# ---------------------------------------------------------------------------
log_section "4. GET /agents/me/chisel-credential with agent cert"
# ---------------------------------------------------------------------------

ME_CHISEL_RESPONSE=$(host_exec "curl -skf --max-time 30 --cert ${AGENT_CERT_PATH} --key ${AGENT_KEY_PATH} --cacert /etc/lamalibre/lamaste/pki/ca.crt -H 'Accept: application/json' https://127.0.0.1:9292/api/agents/me/chisel-credential")
assert_json_field_not_empty "$ME_CHISEL_RESPONSE" '.user' "/me/chisel-credential returns a non-empty user" || true
assert_json_field_not_empty "$ME_CHISEL_RESPONSE" '.password' "/me/chisel-credential returns a non-empty password" || true
assert_contains "$ME_CHISEL_RESPONSE" "$AGENT_LABEL" "/me/chisel-credential user references the agent label" || true
PW_BEFORE=$(echo "$ME_CHISEL_RESPONSE" | jq -r '.password' 2>/dev/null || echo "")

# ---------------------------------------------------------------------------
log_section "5. POST /agents/:label/chisel-credential/rotate (admin)"
# ---------------------------------------------------------------------------

ROTATE_RESPONSE=$(host_api_post "agents/${AGENT_LABEL}/chisel-credential/rotate" "{}")
assert_json_field "$ROTATE_RESPONSE" '.ok' 'true' "Rotate returned ok: true" || true
assert_json_field "$ROTATE_RESPONSE" '.label' "$AGENT_LABEL" "Rotate response label matches the agent" || true
assert_json_field_not_empty "$ROTATE_RESPONSE" '.password' "Rotate response carries a non-empty new password" || true
PW_ROTATED=$(echo "$ROTATE_RESPONSE" | jq -r '.password' 2>/dev/null || echo "")
assert_not_eq "$PW_ROTATED" "$PW_BEFORE" "Rotated chisel password differs from pre-rotation password" || true

# ---------------------------------------------------------------------------
log_section "6. Agent re-fetches /me/chisel-credential — sees rotated password"
# ---------------------------------------------------------------------------

ME_CHISEL_AFTER=$(host_exec "curl -skf --max-time 30 --cert ${AGENT_CERT_PATH} --key ${AGENT_KEY_PATH} --cacert /etc/lamalibre/lamaste/pki/ca.crt -H 'Accept: application/json' https://127.0.0.1:9292/api/agents/me/chisel-credential")
PW_AFTER=$(echo "$ME_CHISEL_AFTER" | jq -r '.password' 2>/dev/null || echo "")
assert_eq "$PW_AFTER" "$PW_ROTATED" "Agent's /me/chisel-credential returns the rotated password" || true
assert_not_eq "$PW_AFTER" "$PW_BEFORE" "Post-rotate /me/chisel-credential differs from the pre-rotation value" || true

end_test

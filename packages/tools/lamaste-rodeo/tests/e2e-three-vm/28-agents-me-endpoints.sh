#!/usr/bin/env bash
# ============================================================================
# 28 — Agents Me Endpoints (Three-VM)
# ============================================================================
# 28 — Agents /me/* self-service and chisel credential rotation (Three-VM)
#
# Covers the admin rotation, the credential's createdAt (also reported by
# agent-config as chiselCredentialIssuedAt, which is how an agent notices a
# replaced credential), and an agent rotating its own credential: refused with
# 429 while the current one is under 10 minutes old, accepted once it is older,
# and refused again right after.
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

# agent_curl <curl args...> — call the panel with the test agent's certificate
agent_curl() {
  host_exec "curl -sk --max-time 30 --cert ${AGENT_CERT_PATH} --key ${AGENT_KEY_PATH} --cacert /etc/lamalibre/lamaste/pki/ca.crt -H 'Accept: application/json' $*"
}

# backdate_credential <minutes> — make the test agent's chisel credential look
# <minutes> old in the panel's credential store, so the self-rotation rate
# limit can be exercised without waiting. Rewritten in place (cat >) so the
# file keeps its owner and 0600 mode; the temp copy is private (umask 077).
backdate_credential() {
  host_exec "umask 077; f=/etc/lamalibre/lamaste/chisel-credentials.json; t=\$(date -u -d '$1 minutes ago' +%Y-%m-%dT%H:%M:%S.000Z); jq --arg l '${AGENT_LABEL}' --arg t \"\$t\" '.[\$l].createdAt = \$t' \"\$f\" > /tmp/e2e-28-creds.json && cat /tmp/e2e-28-creds.json > \"\$f\"; rm -f /tmp/e2e-28-creds.json"
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

# ---------------------------------------------------------------------------
log_section "7. Credential issue time: /me/chisel-credential and agent-config"
# ---------------------------------------------------------------------------

ISSUED_AT=$(echo "$ME_CHISEL_AFTER" | jq -r '.createdAt // empty' 2>/dev/null || echo "")
assert_json_field_not_empty "$ME_CHISEL_AFTER" '.createdAt' "/me/chisel-credential returns createdAt" || true
assert_json_field "$ROTATE_RESPONSE" '.createdAt' "$ISSUED_AT" "Admin rotation's createdAt matches /me/chisel-credential" || true

AGENT_CONFIG=$(agent_curl "https://127.0.0.1:9292/api/tunnels/agent-config" 2>/dev/null || echo '{}')
assert_json_field "$AGENT_CONFIG" '.chiselCredentialIssuedAt' "$ISSUED_AT" "agent-config reports chiselCredentialIssuedAt = the credential's createdAt" || true
assert_not_contains "$AGENT_CONFIG" "$PW_AFTER" "agent-config never carries the chisel password" || true

# ---------------------------------------------------------------------------
log_section "8. Self-rotation is refused while the credential is fresh (429)"
# ---------------------------------------------------------------------------

# The admin rotation above issued the credential seconds ago
FRESH_ROTATE_STATUS=$(agent_curl "-o /tmp/e2e-28-rotate.json -w '%{http_code}' -X POST https://127.0.0.1:9292/api/agents/me/chisel-credential/rotate" 2>/dev/null || echo "000")
FRESH_ROTATE_BODY=$(host_exec "cat /tmp/e2e-28-rotate.json 2>/dev/null; rm -f /tmp/e2e-28-rotate.json" 2>/dev/null || echo '{}')
assert_eq "$FRESH_ROTATE_STATUS" "429" "Agent self-rotation within 10 minutes of issue returns 429" || true
assert_json_field "$FRESH_ROTATE_BODY" '.issuedAt' "$ISSUED_AT" "429 response names when the current credential was issued" || true
PW_AFTER_429=$(agent_curl "https://127.0.0.1:9292/api/agents/me/chisel-credential" 2>/dev/null | jq -r '.password' 2>/dev/null || echo "")
assert_eq "$PW_AFTER_429" "$PW_AFTER" "Refused self-rotation left the credential unchanged" || true

# ---------------------------------------------------------------------------
log_section "9. Self-rotation of a credential older than 10 minutes"
# ---------------------------------------------------------------------------

backdate_credential 11
BACKDATED_AT=$(agent_curl "https://127.0.0.1:9292/api/agents/me/chisel-credential" 2>/dev/null | jq -r '.createdAt' 2>/dev/null || echo "")
assert_not_eq "$BACKDATED_AT" "$ISSUED_AT" "Credential backdated by 11 minutes in the panel's store" || true

SELF_ROTATE=$(agent_curl "-X POST https://127.0.0.1:9292/api/agents/me/chisel-credential/rotate" 2>/dev/null || echo '{}')
assert_json_field_not_empty "$SELF_ROTATE" '.password' "Self-rotation returns a new password" || true
assert_contains "$(echo "$SELF_ROTATE" | jq -r '.user // empty' 2>/dev/null || echo "")" "$AGENT_LABEL" "Self-rotation returns the agent's chisel user" || true
assert_json_field_not_empty "$SELF_ROTATE" '.createdAt' "Self-rotation returns the new createdAt" || true
PW_SELF=$(echo "$SELF_ROTATE" | jq -r '.password' 2>/dev/null || echo "")
SELF_ISSUED_AT=$(echo "$SELF_ROTATE" | jq -r '.createdAt' 2>/dev/null || echo "")
assert_not_eq "$PW_SELF" "$PW_AFTER" "Self-rotated password differs from the previous one" || true

ME_AFTER_SELF=$(agent_curl "https://127.0.0.1:9292/api/agents/me/chisel-credential" 2>/dev/null || echo '{}')
assert_json_field "$ME_AFTER_SELF" '.password' "$PW_SELF" "/me/chisel-credential returns the self-rotated password" || true
CONFIG_AFTER_SELF=$(agent_curl "https://127.0.0.1:9292/api/tunnels/agent-config" 2>/dev/null || echo '{}')
assert_json_field "$CONFIG_AFTER_SELF" '.chiselCredentialIssuedAt' "$SELF_ISSUED_AT" "agent-config reports the new credential's issue time" || true

# The authfile carries the new password and no longer the old one (compared on
# the host; only counts come back)
AUTHFILE_KEYS=$(host_exec "jq -r --arg n 'agent-${AGENT_LABEL}:${PW_SELF}' --arg o 'agent-${AGENT_LABEL}:${PW_AFTER}' '[(keys[] | select(. == \$n)) | \"new\"] + [(keys[] | select(. == \$o)) | \"old\"] | join(\",\")' /etc/lamalibre/lamaste/chisel-users" 2>/dev/null || echo "error")
assert_eq "$AUTHFILE_KEYS" "new" "Chisel authfile holds the self-rotated password and not the replaced one" || true

# ---------------------------------------------------------------------------
log_section "10. An immediate second self-rotation is refused"
# ---------------------------------------------------------------------------

REPEAT_ROTATE_STATUS=$(agent_curl "-o /dev/null -w '%{http_code}' -X POST https://127.0.0.1:9292/api/agents/me/chisel-credential/rotate" 2>/dev/null || echo "000")
assert_eq "$REPEAT_ROTATE_STATUS" "429" "Repeating the self-rotation right away returns 429" || true
PW_FINAL=$(agent_curl "https://127.0.0.1:9292/api/agents/me/chisel-credential" 2>/dev/null | jq -r '.password' 2>/dev/null || echo "")
assert_eq "$PW_FINAL" "$PW_SELF" "Refused repeat left the self-rotated credential in place" || true

# The admin endpoint is not an agent's: an agent cert cannot rotate by label
ADMIN_ROUTE_STATUS=$(agent_curl "-o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{}' https://127.0.0.1:9292/api/agents/${AGENT_LABEL}/chisel-credential/rotate" 2>/dev/null || echo "000")
assert_eq "$ADMIN_ROUTE_STATUS" "403" "Agent cert cannot use the admin rotation route (403)" || true

end_test

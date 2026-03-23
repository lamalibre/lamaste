#!/usr/bin/env bash
# ============================================================================
# 16 — Hardware-Bound Certificate Enrollment
# ============================================================================
# Verifies the enrollment token system and CSR-based agent enrollment:
# - Token creation via POST /api/certs/agent/enroll
# - Public enrollment endpoint (POST /api/enroll) reachable without mTLS
# - Token validation: invalid, used, and expired tokens rejected
# - Enrolled agent appears in registry with enrollmentMethod: hardware-bound
# - Admin auth mode API
# - Admin upgrade to hardware-bound and P12 lockdown
# ============================================================================

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/helpers.sh"

require_commands curl jq openssl

begin_test "16 — Hardware-Bound Certificate Enrollment"

# ---------------------------------------------------------------------------
log_section "Pre-flight: check onboarding is complete"
# ---------------------------------------------------------------------------

ONBOARDING_STATUS=$(api_get "onboarding/status" | jq -r '.status' 2>/dev/null || echo "unknown")
if [ "$ONBOARDING_STATUS" != "COMPLETED" ]; then
  log_skip "Skipping enrollment tests — onboarding not complete"
  end_test
  exit $?
fi

TEMP_DIR=$(mktemp -d)
trap 'rm -rf "$TEMP_DIR"' EXIT

# ---------------------------------------------------------------------------
log_section "Admin auth mode defaults to p12"
# ---------------------------------------------------------------------------

AUTH_MODE_RESPONSE=$(api_get "certs/admin/auth-mode")
assert_json_field "$AUTH_MODE_RESPONSE" '.adminAuthMode' 'p12' "Admin auth mode is p12 by default" || true

# ---------------------------------------------------------------------------
log_section "Create enrollment token"
# ---------------------------------------------------------------------------

TOKEN_LABEL="e2e-enroll-$(date +%s)"

TOKEN_RESPONSE=$(api_post "certs/agent/enroll" "{\"label\":\"${TOKEN_LABEL}\",\"capabilities\":[\"tunnels:read\",\"tunnels:write\"]}")
assert_json_field "$TOKEN_RESPONSE" '.ok' 'true' "Token creation returns ok: true" || true

TOKEN=$(echo "$TOKEN_RESPONSE" | jq -r '.token' 2>/dev/null || echo "")
assert_not_eq "$TOKEN" "" "Token is not empty" || true

EXPIRES_AT=$(echo "$TOKEN_RESPONSE" | jq -r '.expiresAt' 2>/dev/null || echo "")
assert_not_eq "$EXPIRES_AT" "" "Token has expiresAt" || true

assert_json_field "$TOKEN_RESPONSE" '.label' "$TOKEN_LABEL" "Token response contains correct label" || true

# ---------------------------------------------------------------------------
log_section "Duplicate token for same label rejected"
# ---------------------------------------------------------------------------

DUP_STATUS=$(curl -s -o /dev/null -w '%{http_code}' \
  --max-time "$CURL_TIMEOUT" \
  --insecure \
  --cert "$CERT_PATH" \
  --key "$KEY_PATH" \
  --cacert "$CA_PATH" \
  -X POST \
  -H "Content-Type: application/json" \
  -d "{\"label\":\"${TOKEN_LABEL}\",\"capabilities\":[\"tunnels:read\"]}" \
  "${BASE_URL}/api/certs/agent/enroll" 2>/dev/null || echo "000")

assert_eq "$DUP_STATUS" "409" "Duplicate token for active label returns 409" || true

# ---------------------------------------------------------------------------
log_section "Public enrollment endpoint reachable without mTLS"
# ---------------------------------------------------------------------------

# Send a request WITHOUT a client certificate to the enrollment endpoint.
# With ssl_verify_client optional, the TLS handshake succeeds even without a cert.
# The endpoint should return 400 (validation error) or 401, not 000/496 (TLS rejection).
NO_CERT_ENROLL_STATUS=$(curl -s -o /dev/null -w '%{http_code}' \
  --max-time "$CURL_TIMEOUT" \
  --insecure \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"token":"invalid","csr":"invalid"}' \
  "${BASE_URL}/api/enroll" 2>/dev/null || echo "000")

# 400 = Zod validation failed (CSR not PEM), 401 = invalid token — both prove the endpoint is reachable
if [ "$NO_CERT_ENROLL_STATUS" = "400" ] || [ "$NO_CERT_ENROLL_STATUS" = "401" ]; then
  log_pass "Enrollment endpoint reachable without mTLS (HTTP $NO_CERT_ENROLL_STATUS)"
else
  log_fail "Enrollment endpoint not reachable without mTLS (HTTP $NO_CERT_ENROLL_STATUS — expected 400 or 401)"
fi

# ---------------------------------------------------------------------------
log_section "Enrollment with invalid token rejected"
# ---------------------------------------------------------------------------

# Generate a valid CSR for the enrollment test
openssl genrsa -out "$TEMP_DIR/agent.key" 2048 2>/dev/null
openssl req -new -key "$TEMP_DIR/agent.key" -out "$TEMP_DIR/agent.csr" \
  -subj "/CN=agent:pending/O=Portlama" 2>/dev/null
CSR_PEM=$(cat "$TEMP_DIR/agent.csr")

INVALID_TOKEN_RESPONSE=$(curl -s \
  --max-time "$CURL_TIMEOUT" \
  --insecure \
  -X POST \
  -H "Content-Type: application/json" \
  -d "{\"token\":\"0000000000000000000000000000000000000000000000000000000000000000\",\"csr\":$(echo "$CSR_PEM" | jq -Rs .)}" \
  "${BASE_URL}/api/enroll" 2>/dev/null || echo '{"error":"request failed"}')

assert_contains "$INVALID_TOKEN_RESPONSE" "Invalid enrollment token" "Invalid token rejected with correct message" || true

# ---------------------------------------------------------------------------
log_section "Enroll agent with valid token + CSR"
# ---------------------------------------------------------------------------

ENROLL_RESPONSE=$(curl -s \
  --max-time "$CURL_TIMEOUT" \
  --insecure \
  -X POST \
  -H "Content-Type: application/json" \
  -d "{\"token\":\"${TOKEN}\",\"csr\":$(echo "$CSR_PEM" | jq -Rs .)}" \
  "${BASE_URL}/api/enroll" 2>/dev/null || echo '{"error":"request failed"}')

assert_json_field "$ENROLL_RESPONSE" '.ok' 'true' "Enrollment returns ok: true" || true
assert_json_field "$ENROLL_RESPONSE" '.label' "$TOKEN_LABEL" "Enrolled label matches" || true

CERT_PEM=$(echo "$ENROLL_RESPONSE" | jq -r '.cert' 2>/dev/null || echo "")
assert_not_eq "$CERT_PEM" "" "Enrollment returns signed certificate" || true

CA_CERT_PEM=$(echo "$ENROLL_RESPONSE" | jq -r '.caCert' 2>/dev/null || echo "")
assert_not_eq "$CA_CERT_PEM" "" "Enrollment returns CA certificate" || true

SERIAL=$(echo "$ENROLL_RESPONSE" | jq -r '.serial' 2>/dev/null || echo "")
assert_not_eq "$SERIAL" "" "Enrollment returns serial number" || true

# Verify the signed cert has the correct CN
echo "$CERT_PEM" > "$TEMP_DIR/enrolled.crt"
CERT_SUBJECT=$(openssl x509 -in "$TEMP_DIR/enrolled.crt" -subject -noout 2>/dev/null || echo "unknown")
assert_contains "$CERT_SUBJECT" "agent:${TOKEN_LABEL}" "Signed cert has correct CN" || true

# ---------------------------------------------------------------------------
log_section "Token replay rejected (single-use)"
# ---------------------------------------------------------------------------

REPLAY_STATUS=$(curl -s -o /dev/null -w '%{http_code}' \
  --max-time "$CURL_TIMEOUT" \
  --insecure \
  -X POST \
  -H "Content-Type: application/json" \
  -d "{\"token\":\"${TOKEN}\",\"csr\":$(echo "$CSR_PEM" | jq -Rs .)}" \
  "${BASE_URL}/api/enroll" 2>/dev/null || echo "000")

assert_eq "$REPLAY_STATUS" "401" "Token replay returns 401" || true

# ---------------------------------------------------------------------------
log_section "Enrolled agent visible in agent list with hardware-bound method"
# ---------------------------------------------------------------------------

AGENTS_RESPONSE=$(api_get "certs/agent")
ENROLLED_METHOD=$(echo "$AGENTS_RESPONSE" | jq -r ".agents[] | select(.label==\"${TOKEN_LABEL}\") | .enrollmentMethod" 2>/dev/null || echo "unknown")
assert_eq "$ENROLLED_METHOD" "hardware-bound" "Agent shows enrollmentMethod: hardware-bound" || true

# ---------------------------------------------------------------------------
log_section "P12 download hidden for hardware-bound agent"
# ---------------------------------------------------------------------------

HW_DOWNLOAD_STATUS=$(curl -s -o /dev/null -w '%{http_code}' \
  --max-time "$CURL_TIMEOUT" \
  --insecure \
  --cert "$CERT_PATH" \
  --key "$KEY_PATH" \
  --cacert "$CA_PATH" \
  "${BASE_URL}/api/certs/agent/${TOKEN_LABEL}/download" 2>/dev/null || echo "000")

assert_eq "$HW_DOWNLOAD_STATUS" "404" "P12 download returns 404 for hardware-bound agent (no P12 on disk)" || true

# ---------------------------------------------------------------------------
log_section "Clean up: revoke test agent"
# ---------------------------------------------------------------------------

REVOKE_RESPONSE=$(api_delete "certs/agent/${TOKEN_LABEL}")
assert_json_field "$REVOKE_RESPONSE" '.ok' 'true' "Revoked enrollment test agent" || true

# ---------------------------------------------------------------------------
log_section "Admin upgrade to hardware-bound"
# ---------------------------------------------------------------------------

# Generate admin CSR
openssl genrsa -out "$TEMP_DIR/admin.key" 2048 2>/dev/null
openssl req -new -key "$TEMP_DIR/admin.key" -out "$TEMP_DIR/admin.csr" \
  -subj "/CN=admin/O=Portlama" 2>/dev/null
ADMIN_CSR_PEM=$(cat "$TEMP_DIR/admin.csr")

UPGRADE_RESPONSE=$(api_post "certs/admin/upgrade-to-hardware-bound" "{\"csr\":$(echo "$ADMIN_CSR_PEM" | jq -Rs .)}")
assert_json_field "$UPGRADE_RESPONSE" '.ok' 'true' "Admin upgrade returns ok: true" || true

UPGRADE_CERT=$(echo "$UPGRADE_RESPONSE" | jq -r '.cert' 2>/dev/null || echo "")
assert_not_eq "$UPGRADE_CERT" "" "Admin upgrade returns signed certificate" || true

# After admin upgrade, the old admin cert is revoked — subsequent mTLS API
# calls will fail at the nginx level. We verify the lockdown by checking that
# the old cert can no longer access P12 endpoints (connection failure = lockout).
# We skip the auth-mode check since it requires a valid admin cert.

log_section "P12 lockdown after admin upgrade"

ROTATE_LOCKDOWN_STATUS=$(curl -s -o /dev/null -w '%{http_code}' \
  --max-time "$CURL_TIMEOUT" \
  --insecure \
  --cert "$CERT_PATH" \
  --key "$KEY_PATH" \
  --cacert "$CA_PATH" \
  -X POST \
  "${BASE_URL}/api/certs/mtls/rotate" 2>/dev/null || echo "000")

# 410 = panel enforced lockdown, 000*/496 = old cert rejected at nginx (also proves lockdown)
if [ "$ROTATE_LOCKDOWN_STATUS" = "410" ] || [[ "$ROTATE_LOCKDOWN_STATUS" =~ ^0+$ ]] || [ "$ROTATE_LOCKDOWN_STATUS" = "496" ]; then
  log_pass "P12 rotation blocked after admin upgrade (HTTP $ROTATE_LOCKDOWN_STATUS)"
else
  log_fail "Unexpected status for P12 rotation lockdown: HTTP $ROTATE_LOCKDOWN_STATUS"
fi

# ---------------------------------------------------------------------------
log_section "Revert admin to P12 mode (for other tests)"
# ---------------------------------------------------------------------------

# Directly patch the config to revert — in real scenario this would be portlama-reset-admin
# We use the panel direct URL to bypass mTLS for this reset
# Actually we need to update the config file. Since this is a single-VM test,
# we can update panel.json directly.
PKI_DIR="/etc/portlama/pki"
PANEL_CONFIG="${PORTLAMA_CONFIG:-/etc/portlama/panel.json}"

# Regenerate a valid admin cert (the upgrade revoked the old one)
sudo openssl genrsa -out "${PKI_DIR}/client.key" 4096 2>/dev/null
sudo openssl req -new -key "${PKI_DIR}/client.key" -out "${PKI_DIR}/client.csr" \
  -subj "/CN=Portlama Client/O=Portlama" 2>/dev/null
sudo openssl x509 -req -in "${PKI_DIR}/client.csr" \
  -CA "${PKI_DIR}/ca.crt" -CAkey "${PKI_DIR}/ca.key" -CAcreateserial \
  -out "${PKI_DIR}/client.crt" -days 730 -sha256 2>/dev/null
sudo rm -f "${PKI_DIR}/client.csr" "${PKI_DIR}/ca.srl"
sudo chmod 600 "${PKI_DIR}/client.key"
sudo chmod 644 "${PKI_DIR}/client.crt"
sudo chown portlama:portlama "${PKI_DIR}/client.key" "${PKI_DIR}/client.crt"

# Clear revocation list (admin upgrade entries would block the new cert)
echo '{"revoked":[]}' | sudo tee "${PKI_DIR}/revoked.json" > /dev/null
sudo chown portlama:portlama "${PKI_DIR}/revoked.json"

# Revert adminAuthMode to p12
TMP_CONFIG=$(mktemp)
sudo jq '.adminAuthMode = "p12"' "$PANEL_CONFIG" > "$TMP_CONFIG"
sudo mv "$TMP_CONFIG" "$PANEL_CONFIG"
sudo chmod 640 "$PANEL_CONFIG"
sudo chown portlama:portlama "$PANEL_CONFIG"

# Reload nginx to pick up ssl_verify_client optional after any config changes
sudo nginx -t 2>/dev/null && sudo systemctl reload nginx 2>/dev/null || true

# Restart panel to pick up the new cert and config
sudo systemctl restart portlama-panel 2>/dev/null || true
sleep 3

log_pass "Reverted admin to P12 mode with fresh cert"

# Verify the revert
AUTH_MODE_REVERTED=$(api_get "certs/admin/auth-mode")
assert_json_field "$AUTH_MODE_REVERTED" '.adminAuthMode' 'p12' "Admin auth mode reverted to p12" || true

# ---------------------------------------------------------------------------
end_test

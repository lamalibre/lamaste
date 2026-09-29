#!/usr/bin/env bash
# ============================================================================
# 08 — Admin Certificate Rotation
# ============================================================================
# The panel does not issue admin certificates (B9): a compromised panel or
# plugin must not be able to mint one. Rotation is `lamaste-server
# reset-admin`, run as root on the server. Verifies:
# - POST /api/certs/mtls/rotate is refused (503) and points to reset-admin
# - reset-admin issues a new admin certificate and P12
# - the previous admin certificate is revoked: refused on the admin API
# - the new certificate works, and GET /api/certs/mtls/download serves it
# ============================================================================

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/helpers.sh"

require_commands curl jq openssl

begin_test "08 — Admin Certificate Rotation"

TEMP_DIR=$(mktemp -d)
trap 'rm -rf "$TEMP_DIR"' EXIT

# ---------------------------------------------------------------------------
log_section "Pre-flight: check onboarding is complete"
# ---------------------------------------------------------------------------

ONBOARDING_STATUS=$(api_get "onboarding/status" | jq -r '.status' 2>/dev/null || echo "unknown")
if [ "$ONBOARDING_STATUS" != "COMPLETED" ]; then
  log_skip "Skipping mTLS rotation tests — onboarding not complete"
  end_test
  exit $?
fi

# ---------------------------------------------------------------------------
log_section "Panel-side rotation is refused"
# ---------------------------------------------------------------------------

ROTATE_STATUS=$(api_post_status "certs/mtls/rotate")
assert_eq "$ROTATE_STATUS" "503" "POST /api/certs/mtls/rotate is refused with 503" || true
ROTATE_BODY=$(api_post "certs/mtls/rotate" 2>/dev/null || echo "{}")
assert_contains "$ROTATE_BODY" "reset-admin" "The refusal points to lamaste-server reset-admin" || true

# ---------------------------------------------------------------------------
log_section "reset-admin rotates the admin certificate"
# ---------------------------------------------------------------------------

# Keep the current certificate to prove it is revoked afterwards
sudo cp "$CERT_PATH" "$TEMP_DIR/old.crt"
sudo cp "$KEY_PATH" "$TEMP_DIR/old.key"
sudo chown "$(id -u):$(id -g)" "$TEMP_DIR/old.crt" "$TEMP_DIR/old.key"
OLD_FINGERPRINT=$(openssl x509 -fingerprint -sha256 -noout -in "$TEMP_DIR/old.crt" 2>/dev/null || echo "unknown")

RESET_OUTPUT=$(sudo lamaste-server reset-admin --json 2>&1 || true)
assert_contains "$RESET_OUTPUT" '"step":"revoke-old","status":"complete"' "reset-admin revoked the previous certificate" || true
assert_contains "$RESET_OUTPUT" '"event":"complete"' "reset-admin completed" || true

NEW_FINGERPRINT=$(sudo openssl x509 -fingerprint -sha256 -noout -in "$CERT_PATH" 2>/dev/null || echo "unknown")
assert_not_eq "$NEW_FINGERPRINT" "$OLD_FINGERPRINT" "A new admin certificate is installed" || true

# reset-admin restarts the panel
for _ in $(seq 1 30); do
  [ "$(api_get "health" 2>/dev/null | jq -r '.status' 2>/dev/null || echo "")" = "ok" ] && break
  sleep 2
done

# ---------------------------------------------------------------------------
log_section "The old certificate is revoked, the new one works"
# ---------------------------------------------------------------------------

OLD_STATUS=$(curl -sk -o /dev/null -w '%{http_code}' --max-time "$CURL_TIMEOUT" \
  --cert "$TEMP_DIR/old.crt" --key "$TEMP_DIR/old.key" --cacert "$CA_PATH" \
  "${BASE_URL}/api/tunnels" 2>/dev/null || echo "000")
assert_eq "$OLD_STATUS" "403" "The previous admin certificate is refused on the admin API" || true

NEW_STATUS=$(_curl_mtls -o /dev/null -w '%{http_code}' "${BASE_URL}/api/tunnels" 2>/dev/null || echo "000")
assert_eq "$NEW_STATUS" "200" "The new admin certificate is accepted" || true

# ---------------------------------------------------------------------------
log_section "The P12 download serves the new certificate"
# ---------------------------------------------------------------------------

P12_FILE="$TEMP_DIR/client.p12"
P12_PASSWORD=$(sudo cat /etc/lamalibre/lamaste/pki/.p12-password 2>/dev/null || echo "")
assert_not_eq "$P12_PASSWORD" "" "reset-admin stored the P12 password" || true
HTTP_STATUS=$(_curl_mtls -o "$P12_FILE" -w '%{http_code}' "${BASE_URL}/api/certs/mtls/download" 2>/dev/null || echo "000")
assert_eq "$HTTP_STATUS" "200" "Downloaded client.p12 (HTTP 200)" || true
P12_FINGERPRINT=$(openssl pkcs12 -in "$P12_FILE" -clcerts -nokeys -passin "pass:${P12_PASSWORD}" 2>/dev/null \
  | openssl x509 -fingerprint -sha256 -noout 2>/dev/null || echo "unreadable")
assert_eq "$P12_FINGERPRINT" "$NEW_FINGERPRINT" "The P12 holds the new certificate" || true

end_test

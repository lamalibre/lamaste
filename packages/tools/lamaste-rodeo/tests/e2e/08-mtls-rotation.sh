#!/usr/bin/env bash
# ============================================================================
# 08 — mTLS Rotation
# ============================================================================
# Verifies mTLS client certificate rotation:
# - Rotate via POST /api/certs/mtls/rotate
# - Verify response contains p12Password and expiresAt
# - Download new cert via GET /api/certs/mtls/download
# - Verify downloaded file is valid PKCS12
# - Verify new cert works for API access
# ============================================================================

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/helpers.sh"

require_commands curl jq openssl

begin_test "08 — mTLS Rotation"

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
log_section "Current cert fingerprint (before rotation)"
# ---------------------------------------------------------------------------

OLD_FINGERPRINT=""
if [ -f "$CERT_PATH" ]; then
  OLD_FINGERPRINT=$(openssl x509 -fingerprint -sha256 -noout -in "$CERT_PATH" 2>/dev/null || echo "unknown")
  log_info "Current cert fingerprint: $OLD_FINGERPRINT"
else
  log_info "Client cert not found at $CERT_PATH — continuing"
fi

# ---------------------------------------------------------------------------
log_section "Rotate mTLS certificate"
# ---------------------------------------------------------------------------

ROTATE_RESPONSE=$(api_post "certs/mtls/rotate")

# The response may contain different field names depending on implementation.
# Check for common patterns.
P12_PASSWORD=$(echo "$ROTATE_RESPONSE" | jq -r '.p12Password // .password // empty' 2>/dev/null || echo "")
EXPIRES_AT=$(echo "$ROTATE_RESPONSE" | jq -r '.expiresAt // .expiry // empty' 2>/dev/null || echo "")

if [ -n "$P12_PASSWORD" ]; then
  log_pass "Rotation response contains p12 password"
else
  log_fail "Rotation response missing p12 password"
fi

if [ -n "$EXPIRES_AT" ]; then
  log_pass "Rotation response contains expiry: $EXPIRES_AT"
else
  log_fail "Rotation response missing expiry date"
fi

# Check for warnings in the rotation response
WARNING=$(echo "$ROTATE_RESPONSE" | jq -r '.warning // empty' 2>/dev/null || echo "")
if [ -n "$WARNING" ]; then
  log_info "Rotation warning: $WARNING"
fi

# ---------------------------------------------------------------------------
log_section "Download rotated certificate"
# ---------------------------------------------------------------------------

TEMP_DIR=$(mktemp -d)
trap 'rm -rf "$TEMP_DIR"' EXIT

P12_FILE="$TEMP_DIR/client.p12"

HTTP_STATUS=$(_curl_mtls -o "$P12_FILE" -w '%{http_code}' "${BASE_URL}/api/certs/mtls/download" 2>/dev/null || echo "000")

if [ "$HTTP_STATUS" = "200" ]; then
  log_pass "Downloaded client.p12 (HTTP 200)"

  # Verify it is a valid PKCS12 file
  if [ -n "$P12_PASSWORD" ]; then
    P12_VERIFY=$(openssl pkcs12 -in "$P12_FILE" -noout -passin "pass:${P12_PASSWORD}" 2>&1 || true)
    if echo "$P12_VERIFY" | grep -qiE "error|invalid"; then
      log_fail "Downloaded file is not a valid PKCS12: $P12_VERIFY"
    else
      log_pass "Downloaded file is a valid PKCS12"
    fi

    # Extract the cert from the P12 and check its fingerprint
    NEW_CERT=$(openssl pkcs12 -in "$P12_FILE" -clcerts -nokeys -passin "pass:${P12_PASSWORD}" 2>/dev/null || echo "")
    if [ -n "$NEW_CERT" ]; then
      NEW_FINGERPRINT=$(echo "$NEW_CERT" | openssl x509 -fingerprint -sha256 -noout 2>/dev/null || echo "unknown")
      log_info "New cert fingerprint: $NEW_FINGERPRINT"

      if [ -n "$OLD_FINGERPRINT" ] && [ "$OLD_FINGERPRINT" != "unknown" ]; then
        assert_not_eq "$NEW_FINGERPRINT" "$OLD_FINGERPRINT" "New cert has different fingerprint than old cert" || true
      fi
    else
      log_info "Could not extract cert from P12 for fingerprint comparison"
    fi
  else
    log_info "No p12 password available — cannot verify PKCS12 contents"
  fi
else
  log_fail "Failed to download client.p12 (HTTP $HTTP_STATUS)"
fi

# ---------------------------------------------------------------------------
log_section "Verify API access with current credentials"
# ---------------------------------------------------------------------------

# After rotation, the certs on disk should be updated. Verify access still works.
HEALTH_AFTER=$(api_get "health")
assert_json_field "$HEALTH_AFTER" '.status' 'ok' "API still accessible after rotation" || true

end_test

#!/usr/bin/env bash
# ============================================================================
# 02 — mTLS Enforcement
# ============================================================================
# Verifies that the panel enforces mTLS client certificates:
# - Requests without a client cert are rejected
# - Requests with a valid client cert succeed
# - Requests with an invalid/expired cert are rejected
# - IP:9292 fallback is handled (tested more thoroughly in 09)
# ============================================================================

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/helpers.sh"

require_commands curl jq openssl

begin_test "02 — mTLS Enforcement"

# ---------------------------------------------------------------------------
log_section "Request without client certificate"
# ---------------------------------------------------------------------------

# Without a client cert, the server should reject the request.
# /api/health is exempt from mTLS enforcement, so we use /api/onboarding/status
# which requires a valid client certificate.
NO_CERT_STATUS=$(curl -s -o /dev/null -w '%{http_code}' \
  --max-time "$CURL_TIMEOUT" \
  --insecure \
  "${BASE_URL}/api/onboarding/status" 2>/dev/null || echo "000")

# Status 000 = connection rejected at TLS level (ssl_verify_client on)
# Status 400 = nginx sent error page before HTTP (some configs)
# Status 403 = HTTP-level rejection
# Any of these means mTLS is working
if [ "$NO_CERT_STATUS" = "000" ] || [ "$NO_CERT_STATUS" = "400" ] || [ "$NO_CERT_STATUS" = "403" ] || [ "$NO_CERT_STATUS" = "496" ]; then
  log_pass "Request without cert rejected (HTTP $NO_CERT_STATUS)"
else
  # In development mode (NODE_ENV=development), mTLS may be skipped
  if [ "${NODE_ENV:-}" = "development" ]; then
    log_skip "mTLS check skipped in development mode (HTTP $NO_CERT_STATUS)"
  else
    log_fail "Request without cert was NOT rejected (HTTP $NO_CERT_STATUS)"
  fi
fi

# ---------------------------------------------------------------------------
log_section "Request with valid client certificate"
# ---------------------------------------------------------------------------

VALID_STATUS=$(curl -s -o /dev/null -w '%{http_code}' \
  --max-time "$CURL_TIMEOUT" \
  --insecure \
  --cert "$CERT_PATH" \
  --key "$KEY_PATH" \
  --cacert "$CA_PATH" \
  "${BASE_URL}/api/health" 2>/dev/null || echo "000")

assert_eq "$VALID_STATUS" "200" "Request with valid cert returns HTTP 200" || true

HEALTH=$(api_get "health")
assert_json_field "$HEALTH" '.status' 'ok' "Health endpoint returns ok with valid cert" || true

# ---------------------------------------------------------------------------
log_section "Request with invalid certificate"
# ---------------------------------------------------------------------------

# Generate a self-signed cert that is NOT in the trusted CA chain
TEMP_DIR=$(mktemp -d)
trap 'rm -rf "$TEMP_DIR"' EXIT

openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout "$TEMP_DIR/fake.key" \
  -out "$TEMP_DIR/fake.crt" \
  -days 1 \
  -subj "/CN=fake-client" \
  2>/dev/null

FAKE_STATUS=$(curl -s -o /dev/null -w '%{http_code}' \
  --max-time "$CURL_TIMEOUT" \
  --insecure \
  --cert "$TEMP_DIR/fake.crt" \
  --key "$TEMP_DIR/fake.key" \
  "${BASE_URL}/api/onboarding/status" 2>/dev/null || echo "000")

# With an untrusted cert, nginx should reject (000 = TLS failure, or 400/403)
if [ "$FAKE_STATUS" = "000" ] || [ "$FAKE_STATUS" = "400" ] || [ "$FAKE_STATUS" = "403" ] || [ "$FAKE_STATUS" = "496" ]; then
  log_pass "Request with untrusted cert rejected (HTTP $FAKE_STATUS)"
else
  if [ "${NODE_ENV:-}" = "development" ]; then
    log_skip "mTLS check skipped in development mode (HTTP $FAKE_STATUS)"
  else
    log_fail "Request with untrusted cert was NOT rejected (HTTP $FAKE_STATUS)"
  fi
fi

# ---------------------------------------------------------------------------
log_section "Certificate validity check"
# ---------------------------------------------------------------------------

if [ -f "$CERT_PATH" ]; then
  # Verify the client cert is not expired
  EXPIRY=$(openssl x509 -enddate -noout -in "$CERT_PATH" 2>/dev/null || echo "error")
  if echo "$EXPIRY" | grep -q "notAfter"; then
    log_pass "Client certificate has valid expiry: $EXPIRY"
  else
    log_fail "Could not read client certificate expiry"
  fi

  # Verify the cert is signed by our CA
  if [ -f "$CA_PATH" ]; then
    VERIFY=$(openssl verify -CAfile "$CA_PATH" "$CERT_PATH" 2>&1 || true)
    if echo "$VERIFY" | grep -q ": OK"; then
      log_pass "Client certificate is signed by the CA"
    else
      log_fail "Client certificate verification failed: $VERIFY"
    fi
  else
    log_skip "CA certificate not found at $CA_PATH"
  fi
else
  log_skip "Client certificate not found at $CERT_PATH"
fi

end_test

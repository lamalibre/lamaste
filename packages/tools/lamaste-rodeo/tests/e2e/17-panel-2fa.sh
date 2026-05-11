#!/usr/bin/env bash
# ============================================================================
# 17 — Panel Built-in TOTP 2FA
# ============================================================================
# Verifies the built-in TOTP two-factor authentication for the admin panel:
# - Default state: 2FA disabled
# - Setup flow: generate secret, confirm with TOTP code
# - IP vhost disabled after enabling 2FA
# - Requests without session return 401 2fa_required
# - Authenticated requests succeed with cookie
# - Disable flow restores IP vhost
# - Reset admin clears 2FA
# - Rate limiting on wrong codes (tested last — bans the IP)
#
# IMPORTANT: This test always runs lamaste-reset-admin at the end to ensure
# clean state for subsequent tests.
# ============================================================================

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/helpers.sh"

require_commands curl jq node openssl

begin_test "17 — Panel Built-in TOTP 2FA"

# ---------------------------------------------------------------------------
# Helper: generate TOTP code from a base32 secret
# ---------------------------------------------------------------------------
generate_totp_code() {
  local secret="$1"
  node -e "
const crypto = require('crypto');
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32Decode(encoded) {
  const stripped = encoded.replace(/=+\$/, '').toUpperCase();
  let bits = 0, value = 0;
  const output = [];
  for (let i = 0; i < stripped.length; i++) {
    const idx = alphabet.indexOf(stripped[i]);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) { output.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(output);
}
const key = base32Decode('${secret}');
const timeStep = Math.floor(Date.now() / 30000);
const timeBuffer = Buffer.alloc(8);
timeBuffer.writeUInt32BE(Math.floor(timeStep / 0x100000000), 0);
timeBuffer.writeUInt32BE(timeStep >>> 0, 4);
const hmac = crypto.createHmac('sha1', key).update(timeBuffer).digest();
const offset = hmac[hmac.length - 1] & 0x0f;
const code = ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff);
console.log(String(code % 1000000).padStart(6, '0'));
" 2>/dev/null
}

# ---------------------------------------------------------------------------
# Helper: wait until we're in a fresh TOTP time window (avoids replay)
# ---------------------------------------------------------------------------
wait_for_next_totp_window() {
  local now
  now=$(date +%s)
  local sleep_time=$(( 31 - (now % 30) ))
  log_info "Waiting ${sleep_time}s for next TOTP window..."
  sleep "$sleep_time"
}

# ---------------------------------------------------------------------------
# Cleanup: always restore state at end (trap ensures this runs even on failure)
# ---------------------------------------------------------------------------
cleanup_2fa() {
  # Run lamaste-server reset-admin to ensure 2FA is disabled and IP vhost is restored
  if command -v lamaste-server &>/dev/null; then
    sudo lamaste-server reset-admin >/dev/null 2>&1 || true
  elif command -v lamaste-reset-admin &>/dev/null; then
    sudo lamaste-reset-admin >/dev/null 2>&1 || true
  else
    sudo node /opt/lamalibre/lamaste/serverd/src/cli/reset-admin.js >/dev/null 2>&1 || true
  fi
  sudo systemctl restart lamalibre-lamaste-serverd >/dev/null 2>&1 || true
  sleep 2
}
trap cleanup_2fa EXIT

# ---------------------------------------------------------------------------
log_section "Pre-flight: check onboarding is complete"
# ---------------------------------------------------------------------------

ONBOARDING_STATUS=$(api_get "onboarding/status" | jq -r '.status' 2>/dev/null || echo "unknown")
if [ "$ONBOARDING_STATUS" != "COMPLETED" ]; then
  log_skip "Skipping 2FA tests — onboarding not complete"
  end_test
  exit $?
fi

# Check if domain is configured (needed for 2FA)
DOMAIN=$(api_get "onboarding/status" | jq -r '.domain' 2>/dev/null || echo "null")
if [ "$DOMAIN" = "null" ] || [ -z "$DOMAIN" ]; then
  log_skip "Skipping 2FA tests — domain not configured"
  end_test
  exit $?
fi

DOMAIN_URL="https://panel.${DOMAIN}"

# ---------------------------------------------------------------------------
log_section "Default state: 2FA disabled"
# ---------------------------------------------------------------------------

STATUS_RESPONSE=$(api_get "settings/2fa")
assert_json_field "$STATUS_RESPONSE" '.enabled' 'false' "2FA is disabled by default" || true
assert_json_field "$STATUS_RESPONSE" '.setupComplete' 'false' "setupComplete is false by default" || true

# ---------------------------------------------------------------------------
log_section "Setup: generate TOTP secret"
# ---------------------------------------------------------------------------

SETUP_RESPONSE=$(api_post "settings/2fa/setup")
TOTP_URI=$(echo "$SETUP_RESPONSE" | jq -r '.uri' 2>/dev/null || echo "")
MANUAL_KEY=$(echo "$SETUP_RESPONSE" | jq -r '.manualKey' 2>/dev/null || echo "")

assert_not_eq "$TOTP_URI" "" "Setup returns otpauth URI" || true
assert_not_eq "$MANUAL_KEY" "" "Setup returns manual key" || true
assert_contains "$TOTP_URI" "otpauth://totp/" "URI is valid otpauth format" || true

# ---------------------------------------------------------------------------
log_section "Confirm 2FA with valid code"
# ---------------------------------------------------------------------------

TOTP_CODE=$(generate_totp_code "$MANUAL_KEY")
assert_not_eq "$TOTP_CODE" "" "Generated TOTP code" || true
log_info "Generated TOTP code: ${TOTP_CODE}"

# Use raw curl to capture the Set-Cookie header
CONFIRM_HEADERS=$(mktemp)
CONFIRM_BODY=$(_curl_mtls \
  -D "$CONFIRM_HEADERS" \
  -X POST \
  -H "Content-Type: application/json" \
  -d "{\"code\":\"${TOTP_CODE}\"}" \
  "${BASE_URL}/api/settings/2fa/confirm" 2>/dev/null)

assert_json_field "$CONFIRM_BODY" '.enabled' 'true' "2FA is now enabled" || true

# Extract session cookie
SESSION_COOKIE=$(grep -i 'set-cookie' "$CONFIRM_HEADERS" | grep 'lamaste_2fa_session' | head -1 | sed 's/.*lamaste_2fa_session=//;s/;.*//')
rm -f "$CONFIRM_HEADERS"

assert_not_eq "${SESSION_COOKIE:-}" "" "Session cookie received on confirm" || true

# Verify status reflects enabled (settings/2fa is exempt from 2FA middleware)
STATUS_AFTER=$(api_get "settings/2fa")
assert_json_field "$STATUS_AFTER" '.enabled' 'true' "Status shows enabled after confirm" || true

# ---------------------------------------------------------------------------
log_section "IP vhost disabled after enabling 2FA"
# ---------------------------------------------------------------------------

# Wait for nginx reload to take effect
sleep 2

IP_STATUS=$(curl -s -o /dev/null -w '%{http_code}' \
  --max-time 5 \
  --insecure \
  --cert "$CERT_PATH" \
  --key "$KEY_PATH" \
  "https://127.0.0.1:9292/api/health" 2>/dev/null) || true

if [ "$IP_STATUS" = "000" ] || [ "$IP_STATUS" = "502" ]; then
  log_pass "IP:9292 vhost is disabled (HTTP $IP_STATUS)"
else
  log_fail "IP:9292 vhost should be disabled, got HTTP $IP_STATUS"
fi

# ---------------------------------------------------------------------------
log_section "Request without session returns 401 2fa_required"
# ---------------------------------------------------------------------------

NO_SESSION_STATUS=$(curl -s -o /dev/null -w '%{http_code}' \
  --max-time "$CURL_TIMEOUT" \
  --insecure \
  --cert "$CERT_PATH" \
  --key "$KEY_PATH" \
  "${DOMAIN_URL}/api/system/stats" 2>/dev/null || echo "000")

if [ "$NO_SESSION_STATUS" = "401" ]; then
  log_pass "Request without session cookie returns 401"
elif [ "$NO_SESSION_STATUS" = "000" ]; then
  log_skip "Domain unreachable — cannot verify 2FA enforcement"
else
  log_fail "Expected 401 without session, got HTTP $NO_SESSION_STATUS"
fi

# ---------------------------------------------------------------------------
log_section "Authenticated request with session cookie"
# ---------------------------------------------------------------------------

if [ -n "${SESSION_COOKIE:-}" ]; then
  AUTH_RESPONSE=$(curl -s \
    --max-time "$CURL_TIMEOUT" \
    --insecure \
    --cert "$CERT_PATH" \
    --key "$KEY_PATH" \
    --cacert "$CA_PATH" \
    -H "Accept: application/json" \
    -b "lamaste_2fa_session=${SESSION_COOKIE}" \
    "${DOMAIN_URL}/api/system/stats" 2>/dev/null || echo '{}')

  if echo "$AUTH_RESPONSE" | jq -e '.cpu' &>/dev/null; then
    log_pass "Authenticated request with session cookie returns system stats"
  elif [ "$NO_SESSION_STATUS" = "000" ]; then
    log_skip "Domain unreachable — cannot verify authenticated request"
  else
    log_fail "Authenticated request failed: $(echo "$AUTH_RESPONSE" | jq -r '.error // "unexpected response"')"
  fi
else
  log_skip "No session cookie available — skipping authenticated request test"
fi

# ---------------------------------------------------------------------------
log_section "Disable 2FA"
# ---------------------------------------------------------------------------

# Wait for next TOTP window to avoid replay protection from the confirm code
wait_for_next_totp_window

DISABLE_CODE=$(generate_totp_code "$MANUAL_KEY")

# Need a valid session cookie for disable (session from confirm is still valid)
DISABLE_BODY=$(curl -s \
  --max-time "$CURL_TIMEOUT" \
  --insecure \
  --cert "$CERT_PATH" \
  --key "$KEY_PATH" \
  --cacert "$CA_PATH" \
  -X POST \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -b "lamaste_2fa_session=${SESSION_COOKIE}" \
  -d "{\"code\":\"${DISABLE_CODE}\"}" \
  "${DOMAIN_URL}/api/settings/2fa/disable" 2>/dev/null || echo '{}')

if echo "$DISABLE_BODY" | jq -e 'has("enabled")' &>/dev/null; then
  DISABLE_ENABLED=$(echo "$DISABLE_BODY" | jq -r '.enabled')
  if [ "$DISABLE_ENABLED" = "false" ]; then
    log_pass "2FA disabled successfully"
  else
    log_fail "Expected enabled=false after disable, got enabled=$DISABLE_ENABLED"
  fi
else
  log_fail "Failed to disable 2FA: $(echo "$DISABLE_BODY" | jq -r '.error // "domain unreachable"')"
fi

# ---------------------------------------------------------------------------
log_section "IP vhost re-enabled after disabling 2FA"
# ---------------------------------------------------------------------------

# Wait for nginx reload
sleep 2

IP_STATUS_AFTER=$(curl -s -o /dev/null -w '%{http_code}' \
  --max-time 5 \
  --insecure \
  --cert "$CERT_PATH" \
  --key "$KEY_PATH" \
  "${BASE_URL}/api/health" 2>/dev/null || echo "000")

if [ "$IP_STATUS_AFTER" = "200" ]; then
  log_pass "IP:9292 vhost is re-enabled after disabling 2FA"
else
  log_fail "IP:9292 vhost should be re-enabled, got HTTP $IP_STATUS_AFTER"
fi

# Verify 2FA status is off
FINAL_STATUS=$(api_get "settings/2fa")
assert_json_field "$FINAL_STATUS" '.enabled' 'false' "2FA status is disabled" || true

# ---------------------------------------------------------------------------
log_section "Reset admin clears 2FA"
# ---------------------------------------------------------------------------

# Re-enable 2FA for reset test
SETUP2_RESPONSE=$(api_post "settings/2fa/setup")
MANUAL_KEY2=$(echo "$SETUP2_RESPONSE" | jq -r '.manualKey' 2>/dev/null || echo "")

if [ -n "$MANUAL_KEY2" ] && [ "$MANUAL_KEY2" != "null" ]; then
  CONFIRM2_CODE=$(generate_totp_code "$MANUAL_KEY2")

  CONFIRM2_BODY=$(api_post "settings/2fa/confirm" "{\"code\":\"${CONFIRM2_CODE}\"}")
  if echo "$CONFIRM2_BODY" | jq -e '.enabled' &>/dev/null && [ "$(echo "$CONFIRM2_BODY" | jq -r '.enabled')" = "true" ]; then
    log_pass "2FA re-enabled for reset test"

    # Run reset-admin
    if command -v lamaste-server &>/dev/null; then
      sudo lamaste-server reset-admin 2>&1 | tail -5 || true
    elif command -v lamaste-reset-admin &>/dev/null; then
      sudo lamaste-reset-admin 2>&1 | tail -5 || true
    else
      sudo node /opt/lamalibre/lamaste/serverd/src/cli/reset-admin.js 2>&1 | tail -5 || true
    fi

    # Wait for config reload and nginx — restart panel to pick up config changes
    sudo systemctl restart lamalibre-lamaste-serverd 2>/dev/null || true
    sleep 3

    RESET_STATUS=$(api_get "settings/2fa")
    assert_json_field "$RESET_STATUS" '.enabled' 'false' "2FA disabled after reset-admin" || true

    # IP vhost should be back
    IP_RESET_STATUS=$(curl -s -o /dev/null -w '%{http_code}' \
      --max-time 5 \
      --insecure \
      --cert "$CERT_PATH" \
      --key "$KEY_PATH" \
      "${BASE_URL}/api/health" 2>/dev/null) || true

    if [ "$IP_RESET_STATUS" = "200" ]; then
      log_pass "IP vhost restored after reset-admin"
    else
      log_fail "IP vhost should be restored after reset-admin, got HTTP $IP_RESET_STATUS"
    fi
  else
    log_fail "Failed to re-enable 2FA for reset test"
  fi
else
  log_skip "Could not re-setup 2FA for reset test"
fi

# ---------------------------------------------------------------------------
log_section "Rate limiting on wrong codes"
# ---------------------------------------------------------------------------

# Rate limiting is tested last because it bans the IP for 5 minutes.
# 2FA must be enabled for the verify endpoint to reach the rate limit code.
RATE_SETUP=$(api_post "settings/2fa/setup")
RATE_KEY=$(echo "$RATE_SETUP" | jq -r '.manualKey' 2>/dev/null || echo "")
if [ -n "$RATE_KEY" ] && [ "$RATE_KEY" != "null" ]; then
  RATE_CODE=$(generate_totp_code "$RATE_KEY")
  api_post "settings/2fa/confirm" "{\"code\":\"${RATE_CODE}\"}" >/dev/null 2>&1

  # Wait for nginx reload (IP vhost disabled), use domain URL
  sleep 2

  WRONG_COUNT=0
  for i in $(seq 1 6); do
    WRONG_STATUS=$(curl -s -o /dev/null -w '%{http_code}' \
      --max-time "$CURL_TIMEOUT" \
      --insecure \
      --cert "$CERT_PATH" \
      --key "$KEY_PATH" \
      --cacert "$CA_PATH" \
      -X POST \
      -H "Content-Type: application/json" \
      -d '{"code":"000000"}' \
      "${DOMAIN_URL}/api/settings/2fa/verify" 2>/dev/null) || true

    if [ "$WRONG_STATUS" = "429" ]; then
      WRONG_COUNT=$i
      break
    fi
  done

  if [ "$WRONG_COUNT" -gt 0 ]; then
    log_pass "Rate limiting kicks in after $WRONG_COUNT wrong attempts (HTTP 429)"
  else
    log_fail "Rate limiting not triggered after 6 wrong attempts"
  fi
else
  log_skip "Could not enable 2FA for rate limit test"
fi

end_test
exit $?

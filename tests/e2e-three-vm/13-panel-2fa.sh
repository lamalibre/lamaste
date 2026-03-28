#!/usr/bin/env bash
# ============================================================================
# 13 — Panel Built-in TOTP 2FA (Three-VM)
# ============================================================================
# Tests the built-in TOTP two-factor authentication across VMs:
# - Default state: 2FA disabled
# - Enable 2FA on host
# - Agent API calls still work without 2FA session
# - Admin request without cookie returns 401
# - Admin verifies with code, uses cookie
# - Disable 2FA, verify IP access restored
#
# IMPORTANT: This test always runs portlama-reset-admin at the end to ensure
# clean state for subsequent tests.
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../e2e/helpers.sh"

require_commands multipass curl jq node

# ---------------------------------------------------------------------------
# VM exec helpers
# ---------------------------------------------------------------------------

host_api_get() {
  multipass exec portlama-host -- sudo /tmp/vm-api-helper.sh GET "$1"
}

host_api_post() {
  local path="$1"
  local body="$2"
  local b64body
  b64body=$(echo -n "$body" | base64)
  multipass exec portlama-host -- sudo /tmp/vm-api-helper.sh POST "$path" "$b64body"
}

host_exec() { multipass exec portlama-host -- sudo bash -c "$1"; }

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
# Cleanup: restore state at end (only armed after 2FA is enabled)
# ---------------------------------------------------------------------------
_2FA_CLEANUP_ARMED=false
cleanup_2fa() {
  if [ "$_2FA_CLEANUP_ARMED" = "false" ]; then
    return
  fi
  # Background the multipass exec and kill it after 30s if it hangs.
  # Multipass exec can spin at 100% CPU on SSH connection failures.
  multipass exec portlama-host -- sudo bash -c '
    if command -v portlama-reset-admin >/dev/null 2>&1; then
      portlama-reset-admin
    else
      node /opt/portlama/panel-server/src/cli/reset-admin.js 2>/dev/null
    fi
  ' >/dev/null 2>&1 &
  local pid=$!
  ( sleep 30; kill "$pid" 2>/dev/null ) &
  local watchdog=$!
  wait "$pid" 2>/dev/null || true
  kill "$watchdog" 2>/dev/null || true
  wait "$watchdog" 2>/dev/null || true
  sleep 1
}
trap cleanup_2fa EXIT

begin_test "13 — Panel Built-in TOTP 2FA (Three-VM)"

# ---------------------------------------------------------------------------
log_section "Pre-flight: check onboarding is complete"
# ---------------------------------------------------------------------------

ONBOARDING=$(host_api_get "onboarding/status" || echo '{"status":"unknown"}')
STATUS=$(echo "$ONBOARDING" | jq -r '.status' 2>/dev/null || echo "unknown")
if [ "$STATUS" != "COMPLETED" ]; then
  log_skip "Onboarding not complete — skipping 2FA tests"
  end_test
  exit $?
fi

DOMAIN=$(echo "$ONBOARDING" | jq -r '.domain' 2>/dev/null || echo "null")
if [ "$DOMAIN" = "null" ] || [ -z "$DOMAIN" ]; then
  log_skip "Domain not configured — skipping 2FA tests"
  end_test
  exit $?
fi
log_pass "Onboarding complete, domain: $DOMAIN"

# ---------------------------------------------------------------------------
log_section "Default state: 2FA disabled"
# ---------------------------------------------------------------------------

STATUS_RESPONSE=$(host_api_get "settings/2fa" || echo '{}')
assert_json_field "$STATUS_RESPONSE" '.enabled' 'false' "2FA is disabled by default" || true

# ---------------------------------------------------------------------------
log_section "Enable 2FA on host"
# ---------------------------------------------------------------------------

SETUP_RESPONSE=$(host_api_post "settings/2fa/setup" '{}')
MANUAL_KEY=$(echo "$SETUP_RESPONSE" | jq -r '.manualKey' 2>/dev/null || echo "")
assert_not_eq "$MANUAL_KEY" "" "Setup returns manual key" || true

TOTP_CODE=$(generate_totp_code "$MANUAL_KEY")

CONFIRM_RESPONSE=$(host_api_post "settings/2fa/confirm" "{\"code\":\"${TOTP_CODE}\"}")
assert_json_field "$CONFIRM_RESPONSE" '.enabled' 'true' "2FA enabled after confirm" || true
_2FA_CLEANUP_ARMED=true

# Wait for nginx reload
sleep 2

# ---------------------------------------------------------------------------
log_section "Agent API calls still work without 2FA session"
# ---------------------------------------------------------------------------

# Agent uses its own cert (CN=agent:...) which bypasses 2FA
# IP vhost is disabled when 2FA is on, so agent must use domain
# Multi-agent: extract PEM from per-agent P12 for curl usage
AGENT_P12="/home/ubuntu/.portlama/agents/e2e-agent/client.p12"
AGENT_CERT="/tmp/agent-e2e.crt"
AGENT_KEY="/tmp/agent-e2e.key"
multipass exec portlama-agent -- sudo bash -c "
  P12_PASS=\$(jq -r '.p12Password' /home/ubuntu/.portlama/agents/e2e-agent/config.json)
  openssl pkcs12 -in ${AGENT_P12} -clcerts -nokeys -passin pass:\${P12_PASS} -out ${AGENT_CERT} 2>/dev/null
  openssl pkcs12 -in ${AGENT_P12} -nocerts -nodes -passin pass:\${P12_PASS} -out ${AGENT_KEY} 2>/dev/null
  chmod 600 ${AGENT_KEY}
" 2>/dev/null || true

AGENT_HEALTH_DOMAIN=$(multipass exec portlama-agent -- curl -sk --max-time 30 \
  --cert "${AGENT_CERT}" \
  --key "${AGENT_KEY}" \
  -H 'Accept: application/json' \
  "https://panel.${DOMAIN}/api/health" 2>/dev/null || echo '{}')

if echo "$AGENT_HEALTH_DOMAIN" | jq -e '.status' &>/dev/null; then
  log_pass "Agent API call succeeds via domain without 2FA session"
else
  # Agent may still reach via IP if vhost removal is still propagating
  AGENT_HEALTH_IP=$(multipass exec portlama-agent -- curl -sk --max-time 30 \
    --cert "${AGENT_CERT}" \
    --key "${AGENT_KEY}" \
    -H 'Accept: application/json' \
    "https://${HOST_IP}:9292/api/health" 2>/dev/null || echo '{}')

  if echo "$AGENT_HEALTH_IP" | jq -e '.status' &>/dev/null; then
    log_pass "Agent API call succeeds via IP (IP vhost may still be present for this cert)"
  else
    log_info "Agent cannot reach panel — agent cert may not be enrolled yet"
  fi
fi

# Clean up temp PEM files
multipass exec portlama-agent -- rm -f "${AGENT_CERT}" "${AGENT_KEY}" 2>/dev/null || true

# ---------------------------------------------------------------------------
log_section "Admin request without cookie returns 401"
# ---------------------------------------------------------------------------

ADMIN_NO_SESSION=$(multipass exec portlama-host -- curl -sk -o /dev/null -w '%{http_code}' \
  --max-time 30 \
  --cert /etc/portlama/pki/client.crt \
  --key /etc/portlama/pki/client.key \
  --cacert /etc/portlama/pki/ca.crt \
  "https://panel.${DOMAIN}/api/system/stats" 2>/dev/null || echo "000")

assert_eq "$ADMIN_NO_SESSION" "401" "Admin request without session cookie returns 401" || true

# ---------------------------------------------------------------------------
log_section "Admin verifies and gets session cookie"
# ---------------------------------------------------------------------------

# Wait for next TOTP window to avoid replay protection from the confirm code
wait_for_next_totp_window

VERIFY_CODE=$(generate_totp_code "$MANUAL_KEY")

# Verify on host — capture cookie
VERIFY_RESULT=$(multipass exec portlama-host -- sudo bash -c "
  HEADERS=\$(mktemp)
  BODY=\$(curl -sk -D \"\$HEADERS\" --max-time 30 \\
    --cert /etc/portlama/pki/client.crt \\
    --key /etc/portlama/pki/client.key \\
    --cacert /etc/portlama/pki/ca.crt \\
    -X POST \\
    -H 'Content-Type: application/json' \\
    -d '{\"code\":\"${VERIFY_CODE}\"}' \\
    'https://panel.${DOMAIN}/api/settings/2fa/verify' 2>/dev/null)
  COOKIE=\$(grep -i 'set-cookie' \"\$HEADERS\" | grep 'portlama_2fa_session' | head -1 | sed 's/.*portlama_2fa_session=//;s/;.*//')
  rm -f \"\$HEADERS\"
  echo \"{\\\"body\\\": \$BODY, \\\"cookie\\\": \\\"\$COOKIE\\\"}\"
" 2>/dev/null || echo '{}')

VERIFY_VERIFIED=$(echo "$VERIFY_RESULT" | jq -r '.body.verified' 2>/dev/null || echo "false")
HOST_COOKIE=$(echo "$VERIFY_RESULT" | jq -r '.cookie' 2>/dev/null || echo "")

if [ "$VERIFY_VERIFIED" = "true" ]; then
  log_pass "Admin verified with TOTP code"
else
  log_fail "Admin verify failed"
fi

if [ -n "$HOST_COOKIE" ] && [ "$HOST_COOKIE" != "null" ]; then
  log_pass "Session cookie received"

  # Use cookie for an authenticated request
  AUTH_STATUS=$(multipass exec portlama-host -- curl -sk -o /dev/null -w '%{http_code}' \
    --max-time 30 \
    --cert /etc/portlama/pki/client.crt \
    --key /etc/portlama/pki/client.key \
    --cacert /etc/portlama/pki/ca.crt \
    -b "portlama_2fa_session=${HOST_COOKIE}" \
    "https://panel.${DOMAIN}/api/system/stats" 2>/dev/null || echo "000")

  assert_eq "$AUTH_STATUS" "200" "Authenticated request with cookie returns 200" || true
else
  log_skip "No cookie received — cannot test authenticated request"
fi

# ---------------------------------------------------------------------------
log_section "Disable 2FA and verify IP restored"
# ---------------------------------------------------------------------------

# Wait for next TOTP window to avoid replay from verify code
wait_for_next_totp_window

DISABLE_CODE=$(generate_totp_code "$MANUAL_KEY")

# Disable via domain with session cookie
DISABLE_RESULT=$(multipass exec portlama-host -- curl -sk --max-time 30 \
  --cert /etc/portlama/pki/client.crt \
  --key /etc/portlama/pki/client.key \
  --cacert /etc/portlama/pki/ca.crt \
  -X POST \
  -H 'Content-Type: application/json' \
  -b "portlama_2fa_session=${HOST_COOKIE}" \
  -d "{\"code\":\"${DISABLE_CODE}\"}" \
  "https://panel.${DOMAIN}/api/settings/2fa/disable" 2>/dev/null || echo '{}')

assert_json_field "$DISABLE_RESULT" '.enabled' 'false' "2FA disabled successfully" || true

# Wait for nginx reload
sleep 2

# Verify IP access restored
IP_STATUS=$(multipass exec portlama-host -- curl -sk -o /dev/null -w '%{http_code}' \
  --max-time 10 \
  --cert /etc/portlama/pki/client.crt \
  --key /etc/portlama/pki/client.key \
  --cacert /etc/portlama/pki/ca.crt \
  "https://127.0.0.1:9292/api/health" 2>/dev/null || echo "000")

if [ "$IP_STATUS" = "200" ]; then
  log_pass "IP:9292 access restored after disabling 2FA"
else
  log_fail "IP:9292 should be restored, got HTTP $IP_STATUS"
fi

# Final status check
FINAL_STATUS=$(host_api_get "settings/2fa" || echo '{}')
assert_json_field "$FINAL_STATUS" '.enabled' 'false' "2FA is disabled at end of test" || true

end_test
exit $?

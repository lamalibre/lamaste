#!/usr/bin/env bash
# ============================================================================
# 04 — Authelia Authentication (Three-VM)
# ============================================================================
# Tests that Authelia properly protects tunnel access from an external visitor:
#
# 1. Curl tunnel URL WITHOUT auth cookie from visitor VM — should redirect (302)
# 2. Curl tunnel URL WITH valid auth cookie from visitor VM — should return content
# 3. Curl tunnel URL with INVALID auth cookie from visitor VM — should redirect
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../e2e/helpers.sh"

require_commands multipass curl jq

# ---------------------------------------------------------------------------
# VM exec helpers
# ---------------------------------------------------------------------------

host_exec() { multipass exec lamaste-host -- sudo bash -c "$1"; }
agent_exec() { multipass exec lamaste-agent -- sudo bash -c "$1"; }
visitor_exec() { multipass exec lamaste-visitor -- sudo bash -c "$1"; }

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

TUNNEL_SUBDOMAIN="e2eauth"
TUNNEL_PORT=18082
TUNNEL_FQDN="${TUNNEL_SUBDOMAIN}.${TEST_DOMAIN}"
TUNNEL_ID=""
MARKER="LAMALIBRE_LAMASTE_AUTH_OK_$(date +%s)"

begin_test "04 — Authelia Authentication (Three-VM)"

# ---------------------------------------------------------------------------
# Cleanup function
# ---------------------------------------------------------------------------

cleanup() {
  log_info "Cleaning up test resources..."
  agent_exec "pkill -f 'python3 -m http.server ${TUNNEL_PORT}' 2>/dev/null || true" 2>/dev/null || true
  agent_exec "sed -i '/${TUNNEL_FQDN}/d' /etc/hosts 2>/dev/null || true" 2>/dev/null || true
  agent_exec "rm -f /tmp/e2e-auth-index.html 2>/dev/null || true" 2>/dev/null || true
  visitor_exec "rm -f /tmp/authelia-cookies-valid.txt /tmp/authelia-cookies-invalid.txt 2>/dev/null || true" 2>/dev/null || true
  visitor_exec "sed -i '/${TUNNEL_FQDN}/d' /etc/hosts 2>/dev/null || true" 2>/dev/null || true
  if [ -n "$TUNNEL_ID" ] && [ "$TUNNEL_ID" != "null" ]; then
    host_api_delete "tunnels/${TUNNEL_ID}" 2>/dev/null || true
  fi
  agent_exec "lamaste-agent update 2>/dev/null || true" 2>/dev/null || true
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
log_section "Pre-flight: verify onboarding is complete"
# ---------------------------------------------------------------------------

ONBOARDING_STATUS=$(host_api_get "onboarding/status" | jq -r '.status' 2>/dev/null || echo "unknown")
if [ "$ONBOARDING_STATUS" != "COMPLETED" ]; then
  log_skip "Onboarding not completed (status: $ONBOARDING_STATUS). Skipping Authelia auth tests."
  end_test
  exit $?
fi

# ---------------------------------------------------------------------------
log_section "Create tunnel and establish connection"
# ---------------------------------------------------------------------------

# Create tunnel via API
CREATE_RESPONSE=$(host_api_post "tunnels" "{\"subdomain\":\"${TUNNEL_SUBDOMAIN}\",\"port\":${TUNNEL_PORT}}")
assert_json_field "$CREATE_RESPONSE" '.ok' 'true' "Tunnel creation returned ok: true" || true

TUNNEL_ID=$(echo "$CREATE_RESPONSE" | jq -r '.tunnel.id' 2>/dev/null || echo "")
assert_json_field_not_empty "$CREATE_RESPONSE" '.tunnel.id' "Tunnel has an ID" || true
log_info "Created tunnel ID: $TUNNEL_ID"

# Add /etc/hosts entries on agent
agent_exec "grep -q 'tunnel.${TEST_DOMAIN}' /etc/hosts || echo '${HOST_IP} tunnel.${TEST_DOMAIN}' >> /etc/hosts"
agent_exec "grep -q '${TUNNEL_FQDN}' /etc/hosts || echo '${HOST_IP} ${TUNNEL_FQDN}' >> /etc/hosts"

# Add /etc/hosts entry on visitor for the tunnel subdomain
visitor_exec "grep -q '${TUNNEL_FQDN}' /etc/hosts || echo '${HOST_IP} ${TUNNEL_FQDN}' >> /etc/hosts"

# Start HTTP server on agent
agent_exec "echo '${MARKER}' > /tmp/e2e-auth-index.html"
agent_exec "nohup python3 -m http.server ${TUNNEL_PORT} --bind 127.0.0.1 -d /tmp &>/dev/null & exit"
sleep 2

# Refresh agent config to pick up the new tunnel
agent_exec "lamaste-agent update"

# Wait for tunnel to establish
log_info "Waiting for Chisel tunnel to establish..."
TUNNEL_READY=false
for i in $(seq 1 15); do
  CHECK=$(host_exec "curl -sf -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:${TUNNEL_PORT}/e2e-auth-index.html 2>/dev/null" || echo "000")
  if [ "$CHECK" = "200" ]; then
    TUNNEL_READY=true
    break
  fi
  sleep 1
done

if [ "$TUNNEL_READY" = "true" ]; then
  log_pass "Chisel tunnel established"
else
  log_fail "Chisel tunnel failed to establish within 15 seconds"
fi

# ---------------------------------------------------------------------------
log_section "Test: unauthenticated access is redirected (from visitor VM)"
# ---------------------------------------------------------------------------

# Without any auth cookie, Authelia should redirect to the login portal.
UNAUTH_STATUS=$(visitor_exec "curl -sk -o /dev/null -w '%{http_code}' --max-time 15 https://${TUNNEL_FQDN}/e2e-auth-index.html 2>/dev/null" || echo "000")

if [ "$UNAUTH_STATUS" = "302" ] || [ "$UNAUTH_STATUS" = "401" ]; then
  log_pass "Unauthenticated request redirected/rejected (HTTP $UNAUTH_STATUS)"
else
  log_fail "Unauthenticated request should be redirected (302 or 401), got HTTP $UNAUTH_STATUS"
fi

# Verify the redirect goes to the Authelia portal
UNAUTH_LOCATION=$(visitor_exec "curl -sk -o /dev/null -w '%{redirect_url}' --max-time 15 https://${TUNNEL_FQDN}/e2e-auth-index.html 2>/dev/null" || echo "")
if echo "$UNAUTH_LOCATION" | grep -qF "auth.${TEST_DOMAIN}"; then
  log_pass "Redirect points to Authelia portal (auth.${TEST_DOMAIN})"
elif [ "$UNAUTH_STATUS" = "401" ]; then
  log_pass "Request returned 401 (Authelia enforcement confirmed)"
else
  log_fail "Redirect does not point to Authelia portal (location: $UNAUTH_LOCATION)"
fi

# ---------------------------------------------------------------------------
log_section "Test: authenticated access succeeds (from visitor VM)"
# ---------------------------------------------------------------------------

# IMPORTANT: Reset TOTP BEFORE first factor auth.
# If TOTP is reset after first factor, Authelia may reject the second factor
# because the session's expected TOTP state changed mid-authentication.

# Ensure oathtool is available on the visitor VM
OATHTOOL_CHECK=$(visitor_exec "command -v oathtool >/dev/null 2>&1 && echo yes || echo no")
if [ "$OATHTOOL_CHECK" != "yes" ]; then
  log_skip "oathtool not available on visitor VM. Skipping TOTP-dependent tests."
  end_test
  exit $?
fi

# Reset TOTP for test user via panel API to get a fresh secret
TOTP_RESPONSE=$(host_api_post "users/${TEST_USER}/reset-totp" "{}")
assert_json_field_not_empty "$TOTP_RESPONSE" '.totpUri' "TOTP reset returned otpauth URI" || true

# Extract the TOTP secret from the otpauth URI (the secret= parameter)
OTPAUTH_URI=$(echo "$TOTP_RESPONSE" | jq -r '.totpUri' 2>/dev/null || echo "")
TOTP_SECRET=$(echo "$OTPAUTH_URI" | sed -n 's/.*secret=\([A-Z2-7]*\).*/\1/p')

if [ -z "$TOTP_SECRET" ]; then
  log_fail "Failed to extract TOTP secret from otpauth URI: $OTPAUTH_URI"
  end_test
  exit $?
fi
log_pass "Extracted TOTP secret from otpauth URI"

# Brief pause to let Authelia pick up the new TOTP configuration
sleep 2

# Now authenticate with first factor
AUTH_RESPONSE=$(visitor_exec "curl -sk --max-time 15 -c /tmp/authelia-cookies-valid.txt -X POST -H 'Content-Type: application/json' -d '{\"username\":\"${TEST_USER}\",\"password\":\"${TEST_USER_PASSWORD}\",\"keepMeLoggedIn\":false,\"targetURL\":\"https://${TUNNEL_FQDN}/\"}' https://auth.${TEST_DOMAIN}/api/firstfactor 2>/dev/null" || echo '{}')

AUTH_STATUS=$(echo "$AUTH_RESPONSE" | jq -r '.status' 2>/dev/null || echo "unknown")
if [ "$AUTH_STATUS" = "OK" ]; then
  log_pass "Authelia first factor authentication succeeded"
else
  log_fail "Authelia first factor authentication failed (status: $AUTH_STATUS)"
fi

# ---------------------------------------------------------------------------
log_section "Second factor authentication (TOTP) from visitor VM"
# ---------------------------------------------------------------------------

# Generate a TOTP code on visitor VM
TOTP_CODE=$(visitor_exec "oathtool --totp --base32 ${TOTP_SECRET}" 2>/dev/null || echo "")
if [ -z "$TOTP_CODE" ] || [ ${#TOTP_CODE} -ne 6 ]; then
  log_fail "oathtool failed to generate a valid 6-digit TOTP code (got: '${TOTP_CODE}')"
  end_test
  exit $?
fi
log_info "Generated TOTP code: ${TOTP_CODE}"

# POST second factor to Authelia from visitor VM
TOTP_AUTH_RESPONSE=$(visitor_exec "curl -sk --max-time 15 -b /tmp/authelia-cookies-valid.txt -c /tmp/authelia-cookies-valid.txt -X POST -H 'Content-Type: application/json' -d '{\"token\":\"${TOTP_CODE}\",\"targetURL\":\"https://${TUNNEL_FQDN}/\"}' https://auth.${TEST_DOMAIN}/api/secondfactor/totp 2>/dev/null" || echo '{}')

TOTP_AUTH_STATUS=$(echo "$TOTP_AUTH_RESPONSE" | jq -r '.status' 2>/dev/null || echo "unknown")
if [ "$TOTP_AUTH_STATUS" = "OK" ]; then
  log_pass "Second factor authentication succeeded (TOTP accepted)"
else
  log_fail "Second factor authentication failed (status: $TOTP_AUTH_STATUS, response: $TOTP_AUTH_RESPONSE)"
fi

# Fetch the tunnel URL from visitor VM with the valid session cookie
AUTH_CONTENT=$(visitor_exec "curl -sk --max-time 15 -b /tmp/authelia-cookies-valid.txt https://${TUNNEL_FQDN}/e2e-auth-index.html 2>/dev/null" || echo "")
assert_contains "$AUTH_CONTENT" "$MARKER" "Authenticated request returns tunnel content" || true

# Also verify the HTTP status is 200
AUTH_HTTP_STATUS=$(visitor_exec "curl -sk -o /dev/null -w '%{http_code}' --max-time 15 -b /tmp/authelia-cookies-valid.txt https://${TUNNEL_FQDN}/e2e-auth-index.html 2>/dev/null" || echo "000")
assert_eq "$AUTH_HTTP_STATUS" "200" "Authenticated request returns HTTP 200" || true

# ---------------------------------------------------------------------------
log_section "Test: invalid auth cookie is rejected (from visitor VM)"
# ---------------------------------------------------------------------------

# Create a cookie jar with a bogus session cookie on visitor VM
visitor_exec "echo '# Netscape HTTP Cookie File' > /tmp/authelia-cookies-invalid.txt && echo 'auth.${TEST_DOMAIN}\tFALSE\t/\tTRUE\t0\tauthelia_session\tinvalid_session_value_12345' >> /tmp/authelia-cookies-invalid.txt"

INVALID_STATUS=$(visitor_exec "curl -sk -o /dev/null -w '%{http_code}' --max-time 15 -b /tmp/authelia-cookies-invalid.txt https://${TUNNEL_FQDN}/e2e-auth-index.html 2>/dev/null" || echo "000")

if [ "$INVALID_STATUS" = "302" ] || [ "$INVALID_STATUS" = "401" ]; then
  log_pass "Invalid auth cookie rejected (HTTP $INVALID_STATUS)"
else
  log_fail "Invalid auth cookie should be rejected (302 or 401), got HTTP $INVALID_STATUS"
fi

# Verify the response does NOT contain the tunnel content
INVALID_CONTENT=$(visitor_exec "curl -sk --max-time 15 -b /tmp/authelia-cookies-invalid.txt https://${TUNNEL_FQDN}/e2e-auth-index.html 2>/dev/null" || echo "")
assert_not_contains "$INVALID_CONTENT" "$MARKER" "Invalid auth cookie does not return tunnel content" || true

# ---------------------------------------------------------------------------
log_section "Test: Authelia portal is accessible (from visitor VM)"
# ---------------------------------------------------------------------------

# Verify the Authelia portal itself is reachable from external visitor
PORTAL_STATUS=$(visitor_exec "curl -sk -o /dev/null -w '%{http_code}' --max-time 15 https://auth.${TEST_DOMAIN}/ 2>/dev/null" || echo "000")
if [ "$PORTAL_STATUS" = "200" ] || [ "$PORTAL_STATUS" = "302" ]; then
  log_pass "Authelia portal accessible at https://auth.${TEST_DOMAIN} (HTTP $PORTAL_STATUS)"
else
  log_fail "Authelia portal not accessible (HTTP $PORTAL_STATUS)"
fi

end_test

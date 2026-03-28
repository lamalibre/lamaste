#!/usr/bin/env bash
# ============================================================================
# 06 — Tunnel User Journey (Three-VM)
# ============================================================================
# Tests the complete end-user experience when accessing a tunneled application
# through Authelia with two-factor authentication (TOTP) from an external
# visitor VM.
#
# This is the most important user journey test. It simulates what a real user
# experiences from an external machine:
#
#   Visitor VM -> nginx (host) -> Authelia auth_request -> chisel tunnel -> agent -> content
#
# Flow:
#   1. Create tunnel + HTTP server + chisel connection
#   2. Prepare TOTP for the test user via panel API
#   3. Unauthenticated access from visitor -> redirect to Authelia
#   4. First factor authentication from visitor (username/password)
#   5. Second factor authentication from visitor (TOTP)
#   6. Authenticated access from visitor -> see tunnel content
#   7. Session persistence -> no re-auth needed
#   8. Invalid session from visitor -> redirect again
#   9. Cleanup
#
# Required env vars: HOST_IP, AGENT_IP, VISITOR_IP, TEST_DOMAIN, TEST_USER, TEST_USER_PASSWORD
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../e2e/helpers.sh"

require_commands multipass curl jq

# ---------------------------------------------------------------------------
# VM exec helpers
# ---------------------------------------------------------------------------

host_exec() { multipass exec portlama-host -- sudo bash -c "$1"; }
agent_exec() { multipass exec portlama-agent -- sudo bash -c "$1"; }
visitor_exec() { multipass exec portlama-visitor -- sudo bash -c "$1"; }

host_api_get() {
  host_exec "curl -skf --max-time 30 --cert /etc/portlama/pki/client.crt --key /etc/portlama/pki/client.key --cacert /etc/portlama/pki/ca.crt -H 'Accept: application/json' https://127.0.0.1:9292/api/$1"
}

host_api_post() {
  host_exec "curl -skf --max-time 30 --cert /etc/portlama/pki/client.crt --key /etc/portlama/pki/client.key --cacert /etc/portlama/pki/ca.crt -X POST -H 'Content-Type: application/json' -H 'Accept: application/json' -d '$2' https://127.0.0.1:9292/api/$1"
}

host_api_delete() {
  host_exec "curl -skf --max-time 30 --cert /etc/portlama/pki/client.crt --key /etc/portlama/pki/client.key --cacert /etc/portlama/pki/ca.crt -X DELETE -H 'Accept: application/json' https://127.0.0.1:9292/api/$1"
}

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

TUNNEL_SUBDOMAIN="e2ejourney"
TUNNEL_PORT=18090
TUNNEL_FQDN="${TUNNEL_SUBDOMAIN}.${TEST_DOMAIN}"
TUNNEL_ID=""
MARKER="PORTLAMA_JOURNEY_OK_$(date +%s)"
COOKIE_FILE="/tmp/e2e-journey-cookies.txt"
TOTP_SECRET=""

begin_test "06 — Tunnel User Journey (Three-VM)"

# ---------------------------------------------------------------------------
# Cleanup function — always runs on exit
# ---------------------------------------------------------------------------

cleanup() {
  log_info "Cleaning up test resources..."

  # Stop HTTP server on agent
  agent_exec "pkill -f 'python3 -m http.server ${TUNNEL_PORT}' 2>/dev/null || true" 2>/dev/null || true

  # Remove /etc/hosts entries on agent
  agent_exec "sed -i '/${TUNNEL_FQDN}/d' /etc/hosts 2>/dev/null || true" 2>/dev/null || true

  # Remove test HTML file on agent
  agent_exec "rm -f /tmp/e2e-journey-index.html 2>/dev/null || true" 2>/dev/null || true

  # Remove cookie files and /etc/hosts entries on visitor
  visitor_exec "rm -f ${COOKIE_FILE} /tmp/e2e-journey-fake-cookies.txt 2>/dev/null || true" 2>/dev/null || true
  visitor_exec "sed -i '/${TUNNEL_FQDN}/d' /etc/hosts 2>/dev/null || true" 2>/dev/null || true

  # Delete tunnel via API (if we have an ID), then refresh agent
  if [ -n "$TUNNEL_ID" ] && [ "$TUNNEL_ID" != "null" ]; then
    host_api_delete "tunnels/${TUNNEL_ID}" 2>/dev/null || true
  fi
  agent_exec "portlama-agent update 2>/dev/null || true" 2>/dev/null || true
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
log_section "Pre-flight: verify onboarding is complete"
# ---------------------------------------------------------------------------

ONBOARDING_STATUS=$(host_api_get "onboarding/status" | jq -r '.status' 2>/dev/null || echo "unknown")
if [ "$ONBOARDING_STATUS" != "COMPLETED" ]; then
  log_skip "Onboarding not completed (status: $ONBOARDING_STATUS). Skipping tunnel user journey tests."
  end_test
  exit $?
fi

# ---------------------------------------------------------------------------
log_section "Step 1: Create tunnel and establish connection"
# ---------------------------------------------------------------------------

# Create tunnel via API
CREATE_RESPONSE=$(host_api_post "tunnels" "{\"subdomain\":\"${TUNNEL_SUBDOMAIN}\",\"port\":${TUNNEL_PORT}}")
assert_json_field "$CREATE_RESPONSE" '.ok' 'true' "Tunnel creation returned ok: true" || true

TUNNEL_ID=$(echo "$CREATE_RESPONSE" | jq -r '.tunnel.id' 2>/dev/null || echo "")
assert_json_field_not_empty "$CREATE_RESPONSE" '.tunnel.id' "Tunnel has an ID" || true
log_info "Created tunnel ID: $TUNNEL_ID (${TUNNEL_FQDN})"

# Add /etc/hosts entries on agent so chisel client can resolve the domains
agent_exec "grep -q 'tunnel.${TEST_DOMAIN}' /etc/hosts || echo '${HOST_IP} tunnel.${TEST_DOMAIN}' >> /etc/hosts"
agent_exec "grep -q '${TUNNEL_FQDN}' /etc/hosts || echo '${HOST_IP} ${TUNNEL_FQDN}' >> /etc/hosts"
log_pass "Added DNS entries to agent /etc/hosts"

# Add /etc/hosts entry on visitor for the tunnel subdomain
visitor_exec "grep -q '${TUNNEL_FQDN}' /etc/hosts || echo '${HOST_IP} ${TUNNEL_FQDN}' >> /etc/hosts"
log_pass "Added ${TUNNEL_FQDN} to visitor /etc/hosts"

# Start HTTP server on agent serving a unique marker
agent_exec "echo '${MARKER}' > /tmp/e2e-journey-index.html"
agent_exec "nohup python3 -m http.server ${TUNNEL_PORT} --bind 127.0.0.1 -d /tmp &>/dev/null & exit"
sleep 2

AGENT_HTTP_STATUS=$(agent_exec "curl -sf -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:${TUNNEL_PORT}/e2e-journey-index.html 2>/dev/null" || echo "000")
assert_eq "$AGENT_HTTP_STATUS" "200" "HTTP server running on agent at port ${TUNNEL_PORT}" || true

# Refresh agent config to pick up the new tunnel
agent_exec "portlama-agent update"

# Wait for tunnel to establish
log_info "Waiting for Chisel tunnel to establish..."
CHISEL_READY=false
for i in $(seq 1 15); do
  CHECK=$(host_exec "curl -sf -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:${TUNNEL_PORT}/e2e-journey-index.html 2>/dev/null" || echo "000")
  if [ "$CHECK" = "200" ]; then
    CHISEL_READY=true
    break
  fi
  sleep 1
done

if [ "$CHISEL_READY" = "true" ]; then
  log_pass "Chisel tunnel established (port ${TUNNEL_PORT} accessible on host)"
else
  log_fail "Chisel tunnel failed to establish within 15 seconds"
  AGENT_LOG=$(agent_exec "tail -20 ~/.portlama/agents/e2e-agent/logs/chisel.log 2>/dev/null || echo 'no log'")
  log_info "Agent chisel log: $AGENT_LOG"
fi

# ---------------------------------------------------------------------------
log_section "Step 2: Prepare TOTP for test user"
# ---------------------------------------------------------------------------

# Ensure oathtool is available on the visitor VM
OATHTOOL_CHECK=$(visitor_exec "command -v oathtool >/dev/null 2>&1 && echo yes || echo no")
if [ "$OATHTOOL_CHECK" != "yes" ]; then
  log_skip "oathtool not available on visitor VM. Skipping TOTP-dependent tests."
  end_test
  exit $?
fi
log_pass "oathtool is available on visitor VM"

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

# Allow Authelia to pick up the new TOTP configuration
sleep 2

# Generate a TOTP code on visitor VM to verify oathtool works with this secret
TOTP_VERIFY=$(visitor_exec "oathtool --totp --base32 ${TOTP_SECRET}" 2>/dev/null || echo "")
if [ -z "$TOTP_VERIFY" ] || [ ${#TOTP_VERIFY} -ne 6 ]; then
  log_fail "oathtool failed to generate a valid 6-digit TOTP code (got: '${TOTP_VERIFY}')"
  end_test
  exit $?
fi
log_pass "oathtool generates valid TOTP codes for this secret"

# ---------------------------------------------------------------------------
log_section "Step 3: Unauthenticated access redirects to Authelia (from visitor VM)"
# ---------------------------------------------------------------------------

# Without any cookies, the request should be redirected to the Authelia portal.
UNAUTH_STATUS=$(visitor_exec "curl -sk -o /dev/null -w '%{http_code}' --max-time 15 https://${TUNNEL_FQDN}/ 2>/dev/null" || echo "000")

if [ "$UNAUTH_STATUS" = "302" ] || [ "$UNAUTH_STATUS" = "401" ]; then
  log_pass "Unauthenticated request redirected/rejected (HTTP $UNAUTH_STATUS)"
else
  log_fail "Unauthenticated request should be 302 or 401, got HTTP $UNAUTH_STATUS"
fi

# Verify the redirect points to the Authelia portal
UNAUTH_REDIRECT=$(visitor_exec "curl -sk -o /dev/null -w '%{redirect_url}' --max-time 15 https://${TUNNEL_FQDN}/ 2>/dev/null" || echo "")
if echo "$UNAUTH_REDIRECT" | grep -qF "auth.${TEST_DOMAIN}"; then
  log_pass "Redirect URL contains auth.${TEST_DOMAIN}"
elif [ "$UNAUTH_STATUS" = "401" ]; then
  log_pass "Request returned 401 (Authelia enforcement confirmed)"
else
  log_fail "Redirect does not point to Authelia portal (redirect_url: $UNAUTH_REDIRECT)"
fi

# Verify the marker is NOT visible without authentication
UNAUTH_BODY=$(visitor_exec "curl -sk -L --max-time 15 https://${TUNNEL_FQDN}/ 2>/dev/null" || echo "")
assert_not_contains "$UNAUTH_BODY" "$MARKER" "Tunnel content is NOT visible without authentication" || true

# ---------------------------------------------------------------------------
log_section "Step 4: First factor authentication from visitor VM (username/password)"
# ---------------------------------------------------------------------------

FIRSTFACTOR_RESPONSE=$(visitor_exec "curl -sk --max-time 15 -c ${COOKIE_FILE} -X POST -H 'Content-Type: application/json' -d '{\"username\":\"${TEST_USER}\",\"password\":\"${TEST_USER_PASSWORD}\",\"keepMeLoggedIn\":false,\"targetURL\":\"https://${TUNNEL_FQDN}/\"}' https://auth.${TEST_DOMAIN}/api/firstfactor 2>/dev/null" || echo '{}')

FIRSTFACTOR_STATUS=$(echo "$FIRSTFACTOR_RESPONSE" | jq -r '.status' 2>/dev/null || echo "unknown")
if [ "$FIRSTFACTOR_STATUS" = "OK" ]; then
  log_pass "First factor authentication succeeded (username/password accepted)"
else
  log_fail "First factor authentication failed (status: $FIRSTFACTOR_STATUS, response: $FIRSTFACTOR_RESPONSE)"
fi

# ---------------------------------------------------------------------------
log_section "Step 5: Second factor authentication from visitor VM (TOTP)"
# ---------------------------------------------------------------------------

# Generate a fresh TOTP code on visitor VM (in case time has advanced since step 2)
TOTP_CODE=$(visitor_exec "oathtool --totp --base32 ${TOTP_SECRET}")
log_info "Generated TOTP code: ${TOTP_CODE}"

SECONDFACTOR_RESPONSE=$(visitor_exec "curl -sk --max-time 15 -b ${COOKIE_FILE} -c ${COOKIE_FILE} -X POST -H 'Content-Type: application/json' -d '{\"token\":\"${TOTP_CODE}\",\"targetURL\":\"https://${TUNNEL_FQDN}/\"}' https://auth.${TEST_DOMAIN}/api/secondfactor/totp 2>/dev/null" || echo '{}')

SECONDFACTOR_STATUS=$(echo "$SECONDFACTOR_RESPONSE" | jq -r '.status' 2>/dev/null || echo "unknown")
if [ "$SECONDFACTOR_STATUS" = "OK" ]; then
  log_pass "Second factor authentication succeeded (TOTP accepted)"
else
  log_fail "Second factor authentication failed (status: $SECONDFACTOR_STATUS, response: $SECONDFACTOR_RESPONSE)"
fi

# ---------------------------------------------------------------------------
log_section "Step 6: Authenticated access from visitor VM shows tunnel content"
# ---------------------------------------------------------------------------

# With a fully authenticated session (first + second factor), access the tunnel from visitor
AUTH_CONTENT=$(visitor_exec "curl -sk --max-time 15 -b ${COOKIE_FILE} https://${TUNNEL_FQDN}/e2e-journey-index.html 2>/dev/null" || echo "")
assert_contains "$AUTH_CONTENT" "$MARKER" "Authenticated request returns tunnel content (full 2FA path verified)" || true

AUTH_HTTP_STATUS=$(visitor_exec "curl -sk -o /dev/null -w '%{http_code}' --max-time 15 -b ${COOKIE_FILE} https://${TUNNEL_FQDN}/e2e-journey-index.html 2>/dev/null" || echo "000")
assert_eq "$AUTH_HTTP_STATUS" "200" "Authenticated request returns HTTP 200" || true

# ---------------------------------------------------------------------------
log_section "Step 7: Session persistence (no re-auth needed, from visitor VM)"
# ---------------------------------------------------------------------------

# Make another request with the same cookies — should still succeed
PERSIST_CONTENT=$(visitor_exec "curl -sk --max-time 15 -b ${COOKIE_FILE} https://${TUNNEL_FQDN}/e2e-journey-index.html 2>/dev/null" || echo "")
assert_contains "$PERSIST_CONTENT" "$MARKER" "Session persists — second request returns tunnel content without re-auth" || true

PERSIST_HTTP_STATUS=$(visitor_exec "curl -sk -o /dev/null -w '%{http_code}' --max-time 15 -b ${COOKIE_FILE} https://${TUNNEL_FQDN}/e2e-journey-index.html 2>/dev/null" || echo "000")
assert_eq "$PERSIST_HTTP_STATUS" "200" "Session persists — HTTP 200 on second request" || true

# ---------------------------------------------------------------------------
log_section "Step 8: Invalid session redirects to Authelia again (from visitor VM)"
# ---------------------------------------------------------------------------

# Create a cookie jar with a bogus/expired session cookie on visitor VM
FAKE_COOKIE_FILE="/tmp/e2e-journey-fake-cookies.txt"
visitor_exec "echo '# Netscape HTTP Cookie File' > ${FAKE_COOKIE_FILE} && echo 'auth.${TEST_DOMAIN}\tFALSE\t/\tTRUE\t0\tauthelia_session\tinvalid_expired_session_xyz' >> ${FAKE_COOKIE_FILE}"

INVALID_STATUS=$(visitor_exec "curl -sk -o /dev/null -w '%{http_code}' --max-time 15 -b ${FAKE_COOKIE_FILE} https://${TUNNEL_FQDN}/e2e-journey-index.html 2>/dev/null" || echo "000")

if [ "$INVALID_STATUS" = "302" ] || [ "$INVALID_STATUS" = "401" ]; then
  log_pass "Invalid/expired session rejected (HTTP $INVALID_STATUS)"
else
  log_fail "Invalid session should be rejected (302 or 401), got HTTP $INVALID_STATUS"
fi

# Verify the marker is NOT visible with an invalid session
INVALID_CONTENT=$(visitor_exec "curl -sk --max-time 15 -b ${FAKE_COOKIE_FILE} https://${TUNNEL_FQDN}/e2e-journey-index.html 2>/dev/null" || echo "")
assert_not_contains "$INVALID_CONTENT" "$MARKER" "Invalid session does not expose tunnel content" || true

# Clean up fake cookie file
visitor_exec "rm -f ${FAKE_COOKIE_FILE} 2>/dev/null || true" 2>/dev/null || true

end_test

#!/usr/bin/env bash
# ============================================================================
# 03 — Tunnel Toggle Traffic (Three-VM)
# ============================================================================
# Tests that disabling a tunnel stops traffic and re-enabling restores it:
#
# 1. Create a tunnel and establish chisel + HTTP server
# 2. Verify traffic flows through the tunnel
# 3. Disable the tunnel via PATCH /api/tunnels/:id
# 4. Verify traffic no longer flows (nginx vhost removed)
# 5. Re-enable the tunnel via PATCH /api/tunnels/:id
# 6. Verify traffic flows again
# 7. Clean up
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

host_api_get() {
  host_exec "curl -skf --max-time 30 --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key --cacert /etc/lamalibre/lamaste/pki/ca.crt -H 'Accept: application/json' https://127.0.0.1:9292/api/$1"
}

host_api_post() {
  host_exec "curl -skf --max-time 30 --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key --cacert /etc/lamalibre/lamaste/pki/ca.crt -X POST -H 'Content-Type: application/json' -H 'Accept: application/json' -d '$2' https://127.0.0.1:9292/api/$1"
}

host_api_patch() {
  host_exec "curl -skf --max-time 30 --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key --cacert /etc/lamalibre/lamaste/pki/ca.crt -X PATCH -H 'Content-Type: application/json' -H 'Accept: application/json' -d '$2' https://127.0.0.1:9292/api/$1"
}

host_api_delete() {
  host_exec "curl -skf --max-time 30 --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key --cacert /etc/lamalibre/lamaste/pki/ca.crt -X DELETE -H 'Accept: application/json' https://127.0.0.1:9292/api/$1"
}

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

TUNNEL_SUBDOMAIN="e2etoggle"
TUNNEL_PORT=18081
TUNNEL_FQDN="${TUNNEL_SUBDOMAIN}.${TEST_DOMAIN}"
TUNNEL_ID=""
MARKER="LAMASTE_TOGGLE_OK_$(date +%s)"

begin_test "03 — Tunnel Toggle Traffic (Three-VM)"

# ---------------------------------------------------------------------------
# Cleanup function
# ---------------------------------------------------------------------------

cleanup() {
  log_info "Cleaning up test resources..."
  agent_exec "pkill -f 'python3 -m http.server ${TUNNEL_PORT}' 2>/dev/null || true" 2>/dev/null || true
  agent_exec "sed -i '/${TUNNEL_FQDN}/d' /etc/hosts 2>/dev/null || true" 2>/dev/null || true
  agent_exec "rm -f /tmp/e2e-toggle-index.html 2>/dev/null || true" 2>/dev/null || true
  host_exec "rm -f /tmp/authelia-cookies-toggle.txt 2>/dev/null || true" 2>/dev/null || true
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
  log_skip "Onboarding not completed (status: $ONBOARDING_STATUS). Skipping toggle traffic tests."
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

# Start HTTP server on agent
agent_exec "echo '${MARKER}' > /tmp/e2e-toggle-index.html"
agent_exec "nohup python3 -m http.server ${TUNNEL_PORT} --bind 127.0.0.1 -d /tmp &>/dev/null & exit"
sleep 2

# Refresh agent config to pick up the new tunnel
agent_exec "lamaste-agent update"

# Wait for tunnel to establish
log_info "Waiting for Chisel tunnel to establish..."
TUNNEL_READY=false
for i in $(seq 1 15); do
  CHECK=$(host_exec "curl -sf -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:${TUNNEL_PORT}/e2e-toggle-index.html 2>/dev/null" || echo "000")
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
log_section "Verify traffic flows (tunnel enabled)"
# ---------------------------------------------------------------------------

CONTENT_BEFORE=$(host_exec "curl -sf --max-time 10 http://127.0.0.1:${TUNNEL_PORT}/e2e-toggle-index.html 2>/dev/null" || echo "")
assert_contains "$CONTENT_BEFORE" "$MARKER" "Traffic flows through enabled tunnel" || true

# ---------------------------------------------------------------------------
log_section "Disable tunnel"
# ---------------------------------------------------------------------------

DISABLE_RESPONSE=$(host_api_patch "tunnels/${TUNNEL_ID}" '{"enabled":false}')
assert_json_field "$DISABLE_RESPONSE" '.ok' 'true' "Tunnel disable returned ok: true" || true

# Verify tunnel shows as disabled in the list
LIST_DISABLED=$(host_api_get "tunnels")
ENABLED_STATE=$(echo "$LIST_DISABLED" | jq -r --arg id "$TUNNEL_ID" '.tunnels[] | select(.id == $id) | .enabled' 2>/dev/null || echo "")
assert_eq "$ENABLED_STATE" "false" "Tunnel shows as disabled in list" || true

# Wait briefly for nginx reload to take effect
sleep 2

# ---------------------------------------------------------------------------
log_section "Verify traffic blocked (tunnel disabled)"
# ---------------------------------------------------------------------------

# When the tunnel is disabled, the nginx vhost for the subdomain is removed.
# Without a matching server_name, nginx may fall through to another server block
# on port 443 (e.g., the chisel tunnel vhost), so the HTTP status may still be
# 200. The definitive check is that the tunnel CONTENT is not accessible.
DISABLED_CONTENT=$(host_exec "curl -sk --max-time 10 https://${TUNNEL_FQDN}/e2e-toggle-index.html 2>/dev/null" || echo "")

if ! echo "$DISABLED_CONTENT" | grep -qF "$MARKER"; then
  log_pass "Tunnel content not accessible after disable (vhost removed)"
else
  log_fail "Tunnel content still accessible after tunnel disable"
fi

# Also verify the vhost symlink is actually gone
VHOST_EXISTS=$(host_exec "test -L /etc/nginx/sites-enabled/lamalibre-lamaste-app-${TUNNEL_SUBDOMAIN} && echo yes || echo no")
assert_eq "$VHOST_EXISTS" "no" "Nginx vhost symlink removed after disable" || true

# ---------------------------------------------------------------------------
log_section "Re-enable tunnel"
# ---------------------------------------------------------------------------

ENABLE_RESPONSE=$(host_api_patch "tunnels/${TUNNEL_ID}" '{"enabled":true}')
assert_json_field "$ENABLE_RESPONSE" '.ok' 'true' "Tunnel re-enable returned ok: true" || true

# Verify tunnel shows as enabled in the list
LIST_ENABLED=$(host_api_get "tunnels")
ENABLED_STATE2=$(echo "$LIST_ENABLED" | jq -r --arg id "$TUNNEL_ID" '.tunnels[] | select(.id == $id) | .enabled' 2>/dev/null || echo "")
assert_eq "$ENABLED_STATE2" "true" "Tunnel shows as enabled in list" || true

# Wait for nginx reload
sleep 2

# ---------------------------------------------------------------------------
log_section "Verify traffic restored (tunnel re-enabled)"
# ---------------------------------------------------------------------------

# Direct access through chisel should still work since chisel was never stopped
CONTENT_AFTER=$(host_exec "curl -sf --max-time 10 http://127.0.0.1:${TUNNEL_PORT}/e2e-toggle-index.html 2>/dev/null" || echo "")
assert_contains "$CONTENT_AFTER" "$MARKER" "Traffic flows through re-enabled tunnel" || true

# Verify nginx vhost is back by checking the FQDN via HTTPS
# This needs auth, but we can check for a redirect to Authelia (302) which proves the vhost exists
REENABLED_STATUS=$(host_exec "curl -sk -o /dev/null -w '%{http_code}' --max-time 10 https://${TUNNEL_FQDN}/ 2>/dev/null" || echo "000")
if [ "$REENABLED_STATUS" = "200" ] || [ "$REENABLED_STATUS" = "302" ] || [ "$REENABLED_STATUS" = "401" ]; then
  log_pass "Nginx vhost restored after re-enable (HTTP $REENABLED_STATUS)"
else
  log_fail "Nginx vhost not restored after re-enable (HTTP $REENABLED_STATUS)"
fi

# ---------------------------------------------------------------------------
log_section "Reset TOTP before authentication"
# ---------------------------------------------------------------------------

# Ensure oathtool is available on the host VM
OATHTOOL_CHECK=$(host_exec "command -v oathtool >/dev/null 2>&1 && echo yes || echo no")
if [ "$OATHTOOL_CHECK" != "yes" ]; then
  log_skip "oathtool not available on host VM. Skipping TOTP-dependent tests."
  end_test
  exit $?
fi

# Reset TOTP for test user via panel API to get a fresh secret
# IMPORTANT: TOTP must be reset BEFORE firstfactor auth, not after.
# If reset after firstfactor, Authelia may reject the secondfactor because
# the TOTP configuration changed mid-session.
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

# ---------------------------------------------------------------------------
log_section "Authenticate with Authelia (first factor)"
# ---------------------------------------------------------------------------

AUTH_RESPONSE=$(host_exec "curl -sk --max-time 15 -c /tmp/authelia-cookies-toggle.txt -X POST -H 'Content-Type: application/json' -d '{\"username\":\"${TEST_USER}\",\"password\":\"${TEST_USER_PASSWORD}\",\"keepMeLoggedIn\":false,\"targetURL\":\"https://${TUNNEL_FQDN}/\"}' https://auth.${TEST_DOMAIN}/api/firstfactor 2>/dev/null" || echo '{}')

AUTH_STATUS=$(echo "$AUTH_RESPONSE" | jq -r '.status' 2>/dev/null || echo "unknown")
if [ "$AUTH_STATUS" = "OK" ]; then
  log_pass "Authelia first factor authentication succeeded"
else
  log_fail "Authelia first factor authentication failed (status: $AUTH_STATUS, response: $AUTH_RESPONSE)"
fi

# ---------------------------------------------------------------------------
log_section "Second factor authentication (TOTP)"
# ---------------------------------------------------------------------------

# Generate a TOTP code on host VM
TOTP_CODE=$(host_exec "oathtool --totp --base32 ${TOTP_SECRET}" 2>/dev/null || echo "")
if [ -z "$TOTP_CODE" ] || [ ${#TOTP_CODE} -ne 6 ]; then
  log_fail "oathtool failed to generate a valid 6-digit TOTP code (got: '${TOTP_CODE}')"
  end_test
  exit $?
fi
log_info "Generated TOTP code: ${TOTP_CODE}"

# POST second factor to Authelia
TOTP_AUTH_RESPONSE=$(host_exec "curl -sk --max-time 15 -b /tmp/authelia-cookies-toggle.txt -c /tmp/authelia-cookies-toggle.txt -X POST -H 'Content-Type: application/json' -d '{\"token\":\"${TOTP_CODE}\",\"targetURL\":\"https://${TUNNEL_FQDN}/\"}' https://auth.${TEST_DOMAIN}/api/secondfactor/totp 2>/dev/null" || echo '{}')

TOTP_AUTH_STATUS=$(echo "$TOTP_AUTH_RESPONSE" | jq -r '.status' 2>/dev/null || echo "unknown")
if [ "$TOTP_AUTH_STATUS" = "OK" ]; then
  log_pass "Second factor authentication succeeded (TOTP accepted)"
else
  log_fail "Second factor authentication failed (status: $TOTP_AUTH_STATUS, response: $TOTP_AUTH_RESPONSE)"
fi

# ---------------------------------------------------------------------------
log_section "Verify traffic through nginx with full 2FA (re-enabled tunnel)"
# ---------------------------------------------------------------------------

# Fetch the tunnel URL through nginx with the fully authenticated session cookie
FULL_PATH_CONTENT=$(host_exec "curl -sk --max-time 15 -b /tmp/authelia-cookies-toggle.txt https://${TUNNEL_FQDN}/e2e-toggle-index.html 2>/dev/null" || echo "")
assert_contains "$FULL_PATH_CONTENT" "$MARKER" "Full-path tunnel traffic (nginx + Authelia 2FA) returns expected content" || true

# Clean up the cookie jar
host_exec "rm -f /tmp/authelia-cookies-toggle.txt 2>/dev/null || true" 2>/dev/null || true

end_test

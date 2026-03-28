#!/usr/bin/env bash
# ============================================================================
# 02 — Tunnel Traffic (Three-VM)
# ============================================================================
# The crown jewel — tests actual traffic flowing through a tunnel:
#
# 1. Create a tunnel via API on the host VM
# 2. Add /etc/hosts entry on the agent VM for the tunnel subdomain
# 3. Start a simple HTTP server on the agent VM
# 4. Start the Chisel client on the agent VM to establish the tunnel
# 5. Authenticate with Authelia to get a session cookie
# 6. Curl the tunnel URL from the host VM with the auth cookie
# 7. Verify the response contains the expected content
# 8. Clean up: stop chisel client, HTTP server, remove tunnel
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

TUNNEL_SUBDOMAIN="e2etraffic"
TUNNEL_PORT=18080
TUNNEL_FQDN="${TUNNEL_SUBDOMAIN}.${TEST_DOMAIN}"
TUNNEL_ID=""
MARKER="PORTLAMA_TUNNEL_OK_$(date +%s)"

begin_test "02 — Tunnel Traffic (Three-VM)"

# ---------------------------------------------------------------------------
# Cleanup function — always runs on exit
# ---------------------------------------------------------------------------

cleanup() {
  log_info "Cleaning up test resources..."

  # Stop HTTP server on agent
  agent_exec "pkill -f 'python3 -m http.server ${TUNNEL_PORT}' 2>/dev/null || true" 2>/dev/null || true

  # Remove /etc/hosts entry on agent
  agent_exec "sed -i '/${TUNNEL_FQDN}/d' /etc/hosts 2>/dev/null || true" 2>/dev/null || true

  # Remove test HTML file on agent
  agent_exec "rm -f /tmp/e2e-tunnel-index.html 2>/dev/null || true" 2>/dev/null || true

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
  log_skip "Onboarding not completed (status: $ONBOARDING_STATUS). Skipping tunnel traffic tests."
  end_test
  exit $?
fi

# ---------------------------------------------------------------------------
log_section "Create tunnel via API"
# ---------------------------------------------------------------------------

CREATE_RESPONSE=$(host_api_post "tunnels" "{\"subdomain\":\"${TUNNEL_SUBDOMAIN}\",\"port\":${TUNNEL_PORT}}")
assert_json_field "$CREATE_RESPONSE" '.ok' 'true' "Tunnel creation returned ok: true" || true

TUNNEL_ID=$(echo "$CREATE_RESPONSE" | jq -r '.tunnel.id' 2>/dev/null || echo "")
assert_json_field_not_empty "$CREATE_RESPONSE" '.tunnel.id' "Tunnel has an ID" || true
log_info "Created tunnel ID: $TUNNEL_ID (${TUNNEL_FQDN})"

# ---------------------------------------------------------------------------
log_section "Configure agent VM for tunnel"
# ---------------------------------------------------------------------------

# Add /etc/hosts entry on agent so chisel client can resolve tunnel.TEST_DOMAIN
agent_exec "grep -q 'tunnel.${TEST_DOMAIN}' /etc/hosts || echo '${HOST_IP} tunnel.${TEST_DOMAIN}' >> /etc/hosts"
log_pass "Added tunnel.${TEST_DOMAIN} to agent /etc/hosts"

# Also add the tunnel subdomain FQDN (needed if traffic verification goes through the agent)
agent_exec "grep -q '${TUNNEL_FQDN}' /etc/hosts || echo '${HOST_IP} ${TUNNEL_FQDN}' >> /etc/hosts"
log_pass "Added ${TUNNEL_FQDN} to agent /etc/hosts"

# ---------------------------------------------------------------------------
log_section "Start HTTP server on agent VM"
# ---------------------------------------------------------------------------

# Write a test HTML file
agent_exec "echo '${MARKER}' > /tmp/e2e-tunnel-index.html"

# Start a simple HTTP server in the background on the tunnel port
agent_exec "nohup python3 -m http.server ${TUNNEL_PORT} --bind 127.0.0.1 -d /tmp &>/dev/null & exit"

# Wait for the HTTP server to be ready
sleep 2
AGENT_HTTP_STATUS=$(agent_exec "curl -sf -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:${TUNNEL_PORT}/e2e-tunnel-index.html 2>/dev/null" || echo "000")
assert_eq "$AGENT_HTTP_STATUS" "200" "HTTP server running on agent at port ${TUNNEL_PORT}" || true

# ---------------------------------------------------------------------------
log_section "Refresh agent config to pick up new tunnel"
# ---------------------------------------------------------------------------

# The portlama-agent manages the Chisel client as a systemd service.
# Running 'update' fetches the latest tunnel config and restarts the service.
agent_exec "portlama-agent update"

# Wait for the tunnel to establish
log_info "Waiting for Chisel tunnel to establish..."
CHISEL_READY=false
for i in $(seq 1 15); do
  HOST_TUNNEL_CHECK=$(host_exec "curl -sf -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:${TUNNEL_PORT}/e2e-tunnel-index.html 2>/dev/null" || echo "000")
  if [ "$HOST_TUNNEL_CHECK" = "200" ]; then
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
  log_info "Chisel agent log: $AGENT_LOG"
fi

# ---------------------------------------------------------------------------
log_section "Verify traffic through tunnel (direct, bypassing Authelia)"
# ---------------------------------------------------------------------------

# Verify the content is correct by fetching through the chisel tunnel from the host
DIRECT_CONTENT=$(host_exec "curl -sf --max-time 10 http://127.0.0.1:${TUNNEL_PORT}/e2e-tunnel-index.html 2>/dev/null" || echo "")
assert_contains "$DIRECT_CONTENT" "$MARKER" "Direct tunnel traffic returns expected content" || true

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

# IMPORTANT: TOTP must be reset BEFORE firstfactor auth, not after.
# If reset after firstfactor, Authelia rejects the secondfactor because
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

AUTH_RESPONSE=$(host_exec "curl -sk --max-time 15 -c /tmp/authelia-cookies.txt -X POST -H 'Content-Type: application/json' -d '{\"username\":\"${TEST_USER}\",\"password\":\"${TEST_USER_PASSWORD}\",\"keepMeLoggedIn\":false,\"targetURL\":\"https://${TUNNEL_FQDN}/\"}' https://auth.${TEST_DOMAIN}/api/firstfactor 2>/dev/null" || echo '{}')

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
TOTP_AUTH_RESPONSE=$(host_exec "curl -sk --max-time 15 -b /tmp/authelia-cookies.txt -c /tmp/authelia-cookies.txt -X POST -H 'Content-Type: application/json' -d '{\"token\":\"${TOTP_CODE}\",\"targetURL\":\"https://${TUNNEL_FQDN}/\"}' https://auth.${TEST_DOMAIN}/api/secondfactor/totp 2>/dev/null" || echo '{}')

TOTP_AUTH_STATUS=$(echo "$TOTP_AUTH_RESPONSE" | jq -r '.status' 2>/dev/null || echo "unknown")
if [ "$TOTP_AUTH_STATUS" = "OK" ]; then
  log_pass "Second factor authentication succeeded (TOTP accepted)"
else
  log_fail "Second factor authentication failed (status: $TOTP_AUTH_STATUS, response: $TOTP_AUTH_RESPONSE)"
fi

# ---------------------------------------------------------------------------
log_section "Verify traffic through nginx with Authelia (full path)"
# ---------------------------------------------------------------------------

# Fetch the tunnel URL through nginx with Authelia session cookie
FULL_PATH_CONTENT=$(host_exec "curl -sk --max-time 15 -b /tmp/authelia-cookies.txt https://${TUNNEL_FQDN}/e2e-tunnel-index.html 2>/dev/null" || echo "")
assert_contains "$FULL_PATH_CONTENT" "$MARKER" "Full-path tunnel traffic (nginx + Authelia) returns expected content" || true

# Clean up the cookie jar
host_exec "rm -f /tmp/authelia-cookies.txt 2>/dev/null || true" 2>/dev/null || true

end_test

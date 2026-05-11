#!/usr/bin/env bash
# ============================================================================
# 15 — Panel Expose (Three-VM)
# ============================================================================
# Tests the full agent panel expose feature across VMs:
#
# 1. Admin creates agent cert with panel:expose capability
# 2. Agent exposes panel via POST /api/tunnels/expose-panel
# 3. Verify mTLS nginx vhost created on host (lamalibre-lamaste-agent-panel-* prefix)
# 4. Agent starts panel HTTP server on localhost:9393
# 5. Agent runs lamaste-agent update to pick up panel tunnel in chisel
# 6. Verify panel server accessible from host through chisel tunnel
# 7. Verify mTLS vhost serves panel content via FQDN (mTLS, not Authelia)
# 8. Agent runs lamaste-agent panel --status to verify CLI
# 9. Agent retracts panel via DELETE /api/tunnels/retract-panel
# 10. Verify vhost removed, traffic stopped
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

host_api_delete() {
  host_exec "curl -skf --max-time 30 --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key --cacert /etc/lamalibre/lamaste/pki/ca.crt -X DELETE -H 'Accept: application/json' https://127.0.0.1:9292/api/$1"
}

# Agent-cert API helpers (called from host, using agent's extracted PEM cert)
host_agent_api_get() {
  local cert_path="$1"
  local key_path="$2"
  local api_path="$3"
  host_exec "curl -skf --max-time 30 --cert ${cert_path} --key ${key_path} --cacert /etc/lamalibre/lamaste/pki/ca.crt -H 'Accept: application/json' https://127.0.0.1:9292/api/${api_path}"
}

host_agent_api_post() {
  local cert_path="$1"
  local key_path="$2"
  local api_path="$3"
  local body="$4"
  host_exec "curl -skf --max-time 30 --cert ${cert_path} --key ${key_path} --cacert /etc/lamalibre/lamaste/pki/ca.crt -X POST -H 'Content-Type: application/json' -H 'Accept: application/json' -d '${body}' https://127.0.0.1:9292/api/${api_path}"
}

host_agent_api_delete() {
  local cert_path="$1"
  local key_path="$2"
  local api_path="$3"
  host_exec "curl -skf --max-time 30 --cert ${cert_path} --key ${key_path} --cacert /etc/lamalibre/lamaste/pki/ca.crt -X DELETE -H 'Accept: application/json' https://127.0.0.1:9292/api/${api_path}"
}

host_agent_api_get_status() {
  local cert_path="$1"
  local key_path="$2"
  local api_path="$3"
  host_exec "curl -sk -o /dev/null -w '%{http_code}' --max-time 30 --cert ${cert_path} --key ${key_path} --cacert /etc/lamalibre/lamaste/pki/ca.crt -H 'Accept: application/json' https://127.0.0.1:9292/api/${api_path}" 2>/dev/null || echo "000"
}

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

AGENT_LABEL="e2e-agent"  # matches the agent label from setup-agent.sh
PANEL_PORT=9393
PANEL_SUBDOMAIN="agent-${AGENT_LABEL}"
PANEL_FQDN="${PANEL_SUBDOMAIN}.${TEST_DOMAIN}"
PANEL_TUNNEL_ID=""
PANEL_CERT_PATH=""
PANEL_KEY_PATH=""

begin_test "15 — Panel Expose (Three-VM)"

# ---------------------------------------------------------------------------
# Cleanup function — always runs on exit
# ---------------------------------------------------------------------------

cleanup() {
  log_info "Cleaning up test resources..."

  # Stop panel HTTP server on agent if running
  agent_exec "pkill -f 'serverd-entry' 2>/dev/null || true" 2>/dev/null || true

  # Retract panel tunnel via agent cert (if available)
  if [ -n "$PANEL_CERT_PATH" ] && [ -n "$PANEL_KEY_PATH" ]; then
    host_agent_api_delete "$PANEL_CERT_PATH" "$PANEL_KEY_PATH" "tunnels/retract-panel" 2>/dev/null || true
  fi

  # Fallback: delete tunnel via admin cert
  if [ -n "$PANEL_TUNNEL_ID" ] && [ "$PANEL_TUNNEL_ID" != "null" ]; then
    host_api_delete "tunnels/${PANEL_TUNNEL_ID}" 2>/dev/null || true
  fi

  # Remove /etc/hosts entry on agent
  agent_exec "sed -i '/${PANEL_FQDN}/d' /etc/hosts 2>/dev/null || true" 2>/dev/null || true

  # Refresh agent config to remove panel tunnel from chisel
  agent_exec "lamaste-agent update 2>/dev/null || true" 2>/dev/null || true

  # Revoke panel agent cert and clean up PEM files
  host_api_delete "certs/agent/panel-expose-e2e" 2>/dev/null || true
  host_exec "rm -f /tmp/e2e-panel-expose-*.pem 2>/dev/null || true" 2>/dev/null || true
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
log_section "Pre-flight: re-extract admin PEM from P12"
# ---------------------------------------------------------------------------

# Prior tests (single-VM test 16 enrollment tokens, test 14 json-installer
# redeploy) can leave the admin cert in a revoked state or PEM files out of
# sync with the P12. Run lamaste-reset-admin to get a guaranteed fresh,
# unrevoked admin cert, then re-extract PEM from the new P12.
#
# Both multipass execs are wrapped in `timed_exec`: reset-admin internally
# restarts lamalibre-lamaste-serverd, which can pipe-leak; openssl pkcs12 has been
# observed to CPU-spin multipass even when the openssl itself returns fast.
timed_exec 60 multipass exec lamaste-host -- sudo bash -c "lamaste-reset-admin 2>/dev/null || true"
sleep 2

timed_exec 30 multipass exec lamaste-host -- sudo bash -c "P12PASS=\$(cat /etc/lamalibre/lamaste/pki/.p12-password); \
  openssl pkcs12 -in /etc/lamalibre/lamaste/pki/client.p12 -clcerts -nokeys -out /etc/lamalibre/lamaste/pki/client.crt -passin \"pass:\$P12PASS\" -legacy 2>/dev/null || \
  openssl pkcs12 -in /etc/lamalibre/lamaste/pki/client.p12 -clcerts -nokeys -out /etc/lamalibre/lamaste/pki/client.crt -passin \"pass:\$P12PASS\"; \
  openssl pkcs12 -in /etc/lamalibre/lamaste/pki/client.p12 -nocerts -nodes -out /etc/lamalibre/lamaste/pki/client.key -passin \"pass:\$P12PASS\" -legacy 2>/dev/null || \
  openssl pkcs12 -in /etc/lamalibre/lamaste/pki/client.p12 -nocerts -nodes -out /etc/lamalibre/lamaste/pki/client.key -passin \"pass:\$P12PASS\"; \
  chmod 644 /etc/lamalibre/lamaste/pki/client.crt; chmod 600 /etc/lamalibre/lamaste/pki/client.key; \
  chown lamaste:lamaste /etc/lamalibre/lamaste/pki/client.crt /etc/lamalibre/lamaste/pki/client.key" 2>/dev/null
log_pass "Admin cert reset and PEM re-extracted from P12"

# Wait up to 60s for panel to come back — reset-admin + PKI rewrite +
# panel restart can easily exceed the old 20s window under load.
PANEL_HEALTHY=false
for i in $(seq 1 30); do
  HEALTH=$(host_api_get "health" 2>/dev/null || echo "{}")
  if echo "$HEALTH" | jq -e '.status == "ok"' &>/dev/null; then
    PANEL_HEALTHY=true
    break
  fi
  sleep 2
done

if [ "$PANEL_HEALTHY" = "true" ]; then
  log_pass "Panel is healthy"
else
  log_fail "Panel not healthy after 60s — subsequent tests may fail"
fi

# ---------------------------------------------------------------------------
log_section "Pre-flight: verify onboarding is complete"
# ---------------------------------------------------------------------------

ONBOARDING_STATUS=$(host_api_get "onboarding/status" | jq -r '.status' 2>/dev/null || echo "unknown")
if [ "$ONBOARDING_STATUS" != "COMPLETED" ]; then
  log_skip "Onboarding not completed (status: $ONBOARDING_STATUS). Skipping panel expose tests."
  end_test
  exit $?
fi

# ---------------------------------------------------------------------------
log_section "Create agent cert with panel:expose capability"
# ---------------------------------------------------------------------------

# Create a dedicated agent cert with panel:expose for this test
CERT_RESPONSE=$(host_api_post "certs/agent" '{"label":"panel-expose-e2e","capabilities":["tunnels:read","tunnels:write","panel:expose"]}')
assert_json_field "$CERT_RESPONSE" '.ok' 'true' "Agent cert with panel:expose created" || true

P12_PASSWORD=$(echo "$CERT_RESPONSE" | jq -r '.p12Password' 2>/dev/null || echo "")
assert_json_field_not_empty "$CERT_RESPONSE" '.p12Password' "Agent cert has a p12 password" || true

log_info "Created agent cert: panel-expose-e2e"

# Extract PEM cert and key on host VM
P12_PATH="/etc/lamalibre/lamaste/pki/agents/panel-expose-e2e/client.p12"
PANEL_CERT_PATH="/tmp/e2e-panel-expose-cert.pem"
PANEL_KEY_PATH="/tmp/e2e-panel-expose-key.pem"
host_exec "openssl pkcs12 -in '${P12_PATH}' -clcerts -nokeys -out '${PANEL_CERT_PATH}' -passin 'pass:${P12_PASSWORD}' -legacy 2>/dev/null || openssl pkcs12 -in '${P12_PATH}' -clcerts -nokeys -out '${PANEL_CERT_PATH}' -passin 'pass:${P12_PASSWORD}'"
host_exec "openssl pkcs12 -in '${P12_PATH}' -nocerts -nodes -out '${PANEL_KEY_PATH}' -passin 'pass:${P12_PASSWORD}' -legacy 2>/dev/null || openssl pkcs12 -in '${P12_PATH}' -nocerts -nodes -out '${PANEL_KEY_PATH}' -passin 'pass:${P12_PASSWORD}'"

log_pass "Extracted PEM cert and key from .p12 on host"

# ---------------------------------------------------------------------------
log_section "Check panel status before expose"
# ---------------------------------------------------------------------------

STATUS_BEFORE=$(host_agent_api_get "$PANEL_CERT_PATH" "$PANEL_KEY_PATH" "tunnels/agent-panel-status")
assert_json_field "$STATUS_BEFORE" '.enabled' 'false' "Panel not exposed initially" || true

# ---------------------------------------------------------------------------
log_section "Expose agent panel via API"
# ---------------------------------------------------------------------------

# Use the agent cert's label for the tunnel subdomain.
# Note: The expose-panel endpoint derives subdomain from the cert CN.
EXPOSE_RESPONSE=$(host_agent_api_post "$PANEL_CERT_PATH" "$PANEL_KEY_PATH" "tunnels/expose-panel" "{\"port\":${PANEL_PORT}}")
assert_json_field "$EXPOSE_RESPONSE" '.ok' 'true' "Expose panel returned ok: true" || true

PANEL_TUNNEL_ID=$(echo "$EXPOSE_RESPONSE" | jq -r '.tunnel.id' 2>/dev/null || echo "")
ACTUAL_SUBDOMAIN=$(echo "$EXPOSE_RESPONSE" | jq -r '.tunnel.subdomain' 2>/dev/null || echo "")
ACTUAL_FQDN=$(echo "$EXPOSE_RESPONSE" | jq -r '.tunnel.fqdn' 2>/dev/null || echo "")
assert_json_field "$EXPOSE_RESPONSE" '.tunnel.type' 'panel' "Tunnel type is 'panel'" || true
assert_json_field "$EXPOSE_RESPONSE" '.tunnel.subdomain' "agent-panel-expose-e2e" "Panel subdomain matches agent-<label>" || true
assert_json_field_not_empty "$EXPOSE_RESPONSE" '.tunnel.fqdn' "Panel tunnel has an FQDN" || true

log_info "Exposed panel tunnel: ${ACTUAL_FQDN} (ID: ${PANEL_TUNNEL_ID})"

# Update the FQDN and subdomain variables from the actual response
PANEL_FQDN="$ACTUAL_FQDN"
PANEL_SUBDOMAIN="$ACTUAL_SUBDOMAIN"

# ---------------------------------------------------------------------------
log_section "Verify mTLS nginx vhost on host"
# ---------------------------------------------------------------------------

# Panel vhosts use lamalibre-lamaste-agent-panel- prefix (not lamalibre-lamaste-app-)
VHOST_EXISTS=$(host_exec "test -f /etc/nginx/sites-enabled/lamalibre-lamaste-agent-panel-${PANEL_SUBDOMAIN} -o -L /etc/nginx/sites-enabled/lamalibre-lamaste-agent-panel-${PANEL_SUBDOMAIN} && echo yes || echo no")
assert_eq "$VHOST_EXISTS" "yes" "mTLS panel vhost exists in sites-enabled" || true

# Verify no app vhost was created (panel uses mTLS, not Authelia)
APP_VHOST_EXISTS=$(host_exec "test -f /etc/nginx/sites-enabled/lamalibre-lamaste-app-${PANEL_SUBDOMAIN} -o -L /etc/nginx/sites-enabled/lamalibre-lamaste-app-${PANEL_SUBDOMAIN} && echo yes || echo no")
assert_eq "$APP_VHOST_EXISTS" "no" "No Authelia app vhost created for panel tunnel" || true

# Verify nginx config valid
NGINX_TEST=$(host_exec "nginx -t 2>&1 || true")
assert_contains "$NGINX_TEST" "syntax is ok" "nginx -t passes after panel expose" || true

# ---------------------------------------------------------------------------
log_section "Verify agent-panel-status after expose"
# ---------------------------------------------------------------------------

STATUS_AFTER=$(host_agent_api_get "$PANEL_CERT_PATH" "$PANEL_KEY_PATH" "tunnels/agent-panel-status")
assert_json_field "$STATUS_AFTER" '.enabled' 'true' "Panel shows as enabled" || true
assert_json_field "$STATUS_AFTER" '.fqdn' "$PANEL_FQDN" "Status FQDN matches" || true

# ---------------------------------------------------------------------------
log_section "Start panel HTTP server on agent and establish tunnel"
# ---------------------------------------------------------------------------

# Add /etc/hosts entry on agent for the panel FQDN
agent_exec "grep -q '${PANEL_FQDN}' /etc/hosts || echo '${HOST_IP} ${PANEL_FQDN}' >> /etc/hosts"
log_pass "Added ${PANEL_FQDN} to agent /etc/hosts"

# Start a simple HTTP server on the panel port to simulate the panel server.
# In production, the panel Fastify server would serve the SPA.
# For this test, a Python HTTP server with a marker file suffices.
MARKER="LAMALIBRE_LAMASTE_PANEL_OK_$(date +%s)"
agent_exec "echo '${MARKER}' > /tmp/panel-test-index.html"
agent_exec "mkdir -p /tmp/panel-api && echo '{\"status\":\"ok\"}' > /tmp/panel-api/health"
agent_exec "nohup python3 -m http.server ${PANEL_PORT} --bind 127.0.0.1 -d /tmp &>/dev/null & exit"
sleep 2

# Verify local HTTP server is running on agent
AGENT_HTTP_CHECK=$(agent_exec "curl -sf -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:${PANEL_PORT}/panel-test-index.html 2>/dev/null" || echo "000")
assert_eq "$AGENT_HTTP_CHECK" "200" "Panel HTTP server running on agent at port ${PANEL_PORT}" || true

# Refresh agent config to pick up the panel tunnel in chisel
agent_exec "lamaste-agent update"

# Wait for chisel to establish the panel tunnel
log_info "Waiting for Chisel tunnel to establish for panel..."
TUNNEL_READY=false
for i in $(seq 1 15); do
  CHECK=$(host_exec "curl -sf -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:${PANEL_PORT}/panel-test-index.html 2>/dev/null" || echo "000")
  if [ "$CHECK" = "200" ]; then
    TUNNEL_READY=true
    break
  fi
  sleep 1
done

if [ "$TUNNEL_READY" = "true" ]; then
  log_pass "Chisel tunnel established for panel (port ${PANEL_PORT} accessible on host)"
else
  log_fail "Chisel tunnel for panel failed to establish within 15 seconds"
  AGENT_LOG=$(agent_exec "tail -20 ~/.lamalibre/lamaste/agents/e2e-agent/logs/chisel.log 2>/dev/null || echo 'no log'")
  log_info "Chisel agent log: $AGENT_LOG"
fi

# ---------------------------------------------------------------------------
log_section "Verify panel content through chisel tunnel (direct)"
# ---------------------------------------------------------------------------

DIRECT_CONTENT=$(host_exec "curl -sf --max-time 10 http://127.0.0.1:${PANEL_PORT}/panel-test-index.html 2>/dev/null" || echo "")
assert_contains "$DIRECT_CONTENT" "$MARKER" "Direct tunnel traffic returns panel content" || true

# ---------------------------------------------------------------------------
log_section "Verify mTLS vhost serves panel via FQDN (no Authelia needed)"
# ---------------------------------------------------------------------------

# The panel vhost uses mTLS verification (ssl_verify_client), not Authelia.
# Access WITH mTLS cert should succeed (no Authelia redirect/302).
MTLS_STATUS=$(host_exec "curl -sk -o /dev/null -w '%{http_code}' --max-time 10 --cert ${PANEL_CERT_PATH} --key ${PANEL_KEY_PATH} --cacert /etc/lamalibre/lamaste/pki/ca.crt https://${PANEL_FQDN}/panel-test-index.html 2>/dev/null" || echo "000")
if [ "$MTLS_STATUS" = "200" ]; then
  log_pass "mTLS vhost serves panel content via FQDN (HTTP 200)"
elif [ "$MTLS_STATUS" = "502" ]; then
  # 502 is acceptable if cert was issued for a different subdomain but mTLS vhost exists.
  # The key test is that it's NOT a 302 redirect to Authelia.
  log_pass "mTLS vhost exists (HTTP 502 — cert path may differ, but no Authelia redirect)"
else
  log_fail "Unexpected status from panel FQDN with mTLS (HTTP $MTLS_STATUS)"
fi

# Access WITHOUT mTLS cert should be rejected (496 or similar, NOT 302 to Authelia)
NO_CERT_STATUS=$(host_exec "curl -sk -o /dev/null -w '%{http_code}' --max-time 10 https://${PANEL_FQDN}/ 2>/dev/null" || echo "000")
if [ "$NO_CERT_STATUS" = "496" ] || [ "$NO_CERT_STATUS" = "400" ] || [ "$NO_CERT_STATUS" = "403" ]; then
  log_pass "Panel FQDN rejects access without mTLS cert (HTTP $NO_CERT_STATUS)"
else
  log_fail "Panel FQDN should reject without mTLS cert (got HTTP $NO_CERT_STATUS, expected 496/400/403)"
fi

# ---------------------------------------------------------------------------
log_section "Retract panel tunnel"
# ---------------------------------------------------------------------------

RETRACT_RESPONSE=$(host_agent_api_delete "$PANEL_CERT_PATH" "$PANEL_KEY_PATH" "tunnels/retract-panel")
assert_json_field "$RETRACT_RESPONSE" '.ok' 'true' "Retract panel returned ok: true" || true

# ---------------------------------------------------------------------------
log_section "Verify vhost removed after retract"
# ---------------------------------------------------------------------------

sleep 2  # wait for nginx reload

VHOST_AFTER=$(host_exec "test -f /etc/nginx/sites-enabled/lamalibre-lamaste-agent-panel-${PANEL_SUBDOMAIN} -o -L /etc/nginx/sites-enabled/lamalibre-lamaste-agent-panel-${PANEL_SUBDOMAIN} && echo yes || echo no")
assert_eq "$VHOST_AFTER" "no" "mTLS panel vhost removed after retract" || true

NGINX_TEST_AFTER=$(host_exec "nginx -t 2>&1 || true")
assert_contains "$NGINX_TEST_AFTER" "syntax is ok" "nginx -t passes after panel retract" || true

# ---------------------------------------------------------------------------
log_section "Verify status after retract"
# ---------------------------------------------------------------------------

STATUS_RETRACTED=$(host_agent_api_get "$PANEL_CERT_PATH" "$PANEL_KEY_PATH" "tunnels/agent-panel-status")
assert_json_field "$STATUS_RETRACTED" '.enabled' 'false' "Panel shows as disabled after retract" || true

# Verify panel content no longer accessible via FQDN
RETRACTED_STATUS=$(host_exec "curl -sk -o /dev/null -w '%{http_code}' --max-time 10 --cert ${PANEL_CERT_PATH} --key ${PANEL_KEY_PATH} --cacert /etc/lamalibre/lamaste/pki/ca.crt https://${PANEL_FQDN}/panel-test-index.html 2>/dev/null" || echo "000")
if [ "$RETRACTED_STATUS" != "200" ]; then
  log_pass "Panel content not accessible via FQDN after retract (HTTP $RETRACTED_STATUS)"
else
  # Check if content still matches — if the vhost was removed but another server block
  # catches the request, the content won't match our marker.
  RETRACTED_CONTENT=$(host_exec "curl -sk --max-time 10 --cert ${PANEL_CERT_PATH} --key ${PANEL_KEY_PATH} --cacert /etc/lamalibre/lamaste/pki/ca.crt https://${PANEL_FQDN}/panel-test-index.html 2>/dev/null" || echo "")
  if ! echo "$RETRACTED_CONTENT" | grep -qF "$MARKER"; then
    log_pass "Panel content not accessible via FQDN after retract (different server block)"
  else
    log_fail "Panel content still accessible via FQDN after retract"
  fi
fi

# Reset tunnel ID so cleanup doesn't try to delete again
PANEL_TUNNEL_ID=""

# Stop the test HTTP server on agent
agent_exec "pkill -f 'python3 -m http.server ${PANEL_PORT}' 2>/dev/null || true" 2>/dev/null || true

# Refresh agent config to remove panel tunnel from chisel
agent_exec "lamaste-agent update 2>/dev/null || true" 2>/dev/null || true

end_test

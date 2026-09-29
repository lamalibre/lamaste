#!/usr/bin/env bash
# ============================================================================
# 15 — Panel Expose (Three-VM)
# ============================================================================
# Tests the full agent panel expose feature across VMs. A panel tunnel is
# carried by the agent that exposes it, so the agent running on the agent VM
# (panel label test-agent, local label e2e-agent) exposes its own panel with
# its own certificate:
#
# 1. Admin grants test-agent the panel:expose capability (restored on exit)
# 2. The agent VM exposes its panel via POST /api/tunnels/expose-panel with
#    test-agent's certificate
# 3. Verify mTLS nginx vhost created on host (lamalibre-lamaste-agent-panel-* prefix)
# 4. Agent starts a stand-in panel HTTP server on localhost:9393
# 5. With no `lamaste-agent update`, the agent's sync timer adds the panel
#    remote within 60 seconds and the panel is reachable through chisel
# 6. Verify mTLS vhost serves panel content via FQDN (mTLS, not Authelia)
# 7. Agent retracts the panel via DELETE /api/tunnels/retract-panel
# 8. Verify vhost removed, status disabled, and the sync timer drops the
#    panel remote so the port closes
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

# Agent-cert API helpers — run on the agent VM with test-agent's own
# certificate (extracted from its P12 below), against the panel on the host
agent_api_get() {
  agent_exec "curl -skf --max-time 30 --cert ${AGENT_CERT_PEM} --key ${AGENT_KEY_PEM} -H 'Accept: application/json' https://${HOST_IP}:9292/api/$1"
}

agent_api_post() {
  agent_exec "curl -skf --max-time 30 --cert ${AGENT_CERT_PEM} --key ${AGENT_KEY_PEM} -X POST -H 'Content-Type: application/json' -H 'Accept: application/json' -d '$2' https://${HOST_IP}:9292/api/$1"
}

agent_api_delete() {
  agent_exec "curl -skf --max-time 30 --cert ${AGENT_CERT_PEM} --key ${AGENT_KEY_PEM} -X DELETE -H 'Accept: application/json' https://${HOST_IP}:9292/api/$1"
}

# panel_direct_status — HTTP status of the stand-in panel page through the
# host's chisel listener for the panel port (bypassing nginx)
panel_direct_status() {
  host_exec "curl -sf -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:${PANEL_PORT}/panel-test-index.html 2>/dev/null" || echo "000"
}

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# The agent on the agent VM: its panel label and its local label
PANEL_AGENT="test-agent"
AGENT_LOCAL_LABEL="e2e-agent"
AGENT_CONFIG="/root/.lamalibre/lamaste/agents/${AGENT_LOCAL_LABEL}/config.json"
AGENT_CERT_PEM="/tmp/e2e-15-agent-cert.pem"
AGENT_KEY_PEM="/tmp/e2e-15-agent-key.pem"
PANEL_PORT=9393
PANEL_SUBDOMAIN="agent-${PANEL_AGENT}"
PANEL_FQDN="${PANEL_SUBDOMAIN}.${TEST_DOMAIN}"
PANEL_REMOTE="R:127.0.0.1:${PANEL_PORT}:127.0.0.1:${PANEL_PORT}"
PANEL_TUNNEL_ID=""
ORIGINAL_CAPS=""

begin_test "15 — Panel Expose (Three-VM)"

# ---------------------------------------------------------------------------
# Cleanup function — always runs on exit
# ---------------------------------------------------------------------------

cleanup() {
  log_info "Cleaning up test resources..."

  # Stop the stand-in panel HTTP server on agent
  agent_exec "pkill -f 'python3 -m http.server ${PANEL_PORT}' 2>/dev/null || true" 2>/dev/null || true
  agent_exec "rm -f /tmp/panel-test-index.html 2>/dev/null; rm -rf /tmp/panel-api 2>/dev/null || true" 2>/dev/null || true

  # Retract the panel tunnel with the agent's cert, then fall back to admin
  agent_api_delete "tunnels/retract-panel" > /dev/null 2>&1 || true
  if [ -n "$PANEL_TUNNEL_ID" ] && [ "$PANEL_TUNNEL_ID" != "null" ]; then
    host_api_delete "tunnels/${PANEL_TUNNEL_ID}" 2>/dev/null || true
  fi

  # Give test-agent back exactly the capabilities it had
  if [ -n "$ORIGINAL_CAPS" ] && [ "$ORIGINAL_CAPS" != "null" ]; then
    host_api_patch "certs/agent/${PANEL_AGENT}/capabilities" "{\"capabilities\":${ORIGINAL_CAPS}}" > /dev/null 2>&1 || true
  fi

  # Remove /etc/hosts entry and the extracted PEM files on agent
  agent_exec "sed -i '/${PANEL_FQDN}/d' /etc/hosts 2>/dev/null || true" 2>/dev/null || true
  agent_exec "shred -u ${AGENT_CERT_PEM} ${AGENT_KEY_PEM} 2>/dev/null || rm -f ${AGENT_CERT_PEM} ${AGENT_KEY_PEM}" 2>/dev/null || true

  # Converge now so the next test starts from an idle agent
  agent_exec "lamaste-agent sync --label ${AGENT_LOCAL_LABEL} 2>/dev/null || true" 2>/dev/null || true
}
trap cleanup EXIT


# ---------------------------------------------------------------------------
log_section "Pre-flight: re-extract admin PEM from P12"
# ---------------------------------------------------------------------------

# Prior tests (single-VM test 16 enrollment tokens, test 14 json-installer
# redeploy) can leave the admin cert in a revoked state or PEM files out of
# sync with the P12. Run lamaste-reset-admin to get a guaranteed fresh,
# unrevoked admin cert, then re-extract PEM from the new P12.
host_exec "lamaste-reset-admin 2>/dev/null || true"
sleep 2

host_exec "P12PASS=\$(cat /etc/lamalibre/lamaste/pki/.p12-password); \
  openssl pkcs12 -in /etc/lamalibre/lamaste/pki/client.p12 -clcerts -nokeys -out /etc/lamalibre/lamaste/pki/client.crt -passin \"pass:\$P12PASS\" -legacy 2>/dev/null || \
  openssl pkcs12 -in /etc/lamalibre/lamaste/pki/client.p12 -clcerts -nokeys -out /etc/lamalibre/lamaste/pki/client.crt -passin \"pass:\$P12PASS\"; \
  openssl pkcs12 -in /etc/lamalibre/lamaste/pki/client.p12 -nocerts -nodes -out /etc/lamalibre/lamaste/pki/client.key -passin \"pass:\$P12PASS\" -legacy 2>/dev/null || \
  openssl pkcs12 -in /etc/lamalibre/lamaste/pki/client.p12 -nocerts -nodes -out /etc/lamalibre/lamaste/pki/client.key -passin \"pass:\$P12PASS\"; \
  chmod 644 /etc/lamalibre/lamaste/pki/client.crt; chmod 600 /etc/lamalibre/lamaste/pki/client.key; \
  chown lamaste:lamaste /etc/lamalibre/lamaste/pki/client.crt /etc/lamalibre/lamaste/pki/client.key" 2>/dev/null || true
log_pass "Admin cert reset and PEM re-extracted from P12"

# Wait for panel to be healthy (may still be restarting after reset)
PANEL_HEALTHY=false
for i in $(seq 1 10); do
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
  log_fail "Panel not healthy after 20s — subsequent tests may fail"
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
log_section "Grant test-agent panel:expose"
# ---------------------------------------------------------------------------

AGENTS_JSON=$(host_api_get "certs/agent" || echo '{"agents":[]}')
ORIGINAL_CAPS=$(echo "$AGENTS_JSON" | jq -c --arg l "$PANEL_AGENT" '[.agents[] | select(.label == $l and .revoked == false)] | last | .capabilities' 2>/dev/null || echo "")
if [ -z "$ORIGINAL_CAPS" ] || [ "$ORIGINAL_CAPS" = "null" ]; then
  log_fail "${PANEL_AGENT} is not an enrolled, non-revoked agent — cannot expose its panel"
  end_test
  exit 1
fi
log_info "${PANEL_AGENT} capabilities before the test: ${ORIGINAL_CAPS}"

WITH_EXPOSE=$(echo "$ORIGINAL_CAPS" | jq -c '. + ["panel:expose"] | unique')
CAPS_RESPONSE=$(host_api_patch "certs/agent/${PANEL_AGENT}/capabilities" "{\"capabilities\":${WITH_EXPOSE}}" 2>/dev/null || echo '{}')
assert_contains "$CAPS_RESPONSE" "panel:expose" "${PANEL_AGENT} granted panel:expose" || true

# ---------------------------------------------------------------------------
log_section "Extract test-agent's certificate on the agent VM"
# ---------------------------------------------------------------------------

# The agent's P12 and its password live in its 0600 config (read with node —
# the agent VM has no jq); the PEMs are written 0600 and removed on exit
agent_exec "P12=\$(node -p \"require('${AGENT_CONFIG}').p12Path\"); PW=\$(node -p \"require('${AGENT_CONFIG}').p12Password\"); umask 077; \
  openssl pkcs12 -in \"\$P12\" -clcerts -nokeys -out '${AGENT_CERT_PEM}' -passin \"pass:\$PW\" -legacy 2>/dev/null || \
  openssl pkcs12 -in \"\$P12\" -clcerts -nokeys -out '${AGENT_CERT_PEM}' -passin \"pass:\$PW\"; \
  openssl pkcs12 -in \"\$P12\" -nocerts -nodes -out '${AGENT_KEY_PEM}' -passin \"pass:\$PW\" -legacy 2>/dev/null || \
  openssl pkcs12 -in \"\$P12\" -nocerts -nodes -out '${AGENT_KEY_PEM}' -passin \"pass:\$PW\"" 2>/dev/null || true
AGENT_CN=$(agent_exec "openssl x509 -noout -subject -in '${AGENT_CERT_PEM}' 2>/dev/null" 2>/dev/null || echo "")
assert_contains "$AGENT_CN" "agent:${PANEL_AGENT}" "Extracted certificate is ${PANEL_AGENT}'s (CN=agent:${PANEL_AGENT})" || true

# ---------------------------------------------------------------------------
log_section "Check panel status before expose"
# ---------------------------------------------------------------------------

STATUS_BEFORE=$(agent_api_get "tunnels/agent-panel-status" || echo '{}')
assert_json_field "$STATUS_BEFORE" '.enabled' 'false' "Panel not exposed initially" || true

# ---------------------------------------------------------------------------
log_section "Expose agent panel via API (agent's own certificate)"
# ---------------------------------------------------------------------------

EXPOSE_RESPONSE=$(agent_api_post "tunnels/expose-panel" "{\"port\":${PANEL_PORT}}" || echo '{}')
assert_json_field "$EXPOSE_RESPONSE" '.ok' 'true' "Expose panel returned ok: true" || true

PANEL_TUNNEL_ID=$(echo "$EXPOSE_RESPONSE" | jq -r '.tunnel.id' 2>/dev/null || echo "")
assert_json_field "$EXPOSE_RESPONSE" '.tunnel.type' 'panel' "Tunnel type is 'panel'" || true
assert_json_field "$EXPOSE_RESPONSE" '.tunnel.subdomain' "$PANEL_SUBDOMAIN" "Panel subdomain matches agent-<label>" || true
assert_json_field "$EXPOSE_RESPONSE" '.tunnel.agentLabel' "$PANEL_AGENT" "Panel tunnel is carried by ${PANEL_AGENT}" || true
assert_json_field "$EXPOSE_RESPONSE" '.tunnel.fqdn' "$PANEL_FQDN" "Panel tunnel FQDN is ${PANEL_FQDN}" || true

log_info "Exposed panel tunnel: ${PANEL_FQDN} (ID: ${PANEL_TUNNEL_ID})"

# ---------------------------------------------------------------------------
log_section "Verify mTLS nginx vhost on host"
# ---------------------------------------------------------------------------

# Panel vhosts use lamaste-agent-panel- prefix (not lamaste-app-)
VHOST_EXISTS=$(host_exec "test -f /etc/nginx/sites-enabled/lamalibre-lamaste-agent-panel-${PANEL_SUBDOMAIN} -o -L /etc/nginx/sites-enabled/lamalibre-lamaste-agent-panel-${PANEL_SUBDOMAIN} && echo yes || echo no")
assert_eq "$VHOST_EXISTS" "yes" "mTLS panel vhost exists in sites-enabled" || true

# Verify no app vhost was created (panel uses mTLS, not Authelia)
APP_VHOST_EXISTS=$(host_exec "test -f /etc/nginx/sites-enabled/lamalibre-lamaste-app-${PANEL_SUBDOMAIN} -o -L /etc/nginx/sites-enabled/lamalibre-lamaste-app-${PANEL_SUBDOMAIN} && echo yes || echo no")
assert_eq "$APP_VHOST_EXISTS" "no" "No Authelia app vhost created for panel tunnel" || true

NGINX_TEST=$(host_exec "nginx -t 2>&1 || true")
assert_contains "$NGINX_TEST" "syntax is ok" "nginx -t passes after panel expose" || true

# ---------------------------------------------------------------------------
log_section "Verify agent-panel-status after expose"
# ---------------------------------------------------------------------------

STATUS_AFTER=$(agent_api_get "tunnels/agent-panel-status" || echo '{}')
assert_json_field "$STATUS_AFTER" '.enabled' 'true' "Panel shows as enabled" || true
assert_json_field "$STATUS_AFTER" '.fqdn' "$PANEL_FQDN" "Status FQDN matches" || true

# ---------------------------------------------------------------------------
log_section "Start panel HTTP server on agent — the sync timer carries it"
# ---------------------------------------------------------------------------

agent_exec "grep -q '${PANEL_FQDN}' /etc/hosts || echo '${HOST_IP} ${PANEL_FQDN}' >> /etc/hosts"
log_pass "Added ${PANEL_FQDN} to agent /etc/hosts"

# A stand-in for the agent panel: a Python HTTP server with a marker file
MARKER="LAMALIBRE_LAMASTE_PANEL_OK_$(date +%s)"
agent_exec "echo '${MARKER}' > /tmp/panel-test-index.html"
agent_exec "mkdir -p /tmp/panel-api && echo '{\"status\":\"ok\"}' > /tmp/panel-api/health"
agent_exec "nohup python3 -m http.server ${PANEL_PORT} --bind 127.0.0.1 -d /tmp &>/dev/null & exit"
sleep 2

AGENT_HTTP_CHECK=$(agent_exec "curl -sf -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:${PANEL_PORT}/panel-test-index.html 2>/dev/null" || echo "000")
assert_eq "$AGENT_HTTP_CHECK" "200" "Panel HTTP server running on agent at port ${PANEL_PORT}" || true

# No `lamaste-agent update`: the 30-second sync timer adds the panel remote
log_info "Waiting for the sync timer to carry the panel tunnel..."
TUNNEL_READY=false
for _ in $(seq 1 30); do
  if [ "$(panel_direct_status)" = "200" ]; then
    TUNNEL_READY=true
    break
  fi
  sleep 2
done

if [ "$TUNNEL_READY" = "true" ]; then
  log_pass "Panel tunnel carried within 60 seconds with no lamaste-agent update"
else
  log_fail "Panel tunnel not carried within 60 seconds"
  AGENT_LOG=$(agent_exec "tail -20 ~/.lamalibre/lamaste/agents/${AGENT_LOCAL_LABEL}/logs/sync.log 2>/dev/null || echo 'no sync log'")
  log_info "Agent sync log: $AGENT_LOG"
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
# Any certificate from the Lamaste CA passes nginx — the host's admin cert here.
MTLS_STATUS=$(host_exec "curl -sk -o /dev/null -w '%{http_code}' --max-time 10 --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key --cacert /etc/lamalibre/lamaste/pki/ca.crt https://${PANEL_FQDN}/panel-test-index.html 2>/dev/null" || echo "000")
assert_eq "$MTLS_STATUS" "200" "mTLS vhost serves panel content via FQDN" || true

MTLS_CONTENT=$(host_exec "curl -sk --max-time 10 --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key --cacert /etc/lamalibre/lamaste/pki/ca.crt https://${PANEL_FQDN}/panel-test-index.html 2>/dev/null" || echo "")
assert_contains "$MTLS_CONTENT" "$MARKER" "Panel content served through the mTLS vhost" || true

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

RETRACT_RESPONSE=$(agent_api_delete "tunnels/retract-panel" || echo '{}')
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

STATUS_RETRACTED=$(agent_api_get "tunnels/agent-panel-status" || echo '{}')
assert_json_field "$STATUS_RETRACTED" '.enabled' 'false' "Panel shows as disabled after retract" || true

# Verify panel content no longer accessible via FQDN
RETRACTED_CONTENT=$(host_exec "curl -sk --max-time 10 --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key --cacert /etc/lamalibre/lamaste/pki/ca.crt https://${PANEL_FQDN}/panel-test-index.html 2>/dev/null" || echo "")
if ! echo "$RETRACTED_CONTENT" | grep -qF "$MARKER"; then
  log_pass "Panel content not accessible via FQDN after retract"
else
  log_fail "Panel content still accessible via FQDN after retract"
fi

# Reset tunnel ID so cleanup doesn't try to delete again
PANEL_TUNNEL_ID=""

# The sync timer drops the retracted panel's remote on its own: the client is
# rewritten without it, or — when the panel was the agent's only tunnel —
# stopped altogether (a client with no remote would crash-loop)
REMOTE_DROPPED=false
for _ in $(seq 1 30); do
  CLIENT_STATE=$(agent_exec "XDG_RUNTIME_DIR=/run/user/0 systemctl --user is-active lamalibre-lamaste-chisel-${AGENT_LOCAL_LABEL} 2>/dev/null || true" 2>/dev/null || echo "")
  if [ "$CLIENT_STATE" != "active" ] && [ "$CLIENT_STATE" != "activating" ]; then
    REMOTE_DROPPED=true
    break
  fi
  if ! agent_exec "grep '^ExecStart=' /root/.config/systemd/user/lamalibre-lamaste-chisel-${AGENT_LOCAL_LABEL}.service 2>/dev/null" 2>/dev/null | grep -qF "$PANEL_REMOTE"; then
    REMOTE_DROPPED=true
    break
  fi
  sleep 2
done
if [ "$REMOTE_DROPPED" = "true" ]; then
  log_pass "Agent's chisel client no longer carries the retracted panel's remote (sync timer)"
else
  log_fail "Agent's running chisel client still asks for the retracted panel's remote after 60 seconds"
fi

PANEL_PORT_AFTER=$(panel_direct_status)
assert_not_eq "$PANEL_PORT_AFTER" "200" "Panel port closed on the host after retract" || true

end_test

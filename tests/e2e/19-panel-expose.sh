#!/usr/bin/env bash
# ============================================================================
# 19 — Panel Expose Lifecycle
# ============================================================================
# Verifies the agent panel expose feature (server-side):
# - panel:expose capability exists in BASE_CAPABILITIES
# - POST /api/tunnels/expose-panel creates a panel tunnel with mTLS vhost
# - GET /api/tunnels/agent-panel-status returns panel tunnel status
# - DELETE /api/tunnels/retract-panel removes the panel tunnel
# - agent- subdomain prefix reserved for panel tunnels only
# - Panel tunnel type appears correctly in tunnel listing
# - Capability checks: 403 without panel:expose
# - Cross-agent spoofing prevention via generic POST /api/tunnels
# - PATCH panel tunnel requires panel:expose capability
# - DELETE panel tunnel requires panel:expose capability
# ============================================================================

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/helpers.sh"

require_commands curl jq

PANEL_PORT=19393
PANEL_TUNNEL_ID=""

begin_test "19 — Panel Expose Lifecycle"

# ---------------------------------------------------------------------------
log_section "Pre-flight: check onboarding is complete"
# ---------------------------------------------------------------------------

ONBOARDING_STATUS=$(api_get "onboarding/status" | jq -r '.status' 2>/dev/null || echo "unknown")
if [ "$ONBOARDING_STATUS" != "COMPLETED" ]; then
  log_info "Onboarding not completed (status: $ONBOARDING_STATUS). Panel expose requires onboarding."
  log_skip "Skipping panel expose tests — onboarding not complete"
  end_test
  exit $?
fi

# ---------------------------------------------------------------------------
log_section "Verify panel:expose is a valid capability"
# ---------------------------------------------------------------------------

# Create an agent cert with panel:expose — if the capability is invalid the
# server will reject it with a validation error.
AGENT_LABEL="panel-e2e-$(date +%s)"
CERT_RESPONSE=$(api_post "certs/agent" '{"label":"'"${AGENT_LABEL}"'","capabilities":["tunnels:read","panel:expose"]}')
assert_json_field "$CERT_RESPONSE" '.ok' 'true' "Agent cert with panel:expose created successfully" || true

P12_PASSWORD=$(echo "$CERT_RESPONSE" | jq -r '.p12Password' 2>/dev/null || echo "")
assert_json_field_not_empty "$CERT_RESPONSE" '.p12Password' "Agent cert has a p12 password" || true

log_info "Created agent cert: ${AGENT_LABEL}"

# Extract PEM cert and key from .p12 for use with curl
P12_PATH="/etc/lamalibre/lamaste/pki/agents/${AGENT_LABEL}/client.p12"
AGENT_CERT_PATH="/tmp/e2e-panel-cert.pem"
AGENT_KEY_PATH="/tmp/e2e-panel-key.pem"
sudo openssl pkcs12 -in "${P12_PATH}" -clcerts -nokeys -out "${AGENT_CERT_PATH}" -passin "pass:${P12_PASSWORD}" -legacy 2>/dev/null \
  || sudo openssl pkcs12 -in "${P12_PATH}" -clcerts -nokeys -out "${AGENT_CERT_PATH}" -passin "pass:${P12_PASSWORD}"
sudo openssl pkcs12 -in "${P12_PATH}" -nocerts -nodes -out "${AGENT_KEY_PATH}" -passin "pass:${P12_PASSWORD}" -legacy 2>/dev/null \
  || sudo openssl pkcs12 -in "${P12_PATH}" -nocerts -nodes -out "${AGENT_KEY_PATH}" -passin "pass:${P12_PASSWORD}"

log_pass "Extracted PEM cert and key from .p12"

# Agent cert curl helper
_agent_curl() {
  curl -s \
    --max-time "$CURL_TIMEOUT" \
    --insecure \
    --cert "$AGENT_CERT_PATH" \
    --key "$AGENT_KEY_PATH" \
    --cacert "$CA_PATH" \
    -H "Accept: application/json" \
    "$@"
}

agent_api_get() {
  _agent_curl "${BASE_URL}/api/$1"
}

agent_api_post() {
  local api_path="$1"
  local _default='{}'; local body="${2:-$_default}"
  _agent_curl \
    -X POST \
    -H "Content-Type: application/json" \
    -d "$body" \
    "${BASE_URL}/api/${api_path}"
}

agent_api_post_status() {
  local api_path="$1"
  local _default='{}'; local body="${2:-$_default}"
  _agent_curl -o /dev/null -w '%{http_code}' \
    -X POST \
    -H "Content-Type: application/json" \
    -d "$body" \
    "${BASE_URL}/api/${api_path}" 2>/dev/null || echo "000"
}

agent_api_delete() {
  _agent_curl -X DELETE "${BASE_URL}/api/$1"
}

agent_api_delete_status() {
  _agent_curl -o /dev/null -w '%{http_code}' -X DELETE "${BASE_URL}/api/$1" 2>/dev/null || echo "000"
}

agent_api_get_status() {
  _agent_curl -o /dev/null -w '%{http_code}' "${BASE_URL}/api/$1" 2>/dev/null || echo "000"
}

agent_api_patch_status() {
  local api_path="$1"
  local _default='{}'; local body="${2:-$_default}"
  _agent_curl -o /dev/null -w '%{http_code}' \
    -X PATCH \
    -H "Content-Type: application/json" \
    -d "$body" \
    "${BASE_URL}/api/${api_path}" 2>/dev/null || echo "000"
}

# Cleanup function — always runs on exit
cleanup() {
  log_info "Cleaning up test resources..."
  # Retract panel tunnel if it exists
  agent_api_delete "tunnels/retract-panel" 2>/dev/null || true
  # Also try admin delete in case agent delete fails
  if [ -n "$PANEL_TUNNEL_ID" ] && [ "$PANEL_TUNNEL_ID" != "null" ]; then
    api_delete "tunnels/${PANEL_TUNNEL_ID}" 2>/dev/null || true
  fi
  # Revoke agent certs
  api_delete "certs/agent/${AGENT_LABEL}" 2>/dev/null || true
  api_delete "certs/agent/nopanel-e2e" 2>/dev/null || true
  # Clean up PEM files
  sudo rm -f "${AGENT_CERT_PATH}" "${AGENT_KEY_PATH}" /tmp/e2e-nopanel-*.pem 2>/dev/null || true
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
log_section "Expose panel: check agent-panel-status before expose"
# ---------------------------------------------------------------------------

STATUS_BEFORE=$(agent_api_get "tunnels/agent-panel-status")
assert_json_field "$STATUS_BEFORE" '.enabled' 'false' "Panel not exposed initially" || true
assert_json_field "$STATUS_BEFORE" '.fqdn' 'null' "No FQDN before expose" || true

# ---------------------------------------------------------------------------
log_section "Expose panel: POST /api/tunnels/expose-panel"
# ---------------------------------------------------------------------------

EXPOSE_RESPONSE=$(agent_api_post "tunnels/expose-panel" "{\"port\":${PANEL_PORT}}")
assert_json_field "$EXPOSE_RESPONSE" '.ok' 'true' "Expose panel returned ok: true" || true
assert_json_field_not_empty "$EXPOSE_RESPONSE" '.tunnel.id' "Panel tunnel has an ID" || true
assert_json_field "$EXPOSE_RESPONSE" '.tunnel.type' 'panel' "Panel tunnel type is 'panel'" || true

PANEL_TUNNEL_ID=$(echo "$EXPOSE_RESPONSE" | jq -r '.tunnel.id' 2>/dev/null || echo "")
PANEL_FQDN=$(echo "$EXPOSE_RESPONSE" | jq -r '.tunnel.fqdn' 2>/dev/null || echo "")
PANEL_SUBDOMAIN=$(echo "$EXPOSE_RESPONSE" | jq -r '.tunnel.subdomain' 2>/dev/null || echo "")
assert_json_field "$EXPOSE_RESPONSE" '.tunnel.subdomain' "agent-${AGENT_LABEL}" "Panel subdomain matches agent-<label>" || true
assert_json_field "$EXPOSE_RESPONSE" '.tunnel.port' "$PANEL_PORT" "Panel tunnel port matches" || true
assert_json_field_not_empty "$EXPOSE_RESPONSE" '.tunnel.fqdn' "Panel tunnel has an FQDN" || true
assert_json_field_not_empty "$EXPOSE_RESPONSE" '.tunnel.createdAt' "Panel tunnel has a createdAt timestamp" || true
assert_json_field "$EXPOSE_RESPONSE" '.tunnel.agentLabel' "$AGENT_LABEL" "Panel tunnel agentLabel matches" || true

log_info "Exposed panel tunnel: ${PANEL_FQDN} (ID: ${PANEL_TUNNEL_ID})"

# ---------------------------------------------------------------------------
log_section "Verify panel tunnel in tunnel listing"
# ---------------------------------------------------------------------------

LIST_RESPONSE=$(api_get "tunnels")
FOUND_TYPE=$(echo "$LIST_RESPONSE" | jq -r --arg id "$PANEL_TUNNEL_ID" '.tunnels[] | select(.id == $id) | .type' 2>/dev/null || echo "")
assert_eq "$FOUND_TYPE" "panel" "Panel tunnel shows type 'panel' in listing" || true

FOUND_LABEL=$(echo "$LIST_RESPONSE" | jq -r --arg id "$PANEL_TUNNEL_ID" '.tunnels[] | select(.id == $id) | .agentLabel' 2>/dev/null || echo "")
assert_eq "$FOUND_LABEL" "$AGENT_LABEL" "Panel tunnel shows correct agentLabel in listing" || true

# ---------------------------------------------------------------------------
log_section "Verify nginx mTLS vhost created (not app vhost)"
# ---------------------------------------------------------------------------

VHOST_NAME="lamalibre-lamaste-agent-panel-${PANEL_SUBDOMAIN}"
VHOST_PATH="/etc/nginx/sites-enabled/${VHOST_NAME}"

if [ -f "$VHOST_PATH" ] || [ -L "$VHOST_PATH" ]; then
  log_pass "mTLS panel vhost exists at $VHOST_PATH"
else
  VHOST_ALT="/etc/nginx/sites-available/${VHOST_NAME}"
  if [ -f "$VHOST_ALT" ]; then
    log_pass "mTLS panel vhost exists at $VHOST_ALT"
  else
    log_fail "mTLS panel vhost not found at $VHOST_PATH"
  fi
fi

# Verify it is NOT an app vhost (app vhosts use lamaste-app- prefix)
APP_VHOST="/etc/nginx/sites-enabled/lamalibre-lamaste-app-${PANEL_SUBDOMAIN}"
if [ ! -f "$APP_VHOST" ] && [ ! -L "$APP_VHOST" ]; then
  log_pass "No app vhost created (correct — panel uses mTLS vhost)"
else
  log_fail "App vhost was created instead of mTLS panel vhost"
fi

# Verify nginx config is valid
NGINX_TEST=$(sudo nginx -t 2>&1 || true)
assert_contains "$NGINX_TEST" "syntax is ok" "nginx -t passes after panel expose" || true

# ---------------------------------------------------------------------------
log_section "Verify agent-panel-status after expose"
# ---------------------------------------------------------------------------

STATUS_AFTER=$(agent_api_get "tunnels/agent-panel-status")
assert_json_field "$STATUS_AFTER" '.enabled' 'true' "Panel shows as enabled after expose" || true
assert_json_field "$STATUS_AFTER" '.fqdn' "$PANEL_FQDN" "Panel status FQDN matches" || true
assert_json_field "$STATUS_AFTER" '.port' "$PANEL_PORT" "Panel status port matches" || true

# ---------------------------------------------------------------------------
log_section "Duplicate expose returns 409"
# ---------------------------------------------------------------------------

DUP_STATUS=$(agent_api_post_status "tunnels/expose-panel" "{\"port\":${PANEL_PORT}}")
assert_eq "$DUP_STATUS" "409" "Duplicate panel expose returns 409 Conflict" || true

# ---------------------------------------------------------------------------
log_section "Validation: agent- prefix reserved for non-panel tunnels"
# ---------------------------------------------------------------------------

RESERVED_STATUS=$(api_post_status "tunnels" "{\"subdomain\":\"agent-test\",\"port\":19999,\"description\":\"reserved test\"}")
assert_eq "$RESERVED_STATUS" "400" "agent- prefix rejected for non-panel tunnel (HTTP 400)" || true

# ---------------------------------------------------------------------------
log_section "Capability check: agent without panel:expose gets 403"
# ---------------------------------------------------------------------------

# Create agent cert WITHOUT panel:expose
NOPANEL_CERT_RESPONSE=$(api_post "certs/agent" '{"label":"nopanel-e2e","capabilities":["tunnels:read","tunnels:write"]}')
assert_json_field "$NOPANEL_CERT_RESPONSE" '.ok' 'true' "Agent cert without panel:expose created" || true

NOPANEL_P12_PW=$(echo "$NOPANEL_CERT_RESPONSE" | jq -r '.p12Password' 2>/dev/null || echo "")
NOPANEL_P12="/etc/lamalibre/lamaste/pki/agents/nopanel-e2e/client.p12"
NOPANEL_CERT="/tmp/e2e-nopanel-cert.pem"
NOPANEL_KEY="/tmp/e2e-nopanel-key.pem"
sudo openssl pkcs12 -in "${NOPANEL_P12}" -clcerts -nokeys -out "${NOPANEL_CERT}" -passin "pass:${NOPANEL_P12_PW}" -legacy 2>/dev/null \
  || sudo openssl pkcs12 -in "${NOPANEL_P12}" -clcerts -nokeys -out "${NOPANEL_CERT}" -passin "pass:${NOPANEL_P12_PW}"
sudo openssl pkcs12 -in "${NOPANEL_P12}" -nocerts -nodes -out "${NOPANEL_KEY}" -passin "pass:${NOPANEL_P12_PW}" -legacy 2>/dev/null \
  || sudo openssl pkcs12 -in "${NOPANEL_P12}" -nocerts -nodes -out "${NOPANEL_KEY}" -passin "pass:${NOPANEL_P12_PW}"

# Expose-panel should return 403
NOPANEL_EXPOSE_STATUS=$(curl -s -o /dev/null -w '%{http_code}' \
  --max-time "$CURL_TIMEOUT" --insecure \
  --cert "$NOPANEL_CERT" --key "$NOPANEL_KEY" --cacert "$CA_PATH" \
  -X POST -H "Content-Type: application/json" -d "{\"port\":${PANEL_PORT}}" \
  "${BASE_URL}/api/tunnels/expose-panel" 2>/dev/null || echo "000")
assert_eq "$NOPANEL_EXPOSE_STATUS" "403" "Expose panel returns 403 without panel:expose capability" || true

# Agent-panel-status should return 403
NOPANEL_STATUS=$(curl -s -o /dev/null -w '%{http_code}' \
  --max-time "$CURL_TIMEOUT" --insecure \
  --cert "$NOPANEL_CERT" --key "$NOPANEL_KEY" --cacert "$CA_PATH" \
  "${BASE_URL}/api/tunnels/agent-panel-status" 2>/dev/null || echo "000")
assert_eq "$NOPANEL_STATUS" "403" "Agent panel status returns 403 without panel:expose capability" || true

# Retract-panel should return 403
NOPANEL_RETRACT_STATUS=$(curl -s -o /dev/null -w '%{http_code}' \
  --max-time "$CURL_TIMEOUT" --insecure \
  --cert "$NOPANEL_CERT" --key "$NOPANEL_KEY" --cacert "$CA_PATH" \
  -X DELETE \
  "${BASE_URL}/api/tunnels/retract-panel" 2>/dev/null || echo "000")
assert_eq "$NOPANEL_RETRACT_STATUS" "403" "Retract panel returns 403 without panel:expose capability" || true

# ---------------------------------------------------------------------------
log_section "Capability check: PATCH panel tunnel requires panel:expose"
# ---------------------------------------------------------------------------

# Agent without panel:expose cannot toggle a panel tunnel
NOPANEL_TOGGLE_STATUS=$(curl -s -o /dev/null -w '%{http_code}' \
  --max-time "$CURL_TIMEOUT" --insecure \
  --cert "$NOPANEL_CERT" --key "$NOPANEL_KEY" --cacert "$CA_PATH" \
  -X PATCH -H "Content-Type: application/json" -d '{"enabled":false}' \
  "${BASE_URL}/api/tunnels/${PANEL_TUNNEL_ID}" 2>/dev/null || echo "000")
assert_eq "$NOPANEL_TOGGLE_STATUS" "403" "PATCH panel tunnel returns 403 without panel:expose" || true

# ---------------------------------------------------------------------------
log_section "Capability check: DELETE panel tunnel requires panel:expose"
# ---------------------------------------------------------------------------

NOPANEL_DELETE_STATUS=$(curl -s -o /dev/null -w '%{http_code}' \
  --max-time "$CURL_TIMEOUT" --insecure \
  --cert "$NOPANEL_CERT" --key "$NOPANEL_KEY" --cacert "$CA_PATH" \
  -X DELETE \
  "${BASE_URL}/api/tunnels/${PANEL_TUNNEL_ID}" 2>/dev/null || echo "000")
assert_eq "$NOPANEL_DELETE_STATUS" "403" "DELETE panel tunnel returns 403 without panel:expose" || true

# ---------------------------------------------------------------------------
log_section "Cross-agent spoofing: generic POST /api/tunnels with type=panel"
# ---------------------------------------------------------------------------

# Agent with panel:expose can only create panel tunnels matching their own label.
# Attempt to create a panel tunnel for a different agent (wrong subdomain).
SPOOF_STATUS=$(agent_api_post_status "tunnels" "{\"subdomain\":\"agent-evil-agent\",\"port\":19998,\"type\":\"panel\"}")
assert_eq "$SPOOF_STATUS" "403" "Cross-agent panel tunnel spoofing rejected (HTTP 403)" || true

# ---------------------------------------------------------------------------
log_section "Retract panel: DELETE /api/tunnels/retract-panel"
# ---------------------------------------------------------------------------

RETRACT_RESPONSE=$(agent_api_delete "tunnels/retract-panel")
assert_json_field "$RETRACT_RESPONSE" '.ok' 'true' "Retract panel returned ok: true" || true

# Verify panel tunnel is gone from listing
LIST_AFTER=$(api_get "tunnels")
FOUND_AFTER=$(echo "$LIST_AFTER" | jq -r --arg id "$PANEL_TUNNEL_ID" '.tunnels[] | select(.id == $id) | .id' 2>/dev/null || echo "")
assert_eq "$FOUND_AFTER" "" "Panel tunnel no longer in list after retract" || true

# Verify mTLS vhost removed
if [ ! -f "$VHOST_PATH" ] && [ ! -L "$VHOST_PATH" ]; then
  log_pass "mTLS panel vhost removed after retract"
else
  log_fail "mTLS panel vhost still exists after retract"
fi

# Verify nginx config still valid
NGINX_TEST_AFTER=$(sudo nginx -t 2>&1 || true)
assert_contains "$NGINX_TEST_AFTER" "syntax is ok" "nginx -t passes after panel retract" || true

# Reset tunnel ID so cleanup doesn't try to delete again
PANEL_TUNNEL_ID=""

# ---------------------------------------------------------------------------
log_section "Verify agent-panel-status after retract"
# ---------------------------------------------------------------------------

STATUS_RETRACTED=$(agent_api_get "tunnels/agent-panel-status")
assert_json_field "$STATUS_RETRACTED" '.enabled' 'false' "Panel shows as disabled after retract" || true

# ---------------------------------------------------------------------------
log_section "Retract nonexistent panel returns 404"
# ---------------------------------------------------------------------------

RETRACT_AGAIN_STATUS=$(agent_api_delete_status "tunnels/retract-panel")
assert_eq "$RETRACT_AGAIN_STATUS" "404" "Retract nonexistent panel returns 404" || true

# ---------------------------------------------------------------------------
log_section "Validation: expose-panel with invalid port"
# ---------------------------------------------------------------------------

INVALID_PORT_STATUS=$(agent_api_post_status "tunnels/expose-panel" '{"port":80}')
if [ "$INVALID_PORT_STATUS" = "400" ] || [ "$INVALID_PORT_STATUS" = "422" ]; then
  log_pass "Port below 1024 rejected (HTTP $INVALID_PORT_STATUS)"
else
  log_fail "Port below 1024 should be rejected (got HTTP $INVALID_PORT_STATUS)"
fi

end_test

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
# - Ownership: another agent cannot see, PATCH or DELETE a panel tunnel it
#   does not carry (404), and a panel tunnel cannot be reassigned or
#   reconfigured
# - PATCH/DELETE of a panel tunnel by its owner requires panel:expose
# - Agent-scoped tunnels: an agent creates tunnels it carries itself, sees
#   only its own tunnels and chisel config, cannot create a tunnel for
#   another agent, reassign a tunnel, or open its access mode; an agent may
#   set a body limit up to 100 MiB (above that is admin-only, 403)
# - expose-panel refuses the relay's reserved service ports (400)
# - Revoking an agent's certificate releases its tunnels: its panel tunnel
#   (agent-<label>) is deleted with its vhost, its app tunnels lose their
#   owner and chisel grant but keep their hostname
# ============================================================================

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/helpers.sh"

require_commands curl jq

PANEL_PORT=19393
PANEL_TUNNEL_ID=""
OWN_SUBDOMAIN="e2eown-$(date +%s)"
OWN_PORT=19981
OWN_TUNNEL_ID=""
# App tunnel owned by the panel agent, released when that agent is revoked
RELEASE_SUBDOMAIN="e2erelease-$(date +%s)"
RELEASE_PORT=19983
RELEASE_TUNNEL_ID=""

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
# server will reject it with a validation error. It also holds tunnels:write,
# so its generic POST /api/tunnels in the spoofing check below clears the
# capability gate and reaches the panel-label check it is meant to test.
AGENT_LABEL="panel-e2e-$(date +%s)"
CERT_RESPONSE=$(api_post "certs/agent" '{"label":"'"${AGENT_LABEL}"'","capabilities":["tunnels:read","tunnels:write","panel:expose"]}')
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
  # Delete the agent-owned tunnels before their owners are revoked
  if [ -n "$OWN_TUNNEL_ID" ] && [ "$OWN_TUNNEL_ID" != "null" ]; then
    api_delete "tunnels/${OWN_TUNNEL_ID}" 2>/dev/null || true
  fi
  if [ -n "$RELEASE_TUNNEL_ID" ] && [ "$RELEASE_TUNNEL_ID" != "null" ]; then
    api_delete "tunnels/${RELEASE_TUNNEL_ID}" 2>/dev/null || true
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

# Owned by a real agent so the rejection is for the prefix, not the owner
RESERVED_STATUS=$(api_post_status "tunnels" "{\"subdomain\":\"agent-test\",\"port\":19999,\"description\":\"reserved test\",\"agentLabel\":\"${AGENT_LABEL}\"}")
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
log_section "Ownership: another agent cannot see or change a panel tunnel"
# ---------------------------------------------------------------------------

# nopanel-e2e holds tunnels:write, so it passes the capability gate and the
# request reaches the ownership check. Another agent's tunnel does not exist
# as far as it is concerned.
NOPANEL_LIST=$(curl -s \
  --max-time "$CURL_TIMEOUT" --insecure \
  --cert "$NOPANEL_CERT" --key "$NOPANEL_KEY" --cacert "$CA_PATH" \
  -H "Accept: application/json" \
  "${BASE_URL}/api/tunnels" 2>/dev/null || echo '{}')
NOPANEL_SEES_PANEL=$(echo "$NOPANEL_LIST" | jq -r --arg id "$PANEL_TUNNEL_ID" '[.tunnels[]? | select(.id == $id)] | length' 2>/dev/null || echo "unknown")
assert_eq "$NOPANEL_SEES_PANEL" "0" "Another agent's GET /api/tunnels omits the panel tunnel" || true

NOPANEL_TOGGLE_STATUS=$(curl -s -o /dev/null -w '%{http_code}' \
  --max-time "$CURL_TIMEOUT" --insecure \
  --cert "$NOPANEL_CERT" --key "$NOPANEL_KEY" --cacert "$CA_PATH" \
  -X PATCH -H "Content-Type: application/json" -d '{"enabled":false}' \
  "${BASE_URL}/api/tunnels/${PANEL_TUNNEL_ID}" 2>/dev/null || echo "000")
assert_eq "$NOPANEL_TOGGLE_STATUS" "404" "Another agent's PATCH of the panel tunnel returns 404" || true

NOPANEL_DELETE_STATUS=$(curl -s -o /dev/null -w '%{http_code}' \
  --max-time "$CURL_TIMEOUT" --insecure \
  --cert "$NOPANEL_CERT" --key "$NOPANEL_KEY" --cacert "$CA_PATH" \
  -X DELETE \
  "${BASE_URL}/api/tunnels/${PANEL_TUNNEL_ID}" 2>/dev/null || echo "000")
assert_eq "$NOPANEL_DELETE_STATUS" "404" "Another agent's DELETE of the panel tunnel returns 404" || true

PANEL_STILL_THERE=$(api_get "tunnels" | jq -r --arg id "$PANEL_TUNNEL_ID" '.tunnels[] | select(.id == $id) | .enabled' 2>/dev/null || echo "")
assert_eq "$PANEL_STILL_THERE" "true" "Panel tunnel untouched by the other agent's attempts" || true

# A panel tunnel exposes one agent's own panel: it cannot move to another
# agent, and its vhost settings are fixed
PANEL_REASSIGN_STATUS=$(api_patch_status "tunnels/${PANEL_TUNNEL_ID}" '{"agentLabel":"nopanel-e2e"}')
assert_eq "$PANEL_REASSIGN_STATUS" "400" "Admin cannot reassign a panel tunnel (HTTP 400)" || true

PANEL_RECONFIGURE_STATUS=$(api_patch_status "tunnels/${PANEL_TUNNEL_ID}" '{"maxBodySizeMb":50}')
assert_eq "$PANEL_RECONFIGURE_STATUS" "400" "Admin cannot reconfigure a panel tunnel (HTTP 400)" || true

# ---------------------------------------------------------------------------
log_section "Capability check: owner without panel:expose cannot PATCH or DELETE its panel tunnel"
# ---------------------------------------------------------------------------

# Only the owning agent reaches the panel:expose gate on PATCH/DELETE. Drop the
# owner's panel:expose (it keeps tunnels:write, which the generic routes
# require), probe, then restore it for the retract steps below.
CAPS_DROP_STATUS=$(api_patch_status "certs/agent/${AGENT_LABEL}/capabilities" '{"capabilities":["tunnels:read","tunnels:write"]}')
assert_eq "$CAPS_DROP_STATUS" "200" "Owner's panel:expose capability removed" || true

OWNER_NOCAP_TOGGLE_STATUS=$(agent_api_patch_status "tunnels/${PANEL_TUNNEL_ID}" '{"enabled":false}')
assert_eq "$OWNER_NOCAP_TOGGLE_STATUS" "403" "PATCH own panel tunnel returns 403 without panel:expose" || true

OWNER_NOCAP_DELETE_STATUS=$(agent_api_delete_status "tunnels/${PANEL_TUNNEL_ID}")
assert_eq "$OWNER_NOCAP_DELETE_STATUS" "403" "DELETE own panel tunnel returns 403 without panel:expose" || true

CAPS_RESTORE_STATUS=$(api_patch_status "certs/agent/${AGENT_LABEL}/capabilities" '{"capabilities":["tunnels:read","tunnels:write","panel:expose"]}')
assert_eq "$CAPS_RESTORE_STATUS" "200" "Owner's panel:expose capability restored" || true

# ---------------------------------------------------------------------------
log_section "Ownership: agent-scoped tunnels"
# ---------------------------------------------------------------------------

_nopanel_curl() {
  curl -s \
    --max-time "$CURL_TIMEOUT" --insecure \
    --cert "$NOPANEL_CERT" --key "$NOPANEL_KEY" --cacert "$CA_PATH" \
    -H "Accept: application/json" \
    "$@"
}

# An agent creates a tunnel without naming an owner — it carries it itself
OWN_RESPONSE=$(_nopanel_curl -X POST -H "Content-Type: application/json" \
  -d "{\"subdomain\":\"${OWN_SUBDOMAIN}\",\"port\":${OWN_PORT},\"description\":\"agent-owned e2e tunnel\"}" \
  "${BASE_URL}/api/tunnels" 2>/dev/null || echo '{}')
assert_json_field "$OWN_RESPONSE" '.ok' 'true' "Agent created a tunnel without naming an owner" || true
assert_json_field "$OWN_RESPONSE" '.tunnel.agentLabel' "nopanel-e2e" "Agent-created tunnel is owned by the creating agent" || true
OWN_TUNNEL_ID=$(echo "$OWN_RESPONSE" | jq -r '.tunnel.id // empty' 2>/dev/null || echo "")

# An agent cannot create a tunnel for another agent
FOREIGN_CREATE_STATUS=$(_nopanel_curl -o /dev/null -w '%{http_code}' \
  -X POST -H "Content-Type: application/json" \
  -d "{\"subdomain\":\"e2eforeign\",\"port\":19982,\"agentLabel\":\"${AGENT_LABEL}\"}" \
  "${BASE_URL}/api/tunnels" 2>/dev/null || echo "000")
assert_eq "$FOREIGN_CREATE_STATUS" "403" "Agent POST naming another agent as owner returns 403" || true

if [ -n "$OWN_TUNNEL_ID" ]; then
  # Each agent's listing holds its own tunnels only
  OWN_LIST=$(_nopanel_curl "${BASE_URL}/api/tunnels" 2>/dev/null || echo '{}')
  OWN_LISTED=$(echo "$OWN_LIST" | jq -r --arg id "$OWN_TUNNEL_ID" '[.tunnels[]? | select(.id == $id)] | length' 2>/dev/null || echo "unknown")
  assert_eq "$OWN_LISTED" "1" "Agent's GET /api/tunnels lists its own tunnel" || true
  OWN_FOREIGN=$(echo "$OWN_LIST" | jq -r '[.tunnels[]? | select(.agentLabel != "nopanel-e2e")] | length' 2>/dev/null || echo "unknown")
  assert_eq "$OWN_FOREIGN" "0" "Agent's GET /api/tunnels holds no other agent's tunnel" || true

  PANEL_AGENT_LIST=$(agent_api_get "tunnels")
  PANEL_AGENT_SEES_OWN=$(echo "$PANEL_AGENT_LIST" | jq -r --arg id "$OWN_TUNNEL_ID" '[.tunnels[]? | select(.id == $id)] | length' 2>/dev/null || echo "unknown")
  assert_eq "$PANEL_AGENT_SEES_OWN" "0" "Other agent's GET /api/tunnels omits this agent's tunnel" || true

  # agent-config is always the calling agent's own config; ?agent= cannot widen it
  OWN_CONFIG=$(_nopanel_curl "${BASE_URL}/api/tunnels/agent-config" 2>/dev/null || echo '{}')
  assert_json_field "$OWN_CONFIG" '.agentLabel' "nopanel-e2e" "Agent's agent-config is its own" || true
  OWN_CONFIG_PORT=$(echo "$OWN_CONFIG" | jq -r --arg sd "$OWN_SUBDOMAIN" '.tunnels[]? | select(.subdomain == $sd) | .port' 2>/dev/null || echo "")
  assert_eq "$OWN_CONFIG_PORT" "$OWN_PORT" "Agent's agent-config lists its own tunnel" || true
  OWN_CONFIG_ARGS=$(echo "$OWN_CONFIG" | jq -r '.chiselArgs[]?' 2>/dev/null || echo "")
  assert_not_contains "$OWN_CONFIG_ARGS" ":${PANEL_PORT}:" "Agent's chiselArgs omit another agent's panel port" || true

  WIDEN_CONFIG=$(_nopanel_curl "${BASE_URL}/api/tunnels/agent-config?agent=${AGENT_LABEL}" 2>/dev/null || echo '{}')
  assert_json_field "$WIDEN_CONFIG" '.agentLabel' "nopanel-e2e" "agent-config?agent=<other> still returns the caller's own config" || true

  # Ownership and access mode are admin decisions
  OWN_REASSIGN_STATUS=$(_nopanel_curl -o /dev/null -w '%{http_code}' \
    -X PATCH -H "Content-Type: application/json" \
    -d "{\"agentLabel\":\"${AGENT_LABEL}\"}" \
    "${BASE_URL}/api/tunnels/${OWN_TUNNEL_ID}" 2>/dev/null || echo "000")
  assert_eq "$OWN_REASSIGN_STATUS" "403" "Agent cannot reassign its own tunnel (HTTP 403)" || true

  OWN_PUBLIC_STATUS=$(_nopanel_curl -o /dev/null -w '%{http_code}' \
    -X PATCH -H "Content-Type: application/json" \
    -d '{"accessMode":"public"}' \
    "${BASE_URL}/api/tunnels/${OWN_TUNNEL_ID}" 2>/dev/null || echo "000")
  assert_eq "$OWN_PUBLIC_STATUS" "403" "Agent cannot set its own tunnel's access mode to public (HTTP 403)" || true

  # The request body limit is the agent's own to set
  OWN_BODY_RESPONSE=$(_nopanel_curl -X PATCH -H "Content-Type: application/json" \
    -d '{"maxBodySizeMb":20}' \
    "${BASE_URL}/api/tunnels/${OWN_TUNNEL_ID}" 2>/dev/null || echo '{}')
  assert_json_field "$OWN_BODY_RESPONSE" '.tunnel.maxBodySizeMb' "20" "Agent can change its own tunnel's request body limit" || true
  assert_json_field "$OWN_BODY_RESPONSE" '.tunnel.accessMode' "restricted" "Agent's tunnel stays restricted" || true

  # Up to 100 MiB is the agent's call; above that only an administrator's
  OWN_BODY_MAX=$(_nopanel_curl -X PATCH -H "Content-Type: application/json" \
    -d '{"maxBodySizeMb":100}' \
    "${BASE_URL}/api/tunnels/${OWN_TUNNEL_ID}" 2>/dev/null || echo '{}')
  assert_json_field "$OWN_BODY_MAX" '.tunnel.maxBodySizeMb' "100" "Agent can set its tunnel's body limit to 100 MiB" || true
  OWN_BODY_OVER_STATUS=$(_nopanel_curl -o /dev/null -w '%{http_code}' \
    -X PATCH -H "Content-Type: application/json" \
    -d '{"maxBodySizeMb":101}' \
    "${BASE_URL}/api/tunnels/${OWN_TUNNEL_ID}" 2>/dev/null || echo "000")
  assert_eq "$OWN_BODY_OVER_STATUS" "403" "Agent cannot set a body limit above 100 MiB (HTTP 403)" || true
  OWN_BODY_AFTER=$(api_get "tunnels" | jq -r --arg id "$OWN_TUNNEL_ID" '.tunnels[] | select(.id == $id) | .maxBodySizeMb' 2>/dev/null || echo "")
  assert_eq "$OWN_BODY_AFTER" "100" "Refused body limit left the tunnel at 100 MiB" || true
  ADMIN_BODY_RESPONSE=$(api_patch "tunnels/${OWN_TUNNEL_ID}" '{"maxBodySizeMb":500}')
  assert_json_field "$ADMIN_BODY_RESPONSE" '.tunnel.maxBodySizeMb' "500" "An administrator can set a body limit above 100 MiB" || true
  OWN_CREATE_OVER_STATUS=$(_nopanel_curl -o /dev/null -w '%{http_code}' \
    -X POST -H "Content-Type: application/json" \
    -d '{"subdomain":"e2ebigbody","port":19984,"maxBodySizeMb":200}' \
    "${BASE_URL}/api/tunnels" 2>/dev/null || echo "000")
  assert_eq "$OWN_CREATE_OVER_STATUS" "403" "Agent cannot create a tunnel with a body limit above 100 MiB (HTTP 403)" || true
  BIG_BODY_LEFT=$(api_get "tunnels" | jq '[.tunnels[] | select(.subdomain == "e2ebigbody")] | length' 2>/dev/null || echo "unknown")
  assert_eq "$BIG_BODY_LEFT" "0" "Refused create left no tunnel behind" || true

  OWN_DELETE_RESPONSE=$(_nopanel_curl -X DELETE "${BASE_URL}/api/tunnels/${OWN_TUNNEL_ID}" 2>/dev/null || echo '{}')
  assert_json_field "$OWN_DELETE_RESPONSE" '.ok' 'true' "Agent deleted its own tunnel" || true
  OWN_TUNNEL_ID=""
else
  log_skip "Agent-owned tunnel was not created — skipping agent-scoped ownership checks"
fi

# ---------------------------------------------------------------------------
log_section "Cross-agent spoofing: generic POST /api/tunnels with type=panel"
# ---------------------------------------------------------------------------

# Agent with panel:expose can only create panel tunnels matching their own label.
# Attempt to create a panel tunnel for a different agent (wrong subdomain).
# The agent holds tunnels:write and panel:expose, so the 403 must come from
# the label check — asserted by its error message.
SPOOF_STATUS=$(agent_api_post_status "tunnels" "{\"subdomain\":\"agent-evil-agent\",\"port\":19998,\"type\":\"panel\"}")
assert_eq "$SPOOF_STATUS" "403" "Cross-agent panel tunnel spoofing rejected (HTTP 403)" || true

SPOOF_RESPONSE=$(agent_api_post "tunnels" "{\"subdomain\":\"agent-evil-agent\",\"port\":19998,\"type\":\"panel\"}")
assert_contains "$(echo "$SPOOF_RESPONSE" | jq -r '.error // empty' 2>/dev/null || echo "")" "only create panel tunnels for their own label" "Spoofing rejected by the panel-label check" || true

SPOOF_LEFT=$(api_get "tunnels" | jq '[.tunnels[] | select(.subdomain == "agent-evil-agent")] | length' 2>/dev/null || echo "unknown")
assert_eq "$SPOOF_LEFT" "0" "No spoofed panel tunnel was created" || true

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

# The relay's own service ports cannot carry an agent panel either
for reserved_port in 3100 9090 9091 9292 9294; do
  RESERVED_EXPOSE_STATUS=$(agent_api_post_status "tunnels/expose-panel" "{\"port\":${reserved_port}}")
  assert_eq "$RESERVED_EXPOSE_STATUS" "400" "expose-panel on reserved port ${reserved_port} rejected (HTTP 400)" || true
done
RESERVED_EXPOSED=$(agent_api_get "tunnels/agent-panel-status" | jq -r '.enabled' 2>/dev/null || echo "unknown")
assert_eq "$RESERVED_EXPOSED" "false" "Rejected expose-panel calls exposed nothing" || true

# ---------------------------------------------------------------------------
log_section "Revoking an agent releases its tunnels"
# ---------------------------------------------------------------------------

# The panel agent exposes its panel again and is given an app tunnel
REEXPOSE_RESPONSE=$(agent_api_post "tunnels/expose-panel" "{\"port\":${PANEL_PORT}}")
assert_json_field "$REEXPOSE_RESPONSE" '.ok' 'true' "Panel exposed again before revocation" || true
REEXPOSED_SUBDOMAIN=$(echo "$REEXPOSE_RESPONSE" | jq -r '.tunnel.subdomain // empty' 2>/dev/null || echo "")
PANEL_TUNNEL_ID=$(echo "$REEXPOSE_RESPONSE" | jq -r '.tunnel.id // empty' 2>/dev/null || echo "")

RELEASE_RESPONSE=$(api_post "tunnels" "{\"subdomain\":\"${RELEASE_SUBDOMAIN}\",\"port\":${RELEASE_PORT},\"description\":\"released on revoke\",\"agentLabel\":\"${AGENT_LABEL}\"}")
assert_json_field "$RELEASE_RESPONSE" '.tunnel.agentLabel' "$AGENT_LABEL" "App tunnel created for ${AGENT_LABEL}" || true
RELEASE_TUNNEL_ID=$(echo "$RELEASE_RESPONSE" | jq -r '.tunnel.id // empty' 2>/dev/null || echo "")

REVOKE_RESPONSE=$(api_delete "certs/agent/${AGENT_LABEL}")
assert_json_field "$REVOKE_RESPONSE" '.ok' 'true' "Agent ${AGENT_LABEL} revoked" || true

TUNNELS_AFTER_REVOKE=$(api_get "tunnels")
PANEL_LEFT=$(echo "$TUNNELS_AFTER_REVOKE" | jq --arg sd "$REEXPOSED_SUBDOMAIN" '[.tunnels[] | select(.subdomain == $sd)] | length' 2>/dev/null || echo "unknown")
assert_eq "$PANEL_LEFT" "0" "Revoked agent's panel tunnel (${REEXPOSED_SUBDOMAIN}) deleted" || true
if [ -n "$REEXPOSED_SUBDOMAIN" ] && [ ! -e "/etc/nginx/sites-enabled/lamalibre-lamaste-agent-panel-${REEXPOSED_SUBDOMAIN}" ] \
  && [ ! -e "/etc/nginx/sites-available/lamalibre-lamaste-agent-panel-${REEXPOSED_SUBDOMAIN}" ]; then
  log_pass "Revoked agent's panel vhost removed"
else
  log_fail "Revoked agent's panel vhost still present"
fi
PANEL_TUNNEL_ID=""

RELEASED=$(echo "$TUNNELS_AFTER_REVOKE" | jq -c --arg id "$RELEASE_TUNNEL_ID" '.tunnels[] | select(.id == $id)' 2>/dev/null || echo "")
assert_json_field "$RELEASED" '.subdomain' "$RELEASE_SUBDOMAIN" "Revoked agent's app tunnel keeps its hostname" || true
assert_json_field "$RELEASED" '.agentLabel // "none"' "none" "Revoked agent's app tunnel has no owner (dark until reassigned)" || true
RELEASED_GRANTS=$(sudo cat /etc/lamalibre/lamaste/chisel-users 2>/dev/null \
  | jq -r --arg g "^R:127\\.0\\.0\\.1:${RELEASE_PORT}\$" '[to_entries[] | select(any(.value[]; . == $g))] | length' 2>/dev/null || echo "unknown")
assert_eq "$RELEASED_GRANTS" "0" "Released tunnel's port is granted to no chisel user" || true

NGINX_TEST_REVOKE=$(sudo nginx -t 2>&1 || true)
assert_contains "$NGINX_TEST_REVOKE" "syntax is ok" "nginx -t passes after the revocation" || true

end_test

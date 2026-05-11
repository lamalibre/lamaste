#!/usr/bin/env bash
# ============================================================================
# 19 — Agent Plugin CRUD (Three-VM)
# ============================================================================
# Tests the agent panel plugin management API (port 9393):
#
# 1. Agent panel health check
# 2. GET /plugins — empty list
# 3. POST /plugins/install — validation (missing body, invalid name)
# 4. POST /plugins/:name/enable — nonexistent plugin returns 400
# 5. POST /plugins/:name/disable — nonexistent plugin returns 400
# 6. DELETE /plugins/:name — nonexistent plugin returns 400
# 7. GET /plugins/:name/check-update — nonexistent plugin returns 400
# 8. GET /plugins/:name/bundle — nonexistent plugin returns 404
# 9. Plugin name validation — reserved names, invalid chars
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

# Agent panel API helpers (port 9393, no mTLS — uses header-based auth)
AGENT_PANEL_PORT=9393
AGENT_LABEL="e2e-agent"

agent_panel_get() {
  agent_exec "curl -sf --max-time 30 -H 'X-SSL-Client-Verify: SUCCESS' -H 'X-SSL-Client-DN: CN=agent:${AGENT_LABEL}' -H 'Accept: application/json' http://127.0.0.1:${AGENT_PANEL_PORT}/api/$1"
}

agent_panel_get_status() {
  agent_exec "curl -s --max-time 30 -o /dev/null -w '%{http_code}' -H 'X-SSL-Client-Verify: SUCCESS' -H 'X-SSL-Client-DN: CN=agent:${AGENT_LABEL}' http://127.0.0.1:${AGENT_PANEL_PORT}/api/$1"
}

agent_panel_post() {
  agent_exec "curl -sf --max-time 30 -H 'X-SSL-Client-Verify: SUCCESS' -H 'X-SSL-Client-DN: CN=agent:${AGENT_LABEL}' -X POST -H 'Content-Type: application/json' -H 'Accept: application/json' -d '$2' http://127.0.0.1:${AGENT_PANEL_PORT}/api/$1"
}

agent_panel_post_status() {
  agent_exec "curl -s --max-time 30 -o /dev/null -w '%{http_code}' -H 'X-SSL-Client-Verify: SUCCESS' -H 'X-SSL-Client-DN: CN=agent:${AGENT_LABEL}' -X POST -H 'Content-Type: application/json' -d '$2' http://127.0.0.1:${AGENT_PANEL_PORT}/api/$1"
}

agent_panel_delete_status() {
  agent_exec "curl -s --max-time 30 -o /dev/null -w '%{http_code}' -H 'X-SSL-Client-Verify: SUCCESS' -H 'X-SSL-Client-DN: CN=agent:${AGENT_LABEL}' -X DELETE http://127.0.0.1:${AGENT_PANEL_PORT}/api/$1"
}

begin_test "19 — Agent Plugin CRUD"

# ---------------------------------------------------------------------------
log_section "Pre-flight: check onboarding is complete"
# ---------------------------------------------------------------------------

host_exec "curl -skf --max-time 10 --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key --cacert /etc/lamalibre/lamaste/pki/ca.crt https://127.0.0.1:9292/api/onboarding/status" | jq -r '.status' | grep -q COMPLETED || {
  log_skip "Onboarding not completed — skipping agent plugin CRUD tests"
  end_test
  exit $?
}
log_pass "Onboarding is complete"

# ---------------------------------------------------------------------------
log_section "Start agent panel service"
# ---------------------------------------------------------------------------

# Check if agent panel is already running
PANEL_HEALTH=$(agent_exec "curl -sf --max-time 5 http://127.0.0.1:${AGENT_PANEL_PORT}/api/health 2>/dev/null" || echo "")
if echo "$PANEL_HEALTH" | jq -r '.status' 2>/dev/null | grep -q "ok"; then
  log_pass "Agent panel already running on port ${AGENT_PANEL_PORT}"
else
  # Start the panel service
  agent_exec "lamaste-agent panel --enable --port ${AGENT_PANEL_PORT} 2>/dev/null" || true
  sleep 5
  PANEL_HEALTH=$(agent_exec "curl -sf --max-time 5 http://127.0.0.1:${AGENT_PANEL_PORT}/api/health 2>/dev/null" || echo "")
  if echo "$PANEL_HEALTH" | jq -r '.status' 2>/dev/null | grep -q "ok"; then
    log_pass "Agent panel started on port ${AGENT_PANEL_PORT}"
  else
    log_skip "Could not start agent panel service — skipping"
    end_test
    exit $?
  fi
fi

# ===========================================================================
# 1. GET /plugins — empty list initially
# ===========================================================================

log_section "GET /plugins — empty list"

PLUGINS_RESPONSE=$(agent_panel_get "plugins")
PLUGIN_COUNT=$(echo "$PLUGINS_RESPONSE" | jq '.plugins | length' 2>/dev/null || echo "-1")
assert_eq "$PLUGIN_COUNT" "0" "Plugin list is initially empty" || true

# ===========================================================================
# 2. POST /plugins/install — validation
# ===========================================================================

log_section "Install validation — missing body"

INSTALL_NO_BODY=$(agent_panel_post_status "plugins/install" '{}')
assert_eq "$INSTALL_NO_BODY" "400" "Install without packageName returns 400" || true

log_section "Install validation — non-lamalibre scope"

INSTALL_BAD_SCOPE=$(agent_panel_post_status "plugins/install" '{"packageName":"some-random-package"}')
assert_eq "$INSTALL_BAD_SCOPE" "400" "Install with non-@lamalibre/ scope returns 400" || true

# ===========================================================================
# 3. Plugin name validation — reserved names
# ===========================================================================

log_section "Plugin name validation — reserved names"

ENABLE_PLUGINS=$(agent_panel_post_status "plugins/plugins/enable" '{}')
assert_eq "$ENABLE_PLUGINS" "400" "Reserved name 'plugins' rejected" || true

ENABLE_AGENTS=$(agent_panel_post_status "plugins/agents/enable" '{}')
assert_eq "$ENABLE_AGENTS" "400" "Reserved name 'agents' rejected" || true

# ===========================================================================
# 4. Plugin name validation — invalid characters
# ===========================================================================

log_section "Plugin name validation — invalid characters"

ENABLE_DOTS=$(agent_panel_post_status "plugins/bad.name/enable" '{}')
assert_eq "$ENABLE_DOTS" "400" "Name with dots rejected" || true

ENABLE_SLASH=$(agent_panel_post_status "plugins/bad%2Fname/enable" '{}')
assert_eq "$ENABLE_SLASH" "400" "Name with slashes rejected" || true

ENABLE_UPPER=$(agent_panel_post_status "plugins/BadName/enable" '{}')
assert_eq "$ENABLE_UPPER" "400" "Uppercase name rejected" || true

# ===========================================================================
# 5. Enable/disable/delete nonexistent plugin
# ===========================================================================

log_section "Operations on nonexistent plugin"

ENABLE_MISSING=$(agent_panel_post_status "plugins/nonexistent/enable" '{}')
assert_eq "$ENABLE_MISSING" "400" "Enable nonexistent plugin returns 400" || true

DISABLE_MISSING=$(agent_panel_post_status "plugins/nonexistent/disable" '{}')
assert_eq "$DISABLE_MISSING" "400" "Disable nonexistent plugin returns 400" || true

DELETE_MISSING=$(agent_panel_delete_status "plugins/nonexistent")
assert_eq "$DELETE_MISSING" "400" "Delete nonexistent plugin returns 400" || true

# ===========================================================================
# 6. Check-update and bundle for nonexistent plugin
# ===========================================================================

log_section "Check-update and bundle for nonexistent plugin"

CHECK_UPDATE_MISSING=$(agent_panel_get_status "plugins/nonexistent/check-update")
assert_eq "$CHECK_UPDATE_MISSING" "400" "Check-update nonexistent returns 400" || true

BUNDLE_MISSING=$(agent_panel_get_status "plugins/nonexistent/bundle")
assert_eq "$BUNDLE_MISSING" "404" "Bundle nonexistent returns 404" || true

# ===========================================================================
# 7. Auth validation — no mTLS headers
# ===========================================================================

log_section "Auth validation — requests without mTLS headers"

NO_AUTH_STATUS=$(agent_exec "curl -s --max-time 10 -o /dev/null -w '%{http_code}' http://127.0.0.1:${AGENT_PANEL_PORT}/api/plugins")
assert_eq "$NO_AUTH_STATUS" "403" "Request without mTLS headers returns 403" || true

# Health endpoint should still be accessible without auth
HEALTH_NO_AUTH=$(agent_exec "curl -sf --max-time 10 http://127.0.0.1:${AGENT_PANEL_PORT}/api/health" | jq -r '.status' 2>/dev/null || echo "fail")
assert_eq "$HEALTH_NO_AUTH" "ok" "Health endpoint accessible without auth" || true

# ===========================================================================
# 8. Auth validation — wrong agent label
# ===========================================================================

log_section "Auth validation — wrong agent label"

WRONG_LABEL_STATUS=$(agent_exec "curl -s --max-time 10 -o /dev/null -w '%{http_code}' -H 'X-SSL-Client-Verify: SUCCESS' -H 'X-SSL-Client-DN: CN=agent:wrong-label' http://127.0.0.1:${AGENT_PANEL_PORT}/api/plugins")
assert_eq "$WRONG_LABEL_STATUS" "403" "Request with wrong agent label returns 403" || true

# Admin cert should be allowed
ADMIN_STATUS=$(agent_exec "curl -s --max-time 10 -o /dev/null -w '%{http_code}' -H 'X-SSL-Client-Verify: SUCCESS' -H 'X-SSL-Client-DN: CN=admin' http://127.0.0.1:${AGENT_PANEL_PORT}/api/plugins")
assert_eq "$ADMIN_STATUS" "200" "Admin cert is allowed to access agent panel" || true

end_test

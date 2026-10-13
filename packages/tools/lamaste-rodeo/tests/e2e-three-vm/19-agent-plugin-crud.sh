#!/usr/bin/env bash
# ============================================================================
# 19 — Agent Plugin CRUD (Three-VM)
# ============================================================================
# Tests the agent panel plugin management API (port 9393):
#
# 1. Agent panel health check (lamaste-agentd is installed on demand —
#    setup-agent.sh installs only the CLI — started with
#    `panel --enable --local-only`: the 9393 service without exposing it
#    through the host, stopped again on exit; plugin routes are driven as
#    the daemon's owner with the Bearer token of agentd.token, as the
#    desktop app does)
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

host_api_get() {
  host_exec "curl -skf --max-time 30 --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key --cacert /etc/lamalibre/lamaste/pki/ca.crt -H 'Accept: application/json' https://127.0.0.1:9292/api/$1"
}

# Agent panel API helpers (port 9393 on the agent VM). Plugin routes admit
# only the daemon's owner: the Bearer token in /root/.lamalibre/lamaste/agentd.token
# (0600), read on the agent VM inside the same command so it never leaves the
# VM — the way the desktop app drives the panel. An agent certificate, even
# the owner's, is refused there.
# AGENT_LABEL is the agent VM's local registry name; the host knows the agent
# by the label its enrollment token carried (agentLabel in config.json).
AGENT_PANEL_PORT=9393
AGENT_LABEL="e2e-agent"
AGENT_CONFIG="/root/.lamalibre/lamaste/agents/${AGENT_LABEL}/config.json"
HOST_AGENT_LABEL=""

# agent_config_field <field> — a top-level field of the agent's config.json
# (node: the agent VM has no jq)
agent_config_field() {
  agent_exec "node -p \"require('${AGENT_CONFIG}')['$1'] ?? ''\"" 2>/dev/null || echo ""
}

# wait_panel_healthy — the agent daemon restarts itself after a plugin
# enable or disable (unloadPanelService/loadPanelService), so a call made
# right after one may get an empty reply; poll /api/health for up to 20 s
wait_panel_healthy() {
  local health=""
  for _ in $(seq 1 20); do
    health=$(agent_exec "curl -sf --max-time 5 http://127.0.0.1:${AGENT_PANEL_PORT}/api/health 2>/dev/null" || echo "")
    if echo "$health" | jq -r '.status' 2>/dev/null | grep -q "ok"; then
      return 0
    fi
    sleep 1
  done
  return 1
}

cleanup() {
  # Stop the panel service started below (local-only: no host call).
  timed_exec 60 multipass exec lamaste-agent -- sudo bash -c "lamaste-agent panel --disable --local-only 2>/dev/null; true" > /dev/null 2>&1
}
trap cleanup EXIT

agent_panel_get() {
  agent_exec "curl -sf --max-time 30 -H \"Authorization: Bearer \$(node -e \"process.stdout.write(JSON.parse(require('fs').readFileSync('/root/.lamalibre/lamaste/agentd.token','utf8')).token)\")\" -H 'Accept: application/json' http://127.0.0.1:${AGENT_PANEL_PORT}/api/$1" 2>/dev/null || echo ""
}

agent_panel_get_status() {
  agent_exec "curl -s --max-time 30 -o /dev/null -w '%{http_code}' -H \"Authorization: Bearer \$(node -e \"process.stdout.write(JSON.parse(require('fs').readFileSync('/root/.lamalibre/lamaste/agentd.token','utf8')).token)\")\" http://127.0.0.1:${AGENT_PANEL_PORT}/api/$1" 2>/dev/null || echo "000"
}

agent_panel_post() {
  agent_exec "curl -sf --max-time 30 -H \"Authorization: Bearer \$(node -e \"process.stdout.write(JSON.parse(require('fs').readFileSync('/root/.lamalibre/lamaste/agentd.token','utf8')).token)\")\" -X POST -H 'Content-Type: application/json' -H 'Accept: application/json' -d '$2' http://127.0.0.1:${AGENT_PANEL_PORT}/api/$1" 2>/dev/null || echo ""
}

agent_panel_post_status() {
  agent_exec "curl -s --max-time 30 -o /dev/null -w '%{http_code}' -H \"Authorization: Bearer \$(node -e \"process.stdout.write(JSON.parse(require('fs').readFileSync('/root/.lamalibre/lamaste/agentd.token','utf8')).token)\")\" -X POST -H 'Content-Type: application/json' -d '$2' http://127.0.0.1:${AGENT_PANEL_PORT}/api/$1" 2>/dev/null || echo "000"
}

agent_panel_delete_status() {
  agent_exec "curl -s --max-time 30 -o /dev/null -w '%{http_code}' -H \"Authorization: Bearer \$(node -e \"process.stdout.write(JSON.parse(require('fs').readFileSync('/root/.lamalibre/lamaste/agentd.token','utf8')).token)\")\" -X DELETE http://127.0.0.1:${AGENT_PANEL_PORT}/api/$1" 2>/dev/null || echo "000"
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

HOST_AGENT_LABEL=$(agent_config_field "agentLabel")
HOST_AGENT_LABEL="${HOST_AGENT_LABEL:-test-agent}"
AGENT_ENROLLED=$(host_api_get "certs/agent" | jq -r '[.agents[]? | select(.label == "'"${HOST_AGENT_LABEL}"'" and (.revoked // false) == false)] | length' 2>/dev/null || echo "0")
if [ "$AGENT_ENROLLED" = "0" ]; then
  log_fail "${HOST_AGENT_LABEL} is not an enrolled, non-revoked agent on the host"
  end_test
  exit 1
fi

# Check if agent panel is already running
PANEL_HEALTH=$(agent_exec "curl -sf --max-time 5 http://127.0.0.1:${AGENT_PANEL_PORT}/api/health 2>/dev/null" || echo "")
if echo "$PANEL_HEALTH" | jq -r '.status' 2>/dev/null | grep -q "ok"; then
  log_pass "Agent panel already running on port ${AGENT_PANEL_PORT}"
else
  # The agent VM is set up with @lamalibre/lamaste-agent only; the panel
  # service is lamaste-agentd, installed here on demand from the registry
  # /root/.npmrc points @lamalibre at.
  AGENTD_PRESENT=$(agent_exec "command -v lamaste-agentd > /dev/null 2>&1 && echo yes || echo no")
  if [ "$AGENTD_PRESENT" != "yes" ]; then
    timed_exec 180 multipass exec lamaste-agent -- sudo bash -c "npm install -g @lamalibre/lamaste-agentd > /tmp/e2e-agentd-install.log 2>&1"
    AGENTD_PRESENT=$(agent_exec "command -v lamaste-agentd > /dev/null 2>&1 && echo yes || echo no")
  fi
  assert_eq "$AGENTD_PRESENT" "yes" "lamaste-agentd is installed on the agent VM" || true
  # Start the panel service
  agent_exec "lamaste-agent panel --enable --local-only --port ${AGENT_PANEL_PORT} 2>/dev/null" || true
  if wait_panel_healthy; then
    PANEL_HEALTH=$(agent_exec "curl -sf --max-time 5 http://127.0.0.1:${AGENT_PANEL_PORT}/api/health 2>/dev/null" || echo "")
  fi
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
# Enable/disable restart the daemon when they succeed; none of the above
# should, but poll back to health before the next section regardless.
wait_panel_healthy || true

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

log_section "Auth validation — requests without credentials"

NO_AUTH_STATUS=$(agent_exec "curl -s --max-time 10 -o /dev/null -w '%{http_code}' http://127.0.0.1:${AGENT_PANEL_PORT}/api/plugins")
assert_eq "$NO_AUTH_STATUS" "401" "Request without credentials returns 401" || true

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

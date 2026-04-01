#!/usr/bin/env bash
# ============================================================================
# 23 — Agent Plugin CRUD (Single-VM)
# ============================================================================
# Tests the agent panel plugin management API on the local machine.
# Starts the agent panel service on port 9393 and exercises:
#
# 1. Health check
# 2. GET /plugins — empty list
# 3. Install validation (missing body, invalid scope)
# 4. Plugin name validation (reserved names, invalid chars)
# 5. Enable/disable/delete nonexistent plugin
# 6. Check-update/bundle for nonexistent plugin
# 7. Auth validation (no headers, wrong label, admin allowed)
# ============================================================================

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/helpers.sh"

require_commands curl jq

begin_test "23 — Agent Plugin CRUD"

# ---------------------------------------------------------------------------
log_section "Pre-flight: check onboarding is complete"
# ---------------------------------------------------------------------------

ONBOARDING_STATUS=$(api_get "onboarding/status" | jq -r '.status' 2>/dev/null || echo "unknown")
if [ "$ONBOARDING_STATUS" != "COMPLETED" ]; then
  log_skip "Onboarding not completed — skipping agent plugin CRUD tests"
  end_test
  exit $?
fi
log_pass "Onboarding is complete"

# ---------------------------------------------------------------------------
log_section "Detect agent label and start panel service"
# ---------------------------------------------------------------------------

# Find the first agent label from the enrolled agents
AGENTS_DIR="/etc/portlama/pki/agents"
if [ ! -d "$AGENTS_DIR" ]; then
  log_skip "No agents directory found — skipping"
  end_test
  exit $?
fi

AGENT_LABEL=$(ls "$AGENTS_DIR" 2>/dev/null | head -1 || echo "")
if [ -z "$AGENT_LABEL" ]; then
  log_skip "No enrolled agent found — skipping"
  end_test
  exit $?
fi
log_info "Using agent label: ${AGENT_LABEL}"

PANEL_PORT=9393

# Check if agent panel is running; start if not
HEALTH=$(curl -sf --max-time 5 "http://127.0.0.1:${PANEL_PORT}/api/health" 2>/dev/null || echo "")
if echo "$HEALTH" | jq -r '.status' 2>/dev/null | grep -q "ok"; then
  log_pass "Agent panel already running"
else
  portlama-agent panel --enable --port ${PANEL_PORT} 2>/dev/null || true
  sleep 5
  HEALTH=$(curl -sf --max-time 5 "http://127.0.0.1:${PANEL_PORT}/api/health" 2>/dev/null || echo "")
  if echo "$HEALTH" | jq -r '.status' 2>/dev/null | grep -q "ok"; then
    log_pass "Agent panel started"
  else
    log_skip "Could not start agent panel service — skipping"
    end_test
    exit $?
  fi
fi

# Helpers for agent panel API (local, no mTLS — header-based auth)
ap_get() {
  curl -sf --max-time 30 \
    -H "X-SSL-Client-Verify: SUCCESS" \
    -H "X-SSL-Client-DN: CN=agent:${AGENT_LABEL}" \
    -H "Accept: application/json" \
    "http://127.0.0.1:${PANEL_PORT}/api/$1"
}

ap_get_status() {
  curl -s --max-time 30 -o /dev/null -w '%{http_code}' \
    -H "X-SSL-Client-Verify: SUCCESS" \
    -H "X-SSL-Client-DN: CN=agent:${AGENT_LABEL}" \
    "http://127.0.0.1:${PANEL_PORT}/api/$1"
}

ap_post_status() {
  curl -s --max-time 30 -o /dev/null -w '%{http_code}' \
    -H "X-SSL-Client-Verify: SUCCESS" \
    -H "X-SSL-Client-DN: CN=agent:${AGENT_LABEL}" \
    -X POST -H "Content-Type: application/json" \
    -d "$2" \
    "http://127.0.0.1:${PANEL_PORT}/api/$1"
}

ap_delete_status() {
  curl -s --max-time 30 -o /dev/null -w '%{http_code}' \
    -H "X-SSL-Client-Verify: SUCCESS" \
    -H "X-SSL-Client-DN: CN=agent:${AGENT_LABEL}" \
    -X DELETE \
    "http://127.0.0.1:${PANEL_PORT}/api/$1"
}

# ===========================================================================
# 1. GET /plugins — empty list
# ===========================================================================

log_section "GET /plugins"

PLUGINS=$(ap_get "plugins")
COUNT=$(echo "$PLUGINS" | jq '.plugins | length' 2>/dev/null || echo "-1")
assert_eq "$COUNT" "0" "Plugin list is initially empty" || true

# ===========================================================================
# 2. Install validation
# ===========================================================================

log_section "Install validation"

STATUS_NO_PKG=$(ap_post_status "plugins/install" '{}')
assert_eq "$STATUS_NO_PKG" "400" "Install without packageName returns 400" || true

STATUS_BAD_SCOPE=$(ap_post_status "plugins/install" '{"packageName":"bad-scope"}')
assert_eq "$STATUS_BAD_SCOPE" "400" "Install non-@lamalibre/ scope returns 400" || true

# ===========================================================================
# 3. Plugin name validation — reserved names
# ===========================================================================

log_section "Reserved plugin names"

for name in plugins agents tunnels services health settings identity storage; do
  STATUS=$(ap_post_status "plugins/${name}/enable" '{}')
  assert_eq "$STATUS" "400" "Reserved name '${name}' rejected on enable" || true
done

# ===========================================================================
# 4. Plugin name validation — invalid characters
# ===========================================================================

log_section "Invalid plugin names"

STATUS_DOTS=$(ap_post_status "plugins/has.dots/enable" '{}')
assert_eq "$STATUS_DOTS" "400" "Dots in name rejected" || true

STATUS_UPPER=$(ap_post_status "plugins/HasUpper/enable" '{}')
assert_eq "$STATUS_UPPER" "400" "Uppercase in name rejected" || true

# ===========================================================================
# 5. Operations on nonexistent plugin
# ===========================================================================

log_section "Nonexistent plugin operations"

assert_eq "$(ap_post_status "plugins/nosuch/enable" '{}')" "400" "Enable nonexistent → 400" || true
assert_eq "$(ap_post_status "plugins/nosuch/disable" '{}')" "400" "Disable nonexistent → 400" || true
assert_eq "$(ap_delete_status "plugins/nosuch")" "400" "Delete nonexistent → 400" || true
assert_eq "$(ap_get_status "plugins/nosuch/check-update")" "400" "Check-update nonexistent → 400" || true
assert_eq "$(ap_get_status "plugins/nosuch/bundle")" "404" "Bundle nonexistent → 404" || true

# ===========================================================================
# 6. Auth validation
# ===========================================================================

log_section "Auth validation"

# No auth headers → 403
NO_AUTH=$(curl -s --max-time 10 -o /dev/null -w '%{http_code}' \
  "http://127.0.0.1:${PANEL_PORT}/api/plugins")
assert_eq "$NO_AUTH" "403" "No mTLS headers → 403" || true

# Wrong agent label → 403
WRONG_LABEL=$(curl -s --max-time 10 -o /dev/null -w '%{http_code}' \
  -H "X-SSL-Client-Verify: SUCCESS" \
  -H "X-SSL-Client-DN: CN=agent:wrong-label" \
  "http://127.0.0.1:${PANEL_PORT}/api/plugins")
assert_eq "$WRONG_LABEL" "403" "Wrong agent label → 403" || true

# Admin cert → 200
ADMIN_OK=$(curl -s --max-time 10 -o /dev/null -w '%{http_code}' \
  -H "X-SSL-Client-Verify: SUCCESS" \
  -H "X-SSL-Client-DN: CN=admin" \
  "http://127.0.0.1:${PANEL_PORT}/api/plugins")
assert_eq "$ADMIN_OK" "200" "Admin cert → 200" || true

# Health endpoint — no auth needed
HEALTH_OK=$(curl -sf --max-time 10 "http://127.0.0.1:${PANEL_PORT}/api/health" | jq -r '.status' 2>/dev/null || echo "fail")
assert_eq "$HEALTH_OK" "ok" "Health endpoint needs no auth" || true

end_test

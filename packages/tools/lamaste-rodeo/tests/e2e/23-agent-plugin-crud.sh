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
# 7. Auth validation: the daemon's port is reachable by every process on the
#    machine, so headers that only claim a caller (X-SSL-Client-*,
#    Remote-User, a made-up relay assertion) and percent-escaped paths get
#    401; the owner's Bearer token (agentd.token) is admitted. The relay's
#    signed assertions are covered by three-VM spec 32.
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
AGENTS_DIR="/etc/lamalibre/lamaste/pki/agents"
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
  lamaste-agent panel --enable --port ${PANEL_PORT} 2>/dev/null || true
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

# Helpers for the agent panel API — local, as the daemon's owner: the Bearer
# token in ~/.lamalibre/lamaste/agentd.token (0600), as the desktop app does.
# The header comes from a file descriptor so the token is never in curl's
# arguments.
AGENTD_TOKEN_FILE="${HOME}/.lamalibre/lamaste/agentd.token"
agentd_auth_header() {
  printf 'Authorization: Bearer %s\n' "$(jq -r '.token' "$AGENTD_TOKEN_FILE")"
}

ap_get() {
  curl -sf --max-time 30 \
    -H @<(agentd_auth_header) \
    -H "Accept: application/json" \
    "http://127.0.0.1:${PANEL_PORT}/api/$1"
}

ap_get_status() {
  curl -s --max-time 30 -o /dev/null -w '%{http_code}' \
    -H @<(agentd_auth_header) \
    "http://127.0.0.1:${PANEL_PORT}/api/$1"
}

ap_post_status() {
  curl -s --max-time 30 -o /dev/null -w '%{http_code}' \
    -H @<(agentd_auth_header) \
    -X POST -H "Content-Type: application/json" \
    -d "$2" \
    "http://127.0.0.1:${PANEL_PORT}/api/$1"
}

ap_delete_status() {
  curl -s --max-time 30 -o /dev/null -w '%{http_code}' \
    -H @<(agentd_auth_header) \
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

# status_of <path> [curl args...] — HTTP status of an unauthenticated-looking request
status_of() {
  local path="$1"
  shift
  curl -s --max-time 10 -o /dev/null -w '%{http_code}' "$@" "http://127.0.0.1:${PANEL_PORT}${path}"
}

assert_eq "$(status_of /api/plugins)" "401" "No credential → 401" || true

# Anything on this machine can open 127.0.0.1:${PANEL_PORT} and send these
# headers — they prove nothing to the daemon
assert_eq "$(status_of /api/plugins -H 'X-SSL-Client-Verify: SUCCESS' -H 'X-SSL-Client-DN: CN=admin')" \
  "401" "Forged admin certificate headers → 401" || true
assert_eq "$(status_of /api/plugins -H 'X-SSL-Client-Verify: SUCCESS' -H "X-SSL-Client-DN: CN=agent:${AGENT_LABEL}")" \
  "401" "Forged agent certificate headers → 401" || true
assert_eq "$(status_of /api/status -H 'Remote-User: admin' -H 'Remote-Groups: admins')" \
  "401" "Forged Authelia identity headers → 401" || true
assert_eq "$(status_of /api/plugins -H 'X-Lamalibre-Relay-Assertion: forged.assertion')" \
  "401" "Made-up relay assertion → 401" || true

# The router decodes percent-escapes: /%61pi/... is routed as /api/...
# and must be authenticated like it
assert_eq "$(status_of /%61pi/status)" "401" "Percent-escaped /api path without credential → 401" || true

# The owner's token → 200
assert_eq "$(ap_get_status plugins)" "200" "Owner Bearer token → 200" || true

# Health endpoint — no auth needed
HEALTH_OK=$(curl -sf --max-time 10 "http://127.0.0.1:${PANEL_PORT}/api/health" | jq -r '.status' 2>/dev/null || echo "fail")
assert_eq "$HEALTH_OK" "ok" "Health endpoint needs no auth" || true

end_test

#!/usr/bin/env bash
# ============================================================================
# 24 — Agent-Side User Plugin Access (Single-VM)
# ============================================================================
# Tests the grant model expansion, plugin tunnel validation, and agent panel
# Remote-User auth restrictions.
# ============================================================================

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/helpers.sh"

require_commands curl jq

begin_test "24 — Agent-Side User Plugin Access"

# ---------------------------------------------------------------------------
log_section "Pre-flight: check onboarding is complete"
# ---------------------------------------------------------------------------

ONBOARDING_STATUS=$(api_get "onboarding/status" | jq -r '.status' 2>/dev/null || echo "unknown")
if [ "$ONBOARDING_STATUS" != "COMPLETED" ]; then
  log_skip "Onboarding not completed — skipping"
  end_test
  exit $?
fi
log_pass "Onboarding is complete"

# Detect agent label
AGENTS_DIR="/etc/lamalibre/lamaste/pki/agents"
AGENT_LABEL=""
if [ -d "$AGENTS_DIR" ]; then
  AGENT_LABEL=$(ls "$AGENTS_DIR" 2>/dev/null | head -1 || echo "")
fi
if [ -z "$AGENT_LABEL" ]; then
  log_skip "No enrolled agent found — skipping"
  end_test
  exit $?
fi
log_info "Using agent label: ${AGENT_LABEL}"

# ---------------------------------------------------------------------------
log_section "1. Grant creation with target field"
# ---------------------------------------------------------------------------

# Check if user-access routes are available (requires serverd >= 0.1.28)
UA_CHECK=$(api_get_status "user-access/grants")
if [ "$UA_CHECK" = "404" ]; then
  log_skip "User-access routes not available (serverd too old) — skipping grant tests"
  HAS_USER_ACCESS=false
else
  HAS_USER_ACCESS=true
fi

if [ "$HAS_USER_ACCESS" = "true" ]; then

# Create a local grant (default target)
LOCAL_STATUS=$(api_post_status "user-access/grants" '{"username":"e2e-local","pluginName":"@lamalibre/herd-server"}')
assert_eq "$LOCAL_STATUS" "200" "Create local grant (default target)" || true

# Create an agent-side grant
AGENT_RESULT=$(api_post "user-access/grants" "{\"username\":\"e2e-agent\",\"pluginName\":\"@lamalibre/herd-server\",\"target\":\"agent:${AGENT_LABEL}\"}" 2>/dev/null || echo '{"error":"sync failed"}')
AGENT_GRANT_ID=$(echo "$AGENT_RESULT" | jq -r '.grant.grantId // empty' 2>/dev/null || echo "")

if [ -n "$AGENT_GRANT_ID" ]; then
  log_pass "Create agent-side grant (target: agent:${AGENT_LABEL})"
else
  # May return 500 if Authelia sync fails in single-VM (expected without Authelia)
  SYNC_ERR=$(echo "$AGENT_RESULT" | jq -r '.error // empty' 2>/dev/null || echo "")
  if echo "$SYNC_ERR" | grep -qi "authelia\|sync"; then
    log_pass "Agent-side grant created but Authelia sync failed (expected in single-VM without Authelia)"
    # Re-create without Authelia — the grant was saved despite sync error
  else
    log_fail "Failed to create agent-side grant: ${AGENT_RESULT}"
  fi
fi

# List grants and verify target field
GRANTS=$(api_get "user-access/grants" 2>/dev/null || echo '{"grants":[]}')
HAS_TARGET=$(echo "$GRANTS" | jq '[.grants[] | select(.target != null)] | length' 2>/dev/null || echo "0")
assert_not_eq "$HAS_TARGET" "0" "Grants include target field" || true

# Verify agent-side grant is auto-consumed
AGENT_GRANT=$(echo "$GRANTS" | jq ".grants[] | select(.target == \"agent:${AGENT_LABEL}\")" 2>/dev/null || echo "")
if [ -n "$AGENT_GRANT" ]; then
  IS_USED=$(echo "$AGENT_GRANT" | jq -r '.used' 2>/dev/null || echo "")
  assert_eq "$IS_USED" "true" "Agent-side grant auto-consumed (used=true)" || true
  AGENT_GRANT_ID=$(echo "$AGENT_GRANT" | jq -r '.grantId' 2>/dev/null || echo "")
fi

# ---------------------------------------------------------------------------
log_section "2. Grant validation"
# ---------------------------------------------------------------------------

# Invalid target format
INVALID_STATUS=$(api_post_status "user-access/grants" '{"username":"e2e-bad","pluginName":"@lamalibre/herd-server","target":"invalid"}')
assert_eq "$INVALID_STATUS" "400" "Reject invalid target format" || true

# Empty agent label
EMPTY_STATUS=$(api_post_status "user-access/grants" '{"username":"e2e-bad","pluginName":"@lamalibre/herd-server","target":"agent:"}')
assert_eq "$EMPTY_STATUS" "400" "Reject empty agent label" || true

# ---------------------------------------------------------------------------
log_section "3. Agent-side grant revocation"
# ---------------------------------------------------------------------------

if [ -n "$AGENT_GRANT_ID" ]; then
  REV_STATUS=$(api_delete_status "user-access/grants/${AGENT_GRANT_ID}")
  # May return 200 (success) or 500 (Authelia sync failed) — both mean grant was revoked
  if [ "$REV_STATUS" = "200" ] || [ "$REV_STATUS" = "500" ]; then
    log_pass "Agent-side grant revoked (despite used=true) — status ${REV_STATUS}"
  else
    log_fail "Agent-side grant revocation unexpected status: ${REV_STATUS}"
  fi
else
  log_skip "No agent grant to revoke"
fi

fi # end HAS_USER_ACCESS

# ---------------------------------------------------------------------------
log_section "4. Plugin tunnel validation"
# ---------------------------------------------------------------------------

# Missing required fields for plugin tunnel
MISS_STATUS=$(api_post_status "tunnels" '{"subdomain":"test-plug","port":10060,"type":"plugin"}')
assert_eq "$MISS_STATUS" "400" "Reject plugin tunnel without pluginName/agentLabel" || true

# Reserved route prefix 'api'
API_STATUS=$(api_post_status "tunnels" "{\"subdomain\":\"test-api\",\"port\":10061,\"type\":\"plugin\",\"pluginName\":\"@lamalibre/api-server\",\"agentLabel\":\"${AGENT_LABEL}\"}")
assert_eq "$API_STATUS" "400" "Reject plugin tunnel with reserved route prefix 'api'" || true

# Invalid pluginName characters (semicolon — nginx injection attempt)
INJ_STATUS=$(api_post_status "tunnels" "{\"subdomain\":\"test-inj\",\"port\":10062,\"type\":\"plugin\",\"pluginName\":\"@lamalibre/bad;name\",\"agentLabel\":\"${AGENT_LABEL}\"}")
assert_eq "$INJ_STATUS" "400" "Reject plugin tunnel with invalid pluginName (injection attempt)" || true

# ---------------------------------------------------------------------------
log_section "5. Agent panel Remote-User auth"
# ---------------------------------------------------------------------------

PANEL_PORT=9393
HEALTH=$(curl -sf --max-time 5 "http://127.0.0.1:${PANEL_PORT}/api/health" 2>/dev/null || echo "")

if [ -z "$HEALTH" ]; then
  log_skip "Agent panel not running on port ${PANEL_PORT} — skipping Remote-User tests"
else
  # Remote-User blocked from /api/* management endpoints
  MGMT_STATUS=$(curl -s -o /dev/null -w '%{http_code}' \
    -H "Remote-User: testuser" \
    --max-time 5 \
    "http://127.0.0.1:${PANEL_PORT}/api/status" 2>/dev/null || echo "000")
  assert_eq "$MGMT_STATUS" "403" "Remote-User blocked from /api/status management endpoint" || true

  # Invalid Remote-User format rejected on plugin routes
  BAD_USER_STATUS=$(curl -s -o /dev/null -w '%{http_code}' \
    -H "Remote-User: bad<user>name" \
    --max-time 5 \
    "http://127.0.0.1:${PANEL_PORT}/herd/api/test" 2>/dev/null || echo "000")
  assert_eq "$BAD_USER_STATUS" "403" "Invalid Remote-User format rejected" || true

  # No auth at all rejected for plugin routes
  NOAUTH_STATUS=$(curl -s -o /dev/null -w '%{http_code}' \
    --max-time 5 \
    "http://127.0.0.1:${PANEL_PORT}/herd/api/test" 2>/dev/null || echo "000")
  assert_eq "$NOAUTH_STATUS" "403" "No auth rejected for plugin routes" || true
fi

# ---------------------------------------------------------------------------
log_section "6. Cleanup"
# ---------------------------------------------------------------------------

# Clean up local grant
LOCAL_GRANTS=$(api_get "user-access/grants" | jq -r '.grants[] | select((.target == null or .target == "local") and .used == false) | .grantId' 2>/dev/null || echo "")
for gid in $LOCAL_GRANTS; do
  api_delete "user-access/grants/${gid}" > /dev/null 2>&1 || true
done
log_pass "Cleanup complete"

end_test
exit $?

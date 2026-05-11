#!/usr/bin/env bash
# ============================================================================
# 25 — Gatekeeper Authorization (Single-VM)
# ============================================================================
# Tests the Gatekeeper service: group CRUD, grant CRUD, access checking,
# tunnel access modes, settings, cache management, and diagnostics.
# ============================================================================

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/helpers.sh"

require_commands curl jq

begin_test "25 — Gatekeeper Authorization"

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

# Check if gatekeeper proxy routes are available
GK_CHECK=$(api_get_status "gatekeeper/groups")
if [ "$GK_CHECK" = "404" ]; then
  log_skip "Gatekeeper routes not available — skipping"
  end_test
  exit $?
fi
log_pass "Gatekeeper proxy routes available (status: ${GK_CHECK})"

# ===========================================================================
log_section "1. Group CRUD"
# ===========================================================================

# Create a group
CREATE_GROUP=$(api_post "gatekeeper/groups" '{"name":"e2e-devs","description":"E2E test group"}')
CREATE_STATUS=$(echo "$CREATE_GROUP" | jq -r '.ok // empty')
assert_eq "$CREATE_STATUS" "true" "Create group e2e-devs" || true

# Duplicate group should fail with 409
DUP_STATUS=$(api_post_status "gatekeeper/groups" '{"name":"e2e-devs","description":"dup"}')
assert_eq "$DUP_STATUS" "409" "Duplicate group returns 409" || true

# Create a second group
api_post "gatekeeper/groups" '{"name":"e2e-viewers","description":"E2E viewer group"}' > /dev/null 2>&1

# List groups
GROUPS=$(api_get "gatekeeper/groups")
GROUP_COUNT=$(echo "$GROUPS" | jq '.groups | length' 2>/dev/null || echo "0")
if [ "$GROUP_COUNT" -ge 2 ]; then
  log_pass "List groups returns >= 2 groups (got: ${GROUP_COUNT})"
else
  log_fail "List groups expected >= 2, got: ${GROUP_COUNT}"
fi

# Get specific group
GROUP=$(api_get "gatekeeper/groups/e2e-devs")
GROUP_NAME=$(echo "$GROUP" | jq -r '.group.name' 2>/dev/null || echo "")
assert_eq "$GROUP_NAME" "e2e-devs" "Get group by name" || true

# Update group description
UPDATED=$(api_patch "gatekeeper/groups/e2e-devs" '{"description":"Updated description"}')
UPDATED_OK=$(echo "$UPDATED" | jq -r '.ok // empty')
assert_eq "$UPDATED_OK" "true" "Update group description" || true

# Add members
ADD_MEMBERS=$(api_post "gatekeeper/groups/e2e-devs/members" '{"usernames":["alice","bob","charlie"]}')
ADD_OK=$(echo "$ADD_MEMBERS" | jq -r '.ok // empty')
assert_eq "$ADD_OK" "true" "Add 3 members to e2e-devs" || true

# Verify members
GROUP_WITH_MEMBERS=$(api_get "gatekeeper/groups/e2e-devs")
MEMBER_COUNT=$(echo "$GROUP_WITH_MEMBERS" | jq '.group.members | length' 2>/dev/null || echo "0")
assert_eq "$MEMBER_COUNT" "3" "Group has 3 members" || true

# Remove a member
REMOVE_STATUS=$(api_delete_status "gatekeeper/groups/e2e-devs/members/bob")
assert_eq "$REMOVE_STATUS" "200" "Remove member bob" || true

# Verify member removed
GROUP_AFTER_REMOVE=$(api_get "gatekeeper/groups/e2e-devs")
MEMBER_COUNT=$(echo "$GROUP_AFTER_REMOVE" | jq '.group.members | length' 2>/dev/null || echo "0")
assert_eq "$MEMBER_COUNT" "2" "Group now has 2 members" || true

# Reserved group name should fail
RESERVED_STATUS=$(api_post_status "gatekeeper/groups" '{"name":"admins"}')
assert_eq "$RESERVED_STATUS" "400" "Reserved group name 'admins' rejected" || true

# Invalid group name should fail
INVALID_STATUS=$(api_post_status "gatekeeper/groups" '{"name":"A"}')
assert_eq "$INVALID_STATUS" "400" "Too-short group name rejected" || true

# ===========================================================================
log_section "2. Grant CRUD"
# ===========================================================================

# Create a user grant for a tunnel resource
GRANT_RESULT=$(api_post "gatekeeper/grants" '{"principalType":"user","principalId":"alice","resourceType":"tunnel","resourceId":"test-tunnel-001"}')
GRANT_OK=$(echo "$GRANT_RESULT" | jq -r '.ok // empty')
GRANT_ID=$(echo "$GRANT_RESULT" | jq -r '.grant.grantId // empty')
assert_eq "$GRANT_OK" "true" "Create user tunnel grant" || true

# Create a group grant
GROUP_GRANT=$(api_post "gatekeeper/grants" '{"principalType":"group","principalId":"e2e-devs","resourceType":"tunnel","resourceId":"test-tunnel-002"}')
GROUP_GRANT_OK=$(echo "$GROUP_GRANT" | jq -r '.ok // empty')
GROUP_GRANT_ID=$(echo "$GROUP_GRANT" | jq -r '.grant.grantId // empty')
assert_eq "$GROUP_GRANT_OK" "true" "Create group tunnel grant" || true

# Duplicate grant should fail with 409
DUP_GRANT_STATUS=$(api_post_status "gatekeeper/grants" '{"principalType":"user","principalId":"alice","resourceType":"tunnel","resourceId":"test-tunnel-001"}')
assert_eq "$DUP_GRANT_STATUS" "409" "Duplicate grant returns 409" || true

# List all grants
ALL_GRANTS=$(api_get "gatekeeper/grants")
GRANT_COUNT=$(echo "$ALL_GRANTS" | jq '.grants | length' 2>/dev/null || echo "0")
if [ "$GRANT_COUNT" -ge 2 ]; then
  log_pass "List grants returns >= 2 grants (got: ${GRANT_COUNT})"
else
  log_fail "List grants expected >= 2, got: ${GRANT_COUNT}"
fi

# Filter grants by principal type
USER_GRANTS=$(api_get "gatekeeper/grants?principalType=user")
USER_GRANT_COUNT=$(echo "$USER_GRANTS" | jq '.grants | length' 2>/dev/null || echo "0")
if [ "$USER_GRANT_COUNT" -ge 1 ]; then
  log_pass "Filter grants by principalType=user (got: ${USER_GRANT_COUNT})"
else
  log_fail "Expected >= 1 user grant, got: ${USER_GRANT_COUNT}"
fi

# Get specific grant
if [ -n "$GRANT_ID" ]; then
  SPECIFIC_GRANT=$(api_get "gatekeeper/grants/${GRANT_ID}")
  SPECIFIC_TYPE=$(echo "$SPECIFIC_GRANT" | jq -r '.grant.resourceType // empty')
  assert_eq "$SPECIFIC_TYPE" "tunnel" "Get grant by ID returns correct type" || true
fi

# ===========================================================================
log_section "3. Access Check (Diagnostics)"
# ===========================================================================

# Check access for alice on test-tunnel-001 (should be allowed via direct grant)
ACCESS=$(api_get "gatekeeper/access/check?username=alice&resourceType=tunnel&resourceId=test-tunnel-001")
ACCESS_ALLOWED=$(echo "$ACCESS" | jq -r '.allowed // empty')
assert_eq "$ACCESS_ALLOWED" "true" "Alice has access to test-tunnel-001 (direct grant)" || true

# Check access for charlie on test-tunnel-002 (should be allowed via group)
# charlie is a member of e2e-devs, which has a grant for test-tunnel-002
ACCESS_GROUP=$(api_get "gatekeeper/access/check?username=charlie&resourceType=tunnel&resourceId=test-tunnel-002")
ACCESS_GROUP_ALLOWED=$(echo "$ACCESS_GROUP" | jq -r '.allowed // empty')
assert_eq "$ACCESS_GROUP_ALLOWED" "true" "Charlie has access to test-tunnel-002 (via e2e-devs group)" || true

# Check access for unknown user on test-tunnel-001 (should be denied)
ACCESS_DENIED=$(api_get "gatekeeper/access/check?username=unknown-user&resourceType=tunnel&resourceId=test-tunnel-001")
ACCESS_DENIED_VAL=$(echo "$ACCESS_DENIED" | jq -r '.allowed // empty')
assert_eq "$ACCESS_DENIED_VAL" "false" "Unknown user denied access to test-tunnel-001" || true

# Denied response should include templates
TEMPLATES=$(echo "$ACCESS_DENIED" | jq -r '.templates // empty')
if [ -n "$TEMPLATES" ] && [ "$TEMPLATES" != "null" ]; then
  log_pass "Denied response includes access-request templates"
else
  log_fail "Denied response missing templates"
fi

# ===========================================================================
log_section "4. Settings"
# ===========================================================================

# Get current settings
SETTINGS=$(api_get "gatekeeper/settings")
SETTINGS_OK=$(echo "$SETTINGS" | jq -r '.settings // empty')
if [ -n "$SETTINGS_OK" ] && [ "$SETTINGS_OK" != "null" ]; then
  log_pass "Get settings returns settings object"
else
  log_fail "Get settings failed"
fi

# Update settings
PATCH_SETTINGS=$(api_patch "gatekeeper/settings" '{"adminEmail":"e2e@test.com","adminName":"E2E Admin","accessLoggingEnabled":true}')
PATCH_OK=$(echo "$PATCH_SETTINGS" | jq -r '.ok // empty')
assert_eq "$PATCH_OK" "true" "Update settings" || true

# Verify settings persisted
SETTINGS2=$(api_get "gatekeeper/settings")
ADMIN_EMAIL=$(echo "$SETTINGS2" | jq -r '.settings.adminEmail // empty')
assert_eq "$ADMIN_EMAIL" "e2e@test.com" "Settings persisted (adminEmail)" || true

# ===========================================================================
log_section "5. Cache Management"
# ===========================================================================

# Bust cache
BUST=$(api_post "gatekeeper/cache/bust" '{}')
BUST_OK=$(echo "$BUST" | jq -r '.ok // empty')
assert_eq "$BUST_OK" "true" "Cache bust successful" || true

# ===========================================================================
log_section "6. Access Log"
# ===========================================================================

# Clear access log
CLEAR_LOG=$(api_delete "gatekeeper/access-log")
CLEAR_OK=$(echo "$CLEAR_LOG" | jq -r '.ok // empty')
assert_eq "$CLEAR_OK" "true" "Clear access log" || true

# Read access log (should be empty after clear)
LOG=$(api_get "gatekeeper/access-log")
LOG_TOTAL=$(echo "$LOG" | jq -r '.total // "0"')
assert_eq "$LOG_TOTAL" "0" "Access log is empty after clear" || true

# ===========================================================================
log_section "7. Group Cascade Delete"
# ===========================================================================

# Delete e2e-devs group (should cascade-delete grants referencing it)
DELETE_RESULT=$(api_delete "gatekeeper/groups/e2e-devs")
DELETE_OK=$(echo "$DELETE_RESULT" | jq -r '.ok // empty')
assert_eq "$DELETE_OK" "true" "Delete group e2e-devs" || true

DELETED_GRANTS=$(echo "$DELETE_RESULT" | jq -r '.deletedGrants // "0"')
if [ "$DELETED_GRANTS" -ge 1 ]; then
  log_pass "Group deletion cascade-deleted ${DELETED_GRANTS} grant(s)"
else
  log_fail "Expected cascade grant deletion, got: ${DELETED_GRANTS}"
fi

# Verify the group grant is gone
if [ -n "$GROUP_GRANT_ID" ]; then
  GONE_STATUS=$(api_get_status "gatekeeper/grants/${GROUP_GRANT_ID}")
  assert_eq "$GONE_STATUS" "404" "Group grant removed after group deletion" || true
fi

# charlie should no longer have access to test-tunnel-002
ACCESS_AFTER_DELETE=$(api_get "gatekeeper/access/check?username=charlie&resourceType=tunnel&resourceId=test-tunnel-002")
ACCESS_AFTER_VAL=$(echo "$ACCESS_AFTER_DELETE" | jq -r '.allowed // empty')
assert_eq "$ACCESS_AFTER_VAL" "false" "Charlie denied after group deletion" || true

# ===========================================================================
log_section "8. Tunnel Access Modes (agent-only)"
# ===========================================================================

# Detect agent label for tunnel creation
AGENTS_DIR="/etc/lamalibre/lamaste/pki/agents"
AGENT_LABEL=""
if [ -d "$AGENTS_DIR" ]; then
  AGENT_LABEL=$(ls "$AGENTS_DIR" 2>/dev/null | head -1 || echo "")
fi

if [ -n "$AGENT_LABEL" ]; then
  # Create tunnel with default access mode (should be restricted)
  # Note: tunnel creation needs a valid port and subdomain — this may fail
  # if ports/subdomains are in use, which is acceptable in single-VM
  TUNNEL_RESULT=$(api_post "tunnels" '{"subdomain":"e2e-gk-test","port":19294,"description":"gatekeeper e2e test"}' 2>/dev/null || echo '{}')
  TUNNEL_MODE=$(echo "$TUNNEL_RESULT" | jq -r '.tunnel.accessMode // empty')
  if [ "$TUNNEL_MODE" = "restricted" ]; then
    log_pass "Default tunnel access mode is 'restricted'"
    # Clean up
    TUNNEL_ID=$(echo "$TUNNEL_RESULT" | jq -r '.tunnel.id // empty')
    if [ -n "$TUNNEL_ID" ]; then
      api_delete "tunnels/${TUNNEL_ID}" > /dev/null 2>&1 || true
    fi
  elif [ -n "$TUNNEL_MODE" ]; then
    log_fail "Expected default accessMode 'restricted', got '${TUNNEL_MODE}'"
  else
    log_skip "Tunnel creation failed (port/subdomain conflict or cert issue) — skipping accessMode test"
  fi
else
  log_skip "No enrolled agent — skipping tunnel access mode tests"
fi

# ===========================================================================
log_section "9. Cleanup"
# ===========================================================================

# Revoke remaining grants
if [ -n "$GRANT_ID" ]; then
  api_delete "gatekeeper/grants/${GRANT_ID}" > /dev/null 2>&1 || true
  log_info "Cleaned up user grant"
fi

# Delete remaining group
api_delete "gatekeeper/groups/e2e-viewers" > /dev/null 2>&1 || true
log_info "Cleaned up e2e-viewers group"

# Reset settings
api_patch "gatekeeper/settings" '{"adminEmail":"","adminName":"","accessLoggingEnabled":false}' > /dev/null 2>&1 || true
log_info "Reset settings"

# ===========================================================================
end_test

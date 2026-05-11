#!/usr/bin/env bash
# ============================================================================
# 15 — Plugin Lifecycle
# ============================================================================
# Verifies plugin management and push-install endpoints:
# - Empty initial plugin list
# - Plugin install validation (non-@lamalibre rejected)
# - Plugin enable/disable lifecycle
# - Push install config defaults
# - Push install policy CRUD
# - Push install enable/disable for agent
# - Push install sessions audit log
# - Input validation (invalid names, states)
# ============================================================================

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/helpers.sh"

require_commands curl jq

begin_test "15 — Plugin Lifecycle"

# ---------------------------------------------------------------------------
log_section "Pre-flight: check onboarding is complete"
# ---------------------------------------------------------------------------

ONBOARDING_STATUS=$(api_get "onboarding/status" | jq -r '.status' 2>/dev/null || echo "unknown")
if [ "$ONBOARDING_STATUS" != "COMPLETED" ]; then
  log_skip "Onboarding not completed — skipping plugin tests"
  end_test
  exit $?
fi
log_pass "Onboarding is complete"

# Track created resources for cleanup
CREATED_POLICY_ID=""

cleanup() {
  # Delete test push install policy if it still exists
  if [ -n "$CREATED_POLICY_ID" ]; then
    api_delete "plugins/push-install/policies/${CREATED_POLICY_ID}" 2>/dev/null || true
  fi
  # Disable push install globally
  api_patch "plugins/push-install/config" '{"enabled":false}' 2>/dev/null || true
}
trap cleanup EXIT

# ===========================================================================
# 1. Empty initial plugin list
# ===========================================================================

# ---------------------------------------------------------------------------
log_section "Empty initial plugin list"
# ---------------------------------------------------------------------------

PLUGINS_RESPONSE=$(api_get "plugins")
PLUGIN_COUNT=$(echo "$PLUGINS_RESPONSE" | jq '.plugins | length' 2>/dev/null || echo "-1")
assert_eq "$PLUGIN_COUNT" "0" "Initial plugin list is empty" || true

# ===========================================================================
# 2. Plugin install validation
# ===========================================================================

# ---------------------------------------------------------------------------
log_section "Plugin install validation"
# ---------------------------------------------------------------------------

# Non-@lamalibre package rejected
INVALID_SCOPE_STATUS=$(api_post_status "plugins/install" '{"packageName":"some-random-package"}')
assert_eq "$INVALID_SCOPE_STATUS" "400" "Non-@lamalibre package rejected (HTTP 400)" || true

# Empty package name
EMPTY_PKG_STATUS=$(api_post_status "plugins/install" '{"packageName":""}')
assert_eq "$EMPTY_PKG_STATUS" "400" "Empty package name rejected (HTTP 400)" || true

# ===========================================================================
# 3. Plugin detail for non-existent plugin
# ===========================================================================

# ---------------------------------------------------------------------------
log_section "Plugin detail for non-existent plugin"
# ---------------------------------------------------------------------------

MISSING_PLUGIN_STATUS=$(api_get_status "plugins/does-not-exist")
assert_eq "$MISSING_PLUGIN_STATUS" "404" "GET non-existent plugin returns 404" || true

# ===========================================================================
# 4. Enable/disable non-existent plugin
# ===========================================================================

# ---------------------------------------------------------------------------
log_section "Enable/disable non-existent plugin"
# ---------------------------------------------------------------------------

ENABLE_MISSING_STATUS=$(api_post_status "plugins/does-not-exist/enable")
assert_eq "$ENABLE_MISSING_STATUS" "404" "Enable non-existent plugin returns 404" || true

DISABLE_MISSING_STATUS=$(api_post_status "plugins/does-not-exist/disable")
assert_eq "$DISABLE_MISSING_STATUS" "404" "Disable non-existent plugin returns 404" || true

# ===========================================================================
# 5. Uninstall non-existent plugin
# ===========================================================================

# ---------------------------------------------------------------------------
log_section "Uninstall non-existent plugin"
# ---------------------------------------------------------------------------

UNINSTALL_MISSING_STATUS=$(api_delete_status "plugins/does-not-exist")
assert_eq "$UNINSTALL_MISSING_STATUS" "404" "Uninstall non-existent plugin returns 404" || true

# ===========================================================================
# 6. Push install config defaults
# ===========================================================================

# ---------------------------------------------------------------------------
log_section "Push install config defaults"
# ---------------------------------------------------------------------------

PI_CONFIG=$(api_get "plugins/push-install/config")
assert_json_field "$PI_CONFIG" '.enabled' 'false' "Push install is disabled by default" || true
assert_json_field "$PI_CONFIG" '.defaultPolicy' 'default' "Default policy ID is 'default'" || true

PI_POLICY_COUNT=$(echo "$PI_CONFIG" | jq '.policies | length' 2>/dev/null || echo "0")
if [ "$PI_POLICY_COUNT" -ge 1 ]; then
  log_pass "At least one push install policy exists (count: ${PI_POLICY_COUNT})"
else
  log_fail "No push install policies found"
fi

# ===========================================================================
# 7. Push install config update
# ===========================================================================

# ---------------------------------------------------------------------------
log_section "Push install config update"
# ---------------------------------------------------------------------------

ENABLE_PI_RESPONSE=$(api_patch "plugins/push-install/config" '{"enabled":true}')
assert_json_field "$ENABLE_PI_RESPONSE" '.ok' 'true' "PATCH push-install config returned ok: true" || true

PI_CONFIG_AFTER=$(api_get "plugins/push-install/config")
assert_json_field "$PI_CONFIG_AFTER" '.enabled' 'true' "Push install is now enabled" || true

# ===========================================================================
# 8. Push install policy CRUD
# ===========================================================================

# ---------------------------------------------------------------------------
log_section "Create a push install policy"
# ---------------------------------------------------------------------------

CREATE_PI_POLICY=$(api_post "plugins/push-install/policies" '{"name":"e2e-pi-test","description":"E2E test policy","allowedActions":["install","update"]}')
assert_json_field "$CREATE_PI_POLICY" '.ok' 'true' "Policy creation returned ok: true" || true
assert_json_field "$CREATE_PI_POLICY" '.policy.id' 'e2e-pi-test' "Policy ID matches" || true
CREATED_POLICY_ID="e2e-pi-test"

# ---------------------------------------------------------------------------
log_section "Verify policy in listing"
# ---------------------------------------------------------------------------

PI_POLICIES=$(api_get "plugins/push-install/policies")
FOUND_PI_POLICY=$(echo "$PI_POLICIES" | jq -r '.policies[] | select(.id == "e2e-pi-test") | .id' 2>/dev/null || echo "")
assert_eq "$FOUND_PI_POLICY" "e2e-pi-test" "Created policy appears in listing" || true

# ---------------------------------------------------------------------------
log_section "Update the push install policy"
# ---------------------------------------------------------------------------

UPDATE_PI_POLICY=$(api_patch "plugins/push-install/policies/e2e-pi-test" '{"description":"Updated by E2E"}')
assert_json_field "$UPDATE_PI_POLICY" '.ok' 'true' "Policy update returned ok: true" || true
assert_json_field "$UPDATE_PI_POLICY" '.policy.description' 'Updated by E2E' "Description updated" || true

# ---------------------------------------------------------------------------
log_section "Cannot delete the default push install policy"
# ---------------------------------------------------------------------------

DELETE_DEFAULT_PI_STATUS=$(api_delete_status "plugins/push-install/policies/default")
assert_eq "$DELETE_DEFAULT_PI_STATUS" "400" "Cannot delete the default policy (HTTP 400)" || true

# ---------------------------------------------------------------------------
log_section "Delete the e2e-pi-test policy"
# ---------------------------------------------------------------------------

DELETE_PI_POLICY=$(api_delete "plugins/push-install/policies/e2e-pi-test")
assert_json_field "$DELETE_PI_POLICY" '.ok' 'true' "Policy deletion returned ok: true" || true
CREATED_POLICY_ID=""

# Verify removal
PI_POLICIES_AFTER_DELETE=$(api_get "plugins/push-install/policies")
FOUND_DELETED_PI=$(echo "$PI_POLICIES_AFTER_DELETE" | jq -r '.policies[] | select(.id == "e2e-pi-test") | .id' 2>/dev/null || echo "")
assert_eq "$FOUND_DELETED_PI" "" "Deleted policy no longer in listing" || true

# ===========================================================================
# 9. Push install policy validation
# ===========================================================================

# ---------------------------------------------------------------------------
log_section "Push install policy validation"
# ---------------------------------------------------------------------------

# Empty name
EMPTY_PI_NAME_STATUS=$(api_post_status "plugins/push-install/policies" '{"name":""}')
assert_eq "$EMPTY_PI_NAME_STATUS" "400" "POST policy with empty name rejected (HTTP 400)" || true

# Duplicate policy ID
api_post "plugins/push-install/policies" '{"name":"dup-pi-test","id":"dup-pi-test"}' > /dev/null 2>&1 || true
DUP_PI_STATUS=$(api_post_status "plugins/push-install/policies" '{"name":"dup-pi-test","id":"dup-pi-test"}')
assert_eq "$DUP_PI_STATUS" "409" "POST policy with duplicate ID rejected (HTTP 409)" || true
api_delete "plugins/push-install/policies/dup-pi-test" > /dev/null 2>&1 || true

# PATCH non-existent policy returns 404
PATCH_MISSING_PI_STATUS=$(api_patch_status "plugins/push-install/policies/does-not-exist" '{"name":"updated"}')
assert_eq "$PATCH_MISSING_PI_STATUS" "404" "PATCH non-existent policy returns 404" || true

# DELETE non-existent policy returns 404
DELETE_MISSING_PI_STATUS=$(api_delete_status "plugins/push-install/policies/does-not-exist")
assert_eq "$DELETE_MISSING_PI_STATUS" "404" "DELETE non-existent policy returns 404" || true

# ===========================================================================
# 10. Push install enable/disable for agent
# ===========================================================================

# ---------------------------------------------------------------------------
log_section "Push install enable/disable for agent"
# ---------------------------------------------------------------------------

AGENT_CERTS_RESPONSE=$(api_get "certs/agent")
AGENT_COUNT=$(echo "$AGENT_CERTS_RESPONSE" | jq '.agents | length' 2>/dev/null || echo "0")

if [ "$AGENT_COUNT" -gt 0 ]; then
  AGENT_LABEL=$(echo "$AGENT_CERTS_RESPONSE" | jq -r '.agents[0].label' 2>/dev/null || echo "")

  if [ -n "$AGENT_LABEL" ] && [ "$AGENT_LABEL" != "null" ]; then
    log_info "Found agent: ${AGENT_LABEL}"

    # Enable push install for agent
    ENABLE_PI_AGENT=$(api_post "plugins/push-install/enable/${AGENT_LABEL}" '{"durationMinutes":5}')
    assert_json_field "$ENABLE_PI_AGENT" '.ok' 'true' "Push install enable for agent returned ok: true" || true
    assert_json_field_not_empty "$ENABLE_PI_AGENT" '.pushInstallEnabledUntil' "pushInstallEnabledUntil is set" || true

    # Disable push install for agent
    DISABLE_PI_AGENT=$(api_delete "plugins/push-install/enable/${AGENT_LABEL}")
    assert_json_field "$DISABLE_PI_AGENT" '.ok' 'true' "Push install disable for agent returned ok: true" || true
  else
    log_skip "Agent label is empty — skipping agent push install tests"
  fi
else
  log_skip "No agent certificates — skipping agent push install tests"
fi

# ===========================================================================
# 11. Push install without global toggle
# ===========================================================================

# ---------------------------------------------------------------------------
log_section "Push install without global toggle"
# ---------------------------------------------------------------------------

# Disable push install globally
api_patch "plugins/push-install/config" '{"enabled":false}' > /dev/null 2>&1

if [ "$AGENT_COUNT" -gt 0 ] && [ -n "${AGENT_LABEL:-}" ] && [ "$AGENT_LABEL" != "null" ]; then
  ENABLE_NO_GLOBAL_PI_STATUS=$(api_post_status "plugins/push-install/enable/${AGENT_LABEL}" '{"durationMinutes":5}')
  assert_eq "$ENABLE_NO_GLOBAL_PI_STATUS" "400" "Cannot enable push install when globally disabled (HTTP 400)" || true
else
  log_skip "No agent certificates — skipping global toggle guard test"
fi

# ===========================================================================
# 12. Push install sessions audit log
# ===========================================================================

# ---------------------------------------------------------------------------
log_section "Push install sessions audit log"
# ---------------------------------------------------------------------------

SESSIONS_RESPONSE=$(api_get "plugins/push-install/sessions")
SESSIONS_TYPE=$(echo "$SESSIONS_RESPONSE" | jq -r '.sessions | type' 2>/dev/null || echo "unknown")
assert_eq "$SESSIONS_TYPE" "array" "GET push-install sessions returns a sessions array" || true

# ===========================================================================
# 13. Push install input validation
# ===========================================================================

# ---------------------------------------------------------------------------
log_section "Push install input validation"
# ---------------------------------------------------------------------------

# Enable with duration 0 (min is 5)
if [ "$AGENT_COUNT" -gt 0 ] && [ -n "${AGENT_LABEL:-}" ] && [ "$AGENT_LABEL" != "null" ]; then
  # Re-enable globally for validation tests
  api_patch "plugins/push-install/config" '{"enabled":true}' > /dev/null 2>&1

  DURATION_ZERO_STATUS=$(api_post_status "plugins/push-install/enable/${AGENT_LABEL}" '{"durationMinutes":0}')
  assert_eq "$DURATION_ZERO_STATUS" "400" "POST enable with durationMinutes: 0 rejected (HTTP 400)" || true

  DURATION_HIGH_STATUS=$(api_post_status "plugins/push-install/enable/${AGENT_LABEL}" '{"durationMinutes":9999}')
  assert_eq "$DURATION_HIGH_STATUS" "400" "POST enable with durationMinutes: 9999 rejected (HTTP 400)" || true
else
  log_skip "No agent certificates — skipping push install enable validation tests"
fi

# Invalid config update
INVALID_DEFAULT_PI_STATUS=$(api_patch_status "plugins/push-install/config" '{"defaultPolicy":"does-not-exist"}')
assert_eq "$INVALID_DEFAULT_PI_STATUS" "400" "PATCH config with non-existent defaultPolicy rejected (HTTP 400)" || true

# Enable for non-existent agent
ENABLE_MISSING_AGENT_STATUS=$(api_post_status "plugins/push-install/enable/does-not-exist" '{"durationMinutes":5}')
assert_eq "$ENABLE_MISSING_AGENT_STATUS" "404" "POST enable for non-existent agent returns 404" || true

# Disable for non-existent agent
DISABLE_MISSING_AGENT_STATUS=$(api_delete_status "plugins/push-install/enable/does-not-exist")
assert_eq "$DISABLE_MISSING_AGENT_STATUS" "404" "DELETE enable for non-existent agent returns 404" || true

# Invalid agent label format
INVALID_LABEL_PI_STATUS=$(api_post_status "plugins/push-install/enable/INVALID_LABEL!" '{"durationMinutes":5}')
assert_eq "$INVALID_LABEL_PI_STATUS" "400" "POST enable with invalid label format rejected (HTTP 400)" || true

# Invalid plugin name format
INVALID_NAME_STATUS=$(api_get_status "plugins/INVALID_NAME!")
assert_eq "$INVALID_NAME_STATUS" "400" "GET plugin with invalid name rejected (HTTP 400)" || true

# ===========================================================================
# 14. Cleanup
# ===========================================================================

# ---------------------------------------------------------------------------
log_section "Cleanup"
# ---------------------------------------------------------------------------

DISABLE_PI_RESPONSE=$(api_patch "plugins/push-install/config" '{"enabled":false}')
assert_json_field "$DISABLE_PI_RESPONSE" '.ok' 'true' "Push install disabled globally for cleanup" || true

FINAL_PI_CONFIG=$(api_get "plugins/push-install/config")
assert_json_field "$FINAL_PI_CONFIG" '.enabled' 'false' "Push install is disabled after cleanup" || true

# Remove trap since cleanup is done
trap - EXIT

log_pass "Cleanup complete — plugin state restored"

end_test

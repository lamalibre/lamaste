#!/usr/bin/env bash
# ============================================================================
# 11 — Plugin Lifecycle (Three-VM)
# ============================================================================
# Verifies plugin management and push-install across VMs:
#
# Section 1:  REST API tests (plugin list, push-install config, policy CRUD)
# Section 2:  Push install enable/disable for agent across VMs
# Section 3:  Time window expiry validation
# Section 4:  Input validation + cleanup
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../e2e/helpers.sh"

require_commands multipass curl jq

# ---------------------------------------------------------------------------
# VM exec helpers
# ---------------------------------------------------------------------------

HOST_VM="lamaste-host"
API_HELPER="/tmp/vm-api-helper.sh"
API_STATUS_HELPER="/tmp/vm-api-status-helper.sh"

# Base64-encode body before passing through multipass exec — no special chars.
_b64() { printf '%s' "$1" | base64 | tr -d '\n'; }

# All API calls run via helper scripts ON the VM — no quoting issues.
host_api_get()    { multipass exec "${HOST_VM}" -- sudo "${API_HELPER}" GET "$1"; }
host_api_post()   { multipass exec "${HOST_VM}" -- sudo "${API_HELPER}" POST "$1" "$(_b64 "$2")"; }
host_api_patch()  { multipass exec "${HOST_VM}" -- sudo "${API_HELPER}" PATCH "$1" "$(_b64 "$2")"; }
host_api_delete() { multipass exec "${HOST_VM}" -- sudo "${API_HELPER}" DELETE "$1"; }

host_api_post_status()   { multipass exec "${HOST_VM}" -- sudo "${API_STATUS_HELPER}" POST "$1" "$(_b64 "$2")" 2>/dev/null || echo "000"; }
host_api_delete_status() { multipass exec "${HOST_VM}" -- sudo "${API_STATUS_HELPER}" DELETE "$1" 2>/dev/null || echo "000"; }

begin_test "11 — Plugin Lifecycle (Three-VM)"

# ---------------------------------------------------------------------------
log_section "Pre-flight: check onboarding is complete"
# ---------------------------------------------------------------------------

ONBOARDING_STATUS=$(host_api_get "onboarding/status" | jq -r '.status' 2>/dev/null || echo "unknown")
if [ "$ONBOARDING_STATUS" != "COMPLETED" ]; then
  log_skip "Onboarding not completed — skipping plugin tests"
  end_test
  exit $?
fi
log_pass "Onboarding is complete"

CREATED_POLICY_ID=""

cleanup() {
  local _discard
  if [ -n "$CREATED_POLICY_ID" ]; then
    _discard=$(host_api_delete "plugins/push-install/policies/${CREATED_POLICY_ID}" 2>/dev/null) || true
  fi
  _discard=$(host_api_patch "plugins/push-install/config" '{"enabled":false}' 2>/dev/null) || true
}
trap cleanup EXIT

# ===========================================================================
# 1. Plugin list and push-install config
# ===========================================================================

# ---------------------------------------------------------------------------
log_section "Plugin list is initially empty"
# ---------------------------------------------------------------------------

PLUGINS=$(host_api_get "plugins")
PLUGIN_COUNT=$(echo "$PLUGINS" | jq '.plugins | length' 2>/dev/null || echo "-1")
assert_eq "$PLUGIN_COUNT" "0" "Initial plugin list is empty on host VM" || true

# ---------------------------------------------------------------------------
log_section "Push-install config defaults"
# ---------------------------------------------------------------------------

PI_CONFIG=$(host_api_get "plugins/push-install/config")
assert_json_field "$PI_CONFIG" '.enabled' 'false' "Push install is disabled by default" || true
assert_json_field "$PI_CONFIG" '.defaultPolicy' 'default' "Default policy is 'default'" || true

# ===========================================================================
# 2. Push install policy CRUD on host VM
# ===========================================================================

# ---------------------------------------------------------------------------
log_section "Create push install policy"
# ---------------------------------------------------------------------------

CREATE_RESULT=$(host_api_post "plugins/push-install/policies" '{"name":"three-vm-test","description":"Three-VM test policy"}')
assert_json_field "$CREATE_RESULT" '.ok' 'true' "Policy creation returned ok: true" || true
assert_json_field "$CREATE_RESULT" '.policy.id' 'three-vm-test' "Policy ID matches" || true
CREATED_POLICY_ID="three-vm-test"

# ---------------------------------------------------------------------------
log_section "Delete test policy"
# ---------------------------------------------------------------------------

DELETE_RESULT=$(host_api_delete "plugins/push-install/policies/three-vm-test")
assert_json_field "$DELETE_RESULT" '.ok' 'true' "Policy deletion returned ok: true" || true
CREATED_POLICY_ID=""

# ===========================================================================
# 3. Push install enable/disable for agent across VMs
# ===========================================================================

# ---------------------------------------------------------------------------
log_section "Push install for agent"
# ---------------------------------------------------------------------------

# Enable push install globally
_DISCARD=$(host_api_patch "plugins/push-install/config" '{"enabled":true}')

AGENT_CERTS=$(host_api_get "certs/agent")
AGENT_COUNT=$(echo "$AGENT_CERTS" | jq '.agents | length' 2>/dev/null || echo "0")

if [ "$AGENT_COUNT" -gt 0 ]; then
  AGENT_LABEL=$(echo "$AGENT_CERTS" | jq -r '.agents[0].label' 2>/dev/null || echo "")

  if [ -n "$AGENT_LABEL" ] && [ "$AGENT_LABEL" != "null" ]; then
    log_info "Found agent: ${AGENT_LABEL}"

    # Enable with short time window
    ENABLE_RESULT=$(host_api_post "plugins/push-install/enable/${AGENT_LABEL}" '{"durationMinutes":5}')
    assert_json_field "$ENABLE_RESULT" '.ok' 'true' "Push install enabled for agent" || true
    assert_json_field_not_empty "$ENABLE_RESULT" '.pushInstallEnabledUntil' "pushInstallEnabledUntil is set" || true

    # Verify agent can check its own status
    PI_AGENT_STATUS=$(host_api_get "plugins/push-install/agent-status")
    log_info "Agent status response: ${PI_AGENT_STATUS}"

    # Disable
    DISABLE_RESULT=$(host_api_delete "plugins/push-install/enable/${AGENT_LABEL}")
    assert_json_field "$DISABLE_RESULT" '.ok' 'true' "Push install disabled for agent" || true
  else
    log_skip "Agent label is empty — skipping push install agent tests"
  fi
else
  log_skip "No agent certificates — skipping push install agent tests"
fi

# ===========================================================================
# 4. Push install without global toggle (guard test)
# ===========================================================================

# ---------------------------------------------------------------------------
log_section "Push install guard: global toggle off"
# ---------------------------------------------------------------------------

_DISCARD=$(host_api_patch "plugins/push-install/config" '{"enabled":false}')

if [ "$AGENT_COUNT" -gt 0 ] && [ -n "${AGENT_LABEL:-}" ] && [ "$AGENT_LABEL" != "null" ]; then
  ENABLE_NO_GLOBAL_STATUS=$(host_api_post_status "plugins/push-install/enable/${AGENT_LABEL}" '{"durationMinutes":5}')
  assert_eq "$ENABLE_NO_GLOBAL_STATUS" "400" "Cannot enable push install when globally disabled" || true
else
  log_skip "No agent certificates — skipping global toggle guard test"
fi

# ===========================================================================
# 5. Sessions audit log
# ===========================================================================

# ---------------------------------------------------------------------------
log_section "Sessions audit log"
# ---------------------------------------------------------------------------

SESSIONS=$(host_api_get "plugins/push-install/sessions")
SESSIONS_TYPE=$(echo "$SESSIONS" | jq -r '.sessions | type' 2>/dev/null || echo "unknown")
assert_eq "$SESSIONS_TYPE" "array" "Push install sessions is an array" || true

# ===========================================================================
# 6. Cleanup
# ===========================================================================

# ---------------------------------------------------------------------------
log_section "Cleanup"
# ---------------------------------------------------------------------------

DISABLE_RESULT=$(host_api_patch "plugins/push-install/config" '{"enabled":false}')
assert_json_field "$DISABLE_RESULT" '.ok' 'true' "Push install disabled globally for cleanup" || true

trap - EXIT

log_pass "Cleanup complete — plugin state restored"

end_test

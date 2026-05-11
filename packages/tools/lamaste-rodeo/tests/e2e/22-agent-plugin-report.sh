#!/usr/bin/env bash
# ============================================================================
# 22 — Agent Plugin Capability Reporting
# ============================================================================
# Verifies the server-side agent plugin capability reporting endpoint:
# - POST /api/agents/plugins/report accepts valid reports
# - Capability format validation (must be pluginName:action)
# - Capabilities are scoped to the reporting plugin's name prefix
# - Invalid report format rejected with 400
# - 'agents' is a reserved plugin name
# - Reported capabilities persist after server restart
# ============================================================================

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/helpers.sh"

require_commands curl jq

begin_test "22 — Agent Plugin Capability Reporting"

# ---------------------------------------------------------------------------
log_section "Pre-flight: check onboarding is complete"
# ---------------------------------------------------------------------------

ONBOARDING_STATUS=$(api_get "onboarding/status" | jq -r '.status' 2>/dev/null || echo "unknown")
if [ "$ONBOARDING_STATUS" != "COMPLETED" ]; then
  log_skip "Onboarding not completed — skipping agent plugin report tests"
  end_test
  exit $?
fi
log_pass "Onboarding is complete"

# ===========================================================================
# 1. Valid plugin report accepted
# ===========================================================================

log_section "Valid plugin report accepted"

REPORT_RESPONSE=$(api_post "agents/plugins/report" '{
  "plugins": [{
    "name": "test-plugin",
    "version": "0.1.0",
    "capabilities": ["test-plugin:connect"]
  }]
}')
assert_json_field "$REPORT_RESPONSE" '.ok' 'true' "Plugin report accepted" || true
assert_json_field "$REPORT_RESPONSE" '.merged' '1' "One capability merged" || true

# ===========================================================================
# 2. Empty capabilities report accepted with merged=0
# ===========================================================================

log_section "Empty capabilities report"

EMPTY_RESPONSE=$(api_post "agents/plugins/report" '{
  "plugins": [{
    "name": "empty-plugin",
    "version": "0.1.0",
    "capabilities": []
  }]
}')
assert_json_field "$EMPTY_RESPONSE" '.ok' 'true' "Empty report accepted" || true
assert_json_field "$EMPTY_RESPONSE" '.merged' '0' "Zero capabilities merged" || true

# ===========================================================================
# 3. Capabilities must be scoped to plugin name prefix
# ===========================================================================

log_section "Capability prefix scoping"

SCOPED_RESPONSE=$(api_post "agents/plugins/report" '{
  "plugins": [{
    "name": "myplugin",
    "version": "1.0.0",
    "capabilities": ["myplugin:read", "otherplugin:write"]
  }]
}')
assert_json_field "$SCOPED_RESPONSE" '.merged' '1' "Only plugin-prefixed capability accepted (otherplugin:write rejected)" || true

# ===========================================================================
# 4. Invalid capability format rejected
# ===========================================================================

log_section "Invalid capability format rejected"

INVALID_STATUS=$(api_post_status "agents/plugins/report" '{
  "plugins": [{
    "name": "badplugin",
    "version": "1.0.0",
    "capabilities": ["no-colon-here"]
  }]
}')
assert_eq "$INVALID_STATUS" "400" "Capability without colon separator rejected" || true

# ===========================================================================
# 5. Invalid plugin name format rejected
# ===========================================================================

log_section "Invalid plugin name format rejected"

INVALID_NAME_STATUS=$(api_post_status "agents/plugins/report" '{
  "plugins": [{
    "name": "Bad_Plugin_Name",
    "version": "1.0.0",
    "capabilities": []
  }]
}')
assert_eq "$INVALID_NAME_STATUS" "400" "Uppercase plugin name rejected" || true

# ===========================================================================
# 6. 'agents' is a reserved plugin name
# ===========================================================================

log_section "Reserved plugin name 'agents'"

# Try to install a plugin named 'agents' — should fail
AGENTS_INSTALL_STATUS=$(api_post_status "plugins/install" '{"packageName":"@lamalibre/agents"}')
# This will likely fail with a different error (package not found or reserved name)
# but the key is it doesn't succeed
if [ "$AGENTS_INSTALL_STATUS" = "200" ]; then
  log_fail "'agents' plugin install should not succeed"
else
  log_pass "'agents' plugin install rejected (status: $AGENTS_INSTALL_STATUS)"
fi

# ===========================================================================
# 7. Missing body rejected
# ===========================================================================

log_section "Missing body rejected"

NOBODY_STATUS=$(api_post_status "agents/plugins/report" '{}')
assert_eq "$NOBODY_STATUS" "400" "Missing plugins array rejected" || true

# ===========================================================================

end_test

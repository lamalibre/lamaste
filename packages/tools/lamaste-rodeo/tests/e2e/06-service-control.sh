#!/usr/bin/env bash
# ============================================================================
# 06 — Service Control
# ============================================================================
# Verifies service management operations:
# - List services via GET /api/services
# - Restart a service via POST /api/services/:name/restart
# - Verify service is still active after restart
# - Test: cannot stop lamalibre-lamaste-serverd from the UI
# - Test: invalid service name is rejected
# - Test: invalid action is rejected
# ============================================================================

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/helpers.sh"

require_commands curl jq

begin_test "06 — Service Control"

# ---------------------------------------------------------------------------
log_section "Pre-flight: check onboarding is complete"
# ---------------------------------------------------------------------------

ONBOARDING_STATUS=$(api_get "onboarding/status" | jq -r '.status' 2>/dev/null || echo "unknown")
if [ "$ONBOARDING_STATUS" != "COMPLETED" ]; then
  log_skip "Skipping service control tests — onboarding not complete"
  end_test
  exit $?
fi

# ---------------------------------------------------------------------------
log_section "List services"
# ---------------------------------------------------------------------------

SERVICES_RESPONSE=$(api_get "services")
SERVICE_COUNT=$(echo "$SERVICES_RESPONSE" | jq '.services | length' 2>/dev/null || echo "0")

if [ "$SERVICE_COUNT" -gt 0 ]; then
  log_pass "GET /api/services returns $SERVICE_COUNT services"
else
  log_fail "GET /api/services returned no services"
fi

# Check that expected services are listed
for svc in nginx chisel authelia lamalibre-lamaste-serverd; do
  SVC_FOUND=$(echo "$SERVICES_RESPONSE" | jq -r --arg n "$svc" '.services[] | select(.name == $n) | .name' 2>/dev/null || echo "")
  assert_eq "$SVC_FOUND" "$svc" "Service '$svc' is in the service list" || true
done

# Check that services have status fields
NGINX_STATUS=$(echo "$SERVICES_RESPONSE" | jq -r '.services[] | select(.name == "nginx") | .status' 2>/dev/null || echo "unknown")
assert_eq "$NGINX_STATUS" "active" "nginx status is 'active'" || true

# ---------------------------------------------------------------------------
log_section "Restart nginx"
# ---------------------------------------------------------------------------

# Restarting nginx may kill the connection since the request goes through nginx.
# Tolerate curl errors — the key assertion is that nginx comes back up.
RESTART_RESPONSE=$(api_post "services/nginx/restart" 2>/dev/null || echo '{"ok":true}')
RESTART_OK=$(echo "$RESTART_RESPONSE" | jq -r '.ok' 2>/dev/null || echo "")
if [ "$RESTART_OK" = "true" ] || [ -z "$RESTART_OK" ]; then
  log_pass "nginx restart request accepted"
else
  log_fail "nginx restart returned unexpected response: $RESTART_RESPONSE"
fi

# Wait for nginx to come back
sleep 3
NGINX_ACTIVE=$(systemctl is-active nginx 2>/dev/null || echo "unknown")
assert_eq "$NGINX_ACTIVE" "active" "nginx is active after restart" || true

# ---------------------------------------------------------------------------
log_section "Reload nginx"
# ---------------------------------------------------------------------------

RELOAD_RESPONSE=$(api_post "services/nginx/reload")
assert_json_field "$RELOAD_RESPONSE" '.ok' 'true' "nginx reload returned ok: true" || true

# ---------------------------------------------------------------------------
log_section "Cannot stop lamalibre-lamaste-serverd"
# ---------------------------------------------------------------------------

STOP_PANEL_STATUS=$(api_post_status "services/lamalibre-lamaste-serverd/stop")
assert_eq "$STOP_PANEL_STATUS" "400" "Cannot stop lamalibre-lamaste-serverd (HTTP 400)" || true

# Verify the error message
STOP_PANEL_RESPONSE=$(api_post "services/lamalibre-lamaste-serverd/stop")
assert_contains "$STOP_PANEL_RESPONSE" "Cannot stop the panel" "Error message explains why panel cannot be stopped" || true

# ---------------------------------------------------------------------------
log_section "Restart lamalibre-lamaste-serverd is allowed"
# ---------------------------------------------------------------------------

# Restarting the panel may kill the connection mid-response. Tolerate curl errors.
RESTART_PANEL_RESPONSE=$(api_post "services/lamalibre-lamaste-serverd/restart" 2>/dev/null || echo '{}')
RESTART_PANEL_OK=$(echo "$RESTART_PANEL_RESPONSE" | jq -r '.ok' 2>/dev/null || echo "")
if [ "$RESTART_PANEL_OK" = "true" ] || [ -z "$RESTART_PANEL_OK" ] || [ "$RESTART_PANEL_OK" = "null" ]; then
  log_pass "lamalibre-lamaste-serverd restart request accepted"
else
  log_fail "lamalibre-lamaste-serverd restart returned unexpected response: $RESTART_PANEL_RESPONSE"
fi

# Wait for the panel to come back up after restart
sleep 3
if wait_for_http "${BASE_URL}/api/health" 30 --cert "$CERT_PATH" --key "$KEY_PATH" --cacert "$CA_PATH"; then
  log_pass "Panel is responsive after restart"
else
  log_fail "Panel did not come back up after restart"
fi

# ---------------------------------------------------------------------------
log_section "Invalid service name"
# ---------------------------------------------------------------------------

INVALID_SVC_STATUS=$(api_post_status "services/nonexistent-service/restart")
assert_eq "$INVALID_SVC_STATUS" "400" "Unknown service rejected (HTTP 400)" || true

# ---------------------------------------------------------------------------
log_section "Invalid action"
# ---------------------------------------------------------------------------

INVALID_ACTION_STATUS=$(api_post_status "services/nginx/destroy")
assert_eq "$INVALID_ACTION_STATUS" "400" "Invalid action 'destroy' rejected (HTTP 400)" || true

end_test

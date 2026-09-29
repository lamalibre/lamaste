#!/usr/bin/env bash
# ============================================================================
# 10 — Resilience
# ============================================================================
# Verifies service failure detection and recovery:
# - Stop nginx, verify dashboard shows it as inactive
# - Restart nginx from API, verify it recovers
# - Stop chisel, verify dashboard shows it as inactive
# - Restart chisel from API, verify it recovers
# - Loosen the chisel authfile to 0644: a panel restart's background
#   reconciliation restores 0640 lamaste:lamaste-chisel, and chisel keeps
#   running (not failed closed)
# - Point chisel.service at the wrong group: the unit is create-lamaste's (the
#   panel cannot write it); a redeploy restores Group=lamaste-chisel and
#   restarts chisel onto it
# - Verify panel stays up throughout
# ============================================================================

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/helpers.sh"

require_commands curl jq systemctl

begin_test "10 — Resilience"

# Safety: ensure all services are restored on exit
cleanup_services() {
  sudo systemctl start nginx 2>/dev/null || true
  sudo systemctl start chisel 2>/dev/null || true
  sudo systemctl start authelia 2>/dev/null || true
}
trap cleanup_services EXIT

# ---------------------------------------------------------------------------
log_section "Pre-flight: check onboarding is complete"
# ---------------------------------------------------------------------------

ONBOARDING_STATUS=$(api_get "onboarding/status" | jq -r '.status' 2>/dev/null || echo "unknown")
if [ "$ONBOARDING_STATUS" != "COMPLETED" ]; then
  log_skip "Skipping resilience tests — onboarding not complete"
  end_test
  exit $?
fi

# Verify all services are active before starting
SERVICES_BEFORE=$(api_get "services")
for svc in nginx chisel authelia lamalibre-lamaste-serverd; do
  SVC_STATUS=$(echo "$SERVICES_BEFORE" | jq -r --arg n "$svc" '.services[] | select(.name == $n) | .status' 2>/dev/null || echo "unknown")
  log_info "Service $svc status before tests: $SVC_STATUS"
done

# ---------------------------------------------------------------------------
log_section "nginx failure and recovery"
# ---------------------------------------------------------------------------

# Helper to query panel directly (bypassing nginx) when nginx is down.
# Includes mTLS simulation headers since the Fastify middleware checks X-SSL-Client-Verify.
_api_direct() {
  curl -s --max-time "$CURL_TIMEOUT" \
    -H "Accept: application/json" \
    -H "X-SSL-Client-Verify: SUCCESS" \
    -H "X-SSL-Client-DN: CN=admin" \
    "http://127.0.0.1:3100/api/$1"
}
_api_direct_post() {
  local _def='{}'; local body="${2:-$_def}"
  curl -s --max-time "$CURL_TIMEOUT" \
    -H "Accept: application/json" \
    -H "X-SSL-Client-Verify: SUCCESS" \
    -H "X-SSL-Client-DN: CN=admin" \
    -X POST -H "Content-Type: application/json" -d "$body" \
    "http://127.0.0.1:3100/api/$1"
}

# Stop nginx directly via systemctl
log_info "Stopping nginx..."
sudo systemctl stop nginx 2>/dev/null || true
sleep 2

# Verify nginx shows as inactive/failed via direct API (nginx is down, can't proxy)
SERVICES_NGINX_DOWN=$(_api_direct "services")
NGINX_STATUS_DOWN=$(echo "$SERVICES_NGINX_DOWN" | jq -r '.services[] | select(.name == "nginx") | .status' 2>/dev/null || echo "unknown")

if [ "$NGINX_STATUS_DOWN" = "inactive" ] || [ "$NGINX_STATUS_DOWN" = "failed" ]; then
  log_pass "API shows nginx as '$NGINX_STATUS_DOWN' after stop"
else
  log_fail "Expected nginx status 'inactive' or 'failed', got '$NGINX_STATUS_DOWN'"
fi

# Restart nginx from the direct API
RESTART_NGINX=$(_api_direct_post "services/nginx/restart")
assert_json_field "$RESTART_NGINX" '.ok' 'true' "nginx restart via API returned ok: true" || true

# Wait for nginx to come back
sleep 2

NGINX_STATUS_UP=$(systemctl is-active nginx 2>/dev/null || echo "unknown")
assert_eq "$NGINX_STATUS_UP" "active" "nginx is active after API restart" || true

# Verify via API as well (nginx is back, so we can use normal API)
SERVICES_NGINX_UP=$(api_get "services")
NGINX_API_STATUS=$(echo "$SERVICES_NGINX_UP" | jq -r '.services[] | select(.name == "nginx") | .status' 2>/dev/null || echo "unknown")
assert_eq "$NGINX_API_STATUS" "active" "API shows nginx as active after restart" || true

# ---------------------------------------------------------------------------
log_section "chisel failure and recovery"
# ---------------------------------------------------------------------------

# Stop chisel directly via systemctl
log_info "Stopping chisel..."
sudo systemctl stop chisel 2>/dev/null || true
sleep 2

# Verify chisel shows as inactive/failed via API
SERVICES_CHISEL_DOWN=$(api_get "services")
CHISEL_STATUS_DOWN=$(echo "$SERVICES_CHISEL_DOWN" | jq -r '.services[] | select(.name == "chisel") | .status' 2>/dev/null || echo "unknown")

if [ "$CHISEL_STATUS_DOWN" = "inactive" ] || [ "$CHISEL_STATUS_DOWN" = "failed" ]; then
  log_pass "API shows chisel as '$CHISEL_STATUS_DOWN' after stop"
else
  log_fail "Expected chisel status 'inactive' or 'failed', got '$CHISEL_STATUS_DOWN'"
fi

# Restart chisel from the API
RESTART_CHISEL=$(api_post "services/chisel/restart")
assert_json_field "$RESTART_CHISEL" '.ok' 'true' "chisel restart via API returned ok: true" || true

# Wait for chisel to come back
sleep 2

CHISEL_STATUS_UP=$(systemctl is-active chisel 2>/dev/null || echo "unknown")
assert_eq "$CHISEL_STATUS_UP" "active" "chisel is active after API restart" || true

# ---------------------------------------------------------------------------
log_section "authelia failure and recovery"
# ---------------------------------------------------------------------------

log_info "Stopping authelia..."
sudo systemctl stop authelia 2>/dev/null || true
sleep 2

SERVICES_AUTH_DOWN=$(api_get "services")
AUTH_STATUS_DOWN=$(echo "$SERVICES_AUTH_DOWN" | jq -r '.services[] | select(.name == "authelia") | .status' 2>/dev/null || echo "unknown")

if [ "$AUTH_STATUS_DOWN" = "inactive" ] || [ "$AUTH_STATUS_DOWN" = "failed" ]; then
  log_pass "API shows authelia as '$AUTH_STATUS_DOWN' after stop"
else
  log_fail "Expected authelia status 'inactive' or 'failed', got '$AUTH_STATUS_DOWN'"
fi

RESTART_AUTH=$(api_post "services/authelia/restart")
assert_json_field "$RESTART_AUTH" '.ok' 'true' "authelia restart via API returned ok: true" || true

sleep 2

AUTH_STATUS_UP=$(systemctl is-active authelia 2>/dev/null || echo "unknown")
assert_eq "$AUTH_STATUS_UP" "active" "authelia is active after API restart" || true

# ---------------------------------------------------------------------------
log_section "Chisel authfile is healed on panel start"
# ---------------------------------------------------------------------------

AUTHFILE="/etc/lamalibre/lamaste/chisel-users"
CHISEL_UNIT_FILE="/etc/systemd/system/chisel.service"

AUTHFILE_BEFORE=$(sudo stat -c '%a %U %G' "$AUTHFILE" 2>/dev/null || echo "missing")
assert_eq "$AUTHFILE_BEFORE" "640 lamaste lamaste-chisel" "Chisel authfile starts as 0640 lamaste:lamaste-chisel" || true

# Loosen the authfile (every agent's tunnel password), as an older version or
# a careless operator might
sudo chmod 644 "$AUTHFILE"
assert_eq "$(sudo stat -c '%a' "$AUTHFILE" 2>/dev/null || echo "missing")" "644" "Authfile loosened to 0644 for the test" || true

sudo systemctl restart lamalibre-lamaste-serverd
PANEL_BACK=false
for _ in $(seq 1 30); do
  if [ "$(api_get "health" 2>/dev/null | jq -r '.status' 2>/dev/null || echo "")" = "ok" ]; then
    PANEL_BACK=true
    break
  fi
  sleep 2
done
if [ "$PANEL_BACK" = "true" ]; then
  log_pass "Panel back after restart"
else
  log_fail "Panel not healthy within 60 seconds of restart"
fi

# Reconciliation runs in the background right after start
AUTHFILE_HEALED=""
for _ in $(seq 1 30); do
  AUTHFILE_HEALED=$(sudo stat -c '%a %U %G' "$AUTHFILE" 2>/dev/null || echo "missing")
  [ "$AUTHFILE_HEALED" = "640 lamaste lamaste-chisel" ] && break
  sleep 2
done
assert_eq "$AUTHFILE_HEALED" "640 lamaste lamaste-chisel" "Reconciliation restored the authfile to 0640 lamaste:lamaste-chisel" || true
if wait_for_service chisel 30; then
  log_pass "chisel is active after reconciliation"
else
  log_fail "chisel is not active after reconciliation"
fi
assert_eq "$(sudo test -e /etc/lamalibre/lamaste/chisel-failed-closed && echo yes || echo no)" "no" "Reconciliation did not fail closed" || true

# ---------------------------------------------------------------------------
log_section "Chisel unit is create-lamaste's: a redeploy heals it"
# ---------------------------------------------------------------------------

assert_eq "$(sudo stat -c '%U' "$CHISEL_UNIT_FILE")" "root" "chisel.service is root-owned" || true
UNIT_WRITE=$(sudo -u lamaste sh -c "echo x >> $CHISEL_UNIT_FILE" 2>/dev/null && echo allowed || echo denied)
assert_eq "$UNIT_WRITE" "denied" "The panel user cannot modify chisel.service" || true

sudo sed -i 's/^Group=.*/Group=nogroup/' "$CHISEL_UNIT_FILE"
sudo systemctl daemon-reload
assert_eq "$(systemctl show -p Group --value chisel 2>/dev/null || echo "")" "nogroup" "chisel.service pointed at Group=nogroup for the test" || true
CHISEL_PID_BEFORE=$(systemctl show -p MainPID --value chisel 2>/dev/null || echo 0)

# Redeploy (create-lamaste on an existing install); its output is not needed
sudo create-lamaste --dev --yes --json >/dev/null 2>&1 || true

assert_eq "$(systemctl show -p Group --value chisel 2>/dev/null || echo "")" "lamaste-chisel" "Redeploy restored Group=lamaste-chisel in chisel.service" || true
assert_eq "$(systemctl show -p User --value chisel 2>/dev/null || echo "")" "nobody" "chisel.service still runs as User=nobody" || true
if wait_for_service chisel 30; then
  log_pass "chisel is active after the redeploy"
else
  log_fail "chisel is not active after the redeploy"
fi
assert_not_eq "$(systemctl show -p MainPID --value chisel 2>/dev/null || echo 0)" "$CHISEL_PID_BEFORE" "Redeploy restarted chisel onto the restored unit" || true
CHISEL_GROUP_NOW=$(ps -o group= -p "$(systemctl show -p MainPID --value chisel 2>/dev/null || echo 0)" 2>/dev/null | tr -d ' ' || echo "")
assert_eq "$CHISEL_GROUP_NOW" "lamaste-chisel" "Running chisel process has group lamaste-chisel" || true
assert_eq "$(systemctl is-enabled chisel 2>/dev/null || true)" "enabled" "chisel.service is enabled" || true
assert_eq "$(api_get "health" 2>/dev/null | jq -r '.status' 2>/dev/null || echo "")" "ok" "Panel healthy after the redeploy" || true

# ---------------------------------------------------------------------------
log_section "Panel survives all service disruptions"
# ---------------------------------------------------------------------------

# The panel should have stayed up the entire time
HEALTH_FINAL=$(api_get "health")
assert_json_field "$HEALTH_FINAL" '.status' 'ok' "Panel health is ok after all disruptions" || true

# Final service status check
SERVICES_FINAL=$(api_get "services")
for svc in nginx chisel authelia lamalibre-lamaste-serverd; do
  FINAL_STATUS=$(echo "$SERVICES_FINAL" | jq -r --arg n "$svc" '.services[] | select(.name == $n) | .status' 2>/dev/null || echo "unknown")
  assert_eq "$FINAL_STATUS" "active" "Service $svc is active at end of resilience test" || true
done

end_test

#!/usr/bin/env bash
# ============================================================================
# 05 — Admin Journey (Three-VM)
# ============================================================================
# Tests the admin's experience using the panel — verifying that the panel UI
# is accessible, APIs return correct data, and CRUD operations on tunnels,
# users, services, and certificates work as expected.
#
# Runs from the developer's Mac and uses `multipass exec` to interact with VMs.
#
# Required environment variables:
#   HOST_IP      — IP address of the host VM
#   TEST_DOMAIN  — Domain configured for testing
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../e2e/helpers.sh"

require_commands multipass curl jq

# ---------------------------------------------------------------------------
# VM exec helpers
# ---------------------------------------------------------------------------

host_exec() { multipass exec lamaste-host -- sudo bash -c "$1"; }

host_api_get() {
  host_exec "curl -skf --max-time 30 --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key --cacert /etc/lamalibre/lamaste/pki/ca.crt -H 'Accept: application/json' https://127.0.0.1:9292/api/$1"
}

host_api_post() {
  host_exec "curl -skf --max-time 30 --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key --cacert /etc/lamalibre/lamaste/pki/ca.crt -X POST -H 'Content-Type: application/json' -H 'Accept: application/json' -d '$2' https://127.0.0.1:9292/api/$1"
}

host_api_put() {
  host_exec "curl -skf --max-time 30 --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key --cacert /etc/lamalibre/lamaste/pki/ca.crt -X PUT -H 'Content-Type: application/json' -H 'Accept: application/json' -d '$2' https://127.0.0.1:9292/api/$1"
}

host_api_patch() {
  host_exec "curl -skf --max-time 30 --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key --cacert /etc/lamalibre/lamaste/pki/ca.crt -X PATCH -H 'Content-Type: application/json' -H 'Accept: application/json' -d '$2' https://127.0.0.1:9292/api/$1"
}

host_api_delete() {
  host_exec "curl -skf --max-time 30 --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key --cacert /etc/lamalibre/lamaste/pki/ca.crt -X DELETE -H 'Accept: application/json' https://127.0.0.1:9292/api/$1"
}

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

TEST_TUNNEL_SUBDOMAIN="e2eadmin"
TEST_TUNNEL_PORT=18090
TEST_TUNNEL_ID=""
TEST_USERNAME="e2etestuser"

begin_test "05 — Admin Journey (Three-VM)"

# ---------------------------------------------------------------------------
# Cleanup function — always runs on exit
# ---------------------------------------------------------------------------

cleanup() {
  log_info "Cleaning up test resources..."

  # Delete test tunnel if created
  if [ -n "$TEST_TUNNEL_ID" ] && [ "$TEST_TUNNEL_ID" != "null" ]; then
    host_api_delete "tunnels/${TEST_TUNNEL_ID}" 2>/dev/null || true
  fi

  # Delete test user if created
  host_api_delete "users/${TEST_USERNAME}" 2>/dev/null || true
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
log_section "Pre-flight: verify onboarding is complete"
# ---------------------------------------------------------------------------

ONBOARDING_STATUS=$(host_api_get "onboarding/status" | jq -r '.status' 2>/dev/null || echo "unknown")
if [ "$ONBOARDING_STATUS" != "COMPLETED" ]; then
  log_skip "Onboarding not completed (status: $ONBOARDING_STATUS). Skipping admin journey tests."
  end_test
  exit $?
fi

# ===========================================================================
log_section "1. Panel accessible via IP:9292 (mTLS)"
# ===========================================================================

# Fetch the panel HTML via the IP-based mTLS endpoint
IP_RESPONSE=$(host_exec "curl -skf --max-time 30 --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key --cacert /etc/lamalibre/lamaste/pki/ca.crt https://127.0.0.1:9292/ 2>/dev/null" || echo "")
IP_STATUS=$(host_exec "curl -skf -o /dev/null -w '%{http_code}' --max-time 30 --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key --cacert /etc/lamalibre/lamaste/pki/ca.crt https://127.0.0.1:9292/ 2>/dev/null" || echo "000")

assert_eq "$IP_STATUS" "200" "Panel via IP:9292 returns HTTP 200" || true
assert_contains "$IP_RESPONSE" '<div id="root">' "Panel via IP:9292 contains React mount point" || true
assert_contains "$IP_RESPONSE" '<title>' "Panel via IP:9292 contains title tag" || true

# ===========================================================================
log_section "2. Panel accessible via panel.DOMAIN (mTLS)"
# ===========================================================================

DOMAIN_RESPONSE=$(host_exec "curl -skf --max-time 30 --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key --cacert /etc/lamalibre/lamaste/pki/ca.crt https://panel.${TEST_DOMAIN}/ 2>/dev/null" || echo "")
DOMAIN_STATUS=$(host_exec "curl -skf -o /dev/null -w '%{http_code}' --max-time 30 --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key --cacert /etc/lamalibre/lamaste/pki/ca.crt https://panel.${TEST_DOMAIN}/ 2>/dev/null" || echo "000")

assert_eq "$DOMAIN_STATUS" "200" "Panel via panel.${TEST_DOMAIN} returns HTTP 200" || true
assert_contains "$DOMAIN_RESPONSE" '<div id="root">' "Panel via panel.${TEST_DOMAIN} contains React mount point" || true
assert_contains "$DOMAIN_RESPONSE" '<title>' "Panel via panel.${TEST_DOMAIN} contains title tag" || true

# ===========================================================================
log_section "3. Panel without mTLS cert rejected"
# ===========================================================================

# curl without client certs — nginx should reject at the TLS level
NO_CERT_STATUS=$(host_exec "curl -sk -o /dev/null -w '%{http_code}' --max-time 15 https://panel.${TEST_DOMAIN}/ 2>/dev/null" || echo "000")

# Without a client cert, nginx returns 400 (Bad Request), 496 (No Cert), or
# the connection is closed outright (000). Any of these indicates rejection.
if [ "$NO_CERT_STATUS" = "000" ] || [ "$NO_CERT_STATUS" = "400" ] || [ "$NO_CERT_STATUS" = "496" ]; then
  log_pass "Panel without mTLS cert rejected (HTTP $NO_CERT_STATUS)"
else
  log_fail "Panel without mTLS cert should be rejected (000/400/496), got HTTP $NO_CERT_STATUS"
fi

# ===========================================================================
log_section "4. Dashboard API returns data"
# ===========================================================================

# GET /api/health
HEALTH_RESPONSE=$(host_api_get "health")
assert_json_field "$HEALTH_RESPONSE" '.status' 'ok' "GET /api/health returns status: ok" || true

# GET /api/system/stats
STATS_RESPONSE=$(host_api_get "system/stats")
assert_json_field_not_empty "$STATS_RESPONSE" '.cpu' "GET /api/system/stats has cpu field" || true
assert_json_field_not_empty "$STATS_RESPONSE" '.memory' "GET /api/system/stats has memory field" || true
assert_json_field_not_empty "$STATS_RESPONSE" '.disk' "GET /api/system/stats has disk field" || true

# ===========================================================================
log_section "5. Tunnel management via panel"
# ===========================================================================

# GET /api/tunnels — list existing tunnels
LIST_BEFORE=$(host_api_get "tunnels")
assert_json_field_not_empty "$LIST_BEFORE" '.tunnels' "GET /api/tunnels returns tunnels array" || true

TUNNEL_COUNT_BEFORE=$(echo "$LIST_BEFORE" | jq '.tunnels | length' 2>/dev/null || echo "0")
log_info "Tunnels before create: $TUNNEL_COUNT_BEFORE"

# POST /api/tunnels — create test tunnel
CREATE_RESPONSE=$(host_api_post "tunnels" "{\"subdomain\":\"${TEST_TUNNEL_SUBDOMAIN}\",\"port\":${TEST_TUNNEL_PORT}}")
assert_json_field "$CREATE_RESPONSE" '.ok' 'true' "POST /api/tunnels create returned ok: true" || true

TEST_TUNNEL_ID=$(echo "$CREATE_RESPONSE" | jq -r '.tunnel.id' 2>/dev/null || echo "")
assert_json_field_not_empty "$CREATE_RESPONSE" '.tunnel.id' "Created tunnel has an ID" || true
log_info "Created tunnel ID: $TEST_TUNNEL_ID"

# GET /api/tunnels — verify new tunnel appears
LIST_AFTER_CREATE=$(host_api_get "tunnels")
TUNNEL_COUNT_AFTER=$(echo "$LIST_AFTER_CREATE" | jq '.tunnels | length' 2>/dev/null || echo "0")
FOUND_TUNNEL=$(echo "$LIST_AFTER_CREATE" | jq -r --arg id "$TEST_TUNNEL_ID" '.tunnels[] | select(.id == $id) | .id' 2>/dev/null || echo "")
assert_eq "$FOUND_TUNNEL" "$TEST_TUNNEL_ID" "New tunnel appears in tunnel list" || true

# PATCH /api/tunnels/:id — disable
DISABLE_RESPONSE=$(host_api_patch "tunnels/${TEST_TUNNEL_ID}" '{"enabled":false}')
assert_json_field "$DISABLE_RESPONSE" '.ok' 'true' "PATCH /api/tunnels/:id disable returned ok: true" || true

# Verify disabled state
LIST_DISABLED=$(host_api_get "tunnels")
DISABLED_STATE=$(echo "$LIST_DISABLED" | jq -r --arg id "$TEST_TUNNEL_ID" '.tunnels[] | select(.id == $id) | .enabled' 2>/dev/null || echo "")
assert_eq "$DISABLED_STATE" "false" "Tunnel shows as disabled after PATCH" || true

# PATCH /api/tunnels/:id — re-enable
ENABLE_RESPONSE=$(host_api_patch "tunnels/${TEST_TUNNEL_ID}" '{"enabled":true}')
assert_json_field "$ENABLE_RESPONSE" '.ok' 'true' "PATCH /api/tunnels/:id re-enable returned ok: true" || true

# Verify re-enabled state
LIST_ENABLED=$(host_api_get "tunnels")
ENABLED_STATE=$(echo "$LIST_ENABLED" | jq -r --arg id "$TEST_TUNNEL_ID" '.tunnels[] | select(.id == $id) | .enabled' 2>/dev/null || echo "")
assert_eq "$ENABLED_STATE" "true" "Tunnel shows as enabled after re-enable PATCH" || true

# DELETE /api/tunnels/:id
DELETE_TUNNEL_RESPONSE=$(host_api_delete "tunnels/${TEST_TUNNEL_ID}")
assert_json_field "$DELETE_TUNNEL_RESPONSE" '.ok' 'true' "DELETE /api/tunnels/:id returned ok: true" || true

# Verify tunnel is gone
LIST_AFTER_DELETE=$(host_api_get "tunnels")
GONE_TUNNEL=$(echo "$LIST_AFTER_DELETE" | jq -r --arg id "$TEST_TUNNEL_ID" '.tunnels[] | select(.id == $id) | .id' 2>/dev/null || echo "")
assert_eq "$GONE_TUNNEL" "" "Tunnel no longer appears after DELETE" || true

# Clear the ID so cleanup does not try to delete again
TEST_TUNNEL_ID=""

# ===========================================================================
log_section "6. User management via panel"
# ===========================================================================

# GET /api/users — verify users array with at least admin
USERS_LIST=$(host_api_get "users")
assert_json_field_not_empty "$USERS_LIST" '.users' "GET /api/users returns users array" || true

USERS_COUNT=$(echo "$USERS_LIST" | jq '.users | length' 2>/dev/null || echo "0")
if [ "$USERS_COUNT" -ge 1 ]; then
  log_pass "Users list contains at least one user (count: $USERS_COUNT)"
else
  log_fail "Users list should contain at least one user (count: $USERS_COUNT)"
fi

# POST /api/users — create test user
CREATE_USER_RESPONSE=$(host_api_post "users" "{\"username\":\"${TEST_USERNAME}\",\"displayname\":\"E2E Test User\",\"email\":\"${TEST_USERNAME}@example.com\",\"password\":\"E2eTestPass123!!\"}")
assert_json_field "$CREATE_USER_RESPONSE" '.ok' 'true' "POST /api/users create returned ok: true" || true

# GET /api/users — verify new user appears
USERS_AFTER_CREATE=$(host_api_get "users")
FOUND_USER=$(echo "$USERS_AFTER_CREATE" | jq -r --arg u "$TEST_USERNAME" '.users[] | select(.username == $u) | .username' 2>/dev/null || echo "")
assert_eq "$FOUND_USER" "$TEST_USERNAME" "New user appears in users list" || true

# PUT /api/users/:username — update user
UPDATE_USER_RESPONSE=$(host_api_put "users/${TEST_USERNAME}" '{"displayname":"Updated E2E User"}')
assert_json_field "$UPDATE_USER_RESPONSE" '.ok' 'true' "PUT /api/users/:username update returned ok: true" || true

# POST /api/users/:username/reset-totp — reset TOTP
RESET_TOTP_RESPONSE=$(host_api_post "users/${TEST_USERNAME}/reset-totp" '{}')
assert_json_field_not_empty "$RESET_TOTP_RESPONSE" '.totpUri' "POST /api/users/:username/reset-totp returns otpauth URI" || true

OTPAUTH_URI=$(echo "$RESET_TOTP_RESPONSE" | jq -r '.totpUri' 2>/dev/null || echo "")
if echo "$OTPAUTH_URI" | grep -qF "otpauth://"; then
  log_pass "TOTP otpauth URI has correct scheme"
else
  log_fail "TOTP otpauth URI should start with otpauth:// (got: $OTPAUTH_URI)"
fi

# DELETE /api/users/:username
DELETE_USER_RESPONSE=$(host_api_delete "users/${TEST_USERNAME}")
assert_json_field "$DELETE_USER_RESPONSE" '.ok' 'true' "DELETE /api/users/:username returned ok: true" || true

# Verify user is gone
USERS_AFTER_DELETE=$(host_api_get "users")
GONE_USER=$(echo "$USERS_AFTER_DELETE" | jq -r --arg u "$TEST_USERNAME" '.users[] | select(.username == $u) | .username' 2>/dev/null || echo "")
assert_eq "$GONE_USER" "" "User no longer appears after DELETE" || true

# Clear username so cleanup does not try to delete again
TEST_USERNAME=""

# ===========================================================================
log_section "7. Service management via panel"
# ===========================================================================

# GET /api/services — list service statuses
SERVICES_RESPONSE=$(host_api_get "services")
assert_json_field_not_empty "$SERVICES_RESPONSE" '.services' "GET /api/services returns services array" || true

# Verify expected services are listed
EXPECTED_SERVICES=("nginx" "chisel" "authelia" "lamalibre-lamaste-serverd")
for SVC in "${EXPECTED_SERVICES[@]}"; do
  FOUND_SVC=$(echo "$SERVICES_RESPONSE" | jq -r --arg s "$SVC" '.services[] | select(.name == $s) | .name' 2>/dev/null || echo "")
  if [ "$FOUND_SVC" = "$SVC" ]; then
    log_pass "Service '$SVC' is listed"
  else
    log_fail "Service '$SVC' not found in services list"
  fi
done

# ===========================================================================
log_section "8. Certificate management"
# ===========================================================================

# GET /api/certs — list certificates
CERTS_RESPONSE=$(host_api_get "certs")
assert_json_field_not_empty "$CERTS_RESPONSE" '.' "GET /api/certs returns certificate info" || true
log_info "Certs response keys: $(echo "$CERTS_RESPONSE" | jq -r 'keys | join(", ")' 2>/dev/null || echo 'unable to parse')"

# ===========================================================================
log_section "9. Cleanup"
# ===========================================================================

# Cleanup is handled by the EXIT trap. Log that we reached this point cleanly.
log_info "All test sections completed. EXIT trap will handle resource cleanup."

end_test

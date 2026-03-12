#!/usr/bin/env bash
# ============================================================================
# 04 — Tunnel Lifecycle
# ============================================================================
# Verifies tunnel CRUD operations:
# - Create a tunnel via POST /api/tunnels
# - Verify tunnel appears in GET /api/tunnels
# - Verify nginx vhost is created and nginx -t passes
# - Enable/disable tunnel via PATCH /api/tunnels/:id
# - Delete tunnel via DELETE /api/tunnels/:id
# - Verify cleanup (tunnel removed from list, vhost removed, nginx -t passes)
# - Test validation (reserved subdomains, duplicate names, invalid ports)
# ============================================================================

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/helpers.sh"

require_commands curl jq

TEST_SUBDOMAIN="e2etest-$(date +%s)"
TEST_PORT=18080
TEST_DESCRIPTION="E2E test tunnel"

begin_test "04 — Tunnel Lifecycle"

# ---------------------------------------------------------------------------
log_section "Pre-flight: check onboarding is complete"
# ---------------------------------------------------------------------------

ONBOARDING_STATUS=$(api_get "onboarding/status" | jq -r '.status' 2>/dev/null || echo "unknown")
if [ "$ONBOARDING_STATUS" != "COMPLETED" ]; then
  log_info "Onboarding not completed (status: $ONBOARDING_STATUS). Tunnel creation requires onboarding."
  log_skip "Skipping tunnel lifecycle tests — onboarding not complete"
  end_test
  exit $?
fi

# ---------------------------------------------------------------------------
log_section "Create tunnel"
# ---------------------------------------------------------------------------

CREATE_BODY=$(cat <<EOF
{
  "subdomain": "$TEST_SUBDOMAIN",
  "port": $TEST_PORT,
  "description": "$TEST_DESCRIPTION"
}
EOF
)

CREATE_RESPONSE=$(api_post "tunnels" "$CREATE_BODY")
assert_json_field "$CREATE_RESPONSE" '.ok' 'true' "Tunnel creation returned ok: true" || true

TUNNEL_ID=$(echo "$CREATE_RESPONSE" | jq -r '.tunnel.id' 2>/dev/null || echo "")
assert_json_field "$CREATE_RESPONSE" '.tunnel.subdomain' "$TEST_SUBDOMAIN" "Tunnel subdomain matches" || true
assert_json_field "$CREATE_RESPONSE" '.tunnel.port' "$TEST_PORT" "Tunnel port matches" || true
assert_json_field_not_empty "$CREATE_RESPONSE" '.tunnel.id' "Tunnel has an ID" || true
assert_json_field_not_empty "$CREATE_RESPONSE" '.tunnel.fqdn' "Tunnel has an FQDN" || true
assert_json_field_not_empty "$CREATE_RESPONSE" '.tunnel.createdAt' "Tunnel has a createdAt timestamp" || true

log_info "Created tunnel ID: $TUNNEL_ID"

# ---------------------------------------------------------------------------
log_section "Verify tunnel in list"
# ---------------------------------------------------------------------------

LIST_RESPONSE=$(api_get "tunnels")
FOUND=$(echo "$LIST_RESPONSE" | jq -r --arg id "$TUNNEL_ID" '.tunnels[] | select(.id == $id) | .subdomain' 2>/dev/null || echo "")
assert_eq "$FOUND" "$TEST_SUBDOMAIN" "Tunnel appears in GET /api/tunnels" || true

# ---------------------------------------------------------------------------
log_section "Verify nginx configuration"
# ---------------------------------------------------------------------------

# Check vhost file exists
DOMAIN=$(api_get "onboarding/status" | jq -r '.domain' 2>/dev/null || echo "unknown")
VHOST_NAME="portlama-app-${TEST_SUBDOMAIN}"
VHOST_PATH="/etc/nginx/sites-enabled/${VHOST_NAME}"

if [ -f "$VHOST_PATH" ] || [ -L "$VHOST_PATH" ]; then
  log_pass "Nginx vhost exists at $VHOST_PATH"
else
  VHOST_ALT="/etc/nginx/sites-available/${VHOST_NAME}"
  if [ -f "$VHOST_ALT" ]; then
    log_pass "Nginx vhost exists at $VHOST_ALT"
  else
    log_fail "Nginx vhost not found at $VHOST_PATH"
  fi
fi

# Verify nginx config is still valid
NGINX_TEST=$(sudo nginx -t 2>&1 || true)
assert_contains "$NGINX_TEST" "syntax is ok" "nginx -t passes after tunnel creation" || true

# ---------------------------------------------------------------------------
log_section "Validation: reserved subdomain"
# ---------------------------------------------------------------------------

RESERVED_STATUS=$(api_post_status "tunnels" '{"subdomain":"panel","port":19999,"description":"reserved test"}')
assert_eq "$RESERVED_STATUS" "400" "Reserved subdomain 'panel' rejected (HTTP 400)" || true

# ---------------------------------------------------------------------------
log_section "Validation: duplicate subdomain"
# ---------------------------------------------------------------------------

DUP_STATUS=$(api_post_status "tunnels" "{\"subdomain\":\"$TEST_SUBDOMAIN\",\"port\":19998,\"description\":\"dup test\"}")
assert_eq "$DUP_STATUS" "400" "Duplicate subdomain rejected (HTTP 400)" || true

# ---------------------------------------------------------------------------
log_section "Validation: duplicate port"
# ---------------------------------------------------------------------------

DUP_PORT_STATUS=$(api_post_status "tunnels" "{\"subdomain\":\"e2edup-port\",\"port\":$TEST_PORT,\"description\":\"dup port test\"}")
assert_eq "$DUP_PORT_STATUS" "400" "Duplicate port rejected (HTTP 400)" || true

# ---------------------------------------------------------------------------
log_section "Validation: invalid port"
# ---------------------------------------------------------------------------

LOW_PORT_STATUS=$(api_post_status "tunnels" '{"subdomain":"e2elow","port":80,"description":"low port"}')
if [ "$LOW_PORT_STATUS" = "400" ] || [ "$LOW_PORT_STATUS" = "422" ]; then
  log_pass "Port below 1024 rejected (HTTP $LOW_PORT_STATUS)"
else
  log_fail "Port below 1024 should be rejected (got HTTP $LOW_PORT_STATUS)"
fi

# ---------------------------------------------------------------------------
log_section "Mac plist endpoint"
# ---------------------------------------------------------------------------

PLIST_RESPONSE=$(api_get "tunnels/mac-plist?format=json")
assert_json_field_not_empty "$PLIST_RESPONSE" '.plist' "Mac plist endpoint returns plist content" || true

FAKE_ID="00000000-0000-0000-0000-000000000000"

# ---------------------------------------------------------------------------
log_section "Disable tunnel"
# ---------------------------------------------------------------------------

if [ -n "$TUNNEL_ID" ] && [ "$TUNNEL_ID" != "null" ]; then
  TOGGLE_RESPONSE=$(api_patch "tunnels/$TUNNEL_ID" '{"enabled": false}')
  assert_json_field "$TOGGLE_RESPONSE" '.ok' 'true' "Tunnel disable returned ok: true" || true

  # Verify tunnel shows as disabled in list
  LIST_DISABLED=$(api_get "tunnels")
  ENABLED_STATE=$(echo "$LIST_DISABLED" | jq -r --arg id "$TUNNEL_ID" '.tunnels[] | select(.id == $id) | .enabled' 2>/dev/null || echo "")
  assert_eq "$ENABLED_STATE" "false" "Tunnel shows as disabled in list" || true

  # Verify nginx vhost symlink removed (disabled = no symlink in sites-enabled)
  if [ ! -L "$VHOST_PATH" ] && [ ! -f "$VHOST_PATH" ]; then
    log_pass "Nginx sites-enabled symlink removed for disabled tunnel"
  else
    log_fail "Nginx sites-enabled symlink still exists for disabled tunnel"
  fi

  # Verify nginx config still valid
  NGINX_TEST_DISABLED=$(sudo nginx -t 2>&1 || true)
  assert_contains "$NGINX_TEST_DISABLED" "syntax is ok" "nginx -t passes after tunnel disable" || true

  # Verify disabled tunnel excluded from plist
  PLIST_DISABLED=$(api_get "tunnels/mac-plist?format=json")
  PLIST_CONTENT=$(echo "$PLIST_DISABLED" | jq -r '.plist' 2>/dev/null || echo "")
  assert_not_contains "$PLIST_CONTENT" "$TEST_SUBDOMAIN" "Disabled tunnel excluded from plist" || true
else
  log_skip "Cannot disable — no tunnel ID from creation step"
fi

# ---------------------------------------------------------------------------
log_section "Re-enable tunnel"
# ---------------------------------------------------------------------------

if [ -n "$TUNNEL_ID" ] && [ "$TUNNEL_ID" != "null" ]; then
  ENABLE_RESPONSE=$(api_patch "tunnels/$TUNNEL_ID" '{"enabled": true}')
  assert_json_field "$ENABLE_RESPONSE" '.ok' 'true' "Tunnel re-enable returned ok: true" || true

  # Verify tunnel shows as enabled in list
  LIST_ENABLED=$(api_get "tunnels")
  ENABLED_STATE2=$(echo "$LIST_ENABLED" | jq -r --arg id "$TUNNEL_ID" '.tunnels[] | select(.id == $id) | .enabled' 2>/dev/null || echo "")
  assert_eq "$ENABLED_STATE2" "true" "Tunnel shows as enabled in list" || true

  # Verify nginx vhost symlink restored
  if [ -L "$VHOST_PATH" ] || [ -f "$VHOST_PATH" ]; then
    log_pass "Nginx vhost restored for re-enabled tunnel"
  else
    log_fail "Nginx vhost not restored for re-enabled tunnel"
  fi

  # Verify nginx config still valid
  NGINX_TEST_ENABLED=$(sudo nginx -t 2>&1 || true)
  assert_contains "$NGINX_TEST_ENABLED" "syntax is ok" "nginx -t passes after tunnel re-enable" || true

  # Verify re-enabled tunnel included in plist
  PLIST_ENABLED=$(api_get "tunnels/mac-plist?format=json")
  PLIST_CONTENT2=$(echo "$PLIST_ENABLED" | jq -r '.plist' 2>/dev/null || echo "")
  assert_contains "$PLIST_CONTENT2" "$TEST_PORT" "Re-enabled tunnel included in plist" || true
else
  log_skip "Cannot re-enable — no tunnel ID from creation step"
fi

# ---------------------------------------------------------------------------
log_section "Toggle nonexistent tunnel"
# ---------------------------------------------------------------------------

FAKE_TOGGLE_STATUS=$(api_patch_status "tunnels/$FAKE_ID" '{"enabled": false}')
assert_eq "$FAKE_TOGGLE_STATUS" "404" "Toggle nonexistent tunnel returns 404" || true

# ---------------------------------------------------------------------------
log_section "Delete tunnel"
# ---------------------------------------------------------------------------

if [ -n "$TUNNEL_ID" ] && [ "$TUNNEL_ID" != "null" ]; then
  DELETE_RESPONSE=$(api_delete "tunnels/$TUNNEL_ID")
  assert_json_field "$DELETE_RESPONSE" '.ok' 'true' "Tunnel deletion returned ok: true" || true

  # Verify tunnel is gone from list
  LIST_AFTER=$(api_get "tunnels")
  FOUND_AFTER=$(echo "$LIST_AFTER" | jq -r --arg id "$TUNNEL_ID" '.tunnels[] | select(.id == $id) | .id' 2>/dev/null || echo "")
  assert_eq "$FOUND_AFTER" "" "Tunnel no longer in list after deletion" || true

  # Verify vhost removed
  if [ ! -f "$VHOST_PATH" ]; then
    log_pass "Nginx vhost removed after tunnel deletion"
  else
    log_fail "Nginx vhost still exists after tunnel deletion"
  fi

  # Verify nginx config still valid
  NGINX_TEST_AFTER=$(sudo nginx -t 2>&1 || true)
  assert_contains "$NGINX_TEST_AFTER" "syntax is ok" "nginx -t passes after tunnel deletion" || true
else
  log_skip "Cannot delete — no tunnel ID from creation step"
fi

# ---------------------------------------------------------------------------
log_section "Delete nonexistent tunnel"
# ---------------------------------------------------------------------------

NOT_FOUND_STATUS=$(curl -s -o /dev/null -w '%{http_code}' \
  --max-time "$CURL_TIMEOUT" \
  --insecure \
  --cert "$CERT_PATH" \
  --key "$KEY_PATH" \
  --cacert "$CA_PATH" \
  -X DELETE \
  "${BASE_URL}/api/tunnels/$FAKE_ID" 2>/dev/null || echo "000")
assert_eq "$NOT_FOUND_STATUS" "404" "Delete nonexistent tunnel returns 404" || true

end_test

#!/usr/bin/env bash
# ============================================================================
# 21 — Gatekeeper Authorization (Three-VM)
# ============================================================================
# Tests the full Gatekeeper authorization flow across VMs:
#
# 1. Group and grant CRUD via serverd proxy
# 2. Tunnel access modes (public, authenticated, restricted)
# 3. Access check diagnostics
# 4. Gatekeeper service health and secret auth
# 5. Group cascade deletion
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

host_api_post_status() {
  host_exec "curl -sk --max-time 30 -o /dev/null -w '%{http_code}' --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key --cacert /etc/lamalibre/lamaste/pki/ca.crt -X POST -H 'Content-Type: application/json' -d '$2' https://127.0.0.1:9292/api/$1"
}

host_api_delete() {
  host_exec "curl -skf --max-time 30 --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key --cacert /etc/lamalibre/lamaste/pki/ca.crt -X DELETE https://127.0.0.1:9292/api/$1"
}

host_api_delete_status() {
  host_exec "curl -sk --max-time 30 -o /dev/null -w '%{http_code}' --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key --cacert /etc/lamalibre/lamaste/pki/ca.crt -X DELETE https://127.0.0.1:9292/api/$1"
}

host_api_get_status() {
  host_exec "curl -sk --max-time 30 -o /dev/null -w '%{http_code}' --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key --cacert /etc/lamalibre/lamaste/pki/ca.crt -H 'Accept: application/json' https://127.0.0.1:9292/api/$1"
}

host_api_patch() {
  host_exec "curl -skf --max-time 30 --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key --cacert /etc/lamalibre/lamaste/pki/ca.crt -X PATCH -H 'Content-Type: application/json' -H 'Accept: application/json' -d '$2' https://127.0.0.1:9292/api/$1"
}

begin_test "21 — Gatekeeper Authorization (Three-VM)"

# ---------------------------------------------------------------------------
log_section "Pre-flight"
# ---------------------------------------------------------------------------

STATUS=$(host_api_get "onboarding/status" | jq -r '.status' 2>/dev/null || echo "unknown")
if [ "$STATUS" != "COMPLETED" ]; then
  log_skip "Onboarding not completed — skipping"
  end_test
  exit $?
fi
log_pass "Onboarding is complete"

# Check gatekeeper routes
GK_STATUS=$(host_api_get_status "gatekeeper/groups")
if [ "$GK_STATUS" = "404" ]; then
  log_skip "Gatekeeper routes not available — skipping"
  end_test
  exit $?
fi
log_pass "Gatekeeper proxy available"

# Check gatekeeper service is running
GK_HEALTH=$(host_exec "curl -sf --max-time 5 http://127.0.0.1:9294/health" 2>/dev/null || echo "")
if echo "$GK_HEALTH" | grep -q "ok"; then
  log_pass "Gatekeeper service healthy on port 9294"
else
  log_fail "Gatekeeper service not healthy"
fi

# Verify gatekeeper-secret file exists
SECRET_EXISTS=$(host_exec "test -f /etc/lamalibre/lamaste/gatekeeper-secret && echo yes || echo no")
assert_eq "$SECRET_EXISTS" "yes" "Gatekeeper API secret file exists" || true

# Verify secret file permissions
SECRET_PERMS=$(host_exec "stat -c '%a' /etc/lamalibre/lamaste/gatekeeper-secret 2>/dev/null || stat -f '%Lp' /etc/lamalibre/lamaste/gatekeeper-secret 2>/dev/null || echo 'unknown'")
assert_eq "$SECRET_PERMS" "600" "Gatekeeper secret file has 0600 permissions" || true

# ===========================================================================
log_section "1. Group CRUD"
# ===========================================================================

# Create groups
CREATE_G1=$(host_api_post "gatekeeper/groups" '{"name":"three-vm-devs","description":"Three-VM dev group"}')
assert_eq "$(echo "$CREATE_G1" | jq -r '.ok')" "true" "Create group three-vm-devs" || true

CREATE_G2=$(host_api_post "gatekeeper/groups" '{"name":"three-vm-ops","description":"Three-VM ops group"}')
assert_eq "$(echo "$CREATE_G2" | jq -r '.ok')" "true" "Create group three-vm-ops" || true

# Add members
host_api_post "gatekeeper/groups/three-vm-devs/members" '{"usernames":["alice","bob"]}' > /dev/null 2>&1
host_api_post "gatekeeper/groups/three-vm-ops/members" '{"usernames":["charlie","dave"]}' > /dev/null 2>&1

MEMBERS=$(host_api_get "gatekeeper/groups/three-vm-devs" | jq '.group.members | length' 2>/dev/null || echo "0")
assert_eq "$MEMBERS" "2" "Group three-vm-devs has 2 members" || true

# ===========================================================================
log_section "2. Grant CRUD and Access Checks"
# ===========================================================================

# Create tunnel grants
G1=$(host_api_post "gatekeeper/grants" '{"principalType":"user","principalId":"alice","resourceType":"tunnel","resourceId":"tunnel-001"}')
G1_ID=$(echo "$G1" | jq -r '.grant.grantId')
assert_not_eq "$G1_ID" "" "Create user grant (alice → tunnel-001)" || true

G2=$(host_api_post "gatekeeper/grants" '{"principalType":"group","principalId":"three-vm-ops","resourceType":"tunnel","resourceId":"tunnel-002"}')
G2_ID=$(echo "$G2" | jq -r '.grant.grantId')
assert_not_eq "$G2_ID" "" "Create group grant (three-vm-ops → tunnel-002)" || true

# Access checks
ALICE_ACCESS=$(host_api_get "gatekeeper/access/check?username=alice&resourceType=tunnel&resourceId=tunnel-001" | jq -r '.allowed')
assert_eq "$ALICE_ACCESS" "true" "Alice has access via direct grant" || true

CHARLIE_ACCESS=$(host_api_get "gatekeeper/access/check?username=charlie&resourceType=tunnel&resourceId=tunnel-002" | jq -r '.allowed')
assert_eq "$CHARLIE_ACCESS" "true" "Charlie has access via group grant" || true

BOB_DENIED=$(host_api_get "gatekeeper/access/check?username=bob&resourceType=tunnel&resourceId=tunnel-002" | jq -r '.allowed')
assert_eq "$BOB_DENIED" "false" "Bob denied (not in three-vm-ops)" || true

# ===========================================================================
log_section "3. Settings and Cache"
# ===========================================================================

# Enable access logging
host_api_patch "gatekeeper/settings" '{"accessLoggingEnabled":true,"adminEmail":"admin@three-vm.test"}' > /dev/null 2>&1

SETTINGS=$(host_api_get "gatekeeper/settings")
LOGGING=$(echo "$SETTINGS" | jq -r '.settings.accessLoggingEnabled')
assert_eq "$LOGGING" "true" "Access logging enabled" || true

# Bust cache
BUST=$(host_api_post "gatekeeper/cache/bust" '{}' | jq -r '.ok')
assert_eq "$BUST" "true" "Cache bust" || true

# ===========================================================================
log_section "4. Group Cascade Delete"
# ===========================================================================

DELETE_RESULT=$(host_api_delete "gatekeeper/groups/three-vm-ops")
DEL_GRANTS=$(echo "$DELETE_RESULT" | jq -r '.deletedGrants')
if [ "$DEL_GRANTS" -ge 1 ]; then
  log_pass "Cascade deleted ${DEL_GRANTS} grant(s) on group deletion"
else
  log_fail "Expected cascade deletion, got: ${DEL_GRANTS}"
fi

# charlie should lose access
CHARLIE_AFTER=$(host_api_get "gatekeeper/access/check?username=charlie&resourceType=tunnel&resourceId=tunnel-002" | jq -r '.allowed')
assert_eq "$CHARLIE_AFTER" "false" "Charlie denied after group deletion" || true

# ===========================================================================
log_section "5. Gatekeeper API Secret Enforcement"
# ===========================================================================

# Direct access to gatekeeper WITHOUT secret should be rejected
UNAUTH=$(host_exec "curl -sf --max-time 5 http://127.0.0.1:9294/api/groups 2>/dev/null; echo \$?" || echo "")
if echo "$UNAUTH" | grep -q "22\|401\|Unauthorized"; then
  log_pass "Direct gatekeeper API access without secret rejected"
else
  # Try checking the HTTP status code
  DIRECT_STATUS=$(host_exec "curl -s --max-time 5 -o /dev/null -w '%{http_code}' http://127.0.0.1:9294/api/groups")
  if [ "$DIRECT_STATUS" = "401" ]; then
    log_pass "Direct gatekeeper API returns 401 without secret"
  else
    log_fail "Expected 401 for direct API access, got: ${DIRECT_STATUS}"
  fi
fi

# ===========================================================================
log_section "6. Cleanup"
# ===========================================================================

# Revoke remaining grants
if [ -n "$G1_ID" ]; then
  host_api_delete "gatekeeper/grants/${G1_ID}" > /dev/null 2>&1 || true
fi
host_api_delete "gatekeeper/groups/three-vm-devs" > /dev/null 2>&1 || true
host_api_patch "gatekeeper/settings" '{"accessLoggingEnabled":false,"adminEmail":""}' > /dev/null 2>&1 || true
host_api_delete "gatekeeper/access-log" > /dev/null 2>&1 || true
log_info "Cleanup complete"

end_test

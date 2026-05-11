#!/usr/bin/env bash
# ============================================================================
# 17 — Identity System (Three-VM)
# ============================================================================
# Tests the identity API endpoints that expose Authelia user/group data
# through the panel API, with proper mTLS authentication and capability gating.
#
# 1. Identity API via mTLS (host VM) — users, single user, groups, self
# 2. nginx header stripping verification — forged Remote-User rejected
# 3. Capability gating with agent cert — 403 without identity:query
# 4. Password hash exclusion — no password field in user data
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

host_api_patch() {
  host_exec "curl -skf --max-time 30 --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key --cacert /etc/lamalibre/lamaste/pki/ca.crt -X PATCH -H 'Content-Type: application/json' -H 'Accept: application/json' -d '$2' https://127.0.0.1:9292/api/$1"
}

host_api_delete() {
  host_exec "curl -skf --max-time 30 --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key --cacert /etc/lamalibre/lamaste/pki/ca.crt -X DELETE -H 'Accept: application/json' https://127.0.0.1:9292/api/$1"
}

# Agent cert API helpers — use extracted PEM cert/key from the agent's .p12
host_agent_api_get() {
  local cert_path="$1"
  local key_path="$2"
  local api_path="$3"
  host_exec "curl -skf --max-time 30 --cert ${cert_path} --key ${key_path} --cacert /etc/lamalibre/lamaste/pki/ca.crt -H 'Accept: application/json' https://127.0.0.1:9292/api/${api_path}"
}

host_agent_api_get_status() {
  local cert_path="$1"
  local key_path="$2"
  local api_path="$3"
  host_exec "curl -sk -o /dev/null -w '%{http_code}' --max-time 30 --cert ${cert_path} --key ${key_path} --cacert /etc/lamalibre/lamaste/pki/ca.crt -H 'Accept: application/json' https://127.0.0.1:9292/api/${api_path}" 2>/dev/null || echo "000"
}

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

AGENT_LABEL="identity-agent"
AGENT_CERT_PATH=""
AGENT_KEY_PATH=""

begin_test "17 — Identity System (Three-VM)"

# ---------------------------------------------------------------------------
# Cleanup function — always runs on exit
# ---------------------------------------------------------------------------

cleanup() {
  log_info "Cleaning up test resources..."
  # Revoke agent cert
  host_api_delete "certs/agent/${AGENT_LABEL}" 2>/dev/null || true
  # Clean up extracted PEM files
  host_exec "rm -f /tmp/e2e-identity-*.pem 2>/dev/null || true" 2>/dev/null || true
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
log_section "Pre-flight: verify onboarding is complete"
# ---------------------------------------------------------------------------

ONBOARDING_STATUS=$(host_api_get "onboarding/status" | jq -r '.status' 2>/dev/null || echo "unknown")
if [ "$ONBOARDING_STATUS" != "COMPLETED" ]; then
  log_skip "Onboarding not completed (status: $ONBOARDING_STATUS). Skipping identity system tests."
  end_test
  exit $?
fi

# ===========================================================================
log_section "1. Identity API — list users (admin cert)"
# ===========================================================================

USERS_RESPONSE=$(host_api_get "identity/users")
assert_json_field_not_empty "$USERS_RESPONSE" '.users' "GET /api/identity/users returns users array" || true

USERS_COUNT=$(echo "$USERS_RESPONSE" | jq '.users | length' 2>/dev/null || echo "0")
if [ "$USERS_COUNT" -ge 1 ]; then
  log_pass "Identity users list contains at least one user (count: $USERS_COUNT)"
else
  log_fail "Identity users list should contain at least one user (count: $USERS_COUNT)"
fi

# Get the first username for the single-user lookup test
FIRST_USERNAME=$(echo "$USERS_RESPONSE" | jq -r '.users[0].username' 2>/dev/null || echo "")
log_info "First user in list: $FIRST_USERNAME"

# ===========================================================================
log_section "2. Identity API — single user lookup (admin cert)"
# ===========================================================================

if [ -n "$FIRST_USERNAME" ] && [ "$FIRST_USERNAME" != "null" ]; then
  USER_RESPONSE=$(host_api_get "identity/users/${FIRST_USERNAME}")
  assert_json_field "$USER_RESPONSE" '.user.username' "$FIRST_USERNAME" "GET /api/identity/users/:username returns correct user" || true
  assert_json_field_not_empty "$USER_RESPONSE" '.user.displayname' "Single user has displayname field" || true
  assert_json_field_not_empty "$USER_RESPONSE" '.user.groups' "Single user has groups field" || true
else
  log_skip "No users found for single-user lookup test"
fi

# Verify 404 for non-existent user
NOTFOUND_STATUS=$(host_exec "curl -sk -o /dev/null -w '%{http_code}' --max-time 30 --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key --cacert /etc/lamalibre/lamaste/pki/ca.crt -H 'Accept: application/json' https://127.0.0.1:9292/api/identity/users/nonexistent-user-e2e 2>/dev/null" || echo "000")
assert_eq "$NOTFOUND_STATUS" "404" "GET /api/identity/users/:username returns 404 for non-existent user" || true

# ===========================================================================
log_section "3. Identity API — list groups (admin cert)"
# ===========================================================================

GROUPS_RESPONSE=$(host_api_get "identity/groups")
assert_json_field_not_empty "$GROUPS_RESPONSE" '.groups' "GET /api/identity/groups returns groups array" || true

GROUPS_COUNT=$(echo "$GROUPS_RESPONSE" | jq '.groups | length' 2>/dev/null || echo "0")
if [ "$GROUPS_COUNT" -ge 1 ]; then
  log_pass "Identity groups list contains at least one group (count: $GROUPS_COUNT)"
else
  log_fail "Identity groups list should contain at least one group (count: $GROUPS_COUNT)"
fi

# ===========================================================================
log_section "4. Identity API — /self returns 400 on mTLS vhost"
# ===========================================================================

# On the mTLS panel vhost (127.0.0.1:9292), nginx strips Remote-* headers,
# so /api/identity/self should return 400 (no identity headers present).
SELF_STATUS=$(host_exec "curl -sk -o /dev/null -w '%{http_code}' --max-time 30 --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key --cacert /etc/lamalibre/lamaste/pki/ca.crt -H 'Accept: application/json' https://127.0.0.1:9292/api/identity/self 2>/dev/null" || echo "000")
assert_eq "$SELF_STATUS" "400" "GET /api/identity/self returns 400 on mTLS vhost (no Remote-* headers)" || true

# ===========================================================================
log_section "5. nginx header stripping — forged Remote-User rejected"
# ===========================================================================

# Send a request with a forged Remote-User header through the mTLS panel vhost.
# nginx should strip all Remote-* headers before proxying to Fastify, so
# /api/identity/self should still return 400 regardless of the forged header.
FORGED_STATUS=$(host_exec "curl -sk -o /dev/null -w '%{http_code}' --max-time 30 --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key --cacert /etc/lamalibre/lamaste/pki/ca.crt -H 'Accept: application/json' -H 'Remote-User: attacker' -H 'Remote-Groups: admins' -H 'Remote-Name: Evil Admin' -H 'Remote-Email: evil@attacker.com' https://127.0.0.1:9292/api/identity/self 2>/dev/null" || echo "000")
assert_eq "$FORGED_STATUS" "400" "Forged Remote-User header stripped by nginx (still returns 400)" || true

# Also verify the response body confirms headers were not present
FORGED_BODY=$(host_exec "curl -sk --max-time 30 --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key --cacert /etc/lamalibre/lamaste/pki/ca.crt -H 'Accept: application/json' -H 'Remote-User: attacker' https://127.0.0.1:9292/api/identity/self 2>/dev/null" || echo "{}")
assert_contains "$FORGED_BODY" "Identity headers not present" "Response confirms identity headers not present despite forged header" || true

# ===========================================================================
log_section "6. Capability gating — agent without identity:query gets 403"
# ===========================================================================

# Create an agent cert WITHOUT identity:query capability
CERT_RESPONSE=$(host_api_post "certs/agent" '{"label":"'"${AGENT_LABEL}"'","capabilities":["tunnels:read"]}')
assert_json_field "$CERT_RESPONSE" '.ok' 'true' "Agent cert creation returned ok: true" || true

P12_PASSWORD=$(echo "$CERT_RESPONSE" | jq -r '.p12Password' 2>/dev/null || echo "")
assert_json_field_not_empty "$CERT_RESPONSE" '.p12Password' "Agent cert has a p12 password" || true

log_info "Created agent cert: ${AGENT_LABEL} (capabilities: [tunnels:read])"

# Extract PEM cert and key from .p12 for use with curl
P12_PATH="/etc/lamalibre/lamaste/pki/agents/${AGENT_LABEL}/client.p12"
AGENT_CERT_PATH="/tmp/e2e-identity-cert.pem"
AGENT_KEY_PATH="/tmp/e2e-identity-key.pem"
host_exec "openssl pkcs12 -in '${P12_PATH}' -clcerts -nokeys -out '${AGENT_CERT_PATH}' -passin 'pass:${P12_PASSWORD}' -legacy 2>/dev/null || openssl pkcs12 -in '${P12_PATH}' -clcerts -nokeys -out '${AGENT_CERT_PATH}' -passin 'pass:${P12_PASSWORD}'"
host_exec "openssl pkcs12 -in '${P12_PATH}' -nocerts -nodes -out '${AGENT_KEY_PATH}' -passin 'pass:${P12_PASSWORD}' -legacy 2>/dev/null || openssl pkcs12 -in '${P12_PATH}' -nocerts -nodes -out '${AGENT_KEY_PATH}' -passin 'pass:${P12_PASSWORD}'"

log_pass "Extracted PEM cert and key from .p12"

# Attempt to call identity endpoints with the agent cert (no identity:query) — should get 403
AGENT_USERS_STATUS=$(host_agent_api_get_status "$AGENT_CERT_PATH" "$AGENT_KEY_PATH" "identity/users")
assert_eq "$AGENT_USERS_STATUS" "403" "Agent without identity:query rejected with 403 on /identity/users" || true

AGENT_GROUPS_STATUS=$(host_agent_api_get_status "$AGENT_CERT_PATH" "$AGENT_KEY_PATH" "identity/groups")
assert_eq "$AGENT_GROUPS_STATUS" "403" "Agent without identity:query rejected with 403 on /identity/groups" || true

# ===========================================================================
log_section "7. Capability gating — grant identity:query, verify access"
# ===========================================================================

# Update agent capabilities to include identity:query
PATCH_RESPONSE=$(host_api_patch "certs/agent/${AGENT_LABEL}/capabilities" '{"capabilities":["tunnels:read","identity:query"]}')
assert_json_field "$PATCH_RESPONSE" '.ok' 'true' "Capability update to add identity:query returned ok: true" || true

log_info "Updated agent capabilities: [tunnels:read, identity:query]"

# Now the agent should be able to access identity endpoints
AGENT_USERS_AFTER=$(host_agent_api_get "$AGENT_CERT_PATH" "$AGENT_KEY_PATH" "identity/users")
assert_json_field_not_empty "$AGENT_USERS_AFTER" '.users' "Agent with identity:query can access /identity/users" || true

AGENT_GROUPS_AFTER=$(host_agent_api_get "$AGENT_CERT_PATH" "$AGENT_KEY_PATH" "identity/groups")
assert_json_field_not_empty "$AGENT_GROUPS_AFTER" '.groups' "Agent with identity:query can access /identity/groups" || true

# Verify the agent gets the same user count as admin
AGENT_USERS_COUNT=$(echo "$AGENT_USERS_AFTER" | jq '.users | length' 2>/dev/null || echo "0")
assert_eq "$AGENT_USERS_COUNT" "$USERS_COUNT" "Agent sees the same number of users as admin (count: $AGENT_USERS_COUNT)" || true

# ===========================================================================
log_section "8. Password hash exclusion verification"
# ===========================================================================

# Verify that the /api/identity/users response does NOT contain a password field.
# The readUsers() function strips password hashes, so they must never appear in output.
USERS_RAW=$(host_api_get "identity/users")

# Check that no user object contains a "password" key
HAS_PASSWORD=$(echo "$USERS_RAW" | jq '[.users[] | has("password")] | any' 2>/dev/null || echo "true")
assert_eq "$HAS_PASSWORD" "false" "No user in /identity/users response contains a password field" || true

# Double-check: search for common password hash prefixes in the raw JSON
if echo "$USERS_RAW" | grep -qE '\$2[aby]?\$|\$argon2'; then
  log_fail "Raw response contains password hash patterns (bcrypt or argon2 detected)"
else
  log_pass "No password hash patterns found in raw /identity/users response"
fi

# Also verify single-user endpoint does not expose password
if [ -n "$FIRST_USERNAME" ] && [ "$FIRST_USERNAME" != "null" ]; then
  SINGLE_USER_RAW=$(host_api_get "identity/users/${FIRST_USERNAME}")
  SINGLE_HAS_PASSWORD=$(echo "$SINGLE_USER_RAW" | jq '.user | has("password")' 2>/dev/null || echo "true")
  assert_eq "$SINGLE_HAS_PASSWORD" "false" "Single user endpoint does not contain password field" || true
fi

# ===========================================================================
log_section "9. Cleanup"
# ===========================================================================

# Cleanup is handled by the EXIT trap. Log that we reached this point cleanly.
log_info "All test sections completed. EXIT trap will handle resource cleanup."

end_test

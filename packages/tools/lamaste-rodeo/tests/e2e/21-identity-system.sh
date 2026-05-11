#!/usr/bin/env bash
# ============================================================================
# 21 — Identity System
# ============================================================================
# Verifies the identity API routes:
# - identity:query capability gating (agent without cap gets 403, with cap gets 200)
# - GET /api/identity/users (admin) — list users, verify fields, no password hashes
# - GET /api/identity/users/:username (admin) — single user lookup and 404
# - GET /api/identity/groups (admin) — sorted group list matching user data
# - GET /api/identity/self (admin) — 400 on mTLS vhost (no Authelia headers)
# - Input validation — invalid username characters, nonexistent paths
# - Reserved API prefix — 'identity' in RESERVED_API_PREFIXES constant
# ============================================================================

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/helpers.sh"

require_commands curl jq openssl

begin_test "21 — Identity System"

# ---------------------------------------------------------------------------
log_section "Pre-flight: check onboarding is complete"
# ---------------------------------------------------------------------------

ONBOARDING_STATUS=$(api_get "onboarding/status" | jq -r '.status' 2>/dev/null || echo "unknown")
if [ "$ONBOARDING_STATUS" != "COMPLETED" ]; then
  log_skip "Skipping identity tests — onboarding not complete"
  end_test
  exit $?
fi

# ---------------------------------------------------------------------------
log_section "GET /api/identity/users (admin)"
# ---------------------------------------------------------------------------

USERS_RESPONSE=$(api_get "identity/users")

# Verify response is a JSON object with a users array
USER_COUNT=$(echo "$USERS_RESPONSE" | jq '.users | length' 2>/dev/null || echo "-1")
if [ "$USER_COUNT" -ge 0 ] 2>/dev/null; then
  log_pass "GET /api/identity/users returns { users: [...] } array (count: $USER_COUNT)"
else
  log_fail "GET /api/identity/users did not return a valid users array"
fi

# Verify each user has required fields (check the first user)
if [ "$USER_COUNT" -gt 0 ]; then
  FIRST_USER=$(echo "$USERS_RESPONSE" | jq '.users[0]' 2>/dev/null || echo "{}")

  HAS_USERNAME=$(echo "$FIRST_USER" | jq 'has("username")' 2>/dev/null || echo "false")
  assert_eq "$HAS_USERNAME" "true" "User object has 'username' field" || true

  HAS_DISPLAYNAME=$(echo "$FIRST_USER" | jq 'has("displayname")' 2>/dev/null || echo "false")
  assert_eq "$HAS_DISPLAYNAME" "true" "User object has 'displayname' field" || true

  HAS_EMAIL=$(echo "$FIRST_USER" | jq 'has("email")' 2>/dev/null || echo "false")
  assert_eq "$HAS_EMAIL" "true" "User object has 'email' field" || true

  HAS_GROUPS=$(echo "$FIRST_USER" | jq 'has("groups")' 2>/dev/null || echo "false")
  assert_eq "$HAS_GROUPS" "true" "User object has 'groups' field" || true

  # Verify password hashes are NOT present
  assert_not_contains "$USERS_RESPONSE" "password" "No 'password' field in identity users response" || true
  assert_not_contains "$USERS_RESPONSE" '$2b$' "No bcrypt hash in identity users response" || true
else
  log_skip "No users found — cannot verify user object fields"
fi

# Store the first username for single-user lookup test
FIRST_USERNAME=$(echo "$USERS_RESPONSE" | jq -r '.users[0].username' 2>/dev/null || echo "")

# ---------------------------------------------------------------------------
log_section "GET /api/identity/users/:username (admin)"
# ---------------------------------------------------------------------------

if [ -n "$FIRST_USERNAME" ] && [ "$FIRST_USERNAME" != "null" ]; then
  SINGLE_USER_RESPONSE=$(api_get "identity/users/${FIRST_USERNAME}")
  assert_json_field "$SINGLE_USER_RESPONSE" '.user.username' "$FIRST_USERNAME" "Single user lookup returns correct username" || true

  SINGLE_USER_STATUS=$(api_get_status "identity/users/${FIRST_USERNAME}")
  assert_eq "$SINGLE_USER_STATUS" "200" "Single user lookup returns 200" || true
else
  log_skip "No username available for single-user lookup test"
fi

# Nonexistent user returns 404
NOTFOUND_STATUS=$(api_get_status "identity/users/nonexistent-user-xyz-999")
assert_eq "$NOTFOUND_STATUS" "404" "Nonexistent user returns 404" || true

# ---------------------------------------------------------------------------
log_section "GET /api/identity/groups (admin)"
# ---------------------------------------------------------------------------

GROUPS_RESPONSE=$(api_get "identity/groups")

GROUP_COUNT=$(echo "$GROUPS_RESPONSE" | jq '.groups | length' 2>/dev/null || echo "-1")
if [ "$GROUP_COUNT" -ge 0 ] 2>/dev/null; then
  log_pass "GET /api/identity/groups returns { groups: [...] } array (count: $GROUP_COUNT)"
else
  log_fail "GET /api/identity/groups did not return a valid groups array"
fi

# Verify groups are sorted
if [ "$GROUP_COUNT" -gt 1 ]; then
  SORTED_GROUPS=$(echo "$GROUPS_RESPONSE" | jq '[.groups[]] | sort' 2>/dev/null || echo "[]")
  ACTUAL_GROUPS=$(echo "$GROUPS_RESPONSE" | jq '[.groups[]]' 2>/dev/null || echo "[]")
  if [ "$SORTED_GROUPS" = "$ACTUAL_GROUPS" ]; then
    log_pass "Groups array is sorted"
  else
    log_fail "Groups array is not sorted"
  fi
else
  log_info "Only $GROUP_COUNT group(s) — sort order trivially correct"
fi

# Verify groups match what's in the user list
if [ "$USER_COUNT" -gt 0 ] && [ "$GROUP_COUNT" -ge 0 ]; then
  USER_GROUPS_SORTED=$(echo "$USERS_RESPONSE" | jq '[.users[].groups[]] | unique | sort' 2>/dev/null || echo "[]")
  ENDPOINT_GROUPS_SORTED=$(echo "$GROUPS_RESPONSE" | jq '[.groups[]] | sort' 2>/dev/null || echo "[]")
  if [ "$USER_GROUPS_SORTED" = "$ENDPOINT_GROUPS_SORTED" ]; then
    log_pass "Groups endpoint matches groups extracted from user list"
  else
    log_fail "Groups endpoint does not match user list groups (endpoint: $ENDPOINT_GROUPS_SORTED, users: $USER_GROUPS_SORTED)"
  fi
fi

# ---------------------------------------------------------------------------
log_section "GET /api/identity/self (admin, mTLS vhost)"
# ---------------------------------------------------------------------------

SELF_RESPONSE=$(api_get "identity/self")
assert_contains "$SELF_RESPONSE" "Identity headers not present" "identity/self returns 400 with appropriate message on mTLS vhost" || true

SELF_STATUS=$(api_get_status "identity/self")
assert_eq "$SELF_STATUS" "400" "identity/self returns HTTP 400 on mTLS vhost" || true

# ---------------------------------------------------------------------------
log_section "Input validation — invalid username parameter"
# ---------------------------------------------------------------------------

# Special characters that fail the regex /^[a-zA-Z0-9_.-]+$/
INVALID_STATUS=$(api_get_status "identity/users/%3Cscript%3E")
assert_eq "$INVALID_STATUS" "400" "Username with special characters returns 400" || true

INVALID_STATUS2=$(api_get_status "identity/users/user%2F..%2Fetc")
assert_eq "$INVALID_STATUS2" "400" "Username with path traversal returns 400" || true

# Empty/nonexistent sub-path returns 404
EMPTY_PATH_STATUS=$(api_get_status "identity/nonexistent")
assert_eq "$EMPTY_PATH_STATUS" "404" "Nonexistent identity sub-path returns 404" || true

# ---------------------------------------------------------------------------
log_section "identity:query capability gating"
# ---------------------------------------------------------------------------

# Create an agent cert WITHOUT identity:query (only tunnels:read)
AGENT_LABEL="identity-e2e-$(date +%s)"
CERT_RESPONSE=$(api_post "certs/agent" '{"label":"'"${AGENT_LABEL}"'","capabilities":["tunnels:read"]}')
assert_json_field "$CERT_RESPONSE" '.ok' 'true' "Agent cert without identity:query created" || true

P12_PASSWORD=$(echo "$CERT_RESPONSE" | jq -r '.p12Password' 2>/dev/null || echo "")

# Extract PEM cert and key from .p12 for curl
P12_PATH="/etc/lamalibre/lamaste/pki/agents/${AGENT_LABEL}/client.p12"
AGENT_CERT_PATH="/tmp/e2e-identity-cert.pem"
AGENT_KEY_PATH="/tmp/e2e-identity-key.pem"
sudo openssl pkcs12 -in "${P12_PATH}" -clcerts -nokeys -out "${AGENT_CERT_PATH}" -passin "pass:${P12_PASSWORD}" -legacy 2>/dev/null \
  || sudo openssl pkcs12 -in "${P12_PATH}" -clcerts -nokeys -out "${AGENT_CERT_PATH}" -passin "pass:${P12_PASSWORD}"
sudo openssl pkcs12 -in "${P12_PATH}" -nocerts -nodes -out "${AGENT_KEY_PATH}" -passin "pass:${P12_PASSWORD}" -legacy 2>/dev/null \
  || sudo openssl pkcs12 -in "${P12_PATH}" -nocerts -nodes -out "${AGENT_KEY_PATH}" -passin "pass:${P12_PASSWORD}"

log_pass "Extracted agent PEM cert and key from .p12"

# Agent curl helper
_agent_curl() {
  curl -s \
    --max-time "$CURL_TIMEOUT" \
    --insecure \
    --cert "$AGENT_CERT_PATH" \
    --key "$AGENT_KEY_PATH" \
    --cacert "$CA_PATH" \
    -H "Accept: application/json" \
    "$@"
}

agent_api_get_status() {
  _agent_curl -o /dev/null -w '%{http_code}' "${BASE_URL}/api/$1" 2>/dev/null || echo "000"
}

# Cleanup function — always runs on exit
cleanup() {
  log_info "Cleaning up identity test resources..."
  api_delete "certs/agent/${AGENT_LABEL}" 2>/dev/null || true
  sudo rm -f "${AGENT_CERT_PATH}" "${AGENT_KEY_PATH}" 2>/dev/null || true
}
trap cleanup EXIT

# Verify agent WITHOUT identity:query gets 403
AGENT_USERS_STATUS=$(agent_api_get_status "identity/users")
assert_eq "$AGENT_USERS_STATUS" "403" "Agent without identity:query gets 403 on /api/identity/users" || true

AGENT_GROUPS_STATUS=$(agent_api_get_status "identity/groups")
assert_eq "$AGENT_GROUPS_STATUS" "403" "Agent without identity:query gets 403 on /api/identity/groups" || true

# Update agent capabilities to include identity:query
PATCH_RESPONSE=$(api_patch "certs/agent/${AGENT_LABEL}/capabilities" '{"capabilities":["tunnels:read","identity:query"]}')
assert_json_field "$PATCH_RESPONSE" '.ok' 'true' "Agent capabilities updated to include identity:query" || true

# Verify agent WITH identity:query gets 200
AGENT_USERS_STATUS_AFTER=$(agent_api_get_status "identity/users")
assert_eq "$AGENT_USERS_STATUS_AFTER" "200" "Agent with identity:query gets 200 on /api/identity/users" || true

AGENT_GROUPS_STATUS_AFTER=$(agent_api_get_status "identity/groups")
assert_eq "$AGENT_GROUPS_STATUS_AFTER" "200" "Agent with identity:query gets 200 on /api/identity/groups" || true

# ---------------------------------------------------------------------------
log_section "Reserved API prefix: 'identity' in RESERVED_API_PREFIXES"
# ---------------------------------------------------------------------------

# Verify the constant file contains 'identity' in the reserved list.
# We check this by looking at the source file on disk (available in single-VM test).
CONSTANTS_FILE="/opt/lamalibre/lamaste/packages/serverd/src/lib/constants.js"
if [ -f "$CONSTANTS_FILE" ]; then
  if grep -qF "'identity'" "$CONSTANTS_FILE"; then
    log_pass "'identity' is listed in RESERVED_API_PREFIXES"
  else
    log_fail "'identity' is NOT listed in RESERVED_API_PREFIXES"
  fi
else
  # Fallback: try to register a ticket scope named 'identity' — should fail
  SCOPE_STATUS=$(api_post_status "tickets/scopes" '{"name":"identity","description":"Should fail"}')
  if [ "$SCOPE_STATUS" = "400" ] || [ "$SCOPE_STATUS" = "409" ] || [ "$SCOPE_STATUS" = "422" ]; then
    log_pass "'identity' prefix is reserved (ticket scope registration rejected with HTTP $SCOPE_STATUS)"
  else
    log_fail "'identity' prefix reservation not enforced (ticket scope returned HTTP $SCOPE_STATUS)"
  fi
fi

# ---------------------------------------------------------------------------
end_test

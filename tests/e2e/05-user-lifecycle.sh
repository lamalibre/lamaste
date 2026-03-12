#!/usr/bin/env bash
# ============================================================================
# 05 — User Lifecycle
# ============================================================================
# Verifies Authelia user CRUD operations:
# - Create user via POST /api/users
# - Verify user in GET /api/users (no password hash exposed)
# - Reset TOTP via POST /api/users/:username/reset-totp
# - Update user via PUT /api/users/:username
# - Delete user via DELETE /api/users/:username
# - Verify last-user deletion prevention
# ============================================================================

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/helpers.sh"

require_commands curl jq

TEST_USERNAME="e2etest-$(date +%s)"
TEST_DISPLAY="E2E Test User"
TEST_EMAIL="e2etest@example.com"
TEST_PASSWORD="SecurePass123!!"

begin_test "05 — User Lifecycle"

# ---------------------------------------------------------------------------
log_section "Pre-flight: check onboarding is complete"
# ---------------------------------------------------------------------------

ONBOARDING_STATUS=$(api_get "onboarding/status" | jq -r '.status' 2>/dev/null || echo "unknown")
if [ "$ONBOARDING_STATUS" != "COMPLETED" ]; then
  log_skip "Skipping user lifecycle tests — onboarding not complete"
  end_test
  exit $?
fi

# ---------------------------------------------------------------------------
log_section "Create user"
# ---------------------------------------------------------------------------

CREATE_BODY=$(cat <<EOF
{
  "username": "$TEST_USERNAME",
  "displayname": "$TEST_DISPLAY",
  "email": "$TEST_EMAIL",
  "password": "$TEST_PASSWORD"
}
EOF
)

CREATE_RESPONSE=$(api_post "users" "$CREATE_BODY")
assert_json_field "$CREATE_RESPONSE" '.ok' 'true' "User creation returned ok: true" || true
assert_json_field "$CREATE_RESPONSE" '.user.username' "$TEST_USERNAME" "Username matches" || true
assert_json_field "$CREATE_RESPONSE" '.user.displayname' "$TEST_DISPLAY" "Display name matches" || true
assert_json_field "$CREATE_RESPONSE" '.user.email' "$TEST_EMAIL" "Email matches" || true

# ---------------------------------------------------------------------------
log_section "Verify user in list"
# ---------------------------------------------------------------------------

LIST_RESPONSE=$(api_get "users")
FOUND_USER=$(echo "$LIST_RESPONSE" | jq -r --arg u "$TEST_USERNAME" '.users[] | select(.username == $u) | .username' 2>/dev/null || echo "")
assert_eq "$FOUND_USER" "$TEST_USERNAME" "User appears in GET /api/users" || true

# Verify password hash is NOT in the response
LIST_JSON=$(echo "$LIST_RESPONSE" | jq -r --arg u "$TEST_USERNAME" '.users[] | select(.username == $u)' 2>/dev/null || echo "{}")
assert_not_contains "$LIST_JSON" "password" "No password field in user list response" || true
assert_not_contains "$LIST_JSON" '$2b$' "No bcrypt hash in user list response" || true

# ---------------------------------------------------------------------------
log_section "Validation: duplicate username"
# ---------------------------------------------------------------------------

DUP_STATUS=$(api_post_status "users" "$CREATE_BODY")
assert_eq "$DUP_STATUS" "409" "Duplicate username rejected (HTTP 409)" || true

# ---------------------------------------------------------------------------
log_section "Validation: invalid input"
# ---------------------------------------------------------------------------

# Missing required fields
INVALID_STATUS=$(api_post_status "users" '{"username":"x"}')
if [ "$INVALID_STATUS" = "400" ] || [ "$INVALID_STATUS" = "422" ]; then
  log_pass "Incomplete user data rejected (HTTP $INVALID_STATUS)"
else
  log_fail "Incomplete user data should be rejected (got HTTP $INVALID_STATUS)"
fi

# Short password
SHORT_PW_STATUS=$(api_post_status "users" '{"username":"e2eshort","displayname":"Short","email":"s@s.com","password":"abc"}')
if [ "$SHORT_PW_STATUS" = "400" ] || [ "$SHORT_PW_STATUS" = "422" ]; then
  log_pass "Short password rejected (HTTP $SHORT_PW_STATUS)"
else
  log_fail "Short password should be rejected (got HTTP $SHORT_PW_STATUS)"
fi

# ---------------------------------------------------------------------------
log_section "Reset TOTP"
# ---------------------------------------------------------------------------

TOTP_RESPONSE=$(api_post "users/$TEST_USERNAME/reset-totp")
assert_json_field "$TOTP_RESPONSE" '.ok' 'true' "TOTP reset returned ok: true" || true

TOTP_URI=$(echo "$TOTP_RESPONSE" | jq -r '.totpUri' 2>/dev/null || echo "")
if echo "$TOTP_URI" | grep -q "^otpauth://"; then
  log_pass "TOTP URI is a valid otpauth:// URI"
else
  log_fail "TOTP URI does not start with otpauth:// (got: $TOTP_URI)"
fi

# ---------------------------------------------------------------------------
log_section "TOTP for nonexistent user"
# ---------------------------------------------------------------------------

TOTP_404_STATUS=$(api_post_status "users/nonexistent-user-xyz/reset-totp")
assert_eq "$TOTP_404_STATUS" "404" "TOTP reset for nonexistent user returns 404" || true

# ---------------------------------------------------------------------------
log_section "Update user"
# ---------------------------------------------------------------------------

UPDATED_DISPLAY="Updated E2E User"
UPDATE_RESPONSE=$(api_put "users/$TEST_USERNAME" "{\"displayname\":\"$UPDATED_DISPLAY\"}")
assert_json_field "$UPDATE_RESPONSE" '.ok' 'true' "User update returned ok: true" || true
assert_json_field "$UPDATE_RESPONSE" '.user.displayname' "$UPDATED_DISPLAY" "Display name updated" || true

# Verify the update persisted
LIST_AFTER=$(api_get "users")
FOUND_DISPLAY=$(echo "$LIST_AFTER" | jq -r --arg u "$TEST_USERNAME" '.users[] | select(.username == $u) | .displayname' 2>/dev/null || echo "")
assert_eq "$FOUND_DISPLAY" "$UPDATED_DISPLAY" "Display name persisted after update" || true

# ---------------------------------------------------------------------------
log_section "Update nonexistent user"
# ---------------------------------------------------------------------------

UPDATE_404_STATUS=$(curl -s -o /dev/null -w '%{http_code}' \
  --max-time "$CURL_TIMEOUT" \
  --insecure \
  --cert "$CERT_PATH" \
  --key "$KEY_PATH" \
  --cacert "$CA_PATH" \
  -X PUT \
  -H "Content-Type: application/json" \
  -d '{"displayname":"Ghost"}' \
  "${BASE_URL}/api/users/nonexistent-user-xyz" 2>/dev/null || echo "000")
assert_eq "$UPDATE_404_STATUS" "404" "Update nonexistent user returns 404" || true

# ---------------------------------------------------------------------------
log_section "Delete user"
# ---------------------------------------------------------------------------

DELETE_RESPONSE=$(api_delete "users/$TEST_USERNAME")
assert_json_field "$DELETE_RESPONSE" '.ok' 'true' "User deletion returned ok: true" || true

# Verify user is gone
LIST_FINAL=$(api_get "users")
FOUND_FINAL=$(echo "$LIST_FINAL" | jq -r --arg u "$TEST_USERNAME" '.users[] | select(.username == $u) | .username' 2>/dev/null || echo "")
assert_eq "$FOUND_FINAL" "" "User no longer in list after deletion" || true

# ---------------------------------------------------------------------------
log_section "Cannot delete last user"
# ---------------------------------------------------------------------------

# Get the list of remaining users
REMAINING=$(api_get "users")
USER_COUNT=$(echo "$REMAINING" | jq '.users | length' 2>/dev/null || echo "0")

if [ "$USER_COUNT" = "1" ]; then
  LAST_USER=$(echo "$REMAINING" | jq -r '.users[0].username' 2>/dev/null || echo "")
  LAST_DEL_STATUS=$(curl -s -o /dev/null -w '%{http_code}' \
    --max-time "$CURL_TIMEOUT" \
    --insecure \
    --cert "$CERT_PATH" \
    --key "$KEY_PATH" \
    --cacert "$CA_PATH" \
    -X DELETE \
    "${BASE_URL}/api/users/$LAST_USER" 2>/dev/null || echo "000")
  assert_eq "$LAST_DEL_STATUS" "400" "Cannot delete last user (HTTP 400)" || true
else
  log_info "Cannot test last-user protection — $USER_COUNT users exist (need exactly 1)"
  log_info "This scenario is tested when only the admin user remains"
fi

# ---------------------------------------------------------------------------
log_section "Delete nonexistent user"
# ---------------------------------------------------------------------------

DEL_404_STATUS=$(curl -s -o /dev/null -w '%{http_code}' \
  --max-time "$CURL_TIMEOUT" \
  --insecure \
  --cert "$CERT_PATH" \
  --key "$KEY_PATH" \
  --cacert "$CA_PATH" \
  -X DELETE \
  "${BASE_URL}/api/users/nonexistent-user-xyz" 2>/dev/null || echo "000")
assert_eq "$DEL_404_STATUS" "404" "Delete nonexistent user returns 404" || true

end_test

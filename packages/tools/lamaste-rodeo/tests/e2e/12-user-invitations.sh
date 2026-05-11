#!/usr/bin/env bash
# ============================================================================
# 12 — User Invitations
# ============================================================================
# Verifies user invitation flow:
# - Create invitation via POST /api/invitations
# - List invitations
# - Accept invitation via POST /api/invite/:token/accept
# - Verify invited user created
# - Validate invitation token format
# - Test expired/used tokens
# ============================================================================

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/helpers.sh"

require_commands curl jq

INVITE_USERNAME="e2einvite-$(date +%s)"
INVITE_EMAIL="e2einvite@example.com"
INVITE_PASSWORD="InvitePass123!!"
INVITE_TOKEN=""
INVITE_ID=""

begin_test "12 — User Invitations"

# ---------------------------------------------------------------------------
log_section "Pre-flight: check onboarding is complete"
# ---------------------------------------------------------------------------

ONBOARDING_STATUS=$(api_get "onboarding/status" | jq -r '.status' 2>/dev/null || echo "unknown")
if [ "$ONBOARDING_STATUS" != "COMPLETED" ]; then
  log_skip "Skipping invitation tests — onboarding not complete"
  end_test
  exit $?
fi

# ---------------------------------------------------------------------------
log_section "Create invitation"
# ---------------------------------------------------------------------------

CREATE_BODY=$(cat <<EOF
{
  "username": "$INVITE_USERNAME",
  "email": "$INVITE_EMAIL",
  "groups": [],
  "expiresInDays": 7
}
EOF
)

CREATE_RESPONSE=$(api_post "invitations" "$CREATE_BODY")
assert_json_field "$CREATE_RESPONSE" '.ok' 'true' "Invitation creation returned ok: true" || true
assert_json_field "$CREATE_RESPONSE" '.invitation.username' "$INVITE_USERNAME" "Invitation username matches" || true
assert_json_field "$CREATE_RESPONSE" '.invitation.email' "$INVITE_EMAIL" "Invitation email matches" || true

INVITE_TOKEN=$(echo "$CREATE_RESPONSE" | jq -r '.token' 2>/dev/null || echo "")
INVITE_ID=$(echo "$CREATE_RESPONSE" | jq -r '.invitation.id' 2>/dev/null || echo "")

# Verify token is a 64-character hex string
if echo "$INVITE_TOKEN" | grep -qE '^[a-f0-9]{64}$'; then
  log_pass "Invitation token is valid 64-char hex"
else
  log_fail "Invitation token is not valid 64-char hex (got: ${INVITE_TOKEN:0:20}...)"
fi

assert_json_field_not_empty "$CREATE_RESPONSE" '.invitation.id' "Invitation ID is present" || true
assert_json_field_not_empty "$CREATE_RESPONSE" '.invitation.createdAt' "Invitation createdAt is present" || true
assert_json_field_not_empty "$CREATE_RESPONSE" '.invitation.expiresAt' "Invitation expiresAt is present" || true

# ---------------------------------------------------------------------------
log_section "List invitations"
# ---------------------------------------------------------------------------

LIST_RESPONSE=$(api_get "invitations")
FOUND_INVITE=$(echo "$LIST_RESPONSE" | jq -r --arg u "$INVITE_USERNAME" \
  '.invitations[] | select(.username == $u) | .username' 2>/dev/null || echo "")
assert_eq "$FOUND_INVITE" "$INVITE_USERNAME" "Invitation appears in GET /api/invitations" || true

# Verify token is NOT exposed in list response
FOUND_TOKEN=$(echo "$LIST_RESPONSE" | jq -r --arg u "$INVITE_USERNAME" \
  '.invitations[] | select(.username == $u) | .token' 2>/dev/null || echo "null")
assert_eq "$FOUND_TOKEN" "null" "Token is not exposed in invitation list" || true

# Verify status is pending
FOUND_STATUS=$(echo "$LIST_RESPONSE" | jq -r --arg u "$INVITE_USERNAME" \
  '.invitations[] | select(.username == $u) | .status' 2>/dev/null || echo "")
assert_eq "$FOUND_STATUS" "pending" "Invitation status is pending" || true

# ---------------------------------------------------------------------------
log_section "Duplicate invitation"
# ---------------------------------------------------------------------------

DUP_STATUS=$(api_post_status "invitations" "$CREATE_BODY")
assert_eq "$DUP_STATUS" "409" "Duplicate invitation for same username rejected (HTTP 409)" || true

# ---------------------------------------------------------------------------
log_section "Validation: invalid input"
# ---------------------------------------------------------------------------

# Missing required fields
INVALID_STATUS=$(api_post_status "invitations" '{"email":"bad@example.com"}')
if [ "$INVALID_STATUS" = "400" ] || [ "$INVALID_STATUS" = "422" ]; then
  log_pass "Incomplete invitation data rejected (HTTP $INVALID_STATUS)"
else
  log_fail "Incomplete invitation data should be rejected (got HTTP $INVALID_STATUS)"
fi

# Invalid email
INVALID_EMAIL_STATUS=$(api_post_status "invitations" '{"username":"e2evalid","email":"notanemail","groups":[]}')
if [ "$INVALID_EMAIL_STATUS" = "400" ] || [ "$INVALID_EMAIL_STATUS" = "422" ]; then
  log_pass "Invalid email rejected (HTTP $INVALID_EMAIL_STATUS)"
else
  log_fail "Invalid email should be rejected (got HTTP $INVALID_EMAIL_STATUS)"
fi

# ---------------------------------------------------------------------------
log_section "Get invitation details (public endpoint)"
# ---------------------------------------------------------------------------

# The invite details endpoint is public — hit Fastify directly (no nginx mTLS)
DETAILS_RESPONSE=$(curl -s \
  --max-time "$CURL_TIMEOUT" \
  -H "Accept: application/json" \
  "${PANEL_DIRECT_URL}/api/invite/${INVITE_TOKEN}" 2>/dev/null || echo "{}")

assert_json_field "$DETAILS_RESPONSE" '.username' "$INVITE_USERNAME" "Public invite details show username" || true
assert_json_field "$DETAILS_RESPONSE" '.email' "$INVITE_EMAIL" "Public invite details show email" || true
assert_json_field_not_empty "$DETAILS_RESPONSE" '.expiresAt' "Public invite details show expiresAt" || true

# ---------------------------------------------------------------------------
log_section "Invalid token"
# ---------------------------------------------------------------------------

INVALID_TOKEN="0000000000000000000000000000000000000000000000000000000000000000"
INVALID_TOKEN_STATUS=$(curl -s -o /dev/null -w '%{http_code}' \
  --max-time "$CURL_TIMEOUT" \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"password":"SomePass12345!!"}' \
  "${PANEL_DIRECT_URL}/api/invite/${INVALID_TOKEN}/accept" 2>/dev/null || echo "000")
assert_eq "$INVALID_TOKEN_STATUS" "404" "Accept with invalid token returns 404" || true

# Non-hex token should fail validation (400)
BAD_FORMAT_STATUS=$(curl -s -o /dev/null -w '%{http_code}' \
  --max-time "$CURL_TIMEOUT" \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"password":"SomePass12345!!"}' \
  "${PANEL_DIRECT_URL}/api/invite/not-a-valid-token/accept" 2>/dev/null || echo "000")
if [ "$BAD_FORMAT_STATUS" = "400" ] || [ "$BAD_FORMAT_STATUS" = "422" ]; then
  log_pass "Malformed token rejected (HTTP $BAD_FORMAT_STATUS)"
else
  log_fail "Malformed token should be rejected (got HTTP $BAD_FORMAT_STATUS)"
fi

# ---------------------------------------------------------------------------
log_section "Accept invitation (public endpoint)"
# ---------------------------------------------------------------------------

ACCEPT_BODY=$(cat <<EOF
{
  "password": "$INVITE_PASSWORD"
}
EOF
)

# The accept endpoint is public — hit Fastify directly (no nginx mTLS)
ACCEPT_RESPONSE=$(curl -s \
  --max-time "$CURL_TIMEOUT" \
  -X POST \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d "$ACCEPT_BODY" \
  "${PANEL_DIRECT_URL}/api/invite/${INVITE_TOKEN}/accept" 2>/dev/null || echo "{}")

assert_json_field "$ACCEPT_RESPONSE" '.ok' 'true' "Invitation acceptance returned ok: true" || true
assert_json_field "$ACCEPT_RESPONSE" '.username' "$INVITE_USERNAME" "Accepted username matches" || true

# ---------------------------------------------------------------------------
log_section "Verify invited user exists"
# ---------------------------------------------------------------------------

USERS_RESPONSE=$(api_get "users")
FOUND_USER=$(echo "$USERS_RESPONSE" | jq -r --arg u "$INVITE_USERNAME" \
  '.users[] | select(.username == $u) | .username' 2>/dev/null || echo "")
assert_eq "$FOUND_USER" "$INVITE_USERNAME" "Invited user appears in GET /api/users" || true

# Verify email matches
FOUND_EMAIL=$(echo "$USERS_RESPONSE" | jq -r --arg u "$INVITE_USERNAME" \
  '.users[] | select(.username == $u) | .email' 2>/dev/null || echo "")
assert_eq "$FOUND_EMAIL" "$INVITE_EMAIL" "Invited user email matches" || true

# ---------------------------------------------------------------------------
log_section "Invitation marked as accepted"
# ---------------------------------------------------------------------------

LIST_AFTER=$(api_get "invitations")
AFTER_STATUS=$(echo "$LIST_AFTER" | jq -r --arg u "$INVITE_USERNAME" \
  '.invitations[] | select(.username == $u) | .status' 2>/dev/null || echo "")
assert_eq "$AFTER_STATUS" "accepted" "Invitation status changed to accepted" || true

# ---------------------------------------------------------------------------
log_section "Used token rejection"
# ---------------------------------------------------------------------------

# Attempting to accept the same token again should fail with 410 Gone
REUSE_STATUS=$(curl -s -o /dev/null -w '%{http_code}' \
  --max-time "$CURL_TIMEOUT" \
  -X POST \
  -H "Content-Type: application/json" \
  -d "$ACCEPT_BODY" \
  "${PANEL_DIRECT_URL}/api/invite/${INVITE_TOKEN}/accept" 2>/dev/null || echo "000")
assert_eq "$REUSE_STATUS" "410" "Reusing accepted token returns 410 Gone" || true

# GET on used token should also return 410
REUSE_GET_STATUS=$(curl -s -o /dev/null -w '%{http_code}' \
  --max-time "$CURL_TIMEOUT" \
  -H "Accept: application/json" \
  "${PANEL_DIRECT_URL}/api/invite/${INVITE_TOKEN}" 2>/dev/null || echo "000")
assert_eq "$REUSE_GET_STATUS" "410" "GET on used token returns 410 Gone" || true

# ---------------------------------------------------------------------------
log_section "Accept with short password"
# ---------------------------------------------------------------------------

# Create a second invitation to test password validation
INVITE2_USERNAME="e2einvite2-$(date +%s)"
INVITE2_BODY=$(cat <<EOF
{
  "username": "$INVITE2_USERNAME",
  "email": "e2einvite2@example.com",
  "groups": []
}
EOF
)

INVITE2_RESPONSE=$(api_post "invitations" "$INVITE2_BODY")
INVITE2_TOKEN=$(echo "$INVITE2_RESPONSE" | jq -r '.token' 2>/dev/null || echo "")

if [ -n "$INVITE2_TOKEN" ] && [ "$INVITE2_TOKEN" != "null" ]; then
  SHORT_PW_STATUS=$(curl -s -o /dev/null -w '%{http_code}' \
    --max-time "$CURL_TIMEOUT" \
    -X POST \
    -H "Content-Type: application/json" \
    -d '{"password":"short"}' \
    "${PANEL_DIRECT_URL}/api/invite/${INVITE2_TOKEN}/accept" 2>/dev/null || echo "000")
  if [ "$SHORT_PW_STATUS" = "400" ] || [ "$SHORT_PW_STATUS" = "422" ]; then
    log_pass "Short password rejected on invite accept (HTTP $SHORT_PW_STATUS)"
  else
    log_fail "Short password should be rejected on invite accept (got HTTP $SHORT_PW_STATUS)"
  fi

  # Clean up: revoke the second invitation
  INVITE2_ID=$(echo "$INVITE2_RESPONSE" | jq -r '.invitation.id' 2>/dev/null || echo "")
  if [ -n "$INVITE2_ID" ] && [ "$INVITE2_ID" != "null" ]; then
    api_delete "invitations/$INVITE2_ID" > /dev/null 2>&1 || true
  fi
else
  log_skip "Could not create second invitation for password validation test"
fi

# ---------------------------------------------------------------------------
log_section "Cleanup: delete invited user"
# ---------------------------------------------------------------------------

DELETE_RESPONSE=$(api_delete "users/$INVITE_USERNAME")
assert_json_field "$DELETE_RESPONSE" '.ok' 'true' "Invited user deletion returned ok: true" || true

# Verify user is gone
USERS_FINAL=$(api_get "users")
FOUND_FINAL=$(echo "$USERS_FINAL" | jq -r --arg u "$INVITE_USERNAME" \
  '.users[] | select(.username == $u) | .username' 2>/dev/null || echo "")
assert_eq "$FOUND_FINAL" "" "Invited user no longer in list after deletion" || true

end_test

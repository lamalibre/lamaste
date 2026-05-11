#!/usr/bin/env bash
# ============================================================================
# 08 — Invitation Journey (Three-VM)
# ============================================================================
# Tests the full invitation flow for a new user invited by an admin, with
# public-facing steps executed from an external visitor VM:
#
# 1. Admin creates an invitation via POST /api/invitations
# 2. Visitor GETs /api/invite/:token (public, no mTLS)
# 3. Visitor POSTs /api/invite/:token/accept (public, no mTLS)
# 4. Verify invited user appears in admin's user list
# 5. New user authenticates from visitor VM (firstfactor + secondfactor TOTP)
# 6. Visitor re-uses invitation token — should get 410 Gone
# 7. Cleanup: delete invited user
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../e2e/helpers.sh"

require_commands multipass curl jq

# ---------------------------------------------------------------------------
# VM exec helpers
# ---------------------------------------------------------------------------

host_exec() { multipass exec lamaste-host -- sudo bash -c "$1"; }
visitor_exec() { multipass exec lamaste-visitor -- sudo bash -c "$1"; }

host_api_get() {
  host_exec "curl -skf --max-time 30 --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key --cacert /etc/lamalibre/lamaste/pki/ca.crt -H 'Accept: application/json' https://127.0.0.1:9292/api/$1"
}

host_api_post() {
  host_exec "curl -skf --max-time 30 --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key --cacert /etc/lamalibre/lamaste/pki/ca.crt -X POST -H 'Content-Type: application/json' -H 'Accept: application/json' -d '$2' https://127.0.0.1:9292/api/$1"
}

host_api_delete() {
  host_exec "curl -skf --max-time 30 --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key --cacert /etc/lamalibre/lamaste/pki/ca.crt -X DELETE -H 'Accept: application/json' https://127.0.0.1:9292/api/$1"
}

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

INVITED_USERNAME="inviteduser"
INVITED_EMAIL="invited@test.local"
INVITED_PASSWORD="InvitedPass123!!"
INVITE_TOKEN=""
INVITATION_ID=""

begin_test "08 — Invitation Journey (Three-VM)"

# ---------------------------------------------------------------------------
# Cleanup function — always runs on exit
# ---------------------------------------------------------------------------

cleanup() {
  log_info "Cleaning up test resources..."
  visitor_exec "rm -f /tmp/authelia-invite-cookies.txt 2>/dev/null || true" 2>/dev/null || true
  # Delete the invited user if they were created
  host_api_delete "users/${INVITED_USERNAME}" 2>/dev/null || true
  # Delete the invitation if it was created
  if [ -n "$INVITATION_ID" ] && [ "$INVITATION_ID" != "null" ]; then
    host_api_delete "invitations/${INVITATION_ID}" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
log_section "Pre-flight: verify onboarding is complete"
# ---------------------------------------------------------------------------

ONBOARDING_STATUS=$(host_api_get "onboarding/status" | jq -r '.status' 2>/dev/null || echo "unknown")
if [ "$ONBOARDING_STATUS" != "COMPLETED" ]; then
  log_skip "Onboarding not completed (status: $ONBOARDING_STATUS). Skipping invitation journey tests."
  end_test
  exit $?
fi

# ---------------------------------------------------------------------------
log_section "Pre-flight: ensure oathtool is available on visitor VM"
# ---------------------------------------------------------------------------

OATHTOOL_CHECK=$(visitor_exec "command -v oathtool && echo yes || echo no" 2>/dev/null || echo "no")
if [ "$OATHTOOL_CHECK" = "no" ]; then
  log_skip "oathtool not available on visitor VM. Skipping TOTP-dependent tests."
  end_test
  exit $?
fi

# ---------------------------------------------------------------------------
log_section "Admin creates invitation"
# ---------------------------------------------------------------------------

CREATE_RESPONSE=$(host_api_post "invitations" '{"username":"'"${INVITED_USERNAME}"'","email":"'"${INVITED_EMAIL}"'"}')
assert_json_field "$CREATE_RESPONSE" '.ok' 'true' "Invitation creation returned ok: true" || true

INVITE_TOKEN=$(echo "$CREATE_RESPONSE" | jq -r '.token' 2>/dev/null || echo "")
assert_json_field_not_empty "$CREATE_RESPONSE" '.token' "Invitation has a token" || true

INVITATION_ID=$(echo "$CREATE_RESPONSE" | jq -r '.invitation.id' 2>/dev/null || echo "")
assert_json_field_not_empty "$CREATE_RESPONSE" '.invitation.id' "Invitation has an ID" || true

INVITE_URL=$(echo "$CREATE_RESPONSE" | jq -r '.inviteUrl' 2>/dev/null || echo "")
assert_json_field_not_empty "$CREATE_RESPONSE" '.inviteUrl' "Invitation has an invite URL" || true
log_info "Created invitation for ${INVITED_USERNAME} (token: ${INVITE_TOKEN:0:16}...)"

# Verify the invitation appears in the admin list
LIST_RESPONSE=$(host_api_get "invitations")
FOUND_INVITE=$(echo "$LIST_RESPONSE" | jq -r --arg u "$INVITED_USERNAME" '.invitations[] | select(.username == $u) | .username' 2>/dev/null || echo "")
assert_eq "$FOUND_INVITE" "$INVITED_USERNAME" "Invitation appears in admin invitation list" || true

# ---------------------------------------------------------------------------
log_section "Visit invitation page from visitor VM (public, no mTLS)"
# ---------------------------------------------------------------------------

# The invite routes are public endpoints proxied through the auth vhost.
# No mTLS required — accessed from the external visitor VM.
INVITE_DETAILS=$(visitor_exec "curl -sk --max-time 15 -H 'Accept: application/json' https://auth.${TEST_DOMAIN}/api/invite/${INVITE_TOKEN} 2>/dev/null" || echo '{}')

INVITE_USERNAME=$(echo "$INVITE_DETAILS" | jq -r '.username' 2>/dev/null || echo "")
INVITE_EMAIL_RESP=$(echo "$INVITE_DETAILS" | jq -r '.email' 2>/dev/null || echo "")
INVITE_EXPIRES=$(echo "$INVITE_DETAILS" | jq -r '.expiresAt' 2>/dev/null || echo "")

assert_eq "$INVITE_USERNAME" "$INVITED_USERNAME" "Invite page returns correct username" || true
assert_eq "$INVITE_EMAIL_RESP" "$INVITED_EMAIL" "Invite page returns correct email" || true
assert_json_field_not_empty "$INVITE_DETAILS" '.expiresAt' "Invite page returns expiresAt" || true

# ---------------------------------------------------------------------------
log_section "Accept invitation from visitor VM (public, no mTLS)"
# ---------------------------------------------------------------------------

ACCEPT_RESPONSE=$(visitor_exec "curl -sk --max-time 15 -X POST -H 'Content-Type: application/json' -d '{\"password\":\"${INVITED_PASSWORD}\"}' https://auth.${TEST_DOMAIN}/api/invite/${INVITE_TOKEN}/accept 2>/dev/null" || echo '{}')

assert_json_field "$ACCEPT_RESPONSE" '.ok' 'true' "Invitation acceptance returned ok: true" || true
assert_json_field "$ACCEPT_RESPONSE" '.username' "$INVITED_USERNAME" "Acceptance response returns correct username" || true
log_info "User ${INVITED_USERNAME} created via invitation"

# ---------------------------------------------------------------------------
log_section "Verify user appears in admin's user list"
# ---------------------------------------------------------------------------

USERS_RESPONSE=$(host_api_get "users")
FOUND_USER=$(echo "$USERS_RESPONSE" | jq -r --arg u "$INVITED_USERNAME" '.users[] | select(.username == $u) | .username' 2>/dev/null || echo "")
assert_eq "$FOUND_USER" "$INVITED_USERNAME" "Invited user appears in admin user list" || true

# ---------------------------------------------------------------------------
log_section "Reset TOTP for invited user before authentication"
# ---------------------------------------------------------------------------

# IMPORTANT: TOTP must be reset BEFORE firstfactor auth, not after.
# If reset after firstfactor, Authelia rejects the secondfactor because
# the TOTP configuration changed mid-session.
TOTP_RESPONSE=$(host_api_post "users/${INVITED_USERNAME}/reset-totp" '{}')
TOTP_URI=$(echo "$TOTP_RESPONSE" | jq -r '.totpUri' 2>/dev/null || echo "")

if echo "$TOTP_URI" | grep -q "^otpauth://"; then
  log_pass "TOTP reset succeeded for invited user"
else
  log_fail "Failed to reset TOTP for ${INVITED_USERNAME} (response: $TOTP_RESPONSE)"
fi

# Extract the TOTP secret from the URI
TOTP_SECRET=$(echo "$TOTP_URI" | sed -n 's/.*secret=\([A-Z2-7]*\).*/\1/p')
if [ -z "$TOTP_SECRET" ]; then
  log_fail "Failed to extract TOTP secret from URI: $TOTP_URI"
fi

# Allow Authelia to pick up the new TOTP configuration
sleep 2

# ---------------------------------------------------------------------------
log_section "New user authenticates from visitor VM (firstfactor)"
# ---------------------------------------------------------------------------

FIRST_FACTOR_RESPONSE=$(visitor_exec "curl -sk --max-time 15 -c /tmp/authelia-invite-cookies.txt -X POST -H 'Content-Type: application/json' -d '{\"username\":\"${INVITED_USERNAME}\",\"password\":\"${INVITED_PASSWORD}\",\"keepMeLoggedIn\":false}' https://auth.${TEST_DOMAIN}/api/firstfactor 2>/dev/null" || echo '{}')

FIRST_STATUS=$(echo "$FIRST_FACTOR_RESPONSE" | jq -r '.status' 2>/dev/null || echo "unknown")
if [ "$FIRST_STATUS" = "OK" ]; then
  log_pass "Invited user firstfactor authentication succeeded"
else
  log_fail "Invited user firstfactor authentication failed (status: $FIRST_STATUS, response: $FIRST_FACTOR_RESPONSE)"
fi

# ---------------------------------------------------------------------------
log_section "New user authenticates from visitor VM (secondfactor TOTP)"
# ---------------------------------------------------------------------------

# Generate a TOTP code on visitor VM using oathtool
TOTP_CODE=$(visitor_exec "oathtool --totp --base32 '${TOTP_SECRET}'" 2>/dev/null || echo "")
if [ -n "$TOTP_CODE" ]; then
  log_pass "Generated TOTP code for invited user on visitor VM"
else
  log_fail "Failed to generate TOTP code for invited user"
fi

# POST secondfactor TOTP from visitor VM
TOTP_AUTH_RESPONSE=$(visitor_exec "curl -sk --max-time 15 -b /tmp/authelia-invite-cookies.txt -c /tmp/authelia-invite-cookies.txt -X POST -H 'Content-Type: application/json' -d '{\"token\":\"${TOTP_CODE}\"}' https://auth.${TEST_DOMAIN}/api/secondfactor/totp 2>/dev/null" || echo '{}')

TOTP_AUTH_STATUS=$(echo "$TOTP_AUTH_RESPONSE" | jq -r '.status' 2>/dev/null || echo "unknown")
if [ "$TOTP_AUTH_STATUS" = "OK" ]; then
  log_pass "Invited user secondfactor TOTP authentication succeeded"
else
  log_fail "Invited user secondfactor TOTP authentication failed (status: $TOTP_AUTH_STATUS, response: $TOTP_AUTH_RESPONSE)"
fi

# Verify the session cookie is valid by checking Authelia's verify endpoint
VERIFY_STATUS=$(visitor_exec "curl -sk -o /dev/null -w '%{http_code}' --max-time 15 -b /tmp/authelia-invite-cookies.txt https://auth.${TEST_DOMAIN}/api/verify 2>/dev/null" || echo "000")
if [ "$VERIFY_STATUS" = "200" ]; then
  log_pass "Invited user session is valid (verify returned 200)"
else
  log_info "Authelia verify returned HTTP $VERIFY_STATUS (may not have a verify endpoint)"
fi

# ---------------------------------------------------------------------------
log_section "Used invitation token is rejected (from visitor VM)"
# ---------------------------------------------------------------------------

REUSE_STATUS=$(visitor_exec "curl -sk -o /dev/null -w '%{http_code}' --max-time 15 -H 'Accept: application/json' https://auth.${TEST_DOMAIN}/api/invite/${INVITE_TOKEN} 2>/dev/null" || echo "000")
assert_eq "$REUSE_STATUS" "410" "Used invitation token returns 410 Gone" || true

REUSE_ACCEPT_STATUS=$(visitor_exec "curl -sk -o /dev/null -w '%{http_code}' --max-time 15 -X POST -H 'Content-Type: application/json' -d '{\"password\":\"AnotherPass456!!\"}' https://auth.${TEST_DOMAIN}/api/invite/${INVITE_TOKEN}/accept 2>/dev/null" || echo "000")
assert_eq "$REUSE_ACCEPT_STATUS" "410" "Used invitation token acceptance returns 410 Gone" || true

# ---------------------------------------------------------------------------
log_section "Cleanup: delete invited user"
# ---------------------------------------------------------------------------

DELETE_RESPONSE=$(host_api_delete "users/${INVITED_USERNAME}")
assert_json_field "$DELETE_RESPONSE" '.ok' 'true' "Invited user deletion returned ok: true" || true

# Verify user is gone from the list
USERS_FINAL=$(host_api_get "users")
FOUND_FINAL=$(echo "$USERS_FINAL" | jq -r --arg u "$INVITED_USERNAME" '.users[] | select(.username == $u) | .username' 2>/dev/null || echo "")
assert_eq "$FOUND_FINAL" "" "Invited user no longer in list after deletion" || true

end_test

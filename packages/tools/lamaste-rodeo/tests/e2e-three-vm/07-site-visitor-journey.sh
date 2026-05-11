#!/usr/bin/env bash
# ============================================================================
# 07 — Static Site Visitor Journey (Three-VM)
# ============================================================================
# Tests the full visitor experience for a managed static site from an external
# visitor VM:
#
# 1. Create a managed static site via API (Authelia-protected)
# 2. Write a test index.html to the site directory
# 3. Visit site from visitor VM without auth — should redirect to Authelia (302)
# 4. Authenticate with Authelia from visitor VM (firstfactor + secondfactor TOTP)
# 5. Visit site from visitor VM with auth — should return site content (200)
# 6. Disable Authelia protection via PATCH
# 7. Visit site from visitor VM without auth — should now return content (200)
# 8. Re-enable Authelia protection via PATCH
# 9. Visit site from visitor VM without auth — should redirect again (302)
# 10. Cleanup: delete the site
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

host_api_patch() {
  host_exec "curl -skf --max-time 30 --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key --cacert /etc/lamalibre/lamaste/pki/ca.crt -X PATCH -H 'Content-Type: application/json' -H 'Accept: application/json' -d '$2' https://127.0.0.1:9292/api/$1"
}

host_api_delete() {
  host_exec "curl -skf --max-time 30 --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key --cacert /etc/lamalibre/lamaste/pki/ca.crt -X DELETE -H 'Accept: application/json' https://127.0.0.1:9292/api/$1"
}

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

SITE_NAME="e2eblog"
SITE_FQDN="${SITE_NAME}.${TEST_DOMAIN}"
SITE_ID=""
MARKER="E2E_SITE_TEST_OK_$(date +%s)"

begin_test "07 — Static Site Visitor Journey (Three-VM)"

# ---------------------------------------------------------------------------
# Cleanup function — always runs on exit
# ---------------------------------------------------------------------------

cleanup() {
  log_info "Cleaning up test resources..."
  visitor_exec "rm -f /tmp/authelia-site-cookies.txt 2>/dev/null || true" 2>/dev/null || true
  visitor_exec "sed -i '/${SITE_FQDN}/d' /etc/hosts 2>/dev/null || true" 2>/dev/null || true
  if [ -n "$SITE_ID" ] && [ "$SITE_ID" != "null" ]; then
    host_api_delete "sites/${SITE_ID}" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
log_section "Pre-flight: verify onboarding is complete"
# ---------------------------------------------------------------------------

ONBOARDING_STATUS=$(host_api_get "onboarding/status" | jq -r '.status' 2>/dev/null || echo "unknown")
if [ "$ONBOARDING_STATUS" != "COMPLETED" ]; then
  log_skip "Onboarding not completed (status: $ONBOARDING_STATUS). Skipping site visitor journey tests."
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
log_section "Create managed static site via API"
# ---------------------------------------------------------------------------

CREATE_RESPONSE=$(host_api_post "sites" '{"name":"'"${SITE_NAME}"'","type":"managed","spaMode":false,"autheliaProtected":true}')
assert_json_field "$CREATE_RESPONSE" '.ok' 'true' "Site creation returned ok: true" || true

SITE_ID=$(echo "$CREATE_RESPONSE" | jq -r '.site.id' 2>/dev/null || echo "")
assert_json_field_not_empty "$CREATE_RESPONSE" '.site.id' "Site has an ID" || true
log_info "Created site ID: $SITE_ID (${SITE_FQDN})"

SITE_FQDN_ACTUAL=$(echo "$CREATE_RESPONSE" | jq -r '.site.fqdn' 2>/dev/null || echo "")
assert_eq "$SITE_FQDN_ACTUAL" "$SITE_FQDN" "Site FQDN matches expected value" || true

# ---------------------------------------------------------------------------
log_section "Write test index.html to site directory"
# ---------------------------------------------------------------------------

host_exec "echo '<h1>${MARKER}</h1>' > /var/www/lamaste/${SITE_ID}/index.html"
WROTE_FILE=$(host_exec "cat /var/www/lamaste/${SITE_ID}/index.html 2>/dev/null" || echo "")
assert_contains "$WROTE_FILE" "$MARKER" "index.html written to site directory" || true

# Wait for nginx to settle after site creation
sleep 2

# Add /etc/hosts entry on visitor for the site subdomain
visitor_exec "grep -q '${SITE_FQDN}' /etc/hosts || echo '${HOST_IP} ${SITE_FQDN}' >> /etc/hosts"

# ---------------------------------------------------------------------------
log_section "Visit site from visitor VM WITHOUT auth — should redirect to Authelia"
# ---------------------------------------------------------------------------

UNAUTH_STATUS=$(visitor_exec "curl -sk -o /dev/null -w '%{http_code}' --max-time 15 https://${SITE_FQDN}/ 2>/dev/null" || echo "000")

if [ "$UNAUTH_STATUS" = "302" ] || [ "$UNAUTH_STATUS" = "401" ]; then
  log_pass "Unauthenticated request redirected/rejected (HTTP $UNAUTH_STATUS)"
else
  log_fail "Unauthenticated request should be redirected (302 or 401), got HTTP $UNAUTH_STATUS"
fi

# Verify redirect target is the Authelia portal
UNAUTH_LOCATION=$(visitor_exec "curl -sk -o /dev/null -w '%{redirect_url}' --max-time 15 https://${SITE_FQDN}/ 2>/dev/null" || echo "")
if echo "$UNAUTH_LOCATION" | grep -qF "auth.${TEST_DOMAIN}"; then
  log_pass "Redirect points to Authelia portal (auth.${TEST_DOMAIN})"
elif [ "$UNAUTH_STATUS" = "401" ]; then
  log_pass "Request returned 401 (Authelia enforcement confirmed)"
else
  log_fail "Redirect does not point to Authelia portal (location: $UNAUTH_LOCATION)"
fi

# ---------------------------------------------------------------------------
log_section "Reset TOTP before authentication"
# ---------------------------------------------------------------------------

# Reset TOTP for the test user to get a known secret
# IMPORTANT: TOTP must be reset BEFORE firstfactor auth, not after.
# If reset after firstfactor, Authelia may reject the secondfactor because
# the TOTP configuration changed mid-session.
TOTP_RESPONSE=$(host_api_post "users/${TEST_USER}/reset-totp" '{}')
TOTP_URI=$(echo "$TOTP_RESPONSE" | jq -r '.totpUri' 2>/dev/null || echo "")

if echo "$TOTP_URI" | grep -q "^otpauth://"; then
  log_pass "TOTP reset succeeded, got otpauth URI"
else
  log_fail "Failed to reset TOTP for ${TEST_USER} (response: $TOTP_RESPONSE)"
fi

# Extract the TOTP secret from the URI
TOTP_SECRET=$(echo "$TOTP_URI" | sed -n 's/.*secret=\([A-Z2-7]*\).*/\1/p')
if [ -z "$TOTP_SECRET" ]; then
  log_fail "Failed to extract TOTP secret from URI: $TOTP_URI"
fi

# Let Authelia pick up the new TOTP configuration and ensure we submit the
# code in a fresh 30-second window (anti-replay protection would reject a
# code reused from a prior test within the same window).
wait_for_next_totp_window

# ---------------------------------------------------------------------------
log_section "Authenticate with Authelia from visitor VM (firstfactor)"
# ---------------------------------------------------------------------------

AUTH_RESPONSE=$(visitor_exec "curl -sk --max-time 15 -c /tmp/authelia-site-cookies.txt -X POST -H 'Content-Type: application/json' -d '{\"username\":\"${TEST_USER}\",\"password\":\"${TEST_USER_PASSWORD}\",\"keepMeLoggedIn\":false,\"targetURL\":\"https://${SITE_FQDN}/\"}' https://auth.${TEST_DOMAIN}/api/firstfactor 2>/dev/null" || echo '{}')

AUTH_STATUS=$(echo "$AUTH_RESPONSE" | jq -r '.status' 2>/dev/null || echo "unknown")
if [ "$AUTH_STATUS" = "OK" ]; then
  log_pass "Authelia firstfactor authentication succeeded"
else
  log_fail "Authelia firstfactor authentication failed (status: $AUTH_STATUS, response: $AUTH_RESPONSE)"
fi

# ---------------------------------------------------------------------------
log_section "Authenticate with Authelia from visitor VM (secondfactor TOTP)"
# ---------------------------------------------------------------------------

# Generate a TOTP code on visitor VM using oathtool
TOTP_CODE=$(visitor_exec "oathtool --totp --base32 '${TOTP_SECRET}'" 2>/dev/null || echo "")
if [ -n "$TOTP_CODE" ]; then
  log_pass "Generated TOTP code with oathtool on visitor VM"
else
  log_fail "Failed to generate TOTP code"
fi

# POST secondfactor TOTP from visitor VM
TOTP_AUTH_RESPONSE=$(visitor_exec "curl -sk --max-time 15 -b /tmp/authelia-site-cookies.txt -c /tmp/authelia-site-cookies.txt -X POST -H 'Content-Type: application/json' -d '{\"token\":\"${TOTP_CODE}\",\"targetURL\":\"https://${SITE_FQDN}/\"}' https://auth.${TEST_DOMAIN}/api/secondfactor/totp 2>/dev/null" || echo '{}')

TOTP_AUTH_STATUS=$(echo "$TOTP_AUTH_RESPONSE" | jq -r '.status' 2>/dev/null || echo "unknown")
if [ "$TOTP_AUTH_STATUS" = "OK" ]; then
  log_pass "Authelia secondfactor TOTP authentication succeeded"
else
  log_fail "Authelia secondfactor TOTP authentication failed (status: $TOTP_AUTH_STATUS, response: $TOTP_AUTH_RESPONSE)"
fi

# ---------------------------------------------------------------------------
log_section "Visit site from visitor VM WITH auth — should return content"
# ---------------------------------------------------------------------------

AUTH_CONTENT=$(visitor_exec "curl -sk --max-time 15 -b /tmp/authelia-site-cookies.txt https://${SITE_FQDN}/ 2>/dev/null" || echo "")
assert_contains "$AUTH_CONTENT" "$MARKER" "Authenticated request returns site content" || true

AUTH_HTTP_STATUS=$(visitor_exec "curl -sk -o /dev/null -w '%{http_code}' --max-time 15 -b /tmp/authelia-site-cookies.txt https://${SITE_FQDN}/ 2>/dev/null" || echo "000")
assert_eq "$AUTH_HTTP_STATUS" "200" "Authenticated request returns HTTP 200" || true

# ---------------------------------------------------------------------------
log_section "Disable Authelia protection"
# ---------------------------------------------------------------------------

DISABLE_RESPONSE=$(host_api_patch "sites/${SITE_ID}" '{"autheliaProtected":false}')
assert_json_field "$DISABLE_RESPONSE" '.ok' 'true' "Disable Authelia protection returned ok: true" || true
assert_json_field "$DISABLE_RESPONSE" '.site.autheliaProtected' 'false' "Site shows autheliaProtected: false" || true

# Wait for nginx reload
sleep 2

# ---------------------------------------------------------------------------
log_section "Visit site from visitor VM WITHOUT auth — should now return content (unprotected)"
# ---------------------------------------------------------------------------

UNPROTECTED_STATUS=$(visitor_exec "curl -sk -o /dev/null -w '%{http_code}' --max-time 15 https://${SITE_FQDN}/ 2>/dev/null" || echo "000")
assert_eq "$UNPROTECTED_STATUS" "200" "Unprotected site returns HTTP 200 without auth" || true

UNPROTECTED_CONTENT=$(visitor_exec "curl -sk --max-time 15 https://${SITE_FQDN}/ 2>/dev/null" || echo "")
assert_contains "$UNPROTECTED_CONTENT" "$MARKER" "Unprotected site returns expected content" || true

# ---------------------------------------------------------------------------
log_section "Re-enable Authelia protection"
# ---------------------------------------------------------------------------

REENABLE_RESPONSE=$(host_api_patch "sites/${SITE_ID}" '{"autheliaProtected":true}')
assert_json_field "$REENABLE_RESPONSE" '.ok' 'true' "Re-enable Authelia protection returned ok: true" || true
assert_json_field "$REENABLE_RESPONSE" '.site.autheliaProtected' 'true' "Site shows autheliaProtected: true" || true

# Wait for nginx reload
sleep 2

# ---------------------------------------------------------------------------
log_section "Verify protection is back — visitor without auth should redirect"
# ---------------------------------------------------------------------------

REPROTECTED_STATUS=$(visitor_exec "curl -sk -o /dev/null -w '%{http_code}' --max-time 15 https://${SITE_FQDN}/ 2>/dev/null" || echo "000")

if [ "$REPROTECTED_STATUS" = "302" ] || [ "$REPROTECTED_STATUS" = "401" ]; then
  log_pass "Re-protected site redirects/rejects unauthenticated request (HTTP $REPROTECTED_STATUS)"
else
  log_fail "Re-protected site should redirect (302 or 401), got HTTP $REPROTECTED_STATUS"
fi

# ---------------------------------------------------------------------------
log_section "Cleanup: delete site via API"
# ---------------------------------------------------------------------------

DELETE_RESPONSE=$(host_api_delete "sites/${SITE_ID}")
assert_json_field "$DELETE_RESPONSE" '.ok' 'true' "Site deletion returned ok: true" || true

# Mark ID as empty so the trap cleanup doesn't try to delete again
SITE_ID=""

# Verify site is gone from the list
LIST_RESPONSE=$(host_api_get "sites")
FOUND_SITE=$(echo "$LIST_RESPONSE" | jq -r --arg name "$SITE_NAME" '.sites[] | select(.name == $name) | .name' 2>/dev/null || echo "")
assert_eq "$FOUND_SITE" "" "Site no longer appears in site list after deletion" || true

end_test

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
#    — with a query holding `&`: the sign-in redirect's `rd`, decoded once, is
#    the whole URL; nginx's access log keeps the path and no query
# 4. Authenticate with Authelia from visitor VM (firstfactor + secondfactor TOTP)
# 5. Visit site from visitor VM with auth — should return site content (200)
#    — and a second site, for another user only, refuses that session: Authelia
#    logs the refusal with the path and without the query
# 6. Disable Authelia protection via PATCH
# 7. Visit site from visitor VM without auth — should now return content (200)
# 8. Re-enable Authelia protection via PATCH
# 9. Visit site from visitor VM without auth — should redirect again (302)
# 10. Cleanup: delete the site
# 11. Custom-domain site with an alias: verify DNS (dnsmasq on the host
#     resolves the custom domain), then from the visitor the alias answers
#     301 to the same path on the site's domain and following it serves the
#     site; adding an alias to the live site re-issues the certificate
#
# Every visitor request verifies the host's certificate (no -k): the visitor
# trusts the E2E test CA (setup-visitor.sh), so a certificate that does not
# name the requested host — e.g. an alias missing from subjectAltName — fails.
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

# Custom-domain site with aliases (section 11)
RUN_ID="$(date +%s)"
CUSTOM_DOMAIN="e2e-alias-${RUN_ID}.test"
ALIAS_WWW="www.${CUSTOM_DOMAIN}"
ALIAS_BLOG="blog.${CUSTOM_DOMAIN}"
ALIAS_SITE_ID=""
ALIAS_MARKER="E2E_ALIAS_SITE_OK_${RUN_ID}"
ALIAS_DNSMASQ_CONF="/etc/dnsmasq.d/lamaste-e2e-07-aliases.conf"

# A second protected site, restricted to a user who does not exist: Authelia
# refuses the signed-in test user there, and logs the refusal
CLOSED_NAME="e2eclosed${RUN_ID}"
CLOSED_FQDN="${CLOSED_NAME}.${TEST_DOMAIN}"
CLOSED_ID=""

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
  if [ -n "$CLOSED_ID" ] && [ "$CLOSED_ID" != "null" ]; then
    host_api_delete "sites/${CLOSED_ID}" > /dev/null 2>&1 || true
  fi
  visitor_exec "sed -i '/${CLOSED_FQDN}/d' /etc/hosts 2>/dev/null || true" 2>/dev/null || true
  if [ -n "$ALIAS_SITE_ID" ] && [ "$ALIAS_SITE_ID" != "null" ]; then
    host_api_delete "sites/${ALIAS_SITE_ID}" > /dev/null 2>&1 || true
  fi
  visitor_exec "sed -i '/${CUSTOM_DOMAIN}/d' /etc/hosts 2>/dev/null || true" 2>/dev/null || true
  host_exec "rm -f ${ALIAS_DNSMASQ_CONF} && systemctl restart dnsmasq" > /dev/null 2>&1 || true
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

# Before anyone signs in: a site rule may restart Authelia, which ends sessions.
CLOSED_RESPONSE=$(host_api_post "sites" '{"name":"'"${CLOSED_NAME}"'","type":"managed","spaMode":false,"autheliaProtected":true}')
CLOSED_ID=$(echo "$CLOSED_RESPONSE" | jq -r '.site.id' 2>/dev/null || echo "")
assert_json_field_not_empty "$CLOSED_RESPONSE" '.site.id' "A second protected site is created" || true
CLOSED_PATCH=$(host_api_patch "sites/${CLOSED_ID}" '{"allowedUsers":["e2e07nobody'"${RUN_ID}"'"]}')
assert_json_field "$CLOSED_PATCH" '.ok' 'true' "…restricted to another user only" || true
visitor_exec "grep -q '${CLOSED_FQDN}' /etc/hosts || echo '${HOST_IP} ${CLOSED_FQDN}' >> /etc/hosts"

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

UNAUTH_STATUS=$(visitor_exec "curl -s -o /dev/null -w '%{http_code}' --max-time 15 https://${SITE_FQDN}/ 2>/dev/null" || echo "000")

if [ "$UNAUTH_STATUS" = "302" ] || [ "$UNAUTH_STATUS" = "401" ]; then
  log_pass "Unauthenticated request redirected/rejected (HTTP $UNAUTH_STATUS)"
else
  log_fail "Unauthenticated request should be redirected (302 or 401), got HTTP $UNAUTH_STATUS"
fi

# Verify redirect target is the Authelia portal
UNAUTH_LOCATION=$(visitor_exec "curl -s -o /dev/null -w '%{redirect_url}' --max-time 15 https://${SITE_FQDN}/ 2>/dev/null" || echo "")
if echo "$UNAUTH_LOCATION" | grep -qF "auth.${TEST_DOMAIN}"; then
  log_pass "Redirect points to Authelia portal (auth.${TEST_DOMAIN})"
elif [ "$UNAUTH_STATUS" = "401" ]; then
  log_pass "Request returned 401 (Authelia enforcement confirmed)"
else
  log_fail "Redirect does not point to Authelia portal (location: $UNAUTH_LOCATION)"
fi

# ---------------------------------------------------------------------------
log_section "The sign-in redirect carries the whole URL; the access log keeps no query"
# ---------------------------------------------------------------------------

# A query with two parameters and an encoded `&`: Gatekeeper's sign-in
# redirect encodes the whole URL as one `rd`, so decoding it once gives the
# URL back byte for byte. nginx logs the path, never the query.
PROBE="e2eprobe${RUN_ID}x${RANDOM}"
PROBE_PATH="/e2e-07-probe-${RUN_ID}.html"
PROBE_URL="https://${SITE_FQDN}${PROBE_PATH}?probe=${PROBE}&next=a%26b"
PROBE_LOCATION=$(visitor_exec "curl -s -o /dev/null -w '%{redirect_url}' --max-time 15 '${PROBE_URL}' 2>/dev/null" || echo "")
assert_contains "$PROBE_LOCATION" "https://auth.${TEST_DOMAIN}/?rd=" "The sign-in redirect goes to the domain's portal" || true
PROBE_RD_ENCODED="${PROBE_LOCATION#*rd=}"
PROBE_RD_ENCODED="${PROBE_RD_ENCODED%%&*}"
PROBE_RD=$(printf '%b' "${PROBE_RD_ENCODED//%/\\x}")
assert_eq "$PROBE_RD" "$PROBE_URL" "rd, decoded once, is the whole original URL with its query" || true

PROBE_IN_LOG=$(host_exec "grep -c '${PROBE}' /var/log/nginx/access.log || true")
assert_eq "$PROBE_IN_LOG" "0" "The access log keeps no query (the probe value is nowhere)" || true
PATH_IN_LOG=$(host_exec "grep -c 'GET ${PROBE_PATH} HTTP' /var/log/nginx/access.log || true")
if [ "${PATH_IN_LOG:-0}" -ge 1 ] 2>/dev/null; then
  log_pass "The access log keeps the path of the request"
else
  log_fail "The access log has no line for ${PROBE_PATH} (count: ${PATH_IN_LOG})"
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

AUTH_RESPONSE=$(visitor_exec "curl -s --max-time 15 -c /tmp/authelia-site-cookies.txt -X POST -H 'Content-Type: application/json' -d '{\"username\":\"${TEST_USER}\",\"password\":\"${TEST_USER_PASSWORD}\",\"keepMeLoggedIn\":false,\"targetURL\":\"https://${SITE_FQDN}/\"}' https://auth.${TEST_DOMAIN}/api/firstfactor 2>/dev/null" || echo '{}')

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
TOTP_AUTH_RESPONSE=$(visitor_exec "curl -s --max-time 15 -b /tmp/authelia-site-cookies.txt -c /tmp/authelia-site-cookies.txt -X POST -H 'Content-Type: application/json' -d '{\"token\":\"${TOTP_CODE}\",\"targetURL\":\"https://${SITE_FQDN}/\"}' https://auth.${TEST_DOMAIN}/api/secondfactor/totp 2>/dev/null" || echo '{}')

TOTP_AUTH_STATUS=$(echo "$TOTP_AUTH_RESPONSE" | jq -r '.status' 2>/dev/null || echo "unknown")
if [ "$TOTP_AUTH_STATUS" = "OK" ]; then
  log_pass "Authelia secondfactor TOTP authentication succeeded"
else
  log_fail "Authelia secondfactor TOTP authentication failed (status: $TOTP_AUTH_STATUS, response: $TOTP_AUTH_RESPONSE)"
fi

# ---------------------------------------------------------------------------
log_section "Visit site from visitor VM WITH auth — should return content"
# ---------------------------------------------------------------------------

AUTH_CONTENT=$(visitor_exec "curl -s --max-time 15 -b /tmp/authelia-site-cookies.txt https://${SITE_FQDN}/ 2>/dev/null" || echo "")
assert_contains "$AUTH_CONTENT" "$MARKER" "Authenticated request returns site content" || true

AUTH_HTTP_STATUS=$(visitor_exec "curl -s -o /dev/null -w '%{http_code}' --max-time 15 -b /tmp/authelia-site-cookies.txt https://${SITE_FQDN}/ 2>/dev/null" || echo "000")
assert_eq "$AUTH_HTTP_STATUS" "200" "Authenticated request returns HTTP 200" || true

# ---------------------------------------------------------------------------
log_section "Authelia refuses the signed-in user — and is never asked about the query"
# ---------------------------------------------------------------------------

# The second site admits another user only: Authelia refuses this session and
# logs the URL it was asked about. The path is there; the query is not.
REFUSED_PROBE="e2erefused${RUN_ID}x${RANDOM}"
REFUSED_PATH="/e2e-07-refused-${RUN_ID}.html"
REFUSED_STATUS=$(visitor_exec "curl -s -o /dev/null -w '%{http_code}' --max-time 15 -b /tmp/authelia-site-cookies.txt 'https://${CLOSED_FQDN}${REFUSED_PATH}?probe=${REFUSED_PROBE}&x=1' 2>/dev/null" || echo "000")
assert_eq "$REFUSED_STATUS" "403" "The signed-in user is refused on a site for another user (403)" || true
sleep 1
REFUSAL_LINES=$(host_exec "grep -c '${CLOSED_FQDN}${REFUSED_PATH}' /var/log/authelia/authelia.log 2>/dev/null || true")
if [ "${REFUSAL_LINES:-0}" -ge 1 ] 2>/dev/null; then
  log_pass "Authelia logged the refusal, naming the path"
else
  log_fail "Authelia's log has no refusal for ${CLOSED_FQDN}${REFUSED_PATH} (count: ${REFUSAL_LINES})"
fi
REFUSED_IN_AUTHELIA=$(host_exec "grep -c '${REFUSED_PROBE}' /var/log/authelia/authelia.log 2>/dev/null || true")
assert_eq "$REFUSED_IN_AUTHELIA" "0" "Authelia's log holds no query: it was asked about the path alone" || true
REFUSED_IN_NGINX=$(host_exec "grep -c '${REFUSED_PROBE}' /var/log/nginx/access.log || true")
assert_eq "$REFUSED_IN_NGINX" "0" "Nor does nginx's access log" || true

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

UNPROTECTED_STATUS=$(visitor_exec "curl -s -o /dev/null -w '%{http_code}' --max-time 15 https://${SITE_FQDN}/ 2>/dev/null" || echo "000")
assert_eq "$UNPROTECTED_STATUS" "200" "Unprotected site returns HTTP 200 without auth" || true

UNPROTECTED_CONTENT=$(visitor_exec "curl -s --max-time 15 https://${SITE_FQDN}/ 2>/dev/null" || echo "")
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

REPROTECTED_STATUS=$(visitor_exec "curl -s -o /dev/null -w '%{http_code}' --max-time 15 https://${SITE_FQDN}/ 2>/dev/null" || echo "000")

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

# ---------------------------------------------------------------------------
log_section "Custom-domain site with an alias: create and verify DNS"
# ---------------------------------------------------------------------------

ALIAS_SITE_RESPONSE=$(host_api_post "sites" "{\"name\":\"e2ealias${RUN_ID}\",\"type\":\"custom\",\"customDomain\":\"${CUSTOM_DOMAIN}\",\"aliases\":[\"${ALIAS_WWW}\"],\"autheliaProtected\":false}" 2>/dev/null || echo '{}')
assert_json_field "$ALIAS_SITE_RESPONSE" '.ok' 'true' "Custom site with alias ${ALIAS_WWW} created" || true
ALIAS_SITE_ID=$(echo "$ALIAS_SITE_RESPONSE" | jq -r '.site.id // empty' 2>/dev/null || echo "")

# Point the custom domain and every name under it at the host, the same way
# setup-host.sh points the Lamaste domain at it
host_exec "echo 'address=/${CUSTOM_DOMAIN}/${HOST_IP}' > ${ALIAS_DNSMASQ_CONF} && systemctl restart dnsmasq"
sleep 1

VERIFY_RESPONSE=$(host_api_post "sites/${ALIAS_SITE_ID}/verify-dns" '{}' 2>/dev/null || echo '{}')
assert_json_field "$VERIFY_RESPONSE" '.ok' 'true' "verify-dns succeeds for the domain and its alias" || true

ALIAS_SAN=$(host_exec "openssl x509 -noout -ext subjectAltName -in /etc/letsencrypt/live/${CUSTOM_DOMAIN}/fullchain.pem" 2>/dev/null || echo "")
assert_contains "$ALIAS_SAN" "DNS:${ALIAS_WWW}" "One certificate lineage covers the domain and ${ALIAS_WWW}" || true

host_exec "echo '<h1>${ALIAS_MARKER}</h1>' > /var/www/lamaste/${ALIAS_SITE_ID}/index.html"

visitor_exec "sed -i '/${CUSTOM_DOMAIN}/d' /etc/hosts; printf '%s\n' '${HOST_IP} ${CUSTOM_DOMAIN}' '${HOST_IP} ${ALIAS_WWW}' '${HOST_IP} ${ALIAS_BLOG}' >> /etc/hosts"

# ---------------------------------------------------------------------------
log_section "Visitor follows the alias to the site's domain"
# ---------------------------------------------------------------------------

ALIAS_REDIRECT=$(visitor_exec "curl -s -o /dev/null -w '%{http_code} %{redirect_url}' --max-time 15 'https://${ALIAS_WWW}/docs/page?x=1' 2>/dev/null" || echo "000")
assert_eq "$ALIAS_REDIRECT" "301 https://${CUSTOM_DOMAIN}/docs/page?x=1" "Alias answers 301 to the same path on the site's domain (TLS verified)" || true

ALIAS_FOLLOWED=$(visitor_exec "curl -sL --max-time 15 'https://${ALIAS_WWW}/' 2>/dev/null" || echo "")
assert_contains "$ALIAS_FOLLOWED" "$ALIAS_MARKER" "Following the alias serves the site's content" || true

# ---------------------------------------------------------------------------
log_section "Add an alias to the live site"
# ---------------------------------------------------------------------------

ADD_ALIAS_RESPONSE=$(host_api_patch "sites/${ALIAS_SITE_ID}" "{\"aliases\":[\"${ALIAS_WWW}\",\"${ALIAS_BLOG}\"]}" 2>/dev/null || echo '{}')
assert_json_field "$ADD_ALIAS_RESPONSE" '.site.aliases | join(",")' "${ALIAS_WWW},${ALIAS_BLOG}" "Alias ${ALIAS_BLOG} added to the live site" || true
sleep 2

# Verified TLS on the new alias proves the certificate was re-issued for it
BLOG_REDIRECT=$(visitor_exec "curl -s -o /dev/null -w '%{http_code} %{redirect_url}' --max-time 15 'https://${ALIAS_BLOG}/' 2>/dev/null" || echo "000")
assert_eq "$BLOG_REDIRECT" "301 https://${CUSTOM_DOMAIN}/" "New alias answers 301 with a certificate that names it" || true

# ---------------------------------------------------------------------------
log_section "Cleanup: delete the custom-domain site"
# ---------------------------------------------------------------------------

ALIAS_DELETE=$(host_api_delete "sites/${ALIAS_SITE_ID}" 2>/dev/null || echo '{}')
assert_json_field "$ALIAS_DELETE" '.ok' 'true' "Custom-domain site deleted" || true
ALIAS_SITE_ID=""

end_test

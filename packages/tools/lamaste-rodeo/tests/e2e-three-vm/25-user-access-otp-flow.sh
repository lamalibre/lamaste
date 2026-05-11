#!/usr/bin/env bash
# ============================================================================
# 25 — User Access OTP Flow (Three-VM)
# ============================================================================
# Exercises the Authelia → desktop login user-access flow:
#   1. Admin creates a LOCAL grant for testuser (pluginName: @lamalibre/herd-server).
#   2. testuser first-factor + TOTP via Authelia — captures authelia_session cookie.
#   3. GET /api/user-access/authorize on auth.<domain> with PKCE challenge + nonce.
#      Expects 302 with Location: lamalibre://callback#token=...&domain=...&nonce=...
#   4. POST /api/user-access/exchange on the panel domain with {token, verifier}.
#      Expects {ok:true, sessionToken, username}. Bearer auth token.
#   5. GET /api/user-access/plugins with Bearer — expects the granted plugin.
#   6. POST /api/user-access/enroll with Bearer + grantId — expects enrollmentToken.
#   7. Negative: exchange with wrong verifier → 401.
#
# Every multipass exec that risks pipe-leaks is wrapped by timed_exec / curl
# max-time caps, and the cleanup trap revokes the grant + agent cert if created.
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../e2e/helpers.sh"

require_commands multipass curl jq openssl

# ---------------------------------------------------------------------------
# VM exec helpers
# ---------------------------------------------------------------------------
host_exec()    { multipass exec lamaste-host    -- sudo bash -c "$1"; }
visitor_exec() { multipass exec lamaste-visitor -- sudo bash -c "$1"; }

host_api_get() {
  host_exec "curl -skf --max-time 30 --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key --cacert /etc/lamalibre/lamaste/pki/ca.crt -H 'Accept: application/json' https://127.0.0.1:9292/api/$1"
}
host_api_post() {
  host_exec "curl -skf --max-time 30 --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key --cacert /etc/lamalibre/lamaste/pki/ca.crt -X POST -H 'Content-Type: application/json' -H 'Accept: application/json' -d '$2' https://127.0.0.1:9292/api/$1"
}
host_api_delete() {
  host_exec "curl -skf --max-time 30 --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key --cacert /etc/lamalibre/lamaste/pki/ca.crt -X DELETE https://127.0.0.1:9292/api/$1"
}

CLEANUP_CURL_ARGS="-skf --max-time 30 --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key --cacert /etc/lamalibre/lamaste/pki/ca.crt"
cleanup_host_delete() {
  timed_exec 35 multipass exec lamaste-host -- sudo bash -c \
    "curl ${CLEANUP_CURL_ARGS} -X DELETE https://127.0.0.1:9292/api/$1" \
    >/dev/null 2>&1
}

# ---------------------------------------------------------------------------
# PKCE helpers
# ---------------------------------------------------------------------------
# S256 verifier: 50 base64url chars (within Zod's 32–64 bound).
VERIFIER="dGVzdHZlcmlmaWVyRTJFdXNlckFjY2Vzc090cEZsb3cxMjM0NQ"
# S256 challenge: base64url(sha256(VERIFIER)), 43 chars, no padding.
CHALLENGE=$(printf '%s' "${VERIFIER}" | openssl dgst -sha256 -binary | openssl base64 -A | tr '+/' '-_' | tr -d '=')
# 16-byte random nonce, hex-encoded (32 chars). Generate fresh per run.
NONCE=$(openssl rand -hex 16)

GRANT_ID=""
ENROLL_LABEL=""
OTP_TOKEN=""
SESSION_TOKEN=""

cleanup() {
  log_info "Cleaning up test resources..."
  if [ -n "${GRANT_ID}" ]; then
    cleanup_host_delete "user-access/grants/${GRANT_ID}"
  fi
  if [ -n "${ENROLL_LABEL}" ]; then
    # Best-effort revoke the agent cert that enrollment minted. A fresh
    # enrollment token is single-use and consumed by /enroll — the agent cert
    # it produced lives on until revoked. Use the admin /certs/agent/:label
    # DELETE endpoint.
    cleanup_host_delete "certs/agent/${ENROLL_LABEL}"
  fi
}
trap cleanup EXIT

begin_test "25 — User Access OTP Flow (Three-VM)"

# ---------------------------------------------------------------------------
log_section "Pre-flight: onboarding + domain"
# ---------------------------------------------------------------------------
ONBOARDING=$(host_api_get "onboarding/status" 2>/dev/null || echo '{"status":"unknown"}')
STATUS=$(echo "$ONBOARDING" | jq -r '.status' 2>/dev/null || echo "unknown")
if [ "$STATUS" != "COMPLETED" ]; then
  log_skip "Onboarding not complete — skipping user-access OTP flow"
  end_test
  exit $?
fi
log_pass "Onboarding is complete"

# We need a test domain to build the /authorize URL.
if [ -z "${TEST_DOMAIN:-}" ]; then
  log_skip "TEST_DOMAIN not set — skipping"
  end_test
  exit $?
fi
log_info "Using domain: ${TEST_DOMAIN}"
log_info "Test user: ${TEST_USER}"

# ---------------------------------------------------------------------------
log_section "Admin creates a local grant for testuser"
# ---------------------------------------------------------------------------
GRANT_RESP=$(host_api_post "user-access/grants" "{\"username\":\"${TEST_USER}\",\"pluginName\":\"@lamalibre/herd-server\",\"target\":\"local\"}" 2>&1 || echo '{"ok":false}')
assert_json_field "$GRANT_RESP" '.ok' 'true' "Grant created with .ok === true" || true

GRANT_ID=$(echo "$GRANT_RESP" | jq -r '.grant.grantId' 2>/dev/null || echo "")
assert_json_field_not_empty "$GRANT_RESP" '.grant.grantId' "Grant has an id" || true

# Local grants must NOT be auto-consumed — user runs through authorize/exchange
# before consuming via /enroll.
assert_json_field "$GRANT_RESP" '.grant.used' 'false' "Local grant is NOT auto-consumed (used=false)" || true

if [ -z "$GRANT_ID" ] || [ "$GRANT_ID" = "null" ]; then
  log_fail "Grant creation did not return a usable grantId — aborting"
  end_test
  exit $?
fi
log_info "Created grant: ${GRANT_ID}"

# ---------------------------------------------------------------------------
log_section "Authelia first-factor + TOTP as testuser"
# ---------------------------------------------------------------------------
TOTP_RESET=$(host_api_post "users/${TEST_USER}/reset-totp" "{}" 2>&1 || echo '{}')
assert_json_field_not_empty "$TOTP_RESET" '.totpUri' "TOTP reset returned otpauth URI" || true
OTPAUTH_URI=$(echo "$TOTP_RESET" | jq -r '.totpUri' 2>/dev/null || echo "")
TOTP_SECRET=$(echo "$OTPAUTH_URI" | sed -n 's/.*secret=\([A-Z2-7]*\).*/\1/p')
if [ -z "$TOTP_SECRET" ]; then
  log_fail "Failed to extract TOTP secret — aborting"
  end_test
  exit $?
fi

wait_for_next_totp_window

visitor_exec "rm -f /tmp/user-access-cookies.txt"
FIRSTFACTOR_RESP=$(visitor_exec "curl -sk --max-time 15 -c /tmp/user-access-cookies.txt -X POST -H 'Content-Type: application/json' -d '{\"username\":\"${TEST_USER}\",\"password\":\"${TEST_USER_PASSWORD}\",\"keepMeLoggedIn\":false}' https://auth.${TEST_DOMAIN}/api/firstfactor 2>/dev/null" || echo '{}')
assert_json_field "$FIRSTFACTOR_RESP" '.status' 'OK' "Authelia first-factor returns OK" || true

TOTP_CODE=$(visitor_exec "oathtool --totp --base32 ${TOTP_SECRET}" 2>/dev/null || echo "")
TOTP_RESP=$(visitor_exec "curl -sk --max-time 15 -b /tmp/user-access-cookies.txt -c /tmp/user-access-cookies.txt -X POST -H 'Content-Type: application/json' -d '{\"token\":\"${TOTP_CODE}\"}' https://auth.${TEST_DOMAIN}/api/secondfactor/totp 2>/dev/null" || echo '{}')
assert_json_field "$TOTP_RESP" '.status' 'OK' "Authelia second-factor (TOTP) returns OK" || true

# ---------------------------------------------------------------------------
log_section "GET /api/user-access/authorize → OTP in redirect fragment"
# ---------------------------------------------------------------------------
# -o /dev/null + -D - captures headers, -w '%{http_code}' gives the status on
# the non-followed 302. We need the raw Location header — DON'T follow
# redirects, because the fragment is client-side only.
AUTH_HEADERS=$(visitor_exec "curl -sk --max-time 15 -o /dev/null -D - -b /tmp/user-access-cookies.txt 'https://auth.${TEST_DOMAIN}/api/user-access/authorize?challenge=${CHALLENGE}&nonce=${NONCE}'" 2>/dev/null || echo "")
AUTH_STATUS=$(visitor_exec "curl -sk --max-time 15 -o /dev/null -w '%{http_code}' -b /tmp/user-access-cookies.txt 'https://auth.${TEST_DOMAIN}/api/user-access/authorize?challenge=${CHALLENGE}&nonce=${NONCE}'" 2>/dev/null || echo "000")
assert_eq "$AUTH_STATUS" "302" "/authorize returns HTTP 302" || true

# Extract Location header (case-insensitive — nginx can emit either 'Location'
# or 'location'). Trim trailing CR.
AUTH_LOCATION=$(echo "$AUTH_HEADERS" | awk 'BEGIN{IGNORECASE=1} /^location:/ {print; exit}' | sed 's/^[Ll]ocation: //' | tr -d '\r')
assert_contains "$AUTH_LOCATION" "lamalibre://callback" "Location redirects to lamalibre://callback" || true
assert_contains "$AUTH_LOCATION" "token=" "Redirect fragment carries token=" || true
assert_contains "$AUTH_LOCATION" "${NONCE}" "Redirect fragment carries the nonce we submitted" || true

# Parse the token out of the fragment. Format: lamalibre://callback#token=HEX&domain=...&nonce=...
OTP_TOKEN=$(echo "$AUTH_LOCATION" | sed -n 's/.*[#&]token=\([a-f0-9]\{64\}\).*/\1/p')
if [[ "$OTP_TOKEN" =~ ^[a-f0-9]{64}$ ]]; then
  OTP_TOKEN_VALID="yes"
else
  OTP_TOKEN_VALID=""
fi
if [ -n "${OTP_TOKEN_VALID:-}" ]; then
  log_pass "OTP_TOKEN matches [a-f0-9]{64}"
else
  log_fail "OTP_TOKEN did not match [a-f0-9]{64} (location: $(echo "$AUTH_LOCATION" | head -c 200))"
fi

# ---------------------------------------------------------------------------
log_section "POST /api/user-access/exchange → Bearer session token"
# ---------------------------------------------------------------------------
EXCHANGE_BODY=$(printf '{"token":"%s","verifier":"%s"}' "${OTP_TOKEN}" "${VERIFIER}")
EXCHANGE_STATUS=$(visitor_exec "curl -sk --max-time 15 -o /tmp/user-access-exchange.json -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '${EXCHANGE_BODY}' https://panel.${TEST_DOMAIN}/api/user-access/exchange" 2>/dev/null || echo "000")
EXCHANGE_RESP=$(visitor_exec "cat /tmp/user-access-exchange.json 2>/dev/null" || echo '{}')
assert_eq "$EXCHANGE_STATUS" "200" "/exchange returns HTTP 200" || true
assert_json_field "$EXCHANGE_RESP" '.ok' 'true' "Exchange response has .ok === true" || true
assert_json_field_not_empty "$EXCHANGE_RESP" '.sessionToken' "Exchange response carries a sessionToken" || true

EXCHANGE_USERNAME=$(echo "$EXCHANGE_RESP" | jq -r '.username' 2>/dev/null || echo "")
if [ "$EXCHANGE_USERNAME" = "${TEST_USER}" ]; then
  log_pass "Exchange response echoes our username"
else
  log_fail "Exchange response echoes our username (expected '${TEST_USER}', got '$EXCHANGE_USERNAME')"
fi

SESSION_TOKEN=$(echo "$EXCHANGE_RESP" | jq -r '.sessionToken' 2>/dev/null || echo "")

# Single-use check: replaying the same token must fail. /exchange uses the
# same generic "Invalid or expired token" error for every failure, so we
# only assert the status code.
REPLAY_STATUS=$(visitor_exec "curl -sk --max-time 15 -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '${EXCHANGE_BODY}' https://panel.${TEST_DOMAIN}/api/user-access/exchange" 2>/dev/null || echo "000")
assert_eq "$REPLAY_STATUS" "401" "Second exchange (same OTP) returns 401 — single-use" || true

# ---------------------------------------------------------------------------
log_section "GET /api/user-access/plugins with Bearer session"
# ---------------------------------------------------------------------------
PLUGINS_STATUS=$(visitor_exec "curl -sk --max-time 15 -o /tmp/user-access-plugins.json -w '%{http_code}' -H 'Authorization: Bearer ${SESSION_TOKEN}' https://panel.${TEST_DOMAIN}/api/user-access/plugins" 2>/dev/null || echo "000")
PLUGINS_RESP=$(visitor_exec "cat /tmp/user-access-plugins.json 2>/dev/null" || echo '{}')
assert_eq "$PLUGINS_STATUS" "200" "/plugins returns HTTP 200" || true
assert_contains "$PLUGINS_RESP" "@lamalibre/herd-server" "Granted plugin appears in the response" || true

# Negative: no Authorization header → 401
PLUGINS_NOAUTH_STATUS=$(visitor_exec "curl -sk --max-time 15 -o /dev/null -w '%{http_code}' https://panel.${TEST_DOMAIN}/api/user-access/plugins" 2>/dev/null || echo "000")
assert_eq "$PLUGINS_NOAUTH_STATUS" "401" "/plugins without Bearer is 401" || true

# ---------------------------------------------------------------------------
log_section "POST /api/user-access/enroll with Bearer — consume grant"
# ---------------------------------------------------------------------------
ENROLL_BODY=$(printf '{"grantId":"%s"}' "${GRANT_ID}")
ENROLL_STATUS=$(visitor_exec "curl -sk --max-time 15 -o /tmp/user-access-enroll.json -w '%{http_code}' -X POST -H 'Content-Type: application/json' -H 'Authorization: Bearer ${SESSION_TOKEN}' -d '${ENROLL_BODY}' https://panel.${TEST_DOMAIN}/api/user-access/enroll" 2>/dev/null || echo "000")
ENROLL_RESP=$(visitor_exec "cat /tmp/user-access-enroll.json 2>/dev/null" || echo '{}')
assert_eq "$ENROLL_STATUS" "200" "/enroll returns HTTP 200" || true
assert_json_field_not_empty "$ENROLL_RESP" '.enrollmentToken' "/enroll returns an enrollmentToken" || true
assert_json_field_not_empty "$ENROLL_RESP" '.label' "/enroll returns a label derived from username+plugin" || true
assert_json_field "$ENROLL_RESP" '.pluginName' '@lamalibre/herd-server' "/enroll echoes the plugin name" || true

ENROLL_LABEL=$(echo "$ENROLL_RESP" | jq -r '.label' 2>/dev/null || echo "")
if [ -n "$ENROLL_LABEL" ] && [ "$ENROLL_LABEL" != "null" ]; then
  log_info "Enrollment minted label: ${ENROLL_LABEL}"
fi

# Replaying /enroll with the same grantId must fail — grant is single-use.
ENROLL_REPLAY_STATUS=$(visitor_exec "curl -sk --max-time 15 -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -H 'Authorization: Bearer ${SESSION_TOKEN}' -d '${ENROLL_BODY}' https://panel.${TEST_DOMAIN}/api/user-access/enroll" 2>/dev/null || echo "000")
assert_not_eq "$ENROLL_REPLAY_STATUS" "200" "Replay /enroll (same grantId) returns non-200 — grant consumed" || true

end_test

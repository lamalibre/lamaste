#!/usr/bin/env bash
# ============================================================================
# 22 — Restricted Tunnel + Per-User Grant (Three-VM)
# ============================================================================
# Exercises the security default: a tunnel created without an explicit
# accessMode is `restricted`, which requires an admin-issued grant for any
# user to reach it. We cover the three decisive states:
#
#   1. User has a grant           → 200 with tunnel content
#   2. User authenticates but has no grant → 403 (Gatekeeper access-request)
#   3. Admin revokes the grant     → previously-allowed user now 403
#
# Verifies both that the default posture holds (a fresh tunnel is not
# accessible to any authenticated user) and that the grant lifecycle
# actually drives the nginx/Gatekeeper decision — the surface we regressed
# before with the `fs.watch` atomic-replace bug.
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../e2e/helpers.sh"

require_commands multipass curl jq

# ---------------------------------------------------------------------------
# VM exec helpers
# ---------------------------------------------------------------------------
host_exec()    { multipass exec lamaste-host    -- sudo bash -c "$1"; }
visitor_exec() { multipass exec lamaste-visitor -- sudo bash -c "$1"; }
agent_exec()   { multipass exec lamaste-agent   -- sudo bash -c "$1"; }

host_api_get() {
  host_exec "curl -skf --max-time 30 --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key --cacert /etc/lamalibre/lamaste/pki/ca.crt -H 'Accept: application/json' https://127.0.0.1:9292/api/$1"
}
host_api_post() {
  host_exec "curl -skf --max-time 30 --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key --cacert /etc/lamalibre/lamaste/pki/ca.crt -X POST -H 'Content-Type: application/json' -H 'Accept: application/json' -d '$2' https://127.0.0.1:9292/api/$1"
}
host_api_delete() {
  host_exec "curl -skf --max-time 30 --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key --cacert /etc/lamalibre/lamaste/pki/ca.crt -X DELETE https://127.0.0.1:9292/api/$1"
}

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
TUNNEL_SUBDOMAIN="e2erestricted"
TUNNEL_PORT=18090
TUNNEL_FQDN="${TUNNEL_SUBDOMAIN}.${TEST_DOMAIN}"
TUNNEL_ID=""
GRANT_ID=""
MARKER="LAMASTE_RESTRICTED_OK_$(date +%s)"
OUTSIDER_USER="e2eoutsider"
OUTSIDER_PASSWORD="Outsider-E2E-Password-123"

# ---------------------------------------------------------------------------
# Cleanup on exit — runs even when assertions fail
#
# Every multipass exec is wrapped in `timeout` at the host level because a
# SIGKILL'd `multipass exec` child can reparent to launchd (PPID 1) and hold
# stdout open, blocking the outer bash pipe indefinitely. A 35s outer cap
# lets each step fail fast without hanging the whole suite.
# ---------------------------------------------------------------------------
CLEANUP_CURL_ARGS="-skf --max-time 30 --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key --cacert /etc/lamalibre/lamaste/pki/ca.crt"
# `timed_exec` is defined in helpers.sh.
cleanup_host_delete() {
  timed_exec 35 multipass exec lamaste-host -- sudo bash -c \
    "curl ${CLEANUP_CURL_ARGS} -X DELETE https://127.0.0.1:9292/api/$1" \
    >/dev/null 2>&1
}
cleanup_exec() {
  # $1 = vm name, $2 = command
  timed_exec 15 multipass exec "$1" -- sudo bash -c "$2" >/dev/null 2>&1
}

cleanup() {
  log_info "Cleaning up test resources..."

  # Revoke grant if still present
  if [ -n "${GRANT_ID}" ]; then
    cleanup_host_delete "gatekeeper/grants/${GRANT_ID}"
  fi

  # Delete tunnel
  if [ -n "${TUNNEL_ID}" ]; then
    cleanup_host_delete "tunnels/${TUNNEL_ID}"
  fi

  # Remove outsider user so repeat runs are idempotent
  cleanup_host_delete "users/${OUTSIDER_USER}"

  # Stop the agent-side HTTP server and remove hosts entries we added
  # Bracket-escape so pkill doesn't self-match its own cmdline.
  cleanup_exec lamaste-agent   "pkill -f '[p]ython3 -m http.server ${TUNNEL_PORT}' 2>/dev/null || true"
  cleanup_exec lamaste-agent   "sed -i '/${TUNNEL_FQDN}/d' /etc/hosts 2>/dev/null || true"
  cleanup_exec lamaste-visitor "sed -i '/${TUNNEL_FQDN}/d' /etc/hosts 2>/dev/null || true"
}
trap cleanup EXIT

begin_test "22 — Restricted Tunnel + Per-User Grant (Three-VM)"

# ---------------------------------------------------------------------------
log_section "Pre-flight"
# ---------------------------------------------------------------------------
ONBOARDING=$(host_api_get "onboarding/status" 2>/dev/null || echo '{"status":"unknown"}')
STATUS=$(echo "$ONBOARDING" | jq -r '.status' 2>/dev/null || echo "unknown")
if [ "$STATUS" != "COMPLETED" ]; then
  log_skip "Onboarding not complete — skipping restricted tunnel tests"
  end_test
  exit $?
fi
log_pass "Onboarding is complete"

OATHTOOL_CHECK=$(visitor_exec "command -v oathtool >/dev/null 2>&1 && echo yes || echo no")
if [ "$OATHTOOL_CHECK" != "yes" ]; then
  log_skip "oathtool not available on visitor VM — skipping TOTP-dependent tests"
  end_test
  exit $?
fi

# ---------------------------------------------------------------------------
log_section "Step 1: Create tunnel using the default accessMode"
# ---------------------------------------------------------------------------
# Delete any leftover tunnel with our subdomain so the create below doesn't
# 409. `host_api_get` is curl -f, so we swallow its non-zero when the list
# endpoint isn't populated yet.
EXISTING_TUNNELS=$(host_api_get "tunnels" 2>/dev/null || echo '{"tunnels":[]}')
EXISTING_ID=$(echo "$EXISTING_TUNNELS" | jq -r --arg sd "${TUNNEL_SUBDOMAIN}" '.tunnels[]? | select(.subdomain==$sd) | .id' 2>/dev/null | head -1)
if [ -n "${EXISTING_ID}" ] && [ "${EXISTING_ID}" != "null" ]; then
  log_info "Removing stale tunnel ${EXISTING_ID} (subdomain ${TUNNEL_SUBDOMAIN}) from a prior run"
  # Use the timeout-wrapped helper — plain host_api_delete has no outer cap
  # and can hang on the known rodeo multipass-exec pipe-leak.
  cleanup_host_delete "tunnels/${EXISTING_ID}"
fi

# Intentionally omit accessMode — the route handler's Zod schema defaults to
# "restricted", which is what this test is verifying the behavior of.
CREATE_RESPONSE=$(host_api_post "tunnels" "{\"subdomain\":\"${TUNNEL_SUBDOMAIN}\",\"port\":${TUNNEL_PORT}}")
assert_json_field "$CREATE_RESPONSE" '.ok' 'true' "Tunnel creation returned ok: true" || true

TUNNEL_ID=$(echo "$CREATE_RESPONSE" | jq -r '.tunnel.id' 2>/dev/null || echo "")
assert_json_field_not_empty "$CREATE_RESPONSE" '.tunnel.id' "Tunnel has an ID" || true
assert_json_field "$CREATE_RESPONSE" '.tunnel.accessMode' 'restricted' \
  "Default accessMode is 'restricted' (security posture)" || true

log_info "Created restricted tunnel: ${TUNNEL_FQDN} (ID: ${TUNNEL_ID})"

# ---------------------------------------------------------------------------
log_section "Step 2: Wire up host entries and start a marker HTTP server"
# ---------------------------------------------------------------------------
agent_exec "grep -q '${TUNNEL_FQDN}' /etc/hosts || echo '${HOST_IP} ${TUNNEL_FQDN}' >> /etc/hosts"
visitor_exec "grep -q '${TUNNEL_FQDN}' /etc/hosts || echo '${HOST_IP} ${TUNNEL_FQDN}' >> /etc/hosts"

agent_exec "mkdir -p /tmp/e2e-restricted && echo '${MARKER}' > /tmp/e2e-restricted/index.html"
# Bracket-escape the first char so `pkill -f` doesn't self-match the bash
# cmdline running it (which contains the literal pattern string). Without
# the escape, pkill SIGTERMs its own shell → multipass exec returns 255 →
# set -e aborts before the EXIT trap can fire.
agent_exec "pkill -f '[p]ython3 -m http.server ${TUNNEL_PORT}' 2>/dev/null || true"
# `nohup … & exit` matches test 02's proven detach pattern: the explicit
# `exit` closes the bash -c session so multipass exec's stdout pipe drops
# cleanly, while the backgrounded python keeps running. Use `-d PATH`
# rather than `cd X && …` so there's no compound before the background
# operator — the && form pipe-leaks in practice even with `& exit`.
agent_exec "nohup python3 -m http.server ${TUNNEL_PORT} --bind 127.0.0.1 -d /tmp/e2e-restricted &>/dev/null & exit"
sleep 2
# `| head -1` can SIGPIPE the inner curl; `|| true` keeps pipefail from
# aborting step 2 before the EXIT trap can clean up.
agent_exec "curl -sf --max-time 5 http://127.0.0.1:${TUNNEL_PORT}/index.html" | head -1 || true
log_pass "Marker HTTP server running on agent at port ${TUNNEL_PORT}"

# Trigger the agent to pick up the new tunnel via chisel. Wrap in perl-alarm
# because `lamaste-agent update` can CPU-spin for >10m under rodeo's multipass
# exec context — the test-case doesn't actually fail if the update times out,
# so we proceed and let the routing assertions report the real outcome.
timed_exec 60 multipass exec lamaste-agent -- sudo bash -c \
  "lamaste-agent update 2>&1 || lamaste-agent update --label e2e-agent 2>&1 || true" \
  >/dev/null 2>&1
sleep 5

# ---------------------------------------------------------------------------
log_section "Step 3: Create a second Authelia user without a grant"
# ---------------------------------------------------------------------------
# Pre-clean so the test is idempotent across runs. curl -f swallows 404 on
# first run; cleanup_host_delete is already perl-timeout-wrapped.
cleanup_host_delete "users/${OUTSIDER_USER}"

CREATE_OUTSIDER=$(host_api_post "users" "{\"username\":\"${OUTSIDER_USER}\",\"password\":\"${OUTSIDER_PASSWORD}\",\"email\":\"${OUTSIDER_USER}@${TEST_DOMAIN}\",\"groups\":[\"users\"],\"displayname\":\"E2E Outsider\"}" 2>&1 || echo '{"ok":false}')
if echo "$CREATE_OUTSIDER" | jq -e '.ok == true' >/dev/null 2>&1; then
  log_pass "Created second Authelia user (${OUTSIDER_USER}) for no-grant case"
else
  log_info "Outsider user creation returned: $(echo "$CREATE_OUTSIDER" | head -c 160)"
fi

# Give Authelia a moment to refresh its users.yml view.
sleep 1

# ---------------------------------------------------------------------------
log_section "Step 4: Authenticate as testuser (will have the grant)"
# ---------------------------------------------------------------------------
TOTP_RESPONSE=$(host_api_post "users/${TEST_USER}/reset-totp" "{}")
assert_json_field_not_empty "$TOTP_RESPONSE" '.totpUri' "TOTP reset returned otpauth URI for testuser" || true
OTPAUTH_URI=$(echo "$TOTP_RESPONSE" | jq -r '.totpUri' 2>/dev/null || echo "")
TESTUSER_SECRET=$(echo "$OTPAUTH_URI" | sed -n 's/.*secret=\([A-Z2-7]*\).*/\1/p')
if [ -z "$TESTUSER_SECRET" ]; then
  log_fail "Failed to extract testuser TOTP secret"
  end_test
  exit $?
fi

wait_for_next_totp_window

visitor_exec "rm -f /tmp/restricted-testuser-cookies.txt"
AUTH_TESTUSER=$(visitor_exec "curl -sk --max-time 15 -c /tmp/restricted-testuser-cookies.txt -X POST -H 'Content-Type: application/json' -d '{\"username\":\"${TEST_USER}\",\"password\":\"${TEST_USER_PASSWORD}\",\"keepMeLoggedIn\":false,\"targetURL\":\"https://${TUNNEL_FQDN}/\"}' https://auth.${TEST_DOMAIN}/api/firstfactor 2>/dev/null" || echo '{}')
assert_json_field "$AUTH_TESTUSER" '.status' 'OK' "testuser first factor OK" || true

TESTUSER_CODE=$(visitor_exec "oathtool --totp --base32 ${TESTUSER_SECRET}" 2>/dev/null || echo "")
TOTP_TESTUSER=$(visitor_exec "curl -sk --max-time 15 -b /tmp/restricted-testuser-cookies.txt -c /tmp/restricted-testuser-cookies.txt -X POST -H 'Content-Type: application/json' -d '{\"token\":\"${TESTUSER_CODE}\",\"targetURL\":\"https://${TUNNEL_FQDN}/\"}' https://auth.${TEST_DOMAIN}/api/secondfactor/totp 2>/dev/null" || echo '{}')
assert_json_field "$TOTP_TESTUSER" '.status' 'OK' "testuser TOTP OK" || true

# ---------------------------------------------------------------------------
log_section "Step 5: testuser WITHOUT a grant is denied (403)"
# ---------------------------------------------------------------------------
NO_GRANT_STATUS=$(visitor_exec "curl -sk -o /dev/null -w '%{http_code}' --max-time 15 -b /tmp/restricted-testuser-cookies.txt https://${TUNNEL_FQDN}/" 2>/dev/null || echo "000")
assert_eq "$NO_GRANT_STATUS" "403" "Restricted tunnel denies authenticated user without grant (403)" || true

# ---------------------------------------------------------------------------
log_section "Step 6: Admin creates a grant for testuser"
# ---------------------------------------------------------------------------
GRANT_RESPONSE=$(host_api_post "gatekeeper/grants" "{\"principalType\":\"user\",\"principalId\":\"${TEST_USER}\",\"resourceType\":\"tunnel\",\"resourceId\":\"${TUNNEL_ID}\"}")
GRANT_ID=$(echo "$GRANT_RESPONSE" | jq -r '.grant.grantId' 2>/dev/null || echo "")
if [ -n "$GRANT_ID" ] && [ "$GRANT_ID" != "null" ]; then
  log_pass "Grant created (${GRANT_ID})"
else
  log_fail "Grant creation failed: $(echo "$GRANT_RESPONSE" | head -c 200)"
  end_test
  exit $?
fi

# Gatekeeper busts its own session cache on grant changes, but wait briefly
# for the fs.watch event to propagate before re-testing.
sleep 1

# ---------------------------------------------------------------------------
log_section "Step 7: testuser WITH a grant is allowed (200 + marker)"
# ---------------------------------------------------------------------------
WITH_GRANT_CONTENT=$(visitor_exec "curl -sk --max-time 15 -b /tmp/restricted-testuser-cookies.txt https://${TUNNEL_FQDN}/index.html 2>/dev/null" || echo "")
assert_contains "$WITH_GRANT_CONTENT" "$MARKER" "Grantee receives tunnel marker content" || true

WITH_GRANT_STATUS=$(visitor_exec "curl -sk -o /dev/null -w '%{http_code}' --max-time 15 -b /tmp/restricted-testuser-cookies.txt https://${TUNNEL_FQDN}/index.html" 2>/dev/null || echo "000")
assert_eq "$WITH_GRANT_STATUS" "200" "Grantee reaches tunnel (HTTP 200)" || true

# ---------------------------------------------------------------------------
log_section "Step 8: Outsider authenticates but has no grant → 403"
# ---------------------------------------------------------------------------
OUTSIDER_TOTP_RESPONSE=$(host_api_post "users/${OUTSIDER_USER}/reset-totp" "{}" 2>&1 || echo '{}')
OUTSIDER_URI=$(echo "$OUTSIDER_TOTP_RESPONSE" | jq -r '.totpUri' 2>/dev/null || echo "")
OUTSIDER_SECRET=$(echo "$OUTSIDER_URI" | sed -n 's/.*secret=\([A-Z2-7]*\).*/\1/p')
if [ -z "$OUTSIDER_SECRET" ]; then
  log_skip "Could not reset TOTP for outsider user (reset-totp response: $(echo "$OUTSIDER_TOTP_RESPONSE" | head -c 160)) — skipping outsider assertions"
else
  wait_for_next_totp_window

  visitor_exec "rm -f /tmp/restricted-outsider-cookies.txt"
  AUTH_OUT=$(visitor_exec "curl -sk --max-time 15 -c /tmp/restricted-outsider-cookies.txt -X POST -H 'Content-Type: application/json' -d '{\"username\":\"${OUTSIDER_USER}\",\"password\":\"${OUTSIDER_PASSWORD}\",\"keepMeLoggedIn\":false,\"targetURL\":\"https://${TUNNEL_FQDN}/\"}' https://auth.${TEST_DOMAIN}/api/firstfactor 2>/dev/null" || echo '{}')
  assert_json_field "$AUTH_OUT" '.status' 'OK' "outsider first factor OK" || true

  OUTSIDER_CODE=$(visitor_exec "oathtool --totp --base32 ${OUTSIDER_SECRET}" 2>/dev/null || echo "")
  TOTP_OUT=$(visitor_exec "curl -sk --max-time 15 -b /tmp/restricted-outsider-cookies.txt -c /tmp/restricted-outsider-cookies.txt -X POST -H 'Content-Type: application/json' -d '{\"token\":\"${OUTSIDER_CODE}\",\"targetURL\":\"https://${TUNNEL_FQDN}/\"}' https://auth.${TEST_DOMAIN}/api/secondfactor/totp 2>/dev/null" || echo '{}')
  assert_json_field "$TOTP_OUT" '.status' 'OK' "outsider TOTP OK" || true

  OUTSIDER_STATUS=$(visitor_exec "curl -sk -o /dev/null -w '%{http_code}' --max-time 15 -b /tmp/restricted-outsider-cookies.txt https://${TUNNEL_FQDN}/index.html" 2>/dev/null || echo "000")
  assert_eq "$OUTSIDER_STATUS" "403" "Outsider authenticated but ungranted receives 403" || true

  OUTSIDER_BODY=$(visitor_exec "curl -sk --max-time 15 -b /tmp/restricted-outsider-cookies.txt https://${TUNNEL_FQDN}/index.html 2>/dev/null" || echo "")
  if echo "$OUTSIDER_BODY" | grep -q "$MARKER"; then
    log_fail "Outsider unexpectedly received tunnel marker content — restricted mode breached"
  else
    log_pass "Outsider does not see tunnel content (restricted mode holds)"
  fi
fi

# ---------------------------------------------------------------------------
log_section "Step 9: Revoke testuser's grant → previously-allowed user 403"
# ---------------------------------------------------------------------------
# Use cleanup_host_delete (timeout-wrapped) — the plain host_api_delete
# occasionally pipe-leaks multipass exec for the full execa 10-min timeout.
cleanup_host_delete "gatekeeper/grants/${GRANT_ID}"
GRANT_ID=""  # prevent the cleanup trap from trying to re-delete

# Gatekeeper's in-memory session cache is busted on grant changes, but nginx
# has its own `proxy_cache` zone keyed on $cookie_authelia_session$http_host
# (NOT URI) — snippet sets `proxy_cache_valid 200 10s`. Just wait past that
# 10s TTL so the test observes the eventual-consistency behaviour the system
# promises. (The /gatekeeper/cache/bust endpoint only clears gatekeeper's
# own in-memory cache; nginx's layer still replays the cached allow.)
sleep 12

REVOKED_STATUS=$(visitor_exec "curl -sk -o /dev/null -w '%{http_code}' --max-time 15 -b /tmp/restricted-testuser-cookies.txt https://${TUNNEL_FQDN}/index.html" 2>/dev/null || echo "000")
assert_eq "$REVOKED_STATUS" "403" "Revoked grant blocks the previously-allowed user (403)" || true

REVOKED_BODY=$(visitor_exec "curl -sk --max-time 15 -b /tmp/restricted-testuser-cookies.txt https://${TUNNEL_FQDN}/index.html" 2>/dev/null || echo "")
if echo "$REVOKED_BODY" | grep -q "$MARKER"; then
  log_fail "Previously-allowed user still receives tunnel content after revoke"
else
  log_pass "Previously-allowed user no longer receives tunnel content"
fi

# ---------------------------------------------------------------------------
end_test

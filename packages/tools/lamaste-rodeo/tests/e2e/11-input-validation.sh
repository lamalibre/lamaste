#!/usr/bin/env bash
# ============================================================================
# 11 — Input Validation & Security Hardening
# ============================================================================
# Verifies that API endpoints properly validate and reject malicious input:
# - Invalid UUID route parameters
# - Invalid token format
# - Invalid domain format in certs endpoint
# - Subdomain injection attempts
# - Invalid port values
# - Invalid JSON bodies
# - Path traversal attempts (where applicable)
# ============================================================================

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/helpers.sh"

require_commands curl jq

begin_test "11 — Input Validation & Security Hardening"

# ---------------------------------------------------------------------------
log_section "Pre-flight: check onboarding is complete"
# ---------------------------------------------------------------------------

ONBOARDING_STATUS=$(api_get "onboarding/status" | jq -r '.status' 2>/dev/null || echo "unknown")
if [ "$ONBOARDING_STATUS" != "COMPLETED" ]; then
  log_skip "Skipping validation tests — onboarding not complete"
  end_test
  exit $?
fi

# ===========================================================================
# 1. Invalid UUID for tunnel operations
# ===========================================================================

# ---------------------------------------------------------------------------
log_section "Invalid UUID for tunnel operations"
# ---------------------------------------------------------------------------

PATCH_BAD_UUID_STATUS=$(api_patch_status "tunnels/not-a-uuid" '{"enabled": false}')
assert_eq "$PATCH_BAD_UUID_STATUS" "400" "PATCH /api/tunnels/not-a-uuid returns 400" || true

DELETE_BAD_UUID_STATUS=$(api_delete_status "tunnels/not-a-uuid")
assert_eq "$DELETE_BAD_UUID_STATUS" "400" "DELETE /api/tunnels/not-a-uuid returns 400" || true

# Path traversal: curl normalizes ../etc/passwd so this becomes /api/etc/passwd → 404
PATCH_TRAVERSAL_STATUS=$(api_patch_status "tunnels/../etc/passwd" '{"enabled": false}')
if [ "$PATCH_TRAVERSAL_STATUS" = "400" ] || [ "$PATCH_TRAVERSAL_STATUS" = "404" ]; then
  log_pass "PATCH /api/tunnels/../etc/passwd rejected (HTTP $PATCH_TRAVERSAL_STATUS)"
else
  log_fail "PATCH /api/tunnels/../etc/passwd should be rejected (got HTTP $PATCH_TRAVERSAL_STATUS)"
fi

# ===========================================================================
# 2. Invalid UUID for site operations
# ===========================================================================

# ---------------------------------------------------------------------------
log_section "Invalid UUID for site operations"
# ---------------------------------------------------------------------------

DELETE_SITE_BAD_UUID=$(api_delete_status "sites/not-a-uuid")
assert_eq "$DELETE_SITE_BAD_UUID" "400" "DELETE /api/sites/not-a-uuid returns 400" || true

# ===========================================================================
# 3. Invalid invite token format
# ===========================================================================

# ---------------------------------------------------------------------------
log_section "Invalid invite token format"
# ---------------------------------------------------------------------------

# Invite routes may or may not require mTLS. Try with mTLS first (via _curl_mtls).
INVITE_GET_STATUS=$(_curl_mtls -o /dev/null -w '%{http_code}' \
  "${BASE_URL}/api/invite/not-a-valid-token" 2>/dev/null || echo "000")
assert_eq "$INVITE_GET_STATUS" "400" "GET /api/invite/not-a-valid-token returns 400" || true

INVITE_POST_STATUS=$(_curl_mtls -o /dev/null -w '%{http_code}' \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"password":"Test1234!!","confirmPassword":"Test1234!!"}' \
  "${BASE_URL}/api/invite/not-a-valid-token/accept" 2>/dev/null || echo "000")
assert_eq "$INVITE_POST_STATUS" "400" "POST /api/invite/not-a-valid-token/accept returns 400" || true

# Path traversal: curl normalizes ../../etc/passwd so this becomes /etc/passwd → 200 (SPA fallback)
# or 400/404 depending on normalization. The key is it doesn't expose files.
INVITE_TRAVERSAL_STATUS=$(_curl_mtls -o /dev/null -w '%{http_code}' \
  "${BASE_URL}/api/invite/../../etc/passwd" 2>/dev/null || echo "000")
if [ "$INVITE_TRAVERSAL_STATUS" = "400" ] || [ "$INVITE_TRAVERSAL_STATUS" = "404" ] || [ "$INVITE_TRAVERSAL_STATUS" = "200" ]; then
  # Verify it doesn't return actual file content (ensure no real path traversal)
  INVITE_TRAVERSAL_BODY=$(_curl_mtls "${BASE_URL}/api/invite/../../etc/passwd" 2>/dev/null || echo "")
  assert_not_contains "$INVITE_TRAVERSAL_BODY" "root:" "Path traversal does not expose /etc/passwd" || true
else
  log_fail "GET /api/invite/../../etc/passwd returned unexpected status $INVITE_TRAVERSAL_STATUS"
fi

# ===========================================================================
# 4. Invalid domain format in certs endpoint
# ===========================================================================

# ---------------------------------------------------------------------------
log_section "Invalid domain format in certs endpoint"
# ---------------------------------------------------------------------------

CERT_DOUBLE_DOT_STATUS=$(api_post_status "certs/a..b/renew")
assert_eq "$CERT_DOUBLE_DOT_STATUS" "400" "POST /api/certs/a..b/renew returns 400" || true

CERT_DOTS_STATUS=$(api_post_status "certs/.../renew")
assert_eq "$CERT_DOTS_STATUS" "400" "POST /api/certs/.../renew returns 400" || true

CERT_INJECT_STATUS=$(api_post_status "certs/evil.com;inject/renew")
assert_eq "$CERT_INJECT_STATUS" "400" "POST /api/certs/evil.com;inject/renew returns 400" || true

# ===========================================================================
# 5. Subdomain injection attempts for tunnels
# ===========================================================================

# ---------------------------------------------------------------------------
log_section "Subdomain injection attempts"
# ---------------------------------------------------------------------------

INJECT_SEMICOLON_STATUS=$(api_post_status "tunnels" '{"subdomain":"test;inject","port":19001,"description":"injection test"}')
assert_eq "$INJECT_SEMICOLON_STATUS" "400" "Subdomain with semicolon rejected (HTTP 400)" || true

INJECT_NEWLINE_STATUS=$(api_post_status "tunnels" '{"subdomain":"test\nfoo","port":19002,"description":"newline test"}')
assert_eq "$INJECT_NEWLINE_STATUS" "400" "Subdomain with newline rejected (HTTP 400)" || true

INJECT_TRAVERSAL_STATUS=$(api_post_status "tunnels" '{"subdomain":"../etc","port":19003,"description":"traversal test"}')
assert_eq "$INJECT_TRAVERSAL_STATUS" "400" "Subdomain with path traversal rejected (HTTP 400)" || true

INJECT_UPPER_STATUS=$(api_post_status "tunnels" '{"subdomain":"TEST-UPPER","port":19004,"description":"uppercase test"}')
assert_eq "$INJECT_UPPER_STATUS" "400" "Subdomain with uppercase rejected (HTTP 400)" || true

LONG_SUBDOMAIN=$(printf 'a%.0s' {1..64})
INJECT_LONG_STATUS=$(api_post_status "tunnels" "{\"subdomain\":\"$LONG_SUBDOMAIN\",\"port\":19005,\"description\":\"long subdomain test\"}")
assert_eq "$INJECT_LONG_STATUS" "400" "Subdomain with 64 chars rejected (HTTP 400)" || true

# ===========================================================================
# 6. Port boundary validation
# ===========================================================================

# ---------------------------------------------------------------------------
log_section "Port boundary validation"
# ---------------------------------------------------------------------------

PORT_ZERO_STATUS=$(api_post_status "tunnels" '{"subdomain":"e2eport0","port":0,"description":"port zero"}')
assert_eq "$PORT_ZERO_STATUS" "400" "Port 0 rejected (HTTP 400)" || true

PORT_LOW_STATUS=$(api_post_status "tunnels" '{"subdomain":"e2eport1023","port":1023,"description":"port 1023"}')
assert_eq "$PORT_LOW_STATUS" "400" "Port 1023 rejected (HTTP 400)" || true

PORT_HIGH_STATUS=$(api_post_status "tunnels" '{"subdomain":"e2eport65536","port":65536,"description":"port 65536"}')
assert_eq "$PORT_HIGH_STATUS" "400" "Port 65536 rejected (HTTP 400)" || true

PORT_NEG_STATUS=$(api_post_status "tunnels" '{"subdomain":"e2eportneg","port":-1,"description":"port negative"}')
assert_eq "$PORT_NEG_STATUS" "400" "Port -1 rejected (HTTP 400)" || true

PORT_STR_STATUS=$(api_post_status "tunnels" '{"subdomain":"e2eportstr","port":"abc","description":"port string"}')
assert_eq "$PORT_STR_STATUS" "400" "Port 'abc' (string) rejected (HTTP 400)" || true

# ===========================================================================
# 7. Malformed JSON bodies
# ===========================================================================

# ---------------------------------------------------------------------------
log_section "Malformed JSON bodies"
# ---------------------------------------------------------------------------

# POST with invalid JSON (not parseable)
MALFORMED_STATUS=$(_curl_mtls -o /dev/null -w '%{http_code}' \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{this is not valid json' \
  "${BASE_URL}/api/tunnels" 2>/dev/null || echo "000")
assert_eq "$MALFORMED_STATUS" "400" "Invalid JSON body to /api/tunnels returns 400" || true

# POST with empty body to /api/users
EMPTY_BODY_STATUS=$(_curl_mtls -o /dev/null -w '%{http_code}' \
  -X POST \
  -H "Content-Type: application/json" \
  -d '' \
  "${BASE_URL}/api/users" 2>/dev/null || echo "000")
if [ "$EMPTY_BODY_STATUS" = "400" ] || [ "$EMPTY_BODY_STATUS" = "422" ]; then
  log_pass "Empty body to /api/users rejected (HTTP $EMPTY_BODY_STATUS)"
else
  log_fail "Empty body to /api/users should be rejected (got HTTP $EMPTY_BODY_STATUS)"
fi

# ===========================================================================
# 8. File permissions check
# ===========================================================================

# ---------------------------------------------------------------------------
log_section "File permissions"
# ---------------------------------------------------------------------------

# Check state files have restrictive permissions
for f in /etc/lamalibre/lamaste/tunnels.json /etc/lamalibre/lamaste/sites.json; do
  if [ -f "$f" ]; then
    PERMS=$(stat -c '%a' "$f" 2>/dev/null || stat -f '%Lp' "$f" 2>/dev/null || echo "unknown")
    if [ "$PERMS" = "600" ]; then
      log_pass "$f has correct permissions (600)"
    else
      log_fail "$f has permissions $PERMS (expected 600)"
    fi
  else
    log_skip "$f not found"
  fi
done

# Check panel.json permissions
if [ -f /etc/lamalibre/lamaste/panel.json ]; then
  PERMS=$(stat -c '%a' /etc/lamalibre/lamaste/panel.json 2>/dev/null || stat -f '%Lp' /etc/lamalibre/lamaste/panel.json 2>/dev/null || echo "unknown")
  if [ "$PERMS" = "600" ] || [ "$PERMS" = "640" ]; then
    log_pass "panel.json has correct permissions ($PERMS)"
  else
    log_fail "panel.json has permissions $PERMS (expected 600 or 640)"
  fi
fi

end_test

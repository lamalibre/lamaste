#!/usr/bin/env bash
# ============================================================================
# 01 — Fresh Install
# ============================================================================
# Verifies that create-portlama installs correctly on a clean Ubuntu system:
# - Node.js is present (correct version)
# - Panel server is running on port 9292
# - Health endpoint returns { status: "ok" }
# - Panel client static files are served at /
# ============================================================================

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/helpers.sh"

require_commands curl jq node systemctl

begin_test "01 — Fresh Install"

# ---------------------------------------------------------------------------
log_section "Node.js installation"
# ---------------------------------------------------------------------------

NODE_VERSION=$(node --version 2>/dev/null || echo "none")
if [[ "$NODE_VERSION" == v2* ]]; then
  log_pass "Node.js installed: $NODE_VERSION"
else
  log_fail "Node.js version 20+ expected, got: $NODE_VERSION"
fi

# ---------------------------------------------------------------------------
log_section "Panel server service"
# ---------------------------------------------------------------------------

PANEL_STATUS=$(systemctl is-active portlama-panel 2>/dev/null || echo "unknown")
assert_eq "$PANEL_STATUS" "active" "portlama-panel service is active" || true

# ---------------------------------------------------------------------------
log_section "Health endpoint"
# ---------------------------------------------------------------------------

HEALTH=$(api_get "health" 2>/dev/null || echo '{}')
assert_json_field "$HEALTH" '.status' 'ok' "Health endpoint returns status: ok" || true
assert_json_field_not_empty "$HEALTH" '.version' "Health endpoint returns a version" || true

# ---------------------------------------------------------------------------
log_section "Panel client static files"
# ---------------------------------------------------------------------------

HTTP_STATUS=$(_curl_mtls -o /dev/null -w '%{http_code}' \
  "${BASE_URL}/" 2>/dev/null || echo "000")

if [ "$HTTP_STATUS" = "200" ] || [ "$HTTP_STATUS" = "304" ]; then
  log_pass "Panel client served at / (HTTP $HTTP_STATUS)"
else
  log_fail "Panel client not served at / (HTTP $HTTP_STATUS)"
fi

# Check that the response contains HTML
PAGE_CONTENT=$(_curl_mtls "${BASE_URL}/" 2>/dev/null || echo "")
assert_contains "$PAGE_CONTENT" "<!doctype html>" "Response contains HTML content" || true
# Vite-built React apps typically include a script tag or the root div
assert_contains "$PAGE_CONTENT" '<div id="root">' "Response contains React root element" || true

# ---------------------------------------------------------------------------
log_section "nginx service"
# ---------------------------------------------------------------------------

NGINX_STATUS=$(systemctl is-active nginx 2>/dev/null || echo "unknown")
assert_eq "$NGINX_STATUS" "active" "nginx service is active" || true

# Verify nginx config is valid
NGINX_TEST=$(sudo nginx -t 2>&1 || true)
assert_contains "$NGINX_TEST" "syntax is ok" "nginx configuration syntax is valid" || true

end_test

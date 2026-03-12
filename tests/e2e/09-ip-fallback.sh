#!/usr/bin/env bash
# ============================================================================
# 09 — IP Fallback
# ============================================================================
# Verifies that the panel is always accessible via IP:9292 even after domain
# setup. This is the safety net — if DNS or the domain breaks, the admin can
# still manage the server via the IP address.
#
# - Verify health endpoint is accessible via IP
# - Verify the IP route is independent of nginx domain configuration
# - Verify API endpoints work via IP
# ============================================================================

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/helpers.sh"

require_commands curl jq

begin_test "09 — IP Fallback"

# ---------------------------------------------------------------------------
log_section "Determine server IP"
# ---------------------------------------------------------------------------

# Get IP from the onboarding status
STATUS_RESPONSE=$(api_get "onboarding/status")
SERVER_IP=$(echo "$STATUS_RESPONSE" | jq -r '.ip' 2>/dev/null || echo "")

if [ -z "$SERVER_IP" ] || [ "$SERVER_IP" = "null" ]; then
  log_info "Could not determine IP from onboarding status. Using BASE_URL."
  # Extract IP from BASE_URL
  SERVER_IP=$(echo "$BASE_URL" | sed -E 's|https?://([^:]+):.*|\1|')
fi

log_info "Server IP: $SERVER_IP"

IP_URL="https://${SERVER_IP}:9292"

# ---------------------------------------------------------------------------
log_section "Health endpoint via IP"
# ---------------------------------------------------------------------------

HEALTH_RESPONSE=$(curl -s --max-time "$CURL_TIMEOUT" --insecure \
  --cert "$CERT_PATH" \
  --key "$KEY_PATH" \
  --cacert "$CA_PATH" \
  "${IP_URL}/api/health" 2>/dev/null || echo '{}')

assert_json_field "$HEALTH_RESPONSE" '.status' 'ok' "Health endpoint accessible via IP:9292" || true

# ---------------------------------------------------------------------------
log_section "Static files via IP"
# ---------------------------------------------------------------------------

IP_STATIC_STATUS=$(curl -s -o /dev/null -w '%{http_code}' \
  --max-time "$CURL_TIMEOUT" \
  --insecure \
  --cert "$CERT_PATH" \
  --key "$KEY_PATH" \
  --cacert "$CA_PATH" \
  "${IP_URL}/" 2>/dev/null || echo "000")

if [ "$IP_STATIC_STATUS" = "200" ] || [ "$IP_STATIC_STATUS" = "304" ]; then
  log_pass "Panel client served via IP (HTTP $IP_STATIC_STATUS)"
else
  log_fail "Panel client not accessible via IP (HTTP $IP_STATIC_STATUS)"
fi

# ---------------------------------------------------------------------------
log_section "Onboarding status via IP"
# ---------------------------------------------------------------------------

IP_STATUS=$(curl -s --max-time "$CURL_TIMEOUT" --insecure \
  --cert "$CERT_PATH" \
  --key "$KEY_PATH" \
  --cacert "$CA_PATH" \
  "${IP_URL}/api/onboarding/status" 2>/dev/null || echo '{}')

IP_OB_STATUS=$(echo "$IP_STATUS" | jq -r '.status' 2>/dev/null || echo "unknown")
log_info "Onboarding status via IP: $IP_OB_STATUS"

if [ "$IP_OB_STATUS" != "unknown" ] && [ "$IP_OB_STATUS" != "" ]; then
  log_pass "Onboarding status endpoint works via IP"
else
  log_fail "Onboarding status endpoint failed via IP"
fi

# ---------------------------------------------------------------------------
log_section "Management API via IP (if onboarding complete)"
# ---------------------------------------------------------------------------

if [ "$IP_OB_STATUS" = "COMPLETED" ]; then
  # Test services endpoint via IP
  IP_SERVICES=$(curl -s --max-time "$CURL_TIMEOUT" --insecure \
    --cert "$CERT_PATH" \
    --key "$KEY_PATH" \
    --cacert "$CA_PATH" \
    "${IP_URL}/api/services" 2>/dev/null || echo '{}')

  IP_SVC_COUNT=$(echo "$IP_SERVICES" | jq '.services | length' 2>/dev/null || echo "0")
  if [ "$IP_SVC_COUNT" -gt 0 ]; then
    log_pass "Services endpoint works via IP ($IP_SVC_COUNT services)"
  else
    log_fail "Services endpoint returned no data via IP"
  fi

  # Test tunnels endpoint via IP
  IP_TUNNELS=$(curl -s --max-time "$CURL_TIMEOUT" --insecure \
    --cert "$CERT_PATH" \
    --key "$KEY_PATH" \
    --cacert "$CA_PATH" \
    "${IP_URL}/api/tunnels" 2>/dev/null || echo '{}')

  IP_TUNNELS_OK=$(echo "$IP_TUNNELS" | jq 'has("tunnels")' 2>/dev/null || echo "false")
  assert_eq "$IP_TUNNELS_OK" "true" "Tunnels endpoint works via IP" || true

  # Test users endpoint via IP
  IP_USERS=$(curl -s --max-time "$CURL_TIMEOUT" --insecure \
    --cert "$CERT_PATH" \
    --key "$KEY_PATH" \
    --cacert "$CA_PATH" \
    "${IP_URL}/api/users" 2>/dev/null || echo '{}')

  IP_USERS_OK=$(echo "$IP_USERS" | jq 'has("users")' 2>/dev/null || echo "false")
  assert_eq "$IP_USERS_OK" "true" "Users endpoint works via IP" || true

  # Test system stats via IP
  IP_STATS_STATUS=$(curl -s -o /dev/null -w '%{http_code}' \
    --max-time "$CURL_TIMEOUT" \
    --insecure \
    --cert "$CERT_PATH" \
    --key "$KEY_PATH" \
    --cacert "$CA_PATH" \
    "${IP_URL}/api/system/stats" 2>/dev/null || echo "000")
  assert_eq "$IP_STATS_STATUS" "200" "System stats endpoint works via IP" || true
else
  log_info "Skipping management API checks — onboarding not complete"
fi

# ---------------------------------------------------------------------------
log_section "IP access independence from domain nginx"
# ---------------------------------------------------------------------------

# The panel server binds to 127.0.0.1:9292 internally. The IP:9292 nginx vhost
# (set up during installation) should always work regardless of domain vhosts.
# We verify by checking that the health endpoint is reachable.

HEALTH_AGAIN=$(curl -s --max-time "$CURL_TIMEOUT" --insecure \
  --cert "$CERT_PATH" \
  --key "$KEY_PATH" \
  --cacert "$CA_PATH" \
  "${IP_URL}/api/health" 2>/dev/null || echo '{}')

assert_json_field "$HEALTH_AGAIN" '.status' 'ok' "IP fallback is reliable (second check)" || true

end_test

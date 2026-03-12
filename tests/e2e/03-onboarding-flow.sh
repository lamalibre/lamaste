#!/usr/bin/env bash
# ============================================================================
# 03 — Onboarding Flow
# ============================================================================
# Verifies the complete onboarding sequence:
# - Check initial status (FRESH)
# - Set domain via POST /api/onboarding/domain
# - Verify DNS via POST /api/onboarding/verify-dns (requires real DNS or skip)
# - Trigger provisioning via POST /api/onboarding/provision
# - Verify all services are running after provisioning
# - Verify onboarding endpoints return 410 after completion
# ============================================================================

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/helpers.sh"

require_commands curl jq

: "${TEST_DOMAIN:=test.example.com}"
: "${TEST_EMAIL:=admin@example.com}"

begin_test "03 — Onboarding Flow"

# ---------------------------------------------------------------------------
log_section "Initial onboarding status"
# ---------------------------------------------------------------------------

STATUS_RESPONSE=$(api_get "onboarding/status")
CURRENT_STATUS=$(echo "$STATUS_RESPONSE" | jq -r '.status' 2>/dev/null || echo "unknown")

log_info "Current onboarding status: $CURRENT_STATUS"

if [ "$CURRENT_STATUS" = "COMPLETED" ]; then
  log_info "Onboarding already completed — testing post-completion behavior"

  # Verify onboarding endpoints return 410 Gone
  DOMAIN_STATUS=$(api_post_status "onboarding/domain" "{\"domain\":\"$TEST_DOMAIN\",\"email\":\"$TEST_EMAIL\"}")
  assert_eq "$DOMAIN_STATUS" "410" "POST /onboarding/domain returns 410 after completion" || true

  DNS_STATUS=$(api_post_status "onboarding/verify-dns")
  assert_eq "$DNS_STATUS" "410" "POST /onboarding/verify-dns returns 410 after completion" || true

  PROVISION_STATUS=$(api_post_status "onboarding/provision")
  assert_eq "$PROVISION_STATUS" "410" "POST /onboarding/provision returns 410 after completion" || true

  # Status endpoint is always accessible (no guard)
  STATUS_CODE=$(api_get_status "onboarding/status")
  assert_eq "$STATUS_CODE" "200" "GET /onboarding/status still returns 200" || true

  end_test
  exit $?
fi

# ---------------------------------------------------------------------------
log_section "Set domain"
# ---------------------------------------------------------------------------

if [ "$CURRENT_STATUS" = "FRESH" ] || [ "$CURRENT_STATUS" = "DOMAIN_SET" ]; then
  DOMAIN_RESPONSE=$(api_post "onboarding/domain" "{\"domain\":\"$TEST_DOMAIN\",\"email\":\"$TEST_EMAIL\"}")
  assert_json_field "$DOMAIN_RESPONSE" '.ok' 'true' "Domain set successfully" || true
  assert_json_field "$DOMAIN_RESPONSE" '.domain' "$TEST_DOMAIN" "Domain matches input" || true

  # Verify status updated
  STATUS_AFTER=$(api_get "onboarding/status")
  assert_json_field "$STATUS_AFTER" '.status' 'DOMAIN_SET' "Status is DOMAIN_SET after setting domain" || true
else
  log_info "Skipping domain setup — status is $CURRENT_STATUS"
fi

# ---------------------------------------------------------------------------
log_section "Domain validation"
# ---------------------------------------------------------------------------

# Test invalid domain
INVALID_STATUS=$(api_post_status "onboarding/domain" '{"domain":"","email":"bad"}')
if [ "$INVALID_STATUS" = "400" ] || [ "$INVALID_STATUS" = "422" ]; then
  log_pass "Invalid domain/email rejected (HTTP $INVALID_STATUS)"
else
  log_fail "Invalid domain/email should be rejected (got HTTP $INVALID_STATUS)"
fi

# ---------------------------------------------------------------------------
log_section "DNS verification"
# ---------------------------------------------------------------------------

if ! skip_if_no_dns "DNS verification requires real DNS — set SKIP_DNS_TESTS=0 to run"; then
  DNS_RESPONSE=$(api_post "onboarding/verify-dns")
  DNS_OK=$(echo "$DNS_RESPONSE" | jq -r '.ok' 2>/dev/null || echo "false")

  if [ "$DNS_OK" = "true" ]; then
    log_pass "DNS verification passed"
    assert_json_field "$DNS_RESPONSE" '.domain' "$TEST_DOMAIN" "DNS response contains correct domain" || true
  else
    DNS_MSG=$(echo "$DNS_RESPONSE" | jq -r '.message' 2>/dev/null || echo "no message")
    log_info "DNS verification returned ok=false: $DNS_MSG"
    log_info "This is expected if DNS is not yet configured for $TEST_DOMAIN"
  fi
fi

# ---------------------------------------------------------------------------
log_section "Provisioning"
# ---------------------------------------------------------------------------

CURRENT_STATUS=$(api_get "onboarding/status" | jq -r '.status' 2>/dev/null || echo "unknown")

if [ "$CURRENT_STATUS" = "DNS_READY" ]; then
  PROVISION_RESPONSE=$(api_post "onboarding/provision")
  PROVISION_STATUS_CODE=$(echo "$PROVISION_RESPONSE" | jq -r '.ok // empty' 2>/dev/null || echo "")

  if [ "$PROVISION_STATUS_CODE" = "true" ]; then
    log_pass "Provisioning started (HTTP 202)"
  else
    log_info "Provisioning response: $PROVISION_RESPONSE"
  fi

  # Wait for provisioning to complete (poll status)
  log_info "Waiting for provisioning to complete..."
  PROVISION_TIMEOUT=300
  ELAPSED=0
  while [ "$ELAPSED" -lt "$PROVISION_TIMEOUT" ]; do
    PROV_STATUS=$(api_get "onboarding/status" | jq -r '.status' 2>/dev/null || echo "unknown")
    if [ "$PROV_STATUS" = "COMPLETED" ]; then
      log_pass "Provisioning completed"
      break
    elif [ "$PROV_STATUS" = "PROVISIONING" ]; then
      sleep 5
      ELAPSED=$((ELAPSED + 5))
    else
      log_fail "Unexpected status during provisioning: $PROV_STATUS"
      break
    fi
  done

  if [ "$ELAPSED" -ge "$PROVISION_TIMEOUT" ]; then
    log_fail "Provisioning timed out after ${PROVISION_TIMEOUT}s"
  fi
elif [ "$CURRENT_STATUS" = "DOMAIN_SET" ]; then
  if ! skip_if_no_dns "Cannot provision without DNS verification"; then
    log_info "DNS not verified — provisioning requires DNS_READY status"
  fi

  # Verify that provisioning is rejected when DNS is not ready
  PROV_REJECT_STATUS=$(api_post_status "onboarding/provision")
  assert_eq "$PROV_REJECT_STATUS" "409" "Provisioning rejected without DNS verification (HTTP 409)" || true
else
  log_info "Skipping provisioning — status is $CURRENT_STATUS"
fi

# ---------------------------------------------------------------------------
log_section "Post-provisioning service checks"
# ---------------------------------------------------------------------------

FINAL_STATUS=$(api_get "onboarding/status" | jq -r '.status' 2>/dev/null || echo "unknown")

if [ "$FINAL_STATUS" = "COMPLETED" ]; then
  # Check all services are running
  for svc in nginx chisel authelia portlama-panel; do
    SVC_STATUS=$(systemctl is-active "$svc" 2>/dev/null || echo "unknown")
    assert_eq "$SVC_STATUS" "active" "Service $svc is active after provisioning" || true
  done

  # Verify nginx is listening on 443
  if command -v ss &>/dev/null; then
    LISTEN_443=$(ss -tlnp | grep ':443 ' || true)
    if [ -n "$LISTEN_443" ]; then
      log_pass "nginx is listening on port 443"
    else
      log_fail "Nothing is listening on port 443"
    fi
  else
    log_skip "ss command not available — cannot check port 443"
  fi
else
  log_info "Post-provisioning checks skipped — onboarding status is $FINAL_STATUS"
fi

end_test

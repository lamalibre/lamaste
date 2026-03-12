#!/usr/bin/env bash
# ============================================================================
# 07 — Certificate Renewal
# ============================================================================
# Verifies certificate management:
# - List certificates via GET /api/certs
# - Force renew a certificate via POST /api/certs/:domain/renew
# - Check auto-renew timer via GET /api/certs/auto-renew-status
#
# NOTE: Certificate renewal requires real Let's Encrypt infrastructure.
# Tests that call certbot are skipped when SKIP_DNS_TESTS=1.
# ============================================================================

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/helpers.sh"

require_commands curl jq

begin_test "07 — Certificate Renewal"

# ---------------------------------------------------------------------------
log_section "Pre-flight: check onboarding is complete"
# ---------------------------------------------------------------------------

ONBOARDING_STATUS=$(api_get "onboarding/status" | jq -r '.status' 2>/dev/null || echo "unknown")
if [ "$ONBOARDING_STATUS" != "COMPLETED" ]; then
  log_skip "Skipping certificate tests — onboarding not complete"
  end_test
  exit $?
fi

# ---------------------------------------------------------------------------
log_section "List certificates"
# ---------------------------------------------------------------------------

CERTS_RESPONSE=$(api_get "certs")
CERT_COUNT=$(echo "$CERTS_RESPONSE" | jq '.certs | length' 2>/dev/null || echo "0")

if [ "$CERT_COUNT" -gt 0 ]; then
  log_pass "GET /api/certs returns $CERT_COUNT certificates"
else
  log_info "No certificates listed (this is expected if certbot has not issued any yet)"
fi

# Verify certificate fields
if [ "$CERT_COUNT" -gt 0 ]; then
  FIRST_CERT=$(echo "$CERTS_RESPONSE" | jq '.certs[0]' 2>/dev/null || echo "{}")
  assert_json_field_not_empty "$FIRST_CERT" '.type' "Certificate has a type field" || true
  assert_json_field_not_empty "$FIRST_CERT" '.domain' "Certificate has a domain field" || true
  assert_json_field_not_empty "$FIRST_CERT" '.expiresAt' "Certificate has an expiresAt field" || true

  # Check daysUntilExpiry is a number
  DAYS=$(echo "$FIRST_CERT" | jq '.daysUntilExpiry' 2>/dev/null || echo "null")
  if [ "$DAYS" != "null" ] && [ "$DAYS" != "" ]; then
    log_pass "Certificate has numeric daysUntilExpiry: $DAYS"
  else
    log_fail "Certificate daysUntilExpiry is missing or null"
  fi
fi

# ---------------------------------------------------------------------------
log_section "Force renew certificate"
# ---------------------------------------------------------------------------

if skip_if_no_dns "Certificate renewal requires real Let's Encrypt — skipping"; then
  DOMAIN=$(api_get "onboarding/status" | jq -r '.domain' 2>/dev/null || echo "")

  if [ -n "$DOMAIN" ] && [ "$DOMAIN" != "null" ]; then
    # Try to renew the panel cert (panel.<domain>)
    RENEW_DOMAIN="panel.${DOMAIN}"
    RENEW_RESPONSE=$(api_post "certs/$RENEW_DOMAIN/renew")
    RENEW_OK=$(echo "$RENEW_RESPONSE" | jq -r '.ok' 2>/dev/null || echo "false")

    if [ "$RENEW_OK" = "true" ]; then
      log_pass "Certificate renewal succeeded for $RENEW_DOMAIN"
      assert_json_field "$RENEW_RESPONSE" '.domain' "$RENEW_DOMAIN" "Renewal response contains correct domain" || true
      assert_json_field_not_empty "$RENEW_RESPONSE" '.newExpiry' "Renewal response contains new expiry" || true
    else
      RENEW_ERROR=$(echo "$RENEW_RESPONSE" | jq -r '.error' 2>/dev/null || echo "unknown")
      log_info "Certificate renewal returned: $RENEW_ERROR"
    fi
  else
    log_skip "No domain configured — cannot test renewal"
  fi
fi

# ---------------------------------------------------------------------------
log_section "Renew nonexistent certificate"
# ---------------------------------------------------------------------------

if skip_if_no_dns "Certbot test requires real infrastructure — skipping"; then
  RENEW_404_STATUS=$(api_post_status "certs/nonexistent.example.com/renew")
  if [ "$RENEW_404_STATUS" = "404" ] || [ "$RENEW_404_STATUS" = "500" ]; then
    log_pass "Renew nonexistent cert returns HTTP $RENEW_404_STATUS"
  else
    log_fail "Renew nonexistent cert unexpected status: HTTP $RENEW_404_STATUS"
  fi
fi

# ---------------------------------------------------------------------------
log_section "Auto-renew timer status"
# ---------------------------------------------------------------------------

AUTORENEW_RESPONSE=$(api_get "certs/auto-renew-status")
AUTORENEW_ACTIVE=$(echo "$AUTORENEW_RESPONSE" | jq -r '.active' 2>/dev/null || echo "null")

if [ "$AUTORENEW_ACTIVE" = "true" ]; then
  log_pass "Certbot auto-renew timer is active"
  assert_json_field_not_empty "$AUTORENEW_RESPONSE" '.nextRun' "Auto-renew has a next run time" || true
elif [ "$AUTORENEW_ACTIVE" = "false" ]; then
  log_info "Certbot auto-renew timer is not active (may need certbot.timer enabled)"
else
  log_fail "Could not determine auto-renew timer status"
fi

end_test

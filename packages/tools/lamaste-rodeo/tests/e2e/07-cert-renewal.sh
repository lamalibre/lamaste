#!/usr/bin/env bash
# ============================================================================
# 07 — Certificate Renewal
# ============================================================================
# Verifies certificate management:
# - List certificates via GET /api/certs
# - Force renew a certificate via POST /api/certs/:domain/renew
# - Check auto-renew timer via GET /api/certs/auto-renew-status
# - The panel reaches certbot and Let's Encrypt certificate reads only through
#   the root-owned wrappers /usr/local/sbin/lamaste-certbot and
#   /usr/local/sbin/lamaste-cert-info (sudoers has no certbot or
#   /etc/letsencrypt openssl rule); the wrappers refuse extra arguments, and a
#   panel renewal runs `certbot renew --cert-name <lineage> --force-renewal
#   --no-random-sleep-on-renew --non-interactive` (checked in the E2E certbot
#   shim's call log)
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
    CALLS_BEFORE_RENEW=$(sudo cat /etc/letsencrypt/e2e-certbot-calls.log 2>/dev/null | wc -l | tr -d ' ')
    RENEW_RESPONSE=$(api_post "certs/$RENEW_DOMAIN/renew")
    RENEW_OK=$(echo "$RENEW_RESPONSE" | jq -r '.ok' 2>/dev/null || echo "false")

    if [ "$RENEW_OK" = "true" ]; then
      log_pass "Certificate renewal succeeded for $RENEW_DOMAIN"
      assert_json_field "$RENEW_RESPONSE" '.domain' "$RENEW_DOMAIN" "Renewal response contains correct domain" || true
      assert_json_field_not_empty "$RENEW_RESPONSE" '.newExpiry' "Renewal response contains new expiry" || true
      # The wrapper's fixed argv: no random delay while an operator waits
      RENEW_CALL=$(sudo tail -n +$((CALLS_BEFORE_RENEW + 1)) /etc/letsencrypt/e2e-certbot-calls.log 2>/dev/null | grep ' renew ' | tail -1 || true)
      assert_contains "$RENEW_CALL" "renew --cert-name ${RENEW_DOMAIN} --force-renewal --no-random-sleep-on-renew --non-interactive" "certbot ran with the wrapper's renew argv (--no-random-sleep-on-renew)" || true
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
log_section "Sudoers: certbot and certificate reads via root-owned wrappers"
# ---------------------------------------------------------------------------

SUDOERS_RULES=$(sudo grep -v '^[[:space:]]*#' /etc/sudoers.d/lamaste 2>/dev/null || echo "")
assert_contains "$SUDOERS_RULES" "NOPASSWD: /usr/local/sbin/lamaste-certbot" "sudoers allows the lamaste-certbot wrapper" || true
assert_contains "$SUDOERS_RULES" "NOPASSWD: /usr/local/sbin/lamaste-cert-info" "sudoers allows the lamaste-cert-info wrapper" || true
assert_not_contains "$SUDOERS_RULES" "/usr/bin/certbot" "sudoers has no direct certbot rule" || true
assert_not_contains "$SUDOERS_RULES" "/etc/letsencrypt" "sudoers has no rule reaching into /etc/letsencrypt" || true

for wrapper in lamaste-certbot lamaste-cert-info; do
  WRAPPER_STAT=$(stat -c '%U %G %a' "/usr/local/sbin/${wrapper}" 2>/dev/null || echo "missing")
  assert_eq "$WRAPPER_STAT" "root root 755" "/usr/local/sbin/${wrapper} is root-owned 0755" || true
done

# The service user cannot run certbot directly, and the wrappers refuse any
# argument beyond their fixed shapes (a trailing --deploy-hook would run code
# as root; a traversing lineage would read any file)
DIRECT_CERTBOT=$(sudo -u lamaste sudo -n /usr/bin/certbot certificates >/dev/null 2>&1 && echo allowed || echo denied)
assert_eq "$DIRECT_CERTBOT" "denied" "lamaste cannot run /usr/bin/certbot through sudo" || true
WRAP_DOMAIN=$(api_get "onboarding/status" | jq -r '.domain' 2>/dev/null || echo "")
EXTRA_ARG_RC=0
sudo -u lamaste sudo -n /usr/local/sbin/lamaste-certbot renew "panel.${WRAP_DOMAIN}" --deploy-hook /bin/true >/dev/null 2>&1 || EXTRA_ARG_RC=$?
assert_eq "$EXTRA_ARG_RC" "2" "lamaste-certbot rejects extra arguments (exit 2)" || true
BAD_EMAIL_RC=0
sudo -u lamaste sudo -n /usr/local/sbin/lamaste-certbot issue "-x@example.com" "panel.${WRAP_DOMAIN}" "panel.${WRAP_DOMAIN}" >/dev/null 2>&1 || BAD_EMAIL_RC=$?
assert_eq "$BAD_EMAIL_RC" "2" "lamaste-certbot rejects a malformed email (exit 2)" || true
TRAVERSAL_RC=0
sudo -u lamaste sudo -n /usr/local/sbin/lamaste-cert-info ../../../etc/shadow enddate >/dev/null 2>&1 || TRAVERSAL_RC=$?
assert_eq "$TRAVERSAL_RC" "2" "lamaste-cert-info rejects a traversing lineage name (exit 2)" || true
PANEL_ENDDATE=$(sudo -u lamaste sudo -n /usr/local/sbin/lamaste-cert-info "panel.${WRAP_DOMAIN}" enddate 2>/dev/null || echo "")
assert_contains "$PANEL_ENDDATE" "notAfter=" "lamaste-cert-info reads panel.${WRAP_DOMAIN}'s expiry" || true

# Every issue the panel ever made carried --cert-name (a fixed lineage name,
# so a re-issue never drifts to <name>-0001)
ISSUES_TOTAL=$(sudo grep -c ' certonly ' /etc/letsencrypt/e2e-certbot-calls.log 2>/dev/null || true)
ISSUES_NAMED=$(sudo grep ' certonly ' /etc/letsencrypt/e2e-certbot-calls.log 2>/dev/null | grep -c -- ' --cert-name ' || true)
if [ "${ISSUES_TOTAL:-0}" -gt 0 ] 2>/dev/null; then
  assert_eq "${ISSUES_NAMED:-0}" "${ISSUES_TOTAL}" "Every certonly call carried --cert-name (${ISSUES_TOTAL} issued)" || true
else
  log_skip "No certonly calls recorded by the certbot shim yet"
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

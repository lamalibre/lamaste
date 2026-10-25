#!/usr/bin/env bash
# ============================================================================
# 46 — Multi-domain relay: a customer on one domain (Three-VM)
# ============================================================================
# The multi-domain relay's second acceptance case (design: packages/core/
# docs/multi-domain-relay-design.md, "Proof"). A is the relay's primary
# domain, B a second one (multi-domain-harness.sh); two customers are
# members of B only:
#
# 1. They reach B's authenticated tunnel. Signed in at auth.A with the same
#    account — valid credentials — a customer gets no further on A: A's
#    authenticated tunnel and A's Authelia-protected static site answer
#    with the domain refusal page (403, never a redirect: today's login
#    loop is gone).
# 2. Gatekeeper checks membership again, from its own projection of the
#    directory (domains.json), not only through Authelia's rules: a
#    projection without the customer refuses them on B at once, while
#    Authelia still admits them; a missing projection refuses everyone;
#    restored, they are let through again.
# 3. A customer removed from B is refused there at the next request, and
#    loses B in the directory and the projection.
# 4. A customer deleted loses every membership, audited by directory id
#    (directory.membership.removed, reason deleted) — never by username.
#
# The user surface of a plugin on A (JSON not_a_member) is spec 48; an OIDC
# sign-in for a client of A's domain is single-VM spec 35.
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../e2e/helpers.sh"
# shellcheck source-path=SCRIPTDIR source=app-plugin-harness.sh
source "${SCRIPT_DIR}/app-plugin-harness.sh"
# shellcheck source-path=SCRIPTDIR source=multi-domain-harness.sh
source "${SCRIPT_DIR}/multi-domain-harness.sh"

require_commands multipass curl jq perl openssl

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

CUST="e2e46-cust"
CUST2="e2e46-cust2"
# Test credentials for this run only, never printed
CUST_PASSWORD="E2e-$(openssl rand -hex 12)"
CUST2_PASSWORD="E2e-$(openssl rand -hex 12)"
CUST_ID=""
CUST2_ID=""
JAR_CUST_A="/tmp/e2e-46-cust-a.cookies"
JAR_CUST_B="/tmp/e2e-46-cust-b.cookies"
JAR_CUST2_B="/tmp/e2e-46-cust2-b.cookies"
SUB_A="e2e46a"
SUB_B="e2e46b"
PORT_A=18461
PORT_B=18462
TUNNEL_A=""
TUNNEL_B=""
SITE_NAME="e2e46site"
SITE_ID=""
SITE_FQDN=""
MARKER_A="E2E_46_A_$(date +%s)"
MARKER_B="E2E_46_B_$(date +%s)"
MARKER_SITE="E2E_46_SITE_$(date +%s)"
PROJECTION="/etc/lamalibre/lamaste/domains.json"
PROJECTION_SAVED="/var/tmp/e2e-46-domains.json"

# b_status <jar> — the status of B's tunnel for that session
b_status() { visit_status "$(visit "$1" "https://${SUB_B}.${DOMAIN_2}/index.html")"; }
b_answers() { [ "$(b_status "$1")" = "$2" ]; }

# write_projection <jq filter> — Gatekeeper's projection rewritten through
# <filter> as the panel writes it (lamaste, 0600, renamed into place)
write_projection() {
  host_exec "jq -c $(printf %q "$1") ${PROJECTION_SAVED} > ${PROJECTION}.e2e && chown lamaste:lamaste ${PROJECTION}.e2e && chmod 0600 ${PROJECTION}.e2e && mv ${PROJECTION}.e2e ${PROJECTION}" > /dev/null 2>&1 || true
}

begin_test "46 — Multi-domain relay: a customer on one domain (Three-VM)"

cleanup() {
  log_info "Cleaning up test resources..."
  local id
  # The projection as the panel wrote it, if a step left it changed.
  timed_exec 30 multipass exec "${HOST_VM}" -- sudo bash -c "if [ -f ${PROJECTION_SAVED} ]; then install -o lamaste -g lamaste -m 0600 ${PROJECTION_SAVED} ${PROJECTION}; rm -f ${PROJECTION_SAVED}; fi; true" > /dev/null 2>&1
  if [ -n "${SITE_ID}" ]; then host_api_delete "sites/${SITE_ID}" > /dev/null 2>&1 || true; fi
  for id in ${TUNNEL_A} ${TUNNEL_B}; do
    host_api_delete "tunnels/${id}" > /dev/null 2>&1 || true
  done
  md_backend_stop "${PORT_A}"
  md_backend_stop "${PORT_B}"
  for id in "${CUST}" "${CUST2}"; do
    host_api_delete "users/${id}?erase=true" > /dev/null 2>&1 || true
  done
  timed_exec 30 multipass exec "${VISITOR_VM}" -- sudo bash -c "rm -f ${JAR_CUST_A} ${JAR_CUST_B} ${JAR_CUST2_B}; true" > /dev/null 2>&1
  md_cleanup_domains
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
log_section "Pre-flight"
# ---------------------------------------------------------------------------

md_preflight

# ===========================================================================
# 1. B, two customers of B, the hosts
# ===========================================================================

log_section "Domain B; two customers, members of B only"

md_domain_active "${DOMAIN_2}"
md_user CUST_ID "${CUST}" "${CUST_PASSWORD}" "[\"${DOMAIN_2}\"]"
md_user CUST2_ID "${CUST2}" "${CUST2_PASSWORD}" "[\"${DOMAIN_2}\"]"
assert_eq "$(user_domains "${CUST}")" "${DOMAIN_2}" "${CUST} is a member of B alone" || true
assert_not_contains "$(access_rules_of "${DOMAIN}")" "\"user:${CUST}\"" "A's rendered rules never name ${CUST}" || true
assert_contains "$(access_rules_of "${DOMAIN_2}")" "\"user:${CUST}\"" "B's do" || true
assert_not_contains ",$(projection_members "${DOMAIN}")," ",${CUST}," "Gatekeeper's projection: not a member of A" || true
assert_contains ",$(projection_members "${DOMAIN_2}")," ",${CUST}," "…a member of B" || true

log_section "An authenticated tunnel on A and on B; an Authelia-protected site on A"

md_tunnel TUNNEL_A "${SUB_A}" "${DOMAIN}" "${PORT_A}" authenticated
md_tunnel TUNNEL_B "${SUB_B}" "${DOMAIN_2}" "${PORT_B}" authenticated
md_backend "${PORT_A}" "${MARKER_A}"
md_backend "${PORT_B}" "${MARKER_B}"
nudge_sync
for pair in "${PORT_A}:${MARKER_A}" "${PORT_B}:${MARKER_B}"; do
  if wait_for 120 tunnel_reachable "${pair%%:*}" "${pair#*:}"; then
    log_pass "Port ${pair%%:*}: the backend answers through chisel"
  else
    log_fail "Port ${pair%%:*}: the backend does not answer through chisel"
  fi
done

host_api_delete "sites/$(host_api_get "sites" 2>/dev/null | jq -r --arg n "${SITE_NAME}" '.sites[]? | select(.name == $n) | .id' 2>/dev/null | head -n 1)" > /dev/null 2>&1 || true
RESP=$(md_api POST "sites" "{\"name\":\"${SITE_NAME}\",\"type\":\"managed\",\"domain\":\"${DOMAIN}\",\"autheliaProtected\":true}")
SITE_ID=$(json_get "$(body_of "$RESP")" '.site.id // empty')
SITE_FQDN=$(json_get "$(body_of "$RESP")" '.site.fqdn // empty')
assert_eq "${SITE_FQDN}" "${SITE_NAME}.${DOMAIN}" "Site ${SITE_NAME}.${DOMAIN}, Authelia-protected" || true
host_exec "echo '<h1>${MARKER_SITE}</h1>' > /var/www/lamaste/${SITE_ID}/index.html" > /dev/null 2>&1 || true
md_hosts "${SITE_FQDN}"
md_wait_authelia "${DOMAIN}"

# ===========================================================================
# 2. B lets them in; A refuses them with a page, not a login loop
# ===========================================================================

log_section "Signed in at auth.B: B's tunnel"

SECRET=$(reset_totp "${CUST}")
SECRET2=$(reset_totp "${CUST2}")
wait_for_next_totp_window
md_sign_in "${CUST}" "${CUST_PASSWORD}" "${SECRET}" "${JAR_CUST_B}" "${SUB_B}.${DOMAIN_2}" "${DOMAIN_2}"
md_sign_in "${CUST2}" "${CUST2_PASSWORD}" "${SECRET2}" "${JAR_CUST2_B}" "${SUB_B}.${DOMAIN_2}" "${DOMAIN_2}"
RESP=$(visit "${JAR_CUST_B}" "https://${SUB_B}.${DOMAIN_2}/index.html")
assert_eq "$(visit_status "$RESP")" "200" "${CUST} on B's tunnel: 200" || true
assert_contains "$(visit_body "$RESP")" "${MARKER_B}" "…from its backend" || true
assert_eq "$(b_status "${JAR_CUST2_B}")" "200" "${CUST2} on B's tunnel: 200" || true

log_section "Signed in at auth.A with the same account: A refuses with a page"

assert_eq "$(outcome - "https://${SUB_A}.${DOMAIN}/index.html")" "302 auth.${DOMAIN}" "A's tunnel without a session: to A's sign-in page" || true
wait_for_next_totp_window
md_sign_in "${CUST}" "${CUST_PASSWORD}" "${SECRET}" "${JAR_CUST_A}" "${SUB_A}.${DOMAIN}" "${DOMAIN}"
RESP=$(visit "${JAR_CUST_A}" "https://${SUB_A}.${DOMAIN}/index.html")
assert_domain_refusal "$RESP" "${DOMAIN}" "${CUST} on A's authenticated tunnel"
assert_not_contains "$(visit_body "$RESP")" "${MARKER_A}" "…nothing of the tunnel" || true
assert_not_contains "$(visit_body "$RESP")" "${CUST}" "…and the page names no user" || true

RESP=$(visit "${JAR_CUST_A}" "https://${SITE_FQDN}/")
assert_eq "$(visit_status "$RESP")" "403" "${CUST} on A's Authelia-protected site: 403" || true
assert_contains "$(visit_body "$RESP")" "${DOMAIN}" "…the refusal page names A" || true
assert_contains "$(visit_body "$RESP")" "${SITE_FQDN}" "…and the site" || true
assert_not_contains "$(visit_body "$RESP")" "${MARKER_SITE}" "…nothing of the site" || true
assert_not_contains "$(visit_headers "$RESP" | tr '[:upper:]' '[:lower:]')" "location:" "…never a redirect to a sign-in page" || true

# ===========================================================================
# 3. Gatekeeper checks membership itself
# ===========================================================================

log_section "Gatekeeper's own check: its projection, not only Authelia"

host_exec "cp -p ${PROJECTION} ${PROJECTION_SAVED}" > /dev/null 2>&1 || true
write_projection "(.domains[] | select(.name == \"${DOMAIN_2}\") | .members) |= map(select(. != \"${CUST}\"))"
assert_not_contains ",$(projection_members "${DOMAIN_2}")," ",${CUST}," "The projection, rewritten without ${CUST} (Authelia's rules unchanged)" || true
if wait_for 15 b_answers "${JAR_CUST_B}" 403; then
  log_pass "${CUST} on B's tunnel: 403 — Gatekeeper refuses a user its projection holds no member of B"
else
  log_fail "${CUST} on B's tunnel with the member taken out of the projection: $(b_status "${JAR_CUST_B}")"
fi
assert_contains "$(visit_body "$(visit "${JAR_CUST_B}" "https://${SUB_B}.${DOMAIN_2}/index.html")")" "Not a member" "…with the domain refusal page" || true
assert_eq "$(b_status "${JAR_CUST2_B}")" "200" "${CUST2}, still in the projection: 200" || true

host_exec "mv ${PROJECTION} ${PROJECTION}.e2e-gone" > /dev/null 2>&1 || true
if wait_for 15 b_answers "${JAR_CUST2_B}" 403; then
  log_pass "No projection: ${CUST2} refused too (403) — Gatekeeper fails closed"
else
  log_fail "Without a projection ${CUST2} on B's tunnel: $(b_status "${JAR_CUST2_B}")"
fi
host_exec "rm -f ${PROJECTION}.e2e-gone && install -o lamaste -g lamaste -m 0600 ${PROJECTION_SAVED} ${PROJECTION} && rm -f ${PROJECTION_SAVED}" > /dev/null 2>&1 || true
if wait_for 15 b_answers "${JAR_CUST_B}" 200; then
  log_pass "The panel's projection back: ${CUST} let through again"
else
  log_fail "With the projection restored ${CUST} on B's tunnel: $(b_status "${JAR_CUST_B}")"
fi

# ===========================================================================
# 4. Removed from B
# ===========================================================================

log_section "A customer removed from B is refused there"

RESP=$(md_api DELETE "domains/${DOMAIN_2}/members/${CUST2}")
assert_eq "$(status_of "$RESP")" "200" "${CUST2} removed from B (by username)" || true
assert_eq "$(user_domains "${CUST2}")" "" "…the directory lists no domain for ${CUST2}" || true
assert_not_contains ",$(projection_members "${DOMAIN_2}")," ",${CUST2}," "…nor does Gatekeeper's projection of B" || true
md_wait_authelia "${DOMAIN_2}"
RESP=$(visit "${JAR_CUST2_B}" "https://${SUB_B}.${DOMAIN_2}/index.html")
assert_not_eq "$(visit_status "$RESP")" "200" "${CUST2}'s next request on B is not served ($(visit_status "$RESP"))" || true
assert_not_contains "$(visit_body "$RESP")" "${MARKER_B}" "…nothing of the tunnel" || true
REMOVED=$(host_api_get "audit?action=directory.membership.removed&limit=200" 2>/dev/null | jq -c --arg id "${CUST2_ID}" --argjson base "${AUDIT_BASE}" '[.entries[]? | select(.id > $base and .details.userId == $id)]' 2>/dev/null || echo "[]")
assert_eq "$(json_get "$REMOVED" 'map(.details.domain) | join(",")')" "${DOMAIN_2}" "Audited: directory.membership.removed for B, by ${CUST2}'s directory id" || true

# ===========================================================================
# 5. Deleted
# ===========================================================================

log_section "A customer deleted loses every membership, audited by id"

RESP=$(md_api DELETE "users/${CUST}")
assert_eq "$(status_of "$RESP")" "200" "${CUST} deleted" || true
REMOVED=$(host_api_get "audit?action=directory.membership.removed&limit=200" 2>/dev/null | jq -c --arg id "${CUST_ID}" --argjson base "${AUDIT_BASE}" '[.entries[]? | select(.id > $base and .details.userId == $id)]' 2>/dev/null || echo "[]")
assert_eq "$(json_get "$REMOVED" 'map("\(.details.domain) \(.details.reason)") | join(",")')" "${DOMAIN_2} deleted" "Audited: directory.membership.removed for B, reason deleted, by directory id" || true
assert_not_contains "$REMOVED" "${CUST}\"" "…no audit entry names the username" || true
assert_not_contains ",$(projection_members "${DOMAIN_2}")," ",${CUST}," "Gatekeeper's projection holds ${CUST} nowhere" || true
assert_not_contains "$(access_rules_of "${DOMAIN_2}")" "\"user:${CUST}\"" "…nor do B's rendered rules" || true

end_test

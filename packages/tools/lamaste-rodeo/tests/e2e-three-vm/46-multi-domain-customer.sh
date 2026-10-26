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
#    projection without the customer refuses them on B while Authelia still
#    admits them; no projection refuses everyone; restored, they are let
#    through again.
# 3. A customer removed from B is refused there with the refusal page at
#    their next request — the same session: the removal is a users.yml
#    change, Authelia is not restarted — and is gone from B's member list
#    (audited by directory id).
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
MD_SPEC=46
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
JAR_CUST_A=$(md_jar cust-a)
JAR_CUST_B=$(md_jar cust-b)
JAR_CUST2_B=$(md_jar cust2-b)
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

# b_status <jar> — the status of B's tunnel for that session
b_status() { visit_status "$(visit "$1" "https://${SUB_B}.${DOMAIN_2}/index.html")"; }
b_answers() { [ "$(b_status "$1")" = "$2" ]; }

# wait_b <jar> <status> <message> — until B's tunnel answers <status> for the session
wait_b() {
  if wait_for "${AUTHZ_SETTLE_SECONDS}" b_answers "$1" "$2"; then
    log_pass "$3"
  else
    log_fail "$3 (got $(b_status "$1"))"
  fi
}

begin_test "46 — Multi-domain relay: a customer on one domain (Three-VM)"

cleanup() {
  log_info "Cleaning up test resources..."
  local id
  if [ -n "${SITE_ID}" ]; then host_api_delete "sites/${SITE_ID}" > /dev/null 2>&1 || true; fi
  for id in ${TUNNEL_A} ${TUNNEL_B}; do
    host_api_delete "tunnels/${id}" > /dev/null 2>&1 || true
  done
  md_backend_stop "${PORT_A}" "${PORT_B}"
  for id in "${CUST}" "${CUST2}"; do
    host_api_delete "users/${id}?erase=true" > /dev/null 2>&1 || true
  done
  md_cleanup
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
assert_eq "$(is_uuid "${CUST_ID}") $(is_uuid "${CUST2_ID}")" "true true" "Both have a directory id" || true
assert_eq "$(user_domains "${CUST}")" "${DOMAIN_2}" "${CUST} is a member of B alone" || true
assert_not_contains ",$(domain_members "${DOMAIN}")," ",${CUST}," "A's member list does not hold ${CUST}" || true
assert_contains ",$(domain_members "${DOMAIN_2}")," ",${CUST}," "B's does" || true
KEY_A=$(domain_group_key "${DOMAIN}")
KEY_B=$(domain_group_key "${DOMAIN_2}")
assert_not_contains "$(access_rules_of "${DOMAIN}")" "\"user:" "A's rendered rules name no user" || true
wait_group holds "${CUST}" "lamaste:m:${KEY_B}" "users.yml gives ${CUST} B's member group"
assert_not_contains ",$(user_groups "${CUST}")," ",lamaste:m:${KEY_A}," "…never A's" || true

log_section "An authenticated tunnel on A and on B; an Authelia-protected site on A"

md_tunnel TUNNEL_A "${SUB_A}" "${DOMAIN}" "${PORT_A}" authenticated
md_tunnel TUNNEL_B "${SUB_B}" "${DOMAIN_2}" "${PORT_B}" authenticated
md_backends "${PORT_A}:${MARKER_A}" "${PORT_B}:${MARKER_B}"

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
md_sign_in "${CUST}" "${CUST_PASSWORD}" "${SECRET}" "${JAR_CUST_B}" "${SUB_B}.${DOMAIN_2}"
md_sign_in "${CUST2}" "${CUST2_PASSWORD}" "${SECRET2}" "${JAR_CUST2_B}" "${SUB_B}.${DOMAIN_2}"
assert_served "${JAR_CUST_B}" "https://${SUB_B}.${DOMAIN_2}/index.html" "${MARKER_B}" "${CUST} on B's tunnel"
assert_eq "$(b_status "${JAR_CUST2_B}")" "200" "${CUST2} on B's tunnel: 200" || true

log_section "Signed in at auth.A with the same account: A refuses with a page"

assert_eq "$(outcome - "https://${SUB_A}.${DOMAIN}/index.html")" "302 auth.${DOMAIN}" "A's tunnel without a session: to A's sign-in page" || true
md_sign_in "${CUST}" "${CUST_PASSWORD}" "${SECRET}" "${JAR_CUST_A}" "${SUB_A}.${DOMAIN}"
RESP=$(visit "${JAR_CUST_A}" "https://${SUB_A}.${DOMAIN}/index.html")
assert_domain_refusal "$RESP" "${DOMAIN}" "${CUST} on A's authenticated tunnel"
assert_not_contains "$(visit_body "$RESP")" "${MARKER_A}" "…nothing of the tunnel" || true
assert_not_contains "$(visit_body "$RESP")" "${CUST}" "…and the page names no user" || true

RESP=$(visit "${JAR_CUST_A}" "https://${SITE_FQDN}/")
assert_eq "$(visit_status "$RESP")" "403" "${CUST} on A's Authelia-protected site: 403" || true
assert_contains "$(visit_body "$RESP")" "${SITE_FQDN}" "…the refusal page names the site" || true
assert_contains "$(visit_body "$RESP")" "${DOMAIN}" "…and A" || true
assert_not_contains "$(visit_body "$RESP")" "${MARKER_SITE}" "…nothing of the site" || true
assert_not_contains "$(visit_headers "$RESP" | tr '[:upper:]' '[:lower:]')" "location:" "…never a redirect to a sign-in page" || true

# ===========================================================================
# 3. Gatekeeper checks membership itself
# ===========================================================================

log_section "Gatekeeper's own check: its projection, not only Authelia"

projection_hold "(.domains[] | select(.name == \"${DOMAIN_2}\") | .members) |= map(select(. != \"${CUST}\"))"
assert_not_contains ",$(projection_members "${DOMAIN_2}")," ",${CUST}," "The projection held without ${CUST} (Authelia's rules unchanged)" || true
assert_contains ",$(user_groups "${CUST}")," ",lamaste:m:${KEY_B}," "…Authelia still admits ${CUST} on B (B's member group in users.yml)" || true
wait_b "${JAR_CUST_B}" 403 "${CUST} on B's tunnel: 403 — Gatekeeper refuses a user its projection holds no member of B"
assert_contains "$(visit_body "$(visit "${JAR_CUST_B}" "https://${SUB_B}.${DOMAIN_2}/index.html")")" "Not a member" "…with the domain refusal page" || true
assert_eq "$(b_status "${JAR_CUST2_B}")" "200" "${CUST2}, still in the projection: 200" || true

projection_withdraw
wait_b "${JAR_CUST2_B}" 403 "No projection: ${CUST2} refused too (403) — Gatekeeper fails closed"
projection_restore
wait_b "${JAR_CUST_B}" 200 "The panel's projection back: ${CUST} let through again"

# ===========================================================================
# 4. Removed from B
# ===========================================================================

log_section "A customer removed from B is refused there"

AUTHELIA_PID=$(authelia_pid)

RESP=$(md_api DELETE "domains/${DOMAIN_2}/members/${CUST2}")
assert_eq "$(status_of "$RESP")" "200" "${CUST2} removed from B (by username)" || true
assert_eq "$(user_domains "${CUST2}")" "" "…the directory lists no domain for ${CUST2}" || true
assert_not_contains ",$(domain_members "${DOMAIN_2}")," ",${CUST2}," "…nor does B's member list" || true
assert_json_field "$(membership_removed "${CUST2_ID}")" 'map(.details.domain) | join(",")' "${DOMAIN_2}" "Audited: directory.membership.removed for B, by ${CUST2}'s directory id" || true
wait_group lacks "${CUST2}" "lamaste:m:${KEY_B}" "users.yml takes B's member group from ${CUST2}"
assert_eq "$(authelia_pid)" "${AUTHELIA_PID}" "…Authelia was not restarted (MainPID ${AUTHELIA_PID})" || true

# The same session: Authelia reads the user's groups again at their next
# request; nginx keeps an authorization's 200 for 10 s.
wait_b "${JAR_CUST2_B}" 403 "${CUST2}'s session of before, on B's tunnel: refused (403) — no new sign-in"
RESP=$(visit "${JAR_CUST2_B}" "https://${SUB_B}.${DOMAIN_2}/index.html")
assert_domain_refusal "$RESP" "${DOMAIN_2}" "${CUST2}, removed from B, on B's tunnel"
assert_not_contains "$(visit_body "$RESP")" "${MARKER_B}" "…nothing of the tunnel" || true

# ===========================================================================
# 5. Deleted
# ===========================================================================

log_section "A customer deleted loses every membership, audited by id"

RESP=$(md_api DELETE "users/${CUST}")
assert_eq "$(status_of "$RESP")" "200" "${CUST} deleted" || true
REMOVED=$(membership_removed "${CUST_ID}")
assert_eq "$(json_get "$REMOVED" 'map("\(.details.domain) \(.details.reason)") | join(",")')" "${DOMAIN_2} deleted" "Audited: directory.membership.removed for B, reason deleted, by directory id" || true
assert_not_contains "$REMOVED" "\"${CUST}\"" "…no audit entry names the username" || true
assert_not_contains ",$(domain_members "${DOMAIN_2}")," ",${CUST}," "B's member list holds ${CUST} no more" || true
assert_eq "$(user_groups "${CUST}")" "" "…nor does users.yml give anyone of that name a group" || true

end_test

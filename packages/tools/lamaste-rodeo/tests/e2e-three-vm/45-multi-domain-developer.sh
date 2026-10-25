#!/usr/bin/env bash
# ============================================================================
# 45 — Multi-domain relay: a developer on two domains (Three-VM)
# ============================================================================
# The multi-domain relay's first acceptance case (design: packages/core/docs/
# multi-domain-relay-design.md, "Proof"): one relay, one directory, a member
# list per base domain. A is the relay's primary domain, B a second one
# (multi-domain-harness.sh). A developer is a member of both:
#
# 1. B is added, its DNS checked (auth.B is the one required record) and
#    activated: Authelia carries a session cookie per domain (A and B).
# 2. The developer, created a member of A and B, is in both domains' rendered
#    rules and in Gatekeeper's projection of both.
# 3. Signed in at auth.A, the developer reaches an authenticated tunnel on
#    A. A's session opens nothing on B: B's tunnel sends them to auth.B —
#    B's own sign-in page, not A's. Signed in there with the same password
#    and TOTP secret, B's tunnel is reached.
# 4. On B, `restricted` still narrows one application: without a grant the
#    access-request page, with one the tunnel.
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

DEV="e2e45-dev"
# Test credentials for this run only, never printed
DEV_PASSWORD="E2e-$(openssl rand -hex 12)"
DEV_ID=""
JAR_A="/tmp/e2e-45-dev-a.cookies"
JAR_B="/tmp/e2e-45-dev-b.cookies"
SUB_A="e2e45a"
SUB_B="e2e45b"
SUB_R="e2e45r"
PORT_A=18451
PORT_B=18452
PORT_R=18453
TUNNEL_A=""
TUNNEL_B=""
TUNNEL_R=""
GRANT_ID=""
MARKER_A="E2E_45_A_$(date +%s)"
MARKER_B="E2E_45_B_$(date +%s)"
MARKER_R="E2E_45_R_$(date +%s)"

begin_test "45 — Multi-domain relay: a developer on two domains (Three-VM)"

cleanup() {
  log_info "Cleaning up test resources..."
  local id port
  if [ -n "${GRANT_ID}" ]; then host_api_delete "gatekeeper/grants/${GRANT_ID}" > /dev/null 2>&1 || true; fi
  for id in ${TUNNEL_A} ${TUNNEL_B} ${TUNNEL_R}; do
    host_api_delete "tunnels/${id}" > /dev/null 2>&1 || true
  done
  for port in ${PORT_A} ${PORT_B} ${PORT_R}; do md_backend_stop "${port}"; done
  host_api_delete "users/${DEV}?erase=true" > /dev/null 2>&1 || true
  timed_exec 30 multipass exec "${VISITOR_VM}" -- sudo bash -c "rm -f ${JAR_A} ${JAR_B}; true" > /dev/null 2>&1
  md_cleanup_domains
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
log_section "Pre-flight"
# ---------------------------------------------------------------------------

md_preflight

# ===========================================================================
# 1. A second domain
# ===========================================================================

log_section "Domain B added, its DNS checked, activated"

md_domain_active "${DOMAIN_2}"
COOKIES=$(session_cookie_domains)
assert_contains ",${COOKIES}," ",${DOMAIN}," "Authelia holds a session cookie for A (${DOMAIN})" || true
assert_contains ",${COOKIES}," ",${DOMAIN_2}," "…and one for B (${DOMAIN_2})" || true
assert_json_field "$(domain_entry "${DOMAIN}")" '"\(.primary) \(.status)"' 'true active' "A is the primary domain" || true
assert_json_field "$(domain_entry "${DOMAIN_2}")" '.primary' 'false' "B is not" || true

# ===========================================================================
# 2. The developer, member of both
# ===========================================================================

log_section "A developer, member of A and B"

md_user DEV_ID "${DEV}" "${DEV_PASSWORD}" "[\"${DOMAIN}\",\"${DOMAIN_2}\"]"
assert_eq "$(is_uuid "${DEV_ID}")" "true" "…one directory id for both domains" || true
EXPECTED_DOMAINS=$(printf '%s\n%s\n' "${DOMAIN}" "${DOMAIN_2}" | sort | paste -sd, -)
assert_eq "$(user_domains "${DEV}")" "${EXPECTED_DOMAINS}" "GET /api/users lists ${DEV}'s domains: A and B" || true
assert_contains "$(access_rules_of "${DOMAIN}")" "\"user:${DEV}\"" "A's rendered access rules admit ${DEV}" || true
assert_contains "$(access_rules_of "${DOMAIN_2}")" "\"user:${DEV}\"" "…and B's" || true
assert_eq "$(access_rules_of "${DOMAIN_2}" | jq -c '.[-1]')" "{\"domain\":[\"${DOMAIN_2}\",\"*.${DOMAIN_2}\"],\"policy\":\"deny\"}" "B's last rule refuses everyone else on B and every host under it" || true
assert_contains ",$(projection_members "${DOMAIN}")," ",${DEV}," "Gatekeeper's projection: ${DEV} is a member of A" || true
assert_contains ",$(projection_members "${DOMAIN_2}")," ",${DEV}," "…and of B" || true

# ===========================================================================
# 3. Tunnels on both domains
# ===========================================================================

log_section "An authenticated tunnel on A and on B, a restricted one on B"

md_tunnel TUNNEL_A "${SUB_A}" "${DOMAIN}" "${PORT_A}" authenticated
md_tunnel TUNNEL_B "${SUB_B}" "${DOMAIN_2}" "${PORT_B}" authenticated
md_tunnel TUNNEL_R "${SUB_R}" "${DOMAIN_2}" "${PORT_R}" restricted
md_backend "${PORT_A}" "${MARKER_A}"
md_backend "${PORT_B}" "${MARKER_B}"
md_backend "${PORT_R}" "${MARKER_R}"
nudge_sync
for pair in "${PORT_A}:${MARKER_A}" "${PORT_B}:${MARKER_B}" "${PORT_R}:${MARKER_R}"; do
  if wait_for 120 tunnel_reachable "${pair%%:*}" "${pair#*:}"; then
    log_pass "Port ${pair%%:*}: the backend answers through chisel"
  else
    log_fail "Port ${pair%%:*}: the backend does not answer through chisel"
  fi
done
assert_contains "$(host_exec "ls /etc/nginx/sites-enabled" 2>/dev/null)" "lamalibre-lamaste-app-${SUB_B}.${DOMAIN_2}" "B's tunnel vhost is named by its full hostname" || true

# ===========================================================================
# 4. One account, a sign-in per domain
# ===========================================================================

log_section "Signed in at auth.A: A's tunnel; B sends them to auth.B"

md_wait_authelia "${DOMAIN}"
SECRET=$(reset_totp "${DEV}")
assert_not_eq "${SECRET}" "" "${DEV}'s TOTP secret reset (one secret for every domain)" || true
wait_for_next_totp_window
md_sign_in "${DEV}" "${DEV_PASSWORD}" "${SECRET}" "${JAR_A}" "${SUB_A}.${DOMAIN}" "${DOMAIN}"

RESP=$(visit "${JAR_A}" "https://${SUB_A}.${DOMAIN}/index.html")
assert_eq "$(visit_status "$RESP")" "200" "A's authenticated tunnel: 200" || true
assert_contains "$(visit_body "$RESP")" "${MARKER_A}" "…from its backend" || true

assert_eq "$(outcome - "https://${SUB_B}.${DOMAIN_2}/index.html")" "302 auth.${DOMAIN_2}" "B's tunnel without a session: to B's own sign-in page (auth.${DOMAIN_2})" || true
assert_eq "$(outcome "${JAR_A}" "https://${SUB_B}.${DOMAIN_2}/index.html")" "302 auth.${DOMAIN_2}" "…with A's session too: a browser never sends A's cookie to B" || true

log_section "Signed in at auth.B with the same password and TOTP secret: B's tunnel"

wait_for_next_totp_window
md_sign_in "${DEV}" "${DEV_PASSWORD}" "${SECRET}" "${JAR_B}" "${SUB_B}.${DOMAIN_2}" "${DOMAIN_2}"
RESP=$(visit "${JAR_B}" "https://${SUB_B}.${DOMAIN_2}/index.html")
assert_eq "$(visit_status "$RESP")" "200" "B's authenticated tunnel: 200" || true
assert_contains "$(visit_body "$RESP")" "${MARKER_B}" "…from its backend" || true
assert_eq "$(visit_status "$(visit "${JAR_A}" "https://${SUB_A}.${DOMAIN}/index.html")")" "200" "A's session still opens A" || true

# ===========================================================================
# 5. restricted narrows one application on B
# ===========================================================================

log_section "B's restricted tunnel: the access-request page, then a grant"

RESP=$(visit "${JAR_B}" "https://${SUB_R}.${DOMAIN_2}/index.html")
assert_eq "$(visit_status "$RESP")" "403" "Without a grant: 403" || true
assert_contains "$(visit_body "$RESP")" "Access Required" "…the access-request page (a member of B, not granted this tunnel)" || true
assert_not_contains "$(visit_body "$RESP")" "${MARKER_R}" "…nothing of the tunnel" || true

GRANT=$(host_api_post "gatekeeper/grants" "{\"principalType\":\"user\",\"principalId\":\"${DEV}\",\"resourceType\":\"tunnel\",\"resourceId\":\"${TUNNEL_R}\"}" 2>/dev/null || echo '{}')
GRANT_ID=$(json_get "$GRANT" '.grant.grantId // empty')
assert_not_eq "${GRANT_ID}" "" "A grant for ${DEV} on ${SUB_R}.${DOMAIN_2}" || true
sleep 1
RESP=$(visit "${JAR_B}" "https://${SUB_R}.${DOMAIN_2}/index.html")
assert_eq "$(visit_status "$RESP")" "200" "With the grant: 200" || true
assert_contains "$(visit_body "$RESP")" "${MARKER_R}" "…from its backend" || true

end_test

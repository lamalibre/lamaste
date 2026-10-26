#!/usr/bin/env bash
# ============================================================================
# 49 — External members: reach only what names them (Three-VM)
# ============================================================================
# The first acceptance case of external members (design: packages/core/docs/
# external-members-design.md, "Proof"). B is a second base domain
# (multi-domain-harness.sh); on it a member and an external member, an
# authenticated tunnel, a restricted tunnel and an Authelia-protected static
# site that lists the member.
#
# 1. The external member holds B's external group in Authelia's users.yml
#    (`lamaste:x:<key>`), never its member group, and no Authelia group.
# 2. The authenticated tunnel refuses them with Gatekeeper's access-request
#    page (they are on the domain, only not granted). Authelia refuses them
#    on its own: with Gatekeeper's projection held so that it calls them a
#    member, the request is still refused.
# 3. The restricted tunnel: refused without a grant; through with a direct
#    grant (users.yml gives them the tunnel's hostname as a group); refused
#    once it is revoked; through again with a grant to a Lamaste group they
#    belong to; refused once they leave the group.
# 4. The static site: refused while its listed users do not name them,
#    through once they do.
# 5. No sign-out: the member's session from before every change above still
#    reaches the authenticated tunnel and the site, and Authelia's MainPID
#    never changed — membership and grant changes are users.yml changes.
#
# Kind changes are spec 50; surfaces and the audience 51; OIDC by grant
# single-VM 36.
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../e2e/helpers.sh"
# shellcheck source-path=SCRIPTDIR source=app-plugin-harness.sh
source "${SCRIPT_DIR}/app-plugin-harness.sh"
MD_SPEC=49
# shellcheck source-path=SCRIPTDIR source=multi-domain-harness.sh
source "${SCRIPT_DIR}/multi-domain-harness.sh"

require_commands multipass curl jq perl openssl

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

MEM="e2e49-member"
EXT="e2e49-ext"
# Test credentials for this run only, never printed
MEM_PASSWORD="E2e-$(openssl rand -hex 12)"
EXT_PASSWORD="E2e-$(openssl rand -hex 12)"
MEM_ID=""
EXT_ID=""
JAR_MEM=$(md_jar member)
JAR_EXT=$(md_jar ext)
SUB_AUTH="e2e49a"
SUB_RES="e2e49r"
PORT_AUTH=18491
PORT_RES=18492
TUNNEL_AUTH=""
TUNNEL_RES=""
LGROUP="e2e49-team"
GRANT_DIRECT=""
GRANT_GROUP=""
SITE_NAME="e2e49site"
SITE_ID=""
SITE_FQDN=""
MARKER_AUTH="E2E_49_AUTH_$(date +%s)"
MARKER_RES="E2E_49_RES_$(date +%s)"
MARKER_SITE="E2E_49_SITE_$(date +%s)"
AUTHELIA_PID=""

# url_of <subdomain> — the page the specs ask for on a tunnel of B
url_of() { echo "https://$1.${DOMAIN_2}/index.html"; }

# member_unaffected <after what> — the member's session of before still
# reaches the authenticated tunnel and the site, and Authelia was not restarted
member_unaffected() {
  assert_served "${JAR_MEM}" "$(url_of "${SUB_AUTH}")" "${MARKER_AUTH}" "After $1, ${MEM}'s session of before on the authenticated tunnel"
  assert_eq "$(visit_status "$(visit "${JAR_MEM}" "https://${SITE_FQDN}/")")" "200" "…and on the site: 200" || true
  assert_eq "$(authelia_pid)" "${AUTHELIA_PID}" "…Authelia not restarted (MainPID ${AUTHELIA_PID})" || true
}

# access_request_page — the external member gets the access-request page on the authenticated tunnel
access_request_page() { [[ "$(visit_body "$(visit "${JAR_EXT}" "$(url_of "${SUB_AUTH}")")")" == *"Access Required"* ]]; }

begin_test "49 — External members: reach only what names them (Three-VM)"

cleanup() {
  log_info "Cleaning up test resources..."
  local id
  for id in ${GRANT_DIRECT} ${GRANT_GROUP}; do
    host_api_delete "gatekeeper/grants/${id}" > /dev/null 2>&1 || true
  done
  host_api_delete "gatekeeper/groups/${LGROUP}" > /dev/null 2>&1 || true
  if [ -n "${SITE_ID}" ]; then host_api_delete "sites/${SITE_ID}" > /dev/null 2>&1 || true; fi
  for id in ${TUNNEL_AUTH} ${TUNNEL_RES}; do
    host_api_delete "tunnels/${id}" > /dev/null 2>&1 || true
  done
  md_backend_stop "${PORT_AUTH}" "${PORT_RES}"
  for id in "${MEM}" "${EXT}"; do
    host_api_delete "users/${id}?erase=true" > /dev/null 2>&1 || true
  done
  md_cleanup
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
log_section "Pre-flight"
# ---------------------------------------------------------------------------

md_preflight
host_api_delete "gatekeeper/groups/${LGROUP}" > /dev/null 2>&1 || true

# ===========================================================================
# 1. B, a member and an external member, the hosts
# ===========================================================================

log_section "Domain B; a member and an external member of B"

md_domain_active "${DOMAIN_2}"
md_user MEM_ID "${MEM}" "${MEM_PASSWORD}" "[\"${DOMAIN_2}\"]"
md_user EXT_ID "${EXT}" "${EXT_PASSWORD}" "[{\"name\":\"${DOMAIN_2}\",\"kind\":\"external\"}]"
assert_eq "$(is_uuid "${MEM_ID}") $(is_uuid "${EXT_ID}")" "true true" "Both have a directory id" || true
assert_eq "$(user_kinds "${EXT}")" "${DOMAIN_2}:external" "GET /api/users: ${EXT} is an external member of B" || true
assert_eq "$(user_kinds "${MEM}")" "${DOMAIN_2}:member" "…${MEM} a member" || true
MEMBERS=$(host_api_get "domains/${DOMAIN_2}/members" 2>/dev/null || echo '{}')
assert_eq "$(echo "$MEMBERS" | jq -r --arg u "${EXT}" '[.members[]? | select(.username == $u) | .kind] | first // ""')" "external" "B's member list marks ${EXT} external" || true
assert_json_field "$(domain_entry "${DOMAIN_2}")" '.externalMembers >= 1' 'true' "GET /api/domains counts B's external members" || true

log_section "An authenticated and a restricted tunnel on B; a protected site listing the member"

md_tunnel TUNNEL_AUTH "${SUB_AUTH}" "${DOMAIN_2}" "${PORT_AUTH}" authenticated
md_tunnel TUNNEL_RES "${SUB_RES}" "${DOMAIN_2}" "${PORT_RES}" restricted
md_backends "${PORT_AUTH}:${MARKER_AUTH}" "${PORT_RES}:${MARKER_RES}"

host_api_delete "sites/$(host_api_get "sites" 2>/dev/null | jq -r --arg n "${SITE_NAME}" '.sites[]? | select(.name == $n) | .id' 2>/dev/null | head -n 1)" > /dev/null 2>&1 || true
RESP=$(md_api POST "sites" "{\"name\":\"${SITE_NAME}\",\"type\":\"managed\",\"domain\":\"${DOMAIN_2}\",\"autheliaProtected\":true}")
SITE_ID=$(json_get "$(body_of "$RESP")" '.site.id // empty')
SITE_FQDN=$(json_get "$(body_of "$RESP")" '.site.fqdn // empty')
assert_eq "${SITE_FQDN}" "${SITE_NAME}.${DOMAIN_2}" "Site ${SITE_NAME}.${DOMAIN_2}, Authelia-protected" || true
# Listing users is a structural change (the site gains a rule naming its
# group): made before the baseline below. Editing the list later is not.
RESP=$(md_api PATCH "sites/${SITE_ID}" "{\"allowedUsers\":[\"${MEM}\"]}")
assert_eq "$(status_of "$RESP")" "200" "…its listed users: ${MEM}" || true
host_exec "echo '<h1>${MARKER_SITE}</h1>' > /var/www/lamaste/${SITE_ID}/index.html" > /dev/null 2>&1 || true
md_hosts "${SITE_FQDN}"
md_wait_authelia "${DOMAIN_2}"

KEY_B=$(domain_group_key "${DOMAIN_2}")
assert_eq "$(printf '%s\n' "${KEY_B}" | grep -cE '^[0-9a-f]{16}$' || true)" "1" "B's rules name its group key" || true
assert_contains "$(access_rules_of "${DOMAIN_2}")" "\"group:lamaste:x:${KEY_B}\"" "…and a rule for B's external members" || true
assert_contains "$(access_rules_of "${DOMAIN_2}")" "\"group:lamaste:s:${SITE_ID}\"" "…the site's rule names its group, never a user" || true
assert_not_contains "$(access_rules_of "${DOMAIN_2}")" "\"user:" "…no rule names a user" || true
wait_group holds "${EXT}" "lamaste:x:${KEY_B}" "users.yml gives ${EXT} B's external group"
assert_not_contains ",$(user_groups "${EXT}")," ",lamaste:m:${KEY_B}," "…never B's member group" || true
assert_eq "$(user_groups "${EXT}")" "lamaste:x:${KEY_B}" "…and nothing else: no Authelia group, no host" || true
wait_group holds "${MEM}" "lamaste:s:${SITE_ID}" "users.yml gives ${MEM} the site's group (listed)"

# ===========================================================================
# 2. Signed in; the baseline
# ===========================================================================

log_section "Both signed in at auth.B; Authelia's MainPID from here on"

SECRET_MEM=$(reset_totp "${MEM}")
SECRET_EXT=$(reset_totp "${EXT}")
md_wait_authelia "${DOMAIN_2}"
md_sign_in "${MEM}" "${MEM_PASSWORD}" "${SECRET_MEM}" "${JAR_MEM}" "${SUB_AUTH}.${DOMAIN_2}"
md_sign_in "${EXT}" "${EXT_PASSWORD}" "${SECRET_EXT}" "${JAR_EXT}" "${SUB_AUTH}.${DOMAIN_2}"
AUTHELIA_PID=$(authelia_pid)
assert_not_eq "${AUTHELIA_PID:-0}" "0" "Authelia runs (MainPID ${AUTHELIA_PID})" || true
member_unaffected "signing in"

# ===========================================================================
# 3. The authenticated tunnel
# ===========================================================================

log_section "The authenticated tunnel refuses an external member"

assert_access_request "$(visit "${JAR_EXT}" "$(url_of "${SUB_AUTH}")")" "${EXT} on the authenticated tunnel"
assert_not_contains "$(visit_body "$(visit "${JAR_EXT}" "$(url_of "${SUB_AUTH}")")")" "${MARKER_AUTH}" "…nothing of the tunnel" || true

log_section "Authelia refuses on its own: the projection calls ${EXT} a member"

projection_hold "(.domains[] | select(.name == \"${DOMAIN_2}\")) |= (.members += [\"${EXT}\"] | .externals -= [\"${EXT}\"])"
assert_contains ",$(projection_members "${DOMAIN_2}")," ",${EXT}," "The projection held with ${EXT} as a member (Gatekeeper would admit them)" || true
RESP=$(visit "${JAR_EXT}" "$(url_of "${SUB_AUTH}")")
assert_eq "$(visit_status "$RESP")" "403" "${EXT} on the authenticated tunnel: still 403 — Authelia's rules admit B's external group only on hosts named for them" || true
assert_not_contains "$(visit_body "$RESP")" "${MARKER_AUTH}" "…nothing of the tunnel" || true
projection_restore
wait_for "${AUTHZ_SETTLE_SECONDS}" access_request_page || true
assert_access_request "$(visit "${JAR_EXT}" "$(url_of "${SUB_AUTH}")")" "The panel's projection back: ${EXT}"

# ===========================================================================
# 4. The restricted tunnel
# ===========================================================================

log_section "The restricted tunnel: a direct grant"

assert_access_request "$(visit "${JAR_EXT}" "$(url_of "${SUB_RES}")")" "${EXT} on the restricted tunnel without a grant"
md_grant GRANT_DIRECT user "${EXT}" tunnel "${TUNNEL_RES}"
wait_group holds "${EXT}" "${SUB_RES}.${DOMAIN_2}" "users.yml gives ${EXT} the tunnel's hostname as a group"
wait_status "${JAR_EXT}" "$(url_of "${SUB_RES}")" 200 "${EXT}, granted, on the restricted tunnel: 200 — the same session"
assert_served "${JAR_EXT}" "$(url_of "${SUB_RES}")" "${MARKER_RES}" "${EXT} on the restricted tunnel"
assert_access_request "$(visit "${JAR_EXT}" "$(url_of "${SUB_AUTH}")")" "…still refused on the authenticated one"
member_unaffected "the grant"

log_section "Revoked: refused again"

RESP=$(host_api_call DELETE "gatekeeper/grants/${GRANT_DIRECT}")
assert_eq "$(status_of "$RESP")" "200" "The grant revoked" || true
GRANT_DIRECT=""
wait_group lacks "${EXT}" "${SUB_RES}.${DOMAIN_2}" "users.yml takes the tunnel's group from ${EXT}"
wait_status "${JAR_EXT}" "$(url_of "${SUB_RES}")" 403 "${EXT} on the restricted tunnel: 403 within ${AUTHZ_SETTLE_SECONDS} s"
assert_access_request "$(visit "${JAR_EXT}" "$(url_of "${SUB_RES}")")" "…${EXT}, the grant revoked"
member_unaffected "the revocation"

log_section "A grant to a Lamaste group"

RESP=$(host_api_call POST "gatekeeper/groups" "{\"name\":\"${LGROUP}\",\"description\":\"E2E 49\"}")
assert_eq "$(status_of "$RESP")" "201" "Lamaste group ${LGROUP} created" || true
RESP=$(host_api_call POST "gatekeeper/groups/${LGROUP}/members" "{\"usernames\":[\"${EXT}\"]}")
assert_eq "$(status_of "$RESP")" "200" "…${EXT} its member" || true
md_grant GRANT_GROUP group "${LGROUP}" tunnel "${TUNNEL_RES}"
wait_group holds "${EXT}" "${SUB_RES}.${DOMAIN_2}" "users.yml gives ${EXT} the tunnel's group — through the Lamaste group"
assert_not_contains ",$(user_groups "${EXT}")," ",${LGROUP}," "…never the Lamaste group itself (it lives in Gatekeeper)" || true
wait_status "${JAR_EXT}" "$(url_of "${SUB_RES}")" 200 "${EXT}, in a granted Lamaste group, on the restricted tunnel: 200"

RESP=$(host_api_call DELETE "gatekeeper/groups/${LGROUP}/members/${EXT}")
assert_eq "$(status_of "$RESP")" "200" "${EXT} leaves ${LGROUP}" || true
wait_group lacks "${EXT}" "${SUB_RES}.${DOMAIN_2}" "users.yml takes the tunnel's group from ${EXT}"
wait_status "${JAR_EXT}" "$(url_of "${SUB_RES}")" 403 "${EXT}, no longer in the group: 403"
member_unaffected "the Lamaste group changes"

# ===========================================================================
# 5. The static site
# ===========================================================================

log_section "The static site: only once its listed users name ${EXT}"

RESP=$(visit "${JAR_EXT}" "https://${SITE_FQDN}/")
assert_eq "$(visit_status "$RESP")" "403" "${EXT} on the site, not listed: 403" || true
assert_contains "$(visit_body "$RESP")" "${SITE_FQDN}" "…the refusal page names the site" || true
assert_not_contains "$(visit_body "$RESP")" "${MARKER_SITE}" "…nothing of the site" || true
assert_not_contains "$(visit_headers "$RESP" | tr '[:upper:]' '[:lower:]')" "location:" "…never a redirect to a sign-in page" || true

RESP=$(md_api PATCH "sites/${SITE_ID}" "{\"allowedUsers\":[\"${MEM}\",\"${EXT}\"]}")
assert_eq "$(status_of "$RESP")" "200" "The site lists ${MEM} and ${EXT}" || true
wait_group holds "${EXT}" "lamaste:s:${SITE_ID}" "users.yml gives ${EXT} the site's group"
assert_not_contains ",$(user_groups "${EXT}")," ",${SITE_FQDN}," "…by the site's id, never its hostname" || true
wait_status "${JAR_EXT}" "https://${SITE_FQDN}/" 200 "${EXT}, listed, on the site: 200 — the same session"
assert_contains "$(visit_body "$(visit "${JAR_EXT}" "https://${SITE_FQDN}/")")" "${MARKER_SITE}" "…the site's page" || true
member_unaffected "the site's list"

# ===========================================================================
# 6. No sign-out, all along
# ===========================================================================

log_section "Nobody was signed out"

assert_eq "$(authelia_pid)" "${AUTHELIA_PID}" "Authelia's MainPID is the one of before the first change" || true
if signed_in "${JAR_MEM}" "${DOMAIN_2}" && signed_in "${JAR_EXT}" "${DOMAIN_2}"; then
  log_pass "Both sessions are still signed in at auth.${DOMAIN_2}"
else
  log_fail "A session of before ended"
fi

end_test

#!/usr/bin/env bash
# ============================================================================
# 47 — Multi-domain relay: a third domain changes nothing else (Three-VM)
# ============================================================================
# The multi-domain relay's third acceptance case (design: packages/core/
# docs/multi-domain-relay-design.md, "Proof"): adding a customer domain
# must not change who can reach any other. A is the relay's primary
# domain, B and C added ones (multi-domain-harness.sh).
#
# 1. A member of A and a member of B, an authenticated tunnel on each. A
#    snapshot: A's and B's rendered access rules (on their member groups,
#    never a user) and member lists, each member's groups, and a
#    reachability matrix — each user, signed in at both sign-in pages, on
#    each tunnel.
# 2. C is added and activated, with a new member of C and a tunnel on C.
# 3. A's and B's rules are byte-equal to the snapshot, so are their member
#    lists and their members' groups in users.yml; signed in again (C's
#    activation restarted Authelia and ended every session), every request
#    of the matrix answers as before.
# 4. C's member reaches C's tunnel, and is refused on A's and B's with the
#    domain refusal page; A's session opens nothing on C.
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../e2e/helpers.sh"
# shellcheck source-path=SCRIPTDIR source=app-plugin-harness.sh
source "${SCRIPT_DIR}/app-plugin-harness.sh"
MD_SPEC=47
# shellcheck source-path=SCRIPTDIR source=multi-domain-harness.sh
source "${SCRIPT_DIR}/multi-domain-harness.sh"

require_commands multipass curl jq perl openssl

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

USER_A="e2e47-a"
USER_B="e2e47-b"
USER_C="e2e47-c"
# Test credentials for this run only, never printed
PASSWORD_A="E2e-$(openssl rand -hex 12)"
PASSWORD_B="E2e-$(openssl rand -hex 12)"
PASSWORD_C="E2e-$(openssl rand -hex 12)"
ID_A=""
ID_B=""
ID_C=""
SECRET_A=""
SECRET_B=""
SUB_A="e2e47a"
SUB_B="e2e47b"
SUB_C="e2e47c"
PORT_A=18471
PORT_B=18472
PORT_C=18473
TUNNEL_A=""
TUNNEL_B=""
TUNNEL_C=""
MARKER_A="E2E_47_A_$(date +%s)"
MARKER_B="E2E_47_B_$(date +%s)"
MARKER_C="E2E_47_C_$(date +%s)"

# sign_in_everywhere — USER_A and USER_B, each at auth.A and auth.B
sign_in_everywhere() {
  md_sign_in "${USER_A}" "${PASSWORD_A}" "${SECRET_A}" "$(md_jar a-a)" "${SUB_A}.${DOMAIN}"
  md_sign_in "${USER_B}" "${PASSWORD_B}" "${SECRET_B}" "$(md_jar b-b)" "${SUB_B}.${DOMAIN_2}"
  md_sign_in "${USER_A}" "${PASSWORD_A}" "${SECRET_A}" "$(md_jar a-b)" "${SUB_B}.${DOMAIN_2}"
  md_sign_in "${USER_B}" "${PASSWORD_B}" "${SECRET_B}" "$(md_jar b-a)" "${SUB_A}.${DOMAIN}"
}

# matrix — "<user>@<tunnel>=<status>" for each user (with the session of the
# tunnel's domain) on A's and B's tunnels, from one visitor call
matrix() {
  local u t host jar cmds=""
  for u in a b; do
    for t in a b; do
      if [ "$t" = "a" ]; then host="${SUB_A}.${DOMAIN}"; else host="${SUB_B}.${DOMAIN_2}"; fi
      jar=$(md_jar "${u}-${t}")
      cmds="${cmds} echo -n '${u}@${host%%.*}='; curl -sk -o /dev/null -w '%{http_code} ' --max-time 15 -b ${jar} https://${host}/index.html || true;"
    done
  done
  visitor_exec "${cmds}" 2>/dev/null | tr -s ' ' | sed 's/ $//' || echo ""
}

begin_test "47 — Multi-domain relay: a third domain changes nothing else (Three-VM)"

cleanup() {
  log_info "Cleaning up test resources..."
  local id u
  for id in ${TUNNEL_A} ${TUNNEL_B} ${TUNNEL_C}; do
    host_api_delete "tunnels/${id}" > /dev/null 2>&1 || true
  done
  md_backend_stop "${PORT_A}" "${PORT_B}" "${PORT_C}"
  for u in "${USER_A}" "${USER_B}" "${USER_C}"; do
    host_api_delete "users/${u}?erase=true" > /dev/null 2>&1 || true
  done
  md_cleanup
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
log_section "Pre-flight"
# ---------------------------------------------------------------------------

md_preflight
if [ "$(domain_entry "${DOMAIN_3}")" != "null" ]; then
  log_info "${DOMAIN_3} is left over from an interrupted run — removed first"
  md_api DELETE "domains/${DOMAIN_3}" > /dev/null || true
fi

# ===========================================================================
# 1. Two domains, a member of each; the snapshot
# ===========================================================================

log_section "A member of A, a member of B, a tunnel on each"

md_domain_active "${DOMAIN_2}"
md_user ID_A "${USER_A}" "${PASSWORD_A}" "[\"${DOMAIN}\"]"
md_user ID_B "${USER_B}" "${PASSWORD_B}" "[\"${DOMAIN_2}\"]"
assert_eq "$(is_uuid "${ID_A}") $(is_uuid "${ID_B}")" "true true" "Both have a directory id" || true
md_tunnel TUNNEL_A "${SUB_A}" "${DOMAIN}" "${PORT_A}" authenticated
md_tunnel TUNNEL_B "${SUB_B}" "${DOMAIN_2}" "${PORT_B}" authenticated
md_backends "${PORT_A}:${MARKER_A}" "${PORT_B}:${MARKER_B}"

log_section "The snapshot: rules, members, reachability"

md_wait_authelia "${DOMAIN}"
RULES_A=$(access_rules_of "${DOMAIN}")
RULES_B=$(access_rules_of "${DOMAIN_2}")
MEMBERS_A=$(domain_members "${DOMAIN}")
MEMBERS_B=$(domain_members "${DOMAIN_2}")
KEY_A=$(domain_group_key "${DOMAIN}")
KEY_B=$(domain_group_key "${DOMAIN_2}")
assert_contains "${RULES_A}" "\"group:lamaste:m:${KEY_A}\"" "A's rules admit A's member group" || true
assert_contains "${RULES_B}" "\"group:lamaste:m:${KEY_B}\"" "B's rules admit B's member group" || true
assert_not_contains "${RULES_A}${RULES_B}" "\"user:" "…neither names a user" || true
wait_group holds "${USER_A}" "lamaste:m:${KEY_A}" "users.yml gives ${USER_A} A's member group"
assert_not_contains ",$(user_groups "${USER_A}")," ",lamaste:m:${KEY_B}," "…not B's" || true
wait_group holds "${USER_B}" "lamaste:m:${KEY_B}" "users.yml gives ${USER_B} B's member group"
assert_not_contains ",$(user_groups "${USER_B}")," ",lamaste:m:${KEY_A}," "…not A's" || true
GROUPS_A=$(user_groups "${USER_A}")
GROUPS_B=$(user_groups "${USER_B}")

SECRET_A=$(reset_totp "${USER_A}")
SECRET_B=$(reset_totp "${USER_B}")
sign_in_everywhere
BEFORE=$(matrix)
assert_eq "${BEFORE}" "a@${SUB_A}=200 a@${SUB_B}=403 b@${SUB_A}=403 b@${SUB_B}=200" "Each reaches its own domain's tunnel and is refused on the other's" || true

# ===========================================================================
# 2. A third domain
# ===========================================================================

log_section "Domain C added and activated, with a member of its own and a tunnel"

md_domain_active "${DOMAIN_3}"
md_user ID_C "${USER_C}" "${PASSWORD_C}" "[\"${DOMAIN_3}\"]"
assert_eq "$(is_uuid "${ID_C}")" "true" "${USER_C} has a directory id" || true
md_tunnel TUNNEL_C "${SUB_C}" "${DOMAIN_3}" "${PORT_C}" authenticated
md_backends "${PORT_C}:${MARKER_C}"
assert_contains ",$(session_cookie_domains)," ",${DOMAIN_3}," "Authelia holds a session cookie for C" || true

# ===========================================================================
# 3. Nothing else changed
# ===========================================================================

log_section "A and B: the same rules, the same members, the same answers"

assert_eq "$(access_rules_of "${DOMAIN}")" "${RULES_A}" "A's rendered rules are byte-equal to the snapshot" || true
assert_eq "$(access_rules_of "${DOMAIN_2}")" "${RULES_B}" "B's rendered rules are byte-equal to the snapshot" || true
assert_eq "$(domain_members "${DOMAIN}")" "${MEMBERS_A}" "A's member list is unchanged" || true
assert_eq "$(domain_members "${DOMAIN_2}")" "${MEMBERS_B}" "…and B's" || true
assert_eq "$(domain_members "${DOMAIN_3}")" "${USER_C}" "C has its one member" || true
assert_eq "$(user_groups "${USER_A}") | $(user_groups "${USER_B}")" "${GROUPS_A} | ${GROUPS_B}" "${USER_A}'s and ${USER_B}'s groups in users.yml are unchanged" || true

md_wait_authelia "${DOMAIN}"
sign_in_everywhere
assert_eq "$(matrix)" "${BEFORE}" "Signed in again: every request answers as before (${BEFORE})" || true

# ===========================================================================
# 4. C's member reaches C only
# ===========================================================================

log_section "C's member: C's tunnel, refused on A and B"

SECRET_C=$(reset_totp "${USER_C}")
md_sign_in "${USER_C}" "${PASSWORD_C}" "${SECRET_C}" "$(md_jar c-c)" "${SUB_C}.${DOMAIN_3}"
md_sign_in "${USER_C}" "${PASSWORD_C}" "${SECRET_C}" "$(md_jar c-a)" "${SUB_A}.${DOMAIN}"
md_sign_in "${USER_C}" "${PASSWORD_C}" "${SECRET_C}" "$(md_jar c-b)" "${SUB_B}.${DOMAIN_2}"
assert_served "$(md_jar c-c)" "https://${SUB_C}.${DOMAIN_3}/index.html" "${MARKER_C}" "${USER_C} on C's tunnel"
assert_domain_refusal "$(visit "$(md_jar c-a)" "https://${SUB_A}.${DOMAIN}/index.html")" "${DOMAIN}" "${USER_C} on A's tunnel"
assert_domain_refusal "$(visit "$(md_jar c-b)" "https://${SUB_B}.${DOMAIN_2}/index.html")" "${DOMAIN_2}" "${USER_C} on B's tunnel"
assert_eq "$(outcome "$(md_jar a-a)" "https://${SUB_C}.${DOMAIN_3}/index.html")" "302 auth.${DOMAIN_3}" "${USER_A}'s session of A opens nothing on C: to C's own sign-in page" || true

end_test

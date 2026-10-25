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
#    snapshot: A's and B's rendered access rules, Gatekeeper's projection
#    of A and B, and a reachability matrix — each user, signed in at both
#    sign-in pages, on each tunnel.
# 2. C is added and activated, with a new member of C and a tunnel on C.
# 3. A's and B's rules are byte-equal to the snapshot, so is the projection
#    of A and B; signed in again (C's activation restarted Authelia and
#    ended every session), every request of the matrix answers as before.
# 4. C's member reaches C's tunnel, and is refused on A's and B's with the
#    domain refusal page.
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
SECRET_C=""
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

# jar <user> <domain> — a visitor cookie jar per user and sign-in page
jar() { echo "/tmp/e2e-47-$1-$2.cookies"; }

# sign_in_everywhere — USER_A and USER_B, each at auth.A and auth.B, in a
# fresh TOTP window (a code used in the current one is refused)
sign_in_everywhere() {
  wait_for_next_totp_window
  md_sign_in "${USER_A}" "${PASSWORD_A}" "${SECRET_A}" "$(jar a "${DOMAIN}")" "${SUB_A}.${DOMAIN}" "${DOMAIN}"
  md_sign_in "${USER_B}" "${PASSWORD_B}" "${SECRET_B}" "$(jar b "${DOMAIN_2}")" "${SUB_B}.${DOMAIN_2}" "${DOMAIN_2}"
  wait_for_next_totp_window
  md_sign_in "${USER_A}" "${PASSWORD_A}" "${SECRET_A}" "$(jar a "${DOMAIN_2}")" "${SUB_B}.${DOMAIN_2}" "${DOMAIN_2}"
  md_sign_in "${USER_B}" "${PASSWORD_B}" "${SECRET_B}" "$(jar b "${DOMAIN}")" "${SUB_A}.${DOMAIN}" "${DOMAIN}"
}

# matrix — "<user>@<tunnel>=<status>" for each user (with the session of
# the tunnel's domain) on each of A's and B's tunnels, space-separated
matrix() {
  local u host d out=""
  for u in a b; do
    for host in "${SUB_A}.${DOMAIN}" "${SUB_B}.${DOMAIN_2}"; do
      d="${host#*.}"
      out="${out} ${u}@${host%%.*}=$(visit_status "$(visit "$(jar "$u" "$d")" "https://${host}/index.html")")"
    done
  done
  echo "${out# }"
}

begin_test "47 — Multi-domain relay: a third domain changes nothing else (Three-VM)"

cleanup() {
  log_info "Cleaning up test resources..."
  local id port u d
  for id in ${TUNNEL_A} ${TUNNEL_B} ${TUNNEL_C}; do
    host_api_delete "tunnels/${id}" > /dev/null 2>&1 || true
  done
  for port in ${PORT_A} ${PORT_B} ${PORT_C}; do md_backend_stop "${port}"; done
  for u in "${USER_A}" "${USER_B}" "${USER_C}"; do
    host_api_delete "users/${u}?erase=true" > /dev/null 2>&1 || true
  done
  for u in a b c; do
    for d in "${DOMAIN}" "${DOMAIN_2}" "${DOMAIN_3}"; do
      timed_exec 15 multipass exec "${VISITOR_VM}" -- sudo bash -c "rm -f $(jar "$u" "$d"); true" > /dev/null 2>&1
    done
  done
  md_cleanup_domains
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

log_section "The snapshot: rules, projection, reachability"

md_wait_authelia "${DOMAIN}"
RULES_A=$(access_rules_of "${DOMAIN}")
RULES_B=$(access_rules_of "${DOMAIN_2}")
MEMBERS_A=$(projection_members "${DOMAIN}")
MEMBERS_B=$(projection_members "${DOMAIN_2}")
assert_contains "${RULES_A}" "\"user:${USER_A}\"" "A's rules admit ${USER_A}" || true
assert_not_contains "${RULES_A}" "\"user:${USER_B}\"" "…not ${USER_B}" || true
assert_contains "${RULES_B}" "\"user:${USER_B}\"" "B's rules admit ${USER_B}" || true
assert_not_contains "${RULES_B}" "\"user:${USER_A}\"" "…not ${USER_A}" || true

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
md_backend "${PORT_C}" "${MARKER_C}"
nudge_sync
if wait_for 120 tunnel_reachable "${PORT_C}" "${MARKER_C}"; then
  log_pass "Port ${PORT_C}: C's backend answers through chisel"
else
  log_fail "Port ${PORT_C}: C's backend does not answer through chisel"
fi
assert_contains "$(session_cookie_domains)" "${DOMAIN_3}" "Authelia holds a session cookie for C" || true

# ===========================================================================
# 3. Nothing else changed
# ===========================================================================

log_section "A and B: the same rules, the same members, the same answers"

assert_eq "$(access_rules_of "${DOMAIN}")" "${RULES_A}" "A's rendered rules are byte-equal to the snapshot" || true
assert_eq "$(access_rules_of "${DOMAIN_2}")" "${RULES_B}" "B's rendered rules are byte-equal to the snapshot" || true
assert_eq "$(projection_members "${DOMAIN}")" "${MEMBERS_A}" "Gatekeeper's projection of A is unchanged" || true
assert_eq "$(projection_members "${DOMAIN_2}")" "${MEMBERS_B}" "…and of B" || true
assert_eq "$(projection_members "${DOMAIN_3}")" "${USER_C}" "…and holds C with its one member" || true

md_wait_authelia "${DOMAIN}"
sign_in_everywhere
assert_eq "$(matrix)" "${BEFORE}" "Signed in again: every request answers as before (${BEFORE})" || true

# ===========================================================================
# 4. C's member reaches C only
# ===========================================================================

log_section "C's member: C's tunnel, refused on A and B"

SECRET_C=$(reset_totp "${USER_C}")
wait_for_next_totp_window
md_sign_in "${USER_C}" "${PASSWORD_C}" "${SECRET_C}" "$(jar c "${DOMAIN_3}")" "${SUB_C}.${DOMAIN_3}" "${DOMAIN_3}"
md_sign_in "${USER_C}" "${PASSWORD_C}" "${SECRET_C}" "$(jar c "${DOMAIN}")" "${SUB_A}.${DOMAIN}" "${DOMAIN}"
wait_for_next_totp_window
md_sign_in "${USER_C}" "${PASSWORD_C}" "${SECRET_C}" "$(jar c "${DOMAIN_2}")" "${SUB_B}.${DOMAIN_2}" "${DOMAIN_2}"
RESP=$(visit "$(jar c "${DOMAIN_3}")" "https://${SUB_C}.${DOMAIN_3}/index.html")
assert_eq "$(visit_status "$RESP")" "200" "${USER_C} on C's tunnel: 200" || true
assert_contains "$(visit_body "$RESP")" "${MARKER_C}" "…from its backend" || true
assert_domain_refusal "$(visit "$(jar c "${DOMAIN}")" "https://${SUB_A}.${DOMAIN}/index.html")" "${DOMAIN}" "${USER_C} on A's tunnel"
assert_domain_refusal "$(visit "$(jar c "${DOMAIN_2}")" "https://${SUB_B}.${DOMAIN_2}/index.html")" "${DOMAIN_2}" "${USER_C} on B's tunnel"
RESP=$(visit "$(jar a "${DOMAIN}")" "https://${SUB_C}.${DOMAIN_3}/index.html")
assert_eq "$(visit_status "$RESP")" "302" "${USER_A}'s session of A opens nothing on C: to C's sign-in page" || true

end_test

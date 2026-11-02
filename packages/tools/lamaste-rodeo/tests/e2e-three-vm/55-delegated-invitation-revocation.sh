#!/usr/bin/env bash
# ============================================================================
# 55 — Delegated invitations: revocation ends access (Three-VM)
# ============================================================================
# The third proof of delegated invitations (design: packages/core/docs/
# delegated-invitations-design.md, "Proof").
#
# 1. A link stops working: the inviter revokes their own pending invitation
#    (410 on lookup and accept); another inviter cannot touch it (404, as
#    none at all); the administrator revokes one; five refused acceptances
#    lock a link, the inviter told so.
# 2. The policy reaches open invitations: an e-mail domain removed, a shorter
#    lifetime, the policy turned off.
# 3. The surface: an inviter whose site grant is gone is refused on the API
#    though they keep the role; their open invitation still cannot be
#    accepted, and is revoked. The web surface deleted revokes what named it.
# 4. The inviter's role taken away: their pending invitation ends revoked
#    (inviter_unentitled), and the person they invited keeps the site (the
#    founders' decision D1).
# 5. disable-invitees, transitive: a coordinator invited a coordinator who
#    invited a viewer; disabling the first's invitees ends both sessions at
#    once (401), without touching the first.
# 6. A revocation racing an acceptance, tried a few times: a `marked` answer
#    is never followed by a link that works, and an account made anyway ends
#    disabled, as audited. Hitting the window depends on timing: the spec says
#    when it did not, and the deterministic proof stays in
#    packages/server/daemon/test/delegated-invitations-review.test.js.
# Nothing here restarts Authelia.
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../e2e/helpers.sh"
# shellcheck source-path=SCRIPTDIR source=app-plugin-harness.sh
source "${SCRIPT_DIR}/app-plugin-harness.sh"
MD_SPEC=55
# shellcheck source-path=SCRIPTDIR source=multi-domain-harness.sh
source "${SCRIPT_DIR}/multi-domain-harness.sh"
# shellcheck source-path=SCRIPTDIR source=invitation-harness.sh
source "${SCRIPT_DIR}/invitation-harness.sh"

require_commands multipass curl jq node npm tar perl openssl

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

PLUGIN="e2e-xinv"
SERVER_PACKAGE="@lamalibre/e2e-xinv-server"
AGENT_PACKAGE="@lamalibre/e2e-xinv-agent"
APP="/api/${PLUGIN}/app"
SUB_W="e2e55web"
POLICY_ID="e2e-apphost-55"
REMOTE_DIR="/var/tmp/e2e-55-app-plugin"
LOCAL_TMP=""
CLEAN_PLUGINS="${PLUGIN}"
CLEAN_ROUTES="${PLUGIN}"
PURGE_PACKAGES=""
COORD="e2e55-coord"
COORD2="e2e55-coord2"
FIRST="e2e55-first"
CHAIN="e2e55-chain"
LEAF="e2e55-leaf"
# Test credentials for this run only, never printed
PASSWORD="E2e-$(openssl rand -hex 12)"
COORD_ID=""
COORD2_ID=""
FIRST_ID=""
CHAIN_ID=""
LEAF_ID=""
RACED_IDS=""
RACED_USERS=""
JAR_COORD=$(md_jar coord)
JAR_COORD2=$(md_jar coord2)
JAR_FIRST=$(md_jar first)
JAR_CHAIN=$(md_jar chain)
JAR_LEAF=$(md_jar leaf)
FQDN=""
COORD_GRANT=""
COORD2_GRANT=""
AUDIT_BASE=0

# site_status <jar> — how the shell answers the session
shell_for() { [[ "$(visit_body "$(page "$1" /)")" == *"E2E_WEB_v1"* ]]; }
# api_says <jar> <status> — the user surface's API answers <status>
api_says() { [ "$(page_status "$1" "${APP}/echo")" = "$2" ]; }

begin_test "55 — Delegated invitations: revocation ends access (Three-VM)"

cleanup() {
  log_info "Cleaning up test resources..."
  local id
  for id in ${COORD_GRANT} ${COORD2_GRANT}; do
    host_api_delete "gatekeeper/grants/${id}" > /dev/null 2>&1 || true
  done
  if [ -n "${SITE_ID}" ]; then inv_drop_site_grants "${SITE_ID}"; fi
  host_api_delete "plugins/${PLUGIN}/web-surface" > /dev/null 2>&1 || true
  drop_plugin_grants "${PLUGIN}"
  # shellcheck disable=SC2086 # a list of usernames
  inv_cleanup_users "${COORD}" "${COORD2}" "${FIRST}" "${CHAIN}" "${LEAF}" ${RACED_USERS}
  # shellcheck disable=SC2086 # lists of ids
  inv_cleanup_ids ${COORD_ID} ${COORD2_ID} ${FIRST_ID} ${CHAIN_ID} ${LEAF_ID} ${RACED_IDS}
  nudge_sync
  app_plugin_cleanup
  md_cleanup
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
log_section "Pre-flight"
# ---------------------------------------------------------------------------

app_plugin_preflight
md_setup
if agent_has_node_sqlite; then
  log_pass "The agent VM's Node.js has node:sqlite, which the agent half's projection needs"
else
  log_fail "The agent VM's Node.js has no unflagged node:sqlite (Node.js 22.13 or later): the identity fixture cannot run"
  end_test
  exit $?
fi
host_api_delete "plugins/${PLUGIN}/web-surface" > /dev/null 2>&1 || true
drop_plugin_grants "${PLUGIN}"
AUDIT_BASE=$(host_api_get "audit?limit=1" 2>/dev/null | jq '.entries[0].id // 0' 2>/dev/null || echo "0")

log_section "Domain B; two coordinators; the plugin, its restricted web surface, invitations on"

md_domain_active "${DOMAIN_2}"
FQDN="${SUB_W}.${DOMAIN_2}"
EXTERNAL="[{\"name\":\"${DOMAIN_2}\",\"kind\":\"external\"}]"
md_user COORD_ID "${COORD}" "${PASSWORD}" "${EXTERNAL}"
md_user COORD2_ID "${COORD2}" "${PASSWORD}" "${EXTERNAL}"

LOCAL_TMP=$(mktemp -d /tmp/e2e-55-app-plugin-XXXXXXXX)
if ! write_app_install_fixture "${LOCAL_TMP}/ship/fixtures/xinv" "${PLUGIN}" 1.0.0 main "r$(date +%s)-$$" '[]' none inviting v1 "${SUB_W}"; then
  log_fail "The fixture could not be built (npm install at the workspace root, npm run build -w packages/core/lib)"
  end_test
  exit $?
fi
log_pass "Fixture built: ${SERVER_PACKAGE}"
ship_agent_facts_probe
start_stand_in_feria fixtures/xinv/server fixtures/xinv/agent
ensure_app_host_helper
open_push_install "${POLICY_ID}" "[\"${AGENT_PACKAGE}\"]" '["install","uninstall"]'
inv_install "${PLUGIN}" "${SERVER_PACKAGE}" "${AGENT_PACKAGE}"
inv_web_surface SITE_ID "${PLUGIN}" "${FQDN}" restricted
md_hosts "${FQDN}"
inv_entitle "${COORD}" coordinator
inv_entitle "${COORD2}" coordinator
md_grant COORD_GRANT user "${COORD}" site "${SITE_ID}"
md_grant COORD2_GRANT user "${COORD2}" site "${SITE_ID}"
inv_wait_audience "${COORD_ID}" coordinator "The audience holds ${COORD}"
inv_wait_audience "${COORD2_ID}" coordinator "…and ${COORD2}"
RESP=$(inv_policy "{\"enabled\":true,\"emailDomains\":[\"${INV_MAIL}\",\"client.example\"],\"lifetimeDays\":14}")
assert_eq "$(status_of "$RESP")" "200" "Invitations enabled: two e-mail domains, 14 days" || true
md_wait_authelia "${DOMAIN_2}"
md_sign_in "${COORD}" "${PASSWORD}" "$(reset_totp "${COORD}")" "${JAR_COORD}" "${FQDN}"
md_sign_in "${COORD2}" "${PASSWORD}" "$(reset_totp "${COORD2}")" "${JAR_COORD2}" "${FQDN}"
AUTHELIA_PID=$(authelia_pid)

# ===========================================================================
# 1. A link stops working
# ===========================================================================

log_section "The inviter revokes their own; another inviter cannot"

inv_new T1 I1 "${JAR_COORD}" "a1@${INV_MAIL}" viewer "${COORD} invites a1"
RESP=$(inv_api "${JAR_COORD2}" DELETE "/${I1}")
assert_eq "$(visit_status "$RESP")" "404" "${COORD2} revokes ${COORD}'s: 404, as none at all" || true
assert_json_field "$(inv_row "${I1}")" '.status' 'pending' "…it stays pending" || true
RESP=$(inv_api "${JAR_COORD}" DELETE "/${I1}")
assert_eq "$(visit_status "$RESP")" "200" "${COORD} revokes their own: 200" || true
inv_wait_ended "${I1}" revoked inviter "…revoked, by the inviter"
assert_eq "$(visit_status "$(inv_lookup "${T1}")")" "410" "The link: lookup 410" || true
assert_eq "$(visit_status "$(inv_accept "${T1}" e2e55-late "${PASSWORD}")")" "410" "…accept 410" || true
assert_eq "$(user_kinds e2e55-late)" "" "…no account" || true

log_section "The administrator revokes any"

inv_new T2 I2 "${JAR_COORD}" "a2@${INV_MAIL}" viewer "${COORD} invites a2"
RESP=$(host_api_call DELETE "invitations/${I2}")
assert_eq "$(status_of "$RESP")" "200" "DELETE /api/invitations/<id>: 200" || true
assert_json_field "$(body_of "$RESP")" '.action' 'revoked' "…revoked, the row kept" || true
inv_wait_ended "${I2}" revoked admin "…by the administrator"
assert_eq "$(visit_status "$(inv_lookup "${T2}")")" "410" "The link: 410" || true

log_section "Five refused acceptances lock a link"

inv_new T3 I3 "${JAR_COORD}" "a3@${INV_MAIL}" viewer "${COORD} invites a3"
for n in 1 2 3 4; do
  assert_eq "$(visit_status "$(inv_accept "${T3}" "${COORD}" "${PASSWORD}")")" "409" "Refused username ${n}: 409" || true
done
assert_json_field "$(inv_row "${I3}")" '.status' 'pending' "Four: still pending" || true
assert_eq "$(visit_status "$(inv_accept "${T3}" "${COORD}" "${PASSWORD}")")" "409" "The fifth: 409" || true
inv_wait_ended "${I3}" revoked attempts_exhausted "…the link is locked"
assert_eq "$(visit_status "$(inv_accept "${T3}" e2e55-free "${PASSWORD}")")" "410" "A free username now: 410" || true
assert_json_field "$(visit_body "$(inv_api "${JAR_COORD}" GET)")" "[.invitations[] | select(.id == \"${I3}\") | \"\(.status) \(.revokedReason)\"] | first" 'revoked attempts_exhausted' "The inviter sees why" || true

# ===========================================================================
# 2. The policy reaches open invitations
# ===========================================================================

log_section "The policy: a domain removed, a shorter lifetime, turned off"

inv_new T4 I4 "${JAR_COORD}" "b1@client.example" viewer "${COORD} invites an address under the second domain"
inv_new T5 I5 "${JAR_COORD}" "b2@${INV_MAIL}" viewer "…and one under the first"
EXPIRES_BEFORE=$(json_get "$(inv_row "${I5}")" '.expiresAt')
RESP=$(inv_policy "{\"enabled\":true,\"emailDomains\":[\"${INV_MAIL}\"],\"lifetimeDays\":2}")
assert_eq "$(status_of "$RESP")" "200" "The administrator removes client.example and shortens the lifetime to 2 days" || true
inv_wait_ended "${I4}" revoked email_domain_removed "The invitation under the removed domain is revoked"
assert_eq "$(visit_status "$(inv_accept "${T4}" e2e55-removed "${PASSWORD}")")" "410" "…its link 410" || true
assert_json_field "$(inv_row "${I5}")" '.status' 'pending' "The other stays pending" || true
EXPIRES_AFTER=$(json_get "$(inv_row "${I5}")" '.expiresAt')
assert_eq "$([ "$(iso_epoch "${EXPIRES_AFTER}")" -lt "$(iso_epoch "${EXPIRES_BEFORE}")" ] && [ $(($(iso_epoch "${EXPIRES_AFTER}") - $(date +%s))) -le 172800 ] && echo shorter)" "shorter" "…its expiry brought within the two days" || true
RESP=$(inv_policy "{\"enabled\":false,\"emailDomains\":[\"${INV_MAIL}\"]}")
assert_eq "$(status_of "$RESP")" "200" "The policy turned off" || true
inv_wait_ended "${I5}" revoked policy_disabled "The open invitation is revoked"
assert_eq "$(visit_status "$(inv_lookup "${T5}")")" "410" "…its link 410" || true
assert_eq "$(visit_status "$(inv_api "${JAR_COORD}" GET)")" "403" "The inviter's API: 403" || true
RESP=$(inv_policy "{\"enabled\":true,\"emailDomains\":[\"${INV_MAIL}\"]}")
assert_eq "$(status_of "$RESP")" "200" "On again" || true

# ===========================================================================
# 3. The people: one joined, whose inviter then loses the role
# ===========================================================================

log_section "An invitee joins; their inviter loses the role"

inv_new T6 I6 "${JAR_COORD2}" "c1@${INV_MAIL}" viewer "${COORD2} invites c1"
RESP=$(inv_accept "${T6}" "${FIRST}" "${PASSWORD}")
assert_eq "$(visit_status "$RESP")" "200" "${FIRST} accepts" || true
SECRET_FIRST=$(inv_secret "$RESP")
FIRST_ID=$(json_get "$(inv_row "${I6}")" '.acceptedUserId // empty')
wait_group holds "${FIRST}" "${FQDN}" "users.yml gives ${FIRST} the site's hostname"
md_sign_in "${FIRST}" "${PASSWORD}" "${SECRET_FIRST}" "${JAR_FIRST}" "${FQDN}"
if wait_for "${AUTHZ_SETTLE_SECONDS}" shell_for "${JAR_FIRST}"; then log_pass "${FIRST}: the shell"; else log_fail "${FIRST} on the shell: $(page_status "${JAR_FIRST}" /)"; fi

log_section "The inviter's site grant goes: the role alone no longer invites"

inv_new T7 I7 "${JAR_COORD2}" "c2@${INV_MAIL}" viewer "${COORD2} invites c2, pending"
RESP=$(host_api_call DELETE "gatekeeper/grants/${COORD2_GRANT}")
assert_eq "$(status_of "$RESP")" "200" "${COORD2}'s site grant revoked, the role left in place" || true
COORD2_GRANT=""
if wait_for "${AUTHZ_SETTLE_SECONDS}" status_is "${JAR_COORD2}" "$(inv_url)" 403; then
  log_pass "${COORD2} on the inviter's API: 403"
else
  log_fail "${COORD2} on the inviter's API: $(visit_status "$(visit "${JAR_COORD2}" "$(inv_url)")")"
fi
RESP=$(inv_accept "${T7}" e2e55-noreach "${PASSWORD}")
assert_eq "$(visit_status "$RESP")" "410" "Their open invitation cannot be accepted" || true
inv_wait_ended "${I7}" revoked inviter_unentitled "…revoked at the claim"
assert_eq "$(user_kinds e2e55-noreach)" "" "…no account" || true

log_section "The inviter's role goes: their pending ones end; the person they invited stays (D1)"

inv_new T8 I8 "${JAR_COORD}" "d1@${INV_MAIL}" viewer "${COORD} invites d1, pending"
RESP=$(host_api_call DELETE "plugins/${PLUGIN}/entitlements?principalType=user&principalId=${COORD2}")
assert_eq "$(status_of "$RESP")" "200" "${COORD2}'s role removed" || true
assert_json_field "$(audience_row "${PLUGIN}" "${FIRST_ID}")" '"\(.change.kind) \(.change.member.status)"' 'upsert active' "${FIRST}, whom ${COORD2} invited, stays in the audience" || true
assert_eq "$(page_status "${JAR_FIRST}" "${APP}/echo")" "200" "…and reaches the API" || true
if shell_for "${JAR_FIRST}"; then log_pass "…and the shell"; else log_fail "${FIRST} lost the shell"; fi
RESP=$(host_api_call DELETE "plugins/${PLUGIN}/entitlements?principalType=user&principalId=${COORD}")
assert_eq "$(status_of "$RESP")" "200" "${COORD}'s role removed" || true
inv_wait_ended "${I8}" revoked inviter_unentitled "Their pending invitation ends revoked (inviter_unentitled)"
assert_eq "$(visit_status "$(inv_lookup "${T8}")")" "410" "…its link 410" || true
inv_entitle "${COORD}" coordinator
inv_wait_audience "${COORD_ID}" coordinator "${COORD} is a coordinator again"

# ===========================================================================
# 4. disable-invitees
# ===========================================================================

log_section "A chain: a coordinator invites a coordinator, who invites a viewer"

inv_new T9 I9 "${JAR_COORD}" "e1@${INV_MAIL}" coordinator "${COORD} invites a coordinator"
RESP=$(inv_accept "${T9}" "${CHAIN}" "${PASSWORD}")
assert_eq "$(visit_status "$RESP")" "200" "${CHAIN} accepts" || true
SECRET_CHAIN=$(inv_secret "$RESP")
CHAIN_ID=$(json_get "$(inv_row "${I9}")" '.acceptedUserId // empty')
inv_wait_audience "${CHAIN_ID}" coordinator "${CHAIN} is a coordinator"
wait_group holds "${CHAIN}" "${FQDN}" "users.yml gives ${CHAIN} the site's hostname"
md_sign_in "${CHAIN}" "${PASSWORD}" "${SECRET_CHAIN}" "${JAR_CHAIN}" "${FQDN}"
inv_new T10 I10 "${JAR_CHAIN}" "e2@${INV_MAIL}" viewer "${CHAIN} invites a viewer"
RESP=$(inv_accept "${T10}" "${LEAF}" "${PASSWORD}")
assert_eq "$(visit_status "$RESP")" "200" "${LEAF} accepts" || true
SECRET_LEAF=$(inv_secret "$RESP")
LEAF_ID=$(json_get "$(inv_row "${I10}")" '.acceptedUserId // empty')
wait_group holds "${LEAF}" "${FQDN}" "users.yml gives ${LEAF} the site's hostname"
md_sign_in "${LEAF}" "${PASSWORD}" "${SECRET_LEAF}" "${JAR_LEAF}" "${FQDN}"
if wait_for "${AUTHZ_SETTLE_SECONDS}" api_says "${JAR_LEAF}" 200; then log_pass "${LEAF}: the API"; else log_fail "${LEAF} on the API: $(page_status "${JAR_LEAF}" "${APP}/echo")"; fi
assert_eq "$(page_status "${JAR_CHAIN}" "${APP}/echo")" "200" "${CHAIN}: the API" || true

log_section "disable-invitees, transitive: both sessions end at once"

RESP=$(host_api_call POST "invitations/disable-invitees" "{\"inviterUserId\":\"${COORD_ID}\",\"transitive\":true}")
assert_eq "$(status_of "$RESP")" "200" "POST /api/invitations/disable-invitees {transitive}: 200" || true
assert_json_field "$(body_of "$RESP")" '.disabled | sort | join(",")' "$(printf '%s\n' "${CHAIN_ID}" "${LEAF_ID}" | sort | paste -sd, -)" "…the coordinator's invitee and theirs" || true
assert_eq "$(page_status "${JAR_LEAF}" "${APP}/echo")" "401" "${LEAF}'s session: 401 at once" || true
assert_eq "$(page_status "${JAR_CHAIN}" "${APP}/echo")" "401" "${CHAIN}'s session: 401 at once" || true
assert_eq "$(page_status "${JAR_COORD}" "${APP}/echo")" "200" "${COORD} is untouched" || true
assert_json_field "$(directory_user "${LEAF_ID}")" '.status' 'disabled' "The directory holds ${LEAF} disabled" || true
assert_eq "$(json_get "$(inv_audit invitation.invitees.disabled)" 'length')" "1" "Audited invitation.invitees.disabled" || true

# ===========================================================================
# 5. A revocation racing an acceptance
# ===========================================================================

log_section "A revocation racing an acceptance: 'marked' never leaves a working link"

MARKED=0
for n in 1 2 3 4 5 6; do
  inv_new TR IR "${JAR_COORD}" "r${n}@${INV_MAIL}" viewer "Race ${n}: an invitation"
  USERNAME="e2e55-race${n}"
  RACED_USERS="${RACED_USERS} ${USERNAME}"
  BODY=$(jq -c -n --arg t "${TR}" --arg u "${USERNAME}" --arg p "${PASSWORD}" '{token: $t, username: $u, displayName: "E2E Race", password: $p}')
  # The acceptance from the visitor, in the background there; the revocation
  # as soon as the row says it is being accepted, read on the host VM.
  visitor_exec "nohup curl -sk --max-time 30 -o /tmp/e2e-55-race.out -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d $(printf %q "${BODY}") https://auth.${DOMAIN_2}/api/invite/accept &>/dev/null & exit" > /dev/null 2>&1 || true
  ANSWER=$(host_exec "for _ in \$(seq 1 200); do s=\$(sqlite3 /etc/lamalibre/lamaste/state.db \"SELECT status FROM invitations WHERE id = '${IR}'\" 2>/dev/null); [ \"\$s\" = accepting ] && break; [ \"\$s\" = accepted ] && break; sleep 0.02; done; ${CURL_MTLS} --max-time 20 -X DELETE -w '\n%{http_code}' '${PANEL}/invitations/${IR}' || true" 2>/dev/null)
  STATUS=$(status_of "$ANSWER")
  ACTION=$(json_get "$(body_of "$ANSWER")" '.action // .code // "none"')
  log_info "Race ${n}: DELETE answered ${STATUS} ${ACTION}"
  sleep 4
  if [ "${STATUS}" = "202" ]; then
    MARKED=$((MARKED + 1))
    if wait_for 75 inv_ended_as "${IR}" revoked admin; then
      log_pass "Race ${n}: marked, and it ended revoked by the administrator"
    else
      log_fail "Race ${n}: marked, and it ended $(inv_row "${IR}" | jq -c '{status, revokedReason}')"
    fi
    assert_eq "$(visit_status "$(inv_lookup "${TR}")")" "410" "…the link stays dead" || true
    UID_RACED=$(json_get "$(inv_row "${IR}")" '.acceptedUserId // empty')
    if [ -n "${UID_RACED}" ]; then
      RACED_IDS="${RACED_IDS} ${UID_RACED}"
      assert_json_field "$(directory_user "${UID_RACED}")" '.status' 'disabled' "…the account it made is disabled" || true
    else
      assert_eq "$(user_kinds "${USERNAME}")" "" "…it made no account" || true
    fi
  else
    # Too late, or too early: the revocation and the acceptance each stand alone.
    UID_RACED=$(json_get "$(inv_row "${IR}")" '.acceptedUserId // empty')
    if [ -n "${UID_RACED}" ]; then RACED_IDS="${RACED_IDS} ${UID_RACED}"; fi
    log_pass "Race ${n}: no mark (${STATUS} ${ACTION}): it ended $(inv_row "${IR}" | jq -r '.status')"
  fi
  if [ "${MARKED}" -ge 2 ]; then break; fi
done
log_info "A revocation landed on an acceptance under way ${MARKED} time(s)"
RESP=$(host_api_call POST "invitations/disable-invitees" "{\"inviterUserId\":\"${COORD_ID}\"}")
assert_eq "$(status_of "$RESP")" "200" "The races' invitees disabled (cleanup of who joined)" || true

log_section "The web surface deleted: what named it ends"

inv_new T11 I11 "${JAR_COORD}" "f1@${INV_MAIL}" viewer "${COORD} invites f1"
RESP=$(host_api_call DELETE "plugins/${PLUGIN}/web-surface")
assert_eq "$(status_of "$RESP")" "200" "The web surface deleted" || true
inv_wait_ended "${I11}" revoked surface_removed "The open invitation is revoked (surface_removed)"
assert_eq "$(visit_status "$(inv_lookup "${T11}")")" "410" "…its link 410" || true

log_section "Audited; nothing restarted Authelia"

assert_eq "$(json_get "$(inv_audit invitation.revoked)" "[.[] | select(.details.invitationId == \"${I1}\")] | length")" "1" "A revocation is audited once" || true
assert_not_contains "$(inv_audit invitation.revoked)" "@${INV_MAIL}" "…with no address" || true
assert_not_contains "$(inv_audit invitation.created)" "@${INV_MAIL}" "invitation.created holds no address" || true
assert_eq "$(authelia_pid)" "${AUTHELIA_PID}" "Authelia's MainPID unchanged" || true

end_test

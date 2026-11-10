#!/usr/bin/env bash
# ============================================================================
# 65 — Native app: sign-ins end with the person's standing (Three-VM)
# ============================================================================
# A native client on a plugin's site (native-apps-design.md D4, D7): the
# site's owner e2e-nat65a declares identity.signInEvents (fixture identity
# variant `signin`), e2e-nat65b joins the site and does not. Four people
# sign in from the visitor VM, each on their own device, and each loses
# their standing a different way:
#
# 1. Sign-in events: e2e-nat65a's agent half receives one event per
#    sign-in — the person's directory id, the time and the native client;
#    e2e-nat65b's never receives the call.
# 2. Disabled (the users API): the grant ends standing:disabled.
# 3. Deleted and erased: the grant ends, and the person's grants are erased
#    with them (none is listed afterwards).
# 4. Removed from the domain (the domains API): the grant ends
#    standing:not_member.
# 5. The last role lost (the Gatekeeper grant behind the entitlement
#    revoked): the grant ends standing:no_role.
#
# After each, the person's access token is refused (401 or 403, as the
# relay decides first) and their refresh token is refused (invalid_grant):
# the relay's broker never refreshes a person without standing, although
# Authelia would (its refresh does not apply the client's policy).
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../e2e/helpers.sh"
# shellcheck source-path=SCRIPTDIR source=app-plugin-harness.sh
source "${SCRIPT_DIR}/app-plugin-harness.sh"

require_commands multipass curl jq node npm tar perl openssl

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

PLUGIN_A="e2e-nat65a"
PLUGIN_B="e2e-nat65b"
SUB_W="e2e65app"
POLICY_ID="e2e-apphost-65"
REMOTE_DIR="/var/tmp/e2e-65-app-plugin"
LOCAL_TMP=""
CLEAN_PLUGINS="${PLUGIN_A} ${PLUGIN_B}"
CLEAN_ROUTES="${PLUGIN_A} ${PLUGIN_B}"
PURGE_PACKAGES=""
SLUG="e2e65app"
CLIENT="lamaste-native-${SLUG}"
# The four people: disabled, erased, removed from the domain, role lost
U_D="e2e65-disabled"
U_E="e2e65-erased"
U_M="e2e65-member"
U_O="e2e65-roleless"
# Test credentials for this run only, never printed
PASSWORD="E2e-$(openssl rand -hex 12)"
FQDN=""
SITE_ID=""
ID_D=""
ID_E=""
ID_M=""
ID_O=""
AT_D=""
RT_D=""
AT_E=""
RT_E=""
AT_M=""
RT_M=""
AT_O=""
RT_O=""

jar_of() { echo "/tmp/e2e-65-$1.cookies"; }
echo_url() { echo "https://${FQDN}/api/${PLUGIN_A}/app/echo"; }

# in_audience <plugin> <userId> — the audience holds the user as an active member
in_audience() {
  [ "$(audience_row "$1" "$2" | jq -r '"\(.change.kind) \(.change.member.status)"' 2>/dev/null)" = "upsert active" ]
}

# events_of <plugin> <userId> — the sign-in events its agent half holds for the user, as "<clientId>"s
events_of() {
  sign_ins_of "$1" | jq -r --arg u "$2" '[.[] | select(.userId == $u) | .client.clientId] | join(",")' 2>/dev/null || echo "?"
}
# all_signed_in — e2e-nat65a's half holds an event for each of the four
all_signed_in() {
  local id
  for id in "${ID_D}" "${ID_E}" "${ID_M}" "${ID_O}"; do
    [ "$(events_of "${PLUGIN_A}" "$id")" = "${CLIENT}" ] || return 1
  done
}

# grant_reason_of <userId> — why the user's grant ended ("live", "none" when it has no grant)
grant_reason_of() {
  native_grants "${CLIENT}" all | jq -r --arg u "$1" '[.[] | select(.userId == $u)] | if length == 0 then "none" elif .[0].revokedAt == null then "live" else .[0].revokedReason end' 2>/dev/null || echo "?"
}
grant_ended_as() { [ "$(grant_reason_of "$1")" = "$2" ]; }

# assert_cut_off <who> <access token> <refresh token> — both refused now
assert_cut_off() {
  if bearer_refused "$2" "$(echo_url)"; then
    log_pass "…${1}'s access token is refused ($(bearer_status "$2" - "$(echo_url)"))"
  else
    log_fail "${1}'s access token: $(bearer_status "$2" - "$(echo_url)")"
  fi
  native_refresh "${CLIENT}" "$3"
  assert_eq "$(native_status) $(native_field '.error')" "400 invalid_grant" "…${1}'s refresh token: 400 invalid_grant" || true
}

begin_test "65 — Native app: sign-ins end with the person's standing (Three-VM)"

cleanup() {
  log_info "Cleaning up test resources..."
  local u
  native_cleanup "${CLIENT}"
  drop_plugin_grants "${PLUGIN_A}"
  drop_plugin_grants "${PLUGIN_B}"
  timed_exec 60 multipass exec "${VISITOR_VM}" -- sudo bash -c "rm -f /tmp/e2e-65-*.cookies /tmp/e2e-native-nobody.cookies; sed -i '/${SUB_W}\\./d' /etc/hosts; true" > /dev/null 2>&1
  for u in "${U_D}" "${U_E}" "${U_M}" "${U_O}"; do host_api_delete "users/${u}?erase=true" > /dev/null 2>&1 || true; done
  nudge_sync
  app_plugin_cleanup
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
log_section "Pre-flight"
# ---------------------------------------------------------------------------

app_plugin_preflight
FQDN="${SUB_W}.${DOMAIN}"
log_info "Hosting agent: ${HOST_AGENT_LABEL}, relay domain ${DOMAIN}, site ${FQDN}"
if agent_has_node_sqlite && visitor_has_oathtool; then
  log_pass "The agent VM's Node.js has node:sqlite and the visitor VM has oathtool"
else
  log_fail "The agent VM needs Node.js with node:sqlite and the visitor VM oathtool"
  end_test
  exit $?
fi
native_cleanup "${CLIENT}"
host_api_delete "plugins/${PLUGIN_A}/web-surface" > /dev/null 2>&1 || true
drop_plugin_grants "${PLUGIN_A}"
drop_plugin_grants "${PLUGIN_B}"
for u in "${U_D}" "${U_E}" "${U_M}" "${U_O}"; do host_api_delete "users/${u}?erase=true" > /dev/null 2>&1 || true; done
AUDIT_BASE=$(host_api_get "audit?limit=1" | jq '.entries[0].id // 0' 2>/dev/null || echo "0")

# ===========================================================================
# Setup: two plugins on one site, a native client, four people
# ===========================================================================

log_section "Two plugins on one site, a native client, four people signed in"

LOCAL_TMP=$(mktemp -d /tmp/e2e-65-app-plugin-XXXXXXXX)
FIXTURES="built"
write_app_install_fixture "${LOCAL_TMP}/ship/fixtures/a" "${PLUGIN_A}" 1.0.0 main "r$(date +%s)-$$" '[]' none signin v1 "${SUB_W}" || FIXTURES="failed"
write_app_install_fixture "${LOCAL_TMP}/ship/fixtures/b" "${PLUGIN_B}" 1.0.0 main "r$(date +%s)-$$" '[]' none wide || FIXTURES="failed"
if [ "$FIXTURES" != "built" ]; then
  log_fail "The fixtures could not be built (npm install at the workspace root, npm run build -w packages/core/lib)"
  end_test
  exit $?
fi
log_pass "Fixtures built: ${PLUGIN_A} (signInEvents, a web tree), ${PLUGIN_B}"
ship_agent_facts_probe
start_stand_in_feria fixtures/a/server fixtures/a/agent fixtures/b/server fixtures/b/agent
ensure_app_host_helper
open_push_install "${POLICY_ID}" "[\"@lamalibre/${PLUGIN_A}-agent\",\"@lamalibre/${PLUGIN_B}-agent\"]" '["install","uninstall"]'

for u in "${U_D}" "${U_E}" "${U_M}" "${U_O}"; do
  RESP=$(users_call POST "users" "{\"username\":\"${u}\",\"displayname\":\"E2E ${u}\",\"email\":\"${u}@example.test\",\"password\":\"${PASSWORD}\",\"groups\":[]}")
  assert_eq "$(status_of "$RESP")" "201" "User ${u} created" || true
  case "$u" in
    "${U_D}") ID_D=$(json_get "$(body_of "$RESP")" '.user.userId // empty') ;;
    "${U_E}") ID_E=$(json_get "$(body_of "$RESP")" '.user.userId // empty') ;;
    "${U_M}") ID_M=$(json_get "$(body_of "$RESP")" '.user.userId // empty') ;;
    "${U_O}") ID_O=$(json_get "$(body_of "$RESP")" '.user.userId // empty') ;;
  esac
done

INSTALL=$(install_approved "${PLUGIN_A}" "@lamalibre/${PLUGIN_A}-server@1.0.0")
assert_json_field "$INSTALL" '.plugin.version' '1.0.0' "Installed and approved: ${PLUGIN_A}" || true
assert_json_field "$(host_api_get "plugins/${PLUGIN_A}/hooks")" '"\(.hooks.identity.approved) \(.hooks.identity.block.signInEvents)"' 'true true' "…its approved identity block declares signInEvents" || true
INSTALL=$(install_approved "${PLUGIN_B}" "@lamalibre/${PLUGIN_B}-server@1.0.0")
assert_json_field "$INSTALL" '.plugin.version' '1.0.0' "Installed and approved: ${PLUGIN_B}" || true
assert_json_field "$(host_api_get "plugins/${PLUGIN_B}/hooks")" '"\(.hooks.identity.approved) \(.hooks.identity.block.signInEvents // false)"' 'true false' "…its identity block does not" || true
RESP=$(host_api_call POST "plugins/${PLUGIN_A}/web-surface" '{"accessMode":"authenticated"}')
assert_eq "$(status_of "$RESP")" "201" "${PLUGIN_A}'s web surface created on ${FQDN}" || true
SITE_ID=$(json_get "$(body_of "$RESP")" '.webSurface.site.id // empty')
for plugin in "${PLUGIN_A}" "${PLUGIN_B}"; do
  OP=$(host_plugin "${plugin}" 300 nudge)
  assert_json_field "$OP" '.status' 'succeeded' "${plugin} hosted ($(json_get "$OP" '.error // .refused.error // ""'))" || true
done
if wait_for 120 identity_ready "${PLUGIN_A}" && wait_for 120 identity_ready "${PLUGIN_B}" && wait_for 120 web_served "${PLUGIN_A}"; then
  log_pass "Both ready, the site served"
else
  log_fail "Not ready: $(identity_view "${PLUGIN_A}" | jq -c '.readiness') $(identity_view "${PLUGIN_B}" | jq -c '.readiness')"
fi
RESP=$(host_api_call PUT "plugins/${PLUGIN_A}/web-surface/routes/${PLUGIN_B}")
assert_eq "$(status_of "$RESP")" "200" "${PLUGIN_B} joins the site" || true
RESP=$(host_api_call POST "native-apps" "{\"slug\":\"${SLUG}\",\"hostKind\":\"site\",\"hostId\":\"${SITE_ID}\",\"name\":\"E2E Standing\",\"redirectPaths\":[\"${NATIVE_REDIRECT_PATH}\"]}")
assert_eq "$(status_of "$RESP")" "201" "Native client ${CLIENT} registered for the site" || true

for u in "${U_D}" "${U_E}" "${U_M}"; do
  for plugin in "${PLUGIN_A}" "${PLUGIN_B}"; do
    host_api_call PUT "plugins/${plugin}/entitlements" "{\"principalType\":\"user\",\"principalId\":\"${u}\",\"roles\":[\"viewer\"]}" > /dev/null
  done
done
RESP=$(host_api_call PUT "plugins/${PLUGIN_A}/entitlements" "{\"principalType\":\"user\",\"principalId\":\"${U_O}\",\"roles\":[\"viewer\"]}")
assert_eq "$(status_of "$RESP")" "200" "${U_D}, ${U_E} and ${U_M} entitled on both plugins; ${U_O} on ${PLUGIN_A} alone" || true
visitor_exec "grep -q ' ${FQDN}\$' /etc/hosts || echo '${HOST_IP} ${FQDN}' >> /etc/hosts" > /dev/null 2>&1 || true
if wait_for 120 native_client_known "${CLIENT}" "${FQDN}" && wait_for 30 in_audience "${PLUGIN_A}" "${ID_O}" && wait_for 30 in_audience "${PLUGIN_B}" "${ID_M}"; then
  log_pass "Authelia knows the client; the audiences hold the people"
else
  log_fail "Not ready to sign in: $(audience_row "${PLUGIN_A}" "${ID_O}")"
fi

SECRET_D=$(reset_totp "${U_D}")
SECRET_E=$(reset_totp "${U_E}")
SECRET_M=$(reset_totp "${U_M}")
SECRET_O=$(reset_totp "${U_O}")
wait_for_next_totp_window
assert_eq "$(sign_in "${U_D}" "${PASSWORD}" "${SECRET_D}" "$(jar_of d)" "${FQDN}") $(sign_in "${U_E}" "${PASSWORD}" "${SECRET_E}" "$(jar_of e)" "${FQDN}") $(sign_in "${U_M}" "${PASSWORD}" "${SECRET_M}" "$(jar_of m)" "${FQDN}") $(sign_in "${U_O}" "${PASSWORD}" "${SECRET_O}" "$(jar_of o)" "${FQDN}")" "OK OK OK OK OK OK OK OK" "The four signed in to Authelia from the visitor VM" || true

native_sign_in "$(jar_of d)" "${CLIENT}" "${FQDN}" "E2E D"
AT_D="${NATIVE_AT}"
RT_D="${NATIVE_RT}"
native_sign_in "$(jar_of e)" "${CLIENT}" "${FQDN}" "E2E E"
AT_E="${NATIVE_AT}"
RT_E="${NATIVE_RT}"
native_sign_in "$(jar_of m)" "${CLIENT}" "${FQDN}" "E2E M"
AT_M="${NATIVE_AT}"
RT_M="${NATIVE_RT}"
native_sign_in "$(jar_of o)" "${CLIENT}" "${FQDN}" "E2E O"
AT_O="${NATIVE_AT}"
RT_O="${NATIVE_RT}"
assert_eq "$(bearer_status "${AT_D}" - "$(echo_url)") $(bearer_status "${AT_E}" - "$(echo_url)") $(bearer_status "${AT_M}" - "$(echo_url)") $(bearer_status "${AT_O}" - "$(echo_url)")" "200 200 200 200" "Each signed in on their device; each reaches ${PLUGIN_A}" || true
assert_eq "$(native_grants "${CLIENT}" live | jq length)" "4" "Four live grants" || true

# ===========================================================================
# 1. Sign-in events
# ===========================================================================

log_section "Sign-in events reach the plugin that declares them, and only it"

if wait_for 90 all_signed_in; then
  log_pass "${PLUGIN_A}'s agent half holds one sign-in event per person, naming ${CLIENT}"
else
  log_fail "${PLUGIN_A}'s sign-in events: $(sign_ins_of "${PLUGIN_A}" | jq -c '[.[] | {userId, client}]')"
fi
assert_eq "$(sign_ins_of "${PLUGIN_A}" | jq -r '[.[] | select((.at | test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T")) and (.seq > 0) and (.client.kind == "native"))] | length')" "4" "…each with its time, a sequence number and the client's kind" || true
assert_eq "$(sign_ins_of "${PLUGIN_B}" | jq length)" "0" "${PLUGIN_B} declares none: its agent half holds no event" || true
assert_eq "$(half_requests "${PLUGIN_B}" ' POST /admin/identity/sign-ins$')" "0" "…and never received the call" || true

# ===========================================================================
# 2–5. Each person's standing ends; so does their grant
# ===========================================================================

log_section "Disabled, erased, removed from the domain, role lost"

RESP=$(users_call PUT "users/${U_D}" '{"disabled":true}')
assert_eq "$(status_of "$RESP")" "200" "${U_D} disabled" || true
RESP=$(users_call DELETE "users/${U_E}?erase=true")
assert_eq "$(status_of "$RESP") $(json_get "$(body_of "$RESP")" 'if .erased then "erased" else "kept" end')" "200 erased" "${U_E} deleted and erased" || true
RESP=$(host_api_call DELETE "domains/${DOMAIN}/members/${U_M}")
assert_eq "$(status_of "$RESP") $(json_get "$(body_of "$RESP")" '.removed')" "200 true" "${U_M} removed from ${DOMAIN}'s members" || true
GRANT_O=$(host_api_get "gatekeeper/grants?resourceType=plugin&resourceId=${PLUGIN_A}" | jq -r --arg u "${U_O}" '[.grants[]? | select(.principalType == "user" and .principalId == $u) | .grantId] | first // empty' 2>/dev/null || true)
RESP=$(host_api_call DELETE "gatekeeper/grants/${GRANT_O:-none}")
assert_eq "$(status_of "$RESP")" "200" "${U_O}'s only entitlement (its Gatekeeper grant) revoked" || true

if wait_for 30 grant_ended_as "${ID_D}" "standing:disabled"; then
  log_pass "${U_D}'s grant ended: standing:disabled"
else
  log_fail "${U_D}'s grant: $(grant_reason_of "${ID_D}")"
fi
assert_cut_off "${U_D}" "${AT_D}" "${RT_D}"

assert_eq "$(grant_reason_of "${ID_E}")" "none" "${U_E}'s grant is gone with them: erased, nothing listed" || true
assert_cut_off "${U_E}" "${AT_E}" "${RT_E}"

if wait_for 90 grant_ended_as "${ID_M}" "standing:not_member"; then
  log_pass "${U_M}'s grant ended: standing:not_member"
else
  log_fail "${U_M}'s grant: $(grant_reason_of "${ID_M}")"
fi
assert_cut_off "${U_M}" "${AT_M}" "${RT_M}"

if wait_for 90 grant_ended_as "${ID_O}" "standing:no_role"; then
  log_pass "${U_O}'s grant ended: standing:no_role"
else
  log_fail "${U_O}'s grant: $(grant_reason_of "${ID_O}")"
fi
assert_cut_off "${U_O}" "${AT_O}" "${RT_O}"

assert_eq "$(native_grants "${CLIENT}" live | jq length)" "0" "No live grant is left" || true
REASONS=$(host_api_get "audit?action=native-app.grant.revoked&limit=200" | jq -r --arg c "${CLIENT}" "[.entries[]? | select(.id > ${AUDIT_BASE}) | .details | select(any(.grants[]?; .clientId == \$c)) | .reason] | unique | join(\",\")" 2>/dev/null || echo "?")
assert_eq "${REASONS}" "standing:disabled,standing:no_role,standing:not_member,standing:removed" "Audited: native-app.grant.revoked — disabled, no_role, not_member, removed (the erased person's grant ended at the removal)" || true

end_test

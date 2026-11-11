#!/usr/bin/env bash
# ============================================================================
# 64 — Native app: refresh tokens and grants (Three-VM)
# ============================================================================
# The relay's token broker in front of Authelia (native-apps-design.md D4,
# R7–R10): a native client on a plugin's site (e2e-nat64, identity wide, a
# web surface), one person, several sign-ins — each a grant named by its
# device. From the visitor VM:
#
# 1. Rotation: a refresh answers a new refresh token and a new access
#    token, which the user surface admits.
# 2. The grace window (R8): the spent token presented again within 30 s
#    gets the very same answer (a lost response retried), the grant stays.
# 3. Reuse: a spent token presented after its window ends the grant — its
#    live access tokens are refused at once, its current refresh token is
#    refused — audited native-app.grant.reuse-detected, admins notified.
# 4. The app signs out (RFC 7009 revocation): its grant ends
#    (revoked_by_client), its access token is refused.
# 5. Grants per device: listed through the API and the CLI
#    (`native-apps grants`, `users native-grants`); one ended by the CLI
#    (`native-apps revoke --grant`) and one by the API (DELETE) —
#    revoked_by_admin, refused at once.
# 6. Lifetimes: a grant past its absolute lifetime, and one idle longer
#    than the client's idle lifetime — each made so by moving the grant's
#    own timestamps in the panel's state.db (as its database owner, on the
#    host VM: the relay's clock is never touched, and a day cannot be
#    waited) — has its access token refused (R10) and its refresh refused,
#    ended absolute_expired and idle_expired.
# 7. The client disabled: its live grant ends (client_disabled), Authelia
#    no longer knows it; enabled again, it signs people in again.
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

PLUGIN="e2e-nat64"
SUB_W="e2e64app"
POLICY_ID="e2e-apphost-64"
REMOTE_DIR="/var/tmp/e2e-64-app-plugin"
LOCAL_TMP=""
CLEAN_PLUGINS="${PLUGIN}"
CLEAN_ROUTES="${PLUGIN}"
PURGE_PACKAGES=""
# A username that reached an OIDC client is never given out again: per run.
USER_TAG="$(date +%s)"
USER_TAG="${USER_TAG: -6}"
PERSON="e2e64-person-${USER_TAG}"
# A test credential for this run only, never printed
PERSON_PASSWORD="E2e-$(openssl rand -hex 12)"
JAR="/tmp/e2e-64-person.cookies"
SLUG="e2e64app"
CLIENT="lamaste-native-${SLUG}"
STATE_DB="/etc/lamalibre/lamaste/state.db"
FQDN=""
SITE_ID=""
PERSON_ID=""

# echo_status <token> — the status of GET /api/<plugin>/app/echo with the bearer
echo_status() { bearer_status "$1" - "https://${FQDN}/api/${PLUGIN}/app/echo"; }
# echo_refused <token> — 401 invalid_token, the relay's answer to a token no grant holds
echo_refused() {
  local out
  out=$(bearer "$1" - "https://${FQDN}/api/${PLUGIN}/app/echo")
  [ "$(visit_status "$out") $(visit_body "$out" | jq -r '.error' 2>/dev/null)" = "401 invalid_token" ]
}

# in_audience <userId> — the audience holds the user as an active member
in_audience() {
  [ "$(audience_row "${PLUGIN}" "$1" | jq -r '"\(.change.kind) \(.change.member.status)"' 2>/dev/null)" = "upsert active" ]
}

# cli <arguments> — lamaste-server on the host VM with --json; its last line
cli() {
  timed_exec 90 multipass exec "${HOST_VM}" -- sudo bash -c "lamaste-server $* --json 2>&1" 2>/dev/null | tail -n 1
}

# write_grant_clock <file> — grant-clock.mjs: moves one grant's own
# timestamps in the panel's state.db, as the database's owner — past its
# absolute lifetime (`absolute`), or idle one minute longer than its
# client's idle lifetime (`idle`). Prints {"changes": n}.
#
#   node grant-clock.mjs <state.db> <grantId> <absolute | idle>
write_grant_clock() {
  cat > "$1" <<'CLOCK_EOF'
import { DatabaseSync } from 'node:sqlite';

const [file, grantId, what] = process.argv.slice(2);
const db = new DatabaseSync(file);
db.exec('PRAGMA busy_timeout = 10000');
const now = Date.now();
let changes = 0;
if (what === 'absolute') {
  changes = db
    .prepare('UPDATE native_grants SET absolute_expires_at = ? WHERE grant_id = ? AND revoked_at IS NULL')
    .run(now - 60_000, grantId).changes;
} else if (what === 'idle') {
  const row = db
    .prepare('SELECT c.idle_days AS idleDays FROM native_grants g JOIN native_clients c ON c.client_id = g.client_id WHERE g.grant_id = ?')
    .get(grantId);
  if (row) {
    changes = db
      .prepare('UPDATE native_grants SET last_used_at = ? WHERE grant_id = ? AND revoked_at IS NULL')
      .run(now - row.idleDays * 86_400_000 - 60_000, grantId).changes;
  }
}
db.close();
process.stdout.write(`${JSON.stringify({ changes: Number(changes) })}\n`);
CLOCK_EOF
}

# grant_clock <grantId> <absolute | idle> — run it on the host VM; prints its changes count
grant_clock() {
  host_exec "runuser -u lamaste -- node ${REMOTE_DIR}/grant-clock.mjs ${STATE_DB} $1 $2 2>/dev/null" 2>/dev/null | grep -E '^\{' | tail -n 1 | jq -r '.changes' 2>/dev/null || echo "-1"
}

# grant_id_of <device> — the id of that device's grant ("" when none)
grant_id_of() { native_grant_of "${CLIENT}" "$1" | jq -r '.grantId // empty' 2>/dev/null || true; }

begin_test "64 — Native app: refresh tokens and grants (Three-VM)"

cleanup() {
  log_info "Cleaning up test resources..."
  native_cleanup "${CLIENT}"
  drop_plugin_grants "${PLUGIN}"
  timed_exec 60 multipass exec "${VISITOR_VM}" -- sudo bash -c "rm -f ${JAR} /tmp/e2e-native-nobody.cookies; sed -i '/${SUB_W}\\./d' /etc/hosts; true" > /dev/null 2>&1
  host_api_delete "users/${PERSON}?erase=true" > /dev/null 2>&1 || true
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
host_api_delete "plugins/${PLUGIN}/web-surface" > /dev/null 2>&1 || true
drop_plugin_grants "${PLUGIN}"
host_api_delete "users/${PERSON}?erase=true" > /dev/null 2>&1 || true
AUDIT_BASE=$(host_api_get "audit?limit=1" | jq '.entries[0].id // 0' 2>/dev/null || echo "0")

# ===========================================================================
# Setup: the plugin's site, a native client, a person signed in
# ===========================================================================

log_section "The plugin's site, a native client, a person signed in to Authelia"

LOCAL_TMP=$(mktemp -d /tmp/e2e-64-app-plugin-XXXXXXXX)
if ! write_app_install_fixture "${LOCAL_TMP}/ship/fixtures/v1" "${PLUGIN}" 1.0.0 main "r$(date +%s)-$$" '[]' none wide v1 "${SUB_W}"; then
  log_fail "The fixtures could not be built (npm install at the workspace root, npm run build -w packages/core/lib)"
  end_test
  exit $?
fi
ship_agent_facts_probe
# Shipped with the fixtures: the tarball's own root entry gives the unpacked
# directory this machine's owner, so nothing can be transferred into it later.
write_grant_clock "${LOCAL_TMP}/ship/grant-clock.mjs"
start_stand_in_feria fixtures/v1/server fixtures/v1/agent
ensure_app_host_helper
open_push_install "${POLICY_ID}" "[\"@lamalibre/${PLUGIN}-agent\"]" '["install","uninstall"]'

RESP=$(users_call POST "users" "{\"username\":\"${PERSON}\",\"displayname\":\"E2E Person\",\"email\":\"${PERSON}@example.test\",\"password\":\"${PERSON_PASSWORD}\",\"groups\":[]}")
assert_eq "$(status_of "$RESP")" "201" "User ${PERSON} created" || true
PERSON_ID=$(json_get "$(body_of "$RESP")" '.user.userId // empty')
INSTALL=$(install_approved "${PLUGIN}" "@lamalibre/${PLUGIN}-server@1.0.0")
assert_json_field "$INSTALL" '.plugin.version' '1.0.0' "Installed and approved: ${PLUGIN}" || true
RESP=$(host_api_call POST "plugins/${PLUGIN}/web-surface" '{"accessMode":"authenticated"}')
assert_eq "$(status_of "$RESP")" "201" "Its web surface created on ${FQDN}" || true
SITE_ID=$(json_get "$(body_of "$RESP")" '.webSurface.site.id // empty')
OP=$(host_plugin "${PLUGIN}" 300 nudge)
assert_json_field "$OP" '.status' 'succeeded' "Hosted on ${HOST_AGENT_LABEL} ($(json_get "$OP" '.error // .refused.error // ""'))" || true
if wait_for 120 identity_ready "${PLUGIN}" && wait_for 120 web_served "${PLUGIN}"; then
  log_pass "Ready and served"
else
  log_fail "Not ready or not served: $(identity_view "${PLUGIN}" | jq -c '.readiness') $(web_surface "${PLUGIN}" | jq -c '{served, reason}')"
fi
RESP=$(host_api_call POST "native-apps" "{\"slug\":\"${SLUG}\",\"hostKind\":\"site\",\"hostId\":\"${SITE_ID}\",\"name\":\"E2E Refresh\",\"redirectPaths\":[\"${NATIVE_REDIRECT_PATH}\"]}")
assert_eq "$(status_of "$RESP")" "201" "Native client ${CLIENT} registered for the site" || true
RESP=$(host_api_call PUT "plugins/${PLUGIN}/entitlements" "{\"principalType\":\"user\",\"principalId\":\"${PERSON}\",\"roles\":[\"viewer\"]}")
assert_eq "$(status_of "$RESP")" "200" "${PERSON} entitled as viewer" || true
visitor_exec "grep -q ' ${FQDN}\$' /etc/hosts || echo '${HOST_IP} ${FQDN}' >> /etc/hosts" > /dev/null 2>&1 || true
if wait_for 120 native_client_known "${CLIENT}" "${FQDN}" && wait_for 30 in_audience "${PERSON_ID}"; then
  log_pass "Authelia knows the client; ${PERSON} is in the audience"
else
  log_fail "The client or the audience is not ready: $(audience_row "${PLUGIN}" "${PERSON_ID}")"
fi
SECRET=$(reset_totp "${PERSON}")
wait_for_next_totp_window
assert_eq "$(sign_in "${PERSON}" "${PERSON_PASSWORD}" "${SECRET}" "${JAR}" "${FQDN}")" "OK OK" "${PERSON} signed in to Authelia from the visitor VM" || true

# ===========================================================================
# 1–3. Rotation, the grace window, reuse
# ===========================================================================

log_section "Rotation, the grace window, and a spent token reused"

native_sign_in "${JAR}" "${CLIENT}" "${FQDN}" "E2E Phone"
assert_eq "${NATIVE_SIGN_IN}" "ok" "Signed in on \"E2E Phone\"" || true
AT0="${NATIVE_AT}"
RT0="${NATIVE_RT}"
assert_eq "$(echo_status "${AT0}")" "200" "Its access token reaches the plugin" || true

native_refresh "${CLIENT}" "${RT0}"
assert_eq "$(native_status)" "200" "Refreshed: 200" || true
AT1=$(native_field '.access_token // empty')
RT1=$(native_field '.refresh_token // empty')
assert_eq "$([ -n "${RT1}" ] && [ "${RT1}" != "${RT0}" ] && [ -n "${AT1}" ] && [ "${AT1}" != "${AT0}" ] && echo rotated || echo same)" "rotated" "…a new refresh token and a new access token" || true
assert_eq "$(echo_status "${AT1}")" "200" "…the new access token reaches the plugin" || true

native_refresh "${CLIENT}" "${RT0}"
assert_eq "$(native_status)" "200" "The spent token again, within 30 s (a lost answer retried): 200" || true
assert_eq "$([ "$(native_field '.refresh_token // empty')" = "${RT1}" ] && [ "$(native_field '.access_token // empty')" = "${AT1}" ] && echo same || echo different)" "same" "…the very same answer, replayed" || true
assert_eq "$(native_grant_reason "${CLIENT}" "E2E Phone")" "live" "…the grant stays live" || true

native_refresh "${CLIENT}" "${RT1}"
assert_eq "$(native_status)" "200" "Refreshed again" || true
AT2=$(native_field '.access_token // empty')
RT2=$(native_field '.refresh_token // empty')
SPENT_AT=${SECONDS}
log_info "Waiting out the grace window of the token just spent (30 s)..."
sleep $((32 - (SECONDS - SPENT_AT)))
native_refresh "${CLIENT}" "${RT1}"
assert_eq "$(native_status) $(native_field '.error')" "400 invalid_grant" "The spent token after its window: 400 invalid_grant" || true
if wait_for 15 native_grant_ended_as "${CLIENT}" "E2E Phone" reuse; then
  log_pass "…the grant ended: reuse"
else
  log_fail "The grant: $(native_grant_of "${CLIENT}" "E2E Phone")"
fi
assert_eq "$(echo_refused "${AT2}" && echo refused || echo admitted)" "refused" "Its live access token is refused at once: 401 invalid_token" || true
assert_eq "$(echo_refused "${AT1}" && echo refused || echo admitted)" "refused" "…and the one before it" || true
native_refresh "${CLIENT}" "${RT2}"
assert_eq "$(native_status) $(native_field '.error')" "400 invalid_grant" "Its current refresh token: 400 invalid_grant" || true
assert_eq "$(native_audits native-app.grant.reuse-detected ".clientId == \"${CLIENT}\" and .userId == \"${PERSON_ID}\"")" "1" "Audited once: native-app.grant.reuse-detected" || true
assert_eq "$(host_api_get "notifications?limit=50" | jq --arg c "${CLIENT}" '[.notifications[]? | select(.message | contains($c))] | length >= 1' 2>/dev/null || echo false)" "true" "Admins notified of the reuse" || true

# ===========================================================================
# 4. The app signs out
# ===========================================================================

log_section "The app signs out (token revocation)"

native_sign_in "${JAR}" "${CLIENT}" "${FQDN}" "E2E Tablet"
assert_eq "${NATIVE_SIGN_IN}" "ok" "Signed in on \"E2E Tablet\"" || true
AT_TABLET="${NATIVE_AT}"
native_post /api/oidc/revocation "token=${NATIVE_RT}" "token_type_hint=refresh_token" "client_id=${CLIENT}"
assert_eq "$(native_status)" "200" "POST /api/oidc/revocation with its refresh token: 200" || true
if wait_for 15 native_grant_ended_as "${CLIENT}" "E2E Tablet" revoked_by_client; then
  log_pass "…the grant ended: revoked_by_client"
else
  log_fail "The grant: $(native_grant_of "${CLIENT}" "E2E Tablet")"
fi
assert_eq "$(echo_refused "${AT_TABLET}" && echo refused || echo admitted)" "refused" "…its access token is refused at once" || true

# ===========================================================================
# 5. Grants per device: listed, ended by the administrator
# ===========================================================================

log_section "Grants per device: listed and ended by the administrator"

native_sign_in "${JAR}" "${CLIENT}" "${FQDN}" "E2E Watch"
AT_WATCH="${NATIVE_AT}"
RT_WATCH="${NATIVE_RT}"
native_sign_in "${JAR}" "${CLIENT}" "${FQDN}" "E2E Laptop"
AT_LAPTOP="${NATIVE_AT}"
RT_LAPTOP="${NATIVE_RT}"
assert_eq "$(native_grants "${CLIENT}" live | jq -r '[.[].deviceName] | sort | join(",")')" "E2E Laptop,E2E Watch" "GET …/grants?status=live: \"E2E Laptop\" and \"E2E Watch\"" || true
assert_eq "$(native_grants "${CLIENT}" ended | jq -r '[.[] | "\(.deviceName)=\(.endedReason)"] | sort | join(",")')" "E2E Phone=reuse,E2E Tablet=revoked_by_client" "…status=ended: the phone (reuse) and the tablet (signed out)" || true
assert_eq "$(native_grants "${CLIENT}" live | jq -r '[.[] | select(.userAgent != null and (.userAgent | length) > 0)] | length')" "2" "…each with a summary of its user agent" || true
OUT=$(cli native-apps grants "${CLIENT}" --status all)
assert_json_field "$OUT" '[.grants[].deviceName] | sort | join(",")' "E2E Laptop,E2E Phone,E2E Tablet,E2E Watch" "lamaste-server native-apps grants ${CLIENT} --status all --json: the four devices" || true
OUT=$(cli users native-grants "${PERSON}")
assert_json_field "$OUT" '[.grants[] | select(.clientId == "'"${CLIENT}"'") | .deviceName] | sort | join(",")' "E2E Laptop,E2E Watch" "lamaste-server users native-grants ${PERSON} --json: the person's live devices" || true

OUT=$(cli native-apps revoke "${CLIENT}" --grant "$(grant_id_of "E2E Watch")")
assert_json_field "$OUT" '"\(.event) \(.ended)"' "complete 1" "lamaste-server native-apps revoke --grant: one grant ended" || true
assert_eq "$(native_grant_reason "${CLIENT}" "E2E Watch")" "revoked_by_admin" "…revoked_by_admin" || true
assert_eq "$(echo_refused "${AT_WATCH}" && echo refused || echo admitted)" "refused" "…its access token refused at once" || true
native_refresh "${CLIENT}" "${RT_WATCH}"
assert_eq "$(native_status) $(native_field '.error')" "400 invalid_grant" "…its refresh token refused" || true

RESP=$(host_api_call DELETE "native-apps/${CLIENT}/grants/$(grant_id_of "E2E Laptop")")
assert_eq "$(status_of "$RESP") $(json_get "$(body_of "$RESP")" '.ended')" "200 1" "DELETE /api/native-apps/${CLIENT}/grants/<id>: one grant ended" || true
assert_eq "$(native_grant_reason "${CLIENT}" "E2E Laptop")" "revoked_by_admin" "…revoked_by_admin" || true
assert_eq "$(echo_refused "${AT_LAPTOP}" && echo refused || echo admitted)" "refused" "…its access token refused at once" || true
native_refresh "${CLIENT}" "${RT_LAPTOP}"
assert_eq "$(native_status) $(native_field '.error')" "400 invalid_grant" "…its refresh token refused" || true
assert_eq "$(native_audits native-app.grant.revoked '.reason == "revoked_by_admin"')" "2" "Audited: native-app.grant.revoked, revoked_by_admin, twice" || true

# ===========================================================================
# 6. Lifetimes
# ===========================================================================

log_section "Lifetimes: absolute and idle"

native_sign_in "${JAR}" "${CLIENT}" "${FQDN}" "E2E Desk"
AT_DESK="${NATIVE_AT}"
RT_DESK="${NATIVE_RT}"
native_sign_in "${JAR}" "${CLIENT}" "${FQDN}" "E2E Car"
AT_CAR="${NATIVE_AT}"
RT_CAR="${NATIVE_RT}"
assert_eq "$(echo_status "${AT_DESK}") $(echo_status "${AT_CAR}")" "200 200" "Two more devices signed in, both reaching the plugin" || true

assert_eq "$(grant_clock "$(grant_id_of "E2E Desk")" absolute)" "1" "\"E2E Desk\"'s grant moved past its absolute lifetime (its row in state.db, as the database's owner)" || true
assert_eq "$(echo_refused "${AT_DESK}" && echo refused || echo admitted)" "refused" "…its access token is refused at once, unexpired as it is" || true
native_refresh "${CLIENT}" "${RT_DESK}"
assert_eq "$(native_status) $(native_field '.error')" "400 invalid_grant" "…its refresh: 400 invalid_grant" || true
if wait_for 15 native_grant_ended_as "${CLIENT}" "E2E Desk" absolute_expired; then
  log_pass "…ended: absolute_expired"
else
  log_fail "The grant: $(native_grant_of "${CLIENT}" "E2E Desk")"
fi

assert_eq "$(grant_clock "$(grant_id_of "E2E Car")" idle)" "1" "\"E2E Car\"'s grant made idle a minute longer than the client's 30 days" || true
assert_eq "$(echo_refused "${AT_CAR}" && echo refused || echo admitted)" "refused" "…its access token is refused at once" || true
native_refresh "${CLIENT}" "${RT_CAR}"
assert_eq "$(native_status) $(native_field '.error')" "400 invalid_grant" "…its refresh: 400 invalid_grant" || true
if wait_for 15 native_grant_ended_as "${CLIENT}" "E2E Car" idle_expired; then
  log_pass "…ended: idle_expired"
else
  log_fail "The grant: $(native_grant_of "${CLIENT}" "E2E Car")"
fi

# ===========================================================================
# 7. The client disabled and enabled again
# ===========================================================================

log_section "The client disabled, then enabled again"

native_sign_in "${JAR}" "${CLIENT}" "${FQDN}" "E2E Kiosk"
AT_KIOSK="${NATIVE_AT}"
RT_KIOSK="${NATIVE_RT}"
RESP=$(host_api_call PATCH "native-apps/${CLIENT}" '{"enabled":false}')
assert_eq "$(status_of "$RESP")" "200" "PATCH /api/native-apps/${CLIENT} {enabled: false}" || true
if wait_for 15 native_grant_ended_as "${CLIENT}" "E2E Kiosk" client_disabled; then
  log_pass "…its live grant ended: client_disabled"
else
  log_fail "The grant: $(native_grant_of "${CLIENT}" "E2E Kiosk")"
fi
assert_eq "$(echo_refused "${AT_KIOSK}" && echo refused || echo admitted)" "refused" "…its access token refused" || true
native_refresh "${CLIENT}" "${RT_KIOSK}"
assert_eq "$(native_status) $(native_field '.error')" "400 invalid_grant" "…its refresh refused" || true
if wait_for 120 native_client_gone "${CLIENT}" "${FQDN}"; then
  log_pass "Authelia no longer knows the client: nobody signs in with it"
else
  log_fail "Authelia still knows the disabled client"
fi
RESP=$(host_api_call PATCH "native-apps/${CLIENT}" '{"enabled":true}')
assert_eq "$(status_of "$RESP")" "200" "Enabled again" || true
if wait_for 120 native_client_known "${CLIENT}" "${FQDN}"; then
  # Disabling and enabling a client restarts Authelia, whose sessions live in
  # memory: the person signs in to Authelia again, as the app's browser shows.
  assert_eq "$(sign_in "${PERSON}" "${PERSON_PASSWORD}" "${SECRET}" "${JAR}" "${FQDN}")" "OK OK" "${PERSON} signs in to Authelia again (it restarted)" || true
  native_sign_in "${JAR}" "${CLIENT}" "${FQDN}" "E2E Kiosk 2"
  assert_eq "${NATIVE_SIGN_IN} $(echo_status "${NATIVE_AT}")" "ok 200" "…a new sign-in works and reaches the plugin" || true
else
  log_fail "Authelia does not know the client again"
fi

end_test

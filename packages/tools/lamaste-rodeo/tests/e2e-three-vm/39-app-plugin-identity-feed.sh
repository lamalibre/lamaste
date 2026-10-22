#!/usr/bin/env bash
# ============================================================================
# 39 — App plugin identity feed (Three-VM)
# ============================================================================
# Slice 6's feed, end to end: the panel pushes a plugin's audience to its
# agent half through the internal tunnel. Two app plugins are hosted on the
# agent VM from the panel as in spec 34 (helpers.sh,
# write_app_install_fixture): @lamalibre/e2e-idfeed-server, whose manifest
# declares identity (roles viewer and editor, attributes displayName and
# email) and whose agent half keeps a projection of its users
# (createIdentityProjection over node:sqlite, createIdentityHandlers), and
# @lamalibre/e2e-idplain-server, the same without identity. Then:
#
# 1. Approved and hosted, the identity plugin's agent half answers protocol
#    1 and follows the panel's directory; nothing is entitled yet.
# 2. testuser entitled as viewer and a Lamaste group as editor, with a
#    second user in it: the agent half's projection holds both — the
#    directory's ids, their roles, the declared attributes from the
#    directory.
# 3. testuser's role revoked: removed, unentitled, the last attributes kept.
# 4. The second user disabled: still a member, status disabled.
# 5. Deleted: removed, deleted, the last display name kept; the group no
#    longer has them.
# 6. The agent half stopped (its socket and service): the user erased —
#    the directory scrubs the tombstone, the erasure is pending for the
#    plugin, the feed falls behind. Started again, it catches up without
#    being asked: the row scrubbed to the bare id, the plugin's anonymiser
#    run, the erasure no longer pending.
# 7. testuser entitled again; a reconcile (POST …/identity/sync
#    {reconcile:true}) finds nothing. The projection tampered with from the
#    agent half's own account (a role given, a member slipped in): the next
#    reconcile reports mismatches and audits them, and puts the projection
#    right — the one after finds nothing.
# 8. The plugin without identity has no audience, entitlements or sync
#    (400 no_identity), and its agent half's request log shows it never
#    received an /admin/identity request — though it answered the relay all
#    along, and the identity plugin was fed throughout.
#
# The user surface (a visitor's session reaching /app) is spec 40; the
# directory itself — ids, disable, delete, erase, the approval gate — is
# single-VM spec 32.
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

PLUGIN="e2e-idfeed"
SERVER_PACKAGE="@lamalibre/e2e-idfeed-server"
AGENT_PACKAGE="@lamalibre/e2e-idfeed-agent"
SERVICE_USER="lamaste-app-e2e-idfeed"
UNIT="lamalibre-app-e2e-idfeed.service"
SOCKET="lamalibre-app-e2e-idfeed.socket"
PLAIN="e2e-idplain"
PLAIN_SERVER_PACKAGE="@lamalibre/e2e-idplain-server"
PLAIN_AGENT_PACKAGE="@lamalibre/e2e-idplain-agent"
POLICY_ID="e2e-apphost-39"
REMOTE_DIR="/var/tmp/e2e-39-app-plugin"
LOCAL_TMP=""
CLEAN_PLUGINS="${PLUGIN} ${PLAIN}"
CLEAN_ROUTES="${PLUGIN} ${PLAIN}"
PURGE_PACKAGES=""
TEST_USER="${TEST_USER:-testuser}"
SECOND_USER="e2e39-bob"
SECOND_NAME="E2E Bob"
SECOND_EMAIL="e2e39-bob@example.test"
GROUP="e2e39-editors"
SECOND_ID=""
# Set while the agent half is stopped: the cleanup starts it again
HALF_STOPPED=""

health_up() { [ "$(hosting_field "$1" '.hosting.health.state')" = "up" ]; }

# start_hosting <plugin> — POST its hosting on the agent VM's agent; prints
# the operation id ("" when refused — the refusal is logged)
start_hosting() {
  local response id
  response=$(host_api_post "plugins/$1/hosting" "{\"agentLabel\":\"${HOST_AGENT_LABEL}\"}")
  id=$(json_get "$response" '.operation.id // empty')
  if [ -z "$id" ]; then log_info "Hosting $1 was refused: ${response}" >&2; fi
  echo "$id"
}

begin_test "39 — App plugin identity feed (Three-VM)"

cleanup() {
  log_info "Cleaning up test resources..."
  if [ -n "${HALF_STOPPED}" ]; then
    agent_exec "systemctl start ${SOCKET} > /dev/null 2>&1; true" > /dev/null 2>&1 || true
  fi
  # Gatekeeper's grants and group outlive the plugin.
  drop_plugin_grants "${PLUGIN}"
  drop_plugin_grants "${PLAIN}"
  host_api_delete "gatekeeper/groups/${GROUP}" > /dev/null 2>&1 || true
  # The second user, whatever state the spec left them in: deleted and erased.
  host_api_delete "users/${SECOND_USER}?erase=true" > /dev/null 2>&1 || true
  if [ -n "${SECOND_ID}" ]; then
    host_api_post "identity/directory/${SECOND_ID}/erase" '{}' > /dev/null 2>&1 || true
  fi
  app_plugin_cleanup
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
log_section "Pre-flight"
# ---------------------------------------------------------------------------

app_plugin_preflight
log_info "Hosting agent: ${HOST_AGENT_LABEL} (local name ${AGENT_LABEL}), relay domain ${DOMAIN}"
if agent_has_node_sqlite; then
  log_pass "The agent VM's Node.js has node:sqlite, which the agent half's projection needs"
else
  log_fail "The agent VM's Node.js has no unflagged node:sqlite (Node.js 22.13 or later): the identity fixture cannot run"
  end_test
  exit $?
fi
TEST_USER_RECORD=$(listed_user "${TEST_USER}")
TEST_USER_ID=$(json_get "$TEST_USER_RECORD" '.userId // empty')
TEST_USER_NAME=$(json_get "$TEST_USER_RECORD" '.displayname // empty')
TEST_USER_EMAIL=$(json_get "$TEST_USER_RECORD" '.email // empty')
assert_eq "$(is_uuid "${TEST_USER_ID}")" "true" "${TEST_USER} has a directory id (${TEST_USER_ID})" || true
DIRECTORY_ID=$(host_api_get "identity/directory" | jq -r '.directoryId // empty' 2>/dev/null || echo "")
assert_eq "$(is_uuid "${DIRECTORY_ID}")" "true" "The panel's directory has an id (${DIRECTORY_ID})" || true
# Leftovers of an interrupted run (rodeo ends a spec at ten minutes without its trap)
drop_plugin_grants "${PLUGIN}"
drop_plugin_grants "${PLAIN}"
host_api_delete "gatekeeper/groups/${GROUP}" > /dev/null 2>&1 || true
host_api_delete "users/${SECOND_USER}?erase=true" > /dev/null 2>&1 || true

# ===========================================================================
# 1. Fixtures; install and host both plugins
# ===========================================================================

log_section "Fixtures, the stand-in Feria; both plugins installed and hosted"

LOCAL_TMP=$(mktemp -d /tmp/e2e-39-app-plugin-XXXXXXXX)
BUILD="r$(date +%s)-$$"
FIXTURES="built"
write_app_install_fixture "${LOCAL_TMP}/ship/fixtures/feed" "${PLUGIN}" 1.0.0 main "${BUILD}" '[]' none wide || FIXTURES="failed"
write_app_install_fixture "${LOCAL_TMP}/ship/fixtures/plain" "${PLAIN}" 1.0.0 main "${BUILD}" '[]' || FIXTURES="failed"
if [ "$FIXTURES" != "built" ]; then
  log_fail "The fixtures could not be built (npm install at the workspace root, npm run build -w packages/core/lib)"
  end_test
  exit $?
fi
log_pass "Fixtures built: ${SERVER_PACKAGE} (identity: viewer, editor; displayName, email) and ${PLAIN_SERVER_PACKAGE} (no identity)"
ship_agent_facts_probe
ship_identity_tamper
start_stand_in_feria fixtures/feed/server fixtures/feed/agent fixtures/plain/server fixtures/plain/agent
ensure_app_host_helper
open_push_install "${POLICY_ID}" "[\"${AGENT_PACKAGE}\",\"${PLAIN_AGENT_PACKAGE}\"]" '["install","uninstall"]'

INSTALL=$(install_approved "${PLUGIN}" "${SERVER_PACKAGE}@1.0.0")
assert_json_field "$INSTALL" '.plugin.version' '1.0.0' "Installed ${SERVER_PACKAGE}@1.0.0" || true
assert_json_field "$INSTALL" '"\(.hooks.identity.declared) \(.hooks.identity.block.roles | map(.id) | join(",")) \(.hooks.identity.block.attributes | join(","))"' 'true editor,viewer displayName,email' "…its identity block: roles editor and viewer, attributes displayName and email" || true
assert_json_field "$(host_api_get "plugins/${PLUGIN}/hooks")" '"\(.hooks.approval.state) \(.hooks.identity.approved)"' 'approved true' "…approved with its agent half" || true
INSTALL=$(install_approved "${PLAIN}" "${PLAIN_SERVER_PACKAGE}@1.0.0")
assert_json_field "$INSTALL" '"\(.plugin.version) \(.hooks.identity.declared)"' '1.0.0 false' "Installed ${PLAIN_SERVER_PACKAGE}@1.0.0, no identity" || true

# Both hostings at once: the agent's sync runs their jobs one after the other.
OP_ID=$(start_hosting "${PLUGIN}")
PLAIN_OP_ID=$(start_hosting "${PLAIN}")
OP='{}'
PLAIN_OP='{}'
if [ -n "$OP_ID" ]; then OP=$(wait_operation "${PLUGIN}" "${OP_ID}" 360 nudge); fi
if [ -n "$PLAIN_OP_ID" ]; then PLAIN_OP=$(wait_operation "${PLAIN}" "${PLAIN_OP_ID}" 240 nudge); fi
assert_json_field "$OP" '.status' 'succeeded' "${PLUGIN} hosted on ${HOST_AGENT_LABEL} ($(json_get "$OP" '.error // ""'))" || true
assert_json_field "$PLAIN_OP" '.status' 'succeeded' "${PLAIN} hosted on ${HOST_AGENT_LABEL} ($(json_get "$PLAIN_OP" '.error // ""'))" || true
for p in "${PLUGIN}" "${PLAIN}"; do
  if wait_for 60 health_up "$p"; then
    log_pass "The relay's health of ${p} is up"
  else
    log_fail "Health of ${p}: $(hosting_field "$p" '.hosting.health')"
  fi
done

# ===========================================================================
# 2. Ready: protocol 1, the directory followed
# ===========================================================================

log_section "Ready: its agent half answered protocol 1 and follows the directory"

if wait_for 120 identity_ready "${PLUGIN}"; then
  log_pass "${PLUGIN} is ready for its users"
else
  log_fail "Not ready: $(identity_view "${PLUGIN}")"
fi
VIEW=$(identity_view "${PLUGIN}")
assert_json_field "$VIEW" '"\(.readiness.readyVersion) \(.sync.halfDirectoryId)"' "1.0.0 ${DIRECTORY_ID}" "1.0.0 answered protocol 1; its agent half follows directory ${DIRECTORY_ID}" || true
assert_json_field_not_empty "$VIEW" '.sync.lastSyncAt' "The panel synced it at $(json_get "$VIEW" '.sync.lastSyncAt')" || true
PROJ=$(projection "${PLUGIN}")
assert_json_field "$PROJ" '.state.directoryId' "${DIRECTORY_ID}" "GET /api/${PLUGIN}/e2e/projection: the agent half's projection follows the same directory" || true
assert_json_field "$PROJ" '[.users[] | select(.status != "removed")] | length' '0' "…and holds no member: no one is entitled yet" || true

# ===========================================================================
# 3. Entitled: a user and a group's member
# ===========================================================================

log_section "Entitled: ${TEST_USER} as viewer, a group's member as editor"

RESP=$(users_call POST "users" "{\"username\":\"${SECOND_USER}\",\"displayname\":\"${SECOND_NAME}\",\"email\":\"${SECOND_EMAIL}\",\"password\":\"E2e-$(openssl rand -hex 12)\",\"groups\":[]}")
assert_eq "$(status_of "$RESP")" "201" "User ${SECOND_USER} created" || true
SECOND_ID=$(json_get "$(body_of "$RESP")" '.user.userId // empty')
assert_eq "$(is_uuid "${SECOND_ID}")" "true" "…with a directory id (${SECOND_ID})" || true
assert_json_field "$(host_api_post "gatekeeper/groups" "{\"name\":\"${GROUP}\",\"description\":\"E2E 39 editors\"}")" '.ok' 'true' "Group ${GROUP} created" || true
assert_json_field "$(host_api_post "gatekeeper/groups/${GROUP}/members" "{\"usernames\":[\"${SECOND_USER}\"]}")" '.ok' 'true' "…with ${SECOND_USER} in it" || true
RESP=$(host_api_call PUT "plugins/${PLUGIN}/entitlements" "{\"principalType\":\"user\",\"principalId\":\"${TEST_USER}\",\"roles\":[\"viewer\"]}")
assert_eq "$(status_of "$RESP")" "200" "${TEST_USER} entitled as viewer" || true
assert_json_field "$(body_of "$RESP")" '.entitlement.userId' "${TEST_USER_ID}" "…named by the directory's id" || true
RESP=$(host_api_call PUT "plugins/${PLUGIN}/entitlements" "{\"principalType\":\"group\",\"principalId\":\"${GROUP}\",\"roles\":[\"editor\"]}")
assert_eq "$(status_of "$RESP")" "200" "${GROUP} entitled as editor" || true

if wait_for 60 projection_has "${PLUGIN}" "([.users[] | select(.userId == \"${TEST_USER_ID}\" and .status == \"active\")] | length == 1) and ([.users[] | select(.userId == \"${SECOND_ID}\" and .status == \"active\")] | length == 1)"; then
  log_pass "The agent half's projection holds both, pushed through the tunnel"
else
  log_fail "The projection: $(projection "${PLUGIN}" | jq -c '.users' 2>/dev/null)"
fi
ROW=$(projected_user "${PLUGIN}" "${TEST_USER_ID}")
assert_json_field "$ROW" '"\(.username) \(.roles | join(",")) \(.status)"' "${TEST_USER} viewer active" "${TEST_USER}: viewer, active" || true
assert_json_field "$ROW" '"\(.displayName)|\(.email)"' "${TEST_USER_NAME}|${TEST_USER_EMAIL}" "…with the directory's display name and address — both declared" || true
ROW=$(projected_user "${PLUGIN}" "${SECOND_ID}")
assert_json_field "$ROW" '"\(.username) \(.roles | join(",")) \(.status)"' "${SECOND_USER} editor active" "${SECOND_USER}: editor through the group, active" || true
assert_json_field "$ROW" '"\(.displayName)|\(.email)"' "${SECOND_NAME}|${SECOND_EMAIL}" "…${SECOND_NAME}, ${SECOND_EMAIL}" || true
if wait_for 30 identity_caught_up "${PLUGIN}"; then
  log_pass "The panel sees its agent half at the head of the audience"
else
  log_fail "Behind: $(identity_view "${PLUGIN}" | jq -c '.sync')"
fi
assert_json_field "$(identity_view "${PLUGIN}")" '"\(.audience.active) \(.audience.disabled) \(.audience.removed) \(.audience.erased)"' '2 0 0 0' "The audience: two active members" || true

# ===========================================================================
# 4. Revoked
# ===========================================================================

log_section "Revoked: removed, unentitled, the last attributes kept"

RESP=$(host_api_call DELETE "plugins/${PLUGIN}/entitlements?principalType=user&principalId=${TEST_USER}")
assert_json_field "$(body_of "$RESP")" '"\(.ok) \(.revoked)"' 'true 1' "${TEST_USER}'s role revoked" || true
if wait_for 60 projection_has "${PLUGIN}" "[.users[] | select(.userId == \"${TEST_USER_ID}\" and .status == \"removed\" and .removedReason == \"unentitled\")] | length == 1"; then
  log_pass "The agent half: ${TEST_USER} removed, unentitled"
else
  log_fail "The projection: $(projected_user "${PLUGIN}" "${TEST_USER_ID}")"
fi
ROW=$(projected_user "${PLUGIN}" "${TEST_USER_ID}")
assert_json_field "$ROW" '"\(.roles | length) \(.username) \(.displayName)|\(.email)"' "0 ${TEST_USER} ${TEST_USER_NAME}|${TEST_USER_EMAIL}" "…no roles, the last attributes it received kept" || true
assert_json_field_not_empty "$ROW" '.removedAt' "…removed at $(json_get "$ROW" '.removedAt')" || true
assert_json_field "$(audience_row "${PLUGIN}" "${TEST_USER_ID}")" '"\(.change.kind) \(.change.reason) \(.change.last.username)"' "remove unentitled ${TEST_USER}" "The panel's audience: remove/unentitled with the last attributes" || true

# ===========================================================================
# 5. Disabled
# ===========================================================================

log_section "Disabled: still a member, status disabled"

RESP=$(users_call PUT "users/${SECOND_USER}" '{"disabled":true}')
assert_json_field "$(body_of "$RESP")" '"\(.user.status) \(.user.userId)"' "disabled ${SECOND_ID}" "${SECOND_USER} disabled, the same id" || true
if wait_for 60 projection_has "${PLUGIN}" "[.users[] | select(.userId == \"${SECOND_ID}\" and .status == \"disabled\" and .roles == [\"editor\"])] | length == 1"; then
  log_pass "The agent half: ${SECOND_USER} disabled, still an editor"
else
  log_fail "The projection: $(projected_user "${PLUGIN}" "${SECOND_ID}")"
fi
assert_json_field "$(identity_view "${PLUGIN}")" '"\(.audience.active) \(.audience.disabled)"' '0 1' "The audience: one disabled member, none active" || true

# ===========================================================================
# 6. Deleted
# ===========================================================================

log_section "Deleted: removed, deleted, the last display name kept"

RESP=$(users_call DELETE "users/${SECOND_USER}")
assert_json_field "$(body_of "$RESP")" '"\(.ok) \(.userId) \(.principalCleared)"' "true ${SECOND_ID} true" "${SECOND_USER} deleted; Gatekeeper dropped their grants and memberships" || true
if wait_for 60 projection_has "${PLUGIN}" "[.users[] | select(.userId == \"${SECOND_ID}\" and .status == \"removed\" and .removedReason == \"deleted\")] | length == 1"; then
  log_pass "The agent half: ${SECOND_USER} removed, deleted"
else
  log_fail "The projection: $(projected_user "${PLUGIN}" "${SECOND_ID}")"
fi
ROW=$(projected_user "${PLUGIN}" "${SECOND_ID}")
assert_json_field "$ROW" '"\(.roles | length) \(.username) \(.displayName)"' "0 ${SECOND_USER} ${SECOND_NAME}" "…no roles, the last display name kept" || true
assert_json_field "$(host_api_get "gatekeeper/groups/${GROUP}")" ".group.members | index(\"${SECOND_USER}\")" 'null' "${GROUP} no longer has them" || true
assert_json_field "$(directory_user "${SECOND_ID}")" '"\(.status) \(.removedReason) \(.username)"' "removed deleted ${SECOND_USER}" "The directory keeps their tombstone" || true

# ===========================================================================
# 7. Erased while the agent half is stopped
# ===========================================================================

log_section "Erased while the agent half is stopped: queued, then caught up"

HALF_STOPPED=1
agent_exec "systemctl stop ${SOCKET} ${UNIT}" > /dev/null 2>&1 || true
assert_eq "$(agent_exec "systemctl is-active ${SOCKET} ${UNIT} 2>/dev/null | sort -u | tr '\n' ' '; true" 2>/dev/null | tr -d ' ')" "inactive" "The agent half is stopped: its socket and its service (nothing holds its port)" || true

RESP=$(host_api_call POST "identity/directory/${SECOND_ID}/erase" '{}')
assert_eq "$(status_of "$RESP")" "200" "${SECOND_USER} erased by their id" || true
ROW=$(directory_user "${SECOND_ID}")
assert_json_field "$ROW" '"\(.username) \(.displayName) \(.email)"' 'null null null' "The directory scrubbed the tombstone to the bare id" || true
assert_json_field "$ROW" ".pendingErasures | index(\"${PLUGIN}\") != null" 'true' "…and the erasure is pending for ${PLUGIN}" || true
VIEW=$(identity_view "${PLUGIN}")
assert_json_field "$VIEW" ".pendingErasures | index(\"${SECOND_ID}\") != null" 'true' "GET /api/plugins/${PLUGIN}/identity: pending erasure ${SECOND_ID}" || true
assert_json_field "$VIEW" '.sync.behind >= 1' 'true' "…its agent half is behind ($(json_get "$VIEW" '.sync.behind') change)" || true
assert_json_field "$(audience_row "${PLUGIN}" "${SECOND_ID}")" '"\(.change.kind) \(.change.reason) \(.change | has("last"))"' 'remove erased false' "The audience: remove/erased, nothing but the id" || true
sync_failed() { [ -n "$(json_get "$(identity_view "${PLUGIN}")" '.sync.lastError // empty')" ]; }
if wait_for 45 sync_failed; then
  log_pass "The panel tried and could not deliver it: $(json_get "$(identity_view "${PLUGIN}")" '.sync.lastError')"
else
  log_fail "No failed delivery recorded: $(identity_view "${PLUGIN}" | jq -c '.sync')"
fi

agent_exec "systemctl start ${SOCKET}" > /dev/null 2>&1 || true
HALF_STOPPED=""
log_info "The agent half's socket started again; nothing asks the panel to sync"
if wait_for 180 identity_caught_up "${PLUGIN}"; then
  log_pass "The agent half caught up on its own (health back up, or the minute's retry)"
else
  log_fail "Still behind: $(identity_view "${PLUGIN}" | jq -c '.sync')"
fi
ROW=$(projected_user "${PLUGIN}" "${SECOND_ID}")
assert_json_field "$ROW" '"\(.username) \(.displayName) \(.email) \(.removedReason)"' 'null null null erased' "The agent half scrubbed the row to the bare id" || true
assert_json_field_not_empty "$ROW" '.erasedAt' "…erased at $(json_get "$ROW" '.erasedAt')" || true
assert_json_field "$(projection "${PLUGIN}")" ".erased | index(\"${SECOND_ID}\") != null" 'true' "…and ran the plugin's anonymiser (onErase)" || true
assert_json_field "$(identity_view "${PLUGIN}")" '.pendingErasures | length' '0' "No erasure pending for ${PLUGIN}: its cursor passed it" || true
assert_json_field "$(directory_user "${SECOND_ID}")" '.pendingErasures | length' '0' "GET /api/identity/directory: none pending for the user" || true

# ===========================================================================
# 8. Reconcile
# ===========================================================================

log_section "Reconcile: nothing to find; then a tampered projection"

RESP=$(host_api_call PUT "plugins/${PLUGIN}/entitlements" "{\"principalType\":\"user\",\"principalId\":\"${TEST_USER}\",\"roles\":[\"viewer\"]}")
assert_eq "$(status_of "$RESP")" "200" "${TEST_USER} entitled as viewer again" || true
if wait_for 60 projection_has "${PLUGIN}" "[.users[] | select(.userId == \"${TEST_USER_ID}\" and .status == \"active\" and .roles == [\"viewer\"])] | length == 1"; then
  log_pass "The agent half: ${TEST_USER} a member again"
else
  log_fail "The projection: $(projected_user "${PLUGIN}" "${TEST_USER_ID}")"
fi

SYNC=$(host_api_post "plugins/${PLUGIN}/identity/sync" '{"reconcile":true}')
assert_json_field "$SYNC" '"\(.ok) \(.result.status) \(.result.replay) \(.result.mismatches)"' 'true synced true 0' "POST /api/plugins/${PLUGIN}/identity/sync {reconcile}: a replay that finds no mismatch" || true
assert_json_field "$SYNC" '.sync.lastMismatches' '0' "…recorded: lastMismatches 0" || true
MISMATCH_AUDITS=$(audit_count "${PLUGIN}" identity.reconcile.mismatches)

TAMPER=$(tamper_projection "${PLUGIN}" "${SERVICE_USER}" "${TEST_USER_ID}")
assert_json_field "$TAMPER" '"\(.changed) \(.inserted)"' '1 1' "Tampered with as ${SERVICE_USER}: ${TEST_USER} given the editor role, a member slipped in" || true
assert_json_field "$(projected_user "${PLUGIN}" "${TEST_USER_ID}")" '.roles | join(",")' 'editor' "…the agent half now believes ${TEST_USER} is an editor" || true
assert_json_field "$(projection "${PLUGIN}")" '[.users[] | select(.username == "e2e-phantom" and .status == "active")] | length' '1' "…and holds a member the directory never named" || true

SYNC=$(host_api_post "plugins/${PLUGIN}/identity/sync" '{"reconcile":true}')
MISMATCHES=$(json_get "$SYNC" '.result.mismatches // 0')
assert_json_field "$SYNC" '"\(.result.status) \(.result.mismatches > 0)"' 'synced true' "The next reconcile reports ${MISMATCHES} mismatches" || true
assert_json_field "$SYNC" '.sync.lastMismatches' "${MISMATCHES}" "…recorded on the feed's state" || true
assert_eq "$(audit_count "${PLUGIN}" identity.reconcile.mismatches '.mismatches > 0')" "$((MISMATCH_AUDITS + 1))" "…and audited (identity.reconcile.mismatches)" || true
assert_json_field "$(projected_user "${PLUGIN}" "${TEST_USER_ID}")" '"\(.roles | join(",")) \(.status)"' 'viewer active' "The replay put ${TEST_USER} back: viewer" || true
assert_json_field "$(projection "${PLUGIN}")" '[.users[] | select(.username == "e2e-phantom") | "\(.status) \(.removedReason)"] | first' 'removed deleted' "…and removed the member the directory never named" || true
SYNC=$(host_api_post "plugins/${PLUGIN}/identity/sync" '{"reconcile":true}')
assert_json_field "$SYNC" '"\(.result.status) \(.result.mismatches)"' 'synced 0' "The reconcile after that finds nothing" || true
assert_eq "$(audit_count "${PLUGIN}" identity.reconcile.mismatches)" "$((MISMATCH_AUDITS + 1))" "…and audits nothing" || true

# ===========================================================================
# 9. A plugin without identity
# ===========================================================================

log_section "A plugin without identity is never sent any"

for path in audience entitlements; do
  RESP=$(host_api_call GET "plugins/${PLAIN}/${path}")
  assert_eq "$(status_of "$RESP")" "400" "GET /api/plugins/${PLAIN}/${path}: 400" || true
  assert_json_field "$(body_of "$RESP")" '.code' 'no_identity' "…no_identity" || true
done
RESP=$(host_api_call POST "plugins/${PLAIN}/identity/sync" '{}')
assert_eq "$(status_of "$RESP")" "400" "POST /api/plugins/${PLAIN}/identity/sync: 400 (no_identity)" || true
RESP=$(host_api_call PUT "plugins/${PLAIN}/entitlements" "{\"principalType\":\"user\",\"principalId\":\"${TEST_USER}\",\"roles\":[\"viewer\"]}")
assert_eq "$(status_of "$RESP")" "400" "PUT /api/plugins/${PLAIN}/entitlements: 400 — no roles to give" || true
assert_json_field "$(identity_view "${PLAIN}")" '"\(.declared) \(.readiness.reason) \(.sync)"' 'null no_identity null' "GET /api/plugins/${PLAIN}/identity: nothing declared, no feed" || true
assert_eq "$(half_requests "${PLAIN}" ' /admin/identity')" "0" "Its agent half's request log: not one /admin/identity request" || true
PLAIN_HEALTH=$(half_requests "${PLAIN}" ' GET /admin/health$')
assert_json_field "{\"n\":${PLAIN_HEALTH:-0}}" '.n > 0' 'true' "…though it answered the relay's health probes all along (${PLAIN_HEALTH} logged)" || true
FED=$(half_requests "${PLUGIN}" ' POST /admin/identity/(notify|changes)$')
assert_json_field "{\"n\":${FED:-0}}" '.n > 0' 'true' "…while ${PLUGIN}'s agent half was sent ${FED} identity calls" || true

end_test

#!/usr/bin/env bash
# ============================================================================
# 41 — App plugin identity ledger across an uninstall (Three-VM)
# ============================================================================
# Slice 6's erasure ledger: a plugin's audience rows are the record of
# everyone its agent halves were sent, and so of the erasures it owes; they
# outlive an uninstall for as long as an agent keeps the plugin's data. An
# app plugin declaring identity (fixture @lamalibre/e2e-ledger-server,
# helpers.sh: write_app_install_fixture … wide — its agent half keeps a
# projection of its users in its data directory) is hosted on the agent VM
# from the panel as in spec 39:
#
# 1. A new user and testuser entitled as viewers before the plugin is
#    hosted. Hosted, the plugin is ready only once its agent half's first
#    complete sync ended at the head — so the moment it is ready, its
#    projection holds both, without waiting.
# 2. Uninstalled without purge: the plugin is gone from the relay; its agent
#    half's data — the projection among it — stays on the agent, and the
#    relay records it (retained data).
# 3. The user deleted, then erased, while no agent half runs: the directory
#    scrubs the tombstone, and the erasure is pending for the uninstalled
#    plugin (its ledger stayed), marked inactive; the projection the agent
#    keeps still holds the user's name.
# 4. Installed and hosted again on the same agent: its agent half takes the
#    kept data back (the same instance; nothing retained any more) and is
#    ready only once the replay since the hosting reached the head — by then
#    the projection holds the user as the bare id, erased, the plugin's
#    anonymiser ran, testuser is still a viewer (Gatekeeper's grants outlive
#    an uninstall), and nothing is pending.
# 5. An erasure is sticky: testuser's row scrubbed in the projection as the
#    agent half's own account could (an erasure the relay's ledger does not
#    hold — what a relay restored from a backup taken before an erasure
#    would contradict): every reconcile reports the relay's upsert as a
#    mismatch, the row stays the bare id, and no hook runs for it.
# 6. Uninstalled with purge: no data of the plugin is left on any agent, and
#    the relay drops its ledger (its journal says so).
#
# The agent's sync is nudged while operations run (the unit its timer
# starts) so the spec stays inside rodeo's ten minutes.
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

PLUGIN="e2e-ledger"
SERVER_PACKAGE="@lamalibre/e2e-ledger-server"
AGENT_PACKAGE="@lamalibre/e2e-ledger-agent"
SERVICE_USER="lamaste-app-e2e-ledger"
POLICY_ID="e2e-apphost-41"
REMOTE_DIR="/var/tmp/e2e-41-app-plugin"
LOCAL_TMP=""
CLEAN_PLUGINS="${PLUGIN}"
CLEAN_ROUTES="${PLUGIN}"
PURGE_PACKAGES=""
TEST_USER="${TEST_USER:-testuser}"
CAROL="e2e41-carol"
CAROL_NAME="E2E Carol"
CAROL_EMAIL="e2e41-carol@example.test"
CAROL_ID=""
TEST_USER_ID=""
INSTANCE=""

health_up() { [ "$(hosting_field "${PLUGIN}" '.hosting.health.state')" = "up" ]; }

# retained_here — the relay's record of the data the agent VM's agent keeps
# of the plugin's agent half ('null' when none)
retained_here() {
  host_api_get "plugins/${PLUGIN}/retained-data" 2>/dev/null | jq -c --arg a "${HOST_AGENT_LABEL}" '[.retainedData[]? | select(.agentLabel == $a)] | first // null' 2>/dev/null || echo "null"
}

# uninstall <purge: true | false> — disable and uninstall the hosted plugin
# (its hosting removed first, by an operation); prints the operation once it
# ended, or {"refused": <response>}
uninstall() {
  local response id
  host_api_post "plugins/${PLUGIN}/disable" '{}' > /dev/null 2>&1 || true
  if [ "$1" = "true" ]; then
    response=$(host_api_delete "plugins/${PLUGIN}?purge=true")
  else
    response=$(host_api_delete "plugins/${PLUGIN}")
  fi
  id=$(json_get "$response" '.operation.id // empty')
  if [ -z "$id" ]; then
    echo "{\"refused\":$(echo "$response" | jq -c . 2>/dev/null || echo null)}"
    return 0
  fi
  wait_operation "${PLUGIN}" "$id" 240 nudge
}

# reconcile — POST /api/plugins/<plugin>/identity/sync {reconcile: true}: its answer
reconcile() { host_api_post "plugins/${PLUGIN}/identity/sync" '{"reconcile":true}'; }

# ledger_dropped_lines <epoch> — lines of the panel's journal since then
# saying it dropped the plugin's identity ledger
ledger_dropped_lines() {
  host_exec "journalctl -u lamalibre-lamaste-serverd --no-pager --since @$1 -o cat 2>/dev/null | grep 'Dropped the identity ledger of a plugin no agent keeps data of' | grep -c '\"plugin\":\"${PLUGIN}\"' || true" 2>/dev/null | tail -n 1 || echo "0"
}

# forget_retained_record — drop the relay's record of data the agent keeps
# of the plugin (the data itself purged on the agent VM with the helper),
# and with it the plugin's identity ledger
forget_retained_record() {
  if [ -n "${HOST_AGENT_LABEL:-}" ]; then
    host_api_delete "plugins/${PLUGIN}/retained-data?agentLabel=${HOST_AGENT_LABEL}&forget=true" > /dev/null 2>&1 || true
  fi
}

begin_test "41 — App plugin identity ledger across an uninstall (Three-VM)"

cleanup() {
  log_info "Cleaning up test resources..."
  # Gatekeeper's grants outlive the plugin.
  drop_plugin_grants "${PLUGIN}"
  # The user, whatever state the spec left them in: deleted and erased.
  host_api_delete "users/${CAROL}?erase=true" > /dev/null 2>&1 || true
  if [ -n "${CAROL_ID}" ]; then
    host_api_post "identity/directory/${CAROL_ID}/erase" '{}' > /dev/null 2>&1 || true
  fi
  # Uninstalls the plugin and purges what is left of its route on the agent
  # VM with the helper — the data an uninstall without purge kept too.
  app_plugin_cleanup
  forget_retained_record
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
TEST_USER_ID=$(json_get "$(listed_user "${TEST_USER}")" '.userId // empty')
assert_eq "$(is_uuid "${TEST_USER_ID}")" "true" "${TEST_USER} has a directory id (${TEST_USER_ID})" || true
# Leftovers of an interrupted run (rodeo ends a spec at ten minutes without its trap)
drop_plugin_grants "${PLUGIN}"
host_api_delete "users/${CAROL}?erase=true" > /dev/null 2>&1 || true
if [ "$(host_api_get_status "plugins/${PLUGIN}")" = "404" ]; then
  timed_exec 120 multipass exec "${AGENT_VM}" -- sudo bash -c "if [ -x ${APPHOST_HELPER} ]; then ${APPHOST_HELPER} remove ${AGENT_LABEL} ${PLUGIN} --purge > /dev/null 2>&1; fi; true" > /dev/null 2>&1
  forget_retained_record
fi

# ===========================================================================
# 1. Entitled before it is hosted; ready means synced
# ===========================================================================

log_section "Entitled before it is hosted; the moment it is ready, its projection holds them"

LOCAL_TMP=$(mktemp -d /tmp/e2e-41-app-plugin-XXXXXXXX)
if ! write_app_install_fixture "${LOCAL_TMP}/ship/fixtures/ledger" "${PLUGIN}" 1.0.0 main "r$(date +%s)-$$" '[]' none wide; then
  log_fail "The fixture could not be built (npm install at the workspace root, npm run build -w packages/core/lib)"
  end_test
  exit $?
fi
log_pass "Fixture built: ${SERVER_PACKAGE} (identity: viewer, editor; displayName, email) and its agent package"
ship_agent_facts_probe
ship_identity_tamper
ship_identity_peek
start_stand_in_feria fixtures/ledger/server fixtures/ledger/agent
ensure_app_host_helper
open_push_install "${POLICY_ID}" "[\"${AGENT_PACKAGE}\"]" '["install","uninstall"]'

RESP=$(users_call POST "users" "{\"username\":\"${CAROL}\",\"displayname\":\"${CAROL_NAME}\",\"email\":\"${CAROL_EMAIL}\",\"password\":\"E2e-$(openssl rand -hex 12)\",\"groups\":[]}")
assert_eq "$(status_of "$RESP")" "201" "User ${CAROL} created" || true
CAROL_ID=$(json_get "$(body_of "$RESP")" '.user.userId // empty')
assert_eq "$(is_uuid "${CAROL_ID}")" "true" "…with a directory id (${CAROL_ID})" || true

INSTALL=$(install_approved "${PLUGIN}" "${SERVER_PACKAGE}@1.0.0")
assert_json_field "$INSTALL" '"\(.plugin.version) \(.hooks.identity.declared)"' '1.0.0 true' "Installed ${SERVER_PACKAGE}@1.0.0, which declares identity; approved" || true
for who in "${CAROL}" "${TEST_USER}"; do
  RESP=$(host_api_call PUT "plugins/${PLUGIN}/entitlements" "{\"principalType\":\"user\",\"principalId\":\"${who}\",\"roles\":[\"viewer\"]}")
  assert_eq "$(status_of "$RESP")" "200" "${who} entitled as viewer, before the plugin is hosted" || true
done

OP=$(host_plugin "${PLUGIN}" 360 nudge)
assert_json_field "$OP" '.status' 'succeeded' "Hosted on ${HOST_AGENT_LABEL} ($(json_get "$OP" '.error // .refused.error // ""'))" || true
INSTANCE=$(json_get "$(host_api_get "${PLUGIN}/ping")" '.data.instance // empty')
if [ -n "$INSTANCE" ]; then
  log_pass "The agent half answers through the tunnel (its data: instance ${INSTANCE})"
else
  log_fail "The agent half does not answer through the tunnel"
fi
if wait_for 60 health_up; then
  log_pass "The relay's health of the hosting is up"
else
  log_fail "Health: $(hosting_field "${PLUGIN}" '.hosting.health')"
fi
if wait_for 120 identity_ready "${PLUGIN}"; then
  log_pass "Ready: its agent half's first complete sync ended at the head of the audience"
else
  log_fail "Not ready: $(identity_view "${PLUGIN}" | jq -c '.readiness')"
fi
VIEW=$(identity_view "${PLUGIN}")
assert_json_field "$VIEW" '"\(.readiness.readyVersion) \(.sync.behind)"' '1.0.0 0' "1.0.0 is ready, nothing behind" || true
# Read once, at once: readiness promises the members are there.
PROJ=$(projection "${PLUGIN}")
assert_json_field "$PROJ" "[.users[] | select(.userId == \"${CAROL_ID}\") | \"\(.username) \(.status) \(.roles | join(\",\"))\"] | first" "${CAROL} active viewer" "The projection already holds ${CAROL}: active, viewer" || true
assert_json_field "$PROJ" "[.users[] | select(.userId == \"${TEST_USER_ID}\") | \"\(.username) \(.status) \(.roles | join(\",\"))\"] | first" "${TEST_USER} active viewer" "…and ${TEST_USER}" || true

# ===========================================================================
# 2. Uninstalled without purge
# ===========================================================================

log_section "Uninstalled without purge: the data stays on the agent"

OP=$(uninstall false)
assert_json_field "$OP" '.status' 'succeeded' "Uninstalled without purge ($(json_get "$OP" '.error // .refused.error // ""'))" || true
assert_eq "$(host_api_get_status "plugins/${PLUGIN}")" "404" "The plugin is gone from the relay" || true
assert_json_field "$(retained_here)" '"\(.route) \(.package)"' "${PLUGIN} ${AGENT_PACKAGE}" "GET /api/plugins/${PLUGIN}/retained-data: ${HOST_AGENT_LABEL} keeps its agent half's data" || true
assert_json_field "$(kept_projection_user "${PLUGIN}" "${CAROL_ID}")" '"\(.username) \(.status)"' "${CAROL} active" "The projection in that data holds ${CAROL}, active" || true

# ===========================================================================
# 3. Deleted and erased while no agent half runs
# ===========================================================================

log_section "Deleted and erased while no agent half runs: the erasure waits for the kept data"

RESP=$(users_call DELETE "users/${CAROL}")
assert_json_field "$(body_of "$RESP")" '"\(.ok) \(.userId)"' "true ${CAROL_ID}" "${CAROL} deleted" || true
RESP=$(host_api_call POST "identity/directory/${CAROL_ID}/erase" '{}')
assert_eq "$(status_of "$RESP")" "200" "…and erased by their id" || true
ROW=$(directory_user "${CAROL_ID}")
assert_json_field "$ROW" '"\(.username) \(.displayName) \(.email)"' 'null null null' "The directory scrubbed the tombstone to the bare id" || true
assert_json_field "$ROW" ".pendingErasures | index(\"${PLUGIN}\") != null" 'true' "The erasure is pending for ${PLUGIN}, uninstalled as it is: its ledger stayed with its data" || true
assert_json_field "$ROW" ".pendingErasuresInactive | index(\"${PLUGIN}\") != null" 'true' "…marked inactive: no feed reaches the data until the plugin comes back" || true
assert_json_field "$(kept_projection_user "${PLUGIN}" "${CAROL_ID}")" '"\(.username) \(.erasedAt)"' "${CAROL} null" "The kept projection still holds ${CAROL}'s name: nothing reached it yet" || true

# ===========================================================================
# 4. Back: the kept data taken back, the erasure replayed
# ===========================================================================

log_section "Installed and hosted again: the kept data taken back, the erasure replayed"

INSTALL=$(install_approved "${PLUGIN}" "${SERVER_PACKAGE}@1.0.0")
assert_json_field "$INSTALL" '.plugin.version' '1.0.0' "${SERVER_PACKAGE}@1.0.0 installed again, approved" || true
OP=$(host_plugin "${PLUGIN}" 360 nudge)
assert_json_field "$OP" '.status' 'succeeded' "Hosted on ${HOST_AGENT_LABEL} again ($(json_get "$OP" '.error // .refused.error // ""'))" || true
assert_json_field "$(host_api_get "${PLUGIN}/ping")" '.data.instance' "${INSTANCE}" "The agent half took back the data the uninstall kept (instance ${INSTANCE})" || true
assert_eq "$(retained_here)" "null" "…and the relay no longer records it as retained" || true
if wait_for 120 identity_ready "${PLUGIN}"; then
  log_pass "Ready again: the replay since the hosting reached the head"
else
  log_fail "Not ready: $(identity_view "${PLUGIN}" | jq -c '.readiness')"
fi
PROJ=$(projection "${PLUGIN}")
ROW=$(echo "$PROJ" | jq -c --arg id "${CAROL_ID}" '[.users[]? | select(.userId == $id)] | first // null' 2>/dev/null || echo "null")
assert_json_field "$ROW" '"\(.username) \(.displayName) \(.email) \(.status) \(.removedReason)"' 'null null null removed erased' "Ready, the projection holds ${CAROL} as the bare id, erased: the replay delivered the erasure" || true
assert_json_field_not_empty "$ROW" '.erasedAt' "…erased at $(json_get "$ROW" '.erasedAt')" || true
assert_json_field "$PROJ" ".erased | index(\"${CAROL_ID}\") != null" 'true' "…and the plugin's anonymiser (onErase) ran for them" || true
assert_json_field "$PROJ" "[.users[] | select(.userId == \"${TEST_USER_ID}\") | \"\(.status) \(.roles | join(\",\"))\"] | first" 'active viewer' "${TEST_USER} is still a viewer: Gatekeeper's grants outlived the uninstall" || true
assert_json_field "$(identity_view "${PLUGIN}")" '.pendingErasures | length' '0' "GET /api/plugins/${PLUGIN}/identity: no erasure pending" || true
assert_json_field "$(directory_user "${CAROL_ID}")" '"\(.pendingErasures | length) \(.pendingErasuresInactive | length)"' '0 0' "GET /api/identity/directory: none pending for ${CAROL}" || true

# ===========================================================================
# 5. An erasure is sticky
# ===========================================================================

log_section "An erasure is sticky: the relay's upsert never brings the user back"

TAMPER=$(tamper_projection "${PLUGIN}" "${SERVICE_USER}" "${TEST_USER_ID}" erase)
assert_json_field "$TAMPER" '.changed' '1' "As ${SERVICE_USER}: ${TEST_USER}'s row scrubbed as an erasure leaves it — one the relay's ledger does not hold" || true
for pass in 1 2; do
  SYNC=$(reconcile)
  assert_json_field "$SYNC" '"\(.result.status) \(.result.mismatches >= 1)"' 'synced true' "Reconcile ${pass}: the relay's upsert of ${TEST_USER} contradicts the erasure — reported ($(json_get "$SYNC" '.result.mismatches') mismatch)" || true
  assert_json_field "$(projected_user "${PLUGIN}" "${TEST_USER_ID}")" '"\(.username) \(.displayName) \(.status) \(.removedReason) \(.roles | length)"' 'null null removed erased 0' "…the row stays the bare id, erased" || true
done
assert_json_field "$(projection "${PLUGIN}")" ".erased | index(\"${TEST_USER_ID}\")" 'null' "…and no hook ran for it (the plugin's anonymiser was never called for ${TEST_USER})" || true

# ===========================================================================
# 6. Uninstalled with purge: the ledger goes
# ===========================================================================

log_section "Uninstalled with purge: no data left anywhere, the ledger goes"

SINCE=$(host_exec "date +%s" 2>/dev/null | tail -n 1 || echo "")
OP=$(uninstall true)
assert_json_field "$OP" '.status' 'succeeded' "Uninstalled with purge ($(json_get "$OP" '.error // .refused.error // ""'))" || true
assert_eq "$(host_api_get_status "plugins/${PLUGIN}")" "404" "The plugin is gone from the relay" || true
assert_eq "$(retained_here)" "null" "No agent keeps data of ${PLUGIN}" || true
assert_json_field "$(agent_facts "${PLUGIN}" "${SERVICE_USER}")" '"\(.data.dir) \(.account.user)"' 'null null' "…its data directory, the projection in it, and its account are gone from the agent VM" || true
DROPPED=$(ledger_dropped_lines "${SINCE:-0}")
assert_json_field "{\"n\":${DROPPED:-0}}" '.n >= 1' 'true' "The relay dropped the plugin's identity ledger (journal: Dropped the identity ledger of a plugin no agent keeps data of)" || true

end_test

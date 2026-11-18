#!/usr/bin/env bash
# ============================================================================
# 70 — App plugin agent half: a key directory apart from its data (Three-VM)
# ============================================================================
# An app plugin whose agent half Lamaste installs (fixture
# @lamalibre/e2e-apphost-keys-server, helpers.sh), hosted on the agent VM
# from the panel as in spec 34:
#
# 1. 1.0.0 asks for no key directory: none is made, its unit names none,
#    and the agent half cannot write the key tree.
# 2. With auto-approve on, an update to 1.1.0, which asks for one
#    (agent.service.keysDir), waits for an administrator
#    (agent-half.keys-dir). Approved, the agent's app host helper (protocol 4)
#    makes /var/lib/lamalibre/app-keys/<route> — 0700, the agent half's
#    account's — and the unit names it (LAMASTE_APP_KEYS_DIR) and lets the
#    agent half write it, as systemd applies it. The agent half keeps its
#    key there, never under /var/lib/lamalibre/apps; another route's place
#    in the key tree stays out of its reach.
# 3. Unhosting keeps the key directory with the data; hosting again finds
#    the same key.
# 4. Uninstalling with purge deletes the key directory too, through the key
#    tree's own root-only trash.
#
# The agent's sync is nudged while operations run (the unit its timer
# starts) so the spec stays inside rodeo's ten minutes.
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../e2e/helpers.sh"
# shellcheck source-path=SCRIPTDIR source=app-plugin-harness.sh
source "${SCRIPT_DIR}/app-plugin-harness.sh"

require_commands multipass curl jq node npm tar perl

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

PLUGIN="e2e-apphost-keys"
SERVER_PACKAGE="@lamalibre/e2e-apphost-keys-server"
AGENT_PACKAGE="@lamalibre/e2e-apphost-keys-agent"
SERVICE_USER="lamaste-app-e2e-apphost-keys"
KEYS_DIR="/var/lib/lamalibre/app-keys/${PLUGIN}"
DATA_DIR="/var/lib/lamalibre/apps/${PLUGIN}"
POLICY_ID="e2e-apphost-70"
REMOTE_DIR="/var/tmp/e2e-70-app-plugin"
LOCAL_TMP=""
CLEAN_PLUGINS="${PLUGIN}"
CLEAN_ROUTES="${PLUGIN}"
PURGE_PACKAGES=""

begin_test "70 — App plugin agent half: a key directory apart from its data (Three-VM)"

cleanup() {
  log_info "Cleaning up test resources..."
  app_plugin_cleanup
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
log_section "Pre-flight"
# ---------------------------------------------------------------------------

app_plugin_preflight
log_info "Hosting agent: ${HOST_AGENT_LABEL} (local name ${AGENT_LABEL}), relay domain ${DOMAIN}"

# ===========================================================================
# 1. 1.0.0: no key directory
# ===========================================================================

log_section "1.0.0 asks for no key directory"

LOCAL_TMP=$(mktemp -d /tmp/e2e-70-app-plugin-XXXXXXXX)
BUILD="r$(date +%s)-$$"
FIXTURES="built"
write_app_install_fixture "${LOCAL_TMP}/ship/fixtures/v100" "${PLUGIN}" 1.0.0 main "${BUILD}" '[]' || FIXTURES="failed"
FIXTURE_KEYS_DIR=1 write_app_install_fixture "${LOCAL_TMP}/ship/fixtures/v110" "${PLUGIN}" 1.1.0 main "${BUILD}" '[]' || FIXTURES="failed"
if [ "$FIXTURES" != "built" ]; then
  log_fail "The fixtures could not be built (npm install at the workspace root, npm run build -w packages/core/lib)"
  end_test
  exit $?
fi
log_pass "Fixtures built: ${SERVER_PACKAGE} 1.0.0 (no key directory) and 1.1.0 (agent.service.keysDir)"
ship_agent_facts_probe
start_stand_in_feria fixtures/v100/server fixtures/v100/agent fixtures/v110/server fixtures/v110/agent
ensure_app_host_helper
open_push_install "${POLICY_ID}" "[\"${AGENT_PACKAGE}\"]" '["install","update","uninstall"]'

INSTALL=$(install_approved "${PLUGIN}" "${SERVER_PACKAGE}@1.0.0")
assert_json_field "$INSTALL" '.plugin.version' '1.0.0' "Installed ${SERVER_PACKAGE}@1.0.0 and approved its agent half" || true
assert_json_field "$INSTALL" '.hooks.agentHalf.keysDir' 'null' "The approval preview names no key directory" || true
OP=$(host_plugin "${PLUGIN}" 300 nudge)
assert_json_field "$OP" '.status' 'succeeded' "Hosted on ${HOST_AGENT_LABEL} ($(json_get "$OP" '.error // .refused.error // ""'))" || true

PING=$(host_api_get "${PLUGIN}/ping")
INSTANCE=$(json_get "$PING" '.data.instance // empty')
assert_json_field "$PING" '.keys.dir' 'null' "The agent half is given no LAMASTE_APP_KEYS_DIR" || true
FACTS=$(agent_facts "${PLUGIN}" "${SERVICE_USER}")
assert_json_field "$FACTS" '.keys.dir' 'null' "No ${KEYS_DIR}" || true
assert_json_field "$FACTS" '[.unit.lines[] | select(test("app-keys|LAMASTE_APP_KEYS_DIR"))] | length' '0' "Its unit names no key directory" || true
assert_json_field "$FACTS" '.unit.props.ReadWritePaths' "${DATA_DIR}" "systemctl show: ReadWritePaths=${DATA_DIR} alone" || true
SANDBOX=$(host_api_get "${PLUGIN}/sandbox")
assert_json_field "$SANDBOX" '.writes.keysDir' 'UNSET' "Sandbox: no key directory to write" || true
assert_refused "$(json_get "$SANDBOX" '.writes.keysTree')" "Sandbox: the key tree is out of its reach" || true

# ===========================================================================
# 2. 1.1.0 asks for one: never auto-approved; made, named, writable
# ===========================================================================

log_section "1.1.0 asks for a key directory"

AUTO=$(host_api_call PUT "plugins/${PLUGIN}/hooks/auto-approve" '{"enabled":true}')
assert_eq "$(status_of "$AUTO")" "200" "Auto-approve is on for ${PLUGIN}" || true
UPDATE=$(host_api_post "plugins/${PLUGIN}/update" '{"version":"1.1.0"}')
assert_json_field "$UPDATE" '.pendingUpdate.version' '1.1.0' "The update waits for an administrator despite auto-approve" || true
assert_json_field "$UPDATE" '.pendingUpdate.autoApproveWithheld | tojson' '["it asks for a key directory on its agent (app host helper protocol 4)"]' "…withheld: it asks for a key directory" || true
assert_json_field "$UPDATE" '.pendingUpdate.agentHalf.keysDir' "${KEYS_DIR}" "The pending update shows the key directory it asks for" || true
assert_eq "$(audit_count "${PLUGIN}" hooks.auto-approve.withheld '.codes | index("agent-half.keys-dir") != null')" "1" "Audit: hooks.auto-approve.withheld, code agent-half.keys-dir" || true
assert_json_field "$(host_api_get "plugins/${PLUGIN}")" '.plugin.version' '1.0.0' "Until it is approved, 1.0.0 stays" || true

APPROVED=$(host_api_post "plugins/${PLUGIN}/hooks/approve" "{\"digest\":\"$(json_get "$UPDATE" '.pendingUpdate.digest')\"}")
OP=$(wait_operation "${PLUGIN}" "$(json_get "$APPROVED" '.operation.id // empty')" 300 nudge)
assert_json_field "$OP" '.status' 'succeeded' "The update succeeded ($(json_get "$OP" '.error // ""'))" || true
assert_json_field "$(host_api_get "plugins/${PLUGIN}/hooks")" '.hooks.agentHalf.keysDir' "${KEYS_DIR}" "The approved agent half has a key directory" || true

FACTS=$(agent_facts "${PLUGIN}" "${SERVICE_USER}")
assert_json_field "$FACTS" '.keys.tree | "\(.mode) \(.user)"' '755 root' "/var/lib/lamalibre/app-keys is root's, 0755" || true
assert_json_field "$FACTS" '.keys.dir | "\(.mode) \(.user) \(.group)"' "700 ${SERVICE_USER} ${SERVICE_USER}" "${KEYS_DIR}: 0700, the agent half's account's" || true
for line in "Environment=LAMASTE_APP_KEYS_DIR=${KEYS_DIR}" "ReadWritePaths=${DATA_DIR}" "ReadWritePaths=${KEYS_DIR}"; do
  assert_eq "$(echo "$FACTS" | jq --arg l "$line" '.unit.lines | index($l) != null' 2>/dev/null || echo false)" "true" "Unit: ${line}" || true
done
assert_json_field "$FACTS" '.unit.props.ReadWritePaths | split(" ") | sort | join(" ")' "${KEYS_DIR} ${DATA_DIR}" "systemctl show: ReadWritePaths= both directories" || true

PING=$(host_api_get "${PLUGIN}/ping")
assert_json_field "$PING" '.version' '1.1.0' "1.1.0 answers through the tunnel" || true
assert_json_field "$PING" '.data.instance' "${INSTANCE}" "…with the data 1.0.0 kept" || true
assert_json_field "$PING" '.keys.dir' "${KEYS_DIR}" "…given LAMASTE_APP_KEYS_DIR=${KEYS_DIR}" || true
assert_json_field "$PING" '.keys.instance' "${INSTANCE}" "…where it keeps its key" || true
KEY_SHA=$(json_get "$PING" '.keys.keySha256 // empty')
FACTS=$(agent_facts "${PLUGIN}" "${SERVICE_USER}")
assert_json_field "$FACTS" '.keys.files["link-key.json"] | "\(.mode) \(.user)"' "600 ${SERVICE_USER}" "The key file is 0600, the account's" || true
assert_json_field "$FACTS" '.keys.inDataTree | length' '0' "No key file anywhere under /var/lib/lamalibre/apps: a backup of it holds no key" || true
SANDBOX=$(host_api_get "${PLUGIN}/sandbox")
assert_json_field "$SANDBOX" '.writes.keysDir' 'ALLOWED' "Sandbox: it writes its key directory" || true
assert_json_field "$SANDBOX" '.writes.dataDir' 'ALLOWED' "Sandbox: …and its data directory" || true
assert_refused "$(json_get "$SANDBOX" '.writes.keysTree')" "Sandbox: the rest of the key tree stays out of its reach" || true

# ===========================================================================
# 3. Unhost: the key directory stays with the data
# ===========================================================================

log_section "Unhosting keeps the key directory"

UNHOST=$(host_api_delete "plugins/${PLUGIN}/hosting")
OP=$(wait_operation "${PLUGIN}" "$(json_get "$UNHOST" '.operation.id // empty')" 240 nudge)
assert_json_field "$OP" '.status' 'succeeded' "The unhosting succeeded ($(json_get "$OP" '.error // ""'))" || true
FACTS=$(agent_facts "${PLUGIN}" "${SERVICE_USER}")
assert_json_field "$FACTS" '.unit.file' 'false' "Unhosted: no unit" || true
assert_json_field "$FACTS" '.keys.dir | "\(.mode) \(.user)"' "700 ${SERVICE_USER}" "Unhosted: the key directory stays, still the account's" || true
assert_json_field "$FACTS" '.keys.files | keys | tojson' '["link-key.json"]' "…with the key in it" || true
assert_json_field "$FACTS" '.data.state.instance' "${INSTANCE}" "…and the data directory beside it" || true
RETAINED=$(host_api_get "plugins/${PLUGIN}/retained-data")
assert_json_field "$RETAINED" "[.retainedData[]? | select(.agentLabel == \"${HOST_AGENT_LABEL}\") | .keysDir] | first" "${KEYS_DIR}" "The relay's retained-data record names the key directory a purge deletes" || true

OP=$(host_plugin "${PLUGIN}" 300 nudge)
assert_json_field "$OP" '.status' 'succeeded' "Hosted again ($(json_get "$OP" '.error // .refused.error // ""'))" || true
PING=$(host_api_get "${PLUGIN}/ping")
assert_json_field "$PING" '.keys.keySha256' "${KEY_SHA}" "Hosted again, the agent half finds the same key" || true

# ===========================================================================
# 4. Purge: the key directory goes too
# ===========================================================================

log_section "Uninstalling with purge deletes the key directory"

FACTS_PORT=$(hosting_field "${PLUGIN}" '.hosting.port')
host_api_post "plugins/${PLUGIN}/disable" '{}' > /dev/null
UNINSTALL=$(host_api_delete "plugins/${PLUGIN}?purge=true")
OP=$(wait_operation "${PLUGIN}" "$(json_get "$UNINSTALL" '.operation.id // empty')" 240 nudge)
assert_json_field "$OP" '.status' 'succeeded' "Uninstalled with purge ($(json_get "$OP" '.error // ""'))" || true
FACTS=$(agent_facts "${PLUGIN}" "${SERVICE_USER}")
assert_json_field "$FACTS" '.keys.dir' 'null' "Purged: no key directory" || true
assert_json_field "$FACTS" '.keys.trash | "\(.mode) \(.user)"' '700 root' "…deleted through the key tree's root-only trash" || true
assert_json_field "$FACTS" '.keys.trashEntries' '0' "…which holds nothing afterwards" || true
assert_json_field "$FACTS" '.data.dir' 'null' "Purged: no data directory" || true
assert_json_field "$FACTS" '"\(.account.user) \(.account.group)"' 'null null' "Purged: no ${SERVICE_USER} account or group" || true

end_test

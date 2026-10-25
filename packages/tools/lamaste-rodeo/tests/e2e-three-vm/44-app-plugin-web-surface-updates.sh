#!/usr/bin/env bash
# ============================================================================
# 44 — App plugin web surface: updates and a rollback (Three-VM)
# ============================================================================
# Slice 7: what an update does to the tree a plugin's site serves. The
# fixture (@lamalibre/e2e-webupd-server, helpers.sh: write_app_install_fixture
# … wide <tag>) declares identity and `userSurface.web` on e2e44web; 1.0.0,
# 1.1.0 and 1.2.0 (a bad release: its agent half refuses its post stage)
# ship trees v1, v2 and v3 — each with a script and a page no other tree
# has (only-<tag>.js, page-<tag>.html). The site is created, the plugin
# approved and hosted, and a viewer signed in from the visitor VM:
#
# 1. Update to 1.1.0: the tree change waits for approval, its preview
#    listing the paths added, removed and changed, and the page it adds
#    among those to look at closely. Applied, `current` is v2 and `previous`
#    v1: a script only v1 has is still served (an open page's lazy file),
#    a page only v1 has is not — any path the current tree lacks but a
#    script, style, font or image gets the current shell.
# 2. Update to 1.2.0, rolled back by its failing post stage: its tree is
#    never served or stored — the switch is the update's last step.
#
# Creating, serving and deleting is spec 42; the move from a bound tunnel 43.
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

PLUGIN="e2e-webupd"
SERVER_PACKAGE="@lamalibre/e2e-webupd-server"
AGENT_PACKAGE="@lamalibre/e2e-webupd-agent"
SUB_W="e2e44web"
POLICY_ID="e2e-apphost-44"
REMOTE_DIR="/var/tmp/e2e-44-app-plugin"
LOCAL_TMP=""
CLEAN_PLUGINS="${PLUGIN}"
CLEAN_ROUTES="${PLUGIN}"
PURGE_PACKAGES=""
VIEWER="e2e44-viewer"
# A test credential for this run only, never printed
VIEWER_PASSWORD="E2e-$(openssl rand -hex 12)"
JAR_VIEWER="/tmp/e2e-44-viewer.cookies"
FQDN=""
VIEWER_ID=""
SITE_ID=""
TREE_1=""
TREE_2=""
TREE_3=""

# local_tree_sha <directory> — the web tree digest of a fixture's web/ (core's
# rule, from this workspace's build)
local_tree_sha() {
  node --input-type=module -e "
    const { webTreeManifestOfDirectory } = await import('${SCRIPT_DIR}/../../../../core/lib/dist/server/index.js');
    process.stdout.write((await webTreeManifestOfDirectory(process.argv[1])).sha256);
  " "$1" 2>/dev/null || echo ""
}

# shell_serves <tag> — the viewer gets index.html with tree <tag>'s marker
shell_serves() { [[ "$(visit_body "$(page "${JAR_VIEWER}" /)")" == *"E2E_WEB_$1"* ]]; }

# viewer_in_audience — the audience holds the viewer as an active member
viewer_in_audience() {
  [ "$(audience_row "${PLUGIN}" "${VIEWER_ID}" | jq -r '"\(.change.kind) \(.change.member.status)"' 2>/dev/null)" = "upsert active" ]
}

# update_to <version> — stage the update, approve the digest it shows and
# wait for the operation; leaves the pending update in UPDATE, the
# operation in OP
UPDATE=""
OP=""
update_to() {
  UPDATE=$(host_api_post "plugins/${PLUGIN}/update" "{\"version\":\"$1\"}")
  local approved
  approved=$(host_api_post "plugins/${PLUGIN}/hooks/approve" "{\"digest\":\"$(json_get "$UPDATE" '.pendingUpdate.digest')\"}")
  OP=$(wait_operation "${PLUGIN}" "$(json_get "$approved" '.operation.id // empty')" 300 nudge)
}

begin_test "44 — App plugin web surface: updates and a rollback (Three-VM)"

cleanup() {
  log_info "Cleaning up test resources..."
  local id
  host_api_delete "plugins/${PLUGIN}/web-surface" > /dev/null 2>&1 || true
  drop_plugin_grants "${PLUGIN}"
  timed_exec 60 multipass exec "${VISITOR_VM}" -- sudo bash -c "rm -f ${JAR_VIEWER}; sed -i '/${SUB_W}\\./d' /etc/hosts; true" > /dev/null 2>&1
  host_api_delete "users/${VIEWER}?erase=true" > /dev/null 2>&1 || true
  for id in ${VIEWER_ID}; do
    host_api_post "identity/directory/${id}/erase" '{}' > /dev/null 2>&1 || true
  done
  nudge_sync
  app_plugin_cleanup
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
log_section "Pre-flight"
# ---------------------------------------------------------------------------

app_plugin_preflight
FQDN="${SUB_W}.${DOMAIN}"
log_info "Hosting agent: ${HOST_AGENT_LABEL}, relay domain ${DOMAIN}, web surface ${FQDN}"
if agent_has_node_sqlite; then
  log_pass "The agent VM's Node.js has node:sqlite, which the agent half's projection needs"
else
  log_fail "The agent VM's Node.js has no unflagged node:sqlite (Node.js 22.13 or later): the identity fixture cannot run"
  end_test
  exit $?
fi
if visitor_has_oathtool; then
  log_pass "The visitor VM has oathtool (Authelia's second factor)"
else
  log_fail "The visitor VM has no oathtool: no one can sign in to reach the web surface"
  end_test
  exit $?
fi
# Leftovers of an interrupted run (rodeo ends a spec at ten minutes without its trap)
host_api_delete "plugins/${PLUGIN}/web-surface" > /dev/null 2>&1 || true
drop_plugin_grants "${PLUGIN}"
host_api_delete "users/${VIEWER}?erase=true" > /dev/null 2>&1 || true

# ===========================================================================
# 1. Fixtures, the site, the plugin served, the viewer signed in
# ===========================================================================

log_section "Fixtures; the site created, the plugin approved and hosted; the viewer signed in"

LOCAL_TMP=$(mktemp -d /tmp/e2e-44-app-plugin-XXXXXXXX)
BUILD="r$(date +%s)-$$"
FIXTURES="built"
write_app_install_fixture "${LOCAL_TMP}/ship/fixtures/v100" "${PLUGIN}" 1.0.0 main "${BUILD}" '[]' none wide v1 "${SUB_W}" || FIXTURES="failed"
write_app_install_fixture "${LOCAL_TMP}/ship/fixtures/v110" "${PLUGIN}" 1.1.0 main "${BUILD}" '[]' none wide v2 "${SUB_W}" || FIXTURES="failed"
write_app_install_fixture "${LOCAL_TMP}/ship/fixtures/v120" "${PLUGIN}" 1.2.0 failpost "${BUILD}" '[]' none wide v3 "${SUB_W}" || FIXTURES="failed"
if [ "$FIXTURES" != "built" ]; then
  log_fail "The fixtures could not be built (npm install at the workspace root, npm run build -w packages/core/lib)"
  end_test
  exit $?
fi
TREE_1=$(local_tree_sha "${LOCAL_TMP}/ship/fixtures/v100/server/web")
TREE_2=$(local_tree_sha "${LOCAL_TMP}/ship/fixtures/v110/server/web")
TREE_3=$(local_tree_sha "${LOCAL_TMP}/ship/fixtures/v120/server/web")
assert_eq "$(printf '%s\n' "${TREE_1}" "${TREE_2}" "${TREE_3}" | grep -cE '^[a-f0-9]{64}$' || true)" "3" "Fixtures built: ${SERVER_PACKAGE} 1.0.0, 1.1.0, 1.2.0 (a bad release) with trees v1, v2, v3" || true
ship_agent_facts_probe
start_stand_in_feria fixtures/v100/server fixtures/v100/agent fixtures/v110/server fixtures/v110/agent \
  fixtures/v120/server fixtures/v120/agent
ensure_app_host_helper
open_push_install "${POLICY_ID}" "[\"${AGENT_PACKAGE}\"]" '["install","update","uninstall"]'

RESP=$(users_call POST "users" "{\"username\":\"${VIEWER}\",\"displayname\":\"E2E Viewer\",\"email\":\"${VIEWER}@example.test\",\"password\":\"${VIEWER_PASSWORD}\",\"groups\":[]}")
assert_eq "$(status_of "$RESP")" "201" "User ${VIEWER} created" || true
VIEWER_ID=$(json_get "$(body_of "$RESP")" '.user.userId // empty')

INSTALL=$(host_api_post "plugins/install" "{\"packageName\":\"${SERVER_PACKAGE}@1.0.0\"}")
assert_json_field "$INSTALL" '.plugin.version' '1.0.0' "Installed ${SERVER_PACKAGE}@1.0.0" || true
RESP=$(host_api_call POST "plugins/${PLUGIN}/web-surface" '{}')
assert_eq "$(status_of "$RESP")" "201" "POST /api/plugins/${PLUGIN}/web-surface: the site ${FQDN}" || true
SITE_ID=$(json_get "$(body_of "$RESP")" '.webSurface.site.id // empty')
visitor_exec "grep -q '${FQDN}' /etc/hosts || echo '${HOST_IP} ${FQDN}' >> /etc/hosts" > /dev/null 2>&1 || true

DIGEST=$(json_get "$(host_api_get "plugins/${PLUGIN}/hooks")" '.hooks.approval.digest // empty')
APPROVED=$(host_api_post "plugins/${PLUGIN}/hooks/approve" "{\"digest\":\"${DIGEST}\"}")
assert_json_field "$APPROVED" '.hooks.approval.state' 'approved' "Approved: its agent half, identity block and web tree" || true
host_api_post "plugins/${PLUGIN}/enable" '{}' > /dev/null
OP=$(host_plugin "${PLUGIN}" 300 nudge)
assert_json_field "$OP" '.status' 'succeeded' "Hosted on ${HOST_AGENT_LABEL} ($(json_get "$OP" '.error // .refused.error // ""'))" || true
if wait_for 120 web_served "${PLUGIN}"; then
  log_pass "Served: approved, hosted, tree v1 current"
else
  log_fail "Not served: $(web_surface "${PLUGIN}" | jq -c '{served, reason, tree}')"
fi
assert_eq "$(tree_link "${PLUGIN}" current) $(tree_dirs "${PLUGIN}")" "${TREE_1} ${TREE_1}" "The store: current → tree v1, the only tree" || true

RESP=$(host_api_call PUT "plugins/${PLUGIN}/entitlements" "{\"principalType\":\"user\",\"principalId\":\"${VIEWER}\",\"roles\":[\"viewer\"]}")
assert_eq "$(status_of "$RESP")" "200" "${VIEWER} entitled as viewer" || true
if wait_for 30 viewer_in_audience; then
  log_pass "…an active member of the audience"
else
  log_fail "The audience: $(audience_row "${PLUGIN}" "${VIEWER_ID}")"
fi
SECRET_V=$(reset_totp "${VIEWER}")
wait_for_next_totp_window
assert_eq "$(sign_in "${VIEWER}" "${VIEWER_PASSWORD}" "${SECRET_V}" "${JAR_VIEWER}" "${FQDN}")" "OK OK" "${VIEWER} signed in from the visitor VM" || true
if wait_for 30 shell_serves v1; then
  log_pass "GET / as ${VIEWER}: index.html of tree v1"
else
  log_fail "GET / as ${VIEWER}: $(page_status "${JAR_VIEWER}" /)"
fi

# ===========================================================================
# 2. Update to 1.1.0
# ===========================================================================

log_section "Update to 1.1.0: the paths it changes shown, tree v2 approved with it, v1 kept as previous"

update_to 1.1.0
assert_json_field "$UPDATE" '"\(.pendingUpdate.web.before) \(.pendingUpdate.web.after.sha256) \(.pendingUpdate.web.after.files)"' "${TREE_1} ${TREE_2} 5" "The update waited for approval, showing tree v1 → v2 (5 files)" || true
CHANGES=$(json_get "$UPDATE" '.pendingUpdate.web.changes | "\(.added.paths | join(",")) | \(.removed.paths | join(",")) | \(.changed.paths | join(","))"')
assert_eq "$CHANGES" "app-v2.js,only-v2.js,page-v2.html | app-v1.js,only-v1.js,page-v1.html | index.html,style.css" "…by path: added, removed, changed" || true
assert_json_field "$UPDATE" '.pendingUpdate.web.changes.review | join(",")' 'page-v2.html' "…and the page it adds among those to look at closely" || true
assert_json_field "$OP" '.status' 'succeeded' "The update succeeded ($(json_get "$OP" '.error // ""'))" || true
assert_eq "$(tree_link "${PLUGIN}" current) $(tree_link "${PLUGIN}" previous)" "${TREE_2} ${TREE_1}" "current → tree v2, previous → tree v1" || true
if wait_for 30 shell_serves v2; then
  log_pass "GET /: index.html of tree v2"
else
  log_fail "GET / after the update: $(visit_body "$(page "${JAR_VIEWER}" /)" | head -c 200)"
fi
assert_eq "$(page_status "${JAR_VIEWER}" /only-v2.js)" "200" "A script of tree v2: 200" || true
assert_contains "$(visit_body "$(page "${JAR_VIEWER}" /only-v1.js)")" "only = 'v1'" "A script only tree v1 has is still served — from the previous tree" || true
OLD_PAGE=$(visit_body "$(page "${JAR_VIEWER}" /page-v1.html)")
assert_not_contains "$OLD_PAGE" "E2E_PAGE_v1" "A page only tree v1 has is not served from the previous tree…" || true
assert_contains "$OLD_PAGE" "E2E_WEB_v2" "…the path gets the current shell" || true
assert_json_field "$(web_surface "${PLUGIN}")" '"\(.served) \(.tree.approved)"' "true ${TREE_2}" "Served; the approved tree is v2" || true

# ===========================================================================
# 3. Update to 1.2.0, rolled back
# ===========================================================================

log_section "Update to 1.2.0 rolled back: its tree never served"

update_to 1.2.0
assert_json_field "$UPDATE" '.pendingUpdate.web.after.sha256' "${TREE_3}" "1.2.0 waited for approval with tree v3" || true
assert_json_field "$OP" '.status' 'rolled-back' "The update was rolled back ($(json_get "$OP" '.error // ""'))" || true
assert_json_field "$(host_api_get "plugins/${PLUGIN}")" '.plugin.version' '1.1.0' "The plugin is 1.1.0 again" || true
KEPT_TREES=$(printf '%s\n' "${TREE_1}" "${TREE_2}" | sort | paste -sd, -)
assert_eq "$(tree_link "${PLUGIN}" current) $(tree_link "${PLUGIN}" previous) $(tree_dirs "${PLUGIN}")" "${TREE_2} ${TREE_1} ${KEPT_TREES}" "current still tree v2, previous v1; tree v3 never entered the store" || true
if wait_for 30 shell_serves v2; then
  log_pass "GET /: still tree v2"
else
  log_fail "GET / after the rollback: $(visit_body "$(page "${JAR_VIEWER}" /)" | head -c 200)"
fi

end_test

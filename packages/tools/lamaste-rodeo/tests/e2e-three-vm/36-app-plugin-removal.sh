#!/usr/bin/env bash
# ============================================================================
# 36 — App plugin agent half: removal and refusals (Three-VM)
# ============================================================================
# An app plugin whose agent half Lamaste installs (fixture
# @lamalibre/e2e-apphost-rm-server, helpers.sh), hosted on the agent VM from
# the panel as in spec 34:
#
# 1. Unhosting (default) removes the unit and its socket unit — nothing
#    listens on the hosting's port afterwards — the code and the config, the
#    tunnel, the secret and the capability; the agent half's data directory
#    and account stay.
# 2. The stand-in Feria then serves other bytes under the pinned version
#    (a consistent packument, a new integrity): hosting again fails at
#    "install the agent half" — the agent fetched the tarball and refused it
#    against the integrity the relay pinned — and leaves nothing behind, no
#    socket unit either.
# 3. With the published bytes back, hosting again finds the data the
#    unhosting kept; uninstalling with purge then removes the units (the
#    port released), the data directory and the account too.
# 4. A plugin whose agent package declares `dependencies` (fixture
#    @lamalibre/e2e-apphost-deps-server) fails at "install the agent half":
#    the agent's root helper refuses a package that is not bundled; nothing
#    is left.
# 5. With the agent's push-install window closed, hosting is refused.
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

PLUGIN="e2e-apphost-rm"
SERVER_PACKAGE="@lamalibre/e2e-apphost-rm-server"
AGENT_PACKAGE="@lamalibre/e2e-apphost-rm-agent"
AGENT_TARBALL="e2e-apphost-rm-agent-1.0.0.tgz"
SERVICE_USER="lamaste-app-e2e-apphost-rm"
DEPS_PLUGIN="e2e-apphost-deps"
DEPS_SERVER_PACKAGE="@lamalibre/e2e-apphost-deps-server"
DEPS_AGENT_PACKAGE="@lamalibre/e2e-apphost-deps-agent"
DEPS_SERVICE_USER="lamaste-app-e2e-apphost-deps"
POLICY_ID="e2e-apphost-36"
REMOTE_DIR="/var/tmp/e2e-36-app-plugin"
LOCAL_TMP=""
CLEAN_PLUGINS="${PLUGIN} ${DEPS_PLUGIN}"
CLEAN_ROUTES="${PLUGIN} ${DEPS_PLUGIN}"
PURGE_PACKAGES=""

# stub_put_tarball <file on the host VM> — publish it on the stand-in Feria
# (replacing the version it holds); prints the registry's answer
stub_put_tarball() {
  host_exec "curl -s --max-time 30 -X PUT -H 'Authorization: Bearer ${STUB_ADMIN_TOKEN}' -H 'Content-Type: application/octet-stream' --data-binary @$1 'http://127.0.0.1:${STUB_PORT}/-/e2e/packages'"
}

# assert_nothing_installed <facts json> <message prefix> — no unit, socket
# unit, code or config of the agent half on the agent VM
assert_nothing_installed() {
  assert_json_field "$1" '"\(.unit.file) \(.unit.props.LoadState)"' 'false not-found' "$2: no unit" || true
  assert_json_field "$1" '"\(.socket.file) \(.socket.props.LoadState)"' 'false not-found' "$2: no socket unit" || true
  assert_json_field "$1" '"\(.code.dir) \(.config.dir)"' 'null null' "$2: no code, no config" || true
  assert_json_field "$1" '.apphostRecord' 'null' "$2: not in the agent's record" || true
}

# assert_port_released <facts json> <message prefix> — nothing listens on
# the hosting's port (FACTS_PORT) on the agent VM any more
assert_port_released() {
  assert_json_field "$1" '"\(.listen.port) \(.listen.listeners | length)"' "${FACTS_PORT} 0" "$2: nothing listens on port ${FACTS_PORT}: the socket let go of it" || true
}

begin_test "36 — App plugin agent half: removal and refusals (Three-VM)"

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
# 1. Install and host
# ===========================================================================

log_section "Install and host the plugin"

LOCAL_TMP=$(mktemp -d /tmp/e2e-36-app-plugin-XXXXXXXX)
BUILD="r$(date +%s)-$$"
FIXTURES="built"
write_app_install_fixture "${LOCAL_TMP}/ship/fixtures/main" "${PLUGIN}" 1.0.0 main "${BUILD}" '[]' || FIXTURES="failed"
write_app_install_fixture "${LOCAL_TMP}/ship/fixtures/deps" "${DEPS_PLUGIN}" 1.0.0 deps "${BUILD}" '[]' || FIXTURES="failed"
# Same package and version as fixtures/main, other bytes: what a registry
# serving something else under a published version hands out.
write_app_install_fixture "${LOCAL_TMP}/tampered" "${PLUGIN}" 1.0.0 tampered "${BUILD}" '[]' || FIXTURES="failed"
TAMPERED=$(npm pack "${LOCAL_TMP}/tampered/agent" --pack-destination "${LOCAL_TMP}/ship" --json --loglevel=error 2>/dev/null | jq -r '.[0].filename // empty' 2>/dev/null || echo "")
if [ "$FIXTURES" != "built" ] || [ -z "$TAMPERED" ]; then
  log_fail "The fixtures could not be built (npm install at the workspace root, npm run build -w packages/core/lib)"
  end_test
  exit $?
fi
mv "${LOCAL_TMP}/ship/$(basename "${TAMPERED}")" "${LOCAL_TMP}/ship/tampered.tgz"
log_pass "Fixtures built: ${SERVER_PACKAGE}, ${DEPS_SERVER_PACKAGE} and a tampered ${AGENT_PACKAGE}@1.0.0"
ship_agent_facts_probe
start_stand_in_feria fixtures/main/server fixtures/main/agent fixtures/deps/server fixtures/deps/agent
ensure_app_host_helper
open_push_install "${POLICY_ID}" "[\"${AGENT_PACKAGE}\",\"${DEPS_AGENT_PACKAGE}\"]" '["install","uninstall"]' > /dev/null

INSTALL=$(install_approved "${PLUGIN}" "${SERVER_PACKAGE}@1.0.0")
assert_json_field "$INSTALL" '.plugin.version' '1.0.0' "Installed ${SERVER_PACKAGE}@1.0.0 and approved its agent half" || true
PINNED=$(json_get "$INSTALL" '.hooks.agentHalf.integrity')
assert_eq "$PINNED" "$(feria_integrity "${AGENT_PACKAGE}" 1.0.0)" "The relay pinned the integrity the stand-in Feria publishes" || true
OP=$(host_plugin "${PLUGIN}" 300 nudge)
assert_json_field "$OP" '.status' 'succeeded' "Hosted on ${HOST_AGENT_LABEL} ($(json_get "$OP" '.error // .refused.error // ""'))" || true
INSTANCE=$(json_get "$(host_api_get "${PLUGIN}/ping")" '.data.instance // empty')
if [ -n "$INSTANCE" ]; then
  log_pass "The agent half answers through the tunnel (its data: instance ${INSTANCE})"
else
  log_fail "The agent half does not answer through the tunnel"
fi
FACTS_PORT=$(hosting_field "${PLUGIN}" '.hosting.port')
FACTS=$(agent_facts "${PLUGIN}" "${SERVICE_USER}")
assert_json_field "$FACTS" '"\(.socket.props.ActiveState) \(.listen.listeners | length)"' 'active 1' "Its socket unit holds port ${FACTS_PORT}" || true

# ===========================================================================
# 2. Unhost: the data and the account stay
# ===========================================================================

log_section "Unhosting keeps the agent half's data and account"

UNHOST=$(host_api_delete "plugins/${PLUGIN}/hosting")
OP=$(wait_operation "${PLUGIN}" "$(json_get "$UNHOST" '.operation.id // empty')" 240 nudge)
assert_json_field "$OP" '.status' 'succeeded' "The unhosting succeeded ($(json_get "$OP" '.error // ""'))" || true
for step in 'agent uninstall:pre-teardown' 'remove the tunnel' 'agent uninstall:post-teardown' 'remove the agent half' 'revoke the secret and the capability'; do
  assert_eq "$(step_status "$OP" "$step")" "done" "Step: ${step}" || true
done
assert_eq "$(audit_count "${PLUGIN}" plugin.agent-half.removed '.purge == false')" "1" "Audit: plugin.agent-half.removed, data kept" || true
assert_relay_clean "${PLUGIN}" "Unhosted"
FACTS=$(agent_facts "${PLUGIN}" "${SERVICE_USER}")
assert_nothing_installed "$FACTS" "Unhosted"
assert_port_released "$FACTS" "Unhosted"
assert_json_field "$FACTS" '.data.dir | "\(.mode) \(.user)"' "700 ${SERVICE_USER}" "Unhosted: the data directory stays, still the account's" || true
assert_json_field "$FACTS" '.data.state.instance' "${INSTANCE}" "…with the agent half's data in it" || true
assert_json_field "$FACTS" '.account.user != null' 'true' "Unhosted: the account ${SERVICE_USER} stays" || true
if wait_for 90 agent_copy_gone "${PLUGIN}"; then
  log_pass "Unhosted: the agent dropped its copy of the plugin config"
else
  log_fail "Unhosted: the agent still holds a plugin config for ${PLUGIN}"
fi

# ===========================================================================
# 3. Other bytes under the pinned version
# ===========================================================================

log_section "A tarball that is not the pinned one is refused"

# The published tarball, kept aside to be served again afterwards.
KEPT=$(host_exec "curl -sf --max-time 30 -H 'Authorization: Bearer ${STUB_ADMIN_TOKEN}' -o ${REMOTE_DIR}/original.tgz 'http://127.0.0.1:${STUB_PORT}/${AGENT_PACKAGE}/-/${AGENT_TARBALL}' && echo \"sha512-\$(openssl dgst -sha512 -binary ${REMOTE_DIR}/original.tgz | base64 -w0)\"" 2>/dev/null || echo "")
assert_eq "$KEPT" "$PINNED" "The published tarball (the pinned bytes) is kept aside" || true
REPLACED=$(stub_put_tarball "${REMOTE_DIR}/tampered.tgz")
assert_json_field "$REPLACED" '"\(.name)@\(.version) \(.replaced)"' "${AGENT_PACKAGE}@1.0.0 true" "The stand-in Feria now serves other bytes as ${AGENT_PACKAGE}@1.0.0" || true
TAMPERED_INTEGRITY=$(json_get "$REPLACED" '.integrity')
assert_not_eq "$TAMPERED_INTEGRITY" "$PINNED" "…whose integrity is not the pinned one" || true
assert_eq "$(feria_integrity "${AGENT_PACKAGE}" 1.0.0)" "$TAMPERED_INTEGRITY" "…and its packument says so: npm itself has nothing to object to" || true
REQUEST_MARK=$(stub_get "-/e2e/requests" | jq '.requests | length' 2>/dev/null || echo "0")

OP=$(host_plugin "${PLUGIN}" 240 nudge)
assert_json_field "$OP" '.status' 'failed' "Hosting failed" || true
assert_eq "$(step_status "$OP" 'install the agent half')" "failed" "…at install the agent half" || true
assert_contains "$(json_get "$OP" '.error')" "does not match the integrity the panel pinned" "…the agent refused the tarball against the pinned integrity" || true
assert_eq "$(step_status "$OP" 'grant the tunnel and wait for the agent half')" "absent" "The tunnel was never granted" || true
PULLS=$(stub_get "-/e2e/requests" | jq -c --argjson m "${REQUEST_MARK:-0}" "[.requests[\$m:][] | select(.method == \"GET\" and (.path | endswith(\"/${AGENT_TARBALL}\")))]" 2>/dev/null || echo '[]')
assert_json_field "$PULLS" "[.[] | select(.owner == \"agent:${HOST_AGENT_LABEL}\" and .status == 200)] | length > 0" 'true' "agent:${HOST_AGENT_LABEL} did fetch the republished tarball" || true
assert_relay_clean "${PLUGIN}" "Refused"
FACTS=$(agent_facts "${PLUGIN}" "${SERVICE_USER}")
assert_nothing_installed "$FACTS" "Refused"
assert_json_field "$FACTS" '.data.state.instance' "${INSTANCE}" "Refused: the kept data is untouched" || true
if wait_for 90 agent_copy_gone "${PLUGIN}"; then
  log_pass "Refused: the agent dropped its copy of the plugin config"
else
  log_fail "Refused: the agent still holds a plugin config for ${PLUGIN}"
fi

# ===========================================================================
# 4. Hosting again finds the data; purge removes it
# ===========================================================================

log_section "Hosting again finds the kept data; purge removes it"

RESTORED=$(stub_put_tarball "${REMOTE_DIR}/original.tgz")
assert_json_field "$RESTORED" '.integrity' "${PINNED}" "The stand-in Feria serves the published bytes again" || true
OP=$(host_plugin "${PLUGIN}" 300 nudge)
assert_json_field "$OP" '.status' 'succeeded' "Hosted again ($(json_get "$OP" '.error // .refused.error // ""'))" || true
PING=$(host_api_get "${PLUGIN}/ping")
assert_json_field "$PING" '.data.instance' "${INSTANCE}" "The agent half found the data the unhosting kept" || true
FACTS_PORT=$(hosting_field "${PLUGIN}" '.hosting.port')

host_api_post "plugins/${PLUGIN}/disable" '{}' > /dev/null
UNINSTALL=$(host_api_delete "plugins/${PLUGIN}?purge=true")
OP=$(wait_operation "${PLUGIN}" "$(json_get "$UNINSTALL" '.operation.id // empty')" 240 nudge)
assert_json_field "$OP" '.status' 'succeeded' "Uninstalled with purge ($(json_get "$OP" '.error // ""'))" || true
assert_eq "$(host_api_get_status "plugins/${PLUGIN}")" "404" "The plugin is gone from the relay" || true
assert_relay_clean "${PLUGIN}" "Purged"
FACTS=$(agent_facts "${PLUGIN}" "${SERVICE_USER}")
assert_nothing_installed "$FACTS" "Purged"
assert_port_released "$FACTS" "Purged"
assert_json_field "$FACTS" '.data.dir' 'null' "Purged: no data directory" || true
assert_json_field "$FACTS" '"\(.account.user) \(.account.group)"' 'null null' "Purged: no ${SERVICE_USER} account or group" || true

# ===========================================================================
# 5. An agent package with dependencies
# ===========================================================================

log_section "An agent package that is not bundled is refused"

INSTALL=$(install_approved "${DEPS_PLUGIN}" "${DEPS_SERVER_PACKAGE}@1.0.0")
assert_json_field "$INSTALL" '.hooks.agentHalf.package' "${DEPS_AGENT_PACKAGE}" "Installed ${DEPS_SERVER_PACKAGE}; its agent half is ${DEPS_AGENT_PACKAGE}" || true
OP=$(host_plugin "${DEPS_PLUGIN}" 240 nudge)
assert_json_field "$OP" '.status' 'failed' "Hosting failed" || true
assert_eq "$(step_status "$OP" 'install the agent half')" "failed" "…at install the agent half" || true
assert_contains "$(json_get "$OP" '.error')" "must be bundled, but it declares dependencies" "…the agent's helper refused a package with dependencies" || true
assert_relay_clean "${DEPS_PLUGIN}" "Refused"
FACTS=$(agent_facts "${DEPS_PLUGIN}" "${DEPS_SERVICE_USER}")
assert_nothing_installed "$FACTS" "Refused"
assert_json_field "$FACTS" '"\(.data.dir) \(.account.user)"' 'null null' "Refused: no data directory, no account" || true

# ===========================================================================
# 6. The agent's window closed
# ===========================================================================

log_section "With the agent's push-install window closed, hosting is refused"

host_api_delete "plugins/push-install/enable/${HOST_AGENT_LABEL}" > /dev/null
REFUSED=$(host_api_call POST "plugins/${DEPS_PLUGIN}/hosting" "{\"agentLabel\":\"${HOST_AGENT_LABEL}\"}")
assert_eq "$(status_of "$REFUSED")" "403" "Hosting is refused (403)" || true
assert_json_field "$(body_of "$REFUSED")" '.code' 'push_install_refused' "…push_install_refused ($(json_get "$(body_of "$REFUSED")" '.error'))" || true
assert_eq "$(host_api_get_status "plugins/${DEPS_PLUGIN}/hosting")" "404" "Nothing was started" || true

host_api_post "plugins/${DEPS_PLUGIN}/disable" '{}' > /dev/null
assert_eq "$(status_of "$(host_api_call DELETE "plugins/${DEPS_PLUGIN}")")" "200" "${DEPS_PLUGIN}, never hosted, is uninstalled at once" || true

end_test

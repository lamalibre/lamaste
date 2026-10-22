#!/usr/bin/env bash
# ============================================================================
# 35 — App plugin agent half: rotation, reboot, update (Three-VM)
# ============================================================================
# An app plugin whose agent half Lamaste installs (fixture
# @lamalibre/e2e-apphost-ops-server, helpers.sh: 1.0.0, 1.1.0 and a bad
# 1.2.0 whose agent half refuses install:post-tunnel) is hosted on the agent
# VM from the panel as in spec 34, then operated:
#
# 1. A secret rotation reaches the service's copy of the plugin config before
#    the relay sees it acknowledged; the service is not restarted for it,
#    the socket unit not touched (same file, listening since before), and
#    calls keep working.
# 2. Systemd holds the port (the socket unit beside the agent half's): an
#    unprivileged process can bind neither 127.0.0.1:<port> nor
#    0.0.0.0:<port> (EADDRINUSE) while the agent half runs, nor while its
#    service is stopped — the socket stays active, systemd alone holds the
#    port — and a connection starts the agent half again. Restarted, then
#    killed with SIGKILL (Restart=always) while a client calls it without
#    pause, it refuses no connection and comes back with a new MainPID.
# 3. A reboot of the agent VM brings the socket, the unit, the tunnel and
#    the pages back by themselves, the agent half on systemd's socket
#    (descriptor 3); its data and the rotated secret are kept.
# 4. An update to 1.1.0 waits for approval (its agent half changed), then the
#    new agent half is installed and activated before the relay package:
#    current → 1.1.0, previous 1.0.0, data kept; the old version answered
#    the pre stage, the new one the post stage. A new process, the same
#    socket: it listened throughout.
# 5. An update to 1.2.0 whose post stage fails is rolled back: the helper
#    activates 1.1.0 again and the relay package is restored — the socket
#    still the one from boot.
#
# The agent's sync is nudged while operations run (the unit its timer
# starts) so the spec stays inside rodeo's ten minutes; spec 34 shows the
# timer alone hosting a plugin. The cleanup uninstalls with purge.
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

PLUGIN="e2e-apphost-ops"
SERVER_PACKAGE="@lamalibre/e2e-apphost-ops-server"
AGENT_PACKAGE="@lamalibre/e2e-apphost-ops-agent"
SERVICE_USER="lamaste-app-e2e-apphost-ops"
UNIT="lamalibre-app-e2e-apphost-ops.service"
SOCKET_UNIT="lamalibre-app-e2e-apphost-ops.socket"
CONFIG_FILE="/etc/lamalibre/apps/e2e-apphost-ops/plugin-config.json"
POLICY_ID="e2e-apphost-35"
REMOTE_DIR="/var/tmp/e2e-35-app-plugin"
# Another local process: it must get nothing of the agent half's port
SQUATTER_USER="nobody"
LOCAL_TMP=""
CLEAN_PLUGINS="${PLUGIN}"
CLEAN_ROUTES="${PLUGIN}"
PURGE_PACKAGES=""

# service_issued_at — issuedAt of the service's copy of the plugin config
# (that field only: the file holds the secret)
service_issued_at() {
  agent_exec "node -p \"JSON.parse(require('fs').readFileSync('${CONFIG_FILE}', 'utf8')).issuedAt\"" 2>/dev/null || echo ""
}

# main_pid — the agent half's MainPID (0 while it is not running)
main_pid() { agent_exec "systemctl show -p MainPID --value ${UNIT}" 2>/dev/null || echo "0"; }

# unit_active — the agent half's service is active
unit_active() { [ "$(agent_exec "systemctl is-active ${UNIT}" 2>/dev/null)" = "active" ]; }

# new_main_pid <pid> — the service is active under another MainPID than <pid>
new_main_pid() {
  local pid
  pid=$(main_pid)
  [ -n "$pid" ] && [ "$pid" != "0" ] && [ "$pid" != "$1" ] && unit_active
}

begin_test "35 — App plugin agent half: rotation, reboot, update (Three-VM)"

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
# 1. Install and host 1.0.0
# ===========================================================================

log_section "Install and host the plugin (1.0.0)"

LOCAL_TMP=$(mktemp -d /tmp/e2e-35-app-plugin-XXXXXXXX)
BUILD="r$(date +%s)-$$"
FIXTURES="built"
write_app_install_fixture "${LOCAL_TMP}/ship/fixtures/v100" "${PLUGIN}" 1.0.0 main "${BUILD}" '[]' || FIXTURES="failed"
write_app_install_fixture "${LOCAL_TMP}/ship/fixtures/v110" "${PLUGIN}" 1.1.0 main "${BUILD}" '[]' || FIXTURES="failed"
write_app_install_fixture "${LOCAL_TMP}/ship/fixtures/v120" "${PLUGIN}" 1.2.0 failpost "${BUILD}" '[]' || FIXTURES="failed"
if [ "$FIXTURES" != "built" ]; then
  log_fail "The fixtures could not be built (npm install at the workspace root, npm run build -w packages/core/lib)"
  end_test
  exit $?
fi
log_pass "Fixtures built: ${SERVER_PACKAGE} 1.0.0, 1.1.0 and 1.2.0 (a bad release) with their agent packages"
ship_agent_facts_probe
start_stand_in_feria fixtures/v100/server fixtures/v100/agent fixtures/v110/server fixtures/v110/agent \
  fixtures/v120/server fixtures/v120/agent
ensure_app_host_helper
open_push_install "${POLICY_ID}" "[\"${AGENT_PACKAGE}\"]" '["install","update","uninstall"]'

INSTALL=$(install_approved "${PLUGIN}" "${SERVER_PACKAGE}@1.0.0")
assert_json_field "$INSTALL" '.plugin.version' '1.0.0' "Installed ${SERVER_PACKAGE}@1.0.0 and approved its agent half" || true
OP=$(host_plugin "${PLUGIN}" 300 nudge)
assert_json_field "$OP" '.status' 'succeeded' "Hosted on ${HOST_AGENT_LABEL} ($(json_get "$OP" '.error // .refused.error // ""'))" || true
PING=$(host_api_get "${PLUGIN}/ping")
assert_json_field "$PING" '"\(.version) \(.user)"' "1.0.0 ${SERVICE_USER}" "Agent half 1.0.0 answers through the tunnel as ${SERVICE_USER}" || true
INSTANCE=$(json_get "$PING" '.data.instance')
PORT=$(hosting_field "${PLUGIN}" '.hosting.port')
FACTS_PORT="${PORT}"

# ===========================================================================
# 2. Rotation
# ===========================================================================

log_section "A rotation reaches the service's copy before it is acknowledged"

FACTS=$(agent_facts "${PLUGIN}" "${SERVICE_USER}")
PID_BEFORE=$(json_get "$FACTS" '.unit.props.MainPID')
SOCKET_SHA=$(json_get "$FACTS" '.socket.sha256')
SOCKET_SINCE=$(json_get "$FACTS" '.socket.props.ActiveEnterTimestamp')
assert_json_field "$FACTS" '.socket.props | "\(.ActiveState) \(.Listen)"' "active 127.0.0.1:${PORT} (Stream)" "${SOCKET_UNIT} listens on 127.0.0.1:${PORT} (since ${SOCKET_SINCE})" || true
ISSUED_BEFORE=$(hosting_field "${PLUGIN}" '.hosting.secretIssuedAt')
assert_json_field "$FACTS" '.config.issuedAt' "${ISSUED_BEFORE}" "The service's copy holds the current secret" || true
SYNC_MARK=$(sync_log_lines)
ROTATE=$(host_api_post "plugins/${PLUGIN}/hosting/rotate-secret" '{}')
assert_json_field "$ROTATE" '.hosting.rotationPending' 'true' "Rotation pending" || true
ISSUED_NEW=$(json_get "$ROTATE" '.hosting.secretIssuedAt')
assert_not_eq "$ISSUED_NEW" "$ISSUED_BEFORE" "A new secret was issued" || true
assert_json_field "$(host_api_get "${PLUGIN}/ping")" '.pong' 'true' "Calls keep working while the rotation is pending" || true

# Each round reads the relay first, then the service's copy: a copy still
# old once the relay has the acknowledgement would mean the agent
# acknowledged a secret its service did not hold.
ACK_EXPR="(.hosting.secretAcknowledged == true) and (.hosting.rotationPending == false) and (.hosting.secretIssuedAt == \"${ISSUED_NEW}\")"
ACKED="no"
ORDER="kept"
deadline=$((SECONDS + 90))
while [ "$SECONDS" -lt "$deadline" ]; do
  nudge_sync
  if [ "$(hosting_field "${PLUGIN}" "${ACK_EXPR}")" = "true" ]; then
    ACKED="yes"
    if [ "$(service_issued_at)" != "$ISSUED_NEW" ]; then ORDER="broken"; fi
    break
  fi
  sleep 2
done
assert_eq "$ACKED" "yes" "The relay has the new secret acknowledged" || true
assert_eq "$ORDER" "kept" "…and by then the service's copy held it: written before the acknowledgement" || true
FACTS=$(agent_facts "${PLUGIN}" "${SERVICE_USER}")
assert_json_field "$FACTS" '.config.issuedAt' "${ISSUED_NEW}" "${CONFIG_FILE} carries the new secret" || true
assert_json_field "$FACTS" '.config.secretMatchesAgentCopy' 'true' "…the one the agent holds" || true
assert_json_field "$FACTS" '.config.file | "\(.mode) \(.user)"' "600 ${SERVICE_USER}" "…still 0600, the account's" || true
assert_json_field "$FACTS" '.unit.props.MainPID' "${PID_BEFORE}" "The service was not restarted: it re-reads its config on a signature it cannot verify" || true
assert_json_field "$FACTS" '.socket.sha256' "${SOCKET_SHA}" "The socket unit's file is unchanged: a rotation does not move the port" || true
assert_json_field "$FACTS" '.socket.props.ActiveEnterTimestamp' "${SOCKET_SINCE}" "…and the socket kept listening (active since ${SOCKET_SINCE})" || true
assert_contains "$(sync_log_since "$SYNC_MARK")" "plugin config delivered to its service: ${PLUGIN}" "The agent's sync delivered it (sync.log)" || true
assert_json_field "$(host_api_get "${PLUGIN}/ping")" '.pong' 'true' "Calls work on the new secret" || true

# ===========================================================================
# 3. Systemd holds the port
# ===========================================================================

log_section "Systemd holds the port: the agent half stopped, restarted or killed"

BOUND=$(port_probe bind "${PORT}" "${SQUATTER_USER}")
assert_json_field "$BOUND" '"\(.["127.0.0.1"]) \(.["0.0.0.0"])"' 'EADDRINUSE EADDRINUSE' "While the agent half runs, ${SQUATTER_USER} can bind neither 127.0.0.1:${PORT} nor 0.0.0.0:${PORT}" || true

# Stopped by hand, the agent half leaves the port to systemd alone. The
# relay's health probe — a connection through the tunnel every 10 s — starts
# it again, so port-probe.mjs stops it and samples at once, and the sample
# counts only when the service stayed stopped throughout (valid).
STOPPED='{}'
for _ in 1 2 3; do
  STOPPED=$(port_probe stopped "${PLUGIN}" "${PORT}" "${SQUATTER_USER}")
  if [ "$(json_get "$STOPPED" '.valid')" = "true" ]; then break; fi
  sleep 1
done
assert_json_field "$STOPPED" '.valid' 'true' "systemctl stop ${UNIT}: sampled while it stayed stopped" || true
assert_json_field "$STOPPED" '.socket | "\(.ActiveState) \(.SubState) \(.Listen)"' "active listening 127.0.0.1:${PORT} (Stream)" "${SOCKET_UNIT} stays active, listening on 127.0.0.1:${PORT}" || true
assert_json_field "$STOPPED" '"\(.listeners | length) \([.listeners[].users[].pid | tostring] | unique | join(","))"' '1 1' "ss: systemd (pid 1) alone holds the port" || true
assert_json_field "$STOPPED" '"\(.binds["127.0.0.1"]) \(.binds["0.0.0.0"])"' 'EADDRINUSE EADDRINUSE' "…and ${SQUATTER_USER} can bind neither 127.0.0.1:${PORT} nor 0.0.0.0:${PORT}: no window to take it" || true
WOKEN=$(agent_exec "curl -s -o /dev/null -w '%{http_code}' --max-time 20 http://127.0.0.1:${PORT}/admin/health" 2>/dev/null || echo "000")
assert_eq "$WOKEN" "401" "A connection to the port finds the agent half again: systemd started it for the connection waiting on its socket" || true
if wait_for 30 new_main_pid "${PID_BEFORE}"; then
  log_pass "${UNIT} is active again (MainPID $(main_pid))"
else
  log_fail "${UNIT} did not come back: $(agent_exec "systemctl is-active ${UNIT}" 2>/dev/null)"
fi
assert_json_field "$(host_api_get "${PLUGIN}/ping")" '.pong' 'true' "The pages answer through the tunnel" || true

# A client calling the agent half without pause (port-probe.mjs loop: a new
# connection per request) while it is restarted, then killed: connections
# wait on systemd's socket for the next process — none is refused.
PID_A=$(main_pid)
agent_exec "rm -f ${REMOTE_DIR}/loop.json; nohup node ${REMOTE_DIR}/port-probe.mjs loop ${PORT} 24 ${REMOTE_DIR}/loop.json > /dev/null 2>&1 & exit" > /dev/null 2>&1 || true
sleep 3
agent_exec "systemctl restart ${UNIT}" > /dev/null 2>&1 || true
PID_B=""
if wait_for 30 new_main_pid "${PID_A}"; then PID_B=$(main_pid); fi
assert_not_eq "${PID_B:-0}" "0" "systemctl restart: a new agent half (MainPID ${PID_A} → ${PID_B:-none})" || true
sleep 2
PID_C=""
if [ -n "${PID_B}" ]; then
  agent_exec "kill -9 ${PID_B}" > /dev/null 2>&1 || true
  if wait_for 40 new_main_pid "${PID_B}"; then PID_C=$(main_pid); fi
fi
assert_not_eq "${PID_C:-0}" "0" "kill -9: Restart=always brings a new one (MainPID ${PID_B:-none} → ${PID_C:-none})" || true
loop_done() { [ "$(agent_exec "test -s ${REMOTE_DIR}/loop.json && echo done" 2>/dev/null)" = "done" ]; }
wait_for 60 loop_done || true
LOOP=$(agent_exec "cat ${REMOTE_DIR}/loop.json" 2>/dev/null || echo '{}')
[ -n "$LOOP" ] || LOOP='{}'
assert_json_field "$LOOP" '.requests >= 20' 'true' "The client made $(json_get "$LOOP" '.requests') requests across the restart and the kill (longest wait $(json_get "$LOOP" '.longestMs') ms)" || true
assert_json_field "$LOOP" '.errors.ECONNREFUSED // 0' '0' "…none refused: the port was never closed" || true
assert_json_field "$LOOP" '.statuses | keys | join(",")' '401' "…every answer the agent half's (401 to a bare call)" || true
assert_json_field "$LOOP" '[.errors | to_entries[] | .value] | add // 0 | . <= 2' 'true' "…at most the requests in flight at the two stops cut ($(json_get "$LOOP" '.errors | tostring'))" || true
FACTS=$(agent_facts "${PLUGIN}" "${SERVICE_USER}")
assert_json_field "$FACTS" '.socket.props.ActiveEnterTimestamp' "${SOCKET_SINCE}" "${SOCKET_UNIT} listened throughout: active since ${SOCKET_SINCE}" || true
assert_json_field "$FACTS" '.listen.fd3Inode != null and .listen.fd3Inode == .listen.listeners[0].inode' 'true' "The new agent half was handed the same listening socket (descriptor 3)" || true
assert_json_field "$(host_api_get "${PLUGIN}/ping")" '.pong' 'true' "The pages answer" || true

# ===========================================================================
# 4. Reboot
# ===========================================================================

log_section "A reboot of the agent VM brings it all back"

STARTS_BEFORE=$(json_get "$(host_api_get "${PLUGIN}/ping")" '.data.starts // 0')
log_info "Restarting ${AGENT_VM}"
timed_exec 180 multipass restart "${AGENT_VM}" > /dev/null 2>&1
vm_up() { [ "$(timed_exec 20 multipass exec "${AGENT_VM}" -- echo up 2>/dev/null)" = "up" ]; }
if wait_for 180 vm_up; then
  log_pass "The agent VM is back"
else
  log_fail "The agent VM did not come back within 180 seconds"
fi
if wait_for 120 unit_active; then
  log_pass "${UNIT} started at boot"
else
  log_fail "${UNIT} is not active after the reboot"
fi
pages_back() { [ "$(json_get "$(host_api_get "${PLUGIN}/ping" 2>/dev/null)" '.pong')" = "true" ]; }
if wait_for 180 pages_back; then
  log_pass "The tunnel is up again: the pages answer"
else
  log_fail "The pages do not answer after the reboot"
fi
PING=$(host_api_get "${PLUGIN}/ping")
assert_json_field "$PING" '"\(.version) \(.user)"' "1.0.0 ${SERVICE_USER}" "Agent half 1.0.0, as ${SERVICE_USER}" || true
assert_json_field "$PING" '.data.instance' "${INSTANCE}" "Its data survived the reboot" || true
assert_json_field "$PING" ".data.starts > ${STARTS_BEFORE:-0}" 'true' "…and it was started again (start $(json_get "$PING" '.data.starts'))" || true
assert_json_field "$PING" '.listen | "\(.mode) \(.fd)"' 'systemd-socket 3' "…on systemd's socket, descriptor 3" || true
FACTS=$(agent_facts "${PLUGIN}" "${SERVICE_USER}")
assert_json_field "$FACTS" '.unit.processUser' "${SERVICE_USER}" "Its process is ${SERVICE_USER}'s" || true
assert_json_field "$FACTS" '.config.issuedAt' "${ISSUED_NEW}" "The service's copy kept the rotated secret" || true
assert_json_field "$FACTS" '.socket.props | "\(.ActiveState) \(.UnitFileState) \(.Listen)"' "active enabled 127.0.0.1:${PORT} (Stream)" "${SOCKET_UNIT} came back at boot, listening on 127.0.0.1:${PORT}" || true
PID_BOOT=$(json_get "$FACTS" '.unit.props.MainPID')
assert_json_field "$FACTS" "[.listen.listeners[0].users[]?.pid] | any(.[]; . == 1) and any(.[]; . == ${PID_BOOT:-0})" 'true' "ss: the listening socket is systemd's and the agent half's (MainPID ${PID_BOOT})" || true
assert_json_field "$FACTS" '.listen.fd3Inode != null and .listen.fd3Inode == .listen.listeners[0].inode' 'true' "The agent half's descriptor 3 is that socket" || true
# From here on the socket must outlive every new agent half process.
SOCKET_SINCE=$(json_get "$FACTS" '.socket.props.ActiveEnterTimestamp')
assert_eq "$(user_systemctl "is-active ${SYNC_TIMER} 2>/dev/null || true")" "active" "The agent's sync timer runs again" || true
health_up() { [ "$(hosting_field "${PLUGIN}" '.hosting.health.state')" = "up" ]; }
if wait_for 90 health_up; then
  log_pass "The relay's health of the hosting is up"
else
  log_fail "Health: $(hosting_field "${PLUGIN}" '.hosting.health')"
fi

# ===========================================================================
# 5. Update to 1.1.0
# ===========================================================================

log_section "Update to 1.1.0: approved, the new agent half first"

UPDATE=$(host_api_post "plugins/${PLUGIN}/update" '{"version":"1.1.0"}')
assert_json_field "$UPDATE" '.pendingUpdate.version' '1.1.0' "The update waits for approval: its agent half changed" || true
assert_json_field "$UPDATE" '.pendingUpdate.agentHalf.integrity' "$(feria_integrity "${AGENT_PACKAGE}" 1.1.0)" "…pinned to the integrity of ${AGENT_PACKAGE}@1.1.0" || true
assert_json_field "$(host_api_get "plugins/${PLUGIN}")" '.plugin.version' '1.0.0' "Until it is approved, 1.0.0 stays" || true
EPOCH=$(agent_epoch)
APPROVED=$(host_api_post "plugins/${PLUGIN}/hooks/approve" "{\"digest\":\"$(json_get "$UPDATE" '.pendingUpdate.digest')\"}")
OP=$(wait_operation "${PLUGIN}" "$(json_get "$APPROVED" '.operation.id // empty')" 300 nudge)
assert_json_field "$OP" '.status' 'succeeded' "The update succeeded ($(json_get "$OP" '.error // ""'))" || true
for step in 'agent install:pre-tunnel' 'install the new agent half' 'install the new version' 'agent install:post-tunnel'; do
  assert_eq "$(step_status "$OP" "$step")" "done" "Step: ${step}" || true
done
assert_eq "$(step_order "$OP" 'install the new agent half' 'install the new version')" "true" "The agent half was switched before the relay package" || true
FACTS=$(agent_facts "${PLUGIN}" "${SERVICE_USER}")
assert_json_field "$FACTS" '"\(.code.current) \(.code.previous)"' '1.1.0 1.0.0' "current → 1.1.0, previous → 1.0.0" || true
assert_json_field "$FACTS" '.code.versions | join(",")' '1.0.0,1.1.0' "Both versions are kept" || true
assert_json_field "$FACTS" '.unit.props.ActiveState' 'active' "${UNIT} is active" || true
PID_UPDATED=$(json_get "$FACTS" '.unit.props.MainPID')
assert_not_eq "${PID_UPDATED}" "${PID_BOOT}" "…as a new process (MainPID ${PID_BOOT} → ${PID_UPDATED})" || true
assert_json_field "$FACTS" '.socket.props.ActiveEnterTimestamp' "${SOCKET_SINCE}" "…on the same socket: ${SOCKET_UNIT} listened throughout the update (since ${SOCKET_SINCE})" || true
PING=$(host_api_get "${PLUGIN}/ping")
assert_json_field "$PING" '.version' '1.1.0' "The pages come from 1.1.0" || true
assert_json_field "$PING" '.data.instance' "${INSTANCE}" "…which found the data 1.0.0 left" || true
assert_json_field "$(host_api_get "plugins/${PLUGIN}")" '.plugin.version' '1.1.0' "The relay package is 1.1.0" || true
assert_json_field "$(host_api_get "plugins/${PLUGIN}/hosting")" '.hosting.agentHalf.version' '1.1.0' "The relay records agent half 1.1.0" || true
JOURNAL=$(unit_journal_since "${UNIT}" "${EPOCH}")
assert_contains "$JOURNAL" "hook install:pre-tunnel phase=upgrade version=1.0.0" "1.0.0 answered the pre stage" || true
assert_contains "$JOURNAL" "hook install:post-tunnel phase=upgrade version=1.1.0" "1.1.0 answered the post stage" || true
assert_eq "$(audit_count "${PLUGIN}" plugin.agent-half.installed '.phase == "upgrade" and .version == "1.1.0"')" "1" "Audit: plugin.agent-half.installed for the upgrade" || true

# ===========================================================================
# 6. Update to 1.2.0, a bad release
# ===========================================================================

log_section "Update to 1.2.0: its post stage fails, 1.1.0 comes back"

UPDATE=$(host_api_post "plugins/${PLUGIN}/update" '{"version":"1.2.0"}')
assert_json_field "$UPDATE" '.pendingUpdate.version' '1.2.0' "1.2.0 waits for approval" || true
EPOCH=$(agent_epoch)
APPROVED=$(host_api_post "plugins/${PLUGIN}/hooks/approve" "{\"digest\":\"$(json_get "$UPDATE" '.pendingUpdate.digest')\"}")
OP=$(wait_operation "${PLUGIN}" "$(json_get "$APPROVED" '.operation.id // empty')" 300 nudge)
assert_json_field "$OP" '.status' 'rolled-back' "The update was rolled back" || true
assert_contains "$(json_get "$OP" '.error')" "refuses install:post-tunnel" "…because the 1.2.0 agent half refused its post stage" || true
assert_eq "$(step_status "$OP" 'install the new agent half')" "done" "1.2.0 had been installed and activated" || true
assert_eq "$(step_status "$OP" 'agent install:post-tunnel')" "failed" "Its post stage failed" || true
assert_eq "$(step_status "$OP" 'restore the previous version')" "done" "The relay package was restored" || true
assert_eq "$(step_status "$OP" 'activate the previous agent half')" "done" "The previous agent half was activated" || true
FACTS=$(agent_facts "${PLUGIN}" "${SERVICE_USER}")
assert_json_field "$FACTS" '"\(.code.current) \(.code.previous)"' '1.1.0 1.2.0' "current → 1.1.0 again (previous → 1.2.0)" || true
assert_json_field "$FACTS" '.code.versions | join(",")' '1.1.0,1.2.0' "Only the current and the previous version are kept" || true
assert_json_field "$FACTS" '.unit.props.ActiveState' 'active' "${UNIT} is active" || true
assert_not_eq "$(json_get "$FACTS" '.unit.props.MainPID')" "${PID_UPDATED}" "…as a new process again (MainPID ${PID_UPDATED} → $(json_get "$FACTS" '.unit.props.MainPID'))" || true
assert_json_field "$FACTS" '.socket.props.ActiveEnterTimestamp' "${SOCKET_SINCE}" "…on the socket from boot: it listened through 1.2.0 and the rollback" || true
PING=$(host_api_get "${PLUGIN}/ping")
assert_json_field "$PING" '.version' '1.1.0' "The pages come from 1.1.0" || true
assert_json_field "$PING" '.data.instance' "${INSTANCE}" "…with the data kept throughout" || true
assert_json_field "$(host_api_get "plugins/${PLUGIN}")" '.plugin.version' '1.1.0' "The relay package is 1.1.0 again" || true
assert_json_field "$(host_api_get "plugins/${PLUGIN}/hosting")" '.hosting.agentHalf.version' '1.1.0' "The relay records agent half 1.1.0" || true
assert_json_field "$(host_api_get "plugins/${PLUGIN}/hooks")" '.hooks.approval.state' 'approved' "1.1.0's approval stands" || true
assert_contains "$(unit_journal_since "${UNIT}" "${EPOCH}")" "hook install:post-tunnel phase=upgrade version=1.2.0" "1.2.0 was asked, and refused" || true
assert_eq "$(audit_count "${PLUGIN}" plugin.agent-half.activated '.version == "1.1.0" and .from == "1.2.0"')" "1" "Audit: plugin.agent-half.activated 1.1.0" || true
assert_eq "$(audit_count "${PLUGIN}" plugin.update.reverted '.to == "1.2.0"')" "1" "Audit: plugin.update.reverted" || true

end_test

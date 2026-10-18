#!/usr/bin/env bash
# ============================================================================
# 34 — App plugin installed onto an agent from the panel (Three-VM)
# ============================================================================
# Slice 3's proof. An app plugin whose agent half Lamaste installs — fixture
# @lamalibre/e2e-apphost-server with its bundled agent package
# @lamalibre/e2e-apphost-agent (helpers.sh, write_app_install_fixture) — is
# hosted on the agent VM from the panel; on the VM only the operator's
# one-time step is done by hand:
#
# 1. A stand-in Feria on the host VM serves the fixture; the panel installs
#    from it and holds its registry credential (OIDC), which brokers the
#    agent's read tokens. Installing pins the agent half (package, version,
#    tarball integrity); the approval preview shows it with its service
#    account, unit and the system package it brings (sqlite3).
# 2. Hosting is refused before approval and while the agent cannot host it
#    (no app host helper); the operator enables the helper
#    (`lamaste-agent apphost enable --user root`: the rodeo agent runs as
#    root, so no sudoers rule) and the agent's sync reports it to the relay
#    in its host facts.
# 3. Hosting is refused with push-install off and with the agent's window
#    closed; with the window open, under a policy naming only the agent
#    package, it runs on the agent's sync timer alone: the agent fetches
#    exactly the pinned tarball with its brokered token, checks the
#    integrity and has the helper install it; the pipeline's hooks run in
#    the installed service.
# 4. On the agent VM: the unit runs as lamaste-app-e2e-apphost, with the
#    paths, owners and modes of the installer contract, sqlite3 installed by
#    apt, the hardening applied, its config 0600 holding the agent's secret
#    (compared on the VM, never printed); its sandbox lets it write its data
#    directory only, and send UDP.
# 5. Systemd holds the agent half's port: beside the unit, the socket unit
#    lamalibre-app-e2e-apphost.socket (root 0644, ListenStream on the
#    hosting's port, no secret), active and enabled, which the unit requires
#    (Restart=always, no core dumps, no drop-in); ss shows the one listening
#    socket shared by systemd (pid 1) and the agent half, whose descriptor 3
#    it is.
# 6. Through the tunnel the admin pages answer from the installed version;
#    the stand-in Feria's record shows agent:<label> pulling the tarball.
# 7. Uninstalling with purge leaves no unit, socket unit, listener on the
#    port, code, config, data, account, tunnel, secret or capability.
#
# Rotation, reboot and updates are spec 35; unhosting, a wrong integrity, a
# package with dependencies and a closed window are spec 36 — rodeo gives a
# spec ten minutes.
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

PLUGIN="e2e-apphost"
SERVER_PACKAGE="@lamalibre/e2e-apphost-server"
AGENT_PACKAGE="@lamalibre/e2e-apphost-agent"
SERVICE_USER="lamaste-app-e2e-apphost"
UNIT="lamalibre-app-e2e-apphost.service"
SOCKET_UNIT="lamalibre-app-e2e-apphost.socket"
CODE_DIR="/opt/lamalibre/apps/e2e-apphost"
DATA_DIR="/var/lib/lamalibre/apps/e2e-apphost"
CONFIG_FILE="/etc/lamalibre/apps/e2e-apphost/plugin-config.json"
SYSTEM_PACKAGE="sqlite3"
POLICY_ID="e2e-apphost-34"
REMOTE_DIR="/var/tmp/e2e-34-app-plugin"
LOCAL_TMP=""
CLEAN_PLUGINS="${PLUGIN}"
CLEAN_ROUTES="${PLUGIN}"
PURGE_PACKAGES=""

begin_test "34 — App plugin installed onto an agent from the panel (Three-VM)"

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
# 1. The fixture, the stand-in Feria and the panel's registry credential
# ===========================================================================

log_section "Stand-in Feria and the panel's registry credential"

LOCAL_TMP=$(mktemp -d /tmp/e2e-34-app-plugin-XXXXXXXX)
if ! write_app_install_fixture "${LOCAL_TMP}/ship/fixtures/v1" "${PLUGIN}" 1.0.0 main "r$(date +%s)-$$" "[\"${SYSTEM_PACKAGE}\"]"; then
  log_fail "The fixture could not be built (npm install at the workspace root, npm run build -w packages/core/lib)"
  end_test
  exit $?
fi
log_pass "Fixture built: ${SERVER_PACKAGE} and its bundled agent package ${AGENT_PACKAGE} 1.0.0"
ship_agent_facts_probe
start_stand_in_feria fixtures/v1/server fixtures/v1/agent
PINNED=$(feria_integrity "${AGENT_PACKAGE}" 1.0.0)
assert_contains "$PINNED" "sha512-" "The stand-in Feria publishes ${AGENT_PACKAGE}@1.0.0 with a sha512 integrity" || true

# ===========================================================================
# 2. Install: the agent half is pinned and previewed
# ===========================================================================

log_section "Install: the agent half is pinned and shown for approval"

FACTS=$(agent_facts "${PLUGIN}" "${SERVICE_USER}" "${SYSTEM_PACKAGE}")
PACKAGE_BEFORE=$(json_get "$FACTS" ".packages[\"${SYSTEM_PACKAGE}\"]")
APT_RUNS_BEFORE=$(json_get "$FACTS" ".aptRuns[\"${SYSTEM_PACKAGE}\"] // 0")
if [ "$PACKAGE_BEFORE" != "install ok installed" ]; then
  # Lamaste installs it; the cleanup puts the VM back as it was.
  PURGE_PACKAGES="${SYSTEM_PACKAGE}"
fi
log_info "${SYSTEM_PACKAGE} on the agent VM before: ${PACKAGE_BEFORE:-absent}"

INSTALL=$(host_api_post "plugins/install" "{\"packageName\":\"${SERVER_PACKAGE}@1.0.0\"}")
assert_json_field "$INSTALL" '.plugin.version' '1.0.0' "Installed ${SERVER_PACKAGE}@1.0.0 from the stand-in Feria" || true
assert_json_field "$INSTALL" '.plugin.hosting' 'agent' "…an agent-hosted plugin" || true
PREVIEW=$(echo "$INSTALL" | jq -c '.hooks.agentHalf' 2>/dev/null || echo 'null')
assert_json_field "$PREVIEW" '.package' "${AGENT_PACKAGE}" "Preview: the agent package Lamaste installs" || true
assert_json_field "$PREVIEW" '.version' '1.0.0' "Preview: at the plugin's version" || true
assert_json_field "$PREVIEW" '.integrity' "${PINNED}" "Preview: the tarball integrity, pinned from the registry at install" || true
assert_json_field "$PREVIEW" '.systemPackages | join(",")' "${SYSTEM_PACKAGE}" "Preview: the system package it brings" || true
assert_json_field "$PREVIEW" '.serviceUser' "${SERVICE_USER}" "Preview: the service account" || true
assert_json_field "$PREVIEW" '.unitName' "${UNIT}" "Preview: the unit" || true
assert_json_field "$PREVIEW" '"\(.entry) \(.memoryMax)"' 'dist/agentd.mjs 256M' "Preview: the service entry and its memory limit" || true
assert_json_field "$INSTALL" '.hooks.approval.state' 'pending' "Its approval is pending" || true
DIGEST=$(json_get "$INSTALL" '.hooks.approval.digest // empty')
HOOKS=$(host_api_get "plugins/${PLUGIN}/hooks")
assert_json_field "$HOOKS" '.hooks.agentHalf.integrity' "${PINNED}" "GET /plugins/${PLUGIN}/hooks shows the same agent half" || true
host_api_post "plugins/${PLUGIN}/enable" '{}' > /dev/null

# ===========================================================================
# 3. Refused: not approved; an agent without the app host helper
# ===========================================================================

log_section "Refused before approval and on an agent that cannot host it"

REFUSED=$(host_api_call POST "plugins/${PLUGIN}/hosting" "{\"agentLabel\":\"${HOST_AGENT_LABEL}\"}")
assert_eq "$(status_of "$REFUSED")" "409" "Hosting an unapproved agent half is refused (409)" || true
assert_json_field "$(body_of "$REFUSED")" '.code' 'hooks_not_approved' "…hooks_not_approved" || true
APPROVE=$(host_api_post "plugins/${PLUGIN}/hooks/approve" "{\"digest\":\"${DIGEST}\"}")
assert_json_field "$APPROVE" '.hooks.approval.state' 'approved' "Approved with the digest the preview showed" || true

# The facts the relay holds must be the agent's current ones: a spec that
# just disabled the helper is reported by the agent's next sync.
facts_current() {
  local facts
  facts=$(agent_host_facts)
  [ -n "$facts" ] && [ "$facts" != "null" ] || return 1
  [ "$(app_host_helper_was_enabled)" = "true" ] || [ "$(json_get "$facts" '.apphost')" = "null" ]
}
if wait_for 90 facts_current; then
  log_pass "The relay holds the agent's current host facts"
else
  log_fail "The relay's host facts of ${HOST_AGENT_LABEL} are missing or stale: $(agent_host_facts)"
fi
if [ "$(app_host_helper_was_enabled)" = "true" ]; then
  log_skip "The app host helper was enabled before this spec: an agent without it is not shown"
else
  ELIGIBILITY=$(host_api_get "plugins/${PLUGIN}/hosting/eligibility" | jq -c ".agents[]? | select(.label == \"${HOST_AGENT_LABEL}\")" 2>/dev/null || echo '{}')
  assert_json_field "$ELIGIBILITY" '.eligible' 'false' "Eligibility: ${HOST_AGENT_LABEL} cannot host it yet" || true
  assert_contains "$(json_get "$ELIGIBILITY" '.reasons | join(" / ")')" "app host helper is not enabled" "…the app host helper is not enabled" || true
  REFUSED=$(host_api_call POST "plugins/${PLUGIN}/hosting" "{\"agentLabel\":\"${HOST_AGENT_LABEL}\"}")
  assert_eq "$(status_of "$REFUSED")" "409" "Hosting on it is refused (409)" || true
  assert_json_field "$(body_of "$REFUSED")" '.code' 'agent_not_eligible' "…agent_not_eligible, with the reasons" || true
fi

# ===========================================================================
# 4. The operator's one-time step on the agent VM
# ===========================================================================

log_section "The operator's step: lamaste-agent apphost enable"

NODE_ON_AGENT=$(agent_exec "/usr/bin/node -p process.versions.node" 2>/dev/null || echo "")
# The helper runs only app jobs the relay signed, verified with the relay's
# key that enable pins for each agent on the machine.
RELAY_KID=$(relay_kid_on_host)
assert_eq "$(echo "${RELAY_KID}" | grep -cE '^[a-f0-9]{32}$')" "1" "The relay signs with key ${RELAY_KID}" || true
if [ "$(app_host_helper_was_enabled)" != "true" ]; then
  APPHOST_ENABLED_HERE=1
  ENABLE_OUT=$(agent_exec "lamaste-agent apphost enable --user root --json 2>&1" 2>/dev/null || echo "")
  ENABLE_JSON=$(echo "$ENABLE_OUT" | grep -E '^\{' | tail -n 1 || echo '{}')
  assert_json_field "$ENABLE_JSON" '.ok' 'true' "apphost enable --user root ($(echo "$ENABLE_OUT" | tail -c 200))" || true
  assert_json_field "$ENABLE_JSON" '.protocol' '2' "…installed the helper, protocol 2" || true
  assert_json_field "$ENABLE_JSON" '.sudoers' 'null' "…and no sudoers rule: the agent runs as root" || true
  assert_json_field "$ENABLE_JSON" "[.relays[]? | select(.label == \"${AGENT_LABEL}\")] | first | \"\(.kid) \(.agent)\"" "${RELAY_KID} ${HOST_AGENT_LABEL}" "…and pinned the relay's key for ${AGENT_LABEL}, with the name the relay knows it by" || true
else
  # Enabled before this spec: the relay's key pinned again (it may have changed).
  PIN_JSON=$(agent_exec "lamaste-agent apphost pin --json 2>&1" 2>/dev/null | grep -E '^\{' | tail -n 1 || echo '{}')
  assert_json_field "$PIN_JSON" '.ok' 'true' "apphost pin: the relay's key pinned again" || true
fi
assert_eq "$(agent_relay_kid)" "${RELAY_KID}" "GET /api/agents/me/relay-keys, from the agent: the key the relay signs with" || true
STATUS=$(agent_exec "lamaste-agent apphost status --json 2>/dev/null" 2>/dev/null | grep -E '^\{' | tail -n 1 || echo '{}')
assert_json_field "$STATUS" ".relays[\"${AGENT_LABEL}\"].kid" "${RELAY_KID}" "apphost status: ${AGENT_LABEL} has that key pinned" || true
assert_eq "$(agent_exec "stat -c '%a %U:%G' /etc/lamalibre/apphost/relays/${AGENT_LABEL}.json" 2>/dev/null || echo "")" "644 root:root" "…in /etc/lamalibre/apphost/relays/${AGENT_LABEL}.json, root:root 0644" || true
assert_json_field "$STATUS" '.helper.installed' 'true' "apphost status: the helper is installed" || true
assert_json_field "$STATUS" '.helper.upToDate' 'true' "…the one this lamaste-agent ships" || true
assert_json_field "$STATUS" '.helper.node' "${NODE_ON_AGENT}" "…on /usr/bin/node ${NODE_ON_AGENT}, what the agent halves run on" || true
FACTS=$(agent_facts "${PLUGIN}" "${SERVICE_USER}")
assert_json_field "$FACTS" '.helper | "\(.mode) \(.user):\(.group)"' '755 root:root' "${APPHOST_HELPER} is root:root 0755" || true
if [ -n "${APPHOST_ENABLED_HERE}" ]; then
  assert_json_field "$FACTS" '.sudoersRule' 'false' "No /etc/sudoers.d/lamaste-apphost for a root agent" || true
fi

if wait_for_app_host_facts 120; then
  log_pass "The agent's sync reported the helper to the relay"
else
  log_fail "The relay's host facts name no app host helper: $(agent_host_facts)"
fi
HOST_FACTS=$(agent_host_facts)
assert_json_field "$HOST_FACTS" '"\(.os) \(.systemd)"' 'linux true' "Host facts: Linux, systemd" || true
assert_json_field "$HOST_FACTS" '.apphost.version' '2' "Host facts: helper protocol 2" || true
assert_json_field "$HOST_FACTS" '.apphost.node' "${NODE_ON_AGENT}" "Host facts: the helper's Node.js" || true
assert_json_field "$HOST_FACTS" '.apphost.relayKid' "${RELAY_KID}" "Host facts: the relay key the helper verifies jobs with" || true
assert_json_field "$HOST_FACTS" '.distro.id == "ubuntu" or ((.distro.idLike // []) | index("debian") != null)' 'true' "Host facts: a Debian-family distribution ($(json_get "$HOST_FACTS" '.distro.id') $(json_get "$HOST_FACTS" '.distro.versionId'))" || true
ELIGIBILITY=$(host_api_get "plugins/${PLUGIN}/hosting/eligibility" | jq -c ".agents[]? | select(.label == \"${HOST_AGENT_LABEL}\")" 2>/dev/null || echo '{}')
assert_json_field "$ELIGIBILITY" '"\(.eligible) \(.reasons | length)"' 'true 0' "Eligibility: ${HOST_AGENT_LABEL} can host it now" || true

# ===========================================================================
# 5. The push-install gates
# ===========================================================================

log_section "Refused by the push-install gates; the window opened"

remember_push_install
host_api_patch "plugins/push-install/config" '{"enabled":false}' > /dev/null
REFUSED=$(host_api_call POST "plugins/${PLUGIN}/hosting" "{\"agentLabel\":\"${HOST_AGENT_LABEL}\"}")
assert_eq "$(status_of "$REFUSED")" "400" "Push-install off: hosting is refused" || true
assert_json_field "$(body_of "$REFUSED")" '.code' 'push_install_refused' "…push_install_refused ($(json_get "$(body_of "$REFUSED")" '.error'))" || true

host_api_patch "plugins/push-install/config" '{"enabled":true}' > /dev/null
PUSH_WINDOW=1
host_api_delete "plugins/push-install/enable/${HOST_AGENT_LABEL}" > /dev/null 2>&1 || true
REFUSED=$(host_api_call POST "plugins/${PLUGIN}/hosting" "{\"agentLabel\":\"${HOST_AGENT_LABEL}\"}")
assert_eq "$(status_of "$REFUSED")" "403" "Push-install on, the agent's window closed: hosting is refused" || true
assert_json_field "$(body_of "$REFUSED")" '.code' 'push_install_refused' "…push_install_refused ($(json_get "$(body_of "$REFUSED")" '.error'))" || true

WINDOW=$(open_push_install "${POLICY_ID}" "[\"${AGENT_PACKAGE}\"]" '["install","uninstall"]')
assert_json_field "$WINDOW" '.pushInstallPolicy' "${POLICY_ID}" "The agent's window is open, under a policy naming only ${AGENT_PACKAGE}" || true

# ===========================================================================
# 6. Hosting from the panel; the agent's sync timer does the rest
# ===========================================================================

log_section "Hosting: nothing more is done on the agent VM"

SYNC_MARK=$(sync_log_lines)
HOST_EPOCH=$(agent_epoch)
HOSTED=$(host_api_post "plugins/${PLUGIN}/hosting" "{\"agentLabel\":\"${HOST_AGENT_LABEL}\"}")
OP_ID=$(json_get "$HOSTED" '.operation.id // empty')
if [ -z "$OP_ID" ]; then
  log_fail "Hosting did not start: ${HOSTED}"
  end_test
  exit $?
fi
log_pass "Hosting on ${HOST_AGENT_LABEL} started (operation ${OP_ID})"
# Only the relay is polled while it runs: the agent's own sync timer fetches
# the config, runs the app-install and hook jobs and takes up the grant.
OP=$(wait_operation "${PLUGIN}" "${OP_ID}" 360)
assert_json_field "$OP" '.status' 'succeeded' "The hosting operation succeeded ($(json_get "$OP" '.error // ""'))" || true
for step in 'reserve port, secret and capability' 'install the agent half' 'agent install:pre-tunnel' 'grant the tunnel and wait for the agent half' 'agent install:post-tunnel' 'activate'; do
  assert_eq "$(step_status "$OP" "$step")" "done" "Step: ${step}" || true
done
assert_eq "$(step_order "$OP" 'install the agent half' 'agent install:pre-tunnel')" "true" "The agent half was installed before its first hook ran" || true

HOSTING=$(host_api_get "plugins/${PLUGIN}/hosting")
PORT=$(json_get "$HOSTING" '.hosting.port')
# Who listens on it is read on the agent VM from now on — after the purge too.
FACTS_PORT="${PORT}"
assert_json_field "$HOSTING" '.hosting.phase' 'active' "The hosting is active" || true
assert_json_field "$HOSTING" '.hosting.agentHalf.version' '1.0.0' "The relay records agent half 1.0.0 on ${HOST_AGENT_LABEL}" || true
if [ "$PORT" -ge 21000 ] 2>/dev/null && [ "$PORT" -le 21999 ] 2>/dev/null; then
  log_pass "Port ${PORT} assigned from the internal range"
else
  log_fail "Port ${PORT} is not in 21000–21999"
fi
SESSION=$(host_api_get "plugins/push-install/sessions" | jq -c "[.sessions[]? | select(.operationId == \"${OP_ID}\")] | last // {}" 2>/dev/null || echo '{}')
assert_json_field "$SESSION" '"\(.action) \(.packageName) \(.policyId)"' "install ${AGENT_PACKAGE} ${POLICY_ID}" "The push is in the push-install session log" || true
assert_eq "$(audit_count "${PLUGIN}" plugin.agent-half.installed ".version == \"1.0.0\" and .integrity == \"${PINNED}\"")" "1" "Audit: plugin.agent-half.installed, with the pinned integrity" || true
SYNC_EVENTS=$(sync_log_since "$SYNC_MARK")
assert_contains "$SYNC_EVENTS" "app install ran: ${PLUGIN}" "The agent's sync ran the app-install job (sync.log)" || true
assert_contains "$SYNC_EVENTS" "hook install:pre-tunnel ran: ${PLUGIN}" "…then the pre-tunnel hook job" || true
JOURNAL=$(unit_journal_since "${UNIT}" "${HOST_EPOCH}")
assert_contains "$JOURNAL" "hook install:pre-tunnel phase=install version=1.0.0" "The installed service answered install:pre-tunnel (its journal)" || true
assert_contains "$JOURNAL" "hook install:post-tunnel phase=install version=1.0.0" "…and install:post-tunnel through the tunnel" || true

# ===========================================================================
# 7. The agent half on the agent VM
# ===========================================================================

log_section "On the agent VM: account, files, unit, system package"

FACTS=$(agent_facts "${PLUGIN}" "${SERVICE_USER}" "${SYSTEM_PACKAGE}")
assert_json_field "$FACTS" '"\(.unit.props.ActiveState) \(.unit.props.UnitFileState)"' 'active enabled' "${UNIT} is active and enabled (it starts at boot)" || true
assert_json_field "$FACTS" '.unit.props.User' "${SERVICE_USER}" "It runs as User=${SERVICE_USER}" || true
assert_json_field "$FACTS" '.unit.processUser' "${SERVICE_USER}" "…and its process is owned by ${SERVICE_USER}" || true
assert_json_field "$FACTS" '.account.user.uid > 0 and .account.user.gid > 0' 'true' "The account is not root" || true
assert_json_field "$FACTS" '"\(.account.user.shell) \(.account.homeExists)"' '/usr/sbin/nologin false' "…a system account without login shell or home" || true
assert_json_field "$FACTS" '.code.dir | "\(.mode) \(.user)"' '755 root' "${CODE_DIR}: root's, 0755" || true
assert_json_field "$FACTS" '"\(.code.current) \(.code.versions | join(","))"' '1.0.0 1.0.0' "current → 1.0.0, the version installed" || true
assert_json_field "$FACTS" '"\(.code.notRootOwned) \(.code.writableByOthers)"' '0 0' "Every file of the code is root's and writable by root only" || true
assert_json_field "$FACTS" '.data.dir | "\(.mode) \(.user):\(.group)"' "700 ${SERVICE_USER}:${SERVICE_USER}" "${DATA_DIR}: 0700, the account's" || true
assert_json_field "$FACTS" '.data.state.starts >= 1' 'true' "…where the agent half keeps its state" || true
assert_json_field "$FACTS" '.config.dir | "\(.mode) \(.user):\(.group)"' "750 root:${SERVICE_USER}" "$(dirname "${CONFIG_FILE}"): 0750 root:${SERVICE_USER}" || true
assert_json_field "$FACTS" '.config.file | "\(.mode) \(.user):\(.group)"' "600 ${SERVICE_USER}:${SERVICE_USER}" "${CONFIG_FILE}: 0600, the account's" || true
assert_json_field "$FACTS" '"\(.config.plugin) \(.config.port)"' "${PLUGIN} ${PORT}" "…for this plugin and its port" || true
assert_json_field "$FACTS" '.config.secretMatchesAgentCopy' 'true' "…holding the secret the agent holds (compared on the VM, never printed)" || true
assert_json_field "$FACTS" '.apphostRecord' '1.0.0' "The agent records the agent half it had installed" || true
assert_json_field "$FACTS" ".packages[\"${SYSTEM_PACKAGE}\"]" 'install ok installed' "${SYSTEM_PACKAGE} is installed" || true
if [ -n "${PURGE_PACKAGES}" ]; then
  assert_json_field "$FACTS" ".aptRuns[\"${SYSTEM_PACKAGE}\"] > ${APT_RUNS_BEFORE:-0}" 'true' "…by apt-get install --no-install-recommends during the hosting (apt history)" || true
else
  log_skip "${SYSTEM_PACKAGE} was installed before this spec: its installation by Lamaste is not shown"
fi

log_section "The unit: as written, and as systemd applies it"

for line in "User=${SERVICE_USER}" "Group=${SERVICE_USER}" \
  "Requires=${SOCKET_UNIT}" "After=${SOCKET_UNIT}" "Sockets=${SOCKET_UNIT}" \
  "ExecStart=/usr/bin/node ${CODE_DIR}/current/package/dist/agentd.mjs" \
  "Environment=LAMASTE_APP_CONFIG=${CONFIG_FILE}" "Environment=LAMASTE_APP_DATA_DIR=${DATA_DIR}" \
  "WorkingDirectory=${DATA_DIR}" 'Restart=always' 'NoNewPrivileges=yes' 'ProtectSystem=strict' \
  "ReadWritePaths=${DATA_DIR}" 'ProtectHome=yes' 'PrivateTmp=yes' 'PrivateDevices=yes' \
  'ProtectKernelTunables=yes' 'ProtectKernelModules=yes' 'ProtectKernelLogs=yes' \
  'ProtectControlGroups=yes' 'ProtectClock=yes' 'ProtectHostname=yes' 'RestrictSUIDSGID=yes' \
  'RestrictRealtime=yes' 'RestrictNamespaces=yes' 'LockPersonality=yes' \
  'SystemCallArchitectures=native' 'CapabilityBoundingSet=' 'UMask=0077' 'LimitCORE=0' 'MemoryMax=256M' \
  'WantedBy=multi-user.target'; do
  assert_eq "$(echo "$FACTS" | jq --arg l "$line" '.unit.lines | index($l) != null' 2>/dev/null || echo false)" "true" "Unit: ${line}" || true
done
assert_eq "$(echo "$FACTS" | jq '[.unit.lines[] | select(test("[0-9a-f]{64}"))] | length' 2>/dev/null || echo "-1")" "0" "The unit names paths, never the secret" || true
for prop in 'ProtectSystem=strict' 'ProtectHome=yes' 'NoNewPrivileges=yes' 'PrivateTmp=yes' 'PrivateDevices=yes' \
  'RestrictSUIDSGID=yes' 'LockPersonality=yes' "ReadWritePaths=${DATA_DIR}" 'MemoryMax=268435456' \
  'CapabilityBoundingSet=' 'UMask=0077' 'Restart=always' 'LimitCORE=0' \
  "TriggeredBy=${SOCKET_UNIT}"; do
  assert_eq "$(echo "$FACTS" | jq -r --arg k "${prop%%=*}" '.unit.props[$k] // "unset"' 2>/dev/null || echo unset)" "${prop#*=}" "systemctl show: ${prop}" || true
done
for dep in Requires After; do
  assert_eq "$(echo "$FACTS" | jq -r --arg k "$dep" --arg s "${SOCKET_UNIT}" '(.unit.props[$k] // "") | split(" ") | index($s) != null' 2>/dev/null || echo false)" "true" "systemctl show: ${dep}= names ${SOCKET_UNIT}" || true
done
assert_json_field "$FACTS" '.dropInDir' 'null' "No ${UNIT}.d drop-in directory: the unit is all there is" || true

log_section "The socket unit: systemd holds the port"

# Exactly what the helper writes: three sections, six directives, the
# hosting's port, the service it starts — and nothing secret.
assert_json_field "$FACTS" '.socket.stat | "\(.type) \(.mode) \(.user):\(.group)"' 'file 644 root:root' "/etc/systemd/system/${SOCKET_UNIT}: root:root 0644" || true
assert_json_field "$FACTS" '[.socket.lines[] | select(startswith("["))] | join(",")' '[Unit],[Socket],[Install]' "…its sections: [Unit], [Socket], [Install]" || true
assert_json_field "$FACTS" '[.socket.lines[] | select(startswith("[") | not) | split("=")[0]] | join(",")' 'Description,ListenStream,Accept,NoDelay,Service,WantedBy' "…its directives: Description, ListenStream, Accept, NoDelay, Service, WantedBy — nothing else" || true
for line in "ListenStream=127.0.0.1:${PORT}" 'Accept=no' 'NoDelay=true' "Service=${UNIT}" 'WantedBy=sockets.target'; do
  assert_eq "$(echo "$FACTS" | jq --arg l "$line" '.socket.lines | index($l) != null' 2>/dev/null || echo false)" "true" "Socket unit: ${line}" || true
done
assert_json_field "$FACTS" '.socket.secretLines' '0' "…and no secret in it" || true
assert_json_field "$FACTS" '.socket.props | "\(.LoadState) \(.ActiveState) \(.SubState) \(.UnitFileState)"' 'loaded active running enabled' "${SOCKET_UNIT} is active (running: its service has it) and enabled" || true
assert_json_field "$FACTS" '.socket.props.Listen' "127.0.0.1:${PORT} (Stream)" "systemctl show: Listen=127.0.0.1:${PORT} (Stream)" || true
assert_json_field "$FACTS" '.socket.props | "\(.Accept) \(.NoDelay) \(.Triggers)"' "no yes ${UNIT}" "systemctl show: Accept=no, NoDelay=yes, Triggers=${UNIT}" || true
MAIN_PID=$(json_get "$FACTS" '.unit.props.MainPID')
assert_json_field "$FACTS" '.listen.listeners | length' '1' "ss: one listening socket on port ${PORT}" || true
assert_json_field "$FACTS" '.listen.listeners[0] | "\(.state) \(.local)"' "LISTEN 127.0.0.1:${PORT}" "…on 127.0.0.1:${PORT}" || true
assert_json_field "$FACTS" '[.listen.listeners[0].users[]? | select(.pid == 1 and .name == "systemd")] | length > 0' 'true' "…held by systemd (pid 1)…" || true
assert_json_field "$FACTS" "[.listen.listeners[0].users[]? | select(.pid == ${MAIN_PID:-0})] | length > 0" 'true' "…and by the agent half (MainPID ${MAIN_PID}), the same socket" || true
assert_json_field "$FACTS" '.listen.fd3Inode != null and .listen.fd3Inode == .listen.listeners[0].inode' 'true' "The agent half's descriptor 3 is that listening socket (inode $(json_get "$FACTS" '.listen.fd3Inode'))" || true
APPHOST_APP=$(agent_exec "lamaste-agent apphost status --json 2>/dev/null" 2>/dev/null | grep -E '^\{' | tail -n 1 | jq -c ".apps[\"${PLUGIN}\"] // {}" 2>/dev/null || echo '{}')
assert_json_field "$APPHOST_APP" '"\(.unit) \(.socket)"' 'active active' "lamaste-agent apphost status: unit active, socket active" || true

# ===========================================================================
# 8. Through the tunnel: the admin pages and the sandbox
# ===========================================================================

log_section "Through the tunnel: the installed version answers"

PING=$(host_api_get "${PLUGIN}/ping")
assert_json_field "$PING" '.pong' 'true' "GET /api/${PLUGIN}/ping reaches the service on the agent VM" || true
assert_json_field "$PING" '.version' '1.0.0' "…the installed version, 1.0.0" || true
assert_json_field "$PING" '.user' "${SERVICE_USER}" "…running as ${SERVICE_USER}" || true
assert_json_field "$PING" '.caller.type' 'admin' "…which sees the admin as its caller" || true
assert_json_field "$PING" '.listen | "\(.mode) \(.fd) \(.listenFdsCleared)"' 'systemd-socket 3 true' "…listening on systemd's socket, descriptor 3, with LISTEN_* cleared from its environment" || true
BUNDLE=$(host_api_get "${PLUGIN}/panel.js")
assert_contains "$BUNDLE" "__lamalibrePlugins" "The admin page's bundle comes from the agent half" || true

SANDBOX=$(host_api_get "${PLUGIN}/sandbox")
FACTS=$(agent_facts "${PLUGIN}" "${SERVICE_USER}")
assert_json_field "$SANDBOX" '"\(.user) \(.uid > 0)"' "${SERVICE_USER} true" "Sandbox: the service is ${SERVICE_USER}, not root" || true
assert_json_field "$SANDBOX" '.writes.dataDir' 'ALLOWED' "Sandbox: it writes its data directory" || true
for target in etc code appsDir configDir usrLocal root home runLock run varCrash; do
  assert_refused "$(json_get "$SANDBOX" ".writes.${target}")" "Sandbox: no write to ${target}" || true
done
if [ "$(json_get "$FACTS" '.runLockMode')" = "1777" ]; then
  assert_json_field "$SANDBOX" '.writes.runLock' 'EROFS' "Sandbox: /run/lock, writable by every user, is read-only to it (ReadOnlyPaths=/run)" || true
else
  log_skip "/run/lock is not world-writable on this VM: ProtectSystem=strict is not singled out"
fi
assert_json_field "$SANDBOX" '.writes.privateTmp' 'ALLOWED' "Sandbox: it has a /tmp…" || true
assert_json_field "$FACTS" '.privateTmpLeak' 'false' "…of its own (PrivateTmp): nothing appears in the machine's /tmp" || true
assert_json_field "$SANDBOX" '.writes.privateVarTmp' 'ALLOWED' "Sandbox: it has a /var/tmp…" || true
assert_json_field "$FACTS" '.privateVarTmpLeak' 'false' "…of its own: nothing appears in the machine's /var/tmp" || true
assert_refused "$(json_get "$SANDBOX" '.writes.privateShm')" "Sandbox: its /dev/shm is an empty one it cannot write (TemporaryFileSystem)…" || true
assert_json_field "$FACTS" '.privateShmLeak' 'false' "…and nothing appears in the machine's /dev/shm" || true
assert_json_field "$SANDBOX" '"\(.noNewPrivs) \(.capBnd) \(.capEff)"' '1 0000000000000000 0000000000000000' "Sandbox: no new privileges, no capabilities" || true
assert_refused "$(json_get "$SANDBOX" '.reads.agentState')" "Sandbox: the agent's own state (its keys) is out of reach" || true
assert_refused "$(json_get "$SANDBOX" '.reads.shadow')" "Sandbox: /etc/shadow is out of reach" || true
assert_json_field "$SANDBOX" '.network.udpSend' 'ALLOWED' "Sandbox: it sends UDP (dgram binds a port of its own): holding its TCP port took nothing else from it" || true

# ===========================================================================
# 9. The stand-in Feria's record
# ===========================================================================

log_section "Feria's record: the agent pulled the package itself"

REQUESTS=$(stub_get "-/e2e/requests" | jq -c "[.requests[]? | select(.method == \"GET\" and (.path | startswith(\"/${AGENT_PACKAGE}\")))]" 2>/dev/null || echo '[]')
assert_json_field "$REQUESTS" "[.[] | select((.path | endswith(\"/e2e-apphost-agent-1.0.0.tgz\")) and .owner == \"agent:${HOST_AGENT_LABEL}\" and .status == 200)] | length > 0" 'true' "agent:${HOST_AGENT_LABEL} downloaded ${AGENT_PACKAGE}-1.0.0.tgz" || true
assert_json_field "$REQUESTS" "[.[] | select(.path | endswith(\".tgz\")) | .owner] | unique | join(\",\")" "agent:${HOST_AGENT_LABEL}" "…and nobody else did: the relay pinned it from the packument alone" || true
TOKENS=$(stub_get "-/feria/tokens?owner=agent:${HOST_AGENT_LABEL}")
assert_json_field "$TOKENS" '[.tokens[]? | select(.kind == "agent" and (.scopes | join(",")) == "read")] | length > 0' 'true' "Its token: an agent token, read scope" || true
assert_json_field "$TOKENS" '[.tokens[]? | .createdBy] | unique | join(",")' "ci:auth.${DOMAIN}/lamaste-server" "…brokered by the panel's OIDC identity" || true

# ===========================================================================
# 10. Uninstall with purge: nothing is left
# ===========================================================================

log_section "Uninstall with purge leaves nothing"

host_api_post "plugins/${PLUGIN}/disable" '{}' > /dev/null
UNINSTALL=$(host_api_delete "plugins/${PLUGIN}?purge=true")
OP=$(wait_operation "${PLUGIN}" "$(json_get "$UNINSTALL" '.operation.id // empty')" 300 nudge)
assert_json_field "$OP" '.status' 'succeeded' "The uninstall operation succeeded ($(json_get "$OP" '.error // ""'))" || true
for step in 'agent uninstall:pre-teardown' 'remove the tunnel' 'agent uninstall:post-teardown' 'remove the agent half' 'revoke the secret and the capability' 'remove the package'; do
  assert_eq "$(step_status "$OP" "$step")" "done" "Step: ${step}" || true
done
assert_eq "$(step_order "$OP" 'remove the agent half' 'revoke the secret and the capability')" "true" "The agent half went before the secret it runs with" || true
assert_eq "$(host_api_get_status "plugins/${PLUGIN}")" "404" "The plugin is gone from the relay" || true
assert_relay_clean "${PLUGIN}" "Uninstalled"
assert_eq "$(audit_count "${PLUGIN}" plugin.agent-half.removed '.purge == true')" "1" "Audit: plugin.agent-half.removed, purge" || true
FACTS=$(agent_facts "${PLUGIN}" "${SERVICE_USER}")
assert_json_field "$FACTS" '"\(.unit.file) \(.unit.props.LoadState)"' 'false not-found' "No unit on the agent VM" || true
assert_json_field "$FACTS" '"\(.socket.file) \(.socket.props.LoadState)"' 'false not-found' "No socket unit" || true
assert_json_field "$FACTS" '.dropInDir' 'null' "No drop-in directory" || true
assert_json_field "$FACTS" '.listen.listeners | length' '0' "Nothing listens on port ${PORT} any more: the socket let go of it" || true
assert_json_field "$FACTS" '"\(.code.dir) \(.config.dir) \(.data.dir)"' 'null null null' "No code, config or data directory" || true
assert_json_field "$FACTS" '"\(.account.user) \(.account.group)"' 'null null' "No ${SERVICE_USER} account or group" || true
assert_json_field "$FACTS" '.apphostRecord' 'null' "The agent's record no longer lists it" || true
if wait_for 90 agent_copy_gone "${PLUGIN}"; then
  log_pass "The agent's own copy of the plugin config is gone"
else
  log_fail "The agent still holds a plugin config for ${PLUGIN}"
fi

end_test

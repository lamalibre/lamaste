#!/usr/bin/env bash
# ============================================================================
# 33 — Lifecycle hooks on both machines (Three-VM)
# ============================================================================
# An agent-hosted plugin with relay and agent lifecycle hooks (fixture
# @lamalibre/e2e-hooks-server, every agent stage declared), hosted on the
# agent VM's agent:
#
# 1. Hosting runs the install pipeline across both machines: relay
#    install:pre-tunnel in the host's hook runner; the reservation (secret
#    delivered by the agent's sync timer); the agent half's
#    install:pre-tunnel as an agent job, run by the sync on the agent VM's
#    loopback before the tunnel is granted; the grant; the agent half's
#    install:post-tunnel through the tunnel; relay install:post-tunnel.
#    The relay hook's sandbox probe holds on this host too.
# 2. A request hook works across the tunnel (secret-scan redaction).
# 3. The agent's tunnel client stopped: the relay runs tunnel:down and answers
#    with its fallback; the agent's sync tells the agent half tunnel:down.
#    Back: tunnel:up on both sides.
# 4. Unhosting runs the uninstall pipeline on both machines; the agent half's
#    uninstall:post-teardown runs after the tunnel is gone, as an agent job.
# 5. The agent half refusing install:post-tunnel rolls the hosting back:
#    both sides' uninstall stages run with phase rollback; nothing is left.
# 6. The agent half refusing install:pre-tunnel leaves nothing: the tunnel is
#    never granted, the relay's pre stage is rolled back.
# 7. Uninstalling the plugin removes its hook runner.
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../e2e/helpers.sh"

require_commands multipass curl jq

# ---------------------------------------------------------------------------
# VM exec helpers
# ---------------------------------------------------------------------------

host_exec() { multipass exec lamaste-host -- sudo bash -c "$1"; }
agent_exec() { multipass exec lamaste-agent -- sudo bash -c "$1"; }

CURL_MTLS="curl -sk --max-time 30 --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key --cacert /etc/lamalibre/lamaste/pki/ca.crt"
PANEL="https://127.0.0.1:9292/api"

# The URL is quoted: query strings carry & and ?.
host_api_get() {
  host_exec "${CURL_MTLS} -H 'Accept: application/json' '${PANEL}/$1'"
}
host_api_get_status() {
  host_exec "${CURL_MTLS} -o /dev/null -w '%{http_code}' '${PANEL}/$1'" 2>/dev/null || echo "000"
}
host_api_post() {
  host_exec "${CURL_MTLS} -X POST -H 'Content-Type: application/json' -H 'Accept: application/json' -d '$2' '${PANEL}/$1'"
}
host_api_delete() {
  host_exec "${CURL_MTLS} -X DELETE -H 'Accept: application/json' '${PANEL}/$1'"
}

# user_systemctl <args> — systemctl --user for root on the agent VM
# nudge_sync — start the agent's sync now rather than at the timer's next
# tick (the same unit the timer starts, so two syncs never run at once):
# operations wait on agent jobs and tunnel hooks the sync delivers, and the
# spec must finish inside rodeo's 10-minute limit
nudge_sync() {
  agent_exec "XDG_RUNTIME_DIR=/run/user/0 systemctl --user start --no-block lamalibre-lamaste-sync-${AGENT_LABEL}.service > /dev/null 2>&1; true" > /dev/null 2>&1 || true
}

user_systemctl() {
  agent_exec "XDG_RUNTIME_DIR=/run/user/0 systemctl --user $1"
}

# agent_config_field <field> — a top-level field of the agent's config.json
# (node: the agent VM has no jq)
agent_config_field() {
  agent_exec "node -p \"require('${AGENT_CONFIG}')['$1'] ?? ''\"" 2>/dev/null || echo ""
}

hosting_field() {
  host_api_get "plugins/${PLUGIN}/hosting" 2>/dev/null | jq -r "$1" 2>/dev/null || echo ""
}

# wait_operation <operation id> <seconds> — prints the operation once it ended
# (still running after <seconds>: printed as is; the caller asserts its status)
wait_operation() {
  local id="$1" deadline=$((SECONDS + $2)) op='{}'
  while [ "$SECONDS" -lt "$deadline" ]; do
    nudge_sync
    op=$(host_api_get "plugins/${PLUGIN}/operations/${id}" 2>/dev/null | jq -c '.operation' 2>/dev/null || echo '{}')
    if [ "$(echo "$op" | jq -r '.status' 2>/dev/null)" != "running" ]; then
      echo "$op"
      return 0
    fi
    sleep 3
  done
  echo "$op"
  return 0
}

# step_status <operation json> <step name> — the status of one step (its last run)
step_status() {
  echo "$1" | jq -r --arg n "$2" '[.steps[] | select(.name == $n) | .status] | last // "absent"' 2>/dev/null || echo "absent"
}

# audit_count <action> [<jq filter on details>] — this run's entries of one
# action for the plugin (the audit log outlives a run: entries after AUDIT_BASE)
audit_count() {
  host_api_get "audit?plugin=${PLUGIN}&action=$1&limit=200" | jq "[.entries[] | select(.id > ${AUDIT_BASE}) | select(.details | ${2:-true})] | length" 2>/dev/null || echo "0"
}

wait_health() {
  local want="$1" deadline=$((SECONDS + $2))
  while [ "$SECONDS" -lt "$deadline" ]; do
    if [ "$(hosting_field '.hosting.health.state')" = "$want" ]; then
      return 0
    fi
    sleep 3
  done
  return 1
}

# wait_for <seconds> <command...> — until the command succeeds (every 3 s)
wait_for() {
  local deadline=$((SECONDS + $1))
  shift
  while [ "$SECONDS" -lt "$deadline" ]; do
    nudge_sync
    if "$@"; then return 0; fi
    sleep 3
  done
  return 1
}

# set_tunnels_stopped true|false — what the agent daemon's /stop and /start
# do: remembered by the sync timer, which otherwise restarts the client
set_tunnels_stopped() {
  agent_exec "cd ${AGENT_LIB_PARENT} && node --input-type=module -e \"import('@lamalibre/lamaste/agent').then((m) => m.setAgentTunnelsStopped('${AGENT_LABEL}', $1))\""
}

# half_log_since <mark> — the agent half's log lines after line <mark>
half_log_since() {
  agent_exec "tail -n +$(($1 + 1)) ${HALF_LOG} 2>/dev/null" 2>/dev/null || echo ""
}
half_log_mark() {
  agent_exec "cat ${HALF_LOG} 2>/dev/null | wc -l" 2>/dev/null || echo "0"
}

# start_half [flag...] — (re)start the agent half on the agent VM. It waits
# for the plugin config the sync timer delivers; each flag makes that stage
# refuse (fail-<stage>).
start_half() {
  local flags=""
  for f in "$@"; do flags="${flags} && touch ${REMOTE_DIR}/flags/fail-${f}"; done
  agent_exec "pkill -f '[a]pp-plugin-half.mjs' 2>/dev/null; rm -rf ${REMOTE_DIR}/flags && mkdir -p ${REMOTE_DIR}/flags ${flags}; true"
  agent_exec "nohup node ${REMOTE_DIR}/app-plugin-half.mjs --config ${PLUGIN_CONFIG_FILE} --plugin ${PLUGIN} --lamaste ${AGENT_LIB_DIR} --log ${HALF_LOG} --flags ${REMOTE_DIR}/flags --wait-config &>> ${REMOTE_DIR}/half.out & exit"
}

config_present() { agent_exec "test -f ${PLUGIN_CONFIG_FILE}" 2>/dev/null; }
config_gone() { ! agent_exec "test -f ${PLUGIN_CONFIG_FILE}" 2>/dev/null; }

# nothing_left <message prefix> — no hosting, tunnel, capability or agent config
nothing_left() {
  assert_eq "$(host_api_get_status "plugins/${PLUGIN}/hosting")" "404" "$1: no hosting record" || true
  assert_eq "$(host_api_get "tunnels?limit=500" | jq "[.tunnels[] | select(.pluginRoute == \"${PLUGIN}\")] | length" 2>/dev/null || echo "-1")" "0" "$1: no tunnel" || true
  assert_not_contains "$(host_api_get "certs/agent" | jq -c ".agents[] | select(.label == \"${HOST_AGENT_LABEL}\") | .capabilities" 2>/dev/null)" "plugin:${PLUGIN}:host" "$1: no host capability" || true
  if wait_for 90 config_gone; then
    log_pass "$1: the sync timer removed the agent's plugin config"
  else
    log_fail "$1: the plugin config is still on the agent VM"
  fi
}

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

STUB_PORT=4874
STUB_URL="http://127.0.0.1:${STUB_PORT}"
STUB_ADMIN_TOKEN="feria_e2eadmin_threevm_hooks_000000000000"
PLUGIN="e2e-hooks"
PACKAGE="@lamalibre/e2e-hooks-server"
AGENT_HOOKS='{ "install": { "pre-tunnel": {}, "post-tunnel": {} }, "uninstall": { "pre-teardown": {}, "post-teardown": {} }, "tunnel": { "down": {}, "up": {} } }'
AGENT_LABEL="e2e-agent"
AGENT_DIR="/root/.lamalibre/lamaste/agents/${AGENT_LABEL}"
AGENT_CONFIG="${AGENT_DIR}/config.json"
PLUGIN_CONFIG_FILE="${AGENT_DIR}/app-plugins/${PLUGIN}.json"
SYNC_TIMER="lamalibre-lamaste-sync-${AGENT_LABEL}.timer"
CHISEL_SERVICE="lamalibre-lamaste-chisel-${AGENT_LABEL}.service"
REMOTE_DIR="/tmp/e2e-33-hooks"
HALF_LOG="${REMOTE_DIR}/half.log"
LOCAL_TMP=""
AUDIT_BASE=0
HOST_AGENT_LABEL=""
AGENT_LIB_DIR=""
AGENT_LIB_PARENT=""

begin_test "33 — Lifecycle hooks on both machines (Three-VM)"

cleanup() {
  log_info "Cleaning up test resources..."
  timed_exec 60 multipass exec lamaste-agent -- sudo bash -c "pkill -f '[a]pp-plugin-half.mjs' 2>/dev/null; true" > /dev/null 2>&1
  # Uninstalling tears a hosting down first (an operation, forced: the agent
  # half is gone); one still running refuses it until it ends.
  timed_exec 300 multipass exec lamaste-host -- sudo bash -c "${CURL_MTLS} -X POST ${PANEL}/plugins/${PLUGIN}/disable > /dev/null 2>&1; for _ in \$(seq 1 90); do [ \"\$(${CURL_MTLS} -o /dev/null -w '%{http_code}' ${PANEL}/plugins/${PLUGIN})\" = 404 ] && break; ${CURL_MTLS} -X DELETE '${PANEL}/plugins/${PLUGIN}?force=true' > /dev/null 2>&1; sleep 3; done; rm -f /etc/lamalibre/lamaste/.npmrc; pkill -f '[s]tub-registry.mjs' 2>/dev/null; rm -rf ${REMOTE_DIR}; true" > /dev/null 2>&1
  if [ -n "$AGENT_LIB_PARENT" ]; then
    timed_exec 60 multipass exec lamaste-agent -- sudo bash -c "cd ${AGENT_LIB_PARENT} && node --input-type=module -e \"import('@lamalibre/lamaste/agent').then((m) => m.setAgentTunnelsStopped('${AGENT_LABEL}', false))\" 2>/dev/null; lamaste-agent sync --label ${AGENT_LABEL} 2>/dev/null; rm -rf ${REMOTE_DIR}; true" > /dev/null 2>&1
  fi
  if [ -n "$LOCAL_TMP" ]; then rm -rf "$LOCAL_TMP"; fi
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
log_section "Pre-flight"
# ---------------------------------------------------------------------------

ONBOARDING_STATUS=$(host_api_get "onboarding/status" | jq -r '.status' 2>/dev/null || echo "unknown")
if [ "$ONBOARDING_STATUS" != "COMPLETED" ]; then
  log_skip "Onboarding not completed — skipping"
  end_test
  exit $?
fi
log_pass "Onboarding is complete"

DOMAIN=$(host_api_get "onboarding/status" | jq -r '.domain' 2>/dev/null || echo "null")
if [ -z "$DOMAIN" ] || [ "$DOMAIN" = "null" ]; then
  log_skip "No domain configured — skipping"
  end_test
  exit $?
fi

if ! host_exec "systemctl cat lamalibre-lamaste-hooks@.service > /dev/null 2>&1"; then
  log_fail "The hook runner units are not installed on the host (create-lamaste 4.3)"
  end_test
  exit $?
fi

HOST_AGENT_LABEL=$(agent_config_field "agentLabel")
HOST_AGENT_LABEL="${HOST_AGENT_LABEL:-test-agent}"
AGENT_ENROLLED=$(host_api_get "certs/agent" | jq -r '[.agents[]? | select(.label == "'"${HOST_AGENT_LABEL}"'" and (.revoked // false) == false)] | length' 2>/dev/null || echo "0")
if [ "$AGENT_ENROLLED" = "0" ]; then
  log_skip "Agent ${HOST_AGENT_LABEL} is not enrolled on the host — skipping"
  end_test
  exit $?
fi
log_pass "Agent ${HOST_AGENT_LABEL} is enrolled on the host"

TIMER_STATE=$(user_systemctl "is-active ${SYNC_TIMER} 2>/dev/null || true")
assert_eq "$TIMER_STATE" "active" "Sync timer ${SYNC_TIMER} is active on the agent VM" || true

AGENT_LIB_DIR=$(agent_exec "find \"\$(npm root -g)/@lamalibre/lamaste-agent\" -path '*/@lamalibre/lamaste/package.json' -print -quit 2>/dev/null | xargs -r dirname" 2>/dev/null || echo "")
if [ -z "$AGENT_LIB_DIR" ]; then
  log_fail "@lamalibre/lamaste not found under the agent VM's global lamaste-agent install"
  end_test
  exit $?
fi
AGENT_LIB_PARENT=$(dirname "$(dirname "$(dirname "${AGENT_LIB_DIR}")")")
if ! agent_exec "test -f ${AGENT_LIB_DIR}/dist/agent/app-plugin-hooks.js"; then
  log_fail "The agent VM's @lamalibre/lamaste has no agent hook support (4.3)"
  end_test
  exit $?
fi
log_info "Agent VM's @lamalibre/lamaste: ${AGENT_LIB_DIR}"

# ===========================================================================
# 1. Install, approve, host: the install pipeline on both machines
# ===========================================================================

log_section "Install and approve the hooks fixture"

AUDIT_BASE=$(host_api_get "audit?limit=1" | jq '.entries[0].id // 0' 2>/dev/null || echo "0")

LOCAL_TMP=$(mktemp -d /tmp/e2e-33-hooks-XXXXXXXX)
write_stub_registry "${LOCAL_TMP}/stub-registry.mjs"
write_hooks_fixture_plugin "${LOCAL_TMP}/fixture" "${PLUGIN}" 1.0.0 main "${AGENT_HOOKS}"
write_app_plugin_half "${LOCAL_TMP}/app-plugin-half.mjs"
tar -C "${LOCAL_TMP}" -czf "${LOCAL_TMP}/fixture.tgz" fixture stub-registry.mjs
host_exec "rm -rf ${REMOTE_DIR} && mkdir -p ${REMOTE_DIR} && chmod a+rwx ${REMOTE_DIR}"
multipass transfer "${LOCAL_TMP}/fixture.tgz" "lamaste-host:${REMOTE_DIR}/fixture.tgz"
host_exec "tar -C ${REMOTE_DIR} -xzf ${REMOTE_DIR}/fixture.tgz && chmod -R a+rX ${REMOTE_DIR}"
agent_exec "rm -rf ${REMOTE_DIR} && mkdir -p ${REMOTE_DIR}/flags && chmod a+rwx ${REMOTE_DIR}"
multipass transfer "${LOCAL_TMP}/app-plugin-half.mjs" "lamaste-agent:${REMOTE_DIR}/app-plugin-half.mjs"

host_exec "pkill -f '[s]tub-registry.mjs' 2>/dev/null || true"
host_exec "nohup node ${REMOTE_DIR}/stub-registry.mjs --port ${STUB_PORT} --admin-token ${STUB_ADMIN_TOKEN} --issuer https://auth.${DOMAIN} --audience ${STUB_URL} --jwks-url http://127.0.0.1:9091/jwks.json --package ${REMOTE_DIR}/fixture &>/dev/null & exit"
STUB_UP="no"
for _ in $(seq 1 30); do
  if host_exec "curl -sf --max-time 3 ${STUB_URL}/-/ping > /dev/null 2>&1"; then
    STUB_UP="yes"
    break
  fi
  sleep 1
done
assert_eq "$STUB_UP" "yes" "Stand-in registry is up on the host VM" || true
host_exec "printf '@lamalibre:registry=%s/\n//127.0.0.1:%s/:_authToken=%s\n' '${STUB_URL}' '${STUB_PORT}' '${STUB_ADMIN_TOKEN}' > ${REMOTE_DIR}/npmrc && install -o lamaste -g lamaste -m 0600 ${REMOTE_DIR}/npmrc /etc/lamalibre/lamaste/.npmrc"

INSTALL=$(host_api_post "plugins/install" "{\"packageName\":\"${PACKAGE}@1.0.0\"}")
assert_json_field "$INSTALL" '.hooks.approval.state' 'pending' "Fixture installed; its relay hooks wait for approval" || true
assert_eq "$(echo "$INSTALL" | jq -r '.hooks.agent.stages | length' 2>/dev/null)" "6" "The install shows the six agent stages" || true
DIGEST=$(echo "$INSTALL" | jq -r '.hooks.relay.digest' 2>/dev/null || echo "")
APPROVE=$(host_api_post "plugins/${PLUGIN}/hooks/approve" "{\"digest\":\"${DIGEST}\"}")
assert_json_field "$APPROVE" '.hooks.runner.current' 'true' "Approved: the runner holds the module" || true
host_api_post "plugins/${PLUGIN}/enable" '{}' > /dev/null

log_section "Host: install pipeline across the machines"

start_half
SYNC_LOG_MARK=$(agent_exec "cat ${AGENT_DIR}/logs/sync.log 2>/dev/null | wc -l" 2>/dev/null || echo "0")
HOST=$(host_api_post "plugins/${PLUGIN}/hosting" "{\"agentLabel\":\"${HOST_AGENT_LABEL}\"}")
HOST_OP_ID=$(echo "$HOST" | jq -r '.operation.id // empty' 2>/dev/null || echo "")
if [ -z "$HOST_OP_ID" ]; then
  log_fail "Hosting did not start: ${HOST}"
  end_test
  exit $?
fi
OP=$(wait_operation "${HOST_OP_ID}" 360)
assert_json_field "$OP" '.status' 'succeeded' "The hosting operation succeeded" || true
for step in 'relay install:pre-tunnel' 'reserve port, secret and capability' 'agent install:pre-tunnel' 'grant the tunnel and wait for the agent half' 'agent install:post-tunnel' 'relay install:post-tunnel' 'activate'; do
  assert_eq "$(step_status "$OP" "$step")" "done" "Step: ${step}" || true
done
ORDER=$(echo "$OP" | jq -r '[.steps[].name] | (index("agent install:pre-tunnel") < index("grant the tunnel and wait for the agent half"))' 2>/dev/null || echo "false")
assert_eq "$ORDER" "true" "The agent's pre-tunnel stage finished before the tunnel was granted" || true
HALF_LOG_TEXT=$(half_log_since 0)
assert_contains "$HALF_LOG_TEXT" "hook install:pre-tunnel phase=install" "The agent half ran install:pre-tunnel" || true
assert_contains "$HALF_LOG_TEXT" "hook install:post-tunnel phase=install" "The agent half ran install:post-tunnel" || true
SYNC_EVENTS=$(agent_exec "tail -n +$((SYNC_LOG_MARK + 1)) ${AGENT_DIR}/logs/sync.log" 2>/dev/null || echo "")
assert_contains "$SYNC_EVENTS" "hook install:pre-tunnel ran: ${PLUGIN}" "The agent's sync ran the pre-tunnel job (sync.log)" || true
assert_eq "$(hosting_field '.hosting.phase')" "active" "The hosting is active" || true

PROBE=$(host_api_get "audit?plugin=${PLUGIN}&action=hook.sandbox.probe" | jq -c '.entries[0].details' 2>/dev/null || echo '{}')
assert_json_field "$PROBE" '.readLamaste' 'ERR_ACCESS_DENIED' "Sandbox: a relay hook cannot read Lamaste's files" || true
assert_json_field "$PROBE" '.spawn' 'ERR_ACCESS_DENIED' "Sandbox: a relay hook cannot spawn a process" || true
assert_not_eq "$(echo "$PROBE" | jq -r '.tcpOut')" "CONNECTED" "Sandbox: a relay hook has no network" || true
assert_json_field "$PROBE" '.envKeys' '0' "Sandbox: a relay hook sees an empty environment" || true

# ===========================================================================
# 2. A request hook across the tunnel
# ===========================================================================

log_section "Request hook across the tunnel"

EXPORT=$(host_api_get "${PLUGIN}/export/all")
assert_json_field "$EXPORT" '.token' '[REDACTED:github-token]' "The token planted on the agent VM is redacted by the relay" || true
assert_not_contains "$EXPORT" "E2eToken0" "…and never leaves the relay" || true

# ===========================================================================
# 3. Tunnel down and up: both sides
# ===========================================================================

log_section "tunnel:down and tunnel:up on both machines"

if wait_health up 60; then log_pass "Health is up"; else log_fail "Health: $(hosting_field '.hosting.health')"; fi
MARK=$(half_log_mark)
set_tunnels_stopped true
CHISEL_STATE=$(user_systemctl "is-active ${CHISEL_SERVICE} 2>/dev/null || true")
assert_not_eq "$CHISEL_STATE" "active" "The agent's tunnel client is stopped" || true
if wait_health down 75; then log_pass "Relay: health down"; else log_fail "Relay: health did not go down"; fi
assert_eq "$(hosting_field '.hosting.health.reason')" "tunnel" "Relay: reason tunnel" || true
relay_down_ran() { [ "$(audit_count hook.tunnel.down '.reason == "tunnel"')" -ge 1 ] 2>/dev/null; }
if wait_for 30 relay_down_ran; then log_pass "Relay: tunnel:down ran (reason tunnel)"; else log_fail "Relay: tunnel:down did not run"; fi
FALLBACK=$(host_exec "${CURL_MTLS} -w '\n%{http_code}' '${PANEL}/${PLUGIN}/ping'" 2>/dev/null || echo "")
assert_eq "$(echo "$FALLBACK" | tail -1)" "503" "Relay: the plugin's fallback answers while down" || true
assert_json_field "$(echo "$FALLBACK" | head -1)" '.error' 'maintenance' "…with the plugin's body" || true
agent_down_ran() { half_log_since "$MARK" | grep -q "hook tunnel:down phase=- reason=tunnel state=down"; }
if wait_for 90 agent_down_ran; then
  log_pass "Agent: the sync told the agent half tunnel:down (reason tunnel)"
else
  log_fail "Agent: the agent half was not told tunnel:down"
fi

MARK=$(half_log_mark)
set_tunnels_stopped false
agent_exec "lamaste-agent sync --label ${AGENT_LABEL} > /dev/null 2>&1 || true"
if wait_health up 120; then log_pass "Relay: health up again"; else log_fail "Relay: health did not recover"; fi
relay_up_ran() { [ "$(audit_count hook.tunnel.up)" -ge 1 ] 2>/dev/null; }
if wait_for 30 relay_up_ran; then log_pass "Relay: tunnel:up ran"; else log_fail "Relay: tunnel:up did not run"; fi
agent_up_ran() { half_log_since "$MARK" | grep -q "hook tunnel:up .*state=up"; }
if wait_for 90 agent_up_ran; then
  log_pass "Agent: the sync told the agent half tunnel:up"
else
  log_fail "Agent: the agent half was not told tunnel:up"
fi
assert_json_field "$(host_api_get "${PLUGIN}/ping")" '.pong' 'true' "Requests reach the agent half again" || true
SYNC_EVENTS=$(agent_exec "tail -n +$((SYNC_LOG_MARK + 1)) ${AGENT_DIR}/logs/sync.log" 2>/dev/null || echo "")
assert_contains "$SYNC_EVENTS" "tunnel hook delivered: ${PLUGIN}" "sync.log records the tunnel hooks" || true

# ===========================================================================
# 4. Unhost: the uninstall pipeline on both machines
# ===========================================================================

log_section "Unhost: uninstall pipeline across the machines"

MARK=$(half_log_mark)
UNHOST=$(host_api_delete "plugins/${PLUGIN}/hosting")
OP=$(wait_operation "$(echo "$UNHOST" | jq -r '.operation.id' 2>/dev/null)" 240)
assert_json_field "$OP" '.status' 'succeeded' "The unhosting operation succeeded" || true
for step in 'relay uninstall:pre-teardown' 'agent uninstall:pre-teardown' 'remove the tunnel' 'agent uninstall:post-teardown' 'revoke the secret and the capability' 'relay uninstall:post-teardown'; do
  assert_eq "$(step_status "$OP" "$step")" "done" "Step: ${step}" || true
done
ORDER=$(echo "$OP" | jq -r '[.steps[].name] | (index("remove the tunnel") < index("agent uninstall:post-teardown")) and (index("agent uninstall:post-teardown") < index("revoke the secret and the capability"))' 2>/dev/null || echo "false")
assert_eq "$ORDER" "true" "The agent's post-teardown ran after the tunnel went and before the secret was revoked" || true
HALF_LOG_TEXT=$(half_log_since "$MARK")
assert_contains "$HALF_LOG_TEXT" "hook uninstall:pre-teardown phase=uninstall" "The agent half ran uninstall:pre-teardown" || true
assert_contains "$HALF_LOG_TEXT" "hook uninstall:post-teardown phase=uninstall" "The agent half ran uninstall:post-teardown" || true
nothing_left "Unhosted"

# ===========================================================================
# 5. The agent half refuses install:post-tunnel: rollback
# ===========================================================================

log_section "A failing agent install:post-tunnel rolls back"

RELAY_ROLLBACKS=$(audit_count hook.uninstall.pre-teardown '.phase == "rollback"')
start_half 'install:post-tunnel'
MARK=$(half_log_mark)
HOST=$(host_api_post "plugins/${PLUGIN}/hosting" "{\"agentLabel\":\"${HOST_AGENT_LABEL}\"}")
OP=$(wait_operation "$(echo "$HOST" | jq -r '.operation.id' 2>/dev/null)" 360)
assert_json_field "$OP" '.status' 'rolled-back' "The operation rolled back" || true
assert_eq "$(step_status "$OP" 'agent install:post-tunnel')" "failed" "agent install:post-tunnel failed" || true
assert_contains "$(echo "$OP" | jq -r '.error')" "refused by flag" "…with the agent half's reason" || true
assert_eq "$(step_status "$OP" 'agent uninstall:pre-teardown')" "done" "Rollback: the agent half's uninstall:pre-teardown ran" || true
assert_eq "$(step_status "$OP" 'agent uninstall:post-teardown')" "done" "Rollback: the agent half's uninstall:post-teardown ran" || true
HALF_LOG_TEXT=$(half_log_since "$MARK")
assert_contains "$HALF_LOG_TEXT" "hook uninstall:pre-teardown phase=rollback" "The agent half saw phase rollback (pre-teardown)" || true
assert_contains "$HALF_LOG_TEXT" "hook uninstall:post-teardown phase=rollback" "The agent half saw phase rollback (post-teardown)" || true
assert_eq "$(audit_count hook.uninstall.pre-teardown '.phase == "rollback"')" "$((RELAY_ROLLBACKS + 1))" "The relay's uninstall stages ran with phase rollback" || true
nothing_left "Rolled back"

# ===========================================================================
# 6. The agent half refuses install:pre-tunnel: nothing is left
# ===========================================================================

log_section "A failing agent install:pre-tunnel leaves nothing"

RELAY_ROLLBACKS=$(audit_count hook.uninstall.pre-teardown '.phase == "rollback"')
start_half 'install:pre-tunnel'
MARK=$(half_log_mark)
HOST=$(host_api_post "plugins/${PLUGIN}/hosting" "{\"agentLabel\":\"${HOST_AGENT_LABEL}\"}")
OP=$(wait_operation "$(echo "$HOST" | jq -r '.operation.id' 2>/dev/null)" 240)
assert_json_field "$OP" '.status' 'failed' "The operation failed" || true
assert_contains "$(echo "$OP" | jq -r '.error')" "agent install:pre-tunnel refused" "…at the agent's pre-tunnel stage" || true
assert_eq "$(step_status "$OP" 'grant the tunnel and wait for the agent half')" "absent" "The tunnel was never granted" || true
HALF_LOG_TEXT=$(half_log_since "$MARK")
assert_contains "$HALF_LOG_TEXT" "hook install:pre-tunnel phase=install" "The agent half was asked (and refused)" || true
assert_not_contains "$HALF_LOG_TEXT" "hook uninstall:" "The agent side, whose own stage failed, is not asked to undo anything" || true
assert_eq "$(audit_count hook.uninstall.pre-teardown '.phase == "rollback"')" "$((RELAY_ROLLBACKS + 1))" "The relay's pre stage was rolled back" || true
nothing_left "Failed before the tunnel"

# ===========================================================================
# 7. Uninstall
# ===========================================================================

log_section "Uninstall"

agent_exec "pkill -f '[a]pp-plugin-half.mjs' 2>/dev/null || true"
host_api_post "plugins/${PLUGIN}/disable" '{}' > /dev/null
UNINSTALL=$(host_api_delete "plugins/${PLUGIN}")
assert_json_field "$UNINSTALL" '.ok' 'true' "The plugin is uninstalled" || true
RUNNER=$(host_exec "systemctl is-active lamalibre-lamaste-hooks@${PLUGIN}.socket 2>/dev/null || true")
assert_not_eq "$RUNNER" "active" "Its hook runner is gone" || true
MODULES=$(host_exec "test -d /opt/lamalibre/lamaste/hooks/${PLUGIN} && echo present || echo gone")
assert_eq "$MODULES" "gone" "Its hook modules are removed" || true

end_test

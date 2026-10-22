#!/usr/bin/env bash
# ============================================================================
# 31 — Agent-hosted plugin through the internal tunnel (Three-VM)
# ============================================================================
# The whole path of an agent-hosted plugin with an agent half, across the
# host and agent VMs:
#
# 1. The plugin (fixture @lamalibre/e2e-app-plugin-server) is installed and
#    enabled on the host, then hosted on the agent VM's agent — an operation
#    (4.3) that reserves the hosting, grants the tunnel and waits for the
#    agent half. The agent's sync timer fetches the plugin config (port and
#    secret) and acknowledges it, without any command on the agent VM.
# 2. The agent half starts on the agent VM on the assigned port; the chisel
#    client binds the same port on the host (the internal tunnel's grant), the
#    hosting operation succeeds, and the panel's forwarder reaches the agent
#    half through it.
# 3. A secret rotation on the host is picked up by the sync timer: the
#    forwarder keeps working throughout and the previous secret is dropped
#    once the agent acknowledges the new one.
# 4. Health: the agent half stopped is "down (app)"; the tunnel client stopped
#    is "down (tunnel)"; both come back up.
# 5. Clearing the hosting withdraws the tunnel and the sync timer removes the
#    agent's config file.
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

host_api_get() {
  host_exec "${CURL_MTLS} -f -H 'Accept: application/json' https://127.0.0.1:9292/api/$1"
}
host_api_get_status() {
  host_exec "${CURL_MTLS} -o /dev/null -w '%{http_code}' https://127.0.0.1:9292/api/$1" 2>/dev/null || echo "000"
}
host_api_post() {
  host_exec "${CURL_MTLS} -f -X POST -H 'Content-Type: application/json' -H 'Accept: application/json' -d '$2' https://127.0.0.1:9292/api/$1"
}
host_api_delete() {
  host_exec "${CURL_MTLS} -f -X DELETE -H 'Accept: application/json' https://127.0.0.1:9292/api/$1"
}

# user_systemctl <args> — systemctl --user for root on the agent VM
user_systemctl() {
  agent_exec "XDG_RUNTIME_DIR=/run/user/0 systemctl --user $1"
}

# agent_config_field <field> — a top-level field of the agent's config.json
# (node: the agent VM has no jq)
agent_config_field() {
  agent_exec "node -p \"require('${AGENT_CONFIG}')['$1'] ?? ''\"" 2>/dev/null || echo ""
}

# plugin_config_field <js expr> — a field of the agent's plugin config file
plugin_config_field() {
  agent_exec "node -p \"(JSON.parse(require('fs').readFileSync('${PLUGIN_CONFIG_FILE}','utf8')))$1\"" 2>/dev/null || echo ""
}

# hosting_field <jq expr> — a field of GET /api/plugins/<name>/hosting on the host
hosting_field() {
  host_api_get "plugins/${PLUGIN_NAME}/hosting" 2>/dev/null | jq -r "$1" 2>/dev/null || echo ""
}

# wait_operation <operation id> <seconds> — prints the operation once it ended
# (still running after <seconds>: printed as is; the caller asserts its status)
wait_operation() {
  local id="$1" deadline=$((SECONDS + $2)) op='{}'
  while [ "$SECONDS" -lt "$deadline" ]; do
    op=$(host_api_get "plugins/${PLUGIN_NAME}/operations/${id}" 2>/dev/null | jq -c '.operation' 2>/dev/null || echo '{}')
    if [ "$(echo "$op" | jq -r '.status' 2>/dev/null)" != "running" ]; then
      echo "$op"
      return 0
    fi
    sleep 3
  done
  echo "$op"
  return 0
}

# wait_health <state> <seconds>
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

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

HOST_IP="${HOST_IP:-10.13.37.1}"
STUB_PORT=4874
STUB_URL="http://127.0.0.1:${STUB_PORT}"
STUB_ADMIN_TOKEN="feria_e2eadmin_threevm_appplugin_00000000"
PLUGIN_PACKAGE="@lamalibre/e2e-app-plugin-server"
PLUGIN_NAME="e2e-app-plugin"
AGENT_LABEL="e2e-agent"
AGENT_DIR="/root/.lamalibre/lamaste/agents/${AGENT_LABEL}"
AGENT_CONFIG="${AGENT_DIR}/config.json"
PLUGIN_CONFIG_FILE="${AGENT_DIR}/app-plugins/${PLUGIN_NAME}.json"
SYNC_TIMER="lamalibre-lamaste-sync-${AGENT_LABEL}.timer"
CHISEL_SERVICE="lamalibre-lamaste-chisel-${AGENT_LABEL}.service"
REMOTE_DIR="/tmp/e2e-31-app-plugin"
HALF_LOG="${REMOTE_DIR}/half.log"
LOCAL_TMP=""
HOST_AGENT_LABEL=""
PORT=""
TUNNEL_ID=""
# Where the agent VM's global lamaste-agent install keeps @lamalibre/lamaste
AGENT_LIB_DIR=""
AGENT_LIB_PARENT=""

begin_test "31 — Agent-hosted plugin through the internal tunnel (Three-VM)"

cleanup() {
  log_info "Cleaning up test resources..."
  # Uninstalling tears a hosting down first (an operation); one still running
  # refuses it until it ends.
  timed_exec 240 multipass exec lamaste-host -- sudo bash -c "${CURL_MTLS} -X POST https://127.0.0.1:9292/api/plugins/${PLUGIN_NAME}/disable > /dev/null 2>&1; for _ in \$(seq 1 70); do [ \"\$(${CURL_MTLS} -o /dev/null -w '%{http_code}' https://127.0.0.1:9292/api/plugins/${PLUGIN_NAME})\" = 404 ] && break; ${CURL_MTLS} -X DELETE 'https://127.0.0.1:9292/api/plugins/${PLUGIN_NAME}?force=true' > /dev/null 2>&1; sleep 3; done; rm -f /etc/lamalibre/lamaste/.npmrc; pkill -f '[s]tub-registry.mjs' 2>/dev/null; rm -rf ${REMOTE_DIR}; true" > /dev/null 2>&1
  timed_exec 60 multipass exec lamaste-agent -- sudo bash -c "pkill -f '[a]pp-plugin-half.mjs' 2>/dev/null; rm -rf ${REMOTE_DIR}; true" > /dev/null 2>&1
  if [ -n "$AGENT_LIB_PARENT" ]; then
    timed_exec 60 multipass exec lamaste-agent -- sudo bash -c "cd ${AGENT_LIB_PARENT} && node --input-type=module -e \"import('@lamalibre/lamaste/agent').then((m) => m.setAgentTunnelsStopped('${AGENT_LABEL}', false))\" 2>/dev/null; lamaste-agent sync --label ${AGENT_LABEL} 2>/dev/null; true" > /dev/null 2>&1
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
log_info "Agent VM's @lamalibre/lamaste: ${AGENT_LIB_DIR}"

# ===========================================================================
# 1. Install and enable on the host; host on the agent
# ===========================================================================

log_section "Install, enable, host on ${HOST_AGENT_LABEL}"

LOCAL_TMP=$(mktemp -d /tmp/e2e-31-app-plugin-XXXXXXXX)
write_stub_registry "${LOCAL_TMP}/stub-registry.mjs"
write_app_plugin_fixture "${LOCAL_TMP}/fixture"
write_app_plugin_half "${LOCAL_TMP}/app-plugin-half.mjs"
host_exec "rm -rf ${REMOTE_DIR} && mkdir -p ${REMOTE_DIR}/fixture && chmod -R a+rwx ${REMOTE_DIR}"
multipass transfer "${LOCAL_TMP}/stub-registry.mjs" "lamaste-host:${REMOTE_DIR}/stub-registry.mjs"
multipass transfer "${LOCAL_TMP}/fixture/package.json" "lamaste-host:${REMOTE_DIR}/fixture/package.json"
multipass transfer "${LOCAL_TMP}/fixture/index.js" "lamaste-host:${REMOTE_DIR}/fixture/index.js"
multipass transfer "${LOCAL_TMP}/fixture/lamaste-plugin.json" "lamaste-host:${REMOTE_DIR}/fixture/lamaste-plugin.json"
agent_exec "rm -rf ${REMOTE_DIR} && mkdir -p ${REMOTE_DIR} && chmod a+rwx ${REMOTE_DIR}"
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

INSTALL_RESPONSE=$(host_api_post "plugins/install" "{\"packageName\":\"${PLUGIN_PACKAGE}\"}")
assert_json_field "$INSTALL_RESPONSE" '.plugin.hosting' 'agent' "Fixture installed as agent-hosted" || true
ENABLE_RESPONSE=$(host_api_post "plugins/${PLUGIN_NAME}/enable" '{}')
assert_json_field "$ENABLE_RESPONSE" '.status' 'enabled' "Plugin enabled" || true

# sync.log outlives a run: count only the lines this run adds.
SYNC_LOG_MARK=$(agent_exec "cat ${AGENT_DIR}/logs/sync.log 2>/dev/null | wc -l" 2>/dev/null || echo "0")
HOST_RESPONSE=$(host_api_post "plugins/${PLUGIN_NAME}/hosting" "{\"agentLabel\":\"${HOST_AGENT_LABEL}\"}")
assert_json_field "$HOST_RESPONSE" '.operation.kind' 'host' "Hosting on ${HOST_AGENT_LABEL} started as an operation" || true
HOST_OP_ID=$(echo "$HOST_RESPONSE" | jq -r '.operation.id' 2>/dev/null || echo "")
reserved() { [ -n "$(hosting_field '.hosting.port // empty')" ]; }
wait_for 30 reserved || true
PORT=$(hosting_field '.hosting.port')
TUNNEL_ID=$(hosting_field '.hosting.tunnelId')
if [ "$PORT" -ge 21000 ] 2>/dev/null && [ "$PORT" -le 21999 ] 2>/dev/null; then
  log_pass "Port ${PORT} assigned from the internal range"
else
  log_fail "Port ${PORT} is not in 21000–21999"
fi

# ===========================================================================
# 2. The sync timer delivers the plugin config to the agent
# ===========================================================================

log_section "The agent's sync timer fetches and acknowledges the plugin config"

config_present() { agent_exec "test -f ${PLUGIN_CONFIG_FILE}" 2>/dev/null; }
if wait_for 90 config_present; then
  log_pass "Plugin config file appeared on the agent VM within 90 seconds"
else
  log_fail "No plugin config at ${PLUGIN_CONFIG_FILE} after 90 seconds"
fi
assert_eq "$(plugin_config_field '.plugin')" "${PLUGIN_NAME}" "The file names the plugin" || true
assert_eq "$(plugin_config_field '.port')" "${PORT}" "The file carries the assigned port" || true
FILE_MODE=$(agent_exec "stat -c '%a' ${PLUGIN_CONFIG_FILE}" 2>/dev/null || echo "")
assert_eq "$FILE_MODE" "600" "The file is 0600" || true
acked_on_agent() { [ "$(plugin_config_field '.acknowledged')" = "true" ]; }
if wait_for 60 acked_on_agent; then
  log_pass "The agent acknowledged the secret"
else
  log_fail "The agent did not acknowledge the secret"
fi
acked_on_host() { [ "$(hosting_field '.hosting.secretAcknowledged')" = "true" ]; }
if wait_for 30 acked_on_host; then
  log_pass "The host records the acknowledgement"
else
  log_fail "The host does not record the acknowledgement"
fi
SYNC_LOG=$(agent_exec "tail -n 20 ${AGENT_DIR}/logs/sync.log 2>/dev/null" 2>/dev/null || echo "")
assert_contains "$SYNC_LOG" "plugin config fetched: ${PLUGIN_NAME}" "sync.log records the fetch" || true

# ===========================================================================
# 3. The agent half on the agent VM, reached through the tunnel
# ===========================================================================

log_section "Forwarding through the internal tunnel"

agent_exec "nohup node ${REMOTE_DIR}/app-plugin-half.mjs --config ${PLUGIN_CONFIG_FILE} --plugin ${PLUGIN_NAME} --lamaste ${AGENT_LIB_DIR} --log ${HALF_LOG} &> ${REMOTE_DIR}/half.out & exit"
half_up() { [ "$(agent_exec "curl -s -o /dev/null -w '%{http_code}' --max-time 2 http://127.0.0.1:${PORT}/admin/health" 2>/dev/null)" = "401" ]; }
if wait_for 30 half_up; then
  log_pass "Agent half listens on the agent VM's 127.0.0.1:${PORT}"
else
  log_fail "Agent half did not start: $(agent_exec "cat ${REMOTE_DIR}/half.out" 2>/dev/null)"
fi

# The chisel client picks the new grant up on its next sync.
tunnel_up() { [ "$(host_exec "curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:${PORT}/admin/health" 2>/dev/null)" = "401" ]; }
if wait_for 90 tunnel_up; then
  log_pass "The host's loopback port ${PORT} reaches the agent half through chisel"
else
  log_fail "The internal tunnel did not come up within 90 seconds"
fi

HOST_OP=$(wait_operation "${HOST_OP_ID}" 180)
assert_json_field "$HOST_OP" '.status' 'succeeded' "The hosting operation succeeded once the agent half answered through the tunnel" || true
assert_eq "$(hosting_field '.hosting.phase')" "active" "The hosting is active" || true

PING=$(host_api_get "${PLUGIN_NAME}/ping")
assert_json_field "$PING" '.pong' 'true' "GET /api/${PLUGIN_NAME}/ping reaches the agent half across VMs" || true
assert_json_field "$PING" '.caller.type' 'admin' "The caller assertion names the admin" || true
assert_json_field "$PING" '.cookie' 'null' "No cookie crosses the tunnel" || true
BUNDLE=$(host_api_get "${PLUGIN_NAME}/panel.js")
assert_contains "$BUNDLE" "__lamalibrePlugins" "The admin bundle comes from the agent half" || true
# /api/<route>/app is the user surface's (slice 6): a relay assertion from
# Gatekeeper or nothing — the admin forwarder never reaches /admin/app*.
assert_eq "$(host_api_get_status "${PLUGIN_NAME}/app/secret")" "401" "The user surface is out of the forwarder's reach: 401 without a relay assertion" || true

if wait_health up 60; then
  log_pass "Health is up"
else
  log_fail "Health did not reach up: $(hosting_field '.hosting.health')"
fi

# ===========================================================================
# 4. Rotation, picked up by the sync timer
# ===========================================================================

log_section "Secret rotation across the tunnel"

ISSUED_BEFORE=$(hosting_field '.hosting.secretIssuedAt')
ROTATE=$(host_api_post "plugins/${PLUGIN_NAME}/hosting/rotate-secret" '{}')
assert_json_field "$ROTATE" '.hosting.rotationPending' 'true' "Rotation pending" || true
STILL=$(host_api_get "${PLUGIN_NAME}/ping")
assert_json_field "$STILL" '.pong' 'true' "Calls keep working while the rotation is pending" || true
rotation_done() { [ "$(hosting_field '.hosting.rotationPending')" = "false" ] && [ "$(hosting_field '.hosting.secretAcknowledged')" = "true" ]; }
if wait_for 90 rotation_done; then
  log_pass "The sync timer fetched and acknowledged the new secret within 90 seconds"
else
  log_fail "Rotation not completed: $(host_api_get "plugins/${PLUGIN_NAME}/hosting")"
fi
assert_not_eq "$(plugin_config_field '.issuedAt')" "${ISSUED_BEFORE}" "The agent's file carries the new secret" || true
FETCH_LINES=$(agent_exec "tail -n +$((SYNC_LOG_MARK + 1)) ${AGENT_DIR}/logs/sync.log | grep -c 'plugin config fetched: ${PLUGIN_NAME}'" 2>/dev/null || echo "0")
assert_eq "$FETCH_LINES" "2" "sync.log records the rotation's fetch as well" || true
AFTER=$(host_api_get "${PLUGIN_NAME}/ping")
assert_json_field "$AFTER" '.pong' 'true' "Calls work on the new secret" || true

# ===========================================================================
# 5. Health: application down, tunnel down, both back
# ===========================================================================

log_section "Health: application down"

agent_exec "pkill -f '[a]pp-plugin-half.mjs' 2>/dev/null || true"
sleep 1
DOWN_STATUS=$(host_api_get_status "${PLUGIN_NAME}/ping")
assert_eq "$DOWN_STATUS" "502" "A stopped agent half behind a live tunnel is a 502" || true
if wait_health down 60; then
  log_pass "Health reports down within 60 seconds"
else
  log_fail "Health did not report down: $(hosting_field '.hosting.health')"
fi
assert_eq "$(hosting_field '.hosting.health.reason')" "app" "The tunnel is up, the application is down: reason app" || true

agent_exec "nohup node ${REMOTE_DIR}/app-plugin-half.mjs --config ${PLUGIN_CONFIG_FILE} --plugin ${PLUGIN_NAME} --lamaste ${AGENT_LIB_DIR} --log ${HALF_LOG} &> ${REMOTE_DIR}/half.out & exit"
if wait_for 30 half_up && wait_health up 60; then
  log_pass "Health is up again with the agent half back"
else
  log_fail "Health did not recover: $(hosting_field '.hosting.health')"
fi

log_section "Health: tunnel down"

set_tunnels_stopped true
CHISEL_STATE=$(user_systemctl "is-active ${CHISEL_SERVICE} 2>/dev/null || true")
assert_not_eq "$CHISEL_STATE" "active" "The agent's tunnel client is stopped" || true
if wait_health down 75; then
  log_pass "Health reports down within 75 seconds"
else
  log_fail "Health did not report down: $(hosting_field '.hosting.health')"
fi
assert_eq "$(hosting_field '.hosting.health.reason')" "tunnel" "Nothing listens on the relay port: reason tunnel" || true
TUNNEL_DOWN=$(host_api_get "${PLUGIN_NAME}/ping" 2>/dev/null || host_exec "${CURL_MTLS} https://127.0.0.1:9292/api/${PLUGIN_NAME}/ping")
assert_json_field "$TUNNEL_DOWN" '.reason' 'tunnel' "The forwarder answers 502 with reason tunnel" || true

set_tunnels_stopped false
agent_exec "lamaste-agent sync --label ${AGENT_LABEL} > /dev/null 2>&1 || true"
if wait_for 90 tunnel_up && wait_health up 60; then
  log_pass "Health is up again once the tunnel client runs"
else
  log_fail "Health did not recover after the tunnel came back: $(hosting_field '.hosting.health')"
fi

# ===========================================================================
# 6. Clearing the hosting
# ===========================================================================

log_section "Clear the hosting"

UNHOST=$(host_api_delete "plugins/${PLUGIN_NAME}/hosting")
UNHOST_OP=$(wait_operation "$(echo "$UNHOST" | jq -r '.operation.id' 2>/dev/null)" 120)
assert_json_field "$UNHOST_OP" '.status' 'succeeded' "Hosting removed" || true
TUNNEL_LEFT=$(host_api_get "tunnels?limit=500" | jq "[.tunnels[] | select(.id == \"${TUNNEL_ID}\")] | length" 2>/dev/null || echo "-1")
assert_eq "$TUNNEL_LEFT" "0" "The internal tunnel is gone" || true
config_gone() { ! agent_exec "test -f ${PLUGIN_CONFIG_FILE}" 2>/dev/null; }
if wait_for 90 config_gone; then
  log_pass "The sync timer removed the agent's plugin config file"
else
  log_fail "The plugin config file is still on the agent VM"
fi
SYNC_LOG=$(agent_exec "tail -n 20 ${AGENT_DIR}/logs/sync.log 2>/dev/null" 2>/dev/null || echo "")
assert_contains "$SYNC_LOG" "plugin config removed: ${PLUGIN_NAME}" "sync.log records the removal" || true
tunnel_down() { [ "$(host_exec "curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:${PORT}/admin/health" 2>/dev/null)" != "401" ]; }
if wait_for 90 tunnel_down; then
  log_pass "The relay port no longer reaches the agent half"
else
  log_fail "The relay port still reaches the agent half after the grant was withdrawn"
fi

end_test

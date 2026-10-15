#!/usr/bin/env bash
# ============================================================================
# 29 — Agent-hosted plugin: hosting, forwarding, installation secret
# ============================================================================
# Hosts an agent-hosted plugin that has an agent half (fixture
# @lamalibre/e2e-app-plugin-server, served by a stand-in registry on the VM)
# on an agent, and verifies on one VM:
# - hosting is an operation (4.3): it reserves an internal plugin tunnel
#   (port assigned from 21000–21999, no hostname, no access mode, not
#   editable as a tunnel) and grants the agent `plugin:<route>:host`; with no
#   agent hook to run first it grants the tunnel at once, and it succeeds
#   once the agent half (started with the config the agent fetched) answers
#   through it; a manual tunnel on such a port is refused
# - only the hosting agent's certificate fetches the plugin config (port and
#   secret) and acknowledges it
# - the panel forwards /api/<route>/* to the agent half's /admin/* with a
#   caller assertion: pages and the bundle work, the user surface (/app) is
#   out of reach, credentials never pass, bodies stream, the body limit
#   holds, server-sent events pass through, a loopback call without an
#   assertion is refused
# - rotating the secret keeps calls working, before and after the agent
#   acknowledges the new one
# - a stopped agent half is a clean 502, and the health monitor reports
#   down (app, then tunnel) and up again
# - clearing the hosting and uninstalling the plugin remove tunnel, secret
#   and capability; the same through lamaste-server plugins host|unhost
#
# The agent half listens on the relay loopback directly: on one VM the
# chisel client cannot bind the assigned port (the chisel server holds it
# when an agent connects), so the tunnel leg is proven by three-VM spec 31.
# ============================================================================

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/helpers.sh"

require_commands curl jq node npm

begin_test "29 — Agent-hosted plugin: hosting, forwarding, installation secret"

# ---------------------------------------------------------------------------
log_section "Pre-flight: check onboarding is complete"
# ---------------------------------------------------------------------------

ONBOARDING_STATUS=$(api_get "onboarding/status" | jq -r '.status' 2>/dev/null || echo "unknown")
if [ "$ONBOARDING_STATUS" != "COMPLETED" ]; then
  log_skip "Onboarding not completed — skipping agent-hosted plugin forwarding tests"
  end_test
  exit $?
fi
log_pass "Onboarding is complete"

DOMAIN=$(api_get "onboarding/status" | jq -r '.domain' 2>/dev/null || echo "null")
if [ -z "$DOMAIN" ] || [ "$DOMAIN" = "null" ]; then
  log_skip "No domain configured — skipping"
  end_test
  exit $?
fi
log_info "Domain: ${DOMAIN}"

STATE_DIR="/etc/lamalibre/lamaste"
WORK_DIR="/tmp/lamalibre-lamaste-e2e-app-plugin"
STUB_PORT=4874
STUB_URL="http://127.0.0.1:${STUB_PORT}"
STUB_ADMIN_TOKEN="feria_e2eadmin_appplugin_000000000000000"
PLUGIN_PACKAGE="@lamalibre/e2e-app-plugin-server"
PLUGIN_NAME="e2e-app-plugin"
AGENT_LABEL="e2e-apphost-$(date +%s)"
AGENT_CERT_DIR="${WORK_DIR}/agent-cert"
HALF_CONFIG="${WORK_DIR}/plugin-config.json"
HALF_LOG="${WORK_DIR}/half.log"
LAMASTE_LIB="/opt/lamalibre/lamaste/serverd/node_modules/@lamalibre/lamaste"
PORT=""

cleanup() {
  pkill -f '[a]pp-plugin-half.mjs' 2>/dev/null || true
  pkill -f "[h]ttp.server ${PORT:-0}" 2>/dev/null || true
  # Uninstalling tears a hosting down first (an operation); one still
  # running refuses it until it ends.
  api_post "plugins/${PLUGIN_NAME}/disable" > /dev/null 2>&1 || true
  local deadline=$((SECONDS + 180))
  while [ "$SECONDS" -lt "$deadline" ] && [ "$(api_get_status "plugins/${PLUGIN_NAME}")" != "404" ]; do
    api_delete "plugins/${PLUGIN_NAME}?force=true" > /dev/null 2>&1 || true
    sleep 3
  done
  api_delete "certs/agent/${AGENT_LABEL}" > /dev/null 2>&1 || true
  rm -f "${STATE_DIR}/.npmrc"
  pkill -f '[s]tub-registry.mjs' 2>/dev/null || true
  rm -rf "${WORK_DIR}"
}
trap cleanup EXIT

# agent_api_get path — GET as the test agent (its own certificate)
agent_api_get() {
  curl -sk --max-time 30 --cert "${AGENT_CERT_DIR}/client.crt" --key "${AGENT_CERT_DIR}/client.key" --cacert "${STATE_DIR}/pki/ca.crt" -H 'Accept: application/json' "${BASE_URL}/api/$1"
}
agent_api_get_status() {
  curl -sk --max-time 30 -o /dev/null -w '%{http_code}' --cert "${AGENT_CERT_DIR}/client.crt" --key "${AGENT_CERT_DIR}/client.key" --cacert "${STATE_DIR}/pki/ca.crt" "${BASE_URL}/api/$1" 2>/dev/null || echo "000"
}
agent_api_post() {
  curl -sk --max-time 30 --cert "${AGENT_CERT_DIR}/client.crt" --key "${AGENT_CERT_DIR}/client.key" --cacert "${STATE_DIR}/pki/ca.crt" -X POST -H 'Content-Type: application/json' -H 'Accept: application/json' -d "$2" "${BASE_URL}/api/$1"
}

# hosting_field jq-expr — a field of GET /api/plugins/<name>/hosting
hosting_field() {
  api_get "plugins/${PLUGIN_NAME}/hosting" | jq -r "$1" 2>/dev/null || echo ""
}

# wait_operation <operation id> <seconds> — prints the operation once it ended
# (still running after <seconds>: printed as is; the caller asserts its status)
wait_operation() {
  local id="$1" deadline=$((SECONDS + $2)) op
  while [ "$SECONDS" -lt "$deadline" ]; do
    op=$(api_get "plugins/${PLUGIN_NAME}/operations/${id}" | jq -c '.operation' 2>/dev/null || echo '{}')
    if [ "$(echo "$op" | jq -r '.status' 2>/dev/null)" != "running" ]; then
      echo "$op"
      return 0
    fi
    sleep 2
  done
  echo "$op"
  return 0
}

# wait_phase <phase> <seconds> — until the hosting is in <phase>
wait_phase() {
  local deadline=$((SECONDS + $2))
  while [ "$SECONDS" -lt "$deadline" ]; do
    if [ "$(hosting_field '.hosting.phase')" = "$1" ]; then
      return 0
    fi
    sleep 1
  done
  return 1
}

# wait_health <state> <seconds> — until the hosting's health.state is <state>
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

# write_half_config <plugin-config json> — the file the agent would write
write_half_config() {
  echo "$1" | jq '. + {fetchedAt: (now | todate), acknowledged: false}' > "${HALF_CONFIG}.tmp"
  chmod 600 "${HALF_CONFIG}.tmp"
  mv "${HALF_CONFIG}.tmp" "${HALF_CONFIG}"
}

start_half() {
  pkill -f '[a]pp-plugin-half.mjs' 2>/dev/null || true
  nohup node "${WORK_DIR}/app-plugin-half.mjs" --config "${HALF_CONFIG}" --plugin "${PLUGIN_NAME}" --lamaste "${LAMASTE_LIB}" --log "${HALF_LOG}" &> "${WORK_DIR}/half.out" &
  local deadline=$((SECONDS + 20))
  while [ "$SECONDS" -lt "$deadline" ]; do
    if [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "http://127.0.0.1:${PORT}/admin/health" 2>/dev/null)" = "401" ]; then
      return 0
    fi
    sleep 1
  done
  return 1
}

# ===========================================================================
# 1. Stand-in registry, install, enable
# ===========================================================================

log_section "Install and enable the app plugin fixture"

rm -rf "${WORK_DIR}"
mkdir -p "${WORK_DIR}" "${AGENT_CERT_DIR}"
chmod 700 "${AGENT_CERT_DIR}"
write_stub_registry "${WORK_DIR}/stub-registry.mjs"
write_app_plugin_fixture "${WORK_DIR}/fixture"
write_app_plugin_half "${WORK_DIR}/app-plugin-half.mjs"
pkill -f '[s]tub-registry.mjs' 2>/dev/null || true
nohup node "${WORK_DIR}/stub-registry.mjs" --port "${STUB_PORT}" --admin-token "${STUB_ADMIN_TOKEN}" --issuer "https://auth.${DOMAIN}" --audience "${STUB_URL}" --jwks-url http://127.0.0.1:9091/jwks.json --package "${WORK_DIR}/fixture" &> "${WORK_DIR}/stub.log" &
if wait_for_http "${STUB_URL}/-/ping" 30; then
  log_pass "Stand-in registry is up on ${STUB_URL}"
else
  log_fail "Stand-in registry did not start: $(cat "${WORK_DIR}/stub.log" 2>/dev/null)"
  end_test
  exit $?
fi
printf '@lamalibre:registry=%s/\n//127.0.0.1:%s/:_authToken=%s\n' "${STUB_URL}" "${STUB_PORT}" "${STUB_ADMIN_TOKEN}" > "${WORK_DIR}/npmrc"
install -o lamaste -g lamaste -m 0600 "${WORK_DIR}/npmrc" "${STATE_DIR}/.npmrc"

INSTALL_RESPONSE=$(api_post "plugins/install" "{\"packageName\":\"${PLUGIN_PACKAGE}\"}")
assert_json_field "$INSTALL_RESPONSE" '.ok' 'true' "App plugin fixture installed" || true
assert_json_field "$INSTALL_RESPONSE" '.plugin.hosting' 'agent' "Install records hosting agent" || true
assert_json_field "$INSTALL_RESPONSE" '.plugin.agent.requires.node' '>=22' "Install records the agent block" || true
assert_json_field "$INSTALL_RESPONSE" '.plugin.panel.pages | length' '1' "A plugin with an agent half may declare panel pages" || true

ENABLE_RESPONSE=$(api_post "plugins/${PLUGIN_NAME}/enable")
assert_json_field "$ENABLE_RESPONSE" '.status' 'enabled' "Plugin enabled" || true
LISTED=$(api_get "plugins" | jq -r ".plugins[] | select(.name == \"${PLUGIN_NAME}\") | .agentHosting" 2>/dev/null || echo "")
assert_eq "$LISTED" "null" "GET /api/plugins shows the plugin as not hosted" || true
UNHOSTED_STATUS=$(api_get_status "${PLUGIN_NAME}/ping")
assert_eq "$UNHOSTED_STATUS" "503" "An enabled but unhosted plugin's route answers 503" || true

# ===========================================================================
# 2. An agent to host it on
# ===========================================================================

log_section "Enroll the hosting agent"

CERT_RESPONSE=$(api_post "certs/agent" "{\"label\":\"${AGENT_LABEL}\",\"capabilities\":[\"tunnels:read\"]}")
assert_json_field "$CERT_RESPONSE" '.ok' 'true' "Agent certificate issued for ${AGENT_LABEL}" || true
P12_PASS=$(echo "$CERT_RESPONSE" | jq -r '.p12Password' 2>/dev/null || echo "")
openssl pkcs12 -in "${STATE_DIR}/pki/agents/${AGENT_LABEL}/client.p12" -out "${AGENT_CERT_DIR}/client.crt" -clcerts -nokeys -passin pass:"${P12_PASS}" 2>/dev/null
openssl pkcs12 -in "${STATE_DIR}/pki/agents/${AGENT_LABEL}/client.p12" -out "${AGENT_CERT_DIR}/client.key" -nocerts -nodes -passin pass:"${P12_PASS}" 2>/dev/null
chmod 600 "${AGENT_CERT_DIR}/client.key"
unset P12_PASS
ME=$(agent_api_get "agents/me/capabilities")
assert_json_field "$ME" '.role' 'agent' "The agent certificate authenticates" || true
BEFORE_CONFIG_STATUS=$(agent_api_get_status "agents/me/plugin-config/${PLUGIN_NAME}")
assert_eq "$BEFORE_CONFIG_STATUS" "403" "Without the host capability the plugin config is refused" || true

# ===========================================================================
# 3. Hosting: internal tunnel, capability, secret
# ===========================================================================

log_section "Host the plugin on the agent"

MISSING_AGENT_STATUS=$(api_post_status "plugins/${PLUGIN_NAME}/hosting" '{"agentLabel":"no-such-agent"}')
assert_eq "$MISSING_AGENT_STATUS" "400" "Hosting on an unknown agent is refused" || true

HOST_RESPONSE=$(api_post "plugins/${PLUGIN_NAME}/hosting" "{\"agentLabel\":\"${AGENT_LABEL}\"}")
assert_json_field "$HOST_RESPONSE" '.ok' 'true' "Hosting on ${AGENT_LABEL} started" || true
assert_json_field "$HOST_RESPONSE" '.operation.kind' 'host' "…as an operation" || true
HOST_OP_ID=$(echo "$HOST_RESPONSE" | jq -r '.operation.id' 2>/dev/null || echo "")

if wait_phase installing 30; then
  log_pass "The hosting is reserved (phase installing)"
else
  log_fail "The hosting was not reserved: $(api_get "plugins/${PLUGIN_NAME}/hosting")"
fi
HOSTING=$(api_get "plugins/${PLUGIN_NAME}/hosting")
PORT=$(echo "$HOSTING" | jq -r '.hosting.port' 2>/dev/null || echo "0")
if [ "$PORT" -ge 21000 ] 2>/dev/null && [ "$PORT" -le 21999 ] 2>/dev/null; then
  log_pass "Port ${PORT} assigned from the internal range"
else
  log_fail "Port ${PORT} is not in 21000–21999"
fi
assert_json_field "$HOSTING" '.hosting.secretAcknowledged' 'false' "The secret is not yet fetched" || true
assert_json_field "$HOSTING" '.hosting.health.state' 'unknown' "Health starts unknown" || true
TUNNEL_ID=$(echo "$HOSTING" | jq -r '.hosting.tunnelId' 2>/dev/null || echo "")

TWICE_STATUS=$(api_post_status "plugins/${PLUGIN_NAME}/hosting" "{\"agentLabel\":\"${AGENT_LABEL}\"}")
assert_eq "$TWICE_STATUS" "409" "A plugin has one hosting" || true

TUNNEL=$(api_get "tunnels?limit=500" | jq ".tunnels[] | select(.id == \"${TUNNEL_ID}\")" 2>/dev/null || echo "{}")
assert_json_field "$TUNNEL" '.exposure' 'internal' "The tunnel is internal" || true
assert_json_field "$TUNNEL" '.subdomain' 'null' "An internal tunnel has no subdomain" || true
assert_json_field "$TUNNEL" '.fqdn' 'null' "An internal tunnel has no hostname" || true
assert_json_field "$TUNNEL" '.accessMode' 'null' "An internal tunnel has no access mode" || true
assert_json_field "$TUNNEL" '.agentLabel' "${AGENT_LABEL}" "The hosting agent carries it" || true
assert_json_field "$TUNNEL" '.pluginRoute' "${PLUGIN_NAME}" "The tunnel names the plugin" || true
VHOST_PRESENT=$(ls /etc/nginx/sites-available 2>/dev/null | grep -c "${PLUGIN_NAME}" || true)
assert_eq "$VHOST_PRESENT" "0" "No nginx vhost was written for it" || true
# Nothing to run on the agent before the tunnel (no install:pre-tunnel hook):
# the grant follows the reservation, and the operation waits for the agent half.
granted() { [ "$(api_get "tunnels?limit=500" | jq -r ".tunnels[] | select(.id == \"${TUNNEL_ID}\") | .enabled" 2>/dev/null)" = "true" ]; }
for _ in $(seq 1 20); do granted && break; sleep 1; done
if granted; then log_pass "The tunnel is granted"; else log_fail "The tunnel was not granted"; fi
# The authfile is JSON: the pattern's backslashes are doubled in it.
GRANT=$(grep -cF "R:127\\\\.0\\\\.0\\\\.1:${PORT}\$" "${STATE_DIR}/chisel-users" 2>/dev/null || true)
assert_eq "$GRANT" "1" "The chisel authfile grants the agent port ${PORT}" || true
assert_eq "$(hosting_field '.hosting.phase')" "installing" "…while the operation waits for the agent half (phase installing)" || true

CAPS=$(api_get "certs/agent" | jq -c ".agents[] | select(.label == \"${AGENT_LABEL}\") | .capabilities" 2>/dev/null || echo "[]")
assert_contains "$CAPS" "plugin:${PLUGIN_NAME}:host" "The agent holds plugin:${PLUGIN_NAME}:host" || true

MANUAL_STATUS=$(api_post_status "tunnels" "{\"subdomain\":\"e2e29manual\",\"port\":21005,\"agentLabel\":\"${AGENT_LABEL}\"}")
assert_eq "$MANUAL_STATUS" "400" "A manual tunnel on a port of the internal range is refused" || true
PATCH_STATUS=$(api_patch_status "tunnels/${TUNNEL_ID}" '{"accessMode":"public"}')
assert_eq "$PATCH_STATUS" "403" "The internal tunnel cannot be changed through the tunnels API" || true
DELETE_STATUS=$(api_delete_status "tunnels/${TUNNEL_ID}")
assert_eq "$DELETE_STATUS" "403" "The internal tunnel cannot be deleted through the tunnels API" || true

# ===========================================================================
# 4. The hosting agent fetches and acknowledges the plugin config
# ===========================================================================

log_section "Plugin config: hosting agent only"

ADMIN_CONFIG_STATUS=$(api_get_status "agents/me/plugin-config/${PLUGIN_NAME}")
assert_eq "$ADMIN_CONFIG_STATUS" "403" "The admin certificate has no agent identity to read a plugin config" || true

AGENT_CONFIG=$(agent_api_get "tunnels/agent-config")
assert_json_field "$AGENT_CONFIG" ".appPlugins[0].route" "${PLUGIN_NAME}" "agent-config lists the hosted plugin" || true
assert_json_field "$AGENT_CONFIG" ".appPlugins[0].port" "${PORT}" "agent-config carries its port" || true
assert_json_field "$AGENT_CONFIG" ".appPlugins[0].phase" "installing" "agent-config carries its phase" || true
assert_json_field "$AGENT_CONFIG" ".appPlugins[0].secretAcknowledged" "false" "agent-config says the secret is not acknowledged" || true

PLUGIN_CONFIG=$(agent_api_get "agents/me/plugin-config/${PLUGIN_NAME}")
assert_json_field "$PLUGIN_CONFIG" '.plugin' "${PLUGIN_NAME}" "The hosting agent fetches its plugin config" || true
assert_json_field "$PLUGIN_CONFIG" '.port' "${PORT}" "The config carries the port" || true
SECRET_SHAPE=$(echo "$PLUGIN_CONFIG" | jq -r '.secret | test("^[a-f0-9]{64}$")' 2>/dev/null || echo "false")
assert_eq "$SECRET_SHAPE" "true" "The secret is 32 random bytes, hex" || true
ISSUED_AT=$(echo "$PLUGIN_CONFIG" | jq -r '.issuedAt' 2>/dev/null || echo "")
write_half_config "$PLUGIN_CONFIG"

ACK=$(agent_api_post "agents/me/plugin-config/${PLUGIN_NAME}/ack" "{\"issuedAt\":\"${ISSUED_AT}\"}")
assert_json_field "$ACK" '.acknowledged' 'true' "The agent acknowledges the secret" || true
assert_eq "$(hosting_field '.hosting.secretAcknowledged')" "true" "The hosting records the acknowledgement" || true

if start_half; then
  log_pass "Agent half listens on 127.0.0.1:${PORT} and refuses a bare call (401)"
else
  log_fail "Agent half did not start: $(cat "${WORK_DIR}/half.out" 2>/dev/null)"
fi
HOST_OP=$(wait_operation "${HOST_OP_ID}" 180)
assert_json_field "$HOST_OP" '.status' 'succeeded' "The hosting operation succeeded once the agent half answered" || true
assert_eq "$(hosting_field '.hosting.phase')" "active" "The hosting is active" || true

# ===========================================================================
# 5. Forwarding
# ===========================================================================

log_section "Forwarding through /api/${PLUGIN_NAME}/*"

BARE=$(curl -s --max-time 5 "http://127.0.0.1:${PORT}/admin/ping" 2>/dev/null || echo "{}")
assert_json_field "$BARE" '.reason' 'malformed' "A loopback call without an assertion is refused" || true

PING=$(api_get "${PLUGIN_NAME}/ping?x=1")
assert_json_field "$PING" '.pong' 'true' "GET /api/${PLUGIN_NAME}/ping reaches the agent half" || true
assert_json_field "$PING" '.caller.type' 'admin' "The assertion names the admin caller" || true
assert_json_field "$PING" '.path' '/admin/ping?x=1' "The path is mapped under /admin with its query" || true
assert_json_field "$PING" '.sslClientDn' 'null' "nginx's client-certificate headers do not pass" || true

ROOT=$(api_get "${PLUGIN_NAME}")
assert_json_field "$ROOT" '.path' '/admin' "GET /api/${PLUGIN_NAME} maps to /admin" || true

COOKIE_PING=$(_curl_mtls -H 'Cookie: lamaste_2fa_session=secret' -H 'Authorization: Bearer leak' "${BASE_URL}/api/${PLUGIN_NAME}/ping")
assert_json_field "$COOKIE_PING" '.cookie' 'null' "The panel's cookie never reaches the agent half" || true
assert_json_field "$COOKIE_PING" '.authorization' 'null' "An Authorization header never reaches the agent half" || true

USER_SURFACE_STATUS=$(api_get_status "${PLUGIN_NAME}/app/secret")
assert_eq "$USER_SURFACE_STATUS" "404" "The agent half's /app is out of the forwarder's reach" || true
DIRECT_APP=$(curl -s --max-time 5 "http://127.0.0.1:${PORT}/app/secret" 2>/dev/null || echo "")
assert_contains "$DIRECT_APP" "USER SURFACE" "(the agent half does serve /app directly)" || true

BUNDLE=$(api_get "${PLUGIN_NAME}/panel.js")
assert_contains "$BUNDLE" "__lamalibrePlugins" "The admin bundle is served through the forwarder" || true
BUNDLE_TYPE=$(_curl_mtls -o /dev/null -w '%{content_type}' "${BASE_URL}/api/${PLUGIN_NAME}/panel.js" 2>/dev/null || echo "")
assert_contains "$BUNDLE_TYPE" "javascript" "The bundle keeps its content type" || true
PAGES=$(api_get "plugins/${PLUGIN_NAME}" | jq -r '.plugin.panel.pages[0].path' 2>/dev/null || echo "")
assert_eq "$PAGES" "/status" "The panel lists the plugin's page" || true

head -c 4096 /dev/urandom > "${WORK_DIR}/body.bin"
ECHO=$(_curl_mtls -X POST -H 'Content-Type: application/octet-stream' --data-binary "@${WORK_DIR}/body.bin" "${BASE_URL}/api/${PLUGIN_NAME}/echo")
assert_json_field "$ECHO" '.bytes' '4096' "A request body streams through" || true
ECHO_HEADERS=$(_curl_mtls -D - -o /dev/null -X POST -H 'Content-Type: application/octet-stream' --data-binary "@${WORK_DIR}/body.bin" "${BASE_URL}/api/${PLUGIN_NAME}/echo")
assert_not_contains "$ECHO_HEADERS" "app-session" "Set-Cookie from the application never passes back" || true

head -c $((11 * 1024 * 1024)) /dev/zero > "${WORK_DIR}/big.bin"
BIG_STATUS=$(_curl_mtls -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/octet-stream' --data-binary "@${WORK_DIR}/big.bin" "${BASE_URL}/api/${PLUGIN_NAME}/echo" 2>/dev/null || echo "000")
assert_eq "$BIG_STATUS" "413" "A body above the tunnel's 10 MiB limit is refused with 413" || true

SSE=$(_curl_mtls -N --max-time 10 "${BASE_URL}/api/${PLUGIN_NAME}/events" 2>/dev/null || echo "")
assert_contains "$SSE" "data: tick 3" "Server-sent events pass through nginx and the forwarder" || true
# nginx consumes X-Accel-Buffering, so look at the panel's own answer on :3100
# with the headers nginx would set for the admin certificate.
SSE_HEADERS=$(curl -s --max-time 10 -D - -o /dev/null -H 'X-SSL-Client-Verify: SUCCESS' -H 'X-SSL-Client-DN: CN=admin' "http://127.0.0.1:3100/api/${PLUGIN_NAME}/events" 2>/dev/null | tr 'A-Z' 'a-z' || echo "")
assert_contains "$SSE_HEADERS" "x-accel-buffering: no" "The panel marks the event stream unbuffered for nginx" || true

AGENT_FORWARD_STATUS=$(agent_api_get_status "${PLUGIN_NAME}/ping")
assert_eq "$AGENT_FORWARD_STATUS" "403" "The host capability alone does not admit calls to the plugin's API" || true

HALF_LINES=$(grep -c "caller=admin" "${HALF_LOG}" 2>/dev/null || true)
if [ "${HALF_LINES:-0}" -ge 5 ] 2>/dev/null; then
  log_pass "The agent half verified every forwarded call (${HALF_LINES} admin calls logged)"
else
  log_fail "The agent half logged ${HALF_LINES} verified admin calls"
fi

# ===========================================================================
# 6. Health
# ===========================================================================

log_section "Health monitor"

if wait_health up 45; then
  log_pass "Health is up within 45 seconds"
else
  log_fail "Health did not reach up: $(hosting_field '.hosting.health')"
fi
LISTED_HEALTH=$(api_get "plugins" | jq -r ".plugins[] | select(.name == \"${PLUGIN_NAME}\") | .agentHosting.health.state" 2>/dev/null || echo "")
assert_eq "$LISTED_HEALTH" "up" "GET /api/plugins carries the hosting's health" || true

# ===========================================================================
# 7. Secret rotation with overlap
# ===========================================================================

log_section "Rotate the installation secret"

ROTATE=$(api_post "plugins/${PLUGIN_NAME}/hosting/rotate-secret")
assert_json_field "$ROTATE" '.hosting.rotationPending' 'true' "Rotation pending until the agent acknowledges" || true
assert_json_field "$ROTATE" '.hosting.secretAcknowledged' 'false' "The new secret is not acknowledged yet" || true
NEW_ISSUED_AT=$(echo "$ROTATE" | jq -r '.hosting.secretIssuedAt' 2>/dev/null || echo "")
assert_not_eq "$NEW_ISSUED_AT" "$ISSUED_AT" "A new secret was issued" || true

STILL=$(api_get "${PLUGIN_NAME}/ping")
assert_json_field "$STILL" '.pong' 'true' "Calls keep working on the previous secret before the agent fetched the new one" || true

STALE_ACK=$(agent_api_post "agents/me/plugin-config/${PLUGIN_NAME}/ack" "{\"issuedAt\":\"${ISSUED_AT}\"}")
assert_json_field "$STALE_ACK" '.acknowledged' 'false' "Acknowledging the old secret changes nothing" || true

NEW_CONFIG=$(agent_api_get "agents/me/plugin-config/${PLUGIN_NAME}")
assert_json_field "$NEW_CONFIG" '.issuedAt' "${NEW_ISSUED_AT}" "The agent fetches the new secret" || true
NEW_PREVIOUS=$(echo "$NEW_CONFIG" | jq -r '.previousSecret // empty' 2>/dev/null || echo "")
assert_not_eq "$NEW_PREVIOUS" "" "The config carries the previous secret for the overlap" || true
write_half_config "$NEW_CONFIG"
NEW_ACK=$(agent_api_post "agents/me/plugin-config/${PLUGIN_NAME}/ack" "{\"issuedAt\":\"${NEW_ISSUED_AT}\"}")
assert_json_field "$NEW_ACK" '.acknowledged' 'true' "The agent acknowledges the new secret" || true
assert_eq "$(hosting_field '.hosting.rotationPending')" "false" "The previous secret is dropped once acknowledged" || true

AFTER=$(api_get "${PLUGIN_NAME}/ping")
assert_json_field "$AFTER" '.pong' 'true' "Calls work on the new secret without restarting the agent half" || true
if wait_health up 45; then
  log_pass "Health stays up across the rotation"
else
  log_fail "Health lost after the rotation: $(hosting_field '.hosting.health')"
fi

# ===========================================================================
# 8. The agent half goes away: a clean 502, health down and back
# ===========================================================================

log_section "Agent half down"

pkill -f '[a]pp-plugin-half.mjs' 2>/dev/null || true
sleep 1
START=$(date +%s)
DOWN_STATUS=$(api_get_status "${PLUGIN_NAME}/ping")
ELAPSED=$(( $(date +%s) - START ))
assert_eq "$DOWN_STATUS" "502" "A stopped agent half answers 502" || true
if [ "$ELAPSED" -le 5 ]; then
  log_pass "The 502 came in ${ELAPSED}s — no hang"
else
  log_fail "The 502 took ${ELAPSED}s"
fi
DOWN_BODY=$(api_get "${PLUGIN_NAME}/ping")
assert_json_field "$DOWN_BODY" '.reason' 'tunnel' "Nothing on the loopback port reads as the tunnel being down" || true

# Something answers on the port but it is not the agent half: the application is down.
nohup python3 -m http.server "${PORT}" --bind 127.0.0.1 -d "${WORK_DIR}" &> /dev/null &
if wait_health down 60; then
  log_pass "Health reports down within 60 seconds"
else
  log_fail "Health did not report down: $(hosting_field '.hosting.health')"
fi
assert_eq "$(hosting_field '.hosting.health.reason')" "app" "An answering port with no agent half is reason app" || true
pkill -f "[h]ttp.server ${PORT}" 2>/dev/null || true
sleep 1
for _ in $(seq 1 20); do
  if [ "$(hosting_field '.hosting.health.reason')" = "tunnel" ]; then break; fi
  sleep 3
done
assert_eq "$(hosting_field '.hosting.health.reason')" "tunnel" "A refused port is reason tunnel" || true

if start_half && wait_health up 45; then
  log_pass "Health is up again once the agent half is back"
else
  log_fail "Health did not recover: $(hosting_field '.hosting.health')"
fi

# ===========================================================================
# 9. Clear the hosting; uninstall tears it down too; the CLI
# ===========================================================================

log_section "Clear hosting and uninstall"

UNHOST=$(api_delete "plugins/${PLUGIN_NAME}/hosting")
assert_json_field "$UNHOST" '.operation.kind' 'unhost' "Removing the hosting is an operation" || true
UNHOST_OP=$(wait_operation "$(echo "$UNHOST" | jq -r '.operation.id' 2>/dev/null)" 120)
assert_json_field "$UNHOST_OP" '.status' 'succeeded' "Hosting removed" || true
assert_eq "$(api_get_status "plugins/${PLUGIN_NAME}/hosting")" "404" "GET hosting answers 404 afterwards" || true
TUNNEL_LEFT=$(api_get "tunnels?limit=500" | jq "[.tunnels[] | select(.id == \"${TUNNEL_ID}\")] | length" 2>/dev/null || echo "-1")
assert_eq "$TUNNEL_LEFT" "0" "The internal tunnel is gone" || true
CAPS_AFTER=$(api_get "certs/agent" | jq -c ".agents[] | select(.label == \"${AGENT_LABEL}\") | .capabilities" 2>/dev/null || echo "[]")
assert_not_contains "$CAPS_AFTER" "plugin:${PLUGIN_NAME}:host" "The host capability is revoked" || true
GRANT_AFTER=$(grep -cF "R:127\\\\.0\\\\.0\\\\.1:${PORT}\$" "${STATE_DIR}/chisel-users" 2>/dev/null || true)
assert_eq "$GRANT_AFTER" "0" "The chisel grant is withdrawn" || true
assert_eq "$(api_get_status "${PLUGIN_NAME}/ping")" "503" "The route answers 503 (not hosted) again" || true
assert_eq "$(agent_api_get_status "agents/me/plugin-config/${PLUGIN_NAME}")" "403" "The agent can no longer fetch the config" || true

# The CLI follows the operation, which waits for the agent half: play the
# agent's sync (fetch the new config, restart the half) while it runs.
lamaste-server plugins host "${PLUGIN_NAME}" --agent "${AGENT_LABEL}" --json > "${WORK_DIR}/cli-host.ndjson" 2> /dev/null &
CLI_PID=$!
CLI_CONFIG="{}"
for _ in $(seq 1 60); do
  CLI_CONFIG=$(agent_api_get "agents/me/plugin-config/${PLUGIN_NAME}" 2>/dev/null || echo '{}')
  if [ -n "$(echo "$CLI_CONFIG" | jq -r '.port // empty' 2>/dev/null)" ]; then break; fi
  sleep 1
done
PORT=$(echo "$CLI_CONFIG" | jq -r '.port' 2>/dev/null || echo "0")
write_half_config "$CLI_CONFIG"
start_half || log_fail "Agent half did not start for the CLI hosting"
wait "$CLI_PID" || true
CLI_HOST=$(tail -1 "${WORK_DIR}/cli-host.ndjson" 2>/dev/null || echo '{}')
assert_json_field "$CLI_HOST" '.operation.status' 'succeeded' "lamaste-server plugins host follows the operation to its end" || true
assert_json_field "$CLI_HOST" '.hosting.agentLabel' "${AGENT_LABEL}" "lamaste-server plugins host hosts the plugin" || true
CLI_STEPS=$(grep -c '"event":"step"' "${WORK_DIR}/cli-host.ndjson" 2>/dev/null || true)
if [ "${CLI_STEPS:-0}" -ge 3 ] 2>/dev/null; then
  log_pass "…reporting its steps (${CLI_STEPS})"
else
  log_fail "The CLI reported ${CLI_STEPS} steps"
fi
CLI_SHOW=$(lamaste-server plugins hosting "${PLUGIN_NAME}" 2>&1 || true)
assert_contains "$CLI_SHOW" "${AGENT_LABEL}" "lamaste-server plugins hosting shows the agent" || true
CLI_LIST=$(lamaste-server plugins list 2>&1 || true)
assert_contains "$CLI_LIST" "on ${AGENT_LABEL}" "lamaste-server plugins list shows where it is hosted" || true

DISABLE=$(api_post "plugins/${PLUGIN_NAME}/disable")
assert_json_field "$DISABLE" '.status' 'disabled' "Plugin disabled" || true
assert_eq "$(api_get_status "plugins/${PLUGIN_NAME}/hosting")" "200" "Disabling keeps the hosting" || true
UNINSTALL=$(api_delete "plugins/${PLUGIN_NAME}")
assert_json_field "$UNINSTALL" '.operation.kind' 'uninstall' "Uninstalling a hosted plugin is an operation" || true
UNINSTALL_OP=$(wait_operation "$(echo "$UNINSTALL" | jq -r '.operation.id' 2>/dev/null)" 120)
assert_json_field "$UNINSTALL_OP" '.status' 'succeeded' "Plugin uninstalled" || true
assert_eq "$(api_get_status "plugins/${PLUGIN_NAME}")" "404" "The plugin is gone" || true
INTERNAL_LEFT=$(api_get "tunnels?limit=500" | jq "[.tunnels[] | select(.exposure == \"internal\" and .pluginRoute == \"${PLUGIN_NAME}\")] | length" 2>/dev/null || echo "-1")
assert_eq "$INTERNAL_LEFT" "0" "Uninstalling removed the internal tunnel" || true
CAPS_FINAL=$(api_get "certs/agent" | jq -c ".agents[] | select(.label == \"${AGENT_LABEL}\") | .capabilities" 2>/dev/null || echo "[]")
assert_not_contains "$CAPS_FINAL" "plugin:${PLUGIN_NAME}:host" "Uninstalling revoked the host capability" || true
HOSTINGS_FILE=$(jq -r "has(\"${PLUGIN_NAME}\")" "${STATE_DIR}/plugin-hostings.json" 2>/dev/null || echo "false")
assert_eq "$HOSTINGS_FILE" "false" "The hosting record is gone" || true

end_test

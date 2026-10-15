#!/usr/bin/env bash
# ============================================================================
# 30 — Lifecycle hooks: approval, sandbox, request pipeline, relay stages
# ============================================================================
# An agent-hosted plugin with lifecycle hooks (fixture
# @lamalibre/e2e-hooks-server, from a stand-in registry on the VM), on one VM:
# - its relay hooks wait for approval: hosting is refused until the digest
#   shown is approved; the approval installs the module, root-owned, into
#   the plugin's runner (lamalibre-lamaste-hooks@<route>) and is audited
# - from inside the runner a hook cannot read Lamaste's files or
#   /etc/passwd, write, spawn, start a worker, open a TCP socket, or reach
#   the journal or D-Bus; it runs as a dynamic user with an empty environment
# - hosting runs the install pipeline as an operation: relay pre, reserve,
#   tunnel granted, the agent half's install:post-tunnel through the
#   tunnel, relay post
# - pre-forward rejects an invalid request before the agent half sees it and
#   adds a header to a valid one; post-forward redacts a planted token with
#   lamaste:secret-scan and blocks a response; a hook that never decides
#   fails closed and its runner is replaced
# - the agent half down: tunnel:down's fallback answers instead of a 502,
#   admins are notified; back up: tunnel:up, normal answers
# - update in place: same hook set applies at once (phase upgrade); a
#   changed one waits for approval, can be discarded, then approved; with
#   the plugin's auto-approve on, a changed one applies at once, audited
# - a failing relay install:pre-tunnel leaves nothing; a failing
#   install:post-tunnel rolls back to nothing (uninstall hooks, phase
#   rollback)
# - unhosting runs the uninstall pipeline; uninstalling removes the runner
#
# The agent half listens on the relay loopback (one VM cannot run the chisel
# leg), so its agent jobs (install:pre-tunnel, uninstall:post-teardown) are
# proven by three-VM spec 32; this fixture declares only the agent stages
# that run through the tunnel.
# ============================================================================

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/helpers.sh"

require_commands curl jq node npm openssl systemctl

begin_test "30 — Lifecycle hooks: approval, sandbox, request pipeline, relay stages"

# ---------------------------------------------------------------------------
log_section "Pre-flight: check onboarding is complete"
# ---------------------------------------------------------------------------

ONBOARDING_STATUS=$(api_get "onboarding/status" | jq -r '.status' 2>/dev/null || echo "unknown")
if [ "$ONBOARDING_STATUS" != "COMPLETED" ]; then
  log_skip "Onboarding not completed — skipping lifecycle hook tests"
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

if ! systemctl cat lamalibre-lamaste-hooks@.service > /dev/null 2>&1; then
  log_fail "The hook runner units are not installed (create-lamaste 4.3)"
  end_test
  exit $?
fi
log_pass "The hook runner template units are installed"

STATE_DIR="/etc/lamalibre/lamaste"
HOOKS_DIR="/opt/lamalibre/lamaste/hooks"
WORK_DIR="/tmp/lamalibre-lamaste-e2e-hooks"
STUB_PORT=4874
STUB_URL="http://127.0.0.1:${STUB_PORT}"
STUB_ADMIN_TOKEN="feria_e2eadmin_hooks_00000000000000000000"
PLUGIN="e2e-hooks"
PACKAGE="@lamalibre/e2e-hooks-server"
FAILPRE="e2e-hooks-failpre"
FAILPOST="e2e-hooks-failpost"
AGENT_LABEL="e2e-hookhost-$(date +%s)"
AGENT_CERT_DIR="${WORK_DIR}/agent-cert"
LAMASTE_LIB="/opt/lamalibre/lamaste/serverd/node_modules/@lamalibre/lamaste"
AGENT_HOOKS='{ "install": { "post-tunnel": {} }, "uninstall": { "pre-teardown": {} } }'
PORT=""

cleanup() {
  pkill -f '[a]pp-plugin-half.mjs' 2>/dev/null || true
  # Uninstalling tears a hosting down first (an operation, forced: the agent
  # half is gone); an operation still running refuses it until it ends.
  local deadline=$((SECONDS + 240)) p left
  for p in "${PLUGIN}" "${FAILPRE}" "${FAILPOST}"; do
    api_post "plugins/${p}/disable" > /dev/null 2>&1 || true
  done
  while [ "$SECONDS" -lt "$deadline" ]; do
    left=0
    for p in "${PLUGIN}" "${FAILPRE}" "${FAILPOST}"; do
      if [ "$(api_get_status "plugins/${p}")" != "404" ]; then
        left=1
        api_delete "plugins/${p}?force=true" > /dev/null 2>&1 || true
      fi
    done
    [ "$left" = "0" ] && break
    sleep 3
  done
  api_delete "certs/agent/${AGENT_LABEL}" > /dev/null 2>&1 || true
  rm -f "${STATE_DIR}/.npmrc"
  pkill -f '[s]tub-registry.mjs' 2>/dev/null || true
  rm -rf "${WORK_DIR}"
}
trap cleanup EXIT

agent_api_get() {
  curl -sk --max-time 30 --cert "${AGENT_CERT_DIR}/client.crt" --key "${AGENT_CERT_DIR}/client.key" --cacert "${STATE_DIR}/pki/ca.crt" -H 'Accept: application/json' "${BASE_URL}/api/$1"
}

hosting_field() {
  api_get "plugins/$1/hosting" | jq -r "$2" 2>/dev/null || echo ""
}

# wait_operation <plugin> <operation id> <seconds> — prints the final operation
# (still running after <seconds>: printed as is; the caller asserts its status)
wait_operation() {
  local plugin="$1" id="$2" deadline=$((SECONDS + $3)) op
  while [ "$SECONDS" -lt "$deadline" ]; do
    op=$(api_get "plugins/${plugin}/operations/${id}" | jq -c '.operation' 2>/dev/null || echo '{}')
    if [ "$(echo "$op" | jq -r '.status' 2>/dev/null)" != "running" ]; then
      echo "$op"
      return 0
    fi
    sleep 2
  done
  echo "$op"
  return 0
}

# step_status <operation json> <step name> — the status of one step
step_status() {
  echo "$1" | jq -r --arg n "$2" '[.steps[] | select(.name == $n) | .status] | last // "absent"' 2>/dev/null || echo "absent"
}

# audit_count <plugin> <action> — this run's entries of one action for one
# plugin (the audit log outlives a run: entries after AUDIT_BASE only)
audit_count() {
  api_get "audit?plugin=$1&action=$2&limit=200" | jq "[.entries[] | select(.id > ${AUDIT_BASE})] | length" 2>/dev/null || echo "0"
}

# wait_health <plugin> <state> <seconds>
wait_health() {
  local deadline=$((SECONDS + $3))
  while [ "$SECONDS" -lt "$deadline" ]; do
    if [ "$(hosting_field "$1" '.hosting.health.state')" = "$2" ]; then return 0; fi
    sleep 3
  done
  return 1
}

# deliver_config <plugin> <config file> — what the agent's sync does: fetch the
# plugin config with the hosting agent's certificate, once the hosting is reserved
deliver_config() {
  local plugin="$1" file="$2" deadline=$((SECONDS + 60)) config
  while [ "$SECONDS" -lt "$deadline" ]; do
    config=$(agent_api_get "agents/me/plugin-config/${plugin}" 2>/dev/null || echo '{}')
    if [ "$(echo "$config" | jq -r '.port // empty' 2>/dev/null)" != "" ]; then
      echo "$config" | jq '. + {fetchedAt: (now | todate), acknowledged: true}' > "${file}.tmp"
      chmod 600 "${file}.tmp"
      mv "${file}.tmp" "${file}"
      echo "$config" | jq -r '.port'
      return 0
    fi
    sleep 1
  done
  return 1
}

# start_half <plugin> <config file> <log file> <port>
start_half() {
  pkill -f "[a]pp-plugin-half.mjs --config $2" 2>/dev/null || true
  nohup node "${WORK_DIR}/app-plugin-half.mjs" --config "$2" --plugin "$1" --lamaste "${LAMASTE_LIB}" --log "$3" --flags "${WORK_DIR}/flags" &> "$3.out" &
  local deadline=$((SECONDS + 20))
  while [ "$SECONDS" -lt "$deadline" ]; do
    if [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "http://127.0.0.1:$4/admin/health" 2>/dev/null)" = "401" ]; then
      return 0
    fi
    sleep 1
  done
  return 1
}

# host_with_half <plugin> — host it, play the agent (config, agent half), and
# print the finished operation
host_with_half() {
  local plugin="$1" started id port
  started=$(api_post "plugins/${plugin}/hosting" "{\"agentLabel\":\"${AGENT_LABEL}\"}")
  id=$(echo "$started" | jq -r '.operation.id // empty' 2>/dev/null || echo "")
  if [ -z "$id" ]; then
    echo "$started"
    return 0
  fi
  if port=$(deliver_config "$plugin" "${WORK_DIR}/${plugin}.json"); then
    start_half "$plugin" "${WORK_DIR}/${plugin}.json" "${WORK_DIR}/${plugin}.log" "$port" || true
  fi
  wait_operation "$plugin" "$id" 240
}

# ===========================================================================
# 1. Stand-in registry with the fixtures; install; agent
# ===========================================================================

# The audit log and notifications outlive a run: this run's entries come after these.
AUDIT_BASE=$(api_get "audit?limit=1" | jq '.entries[0].id // 0' 2>/dev/null || echo "0")
NOTIFICATION_BASE=$(api_get "notifications?limit=1" | jq '.notifications[0].id // 0' 2>/dev/null || echo "0")

log_section "Install the hooks fixture"

rm -rf "${WORK_DIR}"
mkdir -p "${WORK_DIR}/flags" "${AGENT_CERT_DIR}"
chmod 700 "${AGENT_CERT_DIR}"
write_stub_registry "${WORK_DIR}/stub-registry.mjs"
write_hooks_fixture_plugin "${WORK_DIR}/v100" "${PLUGIN}" 1.0.0 main "${AGENT_HOOKS}"
write_hooks_fixture_plugin "${WORK_DIR}/v110" "${PLUGIN}" 1.1.0 main "${AGENT_HOOKS}"
write_hooks_fixture_plugin "${WORK_DIR}/v120" "${PLUGIN}" 1.2.0 main "${AGENT_HOOKS}" 2
write_hooks_fixture_plugin "${WORK_DIR}/v130" "${PLUGIN}" 1.3.0 main "${AGENT_HOOKS}" 3
write_hooks_fixture_plugin "${WORK_DIR}/failpre" "${FAILPRE}" 1.0.0 failpre '{}'
write_hooks_fixture_plugin "${WORK_DIR}/failpost" "${FAILPOST}" 1.0.0 failpost '{}'
write_app_plugin_half "${WORK_DIR}/app-plugin-half.mjs"
pkill -f '[s]tub-registry.mjs' 2>/dev/null || true
nohup node "${WORK_DIR}/stub-registry.mjs" --port "${STUB_PORT}" --admin-token "${STUB_ADMIN_TOKEN}" --issuer "https://auth.${DOMAIN}" --audience "${STUB_URL}" --jwks-url http://127.0.0.1:9091/jwks.json \
  --package "${WORK_DIR}/v100" --package "${WORK_DIR}/v110" --package "${WORK_DIR}/v120" --package "${WORK_DIR}/v130" \
  --package "${WORK_DIR}/failpre" --package "${WORK_DIR}/failpost" &> "${WORK_DIR}/stub.log" &
if wait_for_http "${STUB_URL}/-/ping" 30; then
  log_pass "Stand-in registry is up"
else
  log_fail "Stand-in registry did not start: $(cat "${WORK_DIR}/stub.log" 2>/dev/null)"
  end_test
  exit $?
fi
printf '@lamalibre:registry=%s/\n//127.0.0.1:%s/:_authToken=%s\n' "${STUB_URL}" "${STUB_PORT}" "${STUB_ADMIN_TOKEN}" > "${WORK_DIR}/npmrc"
install -o lamaste -g lamaste -m 0600 "${WORK_DIR}/npmrc" "${STATE_DIR}/.npmrc"

INSTALL=$(api_post "plugins/install" "{\"packageName\":\"${PACKAGE}@1.0.0\"}")
assert_json_field "$INSTALL" '.ok' 'true' "Fixture 1.0.0 installed (a pinned version)" || true
assert_json_field "$INSTALL" '.plugin.packageName' "${PACKAGE}" "The registry row names the bare package" || true
assert_json_field "$INSTALL" '.hooks.approval.state' 'pending' "Its relay hooks wait for approval" || true
DIGEST=$(echo "$INSTALL" | jq -r '.hooks.relay.digest' 2>/dev/null || echo "")
ENTRY_SHA=$(echo "$INSTALL" | jq -r '.hooks.relay.entrySha256' 2>/dev/null || echo "")
assert_eq "$(echo "$INSTALL" | jq -r '.hooks.relay.request | length')" "3" "The preview lists the three request hooks" || true
assert_eq "$(echo "$INSTALL" | jq -r '.hooks.relay.effects | join(",")')" "audit,notify-admins" "The preview lists the effects" || true
assert_eq "$(echo "$INSTALL" | jq -r '.hooks.relay.packs | join(",")')" "credentials@1" "The preview names the scanner's rule pack" || true
api_post "plugins/${PLUGIN}/enable" > /dev/null

CERT_RESPONSE=$(api_post "certs/agent" "{\"label\":\"${AGENT_LABEL}\",\"capabilities\":[\"tunnels:read\"]}")
assert_json_field "$CERT_RESPONSE" '.ok' 'true' "Agent certificate issued for ${AGENT_LABEL}" || true
P12_PASS=$(echo "$CERT_RESPONSE" | jq -r '.p12Password' 2>/dev/null || echo "")
openssl pkcs12 -in "${STATE_DIR}/pki/agents/${AGENT_LABEL}/client.p12" -out "${AGENT_CERT_DIR}/client.crt" -clcerts -nokeys -passin pass:"${P12_PASS}" 2>/dev/null
openssl pkcs12 -in "${STATE_DIR}/pki/agents/${AGENT_LABEL}/client.p12" -out "${AGENT_CERT_DIR}/client.key" -nocerts -nodes -passin pass:"${P12_PASS}" 2>/dev/null
chmod 600 "${AGENT_CERT_DIR}/client.key"
unset P12_PASS

# ===========================================================================
# 2. Approval
# ===========================================================================

log_section "Approval of the relay hooks"

UNAPPROVED=$(api_post "plugins/${PLUGIN}/hosting" "{\"agentLabel\":\"${AGENT_LABEL}\"}")
assert_json_field "$UNAPPROVED" '.code' 'hooks_not_approved' "Hosting is refused until the relay hooks are approved" || true

WRONG=$(api_post_status "plugins/${PLUGIN}/hooks/approve" "{\"digest\":\"$(printf 'f%.0s' $(seq 1 64))\"}")
assert_eq "$WRONG" "409" "Approving another digest than the one shown is refused" || true
assert_eq "$(systemctl is-enabled "lamalibre-lamaste-hooks@${PLUGIN}.socket" 2>/dev/null || true)" "disabled" "No runner before the approval" || true

APPROVE=$(api_post "plugins/${PLUGIN}/hooks/approve" "{\"digest\":\"${DIGEST}\"}")
assert_json_field "$APPROVE" '.hooks.approval.state' 'approved' "The hook set is approved" || true
assert_json_field "$APPROVE" '.hooks.runner.current' 'true' "The runner holds the approved module" || true
assert_eq "$(systemctl is-active "lamalibre-lamaste-hooks@${PLUGIN}.socket" 2>/dev/null || true)" "active" "The runner's socket is active" || true
MODULE="${HOOKS_DIR}/${PLUGIN}/${ENTRY_SHA}.mjs"
assert_eq "$(stat -c '%U:%G %a' "${MODULE}" 2>/dev/null || echo missing)" "root:root 644" "The approved module is root-owned, read-only" || true
assert_eq "$(sha256sum "${MODULE}" 2>/dev/null | cut -d' ' -f1)" "${ENTRY_SHA}" "…and is the module that was approved" || true
assert_eq "$(stat -c '%U:%G %a' "/run/lamalibre-lamaste-hooks/${PLUGIN}.sock" 2>/dev/null || echo missing)" "root:lamaste 660" "Only the panel's group can reach the runner" || true
APPROVED_AUDIT=$(api_get "audit?plugin=${PLUGIN}&action=hooks.approved" | jq -c '.entries[0]' 2>/dev/null || echo '{}')
assert_json_field "$APPROVED_AUDIT" '.details.digest' "${DIGEST}" "The approval is in the audit log with its digest" || true
assert_json_field "$APPROVED_AUDIT" '.actor' 'admin' "…and the approver" || true

# ===========================================================================
# 3. Hosting: the install pipeline; the sandbox
# ===========================================================================

log_section "Host: the install pipeline"

OP=$(host_with_half "${PLUGIN}")
assert_json_field "$OP" '.status' 'succeeded' "The hosting operation succeeded" || true
assert_eq "$(step_status "$OP" 'relay install:pre-tunnel')" "done" "relay install:pre-tunnel ran" || true
assert_eq "$(step_status "$OP" 'reserve port, secret and capability')" "done" "Lamaste reserved the hosting" || true
assert_eq "$(step_status "$OP" 'agent install:pre-tunnel')" "skipped" "The agent's pre-tunnel stage is not declared here" || true
assert_eq "$(step_status "$OP" 'grant the tunnel and wait for the agent half')" "done" "The tunnel was granted and the agent half answered" || true
assert_eq "$(step_status "$OP" 'agent install:post-tunnel')" "done" "The agent half's install:post-tunnel ran through the tunnel" || true
assert_eq "$(step_status "$OP" 'relay install:post-tunnel')" "done" "relay install:post-tunnel ran" || true
assert_eq "$(hosting_field "${PLUGIN}" '.hosting.phase')" "active" "The hosting is active" || true
PORT=$(hosting_field "${PLUGIN}" '.hosting.port')
GRANT=$(grep -cF "R:127\\\\.0\\\\.0\\\\.1:${PORT}\$" "${STATE_DIR}/chisel-users" 2>/dev/null || true)
assert_eq "$GRANT" "1" "The chisel authfile grants port ${PORT}" || true
HALF_LOG="${WORK_DIR}/${PLUGIN}.log"
assert_contains "$(cat "${HALF_LOG}" 2>/dev/null)" "hook install:post-tunnel phase=install" "The agent half saw install:post-tunnel (phase install)" || true
assert_eq "$(audit_count "${PLUGIN}" 'hook.install.post-tunnel')" "1" "relay install:post-tunnel reported through the audit effect" || true
assert_eq "$(audit_count "${PLUGIN}" 'plugin.hosted')" "1" "The hosting is in the audit log" || true

log_section "From inside the hook runner"

PROBE=$(api_get "audit?plugin=${PLUGIN}&action=hook.sandbox.probe" | jq -c '.entries[0].details' 2>/dev/null || echo '{}')
assert_json_field "$PROBE" '.readLamaste' 'ERR_ACCESS_DENIED' "A hook cannot read /etc/lamalibre" || true
assert_json_field "$PROBE" '.readPasswd' 'ERR_ACCESS_DENIED' "A hook cannot read /etc/passwd" || true
assert_json_field "$PROBE" '.write' 'ERR_ACCESS_DENIED' "A hook cannot write a file" || true
assert_json_field "$PROBE" '.spawn' 'ERR_ACCESS_DENIED' "A hook cannot spawn a process" || true
assert_json_field "$PROBE" '.worker' 'ERR_ACCESS_DENIED' "A hook cannot start a worker" || true
TCP_OUT=$(echo "$PROBE" | jq -r '.tcpOut' 2>/dev/null || echo "")
assert_not_eq "$TCP_OUT" "CONNECTED" "A hook cannot open a TCP connection out (${TCP_OUT})" || true
TCP_PANEL=$(echo "$PROBE" | jq -r '.tcpPanel' 2>/dev/null || echo "")
assert_not_eq "$TCP_PANEL" "CONNECTED" "A hook cannot reach the panel on the relay loopback (${TCP_PANEL})" || true
assert_not_eq "$(echo "$PROBE" | jq -r '.journal')" "CONNECTED" "A hook cannot reach the journal socket" || true
assert_not_eq "$(echo "$PROBE" | jq -r '.dbus')" "CONNECTED" "A hook cannot reach D-Bus" || true
HOOK_UID=$(echo "$PROBE" | jq -r '.uid' 2>/dev/null || echo "0")
LAMASTE_UID=$(id -u lamaste)
if [ "${HOOK_UID}" -ne 0 ] 2>/dev/null && [ "${HOOK_UID}" -ne "${LAMASTE_UID}" ] 2>/dev/null; then
  log_pass "The runner runs as a dynamic user (uid ${HOOK_UID}), not root or lamaste"
else
  log_fail "The runner's uid is ${HOOK_UID}"
fi
assert_json_field "$PROBE" '.envKeys' '0' "A hook sees an empty environment" || true

# ===========================================================================
# 4. The request pipeline
# ===========================================================================

log_section "Request hooks"

: > "${HALF_LOG}.mark"
BEFORE=$(wc -l < "${HALF_LOG}")
REJECT=$(_curl_mtls -X POST -H 'Content-Type: application/json' -d '{"valid":false}' -w '\n%{http_code}' "${BASE_URL}/api/${PLUGIN}/import/batch")
assert_eq "$(echo "$REJECT" | tail -1)" "422" "pre-forward rejects an invalid import (422)" || true
assert_json_field "$(echo "$REJECT" | head -1)" '.error' 'invalid import' "…with the hook's answer" || true
IMPORTS=$(tail -n +"$((BEFORE + 1))" "${HALF_LOG}" | grep -c "/admin/import" || true)
assert_eq "$IMPORTS" "0" "The rejected request never reached the agent half" || true
assert_eq "$(audit_count "${PLUGIN}" 'hook.import.rejected')" "1" "The rejection is audited (effect)" || true

ACCEPT=$(_curl_mtls -X POST -H 'Content-Type: application/json' -d '{"valid":true,"rows":[1,2]}' "${BASE_URL}/api/${PLUGIN}/import/batch")
assert_json_field "$ACCEPT" '.imported' 'true' "A valid import passes" || true
assert_json_field "$ACCEPT" '.validated' 'yes' "…with the header the hook added" || true

HOOKS_THROUGH=$(api_post_status "${PLUGIN}/hooks/install:pre-tunnel" '{}')
assert_eq "$HOOKS_THROUGH" "404" "/admin/hooks is never forwarded" || true

EXPORT=$(api_get "${PLUGIN}/export/all")
assert_not_contains "$EXPORT" "E2eToken0" "post-forward redacts the planted token" || true
assert_json_field "$EXPORT" '.token' '[REDACTED:github-token]' "…replaced by its rule id" || true
assert_json_field "$EXPORT" '.total' '12345678901234567890' "…and changes nothing else" || true
assert_contains "$(cat "${HALF_LOG}")" "encoding=identity" "A scanned route asks the agent half for an uncompressed body" || true
REDACTED_AUDIT=$(api_get "audit?plugin=${PLUGIN}&action=hook.secret-scan.redacted" | jq -c '.entries[0].details' 2>/dev/null || echo '{}')
assert_json_field "$REDACTED_AUDIT" '.rules' 'github-token' "The redaction is audited by rule" || true
assert_not_contains "$REDACTED_AUDIT" "E2eToken0" "…never with the value" || true

REPORT=$(_curl_mtls -w '\n%{http_code}' "${BASE_URL}/api/${PLUGIN}/report")
assert_eq "$(echo "$REPORT" | tail -1)" "502" "post-forward blocks a response (502)" || true
assert_json_field "$(echo "$REPORT" | head -1)" '.reasonId' 'e2e.blocked' "…with the hook's reason" || true
assert_not_contains "$REPORT" "BLOCKME" "The blocked body does not leave the relay" || true

START=$(date +%s)
STUCK=$(api_get_status "${PLUGIN}/stuck")
ELAPSED=$(( $(date +%s) - START ))
assert_eq "$STUCK" "503" "A hook that never decides fails closed (503)" || true
if [ "$ELAPSED" -le 5 ]; then log_pass "…after its timeout (${ELAPSED}s)"; else log_fail "The stuck hook took ${ELAPSED}s"; fi
# The stuck runner is replaced in the background; calls meanwhile fail closed.
RECOVERED=""
for _ in $(seq 1 15); do
  AFTER_STUCK=$(_curl_mtls -X POST -H 'Content-Type: application/json' -d '{"valid":true}' "${BASE_URL}/api/${PLUGIN}/import/again")
  if [ "$(echo "$AFTER_STUCK" | jq -r '.imported' 2>/dev/null)" = "true" ]; then
    RECOVERED=1
    break
  fi
  sleep 1
done
if [ -n "$RECOVERED" ]; then
  log_pass "The runner was replaced: hooks answer again"
else
  log_fail "Hooks did not recover after the stuck call: ${AFTER_STUCK}"
fi

# ===========================================================================
# 5. Tunnel state on the relay
# ===========================================================================

log_section "tunnel:down and tunnel:up"

if wait_health "${PLUGIN}" up 60; then log_pass "Health is up"; else log_fail "Health: $(hosting_field "${PLUGIN}" '.hosting.health')"; fi
pkill -f "[a]pp-plugin-half.mjs --config ${WORK_DIR}/${PLUGIN}.json" 2>/dev/null || true
if wait_health "${PLUGIN}" down 60; then log_pass "Health is down once the agent half stops"; else log_fail "Health did not go down"; fi
sleep 3
FALLBACK=$(_curl_mtls -D "${WORK_DIR}/fallback.headers" -w '\n%{http_code}' "${BASE_URL}/api/${PLUGIN}/ping")
assert_eq "$(echo "$FALLBACK" | tail -1)" "503" "While down, tunnel:down's fallback answers instead of a 502" || true
assert_json_field "$(echo "$FALLBACK" | head -1)" '.error' 'maintenance' "…with the plugin's own body" || true
assert_contains "$(tr 'A-Z' 'a-z' < "${WORK_DIR}/fallback.headers")" "retry-after: 30" "…and its Retry-After" || true
NOTIFIED=$(api_get "notifications?unread=true" | jq "[.notifications[] | select(.id > ${NOTIFICATION_BASE} and .source == \"plugin:${PLUGIN}\")] | length" 2>/dev/null || echo "0")
if [ "${NOTIFIED}" -ge 1 ] 2>/dev/null; then log_pass "Admins were notified (notify-admins effect)"; else log_fail "No notification from the plugin"; fi
assert_eq "$(audit_count "${PLUGIN}" 'hook.tunnel.down')" "1" "tunnel:down ran once" || true

start_half "${PLUGIN}" "${WORK_DIR}/${PLUGIN}.json" "${HALF_LOG}" "${PORT}" || true
if wait_health "${PLUGIN}" up 60; then log_pass "Health is up again"; else log_fail "Health did not recover"; fi
sleep 3
assert_eq "$(audit_count "${PLUGIN}" 'hook.tunnel.up')" "1" "tunnel:up ran" || true
assert_json_field "$(api_get "${PLUGIN}/ping")" '.pong' 'true' "Requests reach the agent half again (no fallback)" || true

# ===========================================================================
# 6. Updating in place
# ===========================================================================

log_section "Update in place"

UPDATE_SAME=$(api_post "plugins/${PLUGIN}/update" '{"version":"1.1.0"}')
SAME_ID=$(echo "$UPDATE_SAME" | jq -r '.operation.id // empty' 2>/dev/null || echo "")
if [ -n "$SAME_ID" ]; then
  log_pass "1.1.0 brings the same hook set: it updates without asking"
  SAME_OP=$(wait_operation "${PLUGIN}" "${SAME_ID}" 180)
  assert_json_field "$SAME_OP" '.status' 'succeeded' "The update succeeded" || true
  assert_eq "$(step_status "$SAME_OP" 'agent install:post-tunnel')" "done" "The agent half's post stage ran through the tunnel" || true
else
  log_fail "Update to 1.1.0 did not start: ${UPDATE_SAME}"
fi
assert_eq "$(api_get "plugins/${PLUGIN}" | jq -r '.plugin.version')" "1.1.0" "The plugin is at 1.1.0" || true
assert_contains "$(cat "${HALF_LOG}")" "hook install:post-tunnel phase=upgrade" "The agent half saw phase upgrade" || true

UPDATE_NEW=$(api_post "plugins/${PLUGIN}/update" '{"version":"1.2.0"}')
NEW_DIGEST=$(echo "$UPDATE_NEW" | jq -r '.pendingUpdate.digest // empty' 2>/dev/null || echo "")
assert_json_field "$UPDATE_NEW" '.pendingUpdate.version' '1.2.0' "1.2.0 changes the relay hooks: it waits for approval" || true
assert_not_eq "$NEW_DIGEST" "$DIGEST" "…with another digest" || true
assert_eq "$(api_get "plugins/${PLUGIN}" | jq -r '.plugin.version')" "1.1.0" "The installed version stays live meanwhile" || true
assert_json_field "$(api_delete "plugins/${PLUGIN}/update")" '.ok' 'true' "A pending update can be discarded" || true
assert_json_field "$(api_get "plugins/${PLUGIN}/hooks")" '.hooks.pendingUpdate' 'null' "…and is gone" || true

api_post "plugins/${PLUGIN}/update" '{"version":"1.2.0"}' > /dev/null
APPROVE_NEW=$(api_post "plugins/${PLUGIN}/hooks/approve" "{\"digest\":\"${NEW_DIGEST}\"}")
NEW_ID=$(echo "$APPROVE_NEW" | jq -r '.operation.id // empty' 2>/dev/null || echo "")
NEW_OP=$(wait_operation "${PLUGIN}" "${NEW_ID}" 180)
assert_json_field "$NEW_OP" '.status' 'succeeded' "Approving the new hook set applies the update" || true
assert_eq "$(api_get "plugins/${PLUGIN}" | jq -r '.plugin.version')" "1.2.0" "The plugin is at 1.2.0" || true
assert_json_field "$(api_get "plugins/${PLUGIN}/hooks")" '.hooks.approval.approvedDigest' "${NEW_DIGEST}" "The new digest is the approved one" || true
assert_json_field "$(api_get "plugins/${PLUGIN}/hooks")" '.hooks.runner.current' 'true' "The runner holds the 1.2.0 module" || true
if [ "$(audit_count "${PLUGIN}" 'plugin.updated')" -ge 2 ] 2>/dev/null; then log_pass "Both updates are audited"; else log_fail "Updates not audited"; fi
assert_json_field "$(api_get "plugins/${PLUGIN}/hooks")" '.hooks.autoApprove' 'false' "Auto-approve is off by default" || true
AUTO=$(api_put "plugins/${PLUGIN}/hooks/auto-approve" '{"enabled":true}')
assert_json_field "$AUTO" '.autoApprove' 'true' "Auto-approve can be turned on for one plugin" || true
assert_eq "$(audit_count "${PLUGIN}" 'hooks.auto-approve.enabled')" "1" "…and that is audited" || true
UPDATE_AUTO=$(api_post "plugins/${PLUGIN}/update" '{}')
AUTO_ID=$(echo "$UPDATE_AUTO" | jq -r '.operation.id // empty' 2>/dev/null || echo "")
if [ -n "$AUTO_ID" ]; then
  log_pass "1.3.0 changes the relay hooks again: with auto-approve it updates without asking"
  AUTO_OP=$(wait_operation "${PLUGIN}" "${AUTO_ID}" 180)
  assert_json_field "$AUTO_OP" '.status' 'succeeded' "The auto-approved update succeeded" || true
else
  log_fail "Update to 1.3.0 did not start: ${UPDATE_AUTO}"
fi
assert_eq "$(api_get "plugins/${PLUGIN}" | jq -r '.plugin.version')" "1.3.0" "The plugin is at 1.3.0" || true
AUTO_AUDIT=$(api_get "audit?plugin=${PLUGIN}&action=hooks.approved" | jq -c '.entries[0]' 2>/dev/null || echo '{}')
assert_json_field "$AUTO_AUDIT" '.actor' 'auto-approve' "The automatic approval is in the audit log" || true
assert_json_field "$AUTO_AUDIT" '.details.version' '1.3.0' "…for 1.3.0" || true
CURRENT_DIGEST=$(api_get "plugins/${PLUGIN}/hooks" | jq -r '.hooks.relay.digest' 2>/dev/null || echo "")
assert_json_field "$(api_get "plugins/${PLUGIN}/hooks")" '.hooks.runner.current' 'true' "The runner holds the 1.3.0 module" || true

# ===========================================================================
# 7. Failing stages
# ===========================================================================

log_section "A failing relay install:pre-tunnel leaves nothing"

api_post "plugins/install" "{\"packageName\":\"@lamalibre/${FAILPRE}-server\"}" > /dev/null
api_post "plugins/${FAILPRE}/enable" > /dev/null
FAILPRE_DIGEST=$(api_get "plugins/${FAILPRE}/hooks" | jq -r '.hooks.relay.digest' 2>/dev/null || echo "")
api_post "plugins/${FAILPRE}/hooks/approve" "{\"digest\":\"${FAILPRE_DIGEST}\"}" > /dev/null
FP=$(api_post "plugins/${FAILPRE}/hosting" "{\"agentLabel\":\"${AGENT_LABEL}\"}")
FP_OP=$(wait_operation "${FAILPRE}" "$(echo "$FP" | jq -r '.operation.id')" 120)
assert_json_field "$FP_OP" '.status' 'failed' "The operation failed" || true
assert_contains "$(echo "$FP_OP" | jq -r '.error')" "refused before the tunnel" "…with the hook's reason" || true
assert_eq "$(api_get_status "plugins/${FAILPRE}/hosting")" "404" "No hosting record" || true
assert_eq "$(api_get "tunnels?limit=500" | jq "[.tunnels[] | select(.pluginRoute == \"${FAILPRE}\")] | length")" "0" "No tunnel" || true
assert_not_contains "$(api_get "certs/agent" | jq -c ".agents[] | select(.label == \"${AGENT_LABEL}\") | .capabilities")" "plugin:${FAILPRE}:host" "No host capability" || true
assert_eq "$(agent_api_get "tunnels/agent-config" | jq "[.appPlugins[] | select(.route == \"${FAILPRE}\")] | length")" "0" "Nothing for the agent" || true

log_section "A failing relay install:post-tunnel rolls back to nothing"

api_post "plugins/install" "{\"packageName\":\"@lamalibre/${FAILPOST}-server\"}" > /dev/null
api_post "plugins/${FAILPOST}/enable" > /dev/null
FAILPOST_DIGEST=$(api_get "plugins/${FAILPOST}/hooks" | jq -r '.hooks.relay.digest' 2>/dev/null || echo "")
api_post "plugins/${FAILPOST}/hooks/approve" "{\"digest\":\"${FAILPOST_DIGEST}\"}" > /dev/null
RB_OP=$(host_with_half "${FAILPOST}")
assert_json_field "$RB_OP" '.status' 'rolled-back' "The operation rolled back" || true
assert_eq "$(step_status "$RB_OP" 'relay install:post-tunnel')" "failed" "relay install:post-tunnel failed" || true
assert_eq "$(step_status "$RB_OP" 'remove the tunnel')" "done" "The tunnel was removed" || true
assert_eq "$(step_status "$RB_OP" 'revoke the secret and the capability')" "done" "Secret and capability were revoked" || true
ROLLBACK_AUDIT=$(api_get "audit?plugin=${FAILPOST}&action=hook.uninstall.pre-teardown" | jq -r '.entries[0].details.phase' 2>/dev/null || echo "")
assert_eq "$ROLLBACK_AUDIT" "rollback" "The relay's uninstall stages ran with phase rollback" || true
assert_eq "$(api_get_status "plugins/${FAILPOST}/hosting")" "404" "No hosting record" || true
assert_eq "$(api_get "tunnels?limit=500" | jq "[.tunnels[] | select(.pluginRoute == \"${FAILPOST}\")] | length")" "0" "No tunnel" || true
assert_not_contains "$(api_get "certs/agent" | jq -c ".agents[] | select(.label == \"${AGENT_LABEL}\") | .capabilities")" "plugin:${FAILPOST}:host" "No host capability" || true
pkill -f "[a]pp-plugin-half.mjs --config ${WORK_DIR}/${FAILPOST}.json" 2>/dev/null || true

# ===========================================================================
# 8. Unhost and uninstall; the CLI
# ===========================================================================

log_section "Unhost, uninstall, CLI"

CLI_HOOKS=$(lamaste-server plugins hooks "${PLUGIN}" 2>&1 || true)
assert_contains "$CLI_HOOKS" "${CURRENT_DIGEST}" "lamaste-server plugins hooks shows the digest" || true
CLI_AUDIT=$(lamaste-server audit --plugin "${PLUGIN}" 2>&1 || true)
assert_contains "$CLI_AUDIT" "hooks.approved" "lamaste-server audit lists the approvals" || true

UNHOST=$(api_delete "plugins/${PLUGIN}/hosting")
UNHOST_OP=$(wait_operation "${PLUGIN}" "$(echo "$UNHOST" | jq -r '.operation.id')" 240)
assert_json_field "$UNHOST_OP" '.status' 'succeeded' "Unhosting ran the uninstall pipeline" || true
assert_eq "$(step_status "$UNHOST_OP" 'relay uninstall:pre-teardown')" "done" "relay uninstall:pre-teardown ran" || true
assert_eq "$(step_status "$UNHOST_OP" 'agent uninstall:pre-teardown')" "done" "The agent half's uninstall:pre-teardown ran through the tunnel" || true
assert_eq "$(step_status "$UNHOST_OP" 'relay uninstall:post-teardown')" "done" "relay uninstall:post-teardown ran" || true
assert_contains "$(cat "${HALF_LOG}")" "hook uninstall:pre-teardown phase=uninstall" "The agent half saw uninstall:pre-teardown" || true
assert_eq "$(api_get_status "plugins/${PLUGIN}/hosting")" "404" "The hosting is gone" || true
assert_eq "$(systemctl is-active "lamalibre-lamaste-hooks@${PLUGIN}.socket" 2>/dev/null || true)" "active" "The runner stays while the plugin is installed" || true

api_post "plugins/${PLUGIN}/disable" > /dev/null
UNINSTALL=$(api_delete "plugins/${PLUGIN}")
assert_json_field "$UNINSTALL" '.ok' 'true' "The plugin is uninstalled" || true
assert_not_eq "$(systemctl is-active "lamalibre-lamaste-hooks@${PLUGIN}.socket" 2>/dev/null || true)" "active" "Its runner is gone" || true
if [ -d "${HOOKS_DIR}/${PLUGIN}" ]; then log_fail "Its hook modules are still on disk"; else log_pass "Its hook modules are removed"; fi
assert_eq "$(audit_count "${PLUGIN}" 'plugin.uninstalled')" "1" "The uninstall is audited" || true

end_test

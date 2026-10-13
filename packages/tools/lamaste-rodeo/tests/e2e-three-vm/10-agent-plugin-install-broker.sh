#!/usr/bin/env bash
# ============================================================================
# 10 — Agent Plugin Install through the Registry Broker (Three-VM)
# ============================================================================
# The agent-side half of the registry credential broker, on the real agent
# VM. A stand-in Feria runs on the host VM and serves the fixture plugin
# `@lamalibre/e2e-oidc-server` (written out by helpers.sh, shipped with
# `multipass transfer`); the host's panel authenticates to it as its own
# `lamaste-server` OIDC client (`registry-credential set --oidc`).
#
# 1. The agent VM installs the fixture plugin through its agent panel
#    (lamaste-agentd, installed on demand — setup-agent.sh installs only
#    the CLI — started with `panel --enable --local-only`, the 9393 service
#    without exposing it through the host, and driven as its owner with the
#    Bearer token of agentd.token, as the desktop app does): the agent
#    daemon asks the panel for a brokered token and runs npm with an
#    isolated userconfig.
# 2. The registry saw the packument and the tarball fetched with
#    `Bearer <token>` owned by agent:e2e-agent, brokered by the panel's
#    OIDC identity.
# 3. The agent user's ~/.npmrc is unchanged and no `.npmrc-install-*` file
#    remains in the agent's data directory.
# 4. The panel's audit log (journal) records the brokered tokenId.
#
# Every agent-panel helper tolerates a dropped connection (the daemon
# restarts itself on plugin enable/disable) and the cleanup trap repeats the
# uninstall, stops the stand-in registry, removes the firewall rule, clears
# the registry credential and stops the panel, so nothing leaks into the
# next spec whatever happens here.
#
# Numbered 10 on purpose: it needs the agent VM's real certificate to be
# enrolled on the host, and test 14 (json-installer) rebuilds the host PKI,
# after which only header-authenticated agent-daemon specs can run.
#
# Two labels: `e2e-agent` is the agent VM's LOCAL registry name (data dir,
# service names, the label its daemon on 9393 answers to), while the host
# knows the agent by the label its enrollment token carried (`agentLabel`
# in the agent's config.json, `test-agent` from setup-host.sh) — that is
# the certificate CN, the token owner and what the panel logs.
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

host_api_get() {
  host_exec "curl -skf --max-time 30 --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key --cacert /etc/lamalibre/lamaste/pki/ca.crt -H 'Accept: application/json' https://127.0.0.1:9292/api/$1"
}

# Agent panel API helpers (port 9393 on the agent VM). Plugin routes admit
# only the daemon's owner: the Bearer token in /root/.lamalibre/lamaste/agentd.token
# (0600), read on the agent VM inside the same command so it never leaves the
# VM — the way the desktop app drives the panel. An agent certificate, even
# the owner's, is refused there.
# AGENT_LABEL is the agent VM's local registry name; HOST_AGENT_LABEL (the
# label enrolled on the host, read from config.json below) is used for
# everything on the panel side.
AGENT_PANEL_PORT=9393
AGENT_LABEL="e2e-agent"
AGENT_CONFIG="/root/.lamalibre/lamaste/agents/${AGENT_LABEL}/config.json"

agent_panel_get() {
  agent_exec "curl -sf --max-time 30 -H \"Authorization: Bearer \$(node -e \"process.stdout.write(JSON.parse(require('fs').readFileSync('/root/.lamalibre/lamaste/agentd.token','utf8')).token)\")\" -H 'Accept: application/json' http://127.0.0.1:${AGENT_PANEL_PORT}/api/$1" 2>/dev/null || echo ""
}

agent_panel_post_status() {
  agent_exec "curl -s --max-time 30 -o /dev/null -w '%{http_code}' -H \"Authorization: Bearer \$(node -e \"process.stdout.write(JSON.parse(require('fs').readFileSync('/root/.lamalibre/lamaste/agentd.token','utf8')).token)\")\" -X POST -H 'Content-Type: application/json' -d '$2' http://127.0.0.1:${AGENT_PANEL_PORT}/api/$1" 2>/dev/null || echo "000"
}

agent_panel_delete_status() {
  agent_exec "curl -s --max-time 30 -o /dev/null -w '%{http_code}' -H \"Authorization: Bearer \$(node -e \"process.stdout.write(JSON.parse(require('fs').readFileSync('/root/.lamalibre/lamaste/agentd.token','utf8')).token)\")\" -X DELETE http://127.0.0.1:${AGENT_PANEL_PORT}/api/$1" 2>/dev/null || echo "000"
}

# agent_config_field <field> — a top-level field of the agent's config.json
# (node: the agent VM has no jq)
agent_config_field() {
  agent_exec "node -p \"require('${AGENT_CONFIG}')['$1'] ?? ''\"" 2>/dev/null || echo ""
}

# wait_panel_healthy — the agent daemon restarts itself after a plugin
# enable or disable (unloadPanelService/loadPanelService), so a call made
# right after one may get an empty reply; poll /api/health for up to 20 s
wait_panel_healthy() {
  local health=""
  for _ in $(seq 1 20); do
    health=$(agent_exec "curl -sf --max-time 5 http://127.0.0.1:${AGENT_PANEL_PORT}/api/health 2>/dev/null" || echo "")
    if echo "$health" | jq -r '.status' 2>/dev/null | grep -q "ok"; then
      return 0
    fi
    sleep 1
  done
  return 1
}

# stub_get path — the stand-in registry on the host VM, as its admin
stub_get() {
  host_exec "curl -s --max-time 15 -H 'Authorization: Bearer ${STUB_ADMIN_TOKEN}' http://127.0.0.1:${STUB_PORT}/$1"
}

HOST_IP="${HOST_IP:-10.13.37.1}"
AGENT_IP="${AGENT_IP:-10.13.37.2}"
STUB_PORT=4874
STUB_URL="http://${HOST_IP}:${STUB_PORT}"
STUB_ADMIN_TOKEN="feria_e2eadmin_threevm_000000000000000"
PLUGIN_PACKAGE="@lamalibre/e2e-oidc-server"
PLUGIN_NAME="e2e-oidc"
REMOTE_DIR="/tmp/e2e-10-broker"
AGENT_DATA_DIR="/root/.lamalibre/lamaste/agents/${AGENT_LABEL}"
LOCAL_TMP=""
HOST_AGENT_LABEL=""

begin_test "10 — Agent Plugin Install through the Registry Broker"

cleanup() {
  timed_exec 60 multipass exec lamaste-agent -- sudo bash -c "curl -s -o /dev/null --max-time 30 -H \"Authorization: Bearer \$(node -e \"process.stdout.write(JSON.parse(require('fs').readFileSync('/root/.lamalibre/lamaste/agentd.token','utf8')).token)\")\" -X POST -H 'Content-Type: application/json' -d '{}' http://127.0.0.1:${AGENT_PANEL_PORT}/api/plugins/${PLUGIN_NAME}/disable; curl -s -o /dev/null --max-time 30 -H \"Authorization: Bearer \$(node -e \"process.stdout.write(JSON.parse(require('fs').readFileSync('/root/.lamalibre/lamaste/agentd.token','utf8')).token)\")\" -X DELETE http://127.0.0.1:${AGENT_PANEL_PORT}/api/plugins/${PLUGIN_NAME}" > /dev/null 2>&1
  timed_exec 90 multipass exec lamaste-host -- sudo bash -c "lamaste-server registry-credential clear > /dev/null 2>&1; pkill -f '[s]tub-registry.mjs' 2>/dev/null; ufw delete allow from ${AGENT_IP} to any port ${STUB_PORT} proto tcp > /dev/null 2>&1; rm -rf ${REMOTE_DIR}; true" > /dev/null 2>&1
  # Stop the panel service started below (local-only: no host call).
  timed_exec 60 multipass exec lamaste-agent -- sudo bash -c "lamaste-agent panel --disable --local-only 2>/dev/null; true" > /dev/null 2>&1
  if [ -n "$LOCAL_TMP" ]; then rm -rf "$LOCAL_TMP"; fi
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
log_section "Pre-flight: check onboarding is complete"
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
log_info "Agent VM local registry name: ${AGENT_LABEL}; label enrolled on the host: ${HOST_AGENT_LABEL}"

AGENT_ENROLLED=$(host_api_get "certs/agent" | jq -r '[.agents[]? | select(.label == "'"${HOST_AGENT_LABEL}"'" and (.revoked // false) == false)] | length' 2>/dev/null || echo "0")
if [ "$AGENT_ENROLLED" = "0" ]; then
  log_skip "Agent ${HOST_AGENT_LABEL} is not enrolled on the host — skipping"
  end_test
  exit $?
fi
log_pass "Agent ${HOST_AGENT_LABEL} is enrolled on the host"

# ===========================================================================
# 1. Stand-in registry on the host VM, serving the fixture plugin
# ===========================================================================

log_section "Stand-in registry on the host VM"

LOCAL_TMP=$(mktemp -d /tmp/e2e-10-broker-XXXXXXXX)
write_stub_registry "${LOCAL_TMP}/stub-registry.mjs"
write_oidc_fixture_plugin "${LOCAL_TMP}/fixture"
host_exec "rm -rf ${REMOTE_DIR} && mkdir -p ${REMOTE_DIR}/fixture && chmod -R a+rwx ${REMOTE_DIR}"
multipass transfer "${LOCAL_TMP}/stub-registry.mjs" "lamaste-host:${REMOTE_DIR}/stub-registry.mjs"
multipass transfer "${LOCAL_TMP}/fixture/package.json" "lamaste-host:${REMOTE_DIR}/fixture/package.json"
multipass transfer "${LOCAL_TMP}/fixture/index.js" "lamaste-host:${REMOTE_DIR}/fixture/index.js"
multipass transfer "${LOCAL_TMP}/fixture/lamaste-plugin.json" "lamaste-host:${REMOTE_DIR}/fixture/lamaste-plugin.json"
SHIPPED=$(host_exec "ls ${REMOTE_DIR}/fixture | wc -l | tr -d ' '")
assert_eq "$SHIPPED" "3" "Fixture plugin shipped to the host VM" || true

host_exec "pkill -f '[s]tub-registry.mjs' 2>/dev/null || true"
# The agent VM reaches the registry on the host's static address; the host
# firewall denies incoming by default.
host_exec "ufw status 2>/dev/null | grep -q '^Status: active' && ufw allow from ${AGENT_IP} to any port ${STUB_PORT} proto tcp > /dev/null || true"
host_exec "nohup node ${REMOTE_DIR}/stub-registry.mjs --port ${STUB_PORT} --host 0.0.0.0 --base-url ${STUB_URL} --admin-token ${STUB_ADMIN_TOKEN} --issuer https://auth.${DOMAIN} --audience ${STUB_URL} --jwks-url http://127.0.0.1:9091/jwks.json --package ${REMOTE_DIR}/fixture &>/dev/null & exit"

STUB_UP="no"
for _ in $(seq 1 30); do
  if host_exec "curl -sf --max-time 3 http://127.0.0.1:${STUB_PORT}/-/ping > /dev/null 2>&1"; then
    STUB_UP="yes"
    break
  fi
  sleep 1
done
assert_eq "$STUB_UP" "yes" "Stand-in registry is up on the host VM" || true

AGENT_REACHES_STUB=$(agent_exec "curl -s -o /dev/null -w '%{http_code}' --max-time 10 ${STUB_URL}/-/ping 2>/dev/null" || echo "000")
assert_eq "$AGENT_REACHES_STUB" "200" "Agent VM reaches the registry at ${STUB_URL}" || true

# ===========================================================================
# 2. The panel authenticates to the registry as its own OIDC client
# ===========================================================================

log_section "registry-credential set --oidc on the host"

SET_OUTPUT=$(timed_exec 120 multipass exec lamaste-host -- sudo bash -c "lamaste-server registry-credential set --url ${STUB_URL} --oidc --json 2>&1")
SET_JSON=$(echo "$SET_OUTPUT" | grep -E '^\{' | tail -1 || echo "{}")
assert_json_field "$SET_JSON" '.configured' 'true' "Credential configured through the OIDC chain ($(echo "$SET_OUTPUT" | tail -c 300))" || true
assert_json_field "$SET_JSON" '.auth' 'oidc' "Auth kind is oidc" || true
assert_json_field "$SET_JSON" '.owner' "ci:auth.${DOMAIN}/lamaste-server" "The registry identified the panel as ci:auth.${DOMAIN}/lamaste-server" || true

# ===========================================================================
# 3. The agent VM installs the fixture plugin through its agent panel
# ===========================================================================

log_section "Agent plugin install through the broker"

PANEL_HEALTH=$(agent_exec "curl -sf --max-time 5 http://127.0.0.1:${AGENT_PANEL_PORT}/api/health 2>/dev/null" || echo "")
if ! echo "$PANEL_HEALTH" | jq -r '.status' 2>/dev/null | grep -q "ok"; then
  # The agent VM is set up with @lamalibre/lamaste-agent only; the panel
  # service is lamaste-agentd, installed here on demand from the registry
  # /root/.npmrc points @lamalibre at.
  AGENTD_PRESENT=$(agent_exec "command -v lamaste-agentd > /dev/null 2>&1 && echo yes || echo no")
  if [ "$AGENTD_PRESENT" != "yes" ]; then
    timed_exec 180 multipass exec lamaste-agent -- sudo bash -c "npm install -g @lamalibre/lamaste-agentd > /tmp/e2e-agentd-install.log 2>&1"
    AGENTD_PRESENT=$(agent_exec "command -v lamaste-agentd > /dev/null 2>&1 && echo yes || echo no")
  fi
  assert_eq "$AGENTD_PRESENT" "yes" "lamaste-agentd is installed on the agent VM" || true
  agent_exec "lamaste-agent panel --enable --local-only --port ${AGENT_PANEL_PORT} 2>/dev/null" || true
  if wait_panel_healthy; then
    PANEL_HEALTH=$(agent_exec "curl -sf --max-time 5 http://127.0.0.1:${AGENT_PANEL_PORT}/api/health 2>/dev/null" || echo "")
  fi
fi
if ! echo "$PANEL_HEALTH" | jq -r '.status' 2>/dev/null | grep -q "ok"; then
  log_fail "Could not start the agent panel on the agent VM"
  end_test
  exit $?
fi
log_pass "Agent panel is running on the agent VM"

NPMRC_BEFORE=$(agent_exec "cat /root/.npmrc 2>/dev/null || true")

INSTALL_STATUS=$(timed_exec 220 multipass exec lamaste-agent -- sudo bash -c "curl -s --max-time 200 -o /dev/null -w '%{http_code}' -H \"Authorization: Bearer \$(node -e \"process.stdout.write(JSON.parse(require('fs').readFileSync('/root/.lamalibre/lamaste/agentd.token','utf8')).token)\")\" -X POST -H 'Content-Type: application/json' -d '{\"packageName\":\"${PLUGIN_PACKAGE}\"}' http://127.0.0.1:${AGENT_PANEL_PORT}/api/plugins/install")
assert_eq "$INSTALL_STATUS" "200" "Agent installed ${PLUGIN_PACKAGE} from the registry" || true
INSTALLED=$(agent_panel_get "plugins" | jq -r '.plugins[] | select(.packageName == "'"${PLUGIN_PACKAGE}"'") | .name' 2>/dev/null || echo "")
assert_eq "$INSTALLED" "${PLUGIN_NAME}" "Agent plugin registry lists the plugin" || true

# ===========================================================================
# 4. The registry saw the agent's brokered token
# ===========================================================================

log_section "Registry saw the brokered token"

OWNED=$(stub_get "-/feria/tokens?owner=agent:${HOST_AGENT_LABEL}")
assert_json_field "$OWNED" '.tokens | length' '1' "The registry holds one token for agent:${HOST_AGENT_LABEL}" || true
assert_json_field "$OWNED" '.tokens[0].kind' 'agent' "Token kind is agent" || true
assert_json_field "$OWNED" '.tokens[0].scopes | join(",")' 'read' "Token scope is read only" || true
assert_json_field "$OWNED" '.tokens[0].createdBy' "ci:auth.${DOMAIN}/lamaste-server" "Brokered by the panel's OIDC identity" || true
TOKEN_ID=$(echo "$OWNED" | jq -r '.tokens[0].id // empty')

PACKAGE_REQUESTS=$(stub_get "-/e2e/requests" | jq '[.requests[] | select(.path | startswith("/@lamalibre/e2e-oidc-server"))]')
assert_json_field "$PACKAGE_REQUESTS" '[.[] | select(.path == "/@lamalibre/e2e-oidc-server")] | length > 0' 'true' "The packument was fetched" || true
assert_json_field "$PACKAGE_REQUESTS" '[.[] | select(.path | endswith(".tgz"))] | length > 0' 'true' "The tarball was fetched" || true
assert_json_field "$PACKAGE_REQUESTS" '[.[] | .owner] | unique | join(",")' "agent:${HOST_AGENT_LABEL}" "Every package request carried a token owned by agent:${HOST_AGENT_LABEL}" || true
assert_json_field "$PACKAGE_REQUESTS" '[.[] | .authorization | startswith("Bearer feria_")] | all' 'true' "Every package request used a Bearer registry token" || true

# ===========================================================================
# 5. Nothing long-lived left on the agent
# ===========================================================================

log_section "Agent left clean"

NPMRC_AFTER=$(agent_exec "cat /root/.npmrc 2>/dev/null || true")
assert_eq "$NPMRC_AFTER" "$NPMRC_BEFORE" "The agent user's ~/.npmrc is unchanged" || true
assert_not_contains "$NPMRC_AFTER" "${STUB_PORT}/:_authToken" "No registry token landed in ~/.npmrc" || true
LEFTOVER=$(agent_exec "ls -a ${AGENT_DATA_DIR} 2>/dev/null | grep -c 'npmrc-install' || true")
assert_eq "$LEFTOVER" "0" "No .npmrc-install-* file remains in the agent's data directory" || true

# ===========================================================================
# 6. The panel's audit log records the brokered token
# ===========================================================================

log_section "Panel audit log"

AUDIT_LINES=$(host_exec "journalctl -u lamalibre-lamaste-serverd --no-pager --since '-30 min' 2>/dev/null | grep 'Brokered registry token for agent' | grep -c '\"label\":\"${HOST_AGENT_LABEL}\"' || true")
assert_not_eq "$AUDIT_LINES" "0" "The panel logged the brokering for ${HOST_AGENT_LABEL}" || true
if [ -n "$TOKEN_ID" ]; then
  AUDIT_TOKEN=$(host_exec "journalctl -u lamalibre-lamaste-serverd --no-pager --since '-30 min' 2>/dev/null | grep -c '\"tokenId\":\"${TOKEN_ID}\"' || true")
  assert_not_eq "$AUDIT_TOKEN" "0" "The audit line carries the registry's tokenId ${TOKEN_ID}" || true
fi

# ===========================================================================
# 7. Uninstall on the agent
# ===========================================================================

log_section "Uninstall on the agent"

# Disabling answers first and then restarts the daemon through the service
# manager, so the status is asserted and the daemon is polled back to
# health before the uninstall. The cleanup trap repeats both so they run
# even if this fails.
DISABLE_STATUS=$(agent_panel_post_status "plugins/${PLUGIN_NAME}/disable" '{}')
assert_eq "$DISABLE_STATUS" "200" "Plugin disable answered before the panel restarted" || true
if wait_panel_healthy; then
  log_pass "Agent panel is back after the plugin disable"
else
  log_fail "Agent panel did not come back after the plugin disable"
fi
UNINSTALL_STATUS=$(agent_panel_delete_status "plugins/${PLUGIN_NAME}")
assert_eq "$UNINSTALL_STATUS" "200" "Agent plugin uninstalled" || true
wait_panel_healthy || true
REMAINING=$(agent_panel_get "plugins" | jq -r '[.plugins[]? | select(.packageName == "'"${PLUGIN_PACKAGE}"'")] | length' 2>/dev/null || echo "?")
assert_eq "$REMAINING" "0" "Agent plugin registry no longer lists the plugin" || true

end_test

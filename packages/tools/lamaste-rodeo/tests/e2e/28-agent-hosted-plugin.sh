#!/usr/bin/env bash
# ============================================================================
# 28 — Agent-hosted plugin (identity only)
# ============================================================================
# Installs a fixture plugin whose manifest says "hosting": "agent" and whose
# main module throws the moment it is imported (served by a stand-in registry
# on the VM), and verifies:
# - the install records hosting "agent"; a variant declaring panel pages is
#   refused (400) and leaves nothing installed
# - enabling writes its OIDC client to Authelia, and the discovery document
#   and JWKS answer
# - after a panel restart the plugin host skips it — never imported, nothing
#   mounted: its route 404s, no panel bundle, the panel stays healthy
# - storage cannot be bound to it; lamaste-server plugins list shows it as
#   agent-hosted
# - disabling removes the client; uninstalling removes the plugin
# Spec 26 keeps covering server-hosted plugins.
# ============================================================================

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/helpers.sh"

require_commands curl jq node npm

begin_test "28 — Agent-hosted plugin (identity only)"

# ---------------------------------------------------------------------------
log_section "Pre-flight: check onboarding is complete"
# ---------------------------------------------------------------------------

ONBOARDING_STATUS=$(api_get "onboarding/status" | jq -r '.status' 2>/dev/null || echo "unknown")
if [ "$ONBOARDING_STATUS" != "COMPLETED" ]; then
  log_skip "Onboarding not completed — skipping agent-hosted plugin tests"
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
WORK_DIR="/tmp/lamalibre-lamaste-e2e-agent-hosted"
STUB_PORT=4874
STUB_URL="http://127.0.0.1:${STUB_PORT}"
STUB_ADMIN_TOKEN="feria_e2eadmin_agenthosted_00000000000000"
PLUGIN_PACKAGE="@lamalibre/e2e-agent-hosted-server"
PLUGIN_NAME="e2e-agent-hosted"
PAGED_PACKAGE="@lamalibre/e2e-agent-hosted-paged-server"
AUTH_RESOLVE="--resolve auth.${DOMAIN}:443:127.0.0.1"
IMPORT_MARKER="agent-hosted plugin code was imported"

cleanup() {
  api_post "plugins/${PLUGIN_NAME}/disable" > /dev/null 2>&1 || true
  api_delete "plugins/${PLUGIN_NAME}" > /dev/null 2>&1 || true
  rm -f "${STATE_DIR}/.npmrc"
  pkill -f '[s]tub-registry.mjs' 2>/dev/null || true
  rm -rf "${WORK_DIR}"
}
trap cleanup EXIT

# ===========================================================================
# 1. Stand-in registry serving the fixture plugins
# ===========================================================================

log_section "Stand-in registry serving the fixture plugins"

rm -rf "${WORK_DIR}"
mkdir -p "${WORK_DIR}"
write_agent_hosted_fixture_plugins "${WORK_DIR}/fixtures"
if start_stub_registry "${WORK_DIR}" "${WORK_DIR}/fixtures/agent-hosted" "${WORK_DIR}/fixtures/agent-hosted-paged"; then
  log_pass "Stand-in registry is up on ${STUB_URL}"
else
  log_fail "Stand-in registry did not start: $(cat "${WORK_DIR}/stub.log" 2>/dev/null)"
  end_test
  exit $?
fi

printf '@lamalibre:registry=%s/\n//127.0.0.1:%s/:_authToken=%s\n' "${STUB_URL}" "${STUB_PORT}" "${STUB_ADMIN_TOKEN}" > "${WORK_DIR}/npmrc"
install -o lamaste -g lamaste -m 0600 "${WORK_DIR}/npmrc" "${STATE_DIR}/.npmrc"
log_pass "Panel npm configured for the stand-in registry"

# ===========================================================================
# 2. Install: hosting recorded, a panel declaration refused
# ===========================================================================

log_section "Install the agent-hosted fixture"

PAGED_STATUS=$(api_post_status "plugins/install" "{\"packageName\":\"${PAGED_PACKAGE}\"}")
assert_eq "$PAGED_STATUS" "400" "An agent-hosted manifest declaring panel pages is refused" || true
PAGED_LISTED=$(api_get "plugins" | jq '[.plugins[] | select(.name == "e2e-agent-hosted-paged")] | length' 2>/dev/null || echo "-1")
assert_eq "$PAGED_LISTED" "0" "The refused plugin is not in the registry" || true
PAGED_ON_DISK=$(test -e "${STATE_DIR}/node_modules/@lamalibre/e2e-agent-hosted-paged-server" && echo "yes" || echo "no")
assert_eq "$PAGED_ON_DISK" "no" "The refused package was uninstalled" || true

INSTALL_RESPONSE=$(api_post "plugins/install" "{\"packageName\":\"${PLUGIN_PACKAGE}\"}")
assert_json_field "$INSTALL_RESPONSE" '.ok' 'true' "Agent-hosted fixture installed" || true
assert_json_field "$INSTALL_RESPONSE" '.plugin.name' "${PLUGIN_NAME}" "Plugin name is ${PLUGIN_NAME}" || true
assert_json_field "$INSTALL_RESPONSE" '.plugin.hosting' 'agent' "Install records hosting agent" || true
assert_json_field "$INSTALL_RESPONSE" '.oidcClients | length' '0' "A public client needs no secret" || true

LISTED_HOSTING=$(api_get "plugins" | jq -r ".plugins[] | select(.name == \"${PLUGIN_NAME}\") | .hosting" 2>/dev/null || echo "")
assert_eq "$LISTED_HOSTING" "agent" "GET /api/plugins reports hosting agent" || true

SECTION_BEFORE_ENABLE=$(grep -c "client_id: ${PLUGIN_NAME}-cli" /etc/authelia/configuration.yml || true)
assert_eq "$SECTION_BEFORE_ENABLE" "0" "A disabled plugin's client is not served" || true

# ===========================================================================
# 3. Enable: Authelia carries the client
# ===========================================================================

log_section "Enable — the OIDC client reaches Authelia"

ENABLE_RESPONSE=$(api_post "plugins/${PLUGIN_NAME}/enable")
assert_json_field "$ENABLE_RESPONSE" '.status' 'enabled' "Plugin enabled" || true

if wait_for_service authelia 60; then
  log_pass "Authelia is active after the OIDC update"
else
  log_fail "Authelia is not active after the OIDC update"
fi
sleep 3

CONFIG_YML=$(cat /etc/authelia/configuration.yml)
assert_contains "$CONFIG_YML" "client_id: ${PLUGIN_NAME}-cli" "Device-code client rendered" || true
assert_contains "$CONFIG_YML" "claims_policy: ${PLUGIN_NAME}-cli" "Client references its claims policy" || true
assert_contains "$CONFIG_YML" "- https://${PLUGIN_NAME}.${DOMAIN}" "Audience {domain} expanded to the relay domain" || true

DISCOVERY=$(curl -sk --max-time 15 ${AUTH_RESOLVE} "https://auth.${DOMAIN}/.well-known/openid-configuration" 2>/dev/null || echo "{}")
assert_json_field "$DISCOVERY" '.issuer' "https://auth.${DOMAIN}" "Discovery document answers with the relay's issuer" || true
assert_json_field "$DISCOVERY" '.device_authorization_endpoint' "https://auth.${DOMAIN}/api/oidc/device-authorization" "Device authorization endpoint advertised" || true
JWKS=$(curl -sk --max-time 15 ${AUTH_RESOLVE} "https://auth.${DOMAIN}/jwks.json" 2>/dev/null || echo "{}")
RS256_KEYS=$(echo "$JWKS" | jq '[.keys[] | select(.alg == "RS256" and .kty == "RSA")] | length' 2>/dev/null || echo "0")
assert_eq "$RS256_KEYS" "1" "JWKS carries one RS256 key" || true

DEVICE_RESPONSE=$(curl -sk --max-time 15 ${AUTH_RESOLVE} -d "client_id=${PLUGIN_NAME}-cli" -d "scope=openid profile groups" -d "audience=https://${PLUGIN_NAME}.${DOMAIN}" \
  "https://auth.${DOMAIN}/api/oidc/device-authorization" 2>/dev/null || echo "{}")
DEVICE_CODE=$(echo "$DEVICE_RESPONSE" | jq -r '.device_code // empty')
assert_not_eq "$DEVICE_CODE" "" "Authelia starts a device-code login for the client ($(echo "$DEVICE_RESPONSE" | jq -c 'del(.device_code)'))" || true

# ===========================================================================
# 4. The plugin host never loads it
# ===========================================================================

log_section "Panel restart — the plugin host skips the agent-hosted plugin"

RESTARTED_AT=$(date '+%Y-%m-%d %H:%M:%S')
sudo systemctl restart lamalibre-lamaste-serverd
PANEL_BACK=false
for _ in $(seq 1 30); do
  if [ "$(api_get "health" 2>/dev/null | jq -r '.status' 2>/dev/null || echo "")" = "ok" ]; then
    PANEL_BACK=true
    break
  fi
  sleep 2
done
if [ "$PANEL_BACK" = "true" ]; then
  log_pass "Panel healthy after the restart with the plugin enabled"
else
  log_fail "Panel not healthy within 60 seconds of restart"
fi

PANEL_JOURNAL=$(journalctl -u lamalibre-lamaste-serverd --since "$RESTARTED_AT" --no-pager -o cat 2>/dev/null || echo "")
assert_contains "$PANEL_JOURNAL" "no routes mounted" "Plugin host logged that it skipped the agent-hosted plugin" || true
assert_not_contains "$PANEL_JOURNAL" "$IMPORT_MARKER" "The plugin's code was never imported" || true

ROUTE_STATUS=$(api_get_status "${PLUGIN_NAME}/ping")
assert_eq "$ROUTE_STATUS" "404" "Nothing is mounted under /api/${PLUGIN_NAME}" || true
BUNDLE_STATUS=$(api_get_status "${PLUGIN_NAME}/panel.js")
assert_eq "$BUNDLE_STATUS" "404" "No panel bundle is served" || true

STILL_SERVED=$(grep -c "client_id: ${PLUGIN_NAME}-cli" /etc/authelia/configuration.yml || true)
assert_eq "$STILL_SERVED" "1" "The client is still served after the restart" || true

STORAGE_STATUS=$(api_post_status "storage/bindings" "{\"pluginName\":\"${PLUGIN_NAME}\",\"storageServerId\":\"00000000-0000-4000-8000-000000000000\"}")
assert_eq "$STORAGE_STATUS" "400" "Storage cannot be bound to an agent-hosted plugin" || true

CLI_LIST=$(lamaste-server plugins list 2>&1 || true)
assert_contains "$CLI_LIST" "agent-hosted" "lamaste-server plugins list shows the hosting" || true

# ===========================================================================
# 5. Disable and uninstall
# ===========================================================================

log_section "Disable and uninstall"

DISABLE_RESPONSE=$(api_post "plugins/${PLUGIN_NAME}/disable")
assert_json_field "$DISABLE_RESPONSE" '.status' 'disabled' "Plugin disabled" || true
if wait_for_service authelia 60; then
  log_pass "Authelia is active after the removal"
else
  log_fail "Authelia is not active after the removal"
fi
CLI_AFTER_DISABLE=$(grep -c "client_id: ${PLUGIN_NAME}-cli" /etc/authelia/configuration.yml || true)
assert_eq "$CLI_AFTER_DISABLE" "0" "Disabling removes the client from Authelia" || true

UNINSTALL_RESPONSE=$(api_delete "plugins/${PLUGIN_NAME}")
assert_json_field "$UNINSTALL_RESPONSE" '.ok' 'true' "Plugin uninstalled" || true
REMAINING=$(api_get "plugins" | jq "[.plugins[] | select(.name == \"${PLUGIN_NAME}\")] | length" 2>/dev/null || echo "-1")
assert_eq "$REMAINING" "0" "The plugin is gone from the registry" || true

# ===========================================================================
# 6. The same lifecycle through lamaste-server plugins
#
# The CLI goes through the panel, so what it installs is what the panel
# serves and its OIDC clients reach Authelia. (Before 4.2 it wrote a
# plugins.json the panel had not read since 2.0.)
# ===========================================================================

log_section "Lifecycle through lamaste-server plugins"

# A server upgraded from before 2.0 may still carry a plugins.json; the CLI
# must leave it as it is, so compare rather than expect it absent.
LEGACY_BEFORE=$(sha256sum "${STATE_DIR}/plugins.json" 2>/dev/null | cut -d' ' -f1 || true)

CLI_INSTALL=$(lamaste-server plugins install "${PLUGIN_PACKAGE}" --json 2>/dev/null | tail -1 || echo '{}')
assert_json_field "$CLI_INSTALL" '.plugin.hosting' 'agent' "CLI install answers with the panel's registry entry" || true
CLI_LISTED=$(api_get "plugins" | jq -r ".plugins[] | select(.name == \"${PLUGIN_NAME}\") | .status" 2>/dev/null || echo "")
assert_eq "$CLI_LISTED" "disabled" "The panel serves the plugin the CLI installed" || true

lamaste-server plugins enable "${PLUGIN_NAME}" --json >/dev/null 2>&1 || true
if wait_for_service authelia 60; then
  log_pass "Authelia is active after the CLI enable"
else
  log_fail "Authelia is not active after the CLI enable"
fi
CLI_CLIENT=$(grep -c "client_id: ${PLUGIN_NAME}-cli" /etc/authelia/configuration.yml || true)
assert_eq "$CLI_CLIENT" "1" "CLI enable writes the plugin's client to Authelia" || true

lamaste-server plugins disable "${PLUGIN_NAME}" --json >/dev/null 2>&1 || true
CLI_CLIENT_GONE=$(grep -c "client_id: ${PLUGIN_NAME}-cli" /etc/authelia/configuration.yml || true)
assert_eq "$CLI_CLIENT_GONE" "0" "CLI disable removes the client" || true

lamaste-server plugins uninstall "${PLUGIN_NAME}" --json >/dev/null 2>&1 || true
CLI_REMAINING=$(api_get "plugins" | jq "[.plugins[] | select(.name == \"${PLUGIN_NAME}\")] | length" 2>/dev/null || echo "-1")
assert_eq "$CLI_REMAINING" "0" "CLI uninstall removes it from the panel's registry" || true
LEGACY_AFTER=$(sha256sum "${STATE_DIR}/plugins.json" 2>/dev/null | cut -d' ' -f1 || true)
assert_eq "$LEGACY_AFTER" "$LEGACY_BEFORE" "The CLI leaves plugins.json untouched" || true

end_test

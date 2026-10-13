#!/usr/bin/env bash
# ============================================================================
# 26 — Authelia OIDC provider from a plugin manifest
# ============================================================================
# Installs a fixture plugin (served by a stand-in registry on the VM) whose
# manifest declares a public device-code client with access-token claims and
# a confidential client-credentials client, and verifies:
# - the install response hands out the confidential client's secret once
# - enabling the plugin writes identity_providers.oidc: the claims policy,
#   the pbkdf2 secret digest, the issuer key as a template expression
# - the issuer key is 0600 lamaste-authelia (never readable by the panel)
# - Authelia's discovery document lists the device-authorization and token
#   endpoints and its JWKS carries an RS256 key
# - a client-credentials token request yields a JWT with the right iss, aud,
#   client_id and sub; a rotated secret replaces the old one
# - GET /plugins/:name/oidc-clients lists metadata, never the secret
# - disabling the plugin removes the section; uninstalling deletes the secret
# ============================================================================

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/helpers.sh"

require_commands curl jq node npm

begin_test "26 — Authelia OIDC provider"

# ---------------------------------------------------------------------------
log_section "Pre-flight: check onboarding is complete"
# ---------------------------------------------------------------------------

ONBOARDING_STATUS=$(api_get "onboarding/status" | jq -r '.status' 2>/dev/null || echo "unknown")
if [ "$ONBOARDING_STATUS" != "COMPLETED" ]; then
  log_skip "Onboarding not completed — skipping OIDC provider tests"
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
WORK_DIR="/tmp/lamalibre-lamaste-e2e-oidc"
STUB_PORT=4874
STUB_URL="http://127.0.0.1:${STUB_PORT}"
STUB_ADMIN_TOKEN="feria_e2eadmin_oidc_000000000000000000"
PLUGIN_PACKAGE="@lamalibre/e2e-oidc-server"
PLUGIN_NAME="e2e-oidc"
AUTH_RESOLVE="--resolve auth.${DOMAIN}:443:127.0.0.1"

cleanup() {
  api_post "plugins/${PLUGIN_NAME}/disable" > /dev/null 2>&1 || true
  api_delete "plugins/${PLUGIN_NAME}" > /dev/null 2>&1 || true
  rm -f "${STATE_DIR}/.npmrc"
  pkill -f '[s]tub-registry.mjs' 2>/dev/null || true
  rm -rf "${WORK_DIR}"
}
trap cleanup EXIT

# ===========================================================================
# 1. Stand-in registry serving the fixture plugin
# ===========================================================================

log_section "Stand-in registry serving the fixture plugin"

rm -rf "${WORK_DIR}"
mkdir -p "${WORK_DIR}"
write_stub_registry "${WORK_DIR}/stub-registry.mjs"
write_oidc_fixture_plugin "${WORK_DIR}/fixture"
pkill -f '[s]tub-registry.mjs' 2>/dev/null || true
nohup node "${WORK_DIR}/stub-registry.mjs" --port "${STUB_PORT}" --admin-token "${STUB_ADMIN_TOKEN}" --issuer "https://auth.${DOMAIN}" --audience "${STUB_URL}" --jwks-url http://127.0.0.1:9091/jwks.json --package "${WORK_DIR}/fixture" &> "${WORK_DIR}/stub.log" &
if wait_for_http "${STUB_URL}/-/ping" 30; then
  log_pass "Stand-in registry is up on ${STUB_URL}"
else
  log_fail "Stand-in registry did not start: $(cat "${WORK_DIR}/stub.log" 2>/dev/null)"
  end_test
  exit $?
fi

# The panel installs server plugins with npm from its state directory; the
# project-level .npmrc there points @lamalibre at the stand-in registry.
printf '@lamalibre:registry=%s/\n//127.0.0.1:%s/:_authToken=%s\n' "${STUB_URL}" "${STUB_PORT}" "${STUB_ADMIN_TOKEN}" > "${WORK_DIR}/npmrc"
install -o lamaste -g lamaste -m 0600 "${WORK_DIR}/npmrc" "${STATE_DIR}/.npmrc"
log_pass "Panel npm configured for the stand-in registry"

# ===========================================================================
# 2. Install: the confidential client's secret is handed out once
# ===========================================================================

log_section "Install the fixture plugin"

INSTALL_RESPONSE=$(api_post "plugins/install" "{\"packageName\":\"${PLUGIN_PACKAGE}\"}")
assert_json_field "$INSTALL_RESPONSE" '.ok' 'true' "Fixture plugin installed" || true
assert_json_field "$INSTALL_RESPONSE" '.plugin.name' "${PLUGIN_NAME}" "Plugin name is ${PLUGIN_NAME}" || true
assert_json_field "$INSTALL_RESPONSE" '.oidcClients | length' '1' "One confidential client secret created by the install" || true
assert_json_field "$INSTALL_RESPONSE" '.oidcClients[0].id' 'e2e-oidc-service' "Secret belongs to e2e-oidc-service" || true
SERVICE_SECRET=$(echo "$INSTALL_RESPONSE" | jq -r '.oidcClients[0].secret // empty')
assert_not_eq "$SERVICE_SECRET" "" "Install response carries the secret" || true
assert_not_contains "$(echo "$INSTALL_RESPONSE" | jq -c '.plugin')" "secret" "The registry row carries no secret" || true

SECRET_STORE_MODE=$(stat -c '%a %U' "${STATE_DIR}/oidc-clients.json" 2>/dev/null || echo "missing")
assert_eq "$SECRET_STORE_MODE" "600 lamaste" "oidc-clients.json is 0600 lamaste" || true
STORED_PLUGIN=$(jq -r '.clients["e2e-oidc-service"].plugin // empty' "${STATE_DIR}/oidc-clients.json" 2>/dev/null || echo "")
assert_eq "$STORED_PLUGIN" "${PLUGIN_NAME}" "Secret store attributes the client to the plugin" || true

SECTION_BEFORE_ENABLE=$(grep -c 'client_id: e2e-oidc-cli' /etc/authelia/configuration.yml || true)
assert_eq "$SECTION_BEFORE_ENABLE" "0" "A disabled plugin's clients are not served" || true

# ===========================================================================
# 3. Enable: Authelia carries the clients
# ===========================================================================

log_section "Enable the plugin — Authelia configuration"

ENABLE_RESPONSE=$(api_post "plugins/${PLUGIN_NAME}/enable")
assert_json_field "$ENABLE_RESPONSE" '.status' 'enabled' "Plugin enabled" || true
assert_json_field "$ENABLE_RESPONSE" '.oidcClients | length' '0' "Enable creates no new secret (install already did)" || true

if wait_for_service authelia 60; then
  log_pass "Authelia is active after the restart"
else
  log_fail "Authelia is not active after the OIDC update"
fi
sleep 3

CONFIG_YML=$(cat /etc/authelia/configuration.yml)
assert_contains "$CONFIG_YML" "client_id: e2e-oidc-cli" "Public device-code client rendered" || true
assert_contains "$CONFIG_YML" "client_id: e2e-oidc-service" "Confidential client rendered" || true
assert_contains "$CONFIG_YML" "claims_policy: e2e-oidc-cli" "Public client references its claims policy" || true
assert_contains "$CONFIG_YML" "claims_policies:" "Claims policies section present" || true
assert_contains "$CONFIG_YML" "- preferred_username" "Claims policy copies preferred_username into access tokens" || true
assert_contains "$CONFIG_YML" "token_endpoint_auth_method: client_secret_basic" "Confidential client uses client_secret_basic" || true
assert_contains "$CONFIG_YML" 'client_secret: $pbkdf2-sha512$310000$' "Confidential client secret is a pbkdf2-sha512 digest" || true
assert_not_contains "$CONFIG_YML" "$SERVICE_SECRET" "The plaintext secret is not in Authelia's configuration" || true
assert_contains "$CONFIG_YML" 'key: {{ secret "/etc/authelia/oidc-issuer.pem" | mindent 10 "|" | msquote }}' "Issuer key referenced through the template expression" || true
assert_not_contains "$CONFIG_YML" "BEGIN PRIVATE KEY" "No private key inlined in the configuration" || true
assert_contains "$CONFIG_YML" "audience:" "Audience whitelisted" || true
assert_contains "$CONFIG_YML" "- https://e2e-oidc.${DOMAIN}" "Audience {domain} expanded to the relay domain" || true

KEY_STAT=$(stat -c '%a %U' /etc/authelia/oidc-issuer.pem 2>/dev/null || echo "missing")
assert_eq "$KEY_STAT" "600 lamaste-authelia" "Issuer key is 0600 lamaste-authelia" || true
KEY_READABLE_BY_PANEL=$(sudo -u lamaste cat /etc/authelia/oidc-issuer.pem > /dev/null 2>&1 && echo "yes" || echo "no")
assert_eq "$KEY_READABLE_BY_PANEL" "no" "The panel user cannot read the issuer key" || true

UNIT_FILTER=$(grep -c 'X_AUTHELIA_CONFIG_FILTERS=template' /etc/systemd/system/authelia.service || true)
assert_eq "$UNIT_FILTER" "1" "Authelia unit enables the template configuration filter" || true

# ===========================================================================
# 4. Discovery document and JWKS
# ===========================================================================

log_section "Discovery document and JWKS"

DISCOVERY=$(curl -sk --max-time 15 ${AUTH_RESOLVE} "https://auth.${DOMAIN}/.well-known/openid-configuration" 2>/dev/null || echo "{}")
assert_json_field "$DISCOVERY" '.issuer' "https://auth.${DOMAIN}" "Issuer is https://auth.${DOMAIN}" || true
assert_json_field "$DISCOVERY" '.device_authorization_endpoint' "https://auth.${DOMAIN}/api/oidc/device-authorization" "Device authorization endpoint advertised" || true
assert_json_field "$DISCOVERY" '.token_endpoint' "https://auth.${DOMAIN}/api/oidc/token" "Token endpoint advertised" || true
assert_json_field "$DISCOVERY" '.jwks_uri' "https://auth.${DOMAIN}/jwks.json" "JWKS URI advertised" || true
assert_contains "$(echo "$DISCOVERY" | jq -c '.grant_types_supported')" "client_credentials" "client_credentials grant supported" || true
assert_contains "$(echo "$DISCOVERY" | jq -c '.grant_types_supported')" "urn:ietf:params:oauth:grant-type:device_code" "device_code grant supported" || true

JWKS=$(curl -sk --max-time 15 ${AUTH_RESOLVE} "https://auth.${DOMAIN}/jwks.json" 2>/dev/null || echo "{}")
RS256_KEYS=$(echo "$JWKS" | jq '[.keys[] | select(.alg == "RS256" and .kty == "RSA")] | length' 2>/dev/null || echo "0")
assert_eq "$RS256_KEYS" "1" "JWKS carries one RS256 RSA key" || true
assert_json_field "$JWKS" '.keys[0].kid' 'lamaste-oidc' "Key id is lamaste-oidc" || true
assert_json_field "$JWKS" '.keys[0].use' 'sig' "Key use is sig" || true

# ===========================================================================
# 5. Client credentials: a JWT from Authelia
# ===========================================================================

log_section "Client-credentials token request"

TOKEN_RESPONSE=$(curl -sk --max-time 15 ${AUTH_RESOLVE} -u "e2e-oidc-service:${SERVICE_SECRET}" \
  -d grant_type=client_credentials -d scope=registry_read -d "audience=https://e2e-oidc.${DOMAIN}" \
  "https://auth.${DOMAIN}/api/oidc/token" 2>/dev/null || echo "{}")
ACCESS_TOKEN=$(echo "$TOKEN_RESPONSE" | jq -r '.access_token // empty')
assert_not_eq "$ACCESS_TOKEN" "" "Token endpoint issued an access token ($(echo "$TOKEN_RESPONSE" | jq -c 'del(.access_token)'))" || true
assert_json_field "$TOKEN_RESPONSE" '.token_type | ascii_downcase' 'bearer' "Token type is bearer" || true

if [ -n "$ACCESS_TOKEN" ]; then
  CLAIMS=$(decode_jwt_payload "$ACCESS_TOKEN" 2>/dev/null || echo "{}")
  assert_json_field "$CLAIMS" '.iss' "https://auth.${DOMAIN}" "JWT iss is https://auth.${DOMAIN}" || true
  assert_json_field "$CLAIMS" '.client_id' 'e2e-oidc-service' "JWT client_id is the client" || true
  assert_json_field "$CLAIMS" '.sub' 'e2e-oidc-service' "JWT sub falls back to the client id (no end-user)" || true
  assert_json_field "$CLAIMS" '[.aud] | flatten | index("https://e2e-oidc.'"${DOMAIN}"'") != null' 'true' "JWT aud is the requested audience" || true
  # Authelia's JWT profile access tokens carry the granted scopes in the
  # `scp` array (oauth2-provider strategy_jwt_profile.go); `scope` is only
  # in the token endpoint's response body.
  assert_json_field "$CLAIMS" '[.scp[]?] | index("registry_read") != null' 'true' "JWT scp carries registry_read" || true
fi

WRONG_SECRET_STATUS=$(curl -sk --max-time 15 ${AUTH_RESOLVE} -o /dev/null -w '%{http_code}' -u "e2e-oidc-service:not-the-secret" \
  -d grant_type=client_credentials -d scope=registry_read -d "audience=https://e2e-oidc.${DOMAIN}" \
  "https://auth.${DOMAIN}/api/oidc/token" 2>/dev/null || echo "000")
assert_eq "$WRONG_SECRET_STATUS" "401" "A wrong secret is refused" || true

# ===========================================================================
# 6. Client metadata and secret rotation
# ===========================================================================

log_section "Client metadata and secret rotation"

CLIENTS=$(api_get "plugins/${PLUGIN_NAME}/oidc-clients")
assert_json_field "$CLIENTS" '.clients | length' '2' "Two clients listed" || true
assert_json_field "$CLIENTS" '.clients[] | select(.id == "e2e-oidc-cli") | .confidential' 'false' "e2e-oidc-cli is public" || true
assert_json_field "$CLIENTS" '.clients[] | select(.id == "e2e-oidc-cli") | .accessTokenClaims | join(",")' 'groups,preferred_username' "e2e-oidc-cli asks for groups and preferred_username in access tokens" || true
assert_json_field "$CLIENTS" '.clients[] | select(.id == "e2e-oidc-service") | .confidential' 'true' "e2e-oidc-service is confidential" || true
assert_json_field "$CLIENTS" '.clients[] | select(.id == "e2e-oidc-service") | .secretRotatedAt' 'null' "Not rotated yet" || true
assert_not_contains "$CLIENTS" "$SERVICE_SECRET" "Listing never shows the secret" || true

ROTATE_RESPONSE=$(api_post "plugins/${PLUGIN_NAME}/oidc-clients/e2e-oidc-service/rotate-secret")
assert_json_field "$ROTATE_RESPONSE" '.ok' 'true' "Secret rotated" || true
NEW_SECRET=$(echo "$ROTATE_RESPONSE" | jq -r '.secret // empty')
assert_not_eq "$NEW_SECRET" "" "Rotation returns the new secret" || true
assert_not_eq "$NEW_SECRET" "$SERVICE_SECRET" "The new secret differs from the old one" || true

PUBLIC_ROTATE_STATUS=$(api_post_status "plugins/${PLUGIN_NAME}/oidc-clients/e2e-oidc-cli/rotate-secret")
assert_eq "$PUBLIC_ROTATE_STATUS" "400" "A public client has no secret to rotate" || true
UNKNOWN_ROTATE_STATUS=$(api_post_status "plugins/${PLUGIN_NAME}/oidc-clients/e2e-oidc-nope/rotate-secret")
assert_eq "$UNKNOWN_ROTATE_STATUS" "404" "An undeclared client is 404" || true

if wait_for_service authelia 60; then
  log_pass "Authelia is active after the rotation"
else
  log_fail "Authelia is not active after the rotation"
fi
sleep 3

OLD_SECRET_STATUS=$(curl -sk --max-time 15 ${AUTH_RESOLVE} -o /dev/null -w '%{http_code}' -u "e2e-oidc-service:${SERVICE_SECRET}" \
  -d grant_type=client_credentials -d scope=registry_read -d "audience=https://e2e-oidc.${DOMAIN}" \
  "https://auth.${DOMAIN}/api/oidc/token" 2>/dev/null || echo "000")
assert_eq "$OLD_SECRET_STATUS" "401" "The old secret no longer works" || true
NEW_SECRET_STATUS=$(curl -sk --max-time 15 ${AUTH_RESOLVE} -o /dev/null -w '%{http_code}' -u "e2e-oidc-service:${NEW_SECRET}" \
  -d grant_type=client_credentials -d scope=registry_read -d "audience=https://e2e-oidc.${DOMAIN}" \
  "https://auth.${DOMAIN}/api/oidc/token" 2>/dev/null || echo "000")
assert_eq "$NEW_SECRET_STATUS" "200" "The new secret works" || true

ROTATED_AT=$(api_get "plugins/${PLUGIN_NAME}/oidc-clients" | jq -r '.clients[] | select(.id == "e2e-oidc-service") | .secretRotatedAt // empty')
assert_not_eq "$ROTATED_AT" "" "Listing records the rotation time" || true

# ===========================================================================
# 7. Disable and uninstall
# ===========================================================================

log_section "Disable and uninstall"

DISABLE_RESPONSE=$(api_post "plugins/${PLUGIN_NAME}/disable")
assert_json_field "$DISABLE_RESPONSE" '.status' 'disabled' "Plugin disabled" || true
if wait_for_service authelia 60; then
  log_pass "Authelia is active after the removal"
else
  log_fail "Authelia is not active after the removal"
fi
CLI_AFTER_DISABLE=$(grep -c 'client_id: e2e-oidc-cli' /etc/authelia/configuration.yml || true)
SERVICE_AFTER_DISABLE=$(grep -c 'client_id: e2e-oidc-service' /etc/authelia/configuration.yml || true)
assert_eq "$CLI_AFTER_DISABLE" "0" "Public client removed from Authelia" || true
assert_eq "$SERVICE_AFTER_DISABLE" "0" "Confidential client removed from Authelia" || true
SECRET_AFTER_DISABLE=$(jq -r '.clients | has("e2e-oidc-service")' "${STATE_DIR}/oidc-clients.json" 2>/dev/null || echo "false")
assert_eq "$SECRET_AFTER_DISABLE" "true" "Disabling keeps the secret (the plugin is still installed)" || true

UNINSTALL_RESPONSE=$(api_delete "plugins/${PLUGIN_NAME}")
assert_json_field "$UNINSTALL_RESPONSE" '.ok' 'true' "Plugin uninstalled" || true
SECRET_AFTER_UNINSTALL=$(jq -r '.clients | has("e2e-oidc-service")' "${STATE_DIR}/oidc-clients.json" 2>/dev/null || echo "false")
assert_eq "$SECRET_AFTER_UNINSTALL" "false" "Uninstalling deletes the secret" || true

end_test

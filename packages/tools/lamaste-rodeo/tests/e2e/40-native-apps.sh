#!/usr/bin/env bash
# ============================================================================
# 40 — Native apps: the client API, its rendering and the token broker
# ============================================================================
# native-apps-design.md on one VM. An agent-hosted plugin with identity
# (helpers.sh write_identity_fixture_plugins, e2e-ident 2.0.0) hosted on a
# test agent whose half runs on the relay loopback (write_app_plugin_half,
# as spec 32 runs it), its user surface bound to an authenticated tunnel
# that agent carries: an application host. Then:
#
# - the client API refuses what a native client may not be: an id that is
#   no slug, a redirect path under /api/ or /.well-known/, with a dot
#   segment or a query, access tokens longer than 15 minutes, an idle
#   lifetime longer than the absolute one, a malformed iOS team or Android
#   fingerprint, an unknown field, a host that serves no plugin;
# - one client per host (409 host_has_client); the registered client is
#   served, its audience the host, its redirect URI on it;
# - Authelia's configuration on disk: a public client, PKCE S256 required,
#   authorization_code + refresh_token, the host's audience granted
#   implicitly, RS256 JWT access tokens, its own lifespans (15 minutes,
#   refresh = the idle lifetime), a two-factor policy; discovery offers S256
#   only;
# - Gatekeeper's projection names the client and its host;
# - the vhosts, written through lamaste-priv and accepted by nginx -t: the
#   auth vhost sends the token and revocation endpoints to the broker; the
#   host's vhost serves the association files and the redirect path before
#   any authorization (the redirect path out of the access log) and never
#   passes Authorization to the tunnel's backend; the files on disk;
# - the broker: Basic client authentication naming a native client, a
#   native id that is not registered and an unknown refresh token are
#   refused without reaching Authelia; a grant type a native client never
#   uses is refused; revocation of an unknown token answers 200; a request
#   of no native client is Authelia's to answer;
# - the CLI: native-apps list, update, disable (Authelia drops the client),
#   enable, grants, users native-grants, delete (its files, projection
#   entry and vhost locations gone).
#
# The sign-in, refresh and standing paths are three-VM specs 63 to 65.
# ============================================================================

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/helpers.sh"

require_commands curl jq node npm openssl python3 runuser systemd-run nginx

begin_test "40 — Native apps: the client API, its rendering and the token broker"

# ---------------------------------------------------------------------------
log_section "Pre-flight: check onboarding is complete"
# ---------------------------------------------------------------------------

ONBOARDING_STATUS=$(api_get "onboarding/status" | jq -r '.status' 2>/dev/null || echo "unknown")
if [ "$ONBOARDING_STATUS" != "COMPLETED" ]; then
  log_skip "Onboarding not completed — skipping native apps tests"
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
WORK_DIR="/tmp/lamalibre-lamaste-e2e-native"
STUB_PORT=4874
STUB_URL="http://127.0.0.1:${STUB_PORT}"
STUB_ADMIN_TOKEN="feria_e2eadmin_native_000000000000000000"
STUB_UNIT="lamalibre-lamaste-e2e-40-stub"
HALF_UNIT="lamalibre-lamaste-e2e-40-half"
PLUGIN="e2e-ident"
PACKAGE="@lamalibre/e2e-ident-server"
AGENT_LABEL="e2e-native-$(date +%s)"
AGENT_CERT_DIR="${WORK_DIR}/agent-cert"
HALF_CONFIG="${WORK_DIR}/plugin-config.json"
HALF_LOG="${WORK_DIR}/half.log"
HALF_DB="${WORK_DIR}/half-data/identity.db"
LAMASTE_LIB="/opt/lamalibre/lamaste/serverd/node_modules/@lamalibre/lamaste"
SUB="e2e40native"
FQDN="${SUB}.${DOMAIN}"
TUNNEL_PORT=18540
SLUG="e2e40app"
CLIENT="lamaste-native-${SLUG}"
REDIRECT="/native/callback"
IOS_TEAM="E2ETEAM040"
IOS_BUNDLE="com.example.e2enative"
ANDROID_PACKAGE="com.example.e2enative"
ANDROID_FP="AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99"
NATIVE_DIR="/var/www/lamaste/native/${FQDN}"
AUTH_RESOLVE="--resolve auth.${DOMAIN}:443:127.0.0.1"
MARK="e2e40code$(date +%s)"
TUNNEL_ID=""
PORT=""

cleanup() {
  api_delete "native-apps/${CLIENT}" > /dev/null 2>&1 || true
  if [ -n "${TUNNEL_ID}" ]; then api_delete "tunnels/${TUNNEL_ID}" > /dev/null 2>&1 || true; fi
  systemctl stop "${HALF_UNIT}" "${STUB_UNIT}" > /dev/null 2>&1 || true
  api_post "plugins/${PLUGIN}/disable" > /dev/null 2>&1 || true
  local deadline=$((SECONDS + 180))
  while [ "$SECONDS" -lt "$deadline" ] && [ "$(api_get_status "plugins/${PLUGIN}")" != "404" ]; do
    api_delete "plugins/${PLUGIN}?force=true" > /dev/null 2>&1 || true
    sleep 3
  done
  api_delete "certs/agent/${AGENT_LABEL}" > /dev/null 2>&1 || true
  rm -f "${STATE_DIR}/.npmrc"
  rm -rf "${WORK_DIR}"
}
trap cleanup EXIT

status_of() { printf '%s\n' "$1" | tail -n 1; }
body_of() { printf '%s\n' "$1" | sed '$d'; }
json_get() { echo "$1" | jq -r "$2" 2>/dev/null || echo ""; }

# call <method> <api path> [<json>] — one panel API call as the admin: the
# body, then the HTTP status on a line of its own
call() {
  if [ -n "${3:-}" ]; then
    _curl_mtls -X "$1" -H 'Content-Type: application/json' -d "$3" -w '\n%{http_code}' "${BASE_URL}/api/$2" 2>/dev/null || true
  else
    _curl_mtls -X "$1" -w '\n%{http_code}' "${BASE_URL}/api/$2" 2>/dev/null || true
  fi
}

agent_api_get() {
  curl -sk --max-time 30 --cert "${AGENT_CERT_DIR}/client.crt" --key "${AGENT_CERT_DIR}/client.key" --cacert "${STATE_DIR}/pki/ca.crt" -H 'Accept: application/json' "${BASE_URL}/api/$1"
}
agent_api_post() {
  curl -sk --max-time 30 --cert "${AGENT_CERT_DIR}/client.crt" --key "${AGENT_CERT_DIR}/client.key" --cacert "${STATE_DIR}/pki/ca.crt" -X POST -H 'Content-Type: application/json' -H 'Accept: application/json' -d "$2" "${BASE_URL}/api/$1"
}

# wait_for <seconds> <command...> — until the command succeeds (every 2 s)
wait_for() {
  local deadline=$((SECONDS + $1))
  shift
  while [ "$SECONDS" -lt "$deadline" ]; do
    if "$@"; then return 0; fi
    sleep 2
  done
  return 1
}

# wait_operation <operation id> <seconds> — the operation once it ended
wait_operation() {
  local id="$1" deadline=$((SECONDS + $2)) op='{}'
  if [ -z "$id" ]; then
    echo '{}'
    return 0
  fi
  while [ "$SECONDS" -lt "$deadline" ]; do
    op=$(api_get "plugins/${PLUGIN}/operations/${id}" | jq -c '.operation // {}' 2>/dev/null || echo '{}')
    if [ "$(echo "$op" | jq -r '.status // "running"' 2>/dev/null)" != "running" ]; then
      echo "$op"
      return 0
    fi
    sleep 2
  done
  echo "$op"
}

health_up() { [ "$(api_get "plugins/${PLUGIN}/hosting" | jq -r '.hosting.health.state' 2>/dev/null)" = "up" ]; }
identity_ready() { [ "$(api_get "plugins/${PLUGIN}/identity" | jq -r '.identity.readiness.ready' 2>/dev/null)" = "true" ]; }

# create_status <json> — "<status> <code>" of POST /api/native-apps with that body
create_status() {
  local out
  out=$(call POST "native-apps" "$1")
  echo "$(status_of "$out") $(json_get "$(body_of "$out")" '.code // ""')"
}

# rendered_client — Authelia's configured client as JSON ('{}' when absent)
rendered_client() {
  bash -c "${AUTHELIA_CONFIG_JSON}" 2>/dev/null | jq -c --arg id "${CLIENT}" '[.identity_providers.oidc.clients[]? | select(.client_id == $id)] | first // {}' 2>/dev/null || echo '{}'
}
client_rendered() { [ "$(rendered_client | jq -r '.client_id // ""')" = "${CLIENT}" ]; }
client_not_rendered() { [ "$(rendered_client)" = "{}" ]; }

# broker <curl args...> — a form POST to the auth host on this VM: the body, then the status
broker() {
  # shellcheck disable=SC2086 # AUTH_RESOLVE is two words on purpose
  curl -sk --max-time 20 ${AUTH_RESOLVE} -w '\n%{http_code}' -X POST "$@" 2>/dev/null || echo "000"
}
broker_says() {
  local out
  out=$(broker "$@")
  echo "$(status_of "$out") $(json_get "$(body_of "$out")" '.error // ""')"
}

# cli <arguments> — lamaste-server with --json; its last line
cli() { lamaste-server "$@" --json 2>&1 | tail -n 1; }

# ===========================================================================
# 1. An application host
# ===========================================================================

log_section "An application host: a plugin hosted, its user surface on a tunnel"

cleanup
mkdir -p "${WORK_DIR}" "${AGENT_CERT_DIR}" "$(dirname "${HALF_DB}")"
chmod 700 "${AGENT_CERT_DIR}" "$(dirname "${HALF_DB}")"
write_stub_registry "${WORK_DIR}/stub-registry.mjs"
write_identity_fixture_plugins "${WORK_DIR}/fixtures"
write_app_plugin_half "${WORK_DIR}/app-plugin-half.mjs"
systemctl stop "${STUB_UNIT}" > /dev/null 2>&1 || true
systemd-run --quiet --collect --unit "${STUB_UNIT}" --setenv=PATH="${PATH}" --setenv=HOME=/root \
  "$(command -v node)" "${WORK_DIR}/stub-registry.mjs" --port "${STUB_PORT}" --admin-token "${STUB_ADMIN_TOKEN}" \
  --issuer "https://auth.${DOMAIN}" --audience "${STUB_URL}" --jwks-url http://127.0.0.1:9091/jwks.json \
  --package "${WORK_DIR}/fixtures/v2"
if wait_for_http "${STUB_URL}/-/ping" 60; then
  log_pass "Stand-in registry is up on ${STUB_URL}"
else
  log_fail "Stand-in registry did not start: $(journalctl -u "${STUB_UNIT}" --no-pager -o cat 2>/dev/null | tail -n 5)"
  end_test
  exit $?
fi
printf '@lamalibre:registry=%s/\n//127.0.0.1:%s/:_authToken=%s\n' "${STUB_URL}" "${STUB_PORT}" "${STUB_ADMIN_TOKEN}" > "${WORK_DIR}/npmrc"
install -o lamaste -g lamaste -m 0600 "${WORK_DIR}/npmrc" "${STATE_DIR}/.npmrc"
AUDIT_BASE=$(api_get "audit?limit=1" | jq '.entries[0].id // 0' 2>/dev/null || echo "0")

INSTALL=$(api_post "plugins/install" "{\"packageName\":\"${PACKAGE}@2.0.0\"}")
assert_json_field "$INSTALL" '"\(.plugin.version) \(.hooks.identity.declared)"' '2.0.0 true' "${PACKAGE}@2.0.0 installed: agent-hosted, identity declared" || true
api_post "plugins/${PLUGIN}/hooks/approve" "{\"digest\":\"$(json_get "$INSTALL" '.hooks.approval.digest')\"}" > /dev/null
api_post "plugins/${PLUGIN}/enable" > /dev/null

CERT_RESPONSE=$(api_post "certs/agent" "{\"label\":\"${AGENT_LABEL}\",\"capabilities\":[\"tunnels:read\"]}")
assert_json_field "$CERT_RESPONSE" '.ok' 'true' "Agent certificate issued for ${AGENT_LABEL}" || true
P12_PASS=$(echo "$CERT_RESPONSE" | jq -r '.p12Password' 2>/dev/null || echo "")
openssl pkcs12 -in "${STATE_DIR}/pki/agents/${AGENT_LABEL}/client.p12" -out "${AGENT_CERT_DIR}/client.crt" -clcerts -nokeys -passin pass:"${P12_PASS}" 2>/dev/null
openssl pkcs12 -in "${STATE_DIR}/pki/agents/${AGENT_LABEL}/client.p12" -out "${AGENT_CERT_DIR}/client.key" -nocerts -nodes -passin pass:"${P12_PASS}" 2>/dev/null
chmod 600 "${AGENT_CERT_DIR}/client.key"
unset P12_PASS

HOST_RESPONSE=$(api_post "plugins/${PLUGIN}/hosting" "{\"agentLabel\":\"${AGENT_LABEL}\"}")
HOST_OP_ID=$(json_get "$HOST_RESPONSE" '.operation.id // empty')
PLUGIN_CONFIG="{}"
for _ in $(seq 1 60); do
  PLUGIN_CONFIG=$(agent_api_get "agents/me/plugin-config/${PLUGIN}" 2>/dev/null || echo '{}')
  if [ -n "$(json_get "$PLUGIN_CONFIG" '.port // empty')" ]; then break; fi
  sleep 1
done
PORT=$(json_get "$PLUGIN_CONFIG" '.port // empty')
echo "$PLUGIN_CONFIG" | jq '. + {fetchedAt: (now | todate), acknowledged: false}' > "${HALF_CONFIG}.tmp"
chmod 600 "${HALF_CONFIG}.tmp"
mv "${HALF_CONFIG}.tmp" "${HALF_CONFIG}"
agent_api_post "agents/me/plugin-config/${PLUGIN}/ack" "{\"issuedAt\":\"$(json_get "$PLUGIN_CONFIG" '.issuedAt')\"}" > /dev/null
systemctl stop "${HALF_UNIT}" > /dev/null 2>&1 || true
systemd-run --quiet --collect --unit "${HALF_UNIT}" "$(command -v node)" "${WORK_DIR}/app-plugin-half.mjs" \
  --config "${HALF_CONFIG}" --plugin "${PLUGIN}" --lamaste "${LAMASTE_LIB}" --log "${HALF_LOG}" --identity-db "${HALF_DB}"
HOST_OP=$(wait_operation "${HOST_OP_ID}" 180)
assert_json_field "$HOST_OP" '.status' 'succeeded' "Hosted on ${AGENT_LABEL}, its half on the relay loopback (port ${PORT})" || true
if wait_for 60 health_up && wait_for 90 identity_ready; then
  log_pass "Health up, identity ready"
else
  log_fail "Not up or not ready: $(api_get "plugins/${PLUGIN}/identity" | jq -c '.identity.readiness')"
fi

RESP=$(api_post "tunnels" "{\"subdomain\":\"${SUB}\",\"port\":${TUNNEL_PORT},\"accessMode\":\"authenticated\",\"agentLabel\":\"${AGENT_LABEL}\"}")
TUNNEL_ID=$(json_get "$RESP" '.tunnel.id // empty')
assert_json_field "$RESP" '.tunnel.fqdn' "${FQDN}" "Tunnel ${FQDN}, authenticated, carried by ${AGENT_LABEL}" || true
RESP=$(call PUT "tunnels/${TUNNEL_ID}/user-surface" "{\"route\":\"${PLUGIN}\"}")
assert_eq "$(status_of "$RESP")" "200" "${PLUGIN}'s user surface bound to it" || true

# ===========================================================================
# 2. The client API
# ===========================================================================

log_section "The client API refuses what a native client may not be"

base() { jq -c -n --arg s "${1:-$SLUG}" --arg id "${TUNNEL_ID}" --arg r "${2:-$REDIRECT}" '{slug: $s, hostKind: "tunnel", hostId: $id, name: "E2E Native", redirectPaths: [$r]}'; }
assert_eq "$(create_status "$(base 'Bad_Slug')")" "400 invalid_request" "An id that is no slug: 400" || true
assert_eq "$(create_status "$(base "${SLUG}" /api/e2e/callback)")" "400 invalid_request" "A redirect path under /api/: 400" || true
assert_eq "$(create_status "$(base "${SLUG}" /.well-known/callback)")" "400 invalid_request" "A redirect path under /.well-known/: 400" || true
assert_eq "$(create_status "$(base "${SLUG}" /native/../callback)")" "400 invalid_request" "A redirect path with a dot segment: 400" || true
assert_eq "$(create_status "$(base "${SLUG}" '/native/callback?x=1')")" "400 invalid_request" "A redirect path with a query: 400" || true
assert_eq "$(create_status "$(base | jq -c '. + {accessTokenMinutes: 30}')")" "400 invalid_request" "Access tokens of 30 minutes: 400 (15 at most)" || true
assert_eq "$(create_status "$(base | jq -c '. + {idleDays: 60, absoluteDays: 30}')")" "400 invalid_request" "An idle lifetime longer than the absolute one: 400" || true
assert_eq "$(create_status "$(base | jq -c '. + {associations: {ios: {teamId: "short", bundleIds: ["com.example.app"]}}}')")" "400 invalid_request" "A malformed iOS team id: 400" || true
assert_eq "$(create_status "$(base | jq -c '. + {associations: {android: [{packageName: "com.example.app", sha256CertFingerprints: ["AA:BB"]}]}}')")" "400 invalid_request" "A malformed Android fingerprint: 400" || true
assert_eq "$(create_status "$(base | jq -c '. + {audience: ["https://elsewhere.example"]}')")" "400 invalid_request" "An unknown field (an audience of its own): 400" || true
assert_eq "$(create_status "$(base | jq -c '.hostId = "no-such-tunnel"')")" "400 not_an_application_host" "A host that serves no plugin: 400 not_an_application_host" || true
assert_eq "$(api_get "native-apps" | jq '[.clients[]? | select(.hostId == "'"${TUNNEL_ID}"'")] | length' 2>/dev/null || echo "-1")" "0" "…none was registered" || true

BODY=$(base | jq -c --arg team "${IOS_TEAM}" --arg bundle "${IOS_BUNDLE}" --arg pkg "${ANDROID_PACKAGE}" --arg fp "${ANDROID_FP}" '. + {idleDays: 20, absoluteDays: 60, associations: {ios: {teamId: $team, bundleIds: [$bundle]}, android: [{packageName: $pkg, sha256CertFingerprints: [$fp]}]}}')
RESP=$(call POST "native-apps" "$BODY")
assert_eq "$(status_of "$RESP")" "201" "POST /api/native-apps: ${CLIENT}" || true
assert_json_field "$(body_of "$RESP")" '"\(.client.clientId) \(.client.served) \(.client.audience) \(.client.redirectUris | join(","))"' "${CLIENT} true https://${FQDN} https://${FQDN}${REDIRECT}" "…served, the host's audience, its redirect URI" || true
assert_eq "$(create_status "$(base e2e40second /second/callback)")" "409 host_has_client" "A second client on the host: 409 host_has_client" || true
assert_eq "$(api_get "audit?action=native-app.created&limit=20" | jq "[.entries[]? | select(.id > ${AUDIT_BASE}) | select(.details.clientId == \"${CLIENT}\")] | length" 2>/dev/null || echo "0")" "1" "Audited: native-app.created" || true

# ===========================================================================
# 3. What Authelia, Gatekeeper and nginx are given
# ===========================================================================

log_section "Authelia's client, Gatekeeper's projection, the vhosts and the files"

if wait_for 90 client_rendered; then
  log_pass "Authelia's configuration holds ${CLIENT}"
else
  log_fail "Authelia's configuration does not hold ${CLIENT}"
fi
local_wait_authelia "${DOMAIN}"
RENDERED=$(rendered_client)
assert_json_field "$RENDERED" '"\(.public) \(.token_endpoint_auth_method) \(.require_pkce) \(.pkce_challenge_method)"' "true none true S256" "Public, no client authentication, PKCE required, S256 only" || true
assert_json_field "$RENDERED" '"\(.grant_types | sort | join(",")) \(.response_types | join(",")) \(.scopes | sort | join(","))"' "authorization_code,refresh_token code offline_access,openid,profile" "authorization_code + refresh_token, code, offline_access" || true
assert_json_field "$RENDERED" '"\(.audience | join(",")) \(.requested_audience_mode) \(.access_token_signed_response_alg) \(.consent_mode)"' "https://${FQDN} implicit RS256 explicit" "The host's audience granted implicitly, RS256 JWTs, consent asked" || true
CONFIG=$(bash -c "${AUTHELIA_CONFIG_JSON}" 2>/dev/null || echo '{}')
assert_json_field "$CONFIG" ".identity_providers.oidc.lifespans.custom[\"$(json_get "$RENDERED" '.lifespan')\"] | \"\(.access_token) \(.refresh_token)\"" "15 minutes 20 days" "Its lifespans: access tokens 15 minutes, refresh tokens the idle lifetime (20 days)" || true
assert_json_field "$CONFIG" ".identity_providers.oidc.claims_policies[\"$(json_get "$RENDERED" '.claims_policy')\"].access_token | join(\",\")" "preferred_username" "Its claims policy puts preferred_username in the access token" || true
assert_json_field "$CONFIG" ".identity_providers.oidc.authorization_policies[\"$(json_get "$RENDERED" '.authorization_policy')\"] | \"\(.default_policy) \([.rules[].policy] | unique | join(\",\"))\"" "deny two_factor" "Its authorization policy: two factors, everyone else denied" || true
DISCOVERY=$(curl -sk --max-time 15 --resolve "auth.${DOMAIN}:443:127.0.0.1" "https://auth.${DOMAIN}/.well-known/openid-configuration" 2>/dev/null || echo '{}')
assert_json_field "$DISCOVERY" '"\(.code_challenge_methods_supported | join(",")) \(.token_endpoint)"' "S256 https://auth.${DOMAIN}/api/oidc/token" "Discovery: S256 only, the standard token endpoint" || true

assert_json_field "$(cat "${STATE_DIR}/native-apps.json" 2>/dev/null || echo '{}')" "[.clients[]? | select(.clientId == \"${CLIENT}\") | .fqdn] | join(\",\")" "${FQDN}" "Gatekeeper's projection native-apps.json names the client and its host" || true
assert_eq "$(stat -c '%a' "${STATE_DIR}/native-apps.json" 2>/dev/null || echo "-")" "600" "…0600" || true

AUTH_VHOST=$(vhost_available auth "${DOMAIN}")
assert_contains "$(cat "${AUTH_VHOST}" 2>/dev/null)" "location = /api/oidc/token" "The auth vhost sends /api/oidc/token to the broker" || true
assert_contains "$(cat "${AUTH_VHOST}" 2>/dev/null)" "proxy_pass http://127.0.0.1:3100/api/native-apps/oauth/revocation" "…and /api/oidc/revocation" || true
HOST_VHOST=$(vhost_available app "${FQDN}")
host_vhost_native() { grep -qF "location = ${REDIRECT}" "${HOST_VHOST}" 2>/dev/null; }
if wait_for 60 host_vhost_native; then
  log_pass "The host's vhost was rewritten for the client"
else
  log_fail "The host's vhost (${HOST_VHOST}) has no native locations"
fi
VHOST=$(cat "${HOST_VHOST}" 2>/dev/null || echo "")
assert_contains "$VHOST" "location = /.well-known/apple-app-site-association" "The host's vhost serves Apple's association file" || true
assert_contains "$VHOST" "location = /.well-known/assetlinks.json" "…and Android's" || true
assert_contains "$VHOST" "location = ${REDIRECT}" "…and the redirect path" || true
assert_contains "$VHOST" "access_log off" "…kept out of the access log" || true
assert_contains "$VHOST" 'proxy_set_header Authorization "";' "…and never passes Authorization to the tunnel's backend" || true
assert_eq "$(nginx -t > /dev/null 2>&1 && echo ok || echo failed)" "ok" "nginx -t accepts the vhosts lamaste-priv wrote" || true
assert_eq "$(find "${NATIVE_DIR}" -mindepth 1 -maxdepth 1 -printf '%f\n' 2>/dev/null | sort | paste -sd, -)" "apple-app-site-association,assetlinks.json,redirect.html" "The files in ${NATIVE_DIR}" || true

RESP=$(curl -sk --max-time 15 --resolve "${FQDN}:443:127.0.0.1" -D - -w '\n%{http_code}' "https://${FQDN}/.well-known/apple-app-site-association" 2>/dev/null || echo "000")
assert_eq "$(status_of "$RESP")" "200" "Apple's file served without a session" || true
assert_json_field "$(printf '%s\n' "$RESP" | sed '$d' | tr -d '\r' | awk 'f; /^$/ {f = 1}')" '"\(.applinks.details[0].appIDs | join(",")) \([.applinks.details[0].components[]."/"] | join(","))"' "${IOS_TEAM}.${IOS_BUNDLE} ${REDIRECT}" "…the app, claiming the redirect path only" || true
RESP=$(curl -sk --max-time 15 --resolve "${FQDN}:443:127.0.0.1" -o /dev/null -w '%{http_code}' "https://${FQDN}${REDIRECT}?code=${MARK}" 2>/dev/null || echo "000")
assert_eq "$RESP" "200" "The redirect page served without a session" || true
assert_eq "$(grep -rcF "${MARK}" /var/log/nginx/ 2>/dev/null | awk -F: '{s += $NF} END {print s + 0}')" "0" "…its query in no nginx log" || true

# ===========================================================================
# 4. The broker
# ===========================================================================

log_section "The token broker"

assert_eq "$(broker_says -H "Authorization: Basic $(printf '%s:' "${CLIENT}" | base64)" --data-urlencode grant_type=refresh_token --data-urlencode refresh_token=e2e-x "https://auth.${DOMAIN}/api/oidc/token")" "401 invalid_client" "Basic client authentication naming the native client: 401 invalid_client" || true
assert_eq "$(broker_says --data-urlencode grant_type=authorization_code --data-urlencode code=e2e-x --data-urlencode "redirect_uri=https://${FQDN}${REDIRECT}" --data-urlencode code_verifier=e2e-x --data-urlencode client_id=lamaste-native-e2e40nosuch "https://auth.${DOMAIN}/api/oidc/token")" "401 invalid_client" "A code for a native id that is not registered: 401 invalid_client, never forwarded" || true
assert_eq "$(broker_says --data-urlencode grant_type=refresh_token --data-urlencode "refresh_token=e2e-unknown-${MARK}" --data-urlencode "client_id=${CLIENT}" "https://auth.${DOMAIN}/api/oidc/token")" "400 invalid_grant" "An unknown refresh token: 400 invalid_grant" || true
assert_eq "$(broker_says --data-urlencode grant_type=client_credentials --data-urlencode "client_id=${CLIENT}" "https://auth.${DOMAIN}/api/oidc/token")" "400 unsupported_grant_type" "A grant a native client never uses: 400 unsupported_grant_type" || true
assert_eq "$(broker_says --data-urlencode "token=e2e-unknown-${MARK}" --data-urlencode "client_id=${CLIENT}" "https://auth.${DOMAIN}/api/oidc/revocation" | cut -d' ' -f1)" "200" "Revoking an unknown token: 200 (RFC 7009)" || true
OUT=$(broker -H "Authorization: Basic $(printf '%s' 'lamaste-server:e2e-wrong-secret' | base64)" --data-urlencode grant_type=client_credentials --data-urlencode scope=lamaste.registry "https://auth.${DOMAIN}/api/oidc/token")
assert_eq "$(status_of "$OUT") $(json_get "$(body_of "$OUT")" '.error')" "401 invalid_client" "A confidential client with a wrong secret: 401 invalid_client…" || true
assert_contains "$(json_get "$(body_of "$OUT")" '.error_description')" "Client authentication failed" "…Authelia's own answer, passed through" || true

# ===========================================================================
# 5. The CLI
# ===========================================================================

log_section "lamaste-server native-apps"

OUT=$(cli native-apps list)
assert_json_field "$OUT" "[.clients[] | select(.clientId == \"${CLIENT}\") | \"\(.served) \(.fqdn)\"] | first" "true ${FQDN}" "native-apps list --json: the client, served, on ${FQDN}" || true
OUT=$(cli native-apps update "${CLIENT}" --access-minutes 10)
assert_json_field "$OUT" '"\(.event) \(.client.accessTokenMinutes)"' "complete 10" "native-apps update --access-minutes 10" || true
if wait_for 90 bash -c "${AUTHELIA_CONFIG_JSON} | jq -e '.identity_providers.oidc.lifespans.custom[] | select(.access_token == \"10 minutes\")' > /dev/null"; then
  log_pass "…Authelia's lifespan follows: 10 minutes"
else
  log_fail "Authelia's lifespan did not follow the update"
fi
OUT=$(cli native-apps grants "${CLIENT}")
assert_json_field "$OUT" '.grants | length' "0" "native-apps grants --json: none yet" || true
FIRST_USER=$(api_get "users" | jq -r '.users[0].username // empty' 2>/dev/null || echo "")
OUT=$(cli users native-grants "${FIRST_USER}")
assert_json_field "$OUT" '.grants | type' "array" "users native-grants ${FIRST_USER} --json: a list" || true
OUT=$(cli native-apps disable "${CLIENT}")
assert_json_field "$OUT" '.event' "complete" "native-apps disable" || true
if wait_for 90 client_not_rendered; then
  log_pass "…Authelia's configuration no longer holds it"
else
  log_fail "A disabled client is still in Authelia's configuration"
fi
OUT=$(cli native-apps enable "${CLIENT}")
assert_json_field "$OUT" '.event' "complete" "native-apps enable" || true
if wait_for 90 client_rendered; then
  log_pass "…rendered again"
else
  log_fail "The enabled client is not rendered"
fi
OUT=$(cli native-apps delete "${CLIENT}" --yes)
assert_json_field "$OUT" '.event' "complete" "native-apps delete --yes" || true
if wait_for 90 client_not_rendered; then
  log_pass "…gone from Authelia's configuration"
else
  log_fail "A deleted client is still in Authelia's configuration"
fi
assert_eq "$(test -e "${NATIVE_DIR}" && echo present || echo gone)" "gone" "…its files are gone" || true
assert_json_field "$(cat "${STATE_DIR}/native-apps.json" 2>/dev/null || echo '{}')" "[.clients[]? | select(.clientId == \"${CLIENT}\")] | length" "0" "…Gatekeeper's projection no longer names it" || true
if wait_for 60 bash -c "! grep -qF 'location = ${REDIRECT}' '${HOST_VHOST}'"; then
  log_pass "…the host's vhost no longer serves its redirect path"
else
  log_fail "The host's vhost still serves the deleted client's redirect path"
fi

local_wait_authelia "${DOMAIN}"

end_test

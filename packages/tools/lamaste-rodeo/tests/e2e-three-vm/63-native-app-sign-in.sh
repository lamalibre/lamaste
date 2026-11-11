#!/usr/bin/env bash
# ============================================================================
# 63 — Native app: sign-in and calls (Three-VM)
# ============================================================================
# A phone app on the user surface (native-apps-design.md), driven from the
# visitor VM with curl. Three agent-hosted plugins with identity
# (write_app_install_fixture … wide), hosted on the agent VM's agent:
# e2e-nat63a owns a web surface (a plugin-owned site) which e2e-nat63b
# joins — one host for an application's plugins; e2e-nat63c is bound to an
# authenticated tunnel another agent carries (a second agent certificate the
# spec issues, which runs no chisel client: the user surface is answered by
# the relay, never by the tunnel's agent), bound across agents. Three-VM
# has one agent machine, so "the plugins of one host hosted by different
# agents" is proven on the tunnel: the site's two plugins share the agent.
#
# 1. One host for an application: b joins a's site (served); c is refused
#    on the tunnel without crossAgent, bound with it (served; the
#    confirmation names the carrying and the hosting agent).
# 2. A native client per host (site and tunnel): served, the host's
#    audience, its redirect URI, the routes it serves; a second client on a
#    host is refused (409 host_has_client). Authelia renders both.
# 3. The association files and the redirect path, served without a
#    session: Apple's file claims the redirect path only, Android's names
#    the package and fingerprint; the redirect page is static, no-store,
#    no-referrer, sandboxed, and the redirect path's request (an
#    authorization code in its query) is in no nginx log.
# 4. PKCE: without a challenge and with `plain`, the authorization is
#    refused (invalid_request at the redirect URI); with S256 the code is
#    exchanged at the domain's token endpoint (the relay's broker) — a JWT
#    access token (at+jwt, RS256, the host's audience, the client, the
#    username, ≤ 15 minutes) and a refresh token; the grant is listed with
#    its device name.
# 5. Bearer calls to both plugins of the site: GET and POST without
#    Origin, the agent half receives the user caller and no Authorization;
#    a cookie of another visitor beside the bearer is ignored (the bearer is
#    the request's credential); a tampered or malformed token is 401
#    invalid_token with WWW-Authenticate; the site's token on the tunnel
#    host (wrong audience) and the tunnel client's on the site (another
#    host's client) are 401 too.
# 6. The tunnel reassigned to a third agent: the cross-agent binding lapses
#    (cross_agent_unconfirmed) and nginx answers the route 503 itself —
#    nothing reaches the agent half.
# 7. The broker: Basic client authentication naming a native client is
#    refused (invalid_client), an unknown refresh token is invalid_grant,
#    and a request of no native client passes to Authelia unchanged.
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../e2e/helpers.sh"
# shellcheck source-path=SCRIPTDIR source=app-plugin-harness.sh
source "${SCRIPT_DIR}/app-plugin-harness.sh"

require_commands multipass curl jq node npm tar perl openssl

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

PLUGIN_A="e2e-nat63a"
PLUGIN_B="e2e-nat63b"
PLUGIN_C="e2e-nat63c"
SUB_W="e2e63app"
SUB_T="e2e63tun"
PORT_T=18463
POLICY_ID="e2e-apphost-63"
REMOTE_DIR="/var/tmp/e2e-63-app-plugin"
LOCAL_TMP=""
CLEAN_PLUGINS="${PLUGIN_A} ${PLUGIN_B} ${PLUGIN_C}"
CLEAN_ROUTES="${PLUGIN_A} ${PLUGIN_B} ${PLUGIN_C}"
PURGE_PACKAGES=""
# A username that reached an OIDC client is never given out again: per run.
USER_TAG="$(date +%s)"
USER_TAG="${USER_TAG: -6}"
PERSON="e2e63-person-${USER_TAG}"
OTHER="e2e63-other-${USER_TAG}"
# Test credentials for this run only, never printed
PERSON_PASSWORD="E2e-$(openssl rand -hex 12)"
OTHER_PASSWORD="E2e-$(openssl rand -hex 12)"
JAR_PERSON="/tmp/e2e-63-person.cookies"
JAR_OTHER="/tmp/e2e-63-other.cookies"
RUN_TAG="$(date +%s)"
FRONT_1="e2e63front${RUN_TAG: -5}"
FRONT_2="e2e63back${RUN_TAG: -5}"
SLUG_SITE="e2e63site"
SLUG_TUN="e2e63tun"
CLIENT_SITE="lamaste-native-${SLUG_SITE}"
CLIENT_TUN="lamaste-native-${SLUG_TUN}"
IOS_TEAM="E2ETEAM063"
IOS_BUNDLE="com.example.e2enative"
ANDROID_PACKAGE="com.example.e2enative"
ANDROID_FP="AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99"
MARK="e2e63code${RUN_TAG}"
FQDN=""
TUN_FQDN=""
SITE_ID=""
TUNNEL_ID=""
PERSON_ID=""
AT_SITE=""
RT_SITE=""
AT_TUN=""

# echo_of <token> <jar | -> <host> <route> [curl arguments...] — the agent
# half's /app/echo through the host with the bearer: its JSON body, then the
# status on a line of its own
echo_of() {
  local token="$1" jar="$2" host="$3" route="$4" out
  shift 4
  out=$(bearer "$token" "$jar" "$@" "https://${host}/api/${route}/app/echo")
  printf '%s\n%s\n' "$(visit_body "$out")" "$(visit_status "$out")"
}

# in_audience <plugin> <userId> — the audience holds the user as an active member
in_audience() {
  [ "$(audience_row "$1" "$2" | jq -r '"\(.change.kind) \(.change.member.status)"' 2>/dev/null)" = "upsert active" ]
}

# joined_served <route> — the site's joined route is served
joined_served() {
  [ "$(web_surface "${PLUGIN_A}" | jq -r --arg r "$1" '[.site.joined[]? | select(.route == $r) | .served] | first // false' 2>/dev/null)" = "true" ]
}

# tunnel_route_state <route> — "<served> <reason>" of the route on the tunnel
tunnel_route_state() {
  tunnel_entry "${TUNNEL_ID}" | jq -r --arg r "$1" '[.userSurfaceStatus[]? | select(.route == $r) | "\(.served) \(.reason)"] | first // "none"' 2>/dev/null || echo "none"
}
tunnel_route_is() { [ "$(tunnel_route_state "$1")" = "$2" ]; }

# nginx_logs_hold <text> — how many lines of nginx's logs on the host VM hold <text>
nginx_logs_hold() {
  host_exec "cat /var/log/nginx/*.log 2>/dev/null | grep -cF $(printf %q "$1") || true" 2>/dev/null | tail -n 1 || echo "-1"
}

begin_test "63 — Native app: sign-in and calls (Three-VM)"

cleanup() {
  log_info "Cleaning up test resources..."
  local id
  native_cleanup "${CLIENT_SITE}" "${CLIENT_TUN}"
  if [ -n "${TUNNEL_ID}" ]; then host_api_delete "tunnels/${TUNNEL_ID}" > /dev/null 2>&1 || true; fi
  for id in "${FRONT_1}" "${FRONT_2}"; do host_api_delete "certs/agent/${id}" > /dev/null 2>&1 || true; done
  for id in "${PLUGIN_A}" "${PLUGIN_B}" "${PLUGIN_C}"; do drop_plugin_grants "$id"; done
  timed_exec 60 multipass exec "${VISITOR_VM}" -- sudo bash -c "rm -f ${JAR_PERSON} ${JAR_OTHER} /tmp/e2e-native-nobody.cookies; sed -i '/${SUB_W}\\./d; /${SUB_T}\\./d' /etc/hosts; true" > /dev/null 2>&1
  for id in "${PERSON}" "${OTHER}"; do host_api_delete "users/${id}?erase=true" > /dev/null 2>&1 || true; done
  nudge_sync
  app_plugin_cleanup
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
log_section "Pre-flight"
# ---------------------------------------------------------------------------

app_plugin_preflight
FQDN="${SUB_W}.${DOMAIN}"
TUN_FQDN="${SUB_T}.${DOMAIN}"
log_info "Hosting agent: ${HOST_AGENT_LABEL}, relay domain ${DOMAIN}, site ${FQDN}, tunnel ${TUN_FQDN}"
if agent_has_node_sqlite; then
  log_pass "The agent VM's Node.js has node:sqlite, which the agent half's projection needs"
else
  log_fail "The agent VM's Node.js has no unflagged node:sqlite (Node.js 22.13 or later): the identity fixtures cannot run"
  end_test
  exit $?
fi
if visitor_has_oathtool; then
  log_pass "The visitor VM has oathtool (Authelia's second factor)"
else
  log_fail "The visitor VM has no oathtool: nobody can sign in"
  end_test
  exit $?
fi
# Leftovers of an interrupted run (rodeo ends a spec at ten minutes without its trap)
native_cleanup "${CLIENT_SITE}" "${CLIENT_TUN}"
for id in $(host_api_get "tunnels?limit=500" 2>/dev/null | jq -r --arg s "${SUB_T}" '.tunnels[]? | select(.subdomain == $s) | .id' 2>/dev/null || true); do
  host_api_delete "tunnels/${id}" > /dev/null 2>&1 || true
done
host_api_delete "plugins/${PLUGIN_A}/web-surface" > /dev/null 2>&1 || true
for id in "${PLUGIN_A}" "${PLUGIN_B}" "${PLUGIN_C}"; do drop_plugin_grants "$id"; done
for id in "${PERSON}" "${OTHER}"; do host_api_delete "users/${id}?erase=true" > /dev/null 2>&1 || true; done
AUDIT_BASE=$(host_api_get "audit?limit=1" | jq '.entries[0].id // 0' 2>/dev/null || echo "0")

# ===========================================================================
# 1. Three plugins; one host for the application, a tunnel across agents
# ===========================================================================

log_section "Three plugins, hosted; the site's plugins and a tunnel across agents"

LOCAL_TMP=$(mktemp -d /tmp/e2e-63-app-plugin-XXXXXXXX)
FIXTURES="built"
write_app_install_fixture "${LOCAL_TMP}/ship/fixtures/a" "${PLUGIN_A}" 1.0.0 main "r${RUN_TAG}-$$" '[]' none wide v1 "${SUB_W}" || FIXTURES="failed"
write_app_install_fixture "${LOCAL_TMP}/ship/fixtures/b" "${PLUGIN_B}" 1.0.0 main "r${RUN_TAG}-$$" '[]' none wide || FIXTURES="failed"
write_app_install_fixture "${LOCAL_TMP}/ship/fixtures/c" "${PLUGIN_C}" 1.0.0 main "r${RUN_TAG}-$$" '[]' none wide || FIXTURES="failed"
if [ "$FIXTURES" != "built" ]; then
  log_fail "The fixtures could not be built (npm install at the workspace root, npm run build -w packages/core/lib)"
  end_test
  exit $?
fi
log_pass "Fixtures built: ${PLUGIN_A} (with a web tree), ${PLUGIN_B}, ${PLUGIN_C}"
ship_agent_facts_probe
start_stand_in_feria fixtures/a/server fixtures/a/agent fixtures/b/server fixtures/b/agent fixtures/c/server fixtures/c/agent
ensure_app_host_helper
open_push_install "${POLICY_ID}" "[\"@lamalibre/${PLUGIN_A}-agent\",\"@lamalibre/${PLUGIN_B}-agent\",\"@lamalibre/${PLUGIN_C}-agent\"]" '["install","uninstall"]'

RESP=$(users_call POST "users" "{\"username\":\"${PERSON}\",\"displayname\":\"E2E Person\",\"email\":\"${PERSON}@example.test\",\"password\":\"${PERSON_PASSWORD}\",\"groups\":[]}")
assert_eq "$(status_of "$RESP")" "201" "User ${PERSON} created" || true
PERSON_ID=$(json_get "$(body_of "$RESP")" '.user.userId // empty')
RESP=$(users_call POST "users" "{\"username\":\"${OTHER}\",\"displayname\":\"E2E Other\",\"email\":\"${OTHER}@example.test\",\"password\":\"${OTHER_PASSWORD}\",\"groups\":[]}")
assert_eq "$(status_of "$RESP")" "201" "User ${OTHER} created — signed in, entitled to nothing" || true

for plugin in "${PLUGIN_A}" "${PLUGIN_B}" "${PLUGIN_C}"; do
  INSTALL=$(install_approved "${plugin}" "@lamalibre/${plugin}-server@1.0.0")
  assert_json_field "$INSTALL" '.plugin.version' '1.0.0' "Installed and approved: ${plugin}" || true
done
RESP=$(host_api_call POST "plugins/${PLUGIN_A}/web-surface" '{"accessMode":"authenticated"}')
assert_eq "$(status_of "$RESP")" "201" "${PLUGIN_A}'s web surface created on ${FQDN}" || true
SITE_ID=$(json_get "$(body_of "$RESP")" '.webSurface.site.id // empty')
for plugin in "${PLUGIN_A}" "${PLUGIN_B}" "${PLUGIN_C}"; do
  OP=$(host_plugin "${plugin}" 300 nudge)
  assert_json_field "$OP" '.status' 'succeeded' "${plugin} hosted on ${HOST_AGENT_LABEL} ($(json_get "$OP" '.error // .refused.error // ""'))" || true
done
for plugin in "${PLUGIN_A}" "${PLUGIN_B}" "${PLUGIN_C}"; do
  if wait_for 120 identity_ready "${plugin}"; then
    log_pass "${plugin} is ready: its agent half synced to the head"
  else
    log_fail "${plugin} is not ready: $(identity_view "${plugin}" | jq -c '.readiness')"
  fi
done
if wait_for 120 web_served "${PLUGIN_A}"; then
  log_pass "The site is served"
else
  log_fail "The site is not served: $(web_surface "${PLUGIN_A}" | jq -c '{served, reason}')"
fi

RESP=$(host_api_call PUT "plugins/${PLUGIN_A}/web-surface/routes/${PLUGIN_B}")
assert_eq "$(status_of "$RESP")" "200" "PUT /api/plugins/${PLUGIN_A}/web-surface/routes/${PLUGIN_B}: ${PLUGIN_B} joins the site" || true
if wait_for 60 joined_served "${PLUGIN_B}"; then
  log_pass "…served on ${FQDN} beside ${PLUGIN_A}"
else
  log_fail "The joined route: $(web_surface "${PLUGIN_A}" | jq -c '.site.joined')"
fi

RESP=$(host_api_post "certs/agent" "{\"label\":\"${FRONT_1}\",\"capabilities\":[\"tunnels:read\"]}" 2>/dev/null || echo '{}')
assert_json_field "$RESP" '.ok' 'true' "A second agent certificate, ${FRONT_1}: the tunnel's carrier" || true
RESP=$(host_api_post "tunnels" "{\"subdomain\":\"${SUB_T}\",\"port\":${PORT_T},\"accessMode\":\"authenticated\",\"agentLabel\":\"${FRONT_1}\"}")
TUNNEL_ID=$(json_get "$RESP" '.tunnel.id // empty')
assert_json_field "$RESP" '"\(.tunnel.fqdn) \(.tunnel.agentLabel)"' "${TUN_FQDN} ${FRONT_1}" "Tunnel ${TUN_FQDN}, authenticated, carried by ${FRONT_1}" || true
RESP=$(host_api_call PUT "tunnels/${TUNNEL_ID}/user-surface" "{\"route\":\"${PLUGIN_C}\"}")
assert_eq "$(status_of "$RESP")" "400" "Binding ${PLUGIN_C}, which ${HOST_AGENT_LABEL} hosts, without crossAgent: 400" || true
assert_contains "$(json_get "$(body_of "$RESP")" '.error')" "crossAgent" "…the refusal names crossAgent" || true
RESP=$(host_api_call PUT "tunnels/${TUNNEL_ID}/user-surface" "{\"route\":\"${PLUGIN_C}\",\"crossAgent\":true}")
assert_eq "$(status_of "$RESP")" "200" "With crossAgent: bound" || true
assert_json_field "$(tunnel_entry "${TUNNEL_ID}")" "[.userSurface.crossAgent[]? | select(.route == \"${PLUGIN_C}\") | \"\\(.agent) \\(.hostingAgent)\"] | first // \"none\"" "${FRONT_1} ${HOST_AGENT_LABEL}" "…the binding records the confirmation: ${FRONT_1} carrying, ${HOST_AGENT_LABEL} hosting" || true
if wait_for 30 tunnel_route_is "${PLUGIN_C}" "true null"; then
  log_pass "…served on ${TUN_FQDN}"
else
  log_fail "The tunnel's route: $(tunnel_route_state "${PLUGIN_C}")"
fi
assert_eq "$(audit_count "${PLUGIN_C}" tunnel.user-surface.bound '.reason == "cross-agent"')" "1" "Audited: tunnel.user-surface.bound, reason cross-agent" || true
visitor_exec "grep -q ' ${FQDN}\$' /etc/hosts || echo '${HOST_IP} ${FQDN}' >> /etc/hosts; grep -q ' ${TUN_FQDN}\$' /etc/hosts || echo '${HOST_IP} ${TUN_FQDN}' >> /etc/hosts" > /dev/null 2>&1 || true

# ===========================================================================
# 2. A native client per host
# ===========================================================================

log_section "A native client per application host"

BODY=$(jq -c -n --arg slug "${SLUG_SITE}" --arg id "${SITE_ID}" --arg path "${NATIVE_REDIRECT_PATH}" --arg team "${IOS_TEAM}" --arg bundle "${IOS_BUNDLE}" --arg pkg "${ANDROID_PACKAGE}" --arg fp "${ANDROID_FP}" \
  '{slug: $slug, hostKind: "site", hostId: $id, name: "E2E Native App", redirectPaths: [$path], associations: {ios: {teamId: $team, bundleIds: [$bundle]}, android: [{packageName: $pkg, sha256CertFingerprints: [$fp]}]}}')
RESP=$(host_api_call POST "native-apps" "$BODY")
assert_eq "$(status_of "$RESP")" "201" "POST /api/native-apps: ${CLIENT_SITE} for the site" || true
CLIENT=$(json_get "$(body_of "$RESP")" '.client')
assert_json_field "$CLIENT" '"\(.clientId) \(.served) \(.fqdn) \(.audience)"' "${CLIENT_SITE} true ${FQDN} https://${FQDN}" "…served, on ${FQDN}, its audience the host's origin" || true
assert_json_field "$CLIENT" '.redirectUris | join(",")' "https://${FQDN}${NATIVE_REDIRECT_PATH}" "…its redirect URI on the host" || true
assert_json_field "$CLIENT" '.servedRoutes | sort | join(",")' "${PLUGIN_A},${PLUGIN_B}" "…serving both plugins of the site" || true
assert_json_field "$CLIENT" '"\(.accessTokenMinutes) \(.idleDays) \(.absoluteDays)"' "15 30 90" "…access tokens of 15 minutes, 30 days idle, 90 days absolute (the defaults)" || true

RESP=$(host_api_call POST "native-apps" "{\"slug\":\"e2e63second\",\"hostKind\":\"site\",\"hostId\":\"${SITE_ID}\",\"name\":\"Second\",\"redirectPaths\":[\"/other/callback\"]}")
assert_eq "$(status_of "$RESP") $(json_get "$(body_of "$RESP")" '.code')" "409 host_has_client" "A second client on the same host: 409 host_has_client" || true

RESP=$(host_api_call POST "native-apps" "{\"slug\":\"${SLUG_TUN}\",\"hostKind\":\"tunnel\",\"hostId\":\"${TUNNEL_ID}\",\"name\":\"E2E Tunnel App\",\"redirectPaths\":[\"${NATIVE_REDIRECT_PATH}\"]}")
assert_eq "$(status_of "$RESP")" "201" "POST /api/native-apps: ${CLIENT_TUN} for the tunnel" || true
assert_json_field "$(body_of "$RESP")" '"\(.client.served) \(.client.servedRoutes | join(","))"' "true ${PLUGIN_C}" "…served, serving ${PLUGIN_C}" || true
assert_eq "$(native_audits native-app.created "(.clientId == \"${CLIENT_SITE}\") or (.clientId == \"${CLIENT_TUN}\")")" "2" "Audited twice: native-app.created" || true

if wait_for 120 native_client_known "${CLIENT_SITE}" "${FQDN}" && wait_for 60 native_client_known "${CLIENT_TUN}" "${TUN_FQDN}"; then
  log_pass "Authelia knows both clients (rendered, Authelia restarted)"
else
  log_fail "Authelia does not know the clients"
fi
RENDERED=$(host_exec "${AUTHELIA_CONFIG_JSON}" 2>/dev/null | jq -c --arg id "${CLIENT_SITE}" '[.identity_providers.oidc.clients[]? | select(.client_id == $id)] | first // {}' 2>/dev/null || echo '{}')
assert_json_field "$RENDERED" '"\(.public) \(.require_pkce) \(.pkce_challenge_method) \(.token_endpoint_auth_method)"' "true true S256 none" "Authelia's client: public, PKCE required, S256 only" || true
assert_json_field "$RENDERED" '"\(.grant_types | sort | join(",")) \(.scopes | sort | join(","))"' "authorization_code,refresh_token offline_access,openid,profile" "…authorization_code and refresh_token, offline_access" || true
assert_json_field "$RENDERED" '"\(.audience | join(",")) \(.requested_audience_mode) \(.access_token_signed_response_alg)"' "https://${FQDN} implicit RS256" "…the host's audience, granted implicitly, JWT access tokens" || true
assert_json_field "$RENDERED" '.redirect_uris | join(",")' "https://${FQDN}${NATIVE_REDIRECT_PATH}" "…the claimed HTTPS redirect URI" || true
POLICY=$(host_exec "${AUTHELIA_CONFIG_JSON}" 2>/dev/null | jq -c --arg p "$(json_get "$RENDERED" '.authorization_policy')" '.identity_providers.oidc.authorization_policies[$p] // {}' 2>/dev/null || echo '{}')
assert_json_field "$POLICY" '"\(.default_policy) \([.rules[]?.policy] | unique | join(","))"' "deny two_factor" "…its authorization policy: two factors, everyone else denied" || true

# ===========================================================================
# 3. The association files and the redirect path
# ===========================================================================

log_section "The association files and the redirect path, without a session"

RESP=$(visit - "https://${FQDN}/.well-known/apple-app-site-association")
assert_eq "$(visit_status "$RESP")" "200" "GET /.well-known/apple-app-site-association: 200 without a session" || true
assert_contains "$(visit_headers "$RESP" | tr '[:upper:]' '[:lower:]')" "content-type: application/json" "…application/json" || true
AASA=$(visit_body "$RESP")
assert_json_field "$AASA" '.applinks.details[0].appIDs | join(",")' "${IOS_TEAM}.${IOS_BUNDLE}" "…the app's id (team and bundle)" || true
assert_json_field "$AASA" '[.applinks.details[0].components[]?."/"] | join(",")' "${NATIVE_REDIRECT_PATH}" "…claiming the redirect path alone, never the whole host" || true
assert_json_field "$AASA" '.webcredentials.apps | join(",")' "${IOS_TEAM}.${IOS_BUNDLE}" "…and webcredentials for an HTTPS callback" || true
RESP=$(visit - "https://${FQDN}/.well-known/assetlinks.json")
assert_eq "$(visit_status "$RESP")" "200" "GET /.well-known/assetlinks.json: 200 without a session" || true
assert_json_field "$(visit_body "$RESP")" '.[0] | "\(.relation[0]) \(.target.package_name) \(.target.sha256_cert_fingerprints[0])"' "delegate_permission/common.handle_all_urls ${ANDROID_PACKAGE} ${ANDROID_FP}" "…the package and its signing certificate's fingerprint" || true
assert_not_eq "$(visit_status "$(visit - "https://${TUN_FQDN}/.well-known/apple-app-site-association")")" "200" "The tunnel's client declares no iOS app: no file served there" || true

RESP=$(visit - "https://${FQDN}${NATIVE_REDIRECT_PATH}?code=${MARK}&state=e2e")
assert_eq "$(visit_status "$RESP")" "200" "GET ${NATIVE_REDIRECT_PATH} without a session: 200, the static page" || true
HEADERS=$(visit_headers "$RESP" | tr '[:upper:]' '[:lower:]')
assert_contains "$HEADERS" "referrer-policy: no-referrer" "…Referrer-Policy: no-referrer" || true
assert_contains "$HEADERS" "cache-control: no-store" "…Cache-Control: no-store" || true
assert_contains "$HEADERS" "content-security-policy: default-src 'none'" "…a CSP that allows nothing but its own style" || true
assert_not_contains "$(visit_body "$RESP")" "<script" "…no script" || true
assert_not_contains "$(visit_body "$RESP")" "${MARK}" "…nothing of the request on the page" || true
assert_eq "$(visit_status "$(visit - -X POST "https://${FQDN}${NATIVE_REDIRECT_PATH}")")" "405" "POST to the redirect path: 405" || true
assert_eq "$(nginx_logs_hold "${MARK}")" "0" "The redirect path's query (an authorization code) is in no nginx log" || true

# ===========================================================================
# 4. Sign-in with PKCE
# ===========================================================================

log_section "Sign-in: PKCE S256 only, then the code for tokens"

for plugin in "${PLUGIN_A}" "${PLUGIN_B}" "${PLUGIN_C}"; do
  RESP=$(host_api_call PUT "plugins/${plugin}/entitlements" "{\"principalType\":\"user\",\"principalId\":\"${PERSON}\",\"roles\":[\"viewer\"]}")
  assert_eq "$(status_of "$RESP")" "200" "${PERSON} entitled as viewer of ${plugin}" || true
done
for plugin in "${PLUGIN_A}" "${PLUGIN_B}" "${PLUGIN_C}"; do
  if wait_for 30 in_audience "${plugin}" "${PERSON_ID}"; then
    log_pass "…an active member of ${plugin}'s audience"
  else
    log_fail "${plugin}'s audience: $(audience_row "${plugin}" "${PERSON_ID}")"
  fi
done
SECRET_P=$(reset_totp "${PERSON}")
SECRET_O=$(reset_totp "${OTHER}")
wait_for_next_totp_window
assert_eq "$(sign_in "${PERSON}" "${PERSON_PASSWORD}" "${SECRET_P}" "${JAR_PERSON}" "${FQDN}")" "OK OK" "${PERSON} signed in to Authelia from the visitor VM (the app's browser)" || true
assert_eq "$(sign_in "${OTHER}" "${OTHER_PASSWORD}" "${SECRET_O}" "${JAR_OTHER}" "${FQDN}")" "OK OK" "${OTHER} signed in too" || true

pkce_pair
assert_eq "$(native_authorize "${JAR_PERSON}" "${CLIENT_SITE}" "${FQDN}" none)" "error invalid_request" "An authorization request without a PKCE challenge: invalid_request at the redirect URI" || true
assert_eq "$(native_authorize "${JAR_PERSON}" "${CLIENT_SITE}" "${FQDN}" plain)" "error invalid_request" "…with code_challenge_method plain: invalid_request" || true

pkce_pair
OUTCOME=$(native_authorize "${JAR_PERSON}" "${CLIENT_SITE}" "${FQDN}" S256)
assert_eq "${OUTCOME%% *}" "code" "With S256 (consent given): a code at ${NATIVE_REDIRECT_PATH}" || true
native_exchange "${CLIENT_SITE}" "${FQDN}" "${OUTCOME#code }" "E2E Phone"
assert_eq "$(native_status)" "200" "The code exchanged at https://auth.${DOMAIN}/api/oidc/token (the relay's broker): 200" || true
AT_SITE=$(native_field '.access_token // empty')
RT_SITE=$(native_field '.refresh_token // empty')
assert_not_eq "${RT_SITE}" "" "…a refresh token" || true
assert_eq "$(native_field '(.expires_in <= 900) and (.token_type | ascii_downcase == "bearer")')" "true" "…a bearer access token of 15 minutes at most" || true
HEADER=$(jwt_part "${AT_SITE}" 0)
CLAIMS=$(jwt_part "${AT_SITE}" 1)
assert_json_field "$HEADER" '"\(.alg) \(.typ)"' "RS256 at+jwt" "The access token is a JWT: RS256, at+jwt" || true
assert_json_field "$CLAIMS" '"\(.iss) \(.client_id) \(.preferred_username)"' "https://auth.${DOMAIN} ${CLIENT_SITE} ${PERSON}" "…issued by the domain's issuer to ${CLIENT_SITE}, for ${PERSON}" || true
assert_json_field "$CLAIMS" "(.aud | if type == \"string\" then [.] else . end | index(\"https://${FQDN}\")) != null" "true" "…its audience the host" || true
assert_json_field "$CLAIMS" '(.exp - .iat) <= 900' "true" "…living 15 minutes at most" || true
GRANT=$(native_grant_of "${CLIENT_SITE}" "E2E Phone")
assert_json_field "$GRANT" '"\(.userId) \(.endedAt)"' "${PERSON_ID} null" "GET /api/native-apps/${CLIENT_SITE}/grants: the grant of device \"E2E Phone\", ${PERSON}'s, live" || true

# ===========================================================================
# 5. Bearer calls
# ===========================================================================

log_section "Bearer calls to both plugins of the site"

OUT=$(echo_of "${AT_SITE}" - "${FQDN}" "${PLUGIN_A}")
assert_eq "$(status_of "$OUT")" "200" "GET /api/${PLUGIN_A}/app/echo with the bearer: 200" || true
ECHO=$(body_of "$OUT")
assert_json_field "$ECHO" '"\(.caller.type) \(.caller.username) \(.caller.userId) \(.caller.roles | join(","))"' "user ${PERSON} ${PERSON_ID} viewer" "…the agent half's caller: the user, the directory's id, the roles" || true
assert_json_field "$ECHO" '"\(.headers.authorization) \(.headers.cookie) \(.origin)"' "null null null" "…no Authorization, no Cookie, no Origin reached it" || true
OUT=$(echo_of "${AT_SITE}" - "${FQDN}" "${PLUGIN_B}")
assert_eq "$(status_of "$OUT")" "200" "GET /api/${PLUGIN_B}/app/echo, the joined plugin, with the same token: 200" || true
assert_json_field "$(body_of "$OUT")" '"\(.caller.username) \(.headers.authorization)"' "${PERSON} null" "…the same user, no Authorization" || true
OUT=$(echo_of "${AT_SITE}" - "${FQDN}" "${PLUGIN_A}" -X POST -H 'Content-Type: application/json' --data-binary '{"e2e":63}')
assert_eq "$(status_of "$OUT")" "200" "POST without Origin, as a phone app sends it: 200 (no CSRF rule for a bearer)" || true
assert_json_field "$(body_of "$OUT")" '"\(.method) \(.bytes) \(.origin)"' "POST 10 null" "…the body forwarded, still no Origin" || true

OUT=$(echo_of "${AT_SITE}" "${JAR_OTHER}" "${FQDN}" "${PLUGIN_A}")
assert_eq "$(status_of "$OUT")" "200" "${OTHER}'s session cookie beside ${PERSON}'s bearer: 200" || true
assert_json_field "$(body_of "$OUT")" '.caller.username' "${PERSON}" "…as ${PERSON}: the bearer is the request's credential, the cookie ignored" || true
assert_eq "$(visit_status "$(visit "${JAR_OTHER}" "https://${FQDN}/api/${PLUGIN_A}/app/echo")")" "403" "${OTHER}'s cookie alone: 403 (no role)" || true

RESP=$(bearer "$(tampered "${AT_SITE}")" - "https://${FQDN}/api/${PLUGIN_A}/app/echo")
assert_eq "$(visit_status "$RESP")" "401" "A tampered token: 401" || true
assert_json_field "$(visit_body "$RESP")" '.error' "invalid_token" "…{\"error\":\"invalid_token\"}" || true
assert_contains "$(visit_headers "$RESP")" 'Bearer error="invalid_token"' "…WWW-Authenticate: Bearer error=\"invalid_token\"" || true
RESP=$(bearer "e2e.not.a-token" - "https://${FQDN}/api/${PLUGIN_A}/app/echo")
assert_eq "$(visit_status "$RESP") $(visit_body "$RESP" | jq -r '.error' 2>/dev/null)" "401 invalid_token" "A malformed token: 401 invalid_token" || true
assert_eq "$(half_requests "${PLUGIN_A}" ' (GET|POST) /app/echo$')" "3" "${PLUGIN_A}'s agent half received exactly the three accepted requests" || true

native_sign_in "${JAR_PERSON}" "${CLIENT_TUN}" "${TUN_FQDN}" "E2E Tablet"
assert_eq "${NATIVE_SIGN_IN}" "ok" "Signed in with the tunnel's client (the same Authelia session)" || true
AT_TUN="${NATIVE_AT}"
OUT=$(echo_of "${AT_TUN}" - "${TUN_FQDN}" "${PLUGIN_C}")
assert_eq "$(status_of "$OUT")" "200" "GET https://${TUN_FQDN}/api/${PLUGIN_C}/app/echo with its token: 200" || true
assert_json_field "$(body_of "$OUT")" '"\(.caller.username) \(.headers.authorization)"' "${PERSON} null" "…answered by ${PLUGIN_C}'s agent half through the relay, never by ${FRONT_1}" || true
RESP=$(bearer "${AT_SITE}" - "https://${TUN_FQDN}/api/${PLUGIN_C}/app/echo")
assert_eq "$(visit_status "$RESP") $(visit_body "$RESP" | jq -r '.error' 2>/dev/null)" "401 invalid_token" "The site's token on the tunnel host (another audience): 401 invalid_token" || true
RESP=$(bearer "${AT_TUN}" - "https://${FQDN}/api/${PLUGIN_A}/app/echo")
assert_eq "$(visit_status "$RESP") $(visit_body "$RESP" | jq -r '.error' 2>/dev/null)" "401 invalid_token" "The tunnel's token on the site (another host's client): 401 invalid_token" || true

# ===========================================================================
# 6. The cross-agent binding lapses when the tunnel changes agent
# ===========================================================================

log_section "The tunnel reassigned: the cross-agent binding lapses"

RESP=$(host_api_post "certs/agent" "{\"label\":\"${FRONT_2}\",\"capabilities\":[\"tunnels:read\"]}" 2>/dev/null || echo '{}')
assert_json_field "$RESP" '.ok' 'true' "A third agent certificate, ${FRONT_2}" || true
RESP=$(host_api_call PATCH "tunnels/${TUNNEL_ID}" "{\"agentLabel\":\"${FRONT_2}\"}")
assert_eq "$(status_of "$RESP")" "200" "The tunnel reassigned to ${FRONT_2}" || true
assert_json_field "$(tunnel_entry "${TUNNEL_ID}")" '(.userSurface.crossAgent // []) | length' "0" "…its cross-agent confirmation is gone" || true
if wait_for 30 tunnel_route_is "${PLUGIN_C}" "false cross_agent_unconfirmed"; then
  log_pass "…${PLUGIN_C} bound, not served: cross_agent_unconfirmed"
else
  log_fail "The tunnel's route: $(tunnel_route_state "${PLUGIN_C}")"
fi
BEFORE=$(half_requests "${PLUGIN_C}" ' GET /app/echo$')
RESP=$(bearer "${AT_TUN}" - "https://${TUN_FQDN}/api/${PLUGIN_C}/app/echo")
assert_eq "$(visit_status "$RESP")" "503" "The bound, unserved route: nginx answers 503 itself" || true
assert_json_field "$(visit_body "$RESP")" '.error' "The plugin is not available right now" "…as JSON" || true
assert_eq "$(half_requests "${PLUGIN_C}" ' GET /app/echo$')" "${BEFORE}" "…nothing reached the agent half, nor the tunnel's agent" || true

# ===========================================================================
# 7. The broker: what it refuses, what it passes on
# ===========================================================================

log_section "The token broker"

native_post /api/oidc/token -H "Authorization: Basic $(printf '%s:' "${CLIENT_SITE}" | base64)" "grant_type=refresh_token" "refresh_token=${RT_SITE}"
assert_eq "$(native_status) $(native_field '.error')" "401 invalid_client" "Basic client authentication naming a native client: 401 invalid_client (native clients are public)" || true
native_refresh "${CLIENT_SITE}" "e2e-no-such-refresh-token-${RUN_TAG}"
assert_eq "$(native_status) $(native_field '.error')" "400 invalid_grant" "An unknown refresh token: 400 invalid_grant, never forwarded" || true
native_post /api/oidc/token -H "Authorization: Basic $(printf '%s' "lamaste-server:e2e-wrong-secret" | base64)" "grant_type=client_credentials" "scope=lamaste.registry"
assert_eq "$(native_status) $(native_field '.error')" "401 invalid_client" "A confidential client with a wrong secret (no native client): Authelia's own answer, 401 invalid_client" || true
assert_contains "$(native_field '.error_description')" "Client authentication failed" "…passed through unchanged (Authelia's description)" || true
native_refresh "${CLIENT_SITE}" "${RT_SITE}"
assert_eq "$(native_status)" "200" "The site's refresh token still refreshes after all that: 200" || true

end_test

#!/usr/bin/env bash
# ============================================================================
# 71 — Native app: a desktop client (Three-VM)
# ============================================================================
# A desktop app on the user surface (desktop-native-clients-design.md),
# played from the visitor VM: a loopback listener (python3, bound to
# 127.0.0.1 on a free port) receives the authorization response, as a
# desktop app does (RFC 8252 §7.3); curl is its system browser. One
# agent-hosted plugin with identity (write_app_install_fixture … wide) owns
# a web surface on the agent VM's agent.
#
# 1. A desktop client on the plugin's site: kind desktop, its redirect URI
#    http://127.0.0.1/callback (no port), rendered so into Authelia; the
#    host serves no association files and no redirect page for it.
# 2. Sign-in: the code arrives on the listener's own port with the state;
#    exchanged at the domain's token endpoint (the relay's broker) with the
#    same redirect URI and a device name — a JWT access token for the host's
#    audience and a refresh token; the grant is listed with its device. The
#    same code flow exchanged with another port: invalid_grant.
# 3. Bearer calls: the agent half receives the same `user` caller as for a
#    phone or a browser, and no Authorization header.
# 4. Rotation; a spent refresh token reused after its grace window ends the
#    grant (reuse, audited, admins notified); a new sign-in revoked from the
#    panel (DELETE …/grants/:id) ends that grant too — refresh and bearer
#    refused at once.
# 5. A mobile client beside it on the same host: created (one client of
#    each kind per host), its association files served, its own sign-in
#    works, and the desktop client keeps working; a second desktop client on
#    the host is 409 host_has_client.
# 6. Refused at authorization, no code delivered: an unregistered loopback
#    path, http://localhost, and http://[::1].
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

PLUGIN="e2e-nat71"
SUB_W="e2e71app"
POLICY_ID="e2e-apphost-71"
REMOTE_DIR="/var/tmp/e2e-71-app-plugin"
LOCAL_TMP=""
CLEAN_PLUGINS="${PLUGIN}"
CLEAN_ROUTES="${PLUGIN}"
PURGE_PACKAGES=""
# A username that reached an OIDC client is never given out again: per run.
USER_TAG="$(date +%s)"
USER_TAG="${USER_TAG: -6}"
PERSON="e2e71-person-${USER_TAG}"
# A test credential for this run only, never printed
PERSON_PASSWORD="E2e-$(openssl rand -hex 12)"
JAR="/tmp/e2e-71-person.cookies"
SLUG_DESK="e2e71desk"
SLUG_MOBILE="e2e71mobile"
SLUG_DESK_2="e2e71desk2"
CLIENT_DESK="lamaste-native-${SLUG_DESK}"
CLIENT_MOBILE="lamaste-native-${SLUG_MOBILE}"
LOOPBACK_PATH="/callback"
IOS_TEAM="E2ETEAM071"
IOS_BUNDLE="com.example.e2edesk"
# The listener on the visitor VM: its script, the port it bound, what it received
LISTENER="/tmp/e2e-71-listener.py"
LISTENER_PORT_FILE="/tmp/e2e-71-listener.port"
LISTENER_GOT_FILE="/tmp/e2e-71-listener.got"
FQDN=""
SITE_ID=""
PERSON_ID=""

# echo_of <token> — GET /api/<plugin>/app/echo on the site with the bearer:
# its JSON body, then the status on a line of its own
echo_of() {
  local out
  out=$(bearer "$1" - "https://${FQDN}/api/${PLUGIN}/app/echo")
  printf '%s\n%s\n' "$(visit_body "$out")" "$(visit_status "$out")"
}
# echo_refused <token> — 401 invalid_token, the relay's answer to a token no grant holds
echo_refused() {
  local out
  out=$(bearer "$1" - "https://${FQDN}/api/${PLUGIN}/app/echo")
  [ "$(visit_status "$out") $(visit_body "$out" | jq -r '.error' 2>/dev/null)" = "401 invalid_token" ]
}

# in_audience <userId> — the audience holds the user as an active member
in_audience() {
  [ "$(audience_row "${PLUGIN}" "$1" | jq -r '"\(.change.kind) \(.change.member.status)"' 2>/dev/null)" = "upsert active" ]
}

# grant_id_of <client> <device> — the id of that device's grant ("" when none)
grant_id_of() { native_grant_of "$1" "$2" | jq -r '.grantId // empty' 2>/dev/null || true; }

# ship_listener — the desktop app's loopback listener on the visitor VM: it
# binds 127.0.0.1 on port 0 (a free port), writes the port to
# LISTENER_PORT_FILE, answers ONE request with a small page, writes that
# request's path and query to LISTENER_GOT_FILE (0600) and exits — after
# 120 s without a request, too.
ship_listener() {
  local script
  script=$(
    cat <<'LISTENER_EOF'
import os, socket, sys
port_file, got_file = sys.argv[1], sys.argv[2]
s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.bind(("127.0.0.1", 0))
s.listen(1)
s.settimeout(120)
with open(port_file + ".tmp", "w") as f:
    f.write(str(s.getsockname()[1]))
os.replace(port_file + ".tmp", port_file)
try:
    conn, _ = s.accept()
except socket.timeout:
    sys.exit(1)
conn.settimeout(10)
data = b""
while b"\r\n\r\n" not in data and len(data) < 65536:
    chunk = conn.recv(4096)
    if not chunk:
        break
    data += chunk
line = data.split(b"\r\n", 1)[0].decode("latin-1")
parts = line.split(" ")
target = parts[1] if len(parts) >= 2 else ""
fd = os.open(got_file, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
with os.fdopen(fd, "w") as f:
    f.write(target)
body = b"<!doctype html><title>Signed in</title><p>You can close this window."
conn.sendall(b"HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: " + str(len(body)).encode() + b"\r\nConnection: close\r\n\r\n" + body)
conn.close()
s.close()
LISTENER_EOF
  )
  visitor_exec "printf %s $(printf %q "$(printf '%s' "$script" | base64 | tr -d '\n')") | base64 -d > ${LISTENER} && chmod 0600 ${LISTENER}" > /dev/null 2>&1 || true
}

# listener_start — start the listener (detached) and print the port it bound ("" when none)
listener_start() {
  visitor_exec "rm -f ${LISTENER_PORT_FILE} ${LISTENER_GOT_FILE}; pkill -f '[e]2e-71-listener.py' 2>/dev/null || true" > /dev/null 2>&1 || true
  visitor_exec "nohup python3 ${LISTENER} ${LISTENER_PORT_FILE} ${LISTENER_GOT_FILE} &>/dev/null & exit" > /dev/null 2>&1 || true
  local _ port=""
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    port=$(visitor_exec "cat ${LISTENER_PORT_FILE} 2>/dev/null || true" 2>/dev/null | tr -d '\r\n' || true)
    if [[ "$port" =~ ^[0-9]+$ ]]; then break; fi
    port=""
    sleep 1
  done
  echo "$port"
}

# listener_got — the path and query the listener received ("" when none)
listener_got() {
  visitor_exec "cat ${LISTENER_GOT_FILE} 2>/dev/null || true" 2>/dev/null | tr -d '\r\n' || true
}

# desktop_authorize <client> <redirect uri> <state> — the authorization
# request with the person's session and the last pkce_pair's S256
# challenge; consent given when Authelia asks. Prints the final Location
# Authelia answers with ("" when it sends none — a refused redirect is
# answered on the portal, never redirected to).
desktop_authorize() {
  local portal="https://auth.${DOMAIN}" query loc flow body redirect
  query="client_id=$(uri "$1")&response_type=code&redirect_uri=$(uri "$2")&scope=$(uri "${NATIVE_SCOPE}")&state=$(uri "$3")&code_challenge=${PKCE_CHALLENGE}&code_challenge_method=S256"
  loc=$(native_location "${JAR}" "${portal}/api/oidc/authorization?${query}")
  if [[ "$loc" == *"/consent/openid/decision"* ]]; then
    flow=$(url_param "$loc" flow_id)
    body=$(jq -c -n --arg f "$flow" --arg c "$1" '{flow_id: $f, client_id: $c, consent: true, pre_configured: false, claims: []}')
    redirect=$(visitor_exec "curl -sk --max-time 20 -b $(q "${JAR}") -c $(q "${JAR}" -X POST -H 'Content-Type: application/json' -d "$body" "${portal}/api/oidc/consent") || true" 2>/dev/null | jq -r '.data.redirect_uri // empty' 2>/dev/null || true)
    if [ -z "$redirect" ]; then
      echo ""
      return 0
    fi
    loc=$(native_location "${JAR}" "$redirect")
  fi
  echo "$loc"
}

# desktop_sign_in <device> — the whole desktop sign-in: the listener, the
# authorization with redirect_uri http://127.0.0.1:<its port>/callback, the
# browser following Authelia's redirect to the listener, the code the
# listener received exchanged with the same redirect URI. NATIVE_AT and
# NATIVE_RT hold the tokens; DESK_SIGN_IN says how it went ("ok", or what
# failed). Never call it in a command substitution.
DESK_SIGN_IN=""
DESK_PORT=""
DESK_STATE=""
DESK_GOT=""
desktop_sign_in() {
  local loc code
  NATIVE_AT=""
  NATIVE_RT=""
  DESK_GOT=""
  DESK_PORT=$(listener_start)
  if [ -z "${DESK_PORT}" ]; then
    DESK_SIGN_IN="listener did not start"
    return 0
  fi
  DESK_STATE=$(openssl rand -hex 12)
  pkce_pair
  loc=$(desktop_authorize "${CLIENT_DESK}" "http://127.0.0.1:${DESK_PORT}${LOOPBACK_PATH}" "${DESK_STATE}")
  if [[ "$loc" != "http://127.0.0.1:${DESK_PORT}${LOOPBACK_PATH}?"* ]]; then
    DESK_SIGN_IN="authorize ${loc:-no-redirect}"
    return 0
  fi
  # The system browser follows the redirect to the app's listener.
  visitor_exec "curl -s --max-time 20 -o /dev/null $(q "$loc") || true" > /dev/null 2>&1 || true
  DESK_GOT=$(listener_got)
  code=$(url_param "http://127.0.0.1${DESK_GOT}" code)
  if [ -z "$code" ] || [ "$(url_param "http://127.0.0.1${DESK_GOT}" state)" != "${DESK_STATE}" ]; then
    DESK_SIGN_IN="listener got no code with the state"
    return 0
  fi
  native_post /api/oidc/token "grant_type=authorization_code" "code=${code}" \
    "redirect_uri=http://127.0.0.1:${DESK_PORT}${LOOPBACK_PATH}" "client_id=${CLIENT_DESK}" \
    "code_verifier=${PKCE_VERIFIER}" "device_name=$1"
  if [ "$(native_status)" != "200" ]; then
    DESK_SIGN_IN="exchange $(native_status) $(native_field '.error // ""')"
    return 0
  fi
  NATIVE_AT=$(native_field '.access_token // empty')
  NATIVE_RT=$(native_field '.refresh_token // empty')
  DESK_SIGN_IN="ok"
}

# refused_at_authorization <redirect uri> — Authelia sends no code there:
# its Location is not that URI (an error on the portal, or none)
refused_at_authorization() {
  local loc
  pkce_pair
  loc=$(desktop_authorize "${CLIENT_DESK}" "$1" "$(openssl rand -hex 12)")
  if [[ "$loc" == "$1"* ]] || [[ "$loc" == *"code="* ]]; then
    log_info "Authorization for $1 answered: ${loc%%code=*}" >&2
    return 1
  fi
}

begin_test "71 — Native app: a desktop client (Three-VM)"

cleanup() {
  log_info "Cleaning up test resources..."
  native_cleanup "${CLIENT_DESK}" "${CLIENT_MOBILE}" "lamaste-native-${SLUG_DESK_2}"
  drop_plugin_grants "${PLUGIN}"
  timed_exec 60 multipass exec "${VISITOR_VM}" -- sudo bash -c "pkill -f '[e]2e-71-listener.py' 2>/dev/null; rm -f ${JAR} ${LISTENER} ${LISTENER_PORT_FILE} ${LISTENER_GOT_FILE} /tmp/e2e-native-nobody.cookies; sed -i '/${SUB_W}\\./d' /etc/hosts; true" > /dev/null 2>&1
  host_api_delete "users/${PERSON}?erase=true" > /dev/null 2>&1 || true
  nudge_sync
  app_plugin_cleanup
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
log_section "Pre-flight"
# ---------------------------------------------------------------------------

app_plugin_preflight
FQDN="${SUB_W}.${DOMAIN}"
log_info "Hosting agent: ${HOST_AGENT_LABEL}, relay domain ${DOMAIN}, site ${FQDN}"
if agent_has_node_sqlite && visitor_has_oathtool; then
  log_pass "The agent VM's Node.js has node:sqlite and the visitor VM has oathtool"
else
  log_fail "The agent VM needs Node.js with node:sqlite and the visitor VM oathtool"
  end_test
  exit $?
fi
if [ "$(visitor_exec "command -v python3 > /dev/null && echo yes || echo no" 2>/dev/null | tail -n 1)" = "yes" ]; then
  log_pass "The visitor VM has python3 (the desktop app's loopback listener)"
else
  log_fail "The visitor VM has no python3: the desktop app cannot listen"
  end_test
  exit $?
fi
native_cleanup "${CLIENT_DESK}" "${CLIENT_MOBILE}" "lamaste-native-${SLUG_DESK_2}"
host_api_delete "plugins/${PLUGIN}/web-surface" > /dev/null 2>&1 || true
drop_plugin_grants "${PLUGIN}"
host_api_delete "users/${PERSON}?erase=true" > /dev/null 2>&1 || true
AUDIT_BASE=$(host_api_get "audit?limit=1" | jq '.entries[0].id // 0' 2>/dev/null || echo "0")

# ===========================================================================
# 1. The plugin's site and a desktop client
# ===========================================================================

log_section "The plugin's site and a desktop client"

LOCAL_TMP=$(mktemp -d /tmp/e2e-71-app-plugin-XXXXXXXX)
if ! write_app_install_fixture "${LOCAL_TMP}/ship/fixtures/v1" "${PLUGIN}" 1.0.0 main "r$(date +%s)-$$" '[]' none wide v1 "${SUB_W}"; then
  log_fail "The fixtures could not be built (npm install at the workspace root, npm run build -w packages/core/lib)"
  end_test
  exit $?
fi
ship_agent_facts_probe
start_stand_in_feria fixtures/v1/server fixtures/v1/agent
ensure_app_host_helper
open_push_install "${POLICY_ID}" "[\"@lamalibre/${PLUGIN}-agent\"]" '["install","uninstall"]'
ship_listener

RESP=$(users_call POST "users" "{\"username\":\"${PERSON}\",\"displayname\":\"E2E Person\",\"email\":\"${PERSON}@example.test\",\"password\":\"${PERSON_PASSWORD}\",\"groups\":[]}")
assert_eq "$(status_of "$RESP")" "201" "User ${PERSON} created" || true
PERSON_ID=$(json_get "$(body_of "$RESP")" '.user.userId // empty')
INSTALL=$(install_approved "${PLUGIN}" "@lamalibre/${PLUGIN}-server@1.0.0")
assert_json_field "$INSTALL" '.plugin.version' '1.0.0' "Installed and approved: ${PLUGIN}" || true
RESP=$(host_api_call POST "plugins/${PLUGIN}/web-surface" '{"accessMode":"authenticated"}')
assert_eq "$(status_of "$RESP")" "201" "Its web surface created on ${FQDN}" || true
SITE_ID=$(json_get "$(body_of "$RESP")" '.webSurface.site.id // empty')
OP=$(host_plugin "${PLUGIN}" 300 nudge)
assert_json_field "$OP" '.status' 'succeeded' "Hosted on ${HOST_AGENT_LABEL} ($(json_get "$OP" '.error // .refused.error // ""'))" || true
if wait_for 120 identity_ready "${PLUGIN}" && wait_for 120 web_served "${PLUGIN}"; then
  log_pass "Ready and served"
else
  log_fail "Not ready or not served: $(identity_view "${PLUGIN}" | jq -c '.readiness') $(web_surface "${PLUGIN}" | jq -c '{served, reason}')"
fi

BODY=$(jq -c -n --arg slug "${SLUG_DESK}" --arg id "${SITE_ID}" --arg path "${LOOPBACK_PATH}" \
  '{kind: "desktop", slug: $slug, hostKind: "site", hostId: $id, name: "E2E Desktop App", loopbackPaths: [$path], idleDays: 60, absoluteDays: 365}')
RESP=$(host_api_call POST "native-apps" "$BODY")
assert_eq "$(status_of "$RESP")" "201" "POST /api/native-apps: ${CLIENT_DESK}, kind desktop, for the site" || true
CLIENT=$(json_get "$(body_of "$RESP")" '.client')
assert_json_field "$CLIENT" '"\(.clientId) \(.kind) \(.served) \(.audience)"' "${CLIENT_DESK} desktop true https://${FQDN}" "…kind desktop, served, its audience the host's origin" || true
assert_json_field "$CLIENT" '"\(.loopbackPaths | join(",")) \(.redirectUris | join(","))"' "${LOOPBACK_PATH} http://127.0.0.1${LOOPBACK_PATH}" "…its redirect URI on the device's loopback, without a port" || true
assert_json_field "$CLIENT" '"\(.redirectPaths | length) \(.associations | length)"' "0 0" "…no redirect path on the host, no associations" || true
assert_json_field "$CLIENT" '"\(.idleDays) \(.absoluteDays)"' "60 365" "…60 days idle, 365 days absolute (an unattended device)" || true
assert_eq "$(native_audits native-app.created ".clientId == \"${CLIENT_DESK}\" and .kind == \"desktop\"")" "1" "Audited: native-app.created, kind desktop" || true

RESP=$(host_api_call POST "native-apps" "{\"kind\":\"desktop\",\"slug\":\"e2e71bad\",\"hostKind\":\"site\",\"hostId\":\"${SITE_ID}\",\"name\":\"Bad\",\"loopbackPaths\":[\"/cb\"],\"redirectPaths\":[\"/cb\"]}")
assert_eq "$(status_of "$RESP")" "400" "A desktop client with a mobile client's redirectPaths: 400" || true

RESP=$(host_api_call PATCH "native-apps/${CLIENT_DESK}" '{"kind":"mobile"}')
assert_eq "$(status_of "$RESP")" "400" "PATCH changing its kind: 400" || true

if wait_for 120 native_client_known "${CLIENT_DESK}" "${FQDN}"; then
  log_pass "Authelia knows the desktop client (rendered, Authelia restarted)"
else
  log_fail "Authelia does not know ${CLIENT_DESK}"
fi
RENDERED=$(host_exec "${AUTHELIA_CONFIG_JSON}" 2>/dev/null | jq -c --arg id "${CLIENT_DESK}" '[.identity_providers.oidc.clients[]? | select(.client_id == $id)] | first // {}' 2>/dev/null || echo '{}')
assert_json_field "$RENDERED" '.redirect_uris | join(",")' "http://127.0.0.1${LOOPBACK_PATH}" "Authelia's client: redirect URI http://127.0.0.1${LOOPBACK_PATH}" || true
assert_json_field "$RENDERED" '"\(.public) \(.require_pkce) \(.pkce_challenge_method) \(.token_endpoint_auth_method)"' "true true S256 none" "…public, PKCE required, S256 only" || true
assert_json_field "$RENDERED" '"\(.audience | join(",")) \(.requested_audience_mode)"' "https://${FQDN} implicit" "…the host's audience, granted implicitly" || true

visitor_exec "grep -q ' ${FQDN}\$' /etc/hosts || echo '${HOST_IP} ${FQDN}' >> /etc/hosts" > /dev/null 2>&1 || true
assert_not_eq "$(visit_status "$(visit - "https://${FQDN}/.well-known/apple-app-site-association")")" "200" "No apple-app-site-association on the host: a desktop client claims nothing there" || true
assert_not_eq "$(visit_status "$(visit - "https://${FQDN}/.well-known/assetlinks.json")")" "200" "…no assetlinks.json" || true
assert_not_eq "$(visit_status "$(visit - "https://${FQDN}${LOOPBACK_PATH}?code=e2e71&state=e2e")")" "200" "…and no redirect page at ${LOOPBACK_PATH} without a session" || true

# ===========================================================================
# 2. Sign-in on the device's loopback
# ===========================================================================

log_section "Sign-in: the code on the app's loopback listener"

RESP=$(host_api_call PUT "plugins/${PLUGIN}/entitlements" "{\"principalType\":\"user\",\"principalId\":\"${PERSON}\",\"roles\":[\"viewer\"]}")
assert_eq "$(status_of "$RESP")" "200" "${PERSON} entitled as viewer" || true
if wait_for 30 in_audience "${PERSON_ID}"; then
  log_pass "…an active member of the audience"
else
  log_fail "The audience: $(audience_row "${PLUGIN}" "${PERSON_ID}")"
fi
SECRET=$(reset_totp "${PERSON}")
wait_for_next_totp_window
assert_eq "$(sign_in "${PERSON}" "${PERSON_PASSWORD}" "${SECRET}" "${JAR}" "${FQDN}")" "OK OK" "${PERSON} signed in to Authelia from the visitor VM (the app's system browser)" || true

desktop_sign_in "E2E Workstation"
assert_eq "${DESK_SIGN_IN}" "ok" "Signed in on \"E2E Workstation\": the listener bound 127.0.0.1:${DESK_PORT}" || true
assert_eq "$(url_param "http://127.0.0.1${DESK_GOT}" state)" "${DESK_STATE}" "…the code arrived on that port, at ${LOOPBACK_PATH}, with the app's state" || true
assert_eq "$([[ "${DESK_GOT}" == "${LOOPBACK_PATH}?"* ]] && echo yes || echo no)" "yes" "…the registered path, the port the app chose" || true
AT0="${NATIVE_AT}"
RT0="${NATIVE_RT}"
assert_not_eq "${RT0}" "" "…exchanged at https://auth.${DOMAIN}/api/oidc/token: a refresh token" || true
CLAIMS=$(jwt_part "${AT0}" 1)
assert_json_field "$CLAIMS" '"\(.iss) \(.client_id) \(.preferred_username)"' "https://auth.${DOMAIN} ${CLIENT_DESK} ${PERSON}" "…a JWT access token issued to ${CLIENT_DESK}, for ${PERSON}" || true
assert_json_field "$CLAIMS" "(.aud | if type == \"string\" then [.] else . end | index(\"https://${FQDN}\")) != null" "true" "…its audience the host" || true
GRANT=$(native_grant_of "${CLIENT_DESK}" "E2E Workstation")
assert_json_field "$GRANT" '"\(.userId) \(.endedAt)"' "${PERSON_ID} null" "GET /api/native-apps/${CLIENT_DESK}/grants: the grant of \"E2E Workstation\", live" || true

# The same flow, the code exchanged with another port than the one it was sent to
PORT=$(listener_start)
STATE=$(openssl rand -hex 12)
pkce_pair
LOC=$(desktop_authorize "${CLIENT_DESK}" "http://127.0.0.1:${PORT}${LOOPBACK_PATH}" "${STATE}")
CODE=$(url_param "$LOC" code)
assert_not_eq "${CODE}" "" "A second authorization: a code for port ${PORT}" || true
OTHER_PORT=$((PORT == 65000 ? 64999 : 65000))
native_post /api/oidc/token "grant_type=authorization_code" "code=${CODE}" \
  "redirect_uri=http://127.0.0.1:${OTHER_PORT}${LOOPBACK_PATH}" "client_id=${CLIENT_DESK}" "code_verifier=${PKCE_VERIFIER}"
assert_eq "$(native_status) $(native_field '.error')" "400 invalid_grant" "…exchanged naming port ${OTHER_PORT}: 400 invalid_grant" || true
visitor_exec "pkill -f '[e]2e-71-listener.py' 2>/dev/null || true" > /dev/null 2>&1 || true

# ===========================================================================
# 3. Bearer calls
# ===========================================================================

log_section "Bearer calls: the same user caller"

OUT=$(echo_of "${AT0}")
assert_eq "$(status_of "$OUT")" "200" "GET /api/${PLUGIN}/app/echo with the desktop app's bearer: 200" || true
ECHO=$(body_of "$OUT")
assert_json_field "$ECHO" '"\(.caller.type) \(.caller.username) \(.caller.userId) \(.caller.roles | join(","))"' "user ${PERSON} ${PERSON_ID} viewer" "…the agent half's caller: the user, the directory's id, the roles — as for a phone or a browser" || true
assert_json_field "$ECHO" '"\(.headers.authorization) \(.headers.cookie)"' "null null" "…no Authorization, no Cookie reached it" || true

# ===========================================================================
# 4. Rotation, reuse, revocation from the panel
# ===========================================================================

log_section "Rotation, a spent token reused, a grant revoked from the panel"

native_refresh "${CLIENT_DESK}" "${RT0}"
assert_eq "$(native_status)" "200" "Refreshed: 200" || true
AT1=$(native_field '.access_token // empty')
RT1=$(native_field '.refresh_token // empty')
assert_eq "$([ -n "${RT1}" ] && [ "${RT1}" != "${RT0}" ] && echo rotated || echo same)" "rotated" "…a new refresh token" || true
assert_eq "$(status_of "$(echo_of "${AT1}")")" "200" "…the new access token reaches the plugin" || true
SPENT_AT=${SECONDS}
log_info "Waiting out the grace window of the token just spent (30 s)..."
sleep $((32 - (SECONDS - SPENT_AT)))
native_refresh "${CLIENT_DESK}" "${RT0}"
assert_eq "$(native_status) $(native_field '.error')" "400 invalid_grant" "The spent token after its window: 400 invalid_grant" || true
if wait_for 15 native_grant_ended_as "${CLIENT_DESK}" "E2E Workstation" reuse; then
  log_pass "…the grant ended: reuse"
else
  log_fail "The grant: $(native_grant_of "${CLIENT_DESK}" "E2E Workstation")"
fi
assert_eq "$(echo_refused "${AT1}" && echo refused || echo admitted)" "refused" "Its live access token is refused at once: 401 invalid_token" || true
assert_eq "$(native_audits native-app.grant.reuse-detected ".clientId == \"${CLIENT_DESK}\" and .userId == \"${PERSON_ID}\"")" "1" "Audited once: native-app.grant.reuse-detected" || true

desktop_sign_in "E2E Till"
assert_eq "${DESK_SIGN_IN}" "ok" "Signed in again on \"E2E Till\"" || true
AT_TILL="${NATIVE_AT}"
RT_TILL="${NATIVE_RT}"
assert_eq "$(status_of "$(echo_of "${AT_TILL}")")" "200" "…its access token reaches the plugin" || true
RESP=$(host_api_call DELETE "native-apps/${CLIENT_DESK}/grants/$(grant_id_of "${CLIENT_DESK}" "E2E Till")")
assert_eq "$(status_of "$RESP") $(json_get "$(body_of "$RESP")" '.ended')" "200 1" "DELETE /api/native-apps/${CLIENT_DESK}/grants/<id>: one grant ended" || true
assert_eq "$(native_grant_reason "${CLIENT_DESK}" "E2E Till")" "revoked_by_admin" "…revoked_by_admin" || true
assert_eq "$(echo_refused "${AT_TILL}" && echo refused || echo admitted)" "refused" "…its access token refused at once" || true
native_refresh "${CLIENT_DESK}" "${RT_TILL}"
assert_eq "$(native_status) $(native_field '.error')" "400 invalid_grant" "…its refresh token refused" || true

# ===========================================================================
# 5. A mobile client beside it
# ===========================================================================

log_section "A mobile client beside the desktop client on the same host"

BODY=$(jq -c -n --arg slug "${SLUG_MOBILE}" --arg id "${SITE_ID}" --arg path "${NATIVE_REDIRECT_PATH}" --arg team "${IOS_TEAM}" --arg bundle "${IOS_BUNDLE}" \
  '{slug: $slug, hostKind: "site", hostId: $id, name: "E2E Mobile App", redirectPaths: [$path], associations: {ios: {teamId: $team, bundleIds: [$bundle]}}}')
RESP=$(host_api_call POST "native-apps" "$BODY")
assert_eq "$(status_of "$RESP")" "201" "POST /api/native-apps: ${CLIENT_MOBILE} (no kind: mobile) on the same host" || true
assert_json_field "$(body_of "$RESP")" '"\(.client.kind) \(.client.redirectUris | join(","))"' "mobile https://${FQDN}${NATIVE_REDIRECT_PATH}" "…kind mobile, its redirect URI on the host" || true
RESP=$(host_api_call POST "native-apps" "{\"kind\":\"desktop\",\"slug\":\"${SLUG_DESK_2}\",\"hostKind\":\"site\",\"hostId\":\"${SITE_ID}\",\"name\":\"Second\",\"loopbackPaths\":[\"/other\"]}")
assert_eq "$(status_of "$RESP") $(json_get "$(body_of "$RESP")" '.code')" "409 host_has_client" "A second desktop client on the host: 409 host_has_client" || true
assert_contains "$(json_get "$(body_of "$RESP")" '.error')" "desktop" "…the refusal names the kind" || true

if wait_for 120 native_client_known "${CLIENT_MOBILE}" "${FQDN}"; then
  log_pass "Authelia knows the mobile client too"
  # Adding a client restarts Authelia, whose sessions live in memory: the
  # person signs in to Authelia again, as the app's browser shows.
  assert_eq "$(sign_in "${PERSON}" "${PERSON_PASSWORD}" "${SECRET}" "${JAR}" "${FQDN}")" "OK OK" "${PERSON} signs in to Authelia again (it restarted)" || true
else
  log_fail "Authelia does not know ${CLIENT_MOBILE}"
fi
RESP=$(visit - "https://${FQDN}/.well-known/apple-app-site-association")
assert_eq "$(visit_status "$RESP")" "200" "The mobile client's apple-app-site-association is served now" || true
assert_json_field "$(visit_body "$RESP")" '[.applinks.details[0].components[]?."/"] | join(",")' "${NATIVE_REDIRECT_PATH}" "…claiming its redirect path alone — nothing of the desktop client's" || true

native_sign_in "${JAR}" "${CLIENT_MOBILE}" "${FQDN}" "E2E Phone"
assert_eq "${NATIVE_SIGN_IN}" "ok" "A phone signs in with the mobile client" || true
assert_json_field "$(body_of "$(echo_of "${NATIVE_AT}")")" '"\(.caller.type) \(.caller.username)"' "user ${PERSON}" "…its token reaches the plugin as the same user" || true

desktop_sign_in "E2E Kiosk"
assert_eq "${DESK_SIGN_IN}" "ok" "The desktop client still signs in beside it" || true
assert_eq "$(status_of "$(echo_of "${NATIVE_AT}")")" "200" "…and its token reaches the plugin" || true
assert_eq "$(native_grants "${CLIENT_DESK}" live | jq -r '[.[].deviceName] | sort | join(",")')" "E2E Kiosk" "The desktop client's live grants: \"E2E Kiosk\" alone" || true
assert_eq "$(native_grants "${CLIENT_MOBILE}" live | jq -r '[.[].deviceName] | sort | join(",")')" "E2E Phone" "The mobile client's: \"E2E Phone\" alone — grants are the client's" || true

# ===========================================================================
# 6. Redirects that are not the client's
# ===========================================================================

log_section "Redirects the client does not hold are refused at authorization"

assert_eq "$(refused_at_authorization "http://127.0.0.1:${DESK_PORT:-50000}/other" && echo refused || echo delivered)" "refused" "An unregistered loopback path: no code delivered" || true
assert_eq "$(refused_at_authorization "http://localhost:${DESK_PORT:-50000}${LOOPBACK_PATH}" && echo refused || echo delivered)" "refused" "http://localhost: no code delivered (127.0.0.1 only)" || true
assert_eq "$(refused_at_authorization "http://[::1]:${DESK_PORT:-50000}${LOOPBACK_PATH}" && echo refused || echo delivered)" "refused" "http://[::1]: no code delivered" || true
assert_eq "$(refused_at_authorization "https://${FQDN}${LOOPBACK_PATH}" && echo refused || echo delivered)" "refused" "The path on the host (a mobile client's form): no code delivered" || true

end_test

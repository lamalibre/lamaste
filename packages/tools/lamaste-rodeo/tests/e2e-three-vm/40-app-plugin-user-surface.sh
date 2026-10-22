#!/usr/bin/env bash
# ============================================================================
# 40 — App plugin user surface (Three-VM)
# ============================================================================
# Slice 6's user path: a person signed in to Authelia reaches an
# agent-hosted plugin's /app through the relay. An app plugin whose manifest
# declares identity (fixture @lamalibre/e2e-idsurf-server, helpers.sh:
# write_app_install_fixture … wide — its agent half answers a user caller
# on /app/echo and /app/me) is installed from the panel, and an
# authenticated app tunnel the agent VM carries — its own backend a static
# server there — is bound as the plugin's user surface. From the visitor VM:
#
# 1. Binding refusals: a route no plugin holds, a public tunnel, a second
#    tunnel for the same route (409); a bound tunnel cannot be made public.
# 2. Bound but not approved, the host serves no user-surface location:
#    /api/<route>/app/echo goes down the tunnel to its own backend, and
#    without a session Authelia's redirect answers, as for any page of it.
# 3. Approved: the location is there — without a session a JSON 401, never
#    a redirect; not hosted yet, a 503. Hosted, once its agent half answered
#    protocol 1: a signed-in user without a role in the plugin gets 403;
#    with the viewer role, /app/echo answers with the caller the panel
#    signed — the directory's userId, the username, the roles — and
#    /app/me with what the agent half's projection holds of them.
# 4. What a browser cannot do: change something without the bound host's
#    Origin (no Origin, a foreign one: 403; the bound one: forwarded); get
#    the application's Set-Cookie; pass its own X-Lamalibre-Relay-Assertion,
#    Remote-User or X-Lamalibre-Caller for the relay's; replay what
#    Gatekeeper vouched (an assertion taken from Gatekeeper on the host VM
#    with the visitor's cookie, sent twice to the panel's loopback
#    listener: the second is 401); reach a path with dot segments or
#    encoded separators (403/400 — the agent half never sees one).
# 5. A restricted tunnel lets through only a user with a grant for it.
# 6. Unbound, the location is gone: the request reaches the tunnel's own
#    backend again; bound again, it is served again.
# 7. A user disabled while an assertion Gatekeeper gave for them is still
#    valid: the panel refuses it at once (403, disabled).
#
# Every write of users.yml restarts Authelia and ends every session: both
# users are created before anyone signs in, and disabling one is the last
# step. The identity feed itself is spec 39.
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

PLUGIN="e2e-idsurf"
SERVER_PACKAGE="@lamalibre/e2e-idsurf-server"
AGENT_PACKAGE="@lamalibre/e2e-idsurf-agent"
APP="/api/${PLUGIN}/app"
POLICY_ID="e2e-apphost-40"
REMOTE_DIR="/var/tmp/e2e-40-app-plugin"
LOCAL_TMP=""
CLEAN_PLUGINS="${PLUGIN}"
CLEAN_ROUTES="${PLUGIN}"
PURGE_PACKAGES=""
VISITOR_VM="lamaste-visitor"
VIEWER="e2e40-viewer"
NOROLE="e2e40-norole"
# Test credentials for this run only, never printed
VIEWER_PASSWORD="E2e-$(openssl rand -hex 12)"
NOROLE_PASSWORD="E2e-$(openssl rand -hex 12)"
JAR_VIEWER="/tmp/e2e-40-viewer.cookies"
JAR_NOROLE="/tmp/e2e-40-norole.cookies"
# The bound tunnel (A), a public one (P) and a second authenticated one (S)
SUB_A="e2e40us"
SUB_P="e2e40pub"
SUB_S="e2e40two"
PORT_A=18440
PORT_P=18441
PORT_S=18442
TUNNEL_A=""
TUNNEL_P=""
TUNNEL_S=""
FQDN=""
ORIGIN=""
BACKEND_UNIT="e2e-40-backend"
BACKEND_DIR="/var/tmp/e2e-40-backend"
MARKER="E2E_40_TUNNEL_BACKEND_$(date +%s)"
VIEWER_ID=""
NOROLE_ID=""
TUNNEL_GRANT_ID=""

# ---------------------------------------------------------------------------
# The visitor VM
# ---------------------------------------------------------------------------

visitor_exec() { multipass exec "${VISITOR_VM}" -- sudo bash -c "$1"; }

# q <arguments...> — each quoted for the remote shell (printf %q), joined by spaces
q() {
  local out="" a
  for a in "$@"; do out="${out} $(printf %q "$a")"; done
  printf '%s' "${out# }"
}

# visit <cookie jar | -> <curl arguments...> — one request from the visitor
# VM: the response headers, a blank line, the body, then the HTTP status on
# a line of its own (visit_status, visit_headers, visit_body split them)
visit() {
  local jar="$1" cookies=""
  shift
  if [ "$jar" != "-" ]; then cookies="-b $(printf %q "$jar")"; fi
  visitor_exec "curl -sk --max-time 20 -D - -w '\n%{http_code}' ${cookies} $(q "$@") || true" 2>/dev/null || echo "000"
}
visit_status() { printf '%s\n' "$1" | tail -n 1; }
# Read to the end (no early exit): under pipefail the writer must not die of SIGPIPE.
visit_headers() { printf '%s\n' "$1" | sed '$d' | tr -d '\r' | awk 'f == 0 && /^$/ {f = 1} f == 0 {print}'; }
visit_body() { printf '%s\n' "$1" | sed '$d' | tr -d '\r' | awk 'f == 1 {print} f == 0 && /^$/ {f = 1}'; }

# viewer_echo_status — the HTTP status of the viewer's GET /api/<route>/app/echo
viewer_echo_status() { visit_status "$(visit "${JAR_VIEWER}" "https://${FQDN}${APP}/echo")"; }
viewer_gets() { [ "$(viewer_echo_status)" = "$1" ]; }
# anonymous_gets <status> — the same without a session
anonymous_gets() { [ "$(visit_status "$(visit - "https://${FQDN}${APP}/echo")")" = "$1" ]; }

# reset_totp <username> — a fresh TOTP secret for the user (the panel's
# reset, as the admin); prints the base32 secret
reset_totp() {
  host_api_post "users/$1/reset-totp" '{}' 2>/dev/null | jq -r '.totpUri // empty' 2>/dev/null | sed -n 's/.*secret=\([A-Z2-7]*\).*/\1/p' || true
}

# sign_in <username> <password> <totp secret> <cookie jar> — Authelia's two
# factors from the visitor VM into <jar>; prints "<first> <second>" (OK OK)
sign_in() {
  local body first code second
  visitor_exec "rm -f $(printf %q "$4")" > /dev/null 2>&1 || true
  body=$(jq -c -n --arg u "$1" --arg p "$2" --arg t "https://${FQDN}/" '{username: $u, password: $p, keepMeLoggedIn: false, targetURL: $t}')
  first=$(visitor_exec "curl -sk --max-time 15 -c $(q "$4" -X POST -H 'Content-Type: application/json' -d "$body" "https://auth.${DOMAIN}/api/firstfactor") || true" 2>/dev/null | jq -r '.status // "none"' 2>/dev/null || true)
  code=$(visitor_exec "oathtool --totp --base32 $(printf %q "$3")" 2>/dev/null | tail -n 1 || true)
  body=$(jq -c -n --arg c "$code" --arg t "https://${FQDN}/" '{token: $c, targetURL: $t}')
  second=$(visitor_exec "curl -sk --max-time 15 -b $(q "$4") -c $(q "$4" -X POST -H 'Content-Type: application/json' -d "$body" "https://auth.${DOMAIN}/api/secondfactor/totp") || true" 2>/dev/null | jq -r '.status // "none"' 2>/dev/null || true)
  echo "${first:-none} ${second:-none}"
}

# sign_in_both — both users, after one wait into a fresh TOTP window (a code
# already used in the current one is refused); logs the outcome
sign_in_both() {
  local secret_v secret_n
  secret_v=$(reset_totp "${VIEWER}")
  secret_n=$(reset_totp "${NOROLE}")
  if [ -z "$secret_v" ] || [ -z "$secret_n" ]; then
    log_fail "The TOTP secrets could not be reset"
    return 0
  fi
  wait_for_next_totp_window
  assert_eq "$(sign_in "${VIEWER}" "${VIEWER_PASSWORD}" "${secret_v}" "${JAR_VIEWER}")" "OK OK" "${VIEWER} signed in from the visitor VM (password, TOTP)" || true
  assert_eq "$(sign_in "${NOROLE}" "${NOROLE_PASSWORD}" "${secret_n}" "${JAR_NOROLE}")" "OK OK" "${NOROLE} signed in from the visitor VM" || true
}

# session_cookie <jar> — the authelia_session cookie in a visitor's jar
session_cookie() {
  # shellcheck disable=SC2016 # an awk program, for the remote shell to pass on as it is
  visitor_exec "awk $(printf %q '$6 == "authelia_session" {print $7}') $(printf %q "$1") || true" 2>/dev/null | tail -n 1 || true
}

# gatekeeper_assertion <method> <path> <cookie> — on the host VM, what
# Gatekeeper answers nginx's user-surface subrequest for this request with
# the session's cookie: its X-Lamalibre-Relay-Assertion ("" when none)
gatekeeper_assertion() {
  host_exec "curl -s --max-time 10 -o /dev/null -D - $(q -H "Host: ${FQDN}" -H "X-Original-URL: https://${FQDN}$2" -H "X-Original-Method: $1" -H "Cookie: authelia_session=$3" "http://127.0.0.1:9294/authz/user-surface/${FQDN}") || true" 2>/dev/null |
    tr -d '\r' | awk -F': ' 'tolower($1) == "x-lamalibre-relay-assertion" {v = $2} END {print v}' || true
}

# panel_direct <method> <path> <assertion> — the request as nginx passes it,
# sent to the panel's loopback listener on the host VM: the body, then the status
panel_direct() {
  host_exec "curl -s --max-time 15 -X $1 -w '\n%{http_code}' $(q -H "X-Lamalibre-Relay-Assertion: $3" "http://127.0.0.1:3100$2") || true" 2>/dev/null || echo "000"
}

# tunnel_entry <id> — the tunnel as GET /api/tunnels lists it ('null' when gone)
tunnel_entry() {
  host_api_get "tunnels?limit=500" 2>/dev/null | jq -c --arg id "$1" '[.tunnels[]? | select(.id == $id)] | first // null' 2>/dev/null || echo "null"
}

# backend_reachable — the bound tunnel's own backend answers through chisel
backend_reachable() {
  [ "$(host_exec "curl -s --max-time 3 http://127.0.0.1:${PORT_A}${APP}/echo || true" 2>/dev/null | tr -d '\r\n')" = "${MARKER}" ]
}

health_up() { [ "$(hosting_field "${PLUGIN}" '.hosting.health.state')" = "up" ]; }

# viewer_in_audience — the audience holds the viewer as an active member
viewer_in_audience() {
  [ "$(audience_row "${PLUGIN}" "${VIEWER_ID}" | jq -r '"\(.change.kind) \(.change.member.status)"' 2>/dev/null)" = "upsert active" ]
}

begin_test "40 — App plugin user surface (Three-VM)"

cleanup() {
  log_info "Cleaning up test resources..."
  local id
  if [ -n "${TUNNEL_GRANT_ID}" ]; then host_api_delete "gatekeeper/grants/${TUNNEL_GRANT_ID}" > /dev/null 2>&1 || true; fi
  # Gatekeeper's grants outlive the plugin.
  drop_plugin_grants "${PLUGIN}"
  for id in ${TUNNEL_A} ${TUNNEL_P} ${TUNNEL_S}; do
    host_api_delete "tunnels/${id}" > /dev/null 2>&1 || true
  done
  timed_exec 60 multipass exec "${AGENT_VM}" -- sudo bash -c "systemctl stop ${BACKEND_UNIT} > /dev/null 2>&1; rm -rf ${BACKEND_DIR}; sed -i '/${SUB_A}\\./d' /etc/hosts; true" > /dev/null 2>&1
  timed_exec 60 multipass exec "${VISITOR_VM}" -- sudo bash -c "rm -f ${JAR_VIEWER} ${JAR_NOROLE}; sed -i '/${SUB_A}\\./d' /etc/hosts; true" > /dev/null 2>&1
  for id in "${VIEWER}" "${NOROLE}"; do
    host_api_delete "users/${id}?erase=true" > /dev/null 2>&1 || true
  done
  for id in ${VIEWER_ID} ${NOROLE_ID}; do
    host_api_post "identity/directory/${id}/erase" '{}' > /dev/null 2>&1 || true
  done
  nudge_sync
  app_plugin_cleanup
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
log_section "Pre-flight"
# ---------------------------------------------------------------------------

app_plugin_preflight
FQDN="${SUB_A}.${DOMAIN}"
ORIGIN="https://${FQDN}"
log_info "Hosting agent: ${HOST_AGENT_LABEL} (local name ${AGENT_LABEL}), relay domain ${DOMAIN}, bound host ${FQDN}"
if agent_has_node_sqlite; then
  log_pass "The agent VM's Node.js has node:sqlite, which the agent half's projection needs"
else
  log_fail "The agent VM's Node.js has no unflagged node:sqlite (Node.js 22.13 or later): the identity fixture cannot run"
  end_test
  exit $?
fi
if [ "$(visitor_exec "command -v oathtool > /dev/null && echo yes || echo no" 2>/dev/null | tail -n 1)" = "yes" ]; then
  log_pass "The visitor VM has oathtool (Authelia's second factor)"
else
  log_fail "The visitor VM has no oathtool: no one can sign in to reach the user surface"
  end_test
  exit $?
fi
# Leftovers of an interrupted run (rodeo ends a spec at ten minutes without its trap)
drop_plugin_grants "${PLUGIN}"
for user in "${VIEWER}" "${NOROLE}"; do
  host_api_delete "users/${user}?erase=true" > /dev/null 2>&1 || true
done

# ===========================================================================
# 1. Fixtures, users, the plugin installed
# ===========================================================================

log_section "Fixtures, the stand-in Feria, the users; the plugin installed, not approved"

LOCAL_TMP=$(mktemp -d /tmp/e2e-40-app-plugin-XXXXXXXX)
if ! write_app_install_fixture "${LOCAL_TMP}/ship/fixtures/surf" "${PLUGIN}" 1.0.0 main "r$(date +%s)-$$" '[]' none wide; then
  log_fail "The fixture could not be built (npm install at the workspace root, npm run build -w packages/core/lib)"
  end_test
  exit $?
fi
log_pass "Fixture built: ${SERVER_PACKAGE} (identity: viewer, editor; displayName, email) and its agent package"
ship_agent_facts_probe
start_stand_in_feria fixtures/surf/server fixtures/surf/agent
ensure_app_host_helper
open_push_install "${POLICY_ID}" "[\"${AGENT_PACKAGE}\"]" '["install","uninstall"]'

# Every users.yml write of the spec, before anyone signs in.
RESP=$(users_call POST "users" "{\"username\":\"${VIEWER}\",\"displayname\":\"E2E Viewer\",\"email\":\"${VIEWER}@example.test\",\"password\":\"${VIEWER_PASSWORD}\",\"groups\":[]}")
assert_eq "$(status_of "$RESP")" "201" "User ${VIEWER} created" || true
VIEWER_ID=$(json_get "$(body_of "$RESP")" '.user.userId // empty')
RESP=$(users_call POST "users" "{\"username\":\"${NOROLE}\",\"displayname\":\"E2E No Role\",\"email\":\"${NOROLE}@example.test\",\"password\":\"${NOROLE_PASSWORD}\",\"groups\":[]}")
assert_eq "$(status_of "$RESP")" "201" "User ${NOROLE} created — to hold no role in the plugin" || true
NOROLE_ID=$(json_get "$(body_of "$RESP")" '.user.userId // empty')
assert_eq "$(is_uuid "${VIEWER_ID}") $(is_uuid "${NOROLE_ID}")" "true true" "Both have a directory id" || true

INSTALL=$(host_api_post "plugins/install" "{\"packageName\":\"${SERVER_PACKAGE}@1.0.0\"}")
assert_json_field "$INSTALL" '.plugin.version' '1.0.0' "Installed ${SERVER_PACKAGE}@1.0.0" || true
assert_json_field "$INSTALL" '"\(.hooks.identity.declared) \(.hooks.identity.approved) \(.hooks.approval.state)"' 'true false pending' "…its identity block waits for approval" || true
DIGEST=$(json_get "$INSTALL" '.hooks.approval.digest // empty')
RESP=$(host_api_call POST "plugins/${PLUGIN}/hosting" "{\"agentLabel\":\"${HOST_AGENT_LABEL}\"}")
assert_eq "$(status_of "$RESP")" "409" "Hosting it is refused until it is approved (409)" || true
assert_json_field "$(body_of "$RESP")" '.code' 'hooks_not_approved' "…hooks_not_approved" || true

# ===========================================================================
# 2. The tunnels; the bound one's own backend
# ===========================================================================

log_section "An authenticated app tunnel with its own backend, and two others"

RESP=$(host_api_post "tunnels" "{\"subdomain\":\"${SUB_A}\",\"port\":${PORT_A},\"accessMode\":\"authenticated\",\"agentLabel\":\"${HOST_AGENT_LABEL}\"}")
TUNNEL_A=$(json_get "$RESP" '.tunnel.id // empty')
assert_json_field "$RESP" '"\(.tunnel.fqdn) \(.tunnel.accessMode) \(.tunnel.agentLabel)"' "${FQDN} authenticated ${HOST_AGENT_LABEL}" "Tunnel ${FQDN}: authenticated, carried by ${HOST_AGENT_LABEL}" || true
RESP=$(host_api_post "tunnels" "{\"subdomain\":\"${SUB_P}\",\"port\":${PORT_P},\"accessMode\":\"public\",\"agentLabel\":\"${HOST_AGENT_LABEL}\"}")
TUNNEL_P=$(json_get "$RESP" '.tunnel.id // empty')
assert_json_field "$RESP" '.tunnel.accessMode' 'public' "Tunnel ${SUB_P}: public" || true
RESP=$(host_api_post "tunnels" "{\"subdomain\":\"${SUB_S}\",\"port\":${PORT_S},\"accessMode\":\"authenticated\",\"agentLabel\":\"${HOST_AGENT_LABEL}\"}")
TUNNEL_S=$(json_get "$RESP" '.tunnel.id // empty')
assert_json_field "$RESP" '.tunnel.accessMode' 'authenticated' "Tunnel ${SUB_S}: authenticated" || true

agent_exec "grep -q 'tunnel.${DOMAIN}' /etc/hosts || echo '${HOST_IP} tunnel.${DOMAIN}' >> /etc/hosts" > /dev/null 2>&1 || true
visitor_exec "grep -q '${FQDN}' /etc/hosts || echo '${HOST_IP} ${FQDN}' >> /etc/hosts" > /dev/null 2>&1 || true
agent_exec "systemctl stop ${BACKEND_UNIT} > /dev/null 2>&1; rm -rf ${BACKEND_DIR} && mkdir -p ${BACKEND_DIR}${APP} && printf '%s\n' ${MARKER} > ${BACKEND_DIR}${APP}/echo && chmod -R a+rX ${BACKEND_DIR}" > /dev/null 2>&1 || true
agent_exec "systemd-run --quiet --collect --unit ${BACKEND_UNIT} --uid=nobody --gid=nogroup python3 -m http.server ${PORT_A} --bind 127.0.0.1 --directory ${BACKEND_DIR}" > /dev/null 2>&1 || true
nudge_sync
if wait_for 120 backend_reachable; then
  log_pass "The tunnel's own backend answers through chisel (${APP}/echo is a file of it)"
else
  log_fail "The tunnel's backend is not reachable through chisel on the host VM's port ${PORT_A}"
fi

# ===========================================================================
# 3. Binding, and what is refused
# ===========================================================================

log_section "Bound as the plugin's user surface; the refusals"

RESP=$(host_api_call PUT "tunnels/${TUNNEL_A}/user-surface" '{"route":"e2e-no-such-plugin"}')
assert_eq "$(status_of "$RESP")" "400" "A route no installed plugin holds cannot be bound (400)" || true
RESP=$(host_api_call PUT "tunnels/${TUNNEL_A}/user-surface" "{\"route\":\"${PLUGIN}\"}")
assert_eq "$(status_of "$RESP")" "200" "PUT /api/tunnels/${TUNNEL_A}/user-surface {route: ${PLUGIN}}" || true
BOUND=$(body_of "$RESP")
assert_json_field "$BOUND" '"\(.changed) \(.tunnel.userSurface.routes | join(","))"' "true ${PLUGIN}" "…bound" || true
assert_json_field "$BOUND" '.tunnel.userSurfaceStatus[0] | "\(.route) \(.served) \(.reason)"' "${PLUGIN} false not_approved" "…not served yet: its identity is not approved" || true
assert_json_field "$(body_of "$(host_api_call PUT "tunnels/${TUNNEL_A}/user-surface" "{\"route\":\"${PLUGIN}\"}")")" '.changed' 'false' "Binding it again changes nothing" || true
RESP=$(host_api_call PUT "tunnels/${TUNNEL_P}/user-surface" "{\"route\":\"${PLUGIN}\"}")
assert_eq "$(status_of "$RESP")" "400" "A public tunnel cannot be bound (400)" || true
assert_contains "$(json_get "$(body_of "$RESP")" '.error')" "public" "…$(json_get "$(body_of "$RESP")" '.error')" || true
RESP=$(host_api_call PUT "tunnels/${TUNNEL_S}/user-surface" "{\"route\":\"${PLUGIN}\"}")
assert_eq "$(status_of "$RESP")" "409" "A second tunnel for the same route is refused (409)" || true
assert_json_field "$(body_of "$RESP")" '.code' 'user_surface_conflict' "…user_surface_conflict" || true
RESP=$(host_api_call PATCH "tunnels/${TUNNEL_A}" '{"accessMode":"public"}')
assert_eq "$(status_of "$RESP")" "409" "The bound tunnel cannot be made public (409)" || true
assert_json_field "$(tunnel_entry "${TUNNEL_A}")" '.accessMode' 'authenticated' "…it stays authenticated" || true

# ===========================================================================
# 4. Before approval: the tunnel's own backend
# ===========================================================================

log_section "Bound, not approved: requests go down the tunnel as before"

RESP=$(visit - "https://${FQDN}${APP}/echo")
assert_eq "$(visit_status "$RESP")" "302" "Without a session: Authelia's redirect, as for any page of the tunnel" || true
assert_contains "$(visit_headers "$RESP")" "auth.${DOMAIN}" "…to the sign-in portal" || true

sign_in_both
RESP=$(visit "${JAR_VIEWER}" "https://${FQDN}${APP}/echo")
assert_eq "$(visit_status "$RESP")" "200" "Signed in: 200" || true
assert_contains "$(visit_body "$RESP")" "${MARKER}" "…from the tunnel's own backend: no user-surface location yet" || true

# ===========================================================================
# 5. Approved, hosted, ready
# ===========================================================================

log_section "Approved: the location is there; hosted, its users are let through"

APPROVED=$(host_api_post "plugins/${PLUGIN}/hooks/approve" "{\"digest\":\"${DIGEST}\"}")
assert_json_field "$APPROVED" '"\(.hooks.approval.state) \(.hooks.identity.approved)"' 'approved true' "Approved: its agent half and identity block" || true
host_api_post "plugins/${PLUGIN}/enable" '{}' > /dev/null
assert_json_field "$(tunnel_entry "${TUNNEL_A}")" '.userSurfaceStatus[0] | "\(.served) \(.reason)"' 'true null' "The bound host serves ${APP} now" || true
if wait_for 30 anonymous_gets 401; then
  log_pass "Without a session: 401"
else
  log_fail "Without a session: $(visit_status "$(visit - "https://${FQDN}${APP}/echo")")"
fi
RESP=$(visit - "https://${FQDN}${APP}/echo")
assert_json_field "$(visit_body "$RESP")" '.error' 'unauthenticated' "…JSON (unauthenticated) for the application to act on" || true
assert_not_contains "$(visit_headers "$RESP" | tr '[:upper:]' '[:lower:]')" "location:" "…never a redirect" || true
RESP=$(visit "${JAR_VIEWER}" "https://${FQDN}${APP}/echo")
assert_eq "$(visit_status "$RESP")" "503" "Signed in, the plugin not hosted yet: 503" || true
assert_not_contains "$(visit_body "$RESP")" "${MARKER}" "…the tunnel's backend is no longer asked" || true

OP=$(host_plugin "${PLUGIN}" 300 nudge)
assert_json_field "$OP" '.status' 'succeeded' "Hosted on ${HOST_AGENT_LABEL} ($(json_get "$OP" '.error // .refused.error // ""'))" || true
if wait_for 60 health_up; then
  log_pass "The relay's health of the hosting is up"
else
  log_fail "Health: $(hosting_field "${PLUGIN}" '.hosting.health')"
fi
if wait_for 120 identity_ready "${PLUGIN}"; then
  log_pass "Ready: its agent half answered protocol 1"
else
  log_fail "Not ready: $(identity_view "${PLUGIN}" | jq -c '.readiness')"
fi
if [ "$(viewer_echo_status)" = "401" ]; then
  # Something restarted Authelia since (a users.yml write would): sign in again.
  log_info "The sessions ended while the plugin was hosted — signing in again"
  sign_in_both
fi
RESP=$(visit "${JAR_VIEWER}" "https://${FQDN}${APP}/echo")
assert_eq "$(visit_status "$RESP")" "403" "${VIEWER}, before any entitlement: 403" || true
assert_json_field "$(visit_body "$RESP")" '.error' 'This user may not use this plugin' "…not entitled" || true

RESP=$(host_api_call PUT "plugins/${PLUGIN}/entitlements" "{\"principalType\":\"user\",\"principalId\":\"${VIEWER}\",\"roles\":[\"viewer\"]}")
assert_eq "$(status_of "$RESP")" "200" "${VIEWER} entitled as viewer" || true
if wait_for 30 viewer_in_audience; then
  log_pass "…an active member of the audience"
else
  log_fail "The audience: $(audience_row "${PLUGIN}" "${VIEWER_ID}")"
fi

# ===========================================================================
# 6. The user surface
# ===========================================================================

log_section "Signed in with a role: the agent half sees the directory's user"

RESP=$(visit "${JAR_VIEWER}" "https://${FQDN}${APP}/echo")
assert_eq "$(visit_status "$RESP")" "200" "GET ${APP}/echo as ${VIEWER}: 200" || true
ECHO=$(visit_body "$RESP")
assert_json_field "$ECHO" '"\(.caller.type) \(.caller.userId) \(.caller.username) \(.caller.roles | join(","))"' "user ${VIEWER_ID} ${VIEWER} viewer" "The caller the panel signed: user, the directory's id, the username, the roles" || true
assert_json_field "$ECHO" '"\(.path) \(.method)"' '/app/echo GET' "…for the agent half's /app/echo" || true
HEADERS=$(visit_headers "$RESP" | tr '[:upper:]' '[:lower:]')
assert_not_contains "$HEADERS" "app-session" "The application's Set-Cookie never reaches the browser" || true
assert_not_contains "$HEADERS" "x-lamalibre-" "…nor any X-Lamalibre-* header (the responder signature is the relay's)" || true
if wait_for 60 projection_has "${PLUGIN}" "[.users[] | select(.userId == \"${VIEWER_ID}\" and .status == \"active\")] | length == 1"; then
  log_pass "The agent half's projection holds ${VIEWER} (the feed delivered the entitlement)"
else
  log_fail "The projection: $(projected_user "${PLUGIN}" "${VIEWER_ID}")"
fi
ME=$(visit_body "$(visit "${JAR_VIEWER}" "https://${FQDN}${APP}/me")")
assert_json_field "$ME" '"\(.member.userId) \(.member.displayName) \(.member.email) \(.member.roles | join(","))"' "${VIEWER_ID} E2E Viewer ${VIEWER}@example.test viewer" "GET ${APP}/me: what the agent half's projection holds of them" || true
assert_eq "$(visit_status "$(visit "${JAR_VIEWER}" -X POST -H "Origin: ${ORIGIN}" "https://${FQDN}${APP}/me")")" "405" "POST ${APP}/me: the agent half's own 405, signed, passes" || true
assert_eq "$(visit_status "$(visit "${JAR_VIEWER}" "https://${FQDN}${APP}/nothing")")" "404" "${APP}/nothing: the agent half's own 404" || true

RESP=$(visit "${JAR_NOROLE}" "https://${FQDN}${APP}/echo")
assert_eq "$(visit_status "$RESP")" "403" "${NOROLE}, signed in without a role in the plugin: 403" || true
assert_json_field "$(visit_body "$RESP")" '.error' 'This user may not use this plugin' "…not entitled" || true

log_section "What a browser cannot do"

BODY='{"note":"e2e 40"}'
RESP=$(visit "${JAR_VIEWER}" -X POST -H 'Content-Type: application/json' -d "$BODY" "https://${FQDN}${APP}/echo")
assert_eq "$(visit_status "$RESP")" "403" "POST without an Origin: 403" || true
assert_json_field "$(visit_body "$RESP")" '.error' 'cross-origin request refused' "…cross-origin request refused" || true
assert_eq "$(visit_status "$(visit "${JAR_VIEWER}" -X POST -H 'Origin: https://evil.example.test' -H 'Content-Type: application/json' -d "$BODY" "https://${FQDN}${APP}/echo")")" "403" "POST from a foreign Origin: 403" || true
RESP=$(visit "${JAR_VIEWER}" -X POST -H "Origin: ${ORIGIN}" -H 'Content-Type: application/json' -d "$BODY" "https://${FQDN}${APP}/echo")
assert_eq "$(visit_status "$RESP")" "200" "POST from the bound host's Origin: forwarded" || true
assert_json_field "$(visit_body "$RESP")" '"\(.method) \(.origin) \(.bytes)"' "POST ${ORIGIN} ${#BODY}" "…the agent half got the POST, its Origin and all ${#BODY} bytes" || true

RESP=$(visit "${JAR_VIEWER}" -H 'X-Lamalibre-Relay-Assertion: e2e.forged' -H 'Remote-User: admin' -H 'X-Lamalibre-Caller: e2e.forged' -H 'X-E2E-Marker: e2e-40-marker' "https://${FQDN}${APP}/echo")
assert_eq "$(visit_status "$RESP")" "200" "Sent with its own X-Lamalibre-Relay-Assertion, Remote-User and X-Lamalibre-Caller: 200" || true
ECHO=$(visit_body "$RESP")
assert_json_field "$ECHO" '"\(.caller.username) \(.caller.userId)"' "${VIEWER} ${VIEWER_ID}" "…the caller is still the one Gatekeeper vouched for" || true
assert_json_field "$ECHO" '"\(.headers.remoteUser) \(.headers.relayAssertion)"' 'null null' "…no Remote-User or relay assertion reached the agent half" || true
assert_json_field "$ECHO" '.headers.marker' 'e2e-40-marker' "…while an ordinary header did" || true

COOKIE=$(session_cookie "${JAR_VIEWER}")
assert_not_eq "${COOKIE}" "" "The viewer's session cookie, read from the visitor's jar" || true
ASSERTION=$(gatekeeper_assertion GET "${APP}/echo" "${COOKIE}")
assert_eq "$(echo "${ASSERTION}" | grep -cE '^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$' || true)" "1" "On the host VM, Gatekeeper vouches for that session (/authz/user-surface/${FQDN})" || true
RESP=$(panel_direct GET "${APP}/echo" "${ASSERTION}")
assert_eq "$(status_of "$RESP")" "200" "Its assertion, sent to the panel's listener: 200" || true
assert_json_field "$(body_of "$RESP")" '.caller.userId' "${VIEWER_ID}" "…as ${VIEWER}" || true
RESP=$(panel_direct GET "${APP}/echo" "${ASSERTION}")
assert_eq "$(status_of "$RESP")" "401" "The same assertion again: 401 — replay refused" || true
assert_json_field "$(body_of "$RESP")" '.error' 'unauthenticated' "…unauthenticated" || true
assert_eq "$(status_of "$(panel_direct POST "${APP}/echo" "$(gatekeeper_assertion GET "${APP}/echo" "${COOKIE}")")")" "401" "An assertion for GET does not carry a POST (401)" || true

# Each resolves (by nginx's reading) under the user surface; Gatekeeper
# checks the raw target, which may not hold a dot segment or an encoded
# separator.
PATHS_BEFORE=$(half_requests "${PLUGIN}" '(%2[fFeE]|%5[cC]|/\.\.?(/|$))')
for path in "${APP}/../app/echo" "${APP}/./echo" "${APP}/%2e/echo" "${APP}/a%2fb" "${APP}/a%5cb"; do
  STATUS=$(visit_status "$(visit "${JAR_VIEWER}" --path-as-is "https://${FQDN}${path}")")
  if [ "$STATUS" = "403" ] || [ "$STATUS" = "400" ]; then
    log_pass "${path}: refused (${STATUS})"
  else
    log_fail "${path}: expected 403 or 400, got ${STATUS}"
  fi
done
assert_eq "$(half_requests "${PLUGIN}" '(%2[fFeE]|%5[cC]|/\.\.?(/|$))')" "${PATHS_BEFORE}" "The agent half saw none of them (its request log)" || true

# ===========================================================================
# 7. A restricted tunnel
# ===========================================================================

log_section "Restricted: a grant for the tunnel is needed too"

RESP=$(host_api_call PATCH "tunnels/${TUNNEL_A}" '{"accessMode":"restricted"}')
assert_eq "$(status_of "$RESP")" "200" "The bound tunnel made restricted" || true
if wait_for 30 viewer_gets 403; then
  log_pass "${VIEWER}, entitled to the plugin but without a grant for the tunnel: 403"
else
  log_fail "${VIEWER} on the restricted tunnel: $(viewer_echo_status)"
fi
RESP=$(host_api_post "gatekeeper/grants" "{\"principalType\":\"user\",\"principalId\":\"${VIEWER}\",\"resourceType\":\"tunnel\",\"resourceId\":\"${TUNNEL_A}\"}")
TUNNEL_GRANT_ID=$(json_get "$RESP" '.grant.grantId // empty')
assert_json_field_not_empty "$RESP" '.grant.grantId' "${VIEWER} granted the tunnel" || true
host_api_post "gatekeeper/cache/bust" '{}' > /dev/null 2>&1 || true
if wait_for 30 viewer_gets 200; then
  log_pass "…200 with the grant"
else
  log_fail "${VIEWER} with the grant: $(viewer_echo_status)"
fi
host_api_delete "gatekeeper/grants/${TUNNEL_GRANT_ID}" > /dev/null 2>&1 || true
TUNNEL_GRANT_ID=""
RESP=$(host_api_call PATCH "tunnels/${TUNNEL_A}" '{"accessMode":"authenticated"}')
assert_eq "$(status_of "$RESP")" "200" "The grant revoked, the tunnel authenticated again" || true
if wait_for 30 viewer_gets 200; then
  log_pass "${VIEWER}: 200 again"
else
  log_fail "${VIEWER}: $(viewer_echo_status)"
fi

# ===========================================================================
# 8. Unbound, bound again
# ===========================================================================

log_section "Unbound: the location is gone; bound again: served"

RESP=$(host_api_call DELETE "tunnels/${TUNNEL_A}/user-surface/${PLUGIN}")
assert_eq "$(status_of "$RESP")" "200" "DELETE /api/tunnels/${TUNNEL_A}/user-surface/${PLUGIN}" || true
assert_json_field "$(tunnel_entry "${TUNNEL_A}")" '.userSurface // "none"' 'none' "…the tunnel carries no binding" || true
backend_answers() { [[ "$(visit_body "$(visit "${JAR_VIEWER}" "https://${FQDN}${APP}/echo")")" == *"${MARKER}"* ]]; }
if wait_for 30 backend_answers; then
  log_pass "Signed in, ${APP}/echo reaches the tunnel's own backend again"
else
  log_fail "${APP}/echo after unbinding: $(viewer_echo_status)"
fi
assert_eq "$(visit_status "$(visit - "https://${FQDN}${APP}/echo")")" "302" "…and without a session Authelia redirects, as for any page of it" || true
RESP=$(host_api_call PUT "tunnels/${TUNNEL_A}/user-surface" "{\"route\":\"${PLUGIN}\"}")
assert_json_field "$(body_of "$RESP")" '"\(.changed) \(.tunnel.userSurfaceStatus[0].served)"' 'true true' "Bound again: served at once (approved, hosted)" || true
if wait_for 30 viewer_gets 200; then
  log_pass "${VIEWER}: the agent half answers again"
else
  log_fail "${VIEWER} after binding again: $(viewer_echo_status)"
fi

# ===========================================================================
# 9. Disabled
# ===========================================================================

log_section "Disabled: refused at once"

COOKIE=$(session_cookie "${JAR_VIEWER}")
ASSERTION=$(gatekeeper_assertion GET "${APP}/echo" "${COOKIE}")
assert_eq "$(echo "${ASSERTION}" | grep -cE '^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$' || true)" "1" "Gatekeeper vouches for ${VIEWER}'s session once more" || true
RESP=$(users_call PUT "users/${VIEWER}" '{"disabled":true}')
assert_json_field "$(body_of "$RESP")" '.user.status' 'disabled' "${VIEWER} disabled" || true
RESP=$(panel_direct GET "${APP}/echo" "${ASSERTION}")
assert_eq "$(status_of "$RESP")" "403" "That assertion, still valid, sent to the panel: 403" || true
assert_json_field "$(body_of "$RESP")" '.error' 'This user is disabled' "…This user is disabled" || true
STATUS=$(viewer_echo_status)
if [ "$STATUS" = "401" ] || [ "$STATUS" = "403" ]; then
  log_pass "From the visitor VM: ${STATUS} — the session ended with Authelia's restart, or the panel refuses it"
else
  log_fail "From the visitor VM, disabled: ${STATUS}"
fi

end_test

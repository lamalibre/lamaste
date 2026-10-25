#!/usr/bin/env bash
# ============================================================================
# 43 — App plugin web surface: the move from a bound tunnel (Three-VM)
# ============================================================================
# Slice 7's cutover: a plugin whose users reach it through a restricted
# tunnel bound as its user surface — the tunnel's own backend, a static
# server on the agent VM, serving the shell — moves to its web surface on
# the same hostname with one call. The fixture (@lamalibre/e2e-webmove-server,
# helpers.sh: write_app_install_fixture … wide m1) declares identity and a
# web surface. From the visitor VM:
#
# 1. Bound, not moved: the shell comes from the tunnel's backend, the API
#    from the agent half; a user with a role but without the tunnel's grant
#    is refused. Nothing is offered while the tunnel is bound — moving is
#    the way, and creating a second host is refused.
# 2. The move, while a probe on the visitor VM asks for the page every
#    100 ms: every answer is a 200 — the tunnel's backend, then the relay's
#    shell, never one after the other again — no moment without an answer.
# 3. After it: the site on the tunnel's hostname, restricted, served; the
#    tunnel kept, disabled and unbound, its vhost installed but unlinked,
#    its port grant withdrawn, and it cannot be enabled while the site
#    holds its name. The
#    tunnel's grant was copied to the site: its holder gets the shell and
#    the API; the user without it still does not.
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

PLUGIN="e2e-webmove"
SERVER_PACKAGE="@lamalibre/e2e-webmove-server"
AGENT_PACKAGE="@lamalibre/e2e-webmove-agent"
APP="/api/${PLUGIN}/app"
SUB_T="e2e43mv"
PORT_T=18443
POLICY_ID="e2e-apphost-43"
REMOTE_DIR="/var/tmp/e2e-43-app-plugin"
LOCAL_TMP=""
CLEAN_PLUGINS="${PLUGIN}"
CLEAN_ROUTES="${PLUGIN}"
PURGE_PACKAGES=""
VIEWER="e2e43-viewer"
OUTSIDER="e2e43-outsider"
# Test credentials for this run only, never printed
VIEWER_PASSWORD="E2e-$(openssl rand -hex 12)"
OUTSIDER_PASSWORD="E2e-$(openssl rand -hex 12)"
JAR_VIEWER="/tmp/e2e-43-viewer.cookies"
JAR_OUTSIDER="/tmp/e2e-43-outsider.cookies"
FQDN=""
TUNNEL_T=""
TUNNEL_GRANT_ID=""
VIEWER_ID=""
OUTSIDER_ID=""
SITE_ID=""
BACKEND_UNIT="e2e-43-backend"
BACKEND_DIR="/var/tmp/e2e-43-backend"
BACKEND_MARKER="E2E_43_BACKEND_$(date +%s)"
PROBE_UNIT="e2e-43-probe"
PROBE_OUT="/tmp/e2e-43-probe.log"

backend_reachable() {
  [[ "$(host_exec "curl -s --max-time 3 http://127.0.0.1:${PORT_T}/ || true" 2>/dev/null)" == *"${BACKEND_MARKER}"* ]]
}
health_up() { [ "$(hosting_field "${PLUGIN}" '.hosting.health.state')" = "up" ]; }
# The moved tunnel's port is withdrawn for new sessions; the agent drops the
# binding at its sync (nudged here), restarting its tunnel client.
backend_withdrawn() {
  nudge_sync
  [ "$(host_exec "curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:${PORT_T}/ || true" 2>/dev/null | tr -d '\r\n')" = "000" ]
}
both_in_audience() {
  [ "$(audience_row "${PLUGIN}" "${VIEWER_ID}" | jq -r '.change.member.status' 2>/dev/null) $(audience_row "${PLUGIN}" "${OUTSIDER_ID}" | jq -r '.change.member.status' 2>/dev/null)" = "active active" ]
}

# write_probe <file> — no-gap-probe.sh: GET <url> every 100 ms for <seconds>
# with a cookie jar, one line per answer: "<status> backend|shell|other"
#
#   bash no-gap-probe.sh <jar> <url> <seconds> <out> <backend marker>
write_probe() {
  cat > "$1" <<'PROBE_EOF'
#!/usr/bin/env bash
set -u
end=$((SECONDS + $3))
: > "$4"
while [ "$SECONDS" -lt "$end" ]; do
  resp=$(curl -sk --max-time 5 -b "$1" -w '\n%{http_code}' "$2" 2> /dev/null || echo "000")
  code=$(printf '%s\n' "$resp" | tail -n 1)
  case "$resp" in
    *E2E_WEB_*) kind=shell ;;
    *"$5"*) kind=backend ;;
    *) kind=other ;;
  esac
  echo "${code} ${kind}" >> "$4"
  sleep 0.1
done
PROBE_EOF
}

probe_running() { [ "$(visitor_exec "systemctl is-active ${PROBE_UNIT} 2>/dev/null || true" 2>/dev/null | tail -n 1)" = "active" ]; }
probe_done() { ! probe_running; }

begin_test "43 — App plugin web surface: the move from a bound tunnel (Three-VM)"

cleanup() {
  log_info "Cleaning up test resources..."
  local id
  host_api_delete "plugins/${PLUGIN}/web-surface" > /dev/null 2>&1 || true
  if [ -n "${TUNNEL_GRANT_ID}" ]; then host_api_delete "gatekeeper/grants/${TUNNEL_GRANT_ID}" > /dev/null 2>&1 || true; fi
  drop_plugin_grants "${PLUGIN}"
  if [ -n "${TUNNEL_T}" ]; then host_api_delete "tunnels/${TUNNEL_T}" > /dev/null 2>&1 || true; fi
  timed_exec 60 multipass exec "${AGENT_VM}" -- sudo bash -c "systemctl stop ${BACKEND_UNIT} > /dev/null 2>&1; rm -rf ${BACKEND_DIR}; true" > /dev/null 2>&1
  timed_exec 60 multipass exec "${VISITOR_VM}" -- sudo bash -c "systemctl stop ${PROBE_UNIT} > /dev/null 2>&1; rm -f ${JAR_VIEWER} ${JAR_OUTSIDER} ${PROBE_OUT} /tmp/no-gap-probe.sh; sed -i '/${SUB_T}\\./d' /etc/hosts; true" > /dev/null 2>&1
  for id in "${VIEWER}" "${OUTSIDER}"; do
    host_api_delete "users/${id}?erase=true" > /dev/null 2>&1 || true
  done
  for id in ${VIEWER_ID} ${OUTSIDER_ID}; do
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
FQDN="${SUB_T}.${DOMAIN}"
log_info "Hosting agent: ${HOST_AGENT_LABEL}, relay domain ${DOMAIN}, bound host ${FQDN}"
if agent_has_node_sqlite; then
  log_pass "The agent VM's Node.js has node:sqlite, which the agent half's projection needs"
else
  log_fail "The agent VM's Node.js has no unflagged node:sqlite (Node.js 22.13 or later): the identity fixture cannot run"
  end_test
  exit $?
fi
if visitor_has_oathtool; then
  log_pass "The visitor VM has oathtool (Authelia's second factor)"
else
  log_fail "The visitor VM has no oathtool: no one can sign in"
  end_test
  exit $?
fi
host_api_delete "plugins/${PLUGIN}/web-surface" > /dev/null 2>&1 || true
drop_plugin_grants "${PLUGIN}"
for user in "${VIEWER}" "${OUTSIDER}"; do
  host_api_delete "users/${user}?erase=true" > /dev/null 2>&1 || true
done

# ===========================================================================
# 1. Fixture, users, the plugin hosted, the tunnel bound
# ===========================================================================

log_section "The plugin hosted; a restricted tunnel with its own backend, bound"

LOCAL_TMP=$(mktemp -d /tmp/e2e-43-app-plugin-XXXXXXXX)
if ! write_app_install_fixture "${LOCAL_TMP}/ship/fixtures/move" "${PLUGIN}" 1.0.0 main "r$(date +%s)-$$" '[]' none wide m1 "${SUB_T}"; then
  log_fail "The fixture could not be built (npm install at the workspace root, npm run build -w packages/core/lib)"
  end_test
  exit $?
fi
log_pass "Fixture built: ${SERVER_PACKAGE} with web tree m1"
ship_agent_facts_probe
start_stand_in_feria fixtures/move/server fixtures/move/agent
ensure_app_host_helper
open_push_install "${POLICY_ID}" "[\"${AGENT_PACKAGE}\"]" '["install","uninstall"]'

RESP=$(users_call POST "users" "{\"username\":\"${VIEWER}\",\"displayname\":\"E2E Viewer\",\"email\":\"${VIEWER}@example.test\",\"password\":\"${VIEWER_PASSWORD}\",\"groups\":[]}")
assert_eq "$(status_of "$RESP")" "201" "User ${VIEWER} created" || true
VIEWER_ID=$(json_get "$(body_of "$RESP")" '.user.userId // empty')
RESP=$(users_call POST "users" "{\"username\":\"${OUTSIDER}\",\"displayname\":\"E2E Outsider\",\"email\":\"${OUTSIDER}@example.test\",\"password\":\"${OUTSIDER_PASSWORD}\",\"groups\":[]}")
assert_eq "$(status_of "$RESP")" "201" "User ${OUTSIDER} created — with a role, never the tunnel's grant" || true
OUTSIDER_ID=$(json_get "$(body_of "$RESP")" '.user.userId // empty')

INSTALL=$(install_approved "${PLUGIN}" "${SERVER_PACKAGE}@1.0.0")
assert_json_field "$INSTALL" '.plugin.version' '1.0.0' "Installed, approved and enabled ${SERVER_PACKAGE}@1.0.0" || true
OP=$(host_plugin "${PLUGIN}" 300 nudge)
assert_json_field "$OP" '.status' 'succeeded' "Hosted on ${HOST_AGENT_LABEL} ($(json_get "$OP" '.error // .refused.error // ""'))" || true
if wait_for 120 identity_ready "${PLUGIN}"; then
  log_pass "Ready: its agent half's first complete sync ended at the head"
else
  log_fail "Not ready: $(identity_view "${PLUGIN}" | jq -c '.readiness')"
fi

RESP=$(host_api_post "tunnels" "{\"subdomain\":\"${SUB_T}\",\"port\":${PORT_T},\"accessMode\":\"restricted\",\"agentLabel\":\"${HOST_AGENT_LABEL}\"}")
TUNNEL_T=$(json_get "$RESP" '.tunnel.id // empty')
assert_json_field "$RESP" '"\(.tunnel.fqdn) \(.tunnel.accessMode)"' "${FQDN} restricted" "Tunnel ${FQDN}: restricted" || true
agent_exec "grep -q 'tunnel.${DOMAIN}' /etc/hosts || echo '${HOST_IP} tunnel.${DOMAIN}' >> /etc/hosts" > /dev/null 2>&1 || true
visitor_exec "grep -q '${FQDN}' /etc/hosts || echo '${HOST_IP} ${FQDN}' >> /etc/hosts" > /dev/null 2>&1 || true
agent_exec "systemctl stop ${BACKEND_UNIT} > /dev/null 2>&1; rm -rf ${BACKEND_DIR} && mkdir -p ${BACKEND_DIR} && printf '<p>%s</p>\n' ${BACKEND_MARKER} > ${BACKEND_DIR}/index.html && chmod -R a+rX ${BACKEND_DIR} && systemd-run --quiet --collect --unit ${BACKEND_UNIT} --uid=nobody --gid=nogroup python3 -m http.server ${PORT_T} --bind 127.0.0.1 --directory ${BACKEND_DIR}" > /dev/null 2>&1 || true
nudge_sync
if wait_for 120 backend_reachable; then
  log_pass "The tunnel's own backend answers through chisel"
else
  log_fail "The tunnel's backend is not reachable through chisel on the host VM's port ${PORT_T}"
fi

RESP=$(host_api_call PUT "tunnels/${TUNNEL_T}/user-surface" "{\"route\":\"${PLUGIN}\"}")
assert_json_field "$(body_of "$RESP")" '.tunnel.userSurfaceStatus[0] | "\(.route) \(.served)"' "${PLUGIN} true" "Bound as the plugin's user surface, served" || true
RESP=$(host_api_post "gatekeeper/grants" "{\"principalType\":\"user\",\"principalId\":\"${VIEWER}\",\"resourceType\":\"tunnel\",\"resourceId\":\"${TUNNEL_T}\"}")
TUNNEL_GRANT_ID=$(json_get "$RESP" '.grant.grantId // empty')
assert_json_field_not_empty "$RESP" '.grant.grantId' "${VIEWER} granted the tunnel" || true
for user in "${VIEWER}" "${OUTSIDER}"; do
  RESP=$(host_api_call PUT "plugins/${PLUGIN}/entitlements" "{\"principalType\":\"user\",\"principalId\":\"${user}\",\"roles\":[\"viewer\"]}")
  assert_eq "$(status_of "$RESP")" "200" "${user} entitled as viewer" || true
done
if wait_for 30 both_in_audience; then
  log_pass "…both active members of the audience"
else
  log_fail "The audience: $(audience_row "${PLUGIN}" "${VIEWER_ID}") $(audience_row "${PLUGIN}" "${OUTSIDER_ID}")"
fi

WS=$(web_surface "${PLUGIN}")
assert_json_field "$WS" '"\(.site) \(.offer) \(.boundTunnel.id)"' "null null ${TUNNEL_T}" "No site, nothing offered: the tunnel is bound — moving is the way" || true
RESP=$(host_api_call POST "plugins/${PLUGIN}/web-surface" '{}')
assert_eq "$(status_of "$RESP") $(json_get "$(body_of "$RESP")" '.code')" "409 bound_to_tunnel" "Creating a site beside it is refused (409 bound_to_tunnel)" || true

# ===========================================================================
# 2. Signed in, through the tunnel
# ===========================================================================

log_section "Through the tunnel: its backend's shell, the agent half's API"

SECRET_V=$(reset_totp "${VIEWER}")
SECRET_O=$(reset_totp "${OUTSIDER}")
wait_for_next_totp_window
assert_eq "$(sign_in "${VIEWER}" "${VIEWER_PASSWORD}" "${SECRET_V}" "${JAR_VIEWER}" "${FQDN}")" "OK OK" "${VIEWER} signed in from the visitor VM" || true
assert_eq "$(sign_in "${OUTSIDER}" "${OUTSIDER_PASSWORD}" "${SECRET_O}" "${JAR_OUTSIDER}" "${FQDN}")" "OK OK" "${OUTSIDER} signed in" || true
assert_contains "$(visit_body "$(page "${JAR_VIEWER}" /)")" "${BACKEND_MARKER}" "GET / as ${VIEWER}: the tunnel's own backend" || true
assert_eq "$(page_status "${JAR_VIEWER}" "${APP}/echo")" "200" "GET ${APP}/echo: the agent half, through the binding" || true
assert_eq "$(page_status "${JAR_OUTSIDER}" /)" "403" "${OUTSIDER}, without the tunnel's grant: 403" || true

# ===========================================================================
# 3. The move, probed
# ===========================================================================

log_section "The move: one reload, no moment without an answer"

write_probe "${LOCAL_TMP}/no-gap-probe.sh"
multipass transfer "${LOCAL_TMP}/no-gap-probe.sh" "${VISITOR_VM}:/tmp/no-gap-probe.sh"
visitor_exec "systemctl stop ${PROBE_UNIT} > /dev/null 2>&1; systemd-run --quiet --collect --unit ${PROBE_UNIT} bash /tmp/no-gap-probe.sh ${JAR_VIEWER} https://${FQDN}/ 25 ${PROBE_OUT} ${BACKEND_MARKER}" > /dev/null 2>&1 || true
sleep 5
RESP=$(host_api_call POST "plugins/${PLUGIN}/web-surface/move" "{\"tunnelId\":\"${TUNNEL_T}\"}")
assert_eq "$(status_of "$RESP")" "200" "POST /api/plugins/${PLUGIN}/web-surface/move {tunnelId}" || true
MOVED=$(body_of "$RESP")
SITE_ID=$(json_get "$MOVED" '.webSurface.site.id // empty')
assert_json_field "$MOVED" '"\(.webSurface.site.fqdn) \(.webSurface.site.accessMode) \(.webSurface.served)"' "${FQDN} restricted true" "…the site on ${FQDN}, restricted as the tunnel was, served" || true
if wait_for 60 probe_done; then
  log_pass "The probe ran its 25 seconds"
else
  log_fail "The probe is still running"
fi
PROBE=$(visitor_exec "cat ${PROBE_OUT} 2>/dev/null || true" 2>/dev/null || echo "")
SUMMARY=$(printf '%s\n' "$PROBE" | sort | uniq -c | awk '{printf "%s×%s %s; ", $1, $2, $3}')
log_info "Probe: ${SUMMARY}"
OTHER_ANSWERS=$(printf '%s\n' "$PROBE" | grep -cvE '^200 (backend|shell)$' || true)
BACKEND_ANSWERS=$(printf '%s\n' "$PROBE" | grep -c '^200 backend$' || true)
SHELL_ANSWERS=$(printf '%s\n' "$PROBE" | grep -c '^200 shell$' || true)
assert_eq "${OTHER_ANSWERS}" "0" "Every answer during the move was a 200, from the backend or the shell" || true
assert_not_eq "${BACKEND_ANSWERS}" "0" "…the tunnel's backend answered before it (${BACKEND_ANSWERS})" || true
assert_not_eq "${SHELL_ANSWERS}" "0" "…the relay's shell after it (${SHELL_ANSWERS})" || true
SWITCHES=$(printf '%s\n' "$PROBE" | awk '{print $2}' | uniq | grep -c . || true)
assert_eq "$SWITCHES" "2" "…one switch, never back" || true

# ===========================================================================
# 4. After the move
# ===========================================================================

log_section "After the move: the site serves; the tunnel kept, off and unbound"

assert_json_field "$(tunnel_entry "${TUNNEL_T}")" '"\(.enabled) \(.userSurface // "none")"' 'false none' "The tunnel stays, disabled and unbound" || true
VHOST_STATE=$(host_exec "a=gone; e=unlinked; test -e /etc/nginx/sites-available/lamalibre-lamaste-app-${SUB_T} && a=kept; test -e /etc/nginx/sites-enabled/lamalibre-lamaste-app-${SUB_T} && e=linked; echo \$a \$e" 2>/dev/null | tail -n 1)
assert_eq "$VHOST_STATE" "kept unlinked" "Its vhost stays installed, unlinked — for a rollback by hand" || true
if wait_for 90 backend_withdrawn; then
  log_pass "Its port grant is withdrawn: nothing answers on the host VM's port ${PORT_T}"
else
  log_fail "Port ${PORT_T} still answers on the host VM"
fi
# Chisel was not restarted (that would drop the plugin's internal tunnel);
# the agent's tunnel client restarted to drop the binding, as on any tunnel
# change of its own.
if wait_for 90 health_up; then
  log_pass "The hosting is up again after the agent's tunnel client restarted"
else
  log_fail "Health: $(hosting_field "${PLUGIN}" '.hosting.health')"
fi
RESP=$(host_api_call PATCH "tunnels/${TUNNEL_T}" '{"enabled":true}')
assert_eq "$(status_of "$RESP")" "400" "Enabling the tunnel while the site holds its name: refused (400)" || true
assert_contains "$(json_get "$(body_of "$RESP")" '.details')" "already served by a static site" "…$(json_get "$(body_of "$RESP")" '.details')" || true

RESP=$(host_api_get "gatekeeper/grants?resourceType=site&resourceId=${SITE_ID}")
assert_json_field "$RESP" '[.grants[]? | select(.principalType == "user") | .principalId] | join(",")' "${VIEWER}" "The tunnel's grant was copied to the site" || true
assert_contains "$(visit_body "$(page "${JAR_VIEWER}" /)")" "E2E_WEB_m1" "GET / as ${VIEWER}: the relay's shell (tree m1)" || true
RESP=$(page "${JAR_VIEWER}" "${APP}/echo")
assert_eq "$(visit_status "$RESP")" "200" "GET ${APP}/echo: the agent half, from the site" || true
assert_json_field "$(visit_body "$RESP")" '.caller.userId' "${VIEWER_ID}" "…as ${VIEWER}" || true
assert_eq "$(page_status "${JAR_OUTSIDER}" /)" "403" "${OUTSIDER}, still without the grant: 403 on the shell" || true
assert_eq "$(page_status "${JAR_OUTSIDER}" "${APP}/echo")" "403" "…and on the API" || true

end_test

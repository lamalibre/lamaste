#!/usr/bin/env bash
# ============================================================================
# 42 — App plugin web surface (Three-VM)
# ============================================================================
# Slice 7: an agent-hosted plugin's users open the shell its server package
# ships, served by the relay on a site the plugin owns, beside its user
# surface's API — one host, one Authelia session. The fixture
# (@lamalibre/e2e-websurf-server, helpers.sh: write_app_install_fixture …
# wide v1) declares identity and `userSurface.web` on e2e42web and ships
# tree v1. From the visitor VM:
#
# 1. Installed, not approved: the tree's digest is part of the approval and
#    nothing is in the relay's tree store; the web surface offers e2e42web.
# 2. Created: the site answers 503 until the surface is served; the sites
#    API lists it with its owner and refuses to manage it.
# 3. Approved and hosted: the approved tree is served from the store
#    (`current`). Without a session a page goes to the login; a user without
#    a role in the plugin gets the access-request page; with the viewer role
#    the shell (index.html, its files, a deep link answered with the shell),
#    under a strict CSP, `no-cache`, `X-Frame-Options: DENY`,
#    `Cross-Origin-Resource-Policy: same-origin`; nothing but GET and HEAD,
#    never a service worker's script; the API on the same host and session
#    as on a bound tunnel, never as a script.
# 4. Deleted: the site, its vhost and its trees go.
#
# The move from a bound tunnel is spec 43; updates and a rollback, 44.
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

PLUGIN="e2e-websurf"
SERVER_PACKAGE="@lamalibre/e2e-websurf-server"
AGENT_PACKAGE="@lamalibre/e2e-websurf-agent"
APP="/api/${PLUGIN}/app"
SUB_W="e2e42web"
POLICY_ID="e2e-apphost-42"
REMOTE_DIR="/var/tmp/e2e-42-app-plugin"
LOCAL_TMP=""
CLEAN_PLUGINS="${PLUGIN}"
CLEAN_ROUTES="${PLUGIN}"
PURGE_PACKAGES=""
VIEWER="e2e42-viewer"
NOROLE="e2e42-norole"
# Test credentials for this run only, never printed
VIEWER_PASSWORD="E2e-$(openssl rand -hex 12)"
NOROLE_PASSWORD="E2e-$(openssl rand -hex 12)"
JAR_VIEWER="/tmp/e2e-42-viewer.cookies"
JAR_NOROLE="/tmp/e2e-42-norole.cookies"
FQDN=""
VIEWER_ID=""
NOROLE_ID=""
SITE_ID=""
TREE_1=""

# local_tree_sha <directory> — the web tree digest of a fixture's web/ (core's
# rule, from this workspace's build)
local_tree_sha() {
  node --input-type=module -e "
    const { webTreeManifestOfDirectory } = await import('${SCRIPT_DIR}/../../../../core/lib/dist/server/index.js');
    process.stdout.write((await webTreeManifestOfDirectory(process.argv[1])).sha256);
  " "$1" 2>/dev/null || echo ""
}

# shell_serves <tag> — the viewer gets index.html with tree <tag>'s marker
shell_serves() { [[ "$(visit_body "$(page "${JAR_VIEWER}" /)")" == *"E2E_WEB_$1"* ]]; }
site_answers() { [ "$(page_status - /)" = "$1" ]; }

# viewer_in_audience — the audience holds the viewer as an active member
viewer_in_audience() {
  [ "$(audience_row "${PLUGIN}" "${VIEWER_ID}" | jq -r '"\(.change.kind) \(.change.member.status)"' 2>/dev/null)" = "upsert active" ]
}

# sites_entry — the plugin's site as GET /api/sites lists it ('null' when gone)
sites_entry() {
  host_api_get "sites?limit=500" 2>/dev/null | jq -c --arg id "${SITE_ID}" '[.sites[]? | select(.id == $id)] | first // null' 2>/dev/null || echo "null"
}

begin_test "42 — App plugin web surface (Three-VM)"

cleanup() {
  log_info "Cleaning up test resources..."
  local id
  drop_plugin_grants "${PLUGIN}"
  timed_exec 60 multipass exec "${VISITOR_VM}" -- sudo bash -c "rm -f ${JAR_VIEWER} ${JAR_NOROLE}; sed -i '/${SUB_W}\\./d' /etc/hosts; true" > /dev/null 2>&1
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
FQDN="${SUB_W}.${DOMAIN}"
log_info "Hosting agent: ${HOST_AGENT_LABEL}, relay domain ${DOMAIN}, web surface ${FQDN}"
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
  log_fail "The visitor VM has no oathtool: no one can sign in to reach the web surface"
  end_test
  exit $?
fi
# Leftovers of an interrupted run (rodeo ends a spec at ten minutes without its trap)
host_api_delete "plugins/${PLUGIN}/web-surface" > /dev/null 2>&1 || true
drop_plugin_grants "${PLUGIN}"
for user in "${VIEWER}" "${NOROLE}"; do
  host_api_delete "users/${user}?erase=true" > /dev/null 2>&1 || true
done

# ===========================================================================
# 1. Fixtures, users, the plugin installed
# ===========================================================================

log_section "Fixtures, the stand-in Feria, the users; the plugin installed, not approved"

LOCAL_TMP=$(mktemp -d /tmp/e2e-42-app-plugin-XXXXXXXX)
BUILD="r$(date +%s)-$$"
FIXTURES="built"
write_app_install_fixture "${LOCAL_TMP}/ship/fixtures/v100" "${PLUGIN}" 1.0.0 main "${BUILD}" '[]' none wide v1 "${SUB_W}" || FIXTURES="failed"
if [ "$FIXTURES" != "built" ]; then
  log_fail "The fixtures could not be built (npm install at the workspace root, npm run build -w packages/core/lib)"
  end_test
  exit $?
fi
TREE_1=$(local_tree_sha "${LOCAL_TMP}/ship/fixtures/v100/server/web")
assert_eq "$(printf '%s\n' "${TREE_1}" | grep -cE '^[a-f0-9]{64}$' || true)" "1" "Fixture built: ${SERVER_PACKAGE} 1.0.0 with tree v1" || true
ship_agent_facts_probe
start_stand_in_feria fixtures/v100/server fixtures/v100/agent
ensure_app_host_helper
open_push_install "${POLICY_ID}" "[\"${AGENT_PACKAGE}\"]" '["install","uninstall"]'

# Every users.yml write of the spec, before anyone signs in.
RESP=$(users_call POST "users" "{\"username\":\"${VIEWER}\",\"displayname\":\"E2E Viewer\",\"email\":\"${VIEWER}@example.test\",\"password\":\"${VIEWER_PASSWORD}\",\"groups\":[]}")
assert_eq "$(status_of "$RESP")" "201" "User ${VIEWER} created" || true
VIEWER_ID=$(json_get "$(body_of "$RESP")" '.user.userId // empty')
RESP=$(users_call POST "users" "{\"username\":\"${NOROLE}\",\"displayname\":\"E2E No Role\",\"email\":\"${NOROLE}@example.test\",\"password\":\"${NOROLE_PASSWORD}\",\"groups\":[]}")
assert_eq "$(status_of "$RESP")" "201" "User ${NOROLE} created — to hold no role in the plugin" || true
NOROLE_ID=$(json_get "$(body_of "$RESP")" '.user.userId // empty')

INSTALL=$(host_api_post "plugins/install" "{\"packageName\":\"${SERVER_PACKAGE}@1.0.0\"}")
assert_json_field "$INSTALL" '.plugin.version' '1.0.0' "Installed ${SERVER_PACKAGE}@1.0.0" || true
HOOKS=$(host_api_get "plugins/${PLUGIN}/hooks")
assert_json_field "$HOOKS" '"\(.hooks.web.declared) \(.hooks.web.treeSha256) \(.hooks.approval.state)"' "true ${TREE_1} pending" "Its web tree is part of what waits for approval — the digest of tree v1" || true
DIGEST=$(json_get "$HOOKS" '.hooks.approval.digest // empty')
WS=$(web_surface "${PLUGIN}")
assert_json_field "$WS" '"\(.served) \(.reason) \(.site)"' 'false not_approved null' "Not served, owns no site: not approved" || true
assert_json_field "$WS" '"\(.offer.subdomain) \(.offer.accessMode) \(.offer.available)"' "${SUB_W} authenticated true" "Offered: ${SUB_W}, authenticated, free" || true
assert_eq "$(tree_dirs "${PLUGIN}")" "" "Nothing of it in the relay's tree store" || true

# ===========================================================================
# 2. The site, before it is served
# ===========================================================================

log_section "Created: 503 until served; the sites API does not manage it"

RESP=$(host_api_call POST "plugins/${PLUGIN}/web-surface" '{}')
assert_eq "$(status_of "$RESP")" "201" "POST /api/plugins/${PLUGIN}/web-surface" || true
SITE_ID=$(json_get "$(body_of "$RESP")" '.webSurface.site.id // empty')
assert_json_field "$(body_of "$RESP")" '"\(.webSurface.site.fqdn) \(.webSurface.site.accessMode)"' "${FQDN} authenticated" "…the site ${FQDN}, authenticated" || true
RESP=$(host_api_call POST "plugins/${PLUGIN}/web-surface" '{}')
assert_eq "$(status_of "$RESP") $(json_get "$(body_of "$RESP")" '.code')" "409 exists" "A second one is refused (409 exists)" || true

visitor_exec "grep -q '${FQDN}' /etc/hosts || echo '${HOST_IP} ${FQDN}' >> /etc/hosts" > /dev/null 2>&1 || true
if wait_for 30 site_answers 503; then
  log_pass "Not approved yet: every request answered 503"
else
  log_fail "The site before approval: $(page_status - /)"
fi
assert_json_field "$(sites_entry)" '"\(.owner.plugin) \(.webSurface.served) \(.webSurface.reason)"' "${PLUGIN} false not_approved" "GET /api/sites lists it with its owner, not served" || true
RESP=$(host_api_call PATCH "sites/${SITE_ID}" '{"spaMode":false}')
assert_eq "$(status_of "$RESP") $(json_get "$(body_of "$RESP")" '.details.code')" "409 plugin_owned_site" "PATCH /api/sites/${SITE_ID}: refused (409)" || true
assert_eq "$(status_of "$(host_api_call GET "sites/${SITE_ID}/files?path=.")")" "409" "Its files are not listed through the sites API (409)" || true
assert_eq "$(status_of "$(host_api_call DELETE "sites/${SITE_ID}")")" "409" "…nor is it deleted there (409)" || true

# ===========================================================================
# 3. Approved and hosted: the shell
# ===========================================================================

log_section "Approved and hosted: the approved tree served"

APPROVED=$(host_api_post "plugins/${PLUGIN}/hooks/approve" "{\"digest\":\"${DIGEST}\"}")
assert_json_field "$APPROVED" '"\(.hooks.approval.state) \(.hooks.web.approved)"' 'approved true' "Approved: its agent half, identity block and web tree" || true
assert_eq "$(tree_link "${PLUGIN}" current) $(tree_dirs "${PLUGIN}")" "${TREE_1} ${TREE_1}" "The approval served tree v1 from the store (current → its digest)" || true
host_api_post "plugins/${PLUGIN}/enable" '{}' > /dev/null
OP=$(host_plugin "${PLUGIN}" 300 nudge)
assert_json_field "$OP" '.status' 'succeeded' "Hosted on ${HOST_AGENT_LABEL} ($(json_get "$OP" '.error // .refused.error // ""'))" || true
if wait_for 120 web_served "${PLUGIN}"; then
  log_pass "Served: approved, hosted, its tree current"
else
  log_fail "Not served: $(web_surface "${PLUGIN}" | jq -c '{served, reason, tree}')"
fi
if wait_for 120 identity_ready "${PLUGIN}"; then
  log_pass "Ready: its agent half's first complete sync ended at the head"
else
  log_fail "Not ready: $(identity_view "${PLUGIN}" | jq -c '.readiness')"
fi

if wait_for 30 site_answers 302; then
  log_pass "Without a session: a page goes to the login"
else
  log_fail "Without a session: $(page_status - /)"
fi
assert_contains "$(visit_headers "$(page - /)")" "auth.${DOMAIN}" "…the sign-in portal, back to ${FQDN}" || true
API=$(page - "${APP}/echo")
assert_eq "$(visit_status "$API") $(json_get "$(visit_body "$API")" '.error')" "401 unauthenticated" "…the API on the same host: a JSON 401, never a redirect" || true

SECRET_V=$(reset_totp "${VIEWER}")
SECRET_N=$(reset_totp "${NOROLE}")
wait_for_next_totp_window
assert_eq "$(sign_in "${VIEWER}" "${VIEWER_PASSWORD}" "${SECRET_V}" "${JAR_VIEWER}" "${FQDN}")" "OK OK" "${VIEWER} signed in from the visitor VM" || true
assert_eq "$(sign_in "${NOROLE}" "${NOROLE_PASSWORD}" "${SECRET_N}" "${JAR_NOROLE}" "${FQDN}")" "OK OK" "${NOROLE} signed in" || true

RESP=$(page "${JAR_NOROLE}" /)
assert_eq "$(visit_status "$RESP")" "403" "${NOROLE}, without a role in the plugin: 403" || true
assert_contains "$(visit_headers "$RESP" | tr '[:upper:]' '[:lower:]')" "content-type: text/html" "…the access-request page" || true
assert_not_contains "$(visit_body "$RESP")" "E2E_WEB_" "…never the shell" || true

RESP=$(host_api_call PUT "plugins/${PLUGIN}/entitlements" "{\"principalType\":\"user\",\"principalId\":\"${VIEWER}\",\"roles\":[\"viewer\"]}")
assert_eq "$(status_of "$RESP")" "200" "${VIEWER} entitled as viewer" || true
if wait_for 30 viewer_in_audience; then
  log_pass "…an active member of the audience"
else
  log_fail "The audience: $(audience_row "${PLUGIN}" "${VIEWER_ID}")"
fi

log_section "Signed in with a role: the shell and the API, one session"

if wait_for 30 shell_serves v1; then
  log_pass "GET / as ${VIEWER}: index.html of tree v1"
else
  log_fail "GET / as ${VIEWER}: $(page_status "${JAR_VIEWER}" /)"
fi
HEADERS=$(visit_headers "$(page "${JAR_VIEWER}" /)" | tr '[:upper:]' '[:lower:]')
assert_contains "$HEADERS" "content-security-policy: default-src 'self'; script-src 'self';" "…under the web surface's CSP: nothing from another origin, no inline script" || true
assert_contains "$HEADERS" "cache-control: no-cache" "…revalidated on every load (no-cache)" || true
assert_contains "$HEADERS" "x-frame-options: deny" "…never framed" || true
assert_contains "$HEADERS" "cross-origin-resource-policy: same-origin" "…no other host learns from it whether the viewer may use the plugin" || true
assert_eq "$(page_status "${JAR_VIEWER}" /app-v1.js)" "200" "Its script app-v1.js: 200" || true
assert_contains "$(visit_body "$(page "${JAR_VIEWER}" /reports/2026/october)")" "E2E_WEB_v1" "A deep link is answered with the shell (index.html)" || true
assert_eq "$(page_status "${JAR_VIEWER}" / -X POST -H "Origin: https://${FQDN}")" "405" "POST / to the shell: 405 — GET and HEAD only" || true
assert_eq "$(page_status "${JAR_VIEWER}" /app-v1.js -H 'Service-Worker: script')" "404" "A service worker's script: 404 — never registered from a plugin's site" || true
assert_eq "$(page_status "${JAR_VIEWER}" "${APP}/echo" -H 'Sec-Fetch-Site: same-origin' -H 'Sec-Fetch-Dest: script')" "403" "The API as a script source: 403 — code comes from the approved tree only" || true

RESP=$(page "${JAR_VIEWER}" "${APP}/echo")
assert_eq "$(visit_status "$RESP")" "200" "GET ${APP}/echo on the same host, the same session: 200" || true
assert_json_field "$(visit_body "$RESP")" '"\(.caller.type) \(.caller.userId) \(.caller.roles | join(","))"' "user ${VIEWER_ID} viewer" "…the agent half sees the directory's user and roles" || true
API_HEADERS=$(visit_headers "$RESP" | tr '[:upper:]' '[:lower:]')
assert_contains "$API_HEADERS" "content-security-policy: sandbox; default-src 'none'" "…an API answer keeps the user surface's own headers (CSP sandbox)" || true
assert_not_contains "$API_HEADERS" "default-src 'self'" "…not the shell's" || true

# ===========================================================================
# 4. Deleted
# ===========================================================================

log_section "Deleted: the site, its vhost and its trees go"

RESP=$(host_api_call DELETE "plugins/${PLUGIN}/web-surface")
assert_eq "$(status_of "$RESP")" "200" "DELETE /api/plugins/${PLUGIN}/web-surface" || true
assert_eq "$(sites_entry)" "null" "The site is gone from GET /api/sites" || true
assert_eq "$(host_exec "test -e /var/www/lamaste/apps/${PLUGIN} && echo kept || echo gone" 2>/dev/null | tail -n 1)" "gone" "Its tree store is gone" || true
assert_eq "$(host_exec "test -e /etc/nginx/sites-available/lamalibre-lamaste-site-${SITE_ID} && echo kept || echo gone" 2>/dev/null | tail -n 1)" "gone" "Its vhost is gone" || true
assert_not_contains "$(visit_body "$(page "${JAR_VIEWER}" /)")" "E2E_WEB_" "Nothing of the shell answers on ${FQDN}" || true
SITE_ID=""

end_test

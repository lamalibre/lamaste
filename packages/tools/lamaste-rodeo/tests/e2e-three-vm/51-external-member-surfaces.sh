#!/usr/bin/env bash
# ============================================================================
# 51 — External members: a plugin's web surface and audience (Three-VM)
# ============================================================================
# The third acceptance case of external members (design: packages/core/
# docs/external-members-design.md, "Proof"), the corral case: a client's
# person, an external member of the domain, reaches a plugin's web surface
# by grant and nothing on an authenticated one. B is a second base domain
# (multi-domain-harness.sh).
#
# An app plugin with identity and a web surface (fixture
# @lamalibre/e2e-xsurf-server, helpers.sh: write_app_install_fixture … wide
# v1, as spec 42's) is installed, hosted and moved to B. A member and an
# external member of B are both entitled as viewers.
#
# 1. Both are in the plugin's audience with their role, and in its agent
#    half's projection: an external member counts when entitled.
# 2. An authenticated web surface: the member reaches the shell and the
#    user surface's API; the external member, although entitled, gets the
#    access-request page on the shell and 403 {error: forbidden} on the API.
# 3. A restricted web surface: without the site's grant the external member
#    is refused the same way; with it (users.yml gives them the site's
#    hostname as a group) the shell and the API answer, the API with their
#    directory id and role; revoked, refused again.
#
# rodeo ends a spec at ten minutes: one plugin, one hosting, two web
# surfaces in turn.
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../e2e/helpers.sh"
# shellcheck source-path=SCRIPTDIR source=app-plugin-harness.sh
source "${SCRIPT_DIR}/app-plugin-harness.sh"
MD_SPEC=51
# shellcheck source-path=SCRIPTDIR source=multi-domain-harness.sh
source "${SCRIPT_DIR}/multi-domain-harness.sh"

require_commands multipass curl jq node npm tar perl openssl

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

PLUGIN="e2e-xsurf"
SERVER_PACKAGE="@lamalibre/e2e-xsurf-server"
AGENT_PACKAGE="@lamalibre/e2e-xsurf-agent"
APP="/api/${PLUGIN}/app"
SUB_W="e2e51web"
POLICY_ID="e2e-apphost-51"
REMOTE_DIR="/var/tmp/e2e-51-app-plugin"
LOCAL_TMP=""
CLEAN_PLUGINS="${PLUGIN}"
CLEAN_ROUTES="${PLUGIN}"
PURGE_PACKAGES=""
MEM="e2e51-member"
EXT="e2e51-ext"
# Test credentials for this run only, never printed
MEM_PASSWORD="E2e-$(openssl rand -hex 12)"
EXT_PASSWORD="E2e-$(openssl rand -hex 12)"
MEM_ID=""
EXT_ID=""
JAR_MEM=$(md_jar member)
JAR_EXT=$(md_jar ext)
FQDN=""
SITE_ID=""
SITE_GRANT=""
DIGEST=""

health_up() { [ "$(hosting_field "${PLUGIN}" '.hosting.health.state')" = "up" ]; }
# in_audience <userId> — the audience holds the user as an active member with the viewer role
in_audience() {
  [ "$(audience_row "${PLUGIN}" "$1" | jq -r '"\(.change.kind) \(.change.member.status) \(.change.member.roles | join(","))"' 2>/dev/null)" = "upsert active viewer" ]
}
# shell_for <jar> — the session gets the shell (index.html of tree v1)
shell_for() { [[ "$(visit_body "$(page "$1" /)")" == *"E2E_WEB_v1"* ]]; }
# shell_refused <jar> — the session gets a 403 on the shell
shell_refused() { [ "$(page_status "$1" /)" = "403" ]; }

# assert_api_forbidden <jar> <what> — the user surface's API: 403, JSON {error: forbidden}, no redirect
assert_api_forbidden() {
  local resp
  resp=$(page "$1" "${APP}/echo")
  assert_eq "$(visit_status "$resp")" "403" "$2: GET ${APP}/echo 403" || true
  assert_json_field "$(visit_body "$resp")" '.error' 'forbidden' "…JSON {error: forbidden} — granted access only, not 'not a member'" || true
  assert_not_contains "$(visit_headers "$resp" | tr '[:upper:]' '[:lower:]')" "location:" "…never a redirect" || true
}

# new_web_surface <access mode> — the plugin's web surface on B, created and served; SITE_ID set
new_web_surface() {
  local resp
  host_api_delete "plugins/${PLUGIN}/web-surface" > /dev/null 2>&1 || true
  resp=$(host_api_call POST "plugins/${PLUGIN}/web-surface" "{\"accessMode\":\"$1\"}")
  assert_eq "$(status_of "$resp")" "201" "POST /api/plugins/${PLUGIN}/web-surface {accessMode: $1}" || true
  SITE_ID=$(json_get "$(body_of "$resp")" '.webSurface.site.id // empty')
  assert_json_field "$(body_of "$resp")" '"\(.webSurface.site.fqdn) \(.webSurface.site.accessMode)"' "${FQDN} $1" "…the site ${FQDN}, $1, on B" || true
  if wait_for 120 web_served "${PLUGIN}"; then
    log_pass "…served"
  else
    log_fail "…not served: $(web_surface "${PLUGIN}" | jq -c '{served, reason}')"
  fi
}

begin_test "51 — External members: a plugin's web surface and audience (Three-VM)"

cleanup() {
  log_info "Cleaning up test resources..."
  local id
  if [ -n "${SITE_GRANT}" ]; then host_api_delete "gatekeeper/grants/${SITE_GRANT}" > /dev/null 2>&1 || true; fi
  host_api_delete "plugins/${PLUGIN}/web-surface" > /dev/null 2>&1 || true
  drop_plugin_grants "${PLUGIN}"
  for id in "${MEM}" "${EXT}"; do
    host_api_delete "users/${id}?erase=true" > /dev/null 2>&1 || true
  done
  for id in ${MEM_ID} ${EXT_ID}; do
    host_api_post "identity/directory/${id}/erase" '{}' > /dev/null 2>&1 || true
  done
  nudge_sync
  app_plugin_cleanup
  md_cleanup
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
log_section "Pre-flight"
# ---------------------------------------------------------------------------

app_plugin_preflight
md_setup
if agent_has_node_sqlite; then
  log_pass "The agent VM's Node.js has node:sqlite, which the agent half's projection needs"
else
  log_fail "The agent VM's Node.js has no unflagged node:sqlite (Node.js 22.13 or later): the identity fixture cannot run"
  end_test
  exit $?
fi
# Leftovers of an interrupted run (rodeo ends a spec at ten minutes without its trap)
host_api_delete "plugins/${PLUGIN}/web-surface" > /dev/null 2>&1 || true
drop_plugin_grants "${PLUGIN}"

# ===========================================================================
# 1. B, the users, the plugin on B
# ===========================================================================

log_section "Domain B; a member and an external member of B"

md_domain_active "${DOMAIN_2}"
FQDN="${SUB_W}.${DOMAIN_2}"
md_user MEM_ID "${MEM}" "${MEM_PASSWORD}" "[\"${DOMAIN_2}\"]"
md_user EXT_ID "${EXT}" "${EXT_PASSWORD}" "[{\"name\":\"${DOMAIN_2}\",\"kind\":\"external\"}]"
assert_eq "$(user_kinds "${EXT}")" "${DOMAIN_2}:external" "${EXT} is an external member of B" || true

log_section "The plugin installed, approved, hosted, moved to B"

LOCAL_TMP=$(mktemp -d /tmp/e2e-51-app-plugin-XXXXXXXX)
if ! write_app_install_fixture "${LOCAL_TMP}/ship/fixtures/xsurf" "${PLUGIN}" 1.0.0 main "r$(date +%s)-$$" '[]' none wide v1 "${SUB_W}"; then
  log_fail "The fixture could not be built (npm install at the workspace root, npm run build -w packages/core/lib)"
  end_test
  exit $?
fi
log_pass "Fixture built: ${SERVER_PACKAGE} (identity: viewer, editor; web surface ${SUB_W}, tree v1)"
ship_agent_facts_probe
start_stand_in_feria fixtures/xsurf/server fixtures/xsurf/agent
ensure_app_host_helper
open_push_install "${POLICY_ID}" "[\"${AGENT_PACKAGE}\"]" '["install","uninstall"]'

INSTALL=$(host_api_post "plugins/install" "{\"packageName\":\"${SERVER_PACKAGE}@1.0.0\"}")
assert_json_field "$INSTALL" '.plugin.version' '1.0.0' "Installed ${SERVER_PACKAGE}@1.0.0" || true
DIGEST=$(json_get "$(host_api_get "plugins/${PLUGIN}/hooks")" '.hooks.approval.digest // empty')
APPROVED=$(host_api_post "plugins/${PLUGIN}/hooks/approve" "{\"digest\":\"${DIGEST}\"}")
assert_json_field "$APPROVED" '.hooks.approval.state' 'approved' "Approved" || true
RESP=$(host_api_call PUT "plugins/${PLUGIN}/domain" "{\"domain\":\"${DOMAIN_2}\"}")
assert_eq "$(status_of "$RESP")" "200" "PUT /api/plugins/${PLUGIN}/domain {domain: B} (before any surface)" || true
assert_json_field "$(host_api_get "plugins/${PLUGIN}")" '.plugin.domain' "${DOMAIN_2}" "…it belongs to B" || true
host_api_post "plugins/${PLUGIN}/enable" '{}' > /dev/null
OP=$(host_plugin "${PLUGIN}" 300 nudge)
assert_json_field "$OP" '.status' 'succeeded' "Hosted on ${HOST_AGENT_LABEL} ($(json_get "$OP" '.error // .refused.error // ""'))" || true
if wait_for 60 health_up; then
  log_pass "The relay's health of the hosting is up"
else
  log_fail "Health: $(hosting_field "${PLUGIN}" '.hosting.health')"
fi
if wait_for 120 identity_ready "${PLUGIN}"; then
  log_pass "Ready: its agent half's first complete sync ended at the head"
else
  log_fail "Not ready: $(identity_view "${PLUGIN}" | jq -c '.readiness')"
fi

# ===========================================================================
# 2. The audience
# ===========================================================================

log_section "Both entitled as viewers: an external member counts toward the audience"

for u in "${MEM}" "${EXT}"; do
  RESP=$(host_api_call PUT "plugins/${PLUGIN}/entitlements" "{\"principalType\":\"user\",\"principalId\":\"${u}\",\"roles\":[\"viewer\"]}")
  assert_eq "$(status_of "$RESP")" "200" "${u} entitled as viewer" || true
done
if wait_for 30 in_audience "${MEM_ID}" && wait_for 30 in_audience "${EXT_ID}"; then
  log_pass "The audience holds both, active, as viewers — ${EXT} too"
else
  log_fail "The audience: $(audience_row "${PLUGIN}" "${MEM_ID}") $(audience_row "${PLUGIN}" "${EXT_ID}")"
fi
if wait_for 60 projection_has "${PLUGIN}" "[.users[] | select(.userId == \"${EXT_ID}\" and .status == \"active\")] | length == 1"; then
  log_pass "…and the agent half's projection, pushed through the tunnel: the plugin knows ${EXT} and their role"
else
  log_fail "The projection: $(projected_user "${PLUGIN}" "${EXT_ID}")"
fi
assert_json_field "$(projected_user "${PLUGIN}" "${EXT_ID}")" '"\(.username) \(.roles | join(","))"' "${EXT} viewer" "…${EXT}: viewer" || true

# ===========================================================================
# 3. An authenticated web surface
# ===========================================================================

log_section "An authenticated web surface: the member, not the external member"

new_web_surface authenticated
md_hosts "${FQDN}"
md_wait_authelia "${DOMAIN_2}"
SECRET_MEM=$(reset_totp "${MEM}")
SECRET_EXT=$(reset_totp "${EXT}")
md_sign_in "${MEM}" "${MEM_PASSWORD}" "${SECRET_MEM}" "${JAR_MEM}" "${FQDN}"
md_sign_in "${EXT}" "${EXT_PASSWORD}" "${SECRET_EXT}" "${JAR_EXT}" "${FQDN}"
AUTHELIA_PID=$(authelia_pid)

if wait_for 30 shell_for "${JAR_MEM}"; then
  log_pass "${MEM}: the shell (tree v1)"
else
  log_fail "${MEM} on the shell: $(page_status "${JAR_MEM}" /)"
fi
assert_json_field "$(visit_body "$(page "${JAR_MEM}" "${APP}/echo")")" '"\(.caller.type) \(.caller.userId) \(.caller.roles | join(","))"' "user ${MEM_ID} viewer" "${MEM}: the API, as the directory's user with the viewer role" || true

assert_access_request "$(page "${JAR_EXT}" /)" "${EXT}, entitled, on the authenticated shell"
assert_not_contains "$(visit_body "$(page "${JAR_EXT}" /)")" "E2E_WEB_" "…never the shell" || true
assert_api_forbidden "${JAR_EXT}" "${EXT}, entitled, on the authenticated surface"
assert_eq "$(user_groups "${EXT}")" "lamaste:x:$(domain_group_key "${DOMAIN_2}")" "users.yml names no host for ${EXT}" || true

# ===========================================================================
# 4. A restricted web surface
# ===========================================================================

log_section "A restricted web surface: the external member by the site's grant"

new_web_surface restricted
assert_access_request "$(page "${JAR_EXT}" /)" "${EXT}, without the site's grant, on the restricted shell"
assert_api_forbidden "${JAR_EXT}" "${EXT}, without the site's grant"
assert_eq "$(page_status "${JAR_MEM}" /)" "403" "${MEM}, a member without the site's grant, on the restricted shell: 403 (restricted names everyone)" || true

md_grant SITE_GRANT user "${EXT}" site "${SITE_ID}"
wait_group holds "${EXT}" "${FQDN}" "users.yml gives ${EXT} the site's hostname as a group"
if wait_for "${AUTHZ_SETTLE_SECONDS}" shell_for "${JAR_EXT}"; then
  log_pass "${EXT}, granted: the shell — the same session"
else
  log_fail "${EXT} on the shell, granted: $(page_status "${JAR_EXT}" /)"
fi
RESP=$(page "${JAR_EXT}" "${APP}/echo")
assert_eq "$(visit_status "$RESP")" "200" "${EXT}, granted: GET ${APP}/echo 200" || true
assert_json_field "$(visit_body "$RESP")" '"\(.caller.type) \(.caller.userId) \(.caller.username) \(.caller.roles | join(","))"' "user ${EXT_ID} ${EXT} viewer" "…the agent half sees the directory's user and their role" || true

RESP=$(host_api_call DELETE "gatekeeper/grants/${SITE_GRANT}")
assert_eq "$(status_of "$RESP")" "200" "The site's grant revoked" || true
SITE_GRANT=""
wait_group lacks "${EXT}" "${FQDN}" "users.yml takes the site's group from ${EXT}"
if wait_for "${AUTHZ_SETTLE_SECONDS}" shell_refused "${JAR_EXT}"; then
  log_pass "${EXT}, the grant revoked: 403 on the shell"
else
  log_fail "${EXT} on the shell, revoked: $(page_status "${JAR_EXT}" /)"
fi
assert_api_forbidden "${JAR_EXT}" "${EXT}, the grant revoked"
assert_eq "$(authelia_pid)" "${AUTHELIA_PID}" "Authelia was not restarted by the grant or its revocation" || true

end_test

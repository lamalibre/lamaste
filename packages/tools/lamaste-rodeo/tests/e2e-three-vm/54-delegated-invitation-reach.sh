#!/usr/bin/env bash
# ============================================================================
# 54 — Delegated invitations: an invitee reaches only that plugin's site (Three-VM)
# ============================================================================
# The second proof of delegated invitations (design: packages/core/docs/
# delegated-invitations-design.md, "Proof"). What an invitation grants is a
# plugin's site and one role, and nothing else on the relay. On B: two app
# plugins, each with its own restricted web surface; an authenticated tunnel
# and a restricted one; an OIDC client of the domain. On A: an authenticated
# tunnel.
#
# A coordinator of the first plugin invites a colleague, who accepts. The
# invitee then reaches that plugin's shell and API, and:
# - the second plugin's surface: the access-request page and 403 forbidden —
#   on the shell, and on its API, whose grant they do not hold;
# - B's authenticated tunnel: the access-request page; B's restricted tunnel
#   the same, with no grant on it;
# - A's tunnel: the domain refusal, signed in at A's portal;
# - the OIDC client of B: Authelia refuses their authorization (access_denied)
#   where a member of B is admitted, and users.yml gives them no client group;
# - the inviter's API: they are no inviter (403 role_not_grantable) and
#   cannot see anything of it;
# - the admin panel: no certificate, nothing.
# Nothing here restarts Authelia.
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../e2e/helpers.sh"
# shellcheck source-path=SCRIPTDIR source=app-plugin-harness.sh
source "${SCRIPT_DIR}/app-plugin-harness.sh"
MD_SPEC=54
# shellcheck source-path=SCRIPTDIR source=multi-domain-harness.sh
source "${SCRIPT_DIR}/multi-domain-harness.sh"
# shellcheck source-path=SCRIPTDIR source=invitation-harness.sh
source "${SCRIPT_DIR}/invitation-harness.sh"

require_commands multipass curl jq node npm tar perl openssl

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

PLUGIN="e2e-xinv"
SERVER_PACKAGE="@lamalibre/e2e-xinv-server"
AGENT_PACKAGE="@lamalibre/e2e-xinv-agent"
OTHER="e2e-xoth"
OTHER_SERVER="@lamalibre/e2e-xoth-server"
OTHER_AGENT="@lamalibre/e2e-xoth-agent"
OIDC_PLUGIN="e2e-emoidc"
OIDC_PACKAGE="@lamalibre/e2e-emoidc-server"
WEB_ID="e2e-emoidc-web"
REDIRECT_URI="https://e2e-emoidc.example.test/callback"
APP="/api/${PLUGIN}/app"
OTHER_APP="/api/${OTHER}/app"
SUB_W="e2e54web"
SUB_OTHER="e2e54oth"
SUB_T="e2e54auth"
SUB_R="e2e54res"
SUB_A="e2e54a"
PORT_T=19954
PORT_R=19955
PORT_A=19956
POLICY_ID="e2e-apphost-54"
REMOTE_DIR="/var/tmp/e2e-54-app-plugin"
LOCAL_TMP=""
CLEAN_PLUGINS="${PLUGIN} ${OTHER} ${OIDC_PLUGIN}"
CLEAN_ROUTES="${PLUGIN} ${OTHER}"
PURGE_PACKAGES=""
COORD="e2e54-coord"
# Both meet the OIDC client: Authelia keeps an opaque identifier for a username
# that asked, and such a name is never given out again. A new one each run.
MEM="e2e54-member-$(date +%s)"
INVITEE="e2e54-invitee-$(date +%s)"
# Test credentials for this run only, never printed
PASSWORD="E2e-$(openssl rand -hex 12)"
INVITEE_PASSWORD="E2e-$(openssl rand -hex 12)"
COORD_ID=""
MEM_ID=""
INVITEE_ID=""
JAR_COORD=$(md_jar coord)
JAR_MEM=$(md_jar member)
JAR_INV=$(md_jar invitee)
JAR_INV_A=$(md_jar invitee-a)
FQDN=""
FQDN_OTHER=""
OTHER_SITE=""
TUNNEL_T=""
TUNNEL_R=""
TUNNEL_A=""
COORD_GRANT=""
AUDIT_BASE=0
TOKEN=""
INV_ID=""

# shell_for <jar> — the session gets the first plugin's shell (index.html of tree v1)
shell_for() { [[ "$(visit_body "$(page "$1" /)")" == *"E2E_WEB_v1"* ]]; }

# assert_forbidden <url> <what> — as the invitee: 403, JSON {error: forbidden}, no redirect
assert_forbidden() {
  local resp
  resp=$(visit "${JAR_INV}" "$1")
  assert_eq "$(visit_status "$resp")" "403" "$2: 403" || true
  assert_json_field "$(visit_body "$resp")" '.error' 'forbidden' "…JSON {error: forbidden}, not 'not a member': they are on the domain" || true
  assert_not_contains "$(visit_headers "$resp" | tr '[:upper:]' '[:lower:]')" "location:" "…never a redirect" || true
}

# authorize <jar> — an authorization request of the web client at auth.<B>
# with the session in <jar>; prints Authelia's Location
authorize() {
  local verifier challenge state
  verifier=$(openssl rand -hex 32)
  challenge=$(printf '%s' "$verifier" | openssl dgst -sha256 -binary | openssl base64 -A | tr '+/' '-_' | tr -d '=')
  state=$(openssl rand -hex 16)
  visitor_exec "curl -sk --max-time 15 -b $(printf %q "$1") -o /dev/null -w '%{redirect_url}' -G --data-urlencode $(printf %q "client_id=${WEB_ID}") --data-urlencode $(printf %q "redirect_uri=${REDIRECT_URI}") --data-urlencode response_type=code --data-urlencode $(printf %q 'scope=openid profile') --data-urlencode $(printf %q "state=${state}") --data-urlencode $(printf %q "code_challenge=${challenge}") --data-urlencode code_challenge_method=S256 https://auth.${DOMAIN_2}/api/oidc/authorization 2>/dev/null || true" 2>/dev/null | tail -n 1
}

begin_test "54 — Delegated invitations: an invitee reaches only that plugin's site (Three-VM)"

cleanup() {
  log_info "Cleaning up test resources..."
  local id
  if [ -n "${COORD_GRANT}" ]; then host_api_delete "gatekeeper/grants/${COORD_GRANT}" > /dev/null 2>&1 || true; fi
  if [ -n "${SITE_ID}" ]; then inv_drop_site_grants "${SITE_ID}"; fi
  for id in ${TUNNEL_T} ${TUNNEL_R} ${TUNNEL_A}; do
    host_api_delete "tunnels/${id}" > /dev/null 2>&1 || true
  done
  md_backend_stop "${PORT_T}" "${PORT_R}" "${PORT_A}"
  host_api_delete "plugins/${PLUGIN}/web-surface" > /dev/null 2>&1 || true
  host_api_delete "plugins/${OTHER}/web-surface" > /dev/null 2>&1 || true
  drop_plugin_grants "${PLUGIN}"
  drop_plugin_grants "${OTHER}"
  inv_cleanup_users "${COORD}" "${MEM}" "${INVITEE}"
  inv_cleanup_ids ${COORD_ID} ${MEM_ID} ${INVITEE_ID}
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
host_api_delete "plugins/${PLUGIN}/web-surface" > /dev/null 2>&1 || true
host_api_delete "plugins/${OTHER}/web-surface" > /dev/null 2>&1 || true
drop_plugin_grants "${PLUGIN}"
drop_plugin_grants "${OTHER}"

# ===========================================================================
# 1. What is on the relay
# ===========================================================================

log_section "Domain B; a coordinator (external) and a member"

md_domain_active "${DOMAIN_2}"
FQDN="${SUB_W}.${DOMAIN_2}"
FQDN_OTHER="${SUB_OTHER}.${DOMAIN_2}"
md_user COORD_ID "${COORD}" "${PASSWORD}" "[{\"name\":\"${DOMAIN_2}\",\"kind\":\"external\"}]"
md_user MEM_ID "${MEM}" "${PASSWORD}" "[\"${DOMAIN_2}\"]"

log_section "Two app plugins on B, each with its restricted web surface; an OIDC client of B"

LOCAL_TMP=$(mktemp -d /tmp/e2e-54-app-plugin-XXXXXXXX)
if ! write_app_install_fixture "${LOCAL_TMP}/ship/fixtures/xinv" "${PLUGIN}" 1.0.0 main "r$(date +%s)-$$" '[]' none inviting v1 "${SUB_W}" ||
  ! write_app_install_fixture "${LOCAL_TMP}/ship/fixtures/xoth" "${OTHER}" 1.0.0 main "o$(date +%s)-$$" '[]' none inviting v2 "${SUB_OTHER}"; then
  log_fail "The fixtures could not be built (npm install at the workspace root, npm run build -w packages/core/lib)"
  end_test
  exit $?
fi
write_oidc_grant_fixture_plugin "${LOCAL_TMP}/ship/fixtures/emoidc"
log_pass "Fixtures built: ${SERVER_PACKAGE}, ${OTHER_SERVER}, ${OIDC_PACKAGE}"
ship_agent_facts_probe
start_stand_in_feria fixtures/xinv/server fixtures/xinv/agent fixtures/xoth/server fixtures/xoth/agent fixtures/emoidc
ensure_app_host_helper
open_push_install "${POLICY_ID}" "[\"${AGENT_PACKAGE}\",\"${OTHER_AGENT}\"]" '["install","uninstall"]'
inv_install "${PLUGIN}" "${SERVER_PACKAGE}" "${AGENT_PACKAGE}"
inv_install "${OTHER}" "${OTHER_SERVER}" "${OTHER_AGENT}"
inv_web_surface SITE_ID "${PLUGIN}" "${FQDN}" restricted
inv_web_surface OTHER_SITE "${OTHER}" "${FQDN_OTHER}" restricted
md_hosts "${FQDN}" "${FQDN_OTHER}"

RESP=$(host_api_post "plugins/install" "{\"packageName\":\"${OIDC_PACKAGE}@0.1.0\"}")
assert_json_field "$RESP" '.plugin.version' '0.1.0' "Installed ${OIDC_PACKAGE}" || true
RESP=$(API_TIMEOUT=90 host_api_call PUT "plugins/${OIDC_PLUGIN}/domain" "{\"domain\":\"${DOMAIN_2}\"}")
assert_eq "$(status_of "$RESP")" "200" "…on B" || true
RESP=$(API_TIMEOUT=90 host_api_call POST "plugins/${OIDC_PLUGIN}/enable" '{}')
assert_eq "$(status_of "$RESP")" "200" "…enabled: B has an OIDC client" || true

log_section "Tunnels on B (authenticated, restricted) and on A (authenticated)"

md_tunnel TUNNEL_T "${SUB_T}" "${DOMAIN_2}" "${PORT_T}" authenticated
md_tunnel TUNNEL_R "${SUB_R}" "${DOMAIN_2}" "${PORT_R}" restricted
md_tunnel TUNNEL_A "${SUB_A}" "${DOMAIN}" "${PORT_A}" authenticated
md_backends "${PORT_T}:E2E54_B_AUTH" "${PORT_R}:E2E54_B_RESTRICTED" "${PORT_A}:E2E54_A_AUTH"

# ===========================================================================
# 2. The invitation
# ===========================================================================

log_section "The coordinator invites a colleague; they accept"

inv_entitle "${COORD}" coordinator
md_grant COORD_GRANT user "${COORD}" site "${SITE_ID}"
inv_wait_audience "${COORD_ID}" coordinator "The audience holds ${COORD} as coordinator"
RESP=$(inv_policy "{\"enabled\":true,\"emailDomains\":[\"${INV_MAIL}\"]}")
assert_eq "$(status_of "$RESP")" "200" "Invitations enabled for ${PLUGIN}" || true
md_wait_authelia "${DOMAIN_2}"
md_wait_authelia "${DOMAIN}"
md_sign_in "${COORD}" "${PASSWORD}" "$(reset_totp "${COORD}")" "${JAR_COORD}" "${FQDN}"
md_sign_in "${MEM}" "${PASSWORD}" "$(reset_totp "${MEM}")" "${JAR_MEM}" "${FQDN}"
inv_new TOKEN INV_ID "${JAR_COORD}" "deniz@${INV_MAIL}" viewer "${COORD} invites deniz@${INV_MAIL} as viewer"
RESP=$(inv_accept "${TOKEN}" "${INVITEE}" "${INVITEE_PASSWORD}")
assert_eq "$(visit_status "$RESP")" "200" "Accepted" || true
assert_json_field "$(visit_body "$RESP")" '.accessPending' 'false' "…access complete" || true
SECRET=$(inv_secret "$RESP")
INVITEE_ID=$(json_get "$(inv_row "${INV_ID}")" '.acceptedUserId // empty')
assert_eq "$(is_uuid "${INVITEE_ID}")" "true" "…a directory user" || true
wait_group holds "${INVITEE}" "${FQDN}" "users.yml gives them the site's hostname"
md_sign_in "${INVITEE}" "${INVITEE_PASSWORD}" "${SECRET}" "${JAR_INV}" "${FQDN}"
AUTHELIA_PID=$(authelia_pid)

# ===========================================================================
# 3. That plugin's site
# ===========================================================================

log_section "That plugin's site: the shell and the API"

if wait_for "${AUTHZ_SETTLE_SECONDS}" shell_for "${JAR_INV}"; then
  log_pass "${INVITEE}: the shell"
else
  log_fail "${INVITEE} on the shell: $(page_status "${JAR_INV}" /)"
fi
assert_json_field "$(visit_body "$(page "${JAR_INV}" "${APP}/echo")")" '"\(.caller.type) \(.caller.username) \(.caller.roles | join(","))"' "user ${INVITEE} viewer" "…the API, as a viewer" || true

# ===========================================================================
# 4. Nothing else
# ===========================================================================

log_section "Nothing else on B: the other plugin"

assert_access_request "$(visit "${JAR_INV}" "https://${FQDN_OTHER}/")" "${INVITEE} on the other plugin's shell"
assert_not_contains "$(visit_body "$(visit "${JAR_INV}" "https://${FQDN_OTHER}/")")" "E2E_WEB_" "…never its tree" || true
assert_forbidden "https://${FQDN_OTHER}${OTHER_APP}/echo" "${INVITEE} on the other plugin's API"
assert_eq "$(audience_row "${OTHER}" "${INVITEE_ID}")" "null" "The other plugin's audience does not hold them" || true
assert_json_field "$(projection "${OTHER}")" "[.users[]? | select(.userId == \"${INVITEE_ID}\")] | length" '0' "…nor its agent half" || true

log_section "Nothing else on B: its tunnels"

assert_access_request "$(visit "${JAR_INV}" "https://${SUB_T}.${DOMAIN_2}/")" "${INVITEE} on B's authenticated tunnel"
assert_not_contains "$(visit_body "$(visit "${JAR_INV}" "https://${SUB_T}.${DOMAIN_2}/")")" "E2E54_B_AUTH" "…never its backend" || true
assert_served "${JAR_MEM}" "https://${SUB_T}.${DOMAIN_2}/" "E2E54_B_AUTH" "${MEM}, a member of B, on the same tunnel"
assert_access_request "$(visit "${JAR_INV}" "https://${SUB_R}.${DOMAIN_2}/")" "${INVITEE} on B's restricted tunnel"
assert_not_contains "$(visit_body "$(visit "${JAR_INV}" "https://${SUB_R}.${DOMAIN_2}/")")" "E2E54_B_RESTRICTED" "…never its backend" || true

log_section "Nothing on A"

md_hosts "${SUB_A}.${DOMAIN}"
md_sign_in "${INVITEE}" "${INVITEE_PASSWORD}" "${SECRET}" "${JAR_INV_A}" "${SUB_A}.${DOMAIN}"
RESP=$(visit "${JAR_INV_A}" "https://${SUB_A}.${DOMAIN}/")
assert_domain_refusal "$RESP" "${DOMAIN}" "${INVITEE}, signed in at A's portal, on A's tunnel"
assert_not_contains "$(visit_body "$RESP")" "E2E54_A_AUTH" "…never its backend" || true

log_section "Nothing through OIDC: no client of the domain admits them"

LOCATION=$(authorize "${JAR_MEM}")
if [ -n "${LOCATION}" ] && [[ "${LOCATION}" != *"error="* ]]; then
  log_pass "${MEM}, a member of B: the client's authorization request goes on"
else
  log_fail "${MEM}: ${LOCATION}"
fi
assert_contains "$(authorize "${JAR_INV}")" "error=access_denied" "${INVITEE}: refused (access_denied)" || true
assert_eq "$(user_groups "${INVITEE}")" "$(printf '%s\n' "${FQDN}" "lamaste:x:$(domain_group_key "${DOMAIN_2}")" | sort | paste -sd, -)" "users.yml gives them the site's hostname and the external group, no client" || true

log_section "They invite no one, and the panel is not theirs"

RESP=$(inv_api "${JAR_INV}" POST "" "{\"email\":\"someone@${INV_MAIL}\",\"role\":\"viewer\"}")
assert_eq "$(visit_status "$RESP")" "403" "${INVITEE}, a viewer, on the inviter's API: 403" || true
assert_json_field "$(visit_body "$RESP")" '.code' 'role_not_grantable' "…role_not_grantable" || true
assert_json_field "$(visit_body "$(inv_api "${JAR_INV}" GET)")" '.invitations | length' '0' "…and sees nothing of ${COORD}'s invitations" || true
assert_not_eq "$(visit_status "$(visit "${JAR_INV}" "https://panel.${DOMAIN}/api/users")")" "200" "The admin panel's API, their session cookie and no certificate: not 200" || true

log_section "Nothing restarted Authelia"

assert_eq "$(authelia_pid)" "${AUTHELIA_PID}" "Authelia's MainPID unchanged" || true

end_test

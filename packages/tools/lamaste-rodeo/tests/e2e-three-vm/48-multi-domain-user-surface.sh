#!/usr/bin/env bash
# ============================================================================
# 48 — Multi-domain relay: a plugin's user surface on another domain (Three-VM)
# ============================================================================
# The customer case of spec 46, on a plugin's user surface (slice 6): split
# out because installing and hosting an app plugin alone takes minutes, and
# rodeo ends a spec at ten minutes. A is the relay's primary domain, B a
# second one (multi-domain-harness.sh).
#
# An app plugin whose manifest declares identity (fixture
# @lamalibre/e2e-mdsurf-server, helpers.sh: write_app_install_fixture …
# wide, as spec 40's) belongs to A — a plugin's domain is the primary unless
# moved. Its user surface is bound to an authenticated tunnel on A.
#
# 1. A member of A with the viewer role: /api/<route>/app/echo answers with
#    the caller the panel signed.
# 2. A customer, member of B only, signed in at auth.A with valid
#    credentials: 403, JSON {error: not_a_member} — an application's
#    request gets an answer it can act on, never a page or a redirect.
# 3. The plugin cannot be moved to B while it is served on A's host (409).
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../e2e/helpers.sh"
# shellcheck source-path=SCRIPTDIR source=app-plugin-harness.sh
source "${SCRIPT_DIR}/app-plugin-harness.sh"
# shellcheck source-path=SCRIPTDIR source=multi-domain-harness.sh
source "${SCRIPT_DIR}/multi-domain-harness.sh"

require_commands multipass curl jq node npm tar perl openssl

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

PLUGIN="e2e-mdsurf"
SERVER_PACKAGE="@lamalibre/e2e-mdsurf-server"
AGENT_PACKAGE="@lamalibre/e2e-mdsurf-agent"
APP="/api/${PLUGIN}/app"
POLICY_ID="e2e-apphost-48"
REMOTE_DIR="/var/tmp/e2e-48-app-plugin"
LOCAL_TMP=""
CLEAN_PLUGINS="${PLUGIN}"
CLEAN_ROUTES="${PLUGIN}"
PURGE_PACKAGES=""
MEMBER="e2e48-member"
CUST="e2e48-cust"
# Test credentials for this run only, never printed
MEMBER_PASSWORD="E2e-$(openssl rand -hex 12)"
CUST_PASSWORD="E2e-$(openssl rand -hex 12)"
MEMBER_ID=""
CUST_ID=""
JAR_MEMBER="/tmp/e2e-48-member.cookies"
JAR_CUST="/tmp/e2e-48-cust.cookies"
SUB_A="e2e48us"
PORT_A=18481
TUNNEL_A=""
FQDN=""
DIGEST=""

health_up() { [ "$(hosting_field "${PLUGIN}" '.hosting.health.state')" = "up" ]; }
member_in_audience() {
  [ "$(audience_row "${PLUGIN}" "${MEMBER_ID}" | jq -r '"\(.change.kind) \(.change.member.status)"' 2>/dev/null)" = "upsert active" ]
}

begin_test "48 — Multi-domain relay: a plugin's user surface on another domain (Three-VM)"

cleanup() {
  log_info "Cleaning up test resources..."
  local id
  drop_plugin_grants "${PLUGIN}"
  if [ -n "${TUNNEL_A}" ]; then host_api_delete "tunnels/${TUNNEL_A}" > /dev/null 2>&1 || true; fi
  for id in "${MEMBER}" "${CUST}"; do
    host_api_delete "users/${id}?erase=true" > /dev/null 2>&1 || true
  done
  timed_exec 30 multipass exec "${VISITOR_VM}" -- sudo bash -c "rm -f ${JAR_MEMBER} ${JAR_CUST}; true" > /dev/null 2>&1
  nudge_sync
  app_plugin_cleanup
  md_cleanup_domains
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
log_section "Pre-flight"
# ---------------------------------------------------------------------------

app_plugin_preflight
md_preflight
FQDN="${SUB_A}.${DOMAIN}"
if agent_has_node_sqlite; then
  log_pass "The agent VM's Node.js has node:sqlite, which the agent half's projection needs"
else
  log_fail "The agent VM's Node.js has no unflagged node:sqlite (Node.js 22.13 or later): the identity fixture cannot run"
  end_test
  exit $?
fi
drop_plugin_grants "${PLUGIN}"

# ===========================================================================
# 1. Domain B, the users, the plugin
# ===========================================================================

log_section "Domain B; a member of A and a customer of B; the plugin installed on A"

md_domain_active "${DOMAIN_2}"
# Every users.yml write of the spec, before anyone signs in.
md_user MEMBER_ID "${MEMBER}" "${MEMBER_PASSWORD}" "[\"${DOMAIN}\"]"
md_user CUST_ID "${CUST}" "${CUST_PASSWORD}" "[\"${DOMAIN_2}\"]"
assert_eq "$(is_uuid "${MEMBER_ID}") $(is_uuid "${CUST_ID}")" "true true" "Both have a directory id" || true

LOCAL_TMP=$(mktemp -d /tmp/e2e-48-app-plugin-XXXXXXXX)
if ! write_app_install_fixture "${LOCAL_TMP}/ship/fixtures/surf" "${PLUGIN}" 1.0.0 main "r$(date +%s)-$$" '[]' none wide; then
  log_fail "The fixture could not be built (npm install at the workspace root, npm run build -w packages/core/lib)"
  end_test
  exit $?
fi
log_pass "Fixture built: ${SERVER_PACKAGE} (identity: viewer, editor) and its agent package"
ship_agent_facts_probe
start_stand_in_feria fixtures/surf/server fixtures/surf/agent
ensure_app_host_helper
open_push_install "${POLICY_ID}" "[\"${AGENT_PACKAGE}\"]" '["install","uninstall"]'

INSTALL=$(host_api_post "plugins/install" "{\"packageName\":\"${SERVER_PACKAGE}@1.0.0\"}")
assert_json_field "$INSTALL" '.plugin.version' '1.0.0' "Installed ${SERVER_PACKAGE}@1.0.0" || true
assert_json_field "$(host_api_get "plugins/${PLUGIN}")" '.plugin.domain' "${DOMAIN}" "…it belongs to the primary domain A" || true
DIGEST=$(json_get "$INSTALL" '.hooks.approval.digest // empty')
APPROVED=$(host_api_post "plugins/${PLUGIN}/hooks/approve" "{\"digest\":\"${DIGEST}\"}")
assert_json_field "$APPROVED" '.hooks.approval.state' 'approved' "Approved" || true
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
# 2. The user surface on A
# ===========================================================================

log_section "Bound to an authenticated tunnel on A; the member entitled"

md_tunnel TUNNEL_A "${SUB_A}" "${DOMAIN}" "${PORT_A}" authenticated
RESP=$(host_api_call PUT "tunnels/${TUNNEL_A}/user-surface" "{\"route\":\"${PLUGIN}\"}")
assert_eq "$(status_of "$RESP")" "200" "PUT /api/tunnels/${TUNNEL_A}/user-surface {route: ${PLUGIN}}" || true
assert_json_field "$(body_of "$RESP")" '.tunnel.userSurfaceStatus[0] | "\(.route) \(.served)"' "${PLUGIN} true" "…served" || true
RESP=$(host_api_call PUT "plugins/${PLUGIN}/entitlements" "{\"principalType\":\"user\",\"principalId\":\"${MEMBER}\",\"roles\":[\"viewer\"]}")
assert_eq "$(status_of "$RESP")" "200" "${MEMBER} entitled as viewer" || true
if wait_for 30 member_in_audience; then
  log_pass "…an active member of the audience"
else
  log_fail "The audience: $(audience_row "${PLUGIN}" "${MEMBER_ID}")"
fi

# ===========================================================================
# 3. A member, and a customer of B
# ===========================================================================

log_section "The member reaches the agent half; the customer of B gets JSON not_a_member"

md_wait_authelia "${DOMAIN}"
SECRET_M=$(reset_totp "${MEMBER}")
SECRET_C=$(reset_totp "${CUST}")
wait_for_next_totp_window
md_sign_in "${MEMBER}" "${MEMBER_PASSWORD}" "${SECRET_M}" "${JAR_MEMBER}" "${FQDN}" "${DOMAIN}"
md_sign_in "${CUST}" "${CUST_PASSWORD}" "${SECRET_C}" "${JAR_CUST}" "${FQDN}" "${DOMAIN}"

RESP=$(visit "${JAR_MEMBER}" "https://${FQDN}${APP}/echo")
assert_eq "$(visit_status "$RESP")" "200" "GET ${APP}/echo as ${MEMBER}: 200" || true
assert_json_field "$(visit_body "$RESP")" '"\(.caller.type) \(.caller.userId) \(.caller.username)"' "user ${MEMBER_ID} ${MEMBER}" "…the caller the panel signed" || true

RESP=$(visit "${JAR_CUST}" "https://${FQDN}${APP}/echo")
assert_eq "$(visit_status "$RESP")" "403" "GET ${APP}/echo as ${CUST} (a member of B only): 403" || true
assert_json_field "$(visit_body "$RESP")" '.error' 'not_a_member' "…JSON {error: not_a_member}" || true
assert_not_contains "$(visit_headers "$RESP" | tr '[:upper:]' '[:lower:]')" "location:" "…never a redirect" || true
assert_not_contains "$(visit_body "$RESP")" "${MEMBER}" "…and nothing of another user" || true

# ===========================================================================
# 4. A served plugin keeps its domain
# ===========================================================================

log_section "The plugin cannot move to B while it is served on A"

RESP=$(host_api_call PUT "plugins/${PLUGIN}/domain" "{\"domain\":\"${DOMAIN_2}\"}")
assert_eq "$(status_of "$RESP")" "409" "PUT /api/plugins/${PLUGIN}/domain {domain: B}: 409 while bound on A" || true
assert_json_field "$(body_of "$RESP")" '.code' 'surface_bound' "…surface_bound" || true
assert_json_field "$(host_api_get "plugins/${PLUGIN}")" '.plugin.domain' "${DOMAIN}" "…it still belongs to A" || true

end_test

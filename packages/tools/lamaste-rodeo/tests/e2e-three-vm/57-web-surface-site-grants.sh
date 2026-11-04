#!/usr/bin/env bash
# ============================================================================
# 57 — Web surface site grants (Three-VM)
# ============================================================================
# A restricted web surface admits a member of the plugin's audience only
# with a Gatekeeper `site` grant on its site — to them, or to a Lamaste group
# they are in. A role alone lets nobody in. The administrator gives and
# revokes these grants through the panel's Gatekeeper proxy and
# `lamaste-server plugins web-surface <name> grants|grant|revoke`, and the
# web surface's status names the entitled members no grant admits. The
# fixture (@lamalibre/e2e-sitegrant-server, helpers.sh:
# write_app_install_fixture … wide v1) declares identity and
# `userSurface.web` on e2e57web. From the visitor VM:
#
# 1. A restricted surface, a user and a Lamaste group entitled: the status
#    lists no grant and both members without one; both get the
#    access-request page.
# 2. The proxy refuses a site grant on no site (unknown_site) and on a
#    static site (site_not_grantable).
# 3. `grant --user` through the CLI admits the user, not the group's member;
#    a group grant through the proxy admits the member; a second grant
#    changes nothing; both are audited, the user by directory id.
# 4. `revoke --group` through the CLI shuts the member out again; revoking
#    every grant of the user (the bulk route) audits the site grant among
#    them; a revocation of a grant nobody holds is refused.
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

PLUGIN="e2e-sitegrant"
SERVER_PACKAGE="@lamalibre/e2e-sitegrant-server"
AGENT_PACKAGE="@lamalibre/e2e-sitegrant-agent"
SUB_W="e2e57web"
STATIC_SITE="e2e57static"
POLICY_ID="e2e-apphost-57"
REMOTE_DIR="/var/tmp/e2e-57-app-plugin"
LOCAL_TMP=""
CLEAN_PLUGINS="${PLUGIN}"
CLEAN_ROUTES="${PLUGIN}"
PURGE_PACKAGES=""
MEMBER="e2e57-member"
GROUPIE="e2e57-groupie"
TEAM="e2e57-team"
# Test credentials for this run only, never printed
MEMBER_PASSWORD="E2e-$(openssl rand -hex 12)"
GROUPIE_PASSWORD="E2e-$(openssl rand -hex 12)"
JAR_MEMBER="/tmp/e2e-57-member.cookies"
JAR_GROUPIE="/tmp/e2e-57-groupie.cookies"
FQDN=""
MEMBER_ID=""
GROUPIE_ID=""
SITE_ID=""
STATIC_ID=""
AUDIT_BASE=0

# shell_status <jar> — what GET / on the web surface answers that visitor
shell_status() { page_status "$1" /; }
shell_answers() { [ "$(shell_status "$1")" = "$2" ]; }
site_answers() { [ "$(page_status - /)" = "$1" ]; }

# in_audience <userId> — the audience holds the user as an active member
in_audience() {
  [ "$(audience_row "${PLUGIN}" "$1" | jq -r '"\(.change.kind) \(.change.member.status)"' 2>/dev/null)" = "upsert active" ]
}

# site_view — the web surface's site, with its grants ('null' when none)
site_view() { web_surface "${PLUGIN}" | jq -c '.site // null' 2>/dev/null || echo "null"; }

# without_grant — the usernames of the members no grant admits, comma-separated
without_grant() { site_view | jq -r '[.membersWithoutGrant[]?.username] | join(",")' 2>/dev/null || echo "?"; }
without_grant_is() { [ "$(without_grant)" = "$1" ]; }

# grants_of — the site's grants as `type:id`, sorted, comma-separated
grants_of() { site_view | jq -r '[.grants[]? | "\(.principalType):\(.principalId)"] | sort | join(",")' 2>/dev/null || echo "?"; }

# cli <arguments> — lamaste-server on the host VM with --json; its last line
cli() {
  timed_exec 90 multipass exec "${HOST_VM}" -- sudo bash -c "lamaste-server $* --json 2>&1" 2>/dev/null | tail -n 1
}

# site_audits <action> [jq filter on details] — the spec's site-grant audit entries
site_audits() { audit_count "${PLUGIN}" "plugin.web-surface.grant.$1" "${2:-true}"; }

begin_test "57 — Web surface site grants (Three-VM)"

cleanup() {
  log_info "Cleaning up test resources..."
  local id
  drop_plugin_grants "${PLUGIN}"
  if [ -n "${STATIC_ID}" ]; then
    host_api_delete "sites/${STATIC_ID}" > /dev/null 2>&1 || true
  fi
  host_api_delete "gatekeeper/groups/${TEAM}" > /dev/null 2>&1 || true
  timed_exec 60 multipass exec "${VISITOR_VM}" -- sudo bash -c "rm -f ${JAR_MEMBER} ${JAR_GROUPIE}; sed -i '/${SUB_W}\\./d' /etc/hosts; true" > /dev/null 2>&1
  for id in "${MEMBER}" "${GROUPIE}"; do
    host_api_delete "users/${id}?erase=true" > /dev/null 2>&1 || true
  done
  for id in ${MEMBER_ID} ${GROUPIE_ID}; do
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
host_api_delete "gatekeeper/groups/${TEAM}" > /dev/null 2>&1 || true
for id in $(host_api_get "sites?limit=500" 2>/dev/null | jq -r --arg n "${STATIC_SITE}" '.sites[]? | select(.name == $n) | .id' 2>/dev/null || true); do
  host_api_delete "sites/${id}" > /dev/null 2>&1 || true
done
for user in "${MEMBER}" "${GROUPIE}"; do
  host_api_delete "users/${user}?erase=true" > /dev/null 2>&1 || true
done
AUDIT_BASE=$(host_api_get "audit?limit=1" | jq '.entries[0].id // 0' 2>/dev/null || echo "0")

# ===========================================================================
# 1. A restricted surface; a user and a group entitled, no site grant
# ===========================================================================

log_section "Fixtures, users and a group; a restricted web surface, served"

LOCAL_TMP=$(mktemp -d /tmp/e2e-57-app-plugin-XXXXXXXX)
FIXTURES="built"
write_app_install_fixture "${LOCAL_TMP}/ship/fixtures/v100" "${PLUGIN}" 1.0.0 main "r$(date +%s)-$$" '[]' none wide v1 "${SUB_W}" || FIXTURES="failed"
if [ "$FIXTURES" != "built" ]; then
  log_fail "The fixtures could not be built (npm install at the workspace root, npm run build -w packages/core/lib)"
  end_test
  exit $?
fi
log_pass "Fixture built: ${SERVER_PACKAGE} 1.0.0 with a web tree"
ship_agent_facts_probe
start_stand_in_feria fixtures/v100/server fixtures/v100/agent
ensure_app_host_helper
open_push_install "${POLICY_ID}" "[\"${AGENT_PACKAGE}\"]" '["install","uninstall"]'

RESP=$(users_call POST "users" "{\"username\":\"${MEMBER}\",\"displayname\":\"E2E Member\",\"email\":\"${MEMBER}@example.test\",\"password\":\"${MEMBER_PASSWORD}\",\"groups\":[]}")
assert_eq "$(status_of "$RESP")" "201" "User ${MEMBER} created" || true
MEMBER_ID=$(json_get "$(body_of "$RESP")" '.user.userId // empty')
RESP=$(users_call POST "users" "{\"username\":\"${GROUPIE}\",\"displayname\":\"E2E Groupie\",\"email\":\"${GROUPIE}@example.test\",\"password\":\"${GROUPIE_PASSWORD}\",\"groups\":[]}")
assert_eq "$(status_of "$RESP")" "201" "User ${GROUPIE} created — to reach the plugin through a Lamaste group" || true
GROUPIE_ID=$(json_get "$(body_of "$RESP")" '.user.userId // empty')
RESP=$(host_api_call POST "gatekeeper/groups" "{\"name\":\"${TEAM}\",\"description\":\"Spec 57\"}")
assert_eq "$(status_of "$RESP")" "201" "Lamaste group ${TEAM} created" || true
RESP=$(host_api_call POST "gatekeeper/groups/${TEAM}/members" "{\"usernames\":[\"${GROUPIE}\"]}")
assert_eq "$(status_of "$RESP")" "200" "…with ${GROUPIE} in it" || true

INSTALL=$(host_api_post "plugins/install" "{\"packageName\":\"${SERVER_PACKAGE}@1.0.0\"}")
assert_json_field "$INSTALL" '.plugin.version' '1.0.0' "Installed ${SERVER_PACKAGE}@1.0.0" || true
DIGEST=$(json_get "$(host_api_get "plugins/${PLUGIN}/hooks")" '.hooks.approval.digest // empty')
RESP=$(host_api_call POST "plugins/${PLUGIN}/web-surface" '{"accessMode":"restricted"}')
assert_eq "$(status_of "$RESP")" "201" "Its web surface created, restricted" || true
SITE_ID=$(json_get "$(body_of "$RESP")" '.webSurface.site.id // empty')
assert_json_field "$(body_of "$RESP")" '"\(.webSurface.site.fqdn) \(.webSurface.site.accessMode) \(.webSurface.site.grants | length)"' "${FQDN} restricted 0" "…on ${FQDN}, with no grant" || true
visitor_exec "grep -q '${FQDN}' /etc/hosts || echo '${HOST_IP} ${FQDN}' >> /etc/hosts" > /dev/null 2>&1 || true

APPROVED=$(host_api_post "plugins/${PLUGIN}/hooks/approve" "{\"digest\":\"${DIGEST}\"}")
assert_json_field "$APPROVED" '.hooks.approval.state' 'approved' "Approved" || true
host_api_post "plugins/${PLUGIN}/enable" '{}' > /dev/null
OP=$(host_plugin "${PLUGIN}" 300 nudge)
assert_json_field "$OP" '.status' 'succeeded' "Hosted on ${HOST_AGENT_LABEL} ($(json_get "$OP" '.error // .refused.error // ""'))" || true
if wait_for 120 web_served "${PLUGIN}"; then
  log_pass "Served: approved, hosted, its tree current"
else
  log_fail "Not served: $(web_surface "${PLUGIN}" | jq -c '{served, reason}')"
fi
if wait_for 120 identity_ready "${PLUGIN}"; then
  log_pass "Ready: its agent half's first complete sync ended at the head"
else
  log_fail "Not ready: $(identity_view "${PLUGIN}" | jq -c '.readiness')"
fi

log_section "Entitled, no site grant: the status names them, Gatekeeper refuses them"

RESP=$(host_api_call PUT "plugins/${PLUGIN}/entitlements" "{\"principalType\":\"user\",\"principalId\":\"${MEMBER}\",\"roles\":[\"viewer\"]}")
assert_eq "$(status_of "$RESP")" "200" "${MEMBER} entitled as viewer" || true
RESP=$(host_api_call PUT "plugins/${PLUGIN}/entitlements" "{\"principalType\":\"group\",\"principalId\":\"${TEAM}\",\"roles\":[\"viewer\"]}")
assert_eq "$(status_of "$RESP")" "200" "Group ${TEAM} entitled as viewer" || true
if wait_for 30 in_audience "${MEMBER_ID}" && wait_for 30 in_audience "${GROUPIE_ID}"; then
  log_pass "Both are active members of the audience"
else
  log_fail "The audience: $(audience_row "${PLUGIN}" "${MEMBER_ID}") / $(audience_row "${PLUGIN}" "${GROUPIE_ID}")"
fi
assert_eq "$(grants_of)" "" "GET /api/plugins/${PLUGIN}/web-surface: no grant on the site" || true
assert_eq "$(without_grant)" "${GROUPIE},${MEMBER}" "…membersWithoutGrant names both, by username" || true
assert_eq "$(site_view | jq -r --arg id "${MEMBER_ID}" '[.membersWithoutGrant[]? | select(.userId == $id)] | length')" "1" "…each with their directory id" || true

SECRET_M=$(reset_totp "${MEMBER}")
SECRET_G=$(reset_totp "${GROUPIE}")
wait_for_next_totp_window
assert_eq "$(sign_in "${MEMBER}" "${MEMBER_PASSWORD}" "${SECRET_M}" "${JAR_MEMBER}" "${FQDN}")" "OK OK" "${MEMBER} signed in from the visitor VM" || true
assert_eq "$(sign_in "${GROUPIE}" "${GROUPIE_PASSWORD}" "${SECRET_G}" "${JAR_GROUPIE}" "${FQDN}")" "OK OK" "${GROUPIE} signed in" || true
RESP=$(page "${JAR_MEMBER}" /)
assert_eq "$(visit_status "$RESP")" "403" "${MEMBER}, entitled without a site grant: 403" || true
assert_not_contains "$(visit_body "$RESP")" "E2E_WEB_" "…the access-request page, never the shell" || true
assert_eq "$(shell_status "${JAR_GROUPIE}")" "403" "${GROUPIE}, entitled through ${TEAM} without a site grant: 403" || true

# ===========================================================================
# 2. What the proxy refuses
# ===========================================================================

log_section "The proxy refuses a grant on no site, and on a static site"

RESP=$(host_api_call POST "gatekeeper/grants" "{\"principalType\":\"user\",\"principalId\":\"${MEMBER}\",\"resourceType\":\"site\",\"resourceId\":\"no-such-site-57\"}")
assert_eq "$(status_of "$RESP") $(json_get "$(body_of "$RESP")" '.code')" "400 unknown_site" "A site grant naming no site: 400 unknown_site" || true
CREATED=$(host_api_post "sites" "{\"name\":\"${STATIC_SITE}\",\"type\":\"managed\",\"spaMode\":false,\"autheliaProtected\":true}")
STATIC_ID=$(json_get "$CREATED" '.site.id // .id // empty')
if [ -n "${STATIC_ID}" ]; then
  log_pass "A static site ${STATIC_SITE} created"
else
  log_fail "The static site was not created: $(printf '%s' "$CREATED" | head -c 300)"
fi
RESP=$(host_api_call POST "gatekeeper/grants" "{\"principalType\":\"user\",\"principalId\":\"${MEMBER}\",\"resourceType\":\"site\",\"resourceId\":\"${STATIC_ID:-none}\"}")
assert_eq "$(status_of "$RESP") $(json_get "$(body_of "$RESP")" '.code')" "400 site_not_grantable" "A site grant on a static site: 400 site_not_grantable — its access is its allowed users" || true
assert_eq "$(host_api_get "gatekeeper/grants?resourceType=site&resourceId=${STATIC_ID:-none}" | jq '.grants | length' 2>/dev/null || echo "?")" "0" "…nothing reached Gatekeeper" || true
if [ -n "${STATIC_ID}" ]; then
  assert_json_field "$(host_api_delete "sites/${STATIC_ID}")" '.ok' 'true' "The static site deleted" || true
  STATIC_ID=""
fi

# ===========================================================================
# 3. Granting the site
# ===========================================================================

log_section "Granted: the CLI to a user, the proxy to a group"

OUT=$(cli plugins web-surface "${PLUGIN}" grant --user "${MEMBER}")
assert_json_field "$OUT" '"\(.event) \(.changed) \(.grant.resourceType) \(.grant.resourceId == "'"${SITE_ID}"'")"' "complete true site true" "lamaste-server plugins web-surface ${PLUGIN} grant --user ${MEMBER}" || true
if wait_for 30 shell_answers "${JAR_MEMBER}" 200; then
  log_pass "${MEMBER} reaches the shell (200)"
else
  log_fail "${MEMBER} after the grant: $(shell_status "${JAR_MEMBER}")"
fi
assert_contains "$(visit_body "$(page "${JAR_MEMBER}" /)")" "E2E_WEB_v1" "…index.html of the plugin's tree" || true
assert_eq "$(shell_status "${JAR_GROUPIE}")" "403" "${GROUPIE} is still refused: the grant names ${MEMBER} alone" || true
assert_eq "$(grants_of)" "user:${MEMBER}" "The status lists the grant" || true
if wait_for 15 without_grant_is "${GROUPIE}"; then
  log_pass "…and only ${GROUPIE} without one"
else
  log_fail "membersWithoutGrant: $(without_grant)"
fi

OUT=$(cli plugins web-surface "${PLUGIN}" grant --user "${MEMBER}")
assert_json_field "$OUT" '"\(.event) \(.changed) \(.grantIds | length)"' "complete false 1" "A second grant to ${MEMBER} changes nothing (changed: false)" || true

RESP=$(host_api_call POST "gatekeeper/grants" "{\"principalType\":\"group\",\"principalId\":\"${TEAM}\",\"resourceType\":\"site\",\"resourceId\":\"${SITE_ID}\",\"context\":{}}")
assert_eq "$(status_of "$RESP")" "201" "POST /api/gatekeeper/grants: the site to group ${TEAM}" || true
if wait_for 30 shell_answers "${JAR_GROUPIE}" 200; then
  log_pass "${GROUPIE} reaches the shell through ${TEAM} (200)"
else
  log_fail "${GROUPIE} after the group grant: $(shell_status "${JAR_GROUPIE}")"
fi
assert_eq "$(without_grant)" "" "Nobody of the audience is without a grant" || true

OUT=$(cli plugins web-surface "${PLUGIN}" grants)
assert_json_field "$OUT" '"\(.accessMode) \(.siteId == "'"${SITE_ID}"'") \([.grants[] | "\(.principalType):\(.principalId)"] | sort | join(",")) \(.membersWithoutGrant | length)"' "restricted true group:${TEAM},user:${MEMBER} 0" "lamaste-server plugins web-surface ${PLUGIN} grants --json" || true

assert_eq "$(site_audits created)" "2" "Audited twice: plugin.web-surface.grant.created" || true
assert_eq "$(site_audits created ".principalType == \"user\" and .userId == \"${MEMBER_ID}\" and .siteId == \"${SITE_ID}\" and (has(\"username\") | not)")" "1" "…the user by directory id, never by username" || true
assert_eq "$(site_audits created ".principalType == \"group\" and .group == \"${TEAM}\"")" "1" "…the group by name" || true

# ===========================================================================
# 4. Revoking it
# ===========================================================================

log_section "Revoked: the CLI for the group, the bulk route for the user"

OUT=$(cli plugins web-surface "${PLUGIN}" revoke --group "${TEAM}")
assert_json_field "$OUT" '"\(.event) \(.revoked)"' "complete 1" "lamaste-server plugins web-surface ${PLUGIN} revoke --group ${TEAM}" || true
if wait_for 30 shell_answers "${JAR_GROUPIE}" 403; then
  log_pass "${GROUPIE} is refused again (403)"
else
  log_fail "${GROUPIE} after the revocation: $(shell_status "${JAR_GROUPIE}")"
fi
assert_eq "$(shell_status "${JAR_MEMBER}")" "200" "${MEMBER} keeps the site: their own grant" || true
assert_eq "$(without_grant)" "${GROUPIE}" "The status names ${GROUPIE} without a grant again" || true
assert_eq "$(site_audits revoked ".principalType == \"group\" and .group == \"${TEAM}\"")" "1" "Audited: plugin.web-surface.grant.revoked, the group" || true

OUT=$(cli plugins web-surface "${PLUGIN}" revoke --group "${TEAM}")
assert_json_field "$OUT" '"\(.event) \(.code)"' "error no_grant" "Revoking a grant the group no longer holds: refused (no_grant)" || true

RESP=$(host_api_call DELETE "gatekeeper/grants?principalType=user&principalId=${MEMBER}")
assert_eq "$(status_of "$RESP")" "200" "DELETE /api/gatekeeper/grants?principalType=user&principalId=${MEMBER}: every grant of the user" || true
if wait_for 30 shell_answers "${JAR_MEMBER}" 403; then
  log_pass "${MEMBER} is refused (403)"
else
  log_fail "${MEMBER} after the bulk revocation: $(shell_status "${JAR_MEMBER}")"
fi
assert_eq "$(site_audits revoked ".principalType == \"user\" and .userId == \"${MEMBER_ID}\" and .siteId == \"${SITE_ID}\"")" "1" "Audited: the site grant among them, by directory id" || true
assert_eq "$(grants_of)" "" "No grant left on the site" || true

end_test

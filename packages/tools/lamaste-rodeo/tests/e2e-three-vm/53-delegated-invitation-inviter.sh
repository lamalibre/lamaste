#!/usr/bin/env bash
# ============================================================================
# 53 — Delegated invitations: an inviter grants only what it may (Three-VM)
# ============================================================================
# The first proof of delegated invitations (design: packages/core/docs/
# delegated-invitations-design.md, "Proof"), the corral case: a client's
# coordinator, an external member of B, invites a colleague into the plugin
# with one role, without the relay's administrator.
#
# 1. The policy: invitations are off until the administrator enables them;
#    enabling is refused without the plugin's own web surface, and on an
#    authenticated one (external members never reach it).
# 2. The inviter's page on auth.<B>: its headers (CSP by hash, against the
#    served script and style; no framing); the API refuses a session of no
#    one, a viewer, a member of A alone, an external member with no role; it
#    lists exactly the roles the coordinator may give; a role it may not give
#    (403 role_not_grantable), an address under another domain (400), the
#    plugin's own site as Origin or a same-site fetch (403); the API does not
#    exist on the plugin's own host; the cap (409).
# 3. The invitee: a link with the token in its fragment; lookup and accept by
#    POST, the token in no URL, nginx log or journal; the token answered only
#    by auth.<B>, never by auth.<A>, the panel vhost or :9292, whatever Host a
#    client sends; a username a grant already names, and a removed user's,
#    are refused alike (409 username_unavailable).
# 4. Accepted: an external member of B holding no Authelia group, the role
#    and the site grant, in the agent half's projection with that role; the
#    shell and the API answer them as the directory's user; the link again is
#    410; audited with no address, listed with its inviter, the administrators
#    notified.
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../e2e/helpers.sh"
# shellcheck source-path=SCRIPTDIR source=app-plugin-harness.sh
source "${SCRIPT_DIR}/app-plugin-harness.sh"
MD_SPEC=53
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
APP="/api/${PLUGIN}/app"
SUB_W="e2e53web"
POLICY_ID="e2e-apphost-53"
REMOTE_DIR="/var/tmp/e2e-53-app-plugin"
LOCAL_TMP=""
CLEAN_PLUGINS="${PLUGIN}"
CLEAN_ROUTES="${PLUGIN}"
PURGE_PACKAGES=""
COORD="e2e53-coord"
VIEWER="e2e53-viewer"
OUTSIDER="e2e53-outsider"
MEM_A="e2e53-mem-a"
GONE="e2e53-gone"
FUTURE="e2e53-future"
INVITEE="e2e53-invitee"
# Test credentials for this run only, never printed
PASSWORD="E2e-$(openssl rand -hex 12)"
INVITEE_PASSWORD="E2e-$(openssl rand -hex 12)"
COORD_ID=""
VIEWER_ID=""
OUTSIDER_ID=""
MEM_A_ID=""
GONE_ID=""
INVITEE_ID=""
JAR_COORD=$(md_jar coord)
JAR_VIEWER=$(md_jar viewer)
JAR_OUTSIDER=$(md_jar outsider)
JAR_MEM_A=$(md_jar mem-a)
JAR_INVITEE=$(md_jar invitee)
FQDN=""
COORD_GRANT=""
VIEWER_GRANT=""
FUTURE_GRANT=""
AUDIT_BASE=0
TOKEN=""
INV_ID=""
TOKEN_B=""
INV_B=""

# shell_for <jar> — the session gets the shell (index.html of tree v1)
shell_for() { [[ "$(visit_body "$(page "$1" /)")" == *"E2E_WEB_v1"* ]]; }

# inline_hash <script|style> — the CSP source of the page's inline element, from stdin
inline_hash() {
  node -e 'const h=require("fs").readFileSync(0,"utf8");const t=process.argv[1];const m=h.match(new RegExp("<"+t+">([\\s\\S]*?)</"+t+">"));process.stdout.write(m?"sha256-"+require("crypto").createHash("sha256").update(m[1],"utf8").digest("base64"):"none")' "$1"
}

begin_test "53 — Delegated invitations: an inviter grants only what it may (Three-VM)"

cleanup() {
  log_info "Cleaning up test resources..."
  local id
  for id in ${COORD_GRANT} ${VIEWER_GRANT} ${FUTURE_GRANT}; do
    host_api_delete "gatekeeper/grants/${id}" > /dev/null 2>&1 || true
  done
  if [ -n "${SITE_ID}" ]; then inv_drop_site_grants "${SITE_ID}"; fi
  host_api_delete "plugins/${PLUGIN}/web-surface" > /dev/null 2>&1 || true
  drop_plugin_grants "${PLUGIN}"
  inv_cleanup_users "${COORD}" "${VIEWER}" "${OUTSIDER}" "${MEM_A}" "${GONE}" "${INVITEE}"
  inv_cleanup_ids ${COORD_ID} ${VIEWER_ID} ${OUTSIDER_ID} ${MEM_A_ID} ${GONE_ID} ${INVITEE_ID}
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
AUDIT_BASE=$(host_api_get "audit?limit=1" 2>/dev/null | jq '.entries[0].id // 0' 2>/dev/null || echo "0")

# ===========================================================================
# 1. B, the people, the plugin
# ===========================================================================

log_section "Domain B; a coordinator, a viewer, an outsider (external members of B); a member of A alone"

md_domain_active "${DOMAIN_2}"
FQDN="${SUB_W}.${DOMAIN_2}"
EXTERNAL="[{\"name\":\"${DOMAIN_2}\",\"kind\":\"external\"}]"
md_user COORD_ID "${COORD}" "${PASSWORD}" "${EXTERNAL}"
md_user VIEWER_ID "${VIEWER}" "${PASSWORD}" "${EXTERNAL}"
md_user OUTSIDER_ID "${OUTSIDER}" "${PASSWORD}" "${EXTERNAL}"
md_user MEM_A_ID "${MEM_A}" "${PASSWORD}" "[\"${DOMAIN}\"]"

log_section "The plugin, with an inviting role, installed, approved, hosted, on B"

LOCAL_TMP=$(mktemp -d /tmp/e2e-53-app-plugin-XXXXXXXX)
if ! write_app_install_fixture "${LOCAL_TMP}/ship/fixtures/xinv" "${PLUGIN}" 1.0.0 main "r$(date +%s)-$$" '[]' none inviting v1 "${SUB_W}"; then
  log_fail "The fixture could not be built (npm install at the workspace root, npm run build -w packages/core/lib)"
  end_test
  exit $?
fi
log_pass "Fixture built: ${SERVER_PACKAGE} (coordinator invites coordinator and viewer; web surface ${SUB_W})"
ship_agent_facts_probe
start_stand_in_feria fixtures/xinv/server fixtures/xinv/agent
ensure_app_host_helper
open_push_install "${POLICY_ID}" "[\"${AGENT_PACKAGE}\"]" '["install","uninstall"]'
inv_install "${PLUGIN}" "${SERVER_PACKAGE}" "${AGENT_PACKAGE}"
HOOKS=$(host_api_get "plugins/${PLUGIN}/hooks")
assert_json_field "$HOOKS" '.hooks.identity.block.roles | map(select(.id == "coordinator")) | first | .invites | join(",")' 'coordinator,viewer' "The approved block names what the coordinator may give" || true

# ===========================================================================
# 2. The policy
# ===========================================================================

log_section "The policy: off until the administrator enables it, and only with a restricted web surface"

VIEW=$(host_api_get "plugins/${PLUGIN}/invitation-policy")
assert_json_field "$VIEW" '"\(.enabled) \(.maxOpenPerInviter) \(.maxJoined) \(.lifetimeDays)"' 'false 10 50 7' "A plugin nobody set a policy for: off, the defaults" || true
assert_json_field "$VIEW" '.invitingRoles | map("\(.role):\(.invites | join("+"))") | join(",")' 'coordinator:coordinator+viewer' "…its inviting role listed" || true
ENABLE="{\"enabled\":true,\"emailDomains\":[\"${INV_MAIL}\"]}"
RESP=$(inv_policy '{"enabled":true,"emailDomains":[]}')
assert_eq "$(status_of "$RESP")" "400" "Enabling with no e-mail domain: 400" || true
RESP=$(inv_policy "${ENABLE}")
assert_eq "$(status_of "$RESP")" "409" "Enabling with no web surface: 409" || true
assert_json_field "$(body_of "$RESP")" '.code' 'invitations_unavailable' "…invitations_unavailable" || true
inv_web_surface SITE_ID "${PLUGIN}" "${FQDN}" authenticated
RESP=$(inv_policy "${ENABLE}")
assert_eq "$(status_of "$RESP")" "409" "Enabling on an authenticated web surface: 409 (it refuses external members)" || true
assert_contains "$(json_get "$(body_of "$RESP")" '.error')" "not restricted" "…it says why" || true
inv_web_surface SITE_ID "${PLUGIN}" "${FQDN}" restricted
md_hosts "${FQDN}"

log_section "The people: roles and the site's grant, as the administrator gives them"

inv_entitle "${COORD}" coordinator
inv_entitle "${VIEWER}" viewer
md_grant COORD_GRANT user "${COORD}" site "${SITE_ID}"
md_grant VIEWER_GRANT user "${VIEWER}" site "${SITE_ID}"
inv_wait_audience "${COORD_ID}" coordinator "The audience holds ${COORD} as coordinator"
inv_wait_audience "${VIEWER_ID}" viewer "…and ${VIEWER} as viewer"
wait_group holds "${COORD}" "${FQDN}" "users.yml gives ${COORD} the site's hostname as a group"

md_wait_authelia "${DOMAIN_2}"
md_sign_in "${COORD}" "${PASSWORD}" "$(reset_totp "${COORD}")" "${JAR_COORD}" "${FQDN}"
md_sign_in "${VIEWER}" "${PASSWORD}" "$(reset_totp "${VIEWER}")" "${JAR_VIEWER}" "${FQDN}"
md_sign_in "${OUTSIDER}" "${PASSWORD}" "$(reset_totp "${OUTSIDER}")" "${JAR_OUTSIDER}" "${FQDN}"
# A member of A alone signs in at B's portal (a password is relay-wide); only membership differs.
md_sign_in "${MEM_A}" "${PASSWORD}" "$(reset_totp "${MEM_A}")" "${JAR_MEM_A}" "${FQDN}"
AUTHELIA_PID=$(authelia_pid)

log_section "Off: the coordinator is refused until the policy is enabled"

RESP=$(inv_api "${JAR_COORD}" GET)
assert_eq "$(visit_status "$RESP")" "403" "GET with the policy off: 403" || true
assert_json_field "$(visit_body "$RESP")" '.code' 'invitations_unavailable' "…invitations_unavailable (never why)" || true

RESP=$(inv_policy "${ENABLE}")
assert_eq "$(status_of "$RESP")" "200" "Enabled, for addresses under ${INV_MAIL}" || true
assert_json_field "$(body_of "$RESP")" '"\(.enabled) \(.available) \(.emailDomains | join(","))"' "true true ${INV_MAIL}" "…available" || true

# ===========================================================================
# 3. The page
# ===========================================================================

log_section "The inviter's page on auth.<B>: its own origin, by hash, unframed"

RESP=$(visit - "https://auth.${DOMAIN_2}/invitations/${PLUGIN}")
assert_eq "$(visit_status "$RESP")" "200" "GET auth.<B>/invitations/${PLUGIN}: 200" || true
HEADERS=$(visit_headers "$RESP")
PAGE=$(visit_body "$RESP")
assert_contains "${PAGE}" "<title>Lamaste — Invite People</title>" "…the stock inviter's page" || true
assert_not_contains "${PAGE}" "https://cdn" "…nothing from a foreign host" || true
CSP=$(printf '%s\n' "${HEADERS}" | sed -n 's/^[Cc]ontent-[Ss]ecurity-[Pp]olicy: //p')
assert_contains "${CSP}" "script-src '$(printf '%s' "${PAGE}" | inline_hash script)'" "…the CSP names the served script's hash" || true
assert_contains "${CSP}" "'$(printf '%s' "${PAGE}" | inline_hash style)'" "…and the served style's" || true
assert_contains "${CSP}" "frame-ancestors 'none'" "…nothing frames it" || true
assert_contains "${CSP}" "default-src 'none'" "…nothing else loads" || true
LOWER=$(printf '%s\n' "${HEADERS}" | tr '[:upper:]' '[:lower:]')
assert_contains "${LOWER}" "x-frame-options: deny" "X-Frame-Options: DENY" || true
assert_contains "${LOWER}" "cross-origin-opener-policy: same-origin" "Cross-Origin-Opener-Policy: same-origin" || true
assert_contains "${LOWER}" "referrer-policy: same-origin" "Referrer-Policy: same-origin (no-referrer would make a fetch POST send Origin: null)" || true
assert_contains "${LOWER}" "cache-control: no-store" "Cache-Control: no-store" || true

# ===========================================================================
# 4. Who may ask, for what
# ===========================================================================

log_section "Who may ask"

RESP=$(inv_api - GET)
assert_eq "$(visit_status "$RESP")" "401" "No session: 401" || true
assert_not_contains "$(visit_headers "$RESP" | tr '[:upper:]' '[:lower:]')" "location:" "…JSON, never a redirect (the page sends the browser to sign in)" || true
assert_eq "$(visit_status "$(inv_api "${JAR_MEM_A}" GET)")" "403" "${MEM_A}, a member of A alone: 403 at auth.<B>" || true
assert_eq "$(visit_status "$(inv_api "${JAR_OUTSIDER}" GET)")" "403" "${OUTSIDER}, external on B with no role and no site: 403" || true

log_section "What the coordinator may give, and what the viewer may not"

RESP=$(inv_api "${JAR_COORD}" GET)
assert_eq "$(visit_status "$RESP")" "200" "${COORD}: GET 200" || true
BODY=$(visit_body "$RESP")
assert_json_field "$BODY" '.policy.grantableRoles | map(.id) | sort | join(",")' 'coordinator,viewer' "…the roles they may give, editor not among them" || true
assert_json_field "$BODY" '"\(.policy.emailDomains | join(",")) \(.policy.lifetimeDays) \(.policy.maxOpen) \(.policy.open)"' "${INV_MAIL} 7 10 0" "…the bounds; none open" || true
assert_json_field "$BODY" ".plugin.siteUrl" "https://${FQDN}/" "…the way back to the plugin's site" || true
assert_contains "$(visit_headers "$RESP" | tr '[:upper:]' '[:lower:]')" "cache-control: no-store" "…never cached" || true

MADE() { jq -c -n --arg e "$1" --arg r "$2" '{email: $e, role: $r}'; }
RESP=$(inv_api "${JAR_COORD}" POST "" "$(MADE "someone@${INV_MAIL}" editor)")
assert_eq "$(visit_status "$RESP")" "403" "editor, which the coordinator may not give: 403" || true
assert_json_field "$(visit_body "$RESP")" '.code' 'role_not_grantable' "…role_not_grantable" || true
RESP=$(inv_api "${JAR_COORD}" POST "" "$(MADE "someone@${INV_MAIL}" admins)")
assert_eq "$(visit_status "$RESP")" "403" "A role that does not exist: 403" || true
RESP=$(inv_api "${JAR_COORD}" POST "" "$(MADE "someone@other.example" viewer)")
assert_eq "$(visit_status "$RESP")" "400" "An address under another domain: 400" || true
assert_json_field "$(visit_body "$RESP")" '.code' 'email_domain_not_allowed' "…email_domain_not_allowed" || true
RESP=$(inv_api "${JAR_COORD}" POST "" "{\"email\":\"someone@${INV_MAIL}\",\"role\":\"viewer\",\"groups\":[\"admins\"]}")
assert_eq "$(visit_status "$RESP")" "400" "A body naming anything else (groups): 400, strict" || true
RESP=$(inv_api "${JAR_VIEWER}" POST "" "$(MADE "someone@${INV_MAIL}" viewer)")
assert_eq "$(visit_status "$RESP")" "403" "${VIEWER}, whose role invites nobody: 403" || true
assert_json_field "$(visit_body "$RESP")" '.code' 'role_not_grantable' "…role_not_grantable" || true

log_section "From nowhere but the sign-in host's page"

REQ=(-X POST -H 'Content-Type: application/json' -d "$(MADE "someone@${INV_MAIL}" viewer)")
assert_eq "$(visit_status "$(visit "${JAR_COORD}" "${REQ[@]}" -H "Origin: https://${FQDN}" -H 'Sec-Fetch-Site: same-site' "$(inv_url)")")" "403" "A POST the plugin's own pages would send (Origin of its site, same-site): 403" || true
assert_eq "$(visit_status "$(visit "${JAR_COORD}" "${REQ[@]}" -H "Origin: https://${FQDN}" -H 'Sec-Fetch-Site: same-origin' "$(inv_url)")")" "403" "…its Origin alone: 403" || true
assert_eq "$(visit_status "$(visit "${JAR_COORD}" "${REQ[@]}" -H "Origin: https://auth.${DOMAIN_2}" -H 'Sec-Fetch-Site: same-site' "$(inv_url)")")" "403" "…a same-site fetch alone: 403" || true
assert_eq "$(visit_status "$(visit "${JAR_COORD}" "${REQ[@]}" -H 'Sec-Fetch-Site: same-origin' "$(inv_url)")")" "403" "…no Origin at all: 403" || true
# The plugin's host has no such API: a tree's file, or nothing, never an invitation
RESP=$(visit "${JAR_COORD}" "${REQ[@]}" -H "Origin: https://${FQDN}" -H 'Sec-Fetch-Site: same-origin' "https://${FQDN}/api/delegated-invitations/${PLUGIN}")
assert_not_eq "$(visit_status "$RESP")" "201" "The same POST on the plugin's own host makes nothing" || true
assert_not_contains "$(visit_body "$RESP")" "inviteUrl" "…no link" || true
RESP=$(visit "${JAR_COORD}" -H 'Sec-Fetch-Site: same-origin' "https://${FQDN}/api/delegated-invitations/${PLUGIN}")
assert_not_contains "$(visit_body "$RESP")" "grantableRoles" "…and a GET there reads nothing" || true
assert_json_field "$(host_api_get "invitations?plugin=${PLUGIN}")" '.invitations | length' '0' "No invitation was made by any of those" || true

# ===========================================================================
# 5. The link
# ===========================================================================

log_section "An invitation: a link the inviter sends themselves"

inv_new TOKEN INV_ID "${JAR_COORD}" "ayse@${INV_MAIL}" viewer "${COORD} invites ayse@${INV_MAIL} as viewer"
assert_json_field "$(inv_row "${INV_ID}")" '"\(.kind) \(.inviter.username) \(.plugin) \(.role) \(.status) \(.email)"' "delegated ${COORD} ${PLUGIN} viewer pending ayse@${INV_MAIL}" "The panel lists it with its inviter" || true
RESP=$(inv_api "${JAR_COORD}" GET)
assert_json_field "$(visit_body "$RESP")" '[.invitations[] | "\(.email) \(.status)"] | join(",")' "ayse@${INV_MAIL} pending" "${COORD} sees their own, pending" || true
assert_json_field "$(visit_body "$RESP")" '.policy.open' '1' "…one open" || true
assert_eq "$(json_get "$(visit_body "$(inv_api "${JAR_VIEWER}" GET)")" '.invitations | length')" "0" "${VIEWER} sees none of it" || true

log_section "The link opens on B's sign-in host alone"

RESP=$(inv_lookup "${TOKEN}")
assert_eq "$(visit_status "$RESP")" "200" "POST auth.<B>/api/invite/lookup: 200" || true
assert_json_field "$(visit_body "$RESP")" '"\(.kind) \(.email) \(.plugin) \(.role) \(.invitedBy) \(.suggestedUsername)"' "delegated ayse@${INV_MAIL} E2E App Host (main) Viewer E2E ${COORD} ayse" "…what it is for and who invited, by display name" || true
assert_eq "$(json_get "$(visit_body "$RESP")" '.username // "none"')" "none" "…never the inviter's username" || true
assert_eq "$(visit_status "$(inv_lookup "${TOKEN}" "auth.${DOMAIN}")")" "404" "auth.<A>: 404, as no invitation at all" || true
assert_eq "$(inv_refused_off_portal "${TOKEN}" "https://127.0.0.1:9292")" "404" ":9292, Host and X-Forwarded-Host naming auth.<B>: 404" || true
assert_eq "$(host_exec "curl -sk -o /dev/null -w '%{http_code}' --max-time 15 --resolve panel.${DOMAIN}:443:127.0.0.1 -X POST -H 'X-Forwarded-Host: auth.${DOMAIN_2}' -H 'Content-Type: application/json' -d '{\"token\":\"${TOKEN}\"}' https://panel.${DOMAIN}/api/invite/lookup" 2>/dev/null | tail -n 1 | tr -d '\r')" "404" "The panel vhost, X-Forwarded-Host naming auth.<B>: 404" || true
RESP=$(visit - -X POST -H 'Content-Type: application/json' -H "X-Forwarded-Host: auth.${DOMAIN_2}" -d "{\"token\":\"${TOKEN}\"}" "https://auth.${DOMAIN}/api/invite/lookup")
assert_eq "$(visit_status "$RESP")" "404" "auth.<A>, X-Forwarded-Host naming auth.<B>: 404" || true
RESP=$(visit - "https://auth.${DOMAIN_2}/api/invite/${TOKEN}")
assert_not_eq "$(visit_status "$RESP")" "200" "The token in a URL opens nothing: the path routes are gone" || true
assert_not_contains "$(visit_body "$RESP")" "ayse" "…it says nothing of the invitation" || true
assert_eq "$(visit_status "$(inv_lookup "$(printf '0%.0s' {1..64})")")" "404" "A token that was never made: 404" || true

RESP=$(visit - "https://auth.${DOMAIN_2}/invite")
assert_eq "$(visit_status "$RESP")" "200" "The invitation page at /invite: 200 (the fragment never reaches the server)" || true
CSP=$(visit_headers "$RESP" | sed -n 's/^[Cc]ontent-[Ss]ecurity-[Pp]olicy: //p')
assert_contains "${CSP}" "script-src '$(visit_body "$RESP" | inline_hash script)'" "…its CSP names the served script's hash" || true
assert_not_contains "$(visit_body "$RESP")" "cdn.jsdelivr" "…no foreign script: the QR is the panel's" || true

log_section "A username anything names is refused, with one answer"

md_user GONE_ID "${GONE}" "${PASSWORD}" "${EXTERNAL}"
host_api_delete "users/${GONE}" > /dev/null 2>&1 || true
md_grant FUTURE_GRANT user "${FUTURE}" tunnel "e2e53-a-restricted-tunnel"
RESP=$(inv_accept "${TOKEN}" "${FUTURE}" "${INVITEE_PASSWORD}")
assert_eq "$(visit_status "$RESP")" "409" "${FUTURE}, which a Gatekeeper grant names for a user still to come: 409" || true
assert_json_field "$(visit_body "$RESP")" '.code' 'username_unavailable' "…username_unavailable" || true
FIRST_ANSWER=$(visit_body "$RESP")
RESP=$(inv_accept "${TOKEN}" "${GONE}" "${INVITEE_PASSWORD}")
assert_eq "$(visit_status "$RESP")" "409" "${GONE}, a removed user's: 409" || true
assert_eq "$(visit_body "$RESP")" "${FIRST_ANSWER}" "…the same answer, whatever named it" || true
RESP=$(inv_accept "${TOKEN}" "${COORD}" "${INVITEE_PASSWORD}")
assert_eq "$(visit_status "$RESP")" "409" "${COORD}, a living user's: 409" || true
assert_eq "$(visit_body "$RESP")" "${FIRST_ANSWER}" "…the same answer" || true
assert_json_field "$(inv_row "${INV_ID}")" '"\(.status) \(.username)"' "pending null" "The invitation stays pending; no name is held" || true

# ===========================================================================
# 6. Accepted
# ===========================================================================

log_section "Accepted: a new external member of B, with the one role and the site"

RESP=$(inv_accept "${TOKEN}" "${INVITEE}" "${INVITEE_PASSWORD}")
assert_eq "$(visit_status "$RESP")" "200" "POST auth.<B>/api/invite/accept: 200" || true
ACCEPTED="$RESP"
BODY=$(visit_body "$RESP")
assert_json_field "$BODY" '"\(.ok) \(.username) \(.accessPending) \(.loginUrl)"' "true ${INVITEE} false https://${FQDN}/" "…${INVITEE}, access complete, sent to the plugin's site" || true
assert_contains "$(json_get "$BODY" '.totpQr')" "data:image/svg+xml;base64," "…the QR, drawn by the panel" || true
SECRET=$(inv_secret "${ACCEPTED}")
assert_not_eq "${SECRET}" "" "…with its TOTP secret" || true
INVITEE_ID=$(json_get "$(inv_row "${INV_ID}")" '.acceptedUserId // empty')
assert_eq "$(is_uuid "${INVITEE_ID}")" "true" "The directory holds them by id" || true
assert_json_field "$(inv_row "${INV_ID}")" '"\(.status) \(.fulfilled) \(.email)"' "accepted true null" "The invitation is accepted, complete; its copy of the address gone" || true

assert_eq "$(user_kinds "${INVITEE}")" "${DOMAIN_2}:external" "${INVITEE} is an external member of B, of nothing else" || true
assert_json_field "$(host_api_get "users")" "[.users[] | select(.username == \"${INVITEE}\") | .groups | length] | first" '0' "…no Authelia group" || true
wait_group holds "${INVITEE}" "${FQDN}" "users.yml gives them the site's hostname, as a grant does"
assert_eq "$(user_groups "${INVITEE}")" "$(printf '%s\n' "${FQDN}" "lamaste:x:$(domain_group_key "${DOMAIN_2}")" | sort | paste -sd, -)" "…and holds nothing else in users.yml" || true
GRANTS=$(host_api_get "gatekeeper/grants?principalType=user&principalId=${INVITEE}")
assert_json_field "$GRANTS" '[.grants[] | "\(.resourceType):\(.resourceId)"] | sort | join(",")' "plugin:${PLUGIN},site:${SITE_ID}" "Gatekeeper holds exactly the role and the site's grant" || true
assert_json_field "$GRANTS" '[.grants[] | select(.resourceType == "plugin") | .context.roles | join(",")] | first' 'viewer' "…with the role asked for" || true
inv_wait_audience "${INVITEE_ID}" viewer "The audience holds them as viewer"
if wait_for 60 projection_has "${PLUGIN}" "[.users[] | select(.userId == \"${INVITEE_ID}\" and .status == \"active\")] | length == 1"; then
  log_pass "…and the agent half's projection: the plugin learned of them through the feed"
else
  log_fail "The projection: $(projected_user "${PLUGIN}" "${INVITEE_ID}")"
fi
assert_json_field "$(projected_user "${PLUGIN}" "${INVITEE_ID}")" '"\(.username) \(.roles | join(",")) \(.displayName) \(.email)"' "${INVITEE} viewer E2E Invitee ayse@${INV_MAIL}" "…with the role and the declared attributes" || true

log_section "They reach the plugin"

md_sign_in "${INVITEE}" "${INVITEE_PASSWORD}" "${SECRET}" "${JAR_INVITEE}" "${FQDN}"
if wait_for "${AUTHZ_SETTLE_SECONDS}" shell_for "${JAR_INVITEE}"; then
  log_pass "${INVITEE}: the shell, signed in with the factor the invitation gave"
else
  log_fail "${INVITEE} on the shell: $(page_status "${JAR_INVITEE}" /)"
fi
RESP=$(page "${JAR_INVITEE}" "${APP}/echo")
assert_eq "$(visit_status "$RESP")" "200" "…GET ${APP}/echo 200" || true
assert_json_field "$(visit_body "$RESP")" '"\(.caller.type) \(.caller.userId) \(.caller.username) \(.caller.roles | join(","))"' "user ${INVITEE_ID} ${INVITEE} viewer" "…the agent half sees the directory's user and their role" || true

log_section "One use"

assert_eq "$(visit_status "$(inv_lookup "${TOKEN}")")" "410" "The link again: lookup 410" || true
assert_eq "$(visit_status "$(inv_accept "${TOKEN}" e2e53-second "${INVITEE_PASSWORD}")")" "410" "…accept 410" || true

log_section "The cap"

RESP=$(inv_policy "{\"enabled\":true,\"emailDomains\":[\"${INV_MAIL}\"],\"maxOpenPerInviter\":1}")
assert_eq "$(status_of "$RESP")" "200" "The administrator lowers the cap to one open invitation" || true
inv_new TOKEN_B INV_B "${JAR_COORD}" "bora@${INV_MAIL}" viewer "One more for ${COORD}"
RESP=$(inv_api "${JAR_COORD}" POST "" "$(MADE "cem@${INV_MAIL}" viewer)")
assert_eq "$(visit_status "$RESP")" "409" "The next: 409" || true
assert_json_field "$(visit_body "$RESP")" '"\(.code) \(.cap)"' 'invitation_cap inviter' "…invitation_cap, the inviter's" || true
RESP=$(inv_policy "{\"enabled\":true,\"emailDomains\":[\"${INV_MAIL}\"],\"maxOpenPerInviter\":5,\"maxJoined\":2}")
assert_eq "$(status_of "$RESP")" "200" "People by invitation capped at 2 (one joined, one open)" || true
RESP=$(inv_api "${JAR_COORD}" POST "" "$(MADE "cem@${INV_MAIL}" viewer)")
assert_eq "$(visit_status "$RESP")" "409" "The next: 409" || true
assert_json_field "$(visit_body "$RESP")" '"\(.code) \(.cap)"' 'invitation_cap plugin' "…invitation_cap, the plugin's" || true
RESP=$(inv_api "${JAR_COORD}" DELETE "/${INV_B}")
assert_eq "$(visit_status "$RESP")" "200" "${COORD} revokes their own pending one" || true

# ===========================================================================
# 7. What it left behind
# ===========================================================================

log_section "Oversight: audited with no address, the administrators notified"

CREATED=$(inv_audit invitation.created)
assert_json_field "$CREATED" "[.[] | select(.details.invitationId == \"${INV_ID}\") | \"\(.actor) \(.details.role) \(.details.emailDomain)\"] | first" "user:${COORD_ID} viewer ${INV_MAIL}" "invitation.created by the inviter's id, the address's domain alone" || true
ACCEPT_AUDIT=$(inv_audit invitation.accepted)
assert_json_field "$ACCEPT_AUDIT" "[.[] | select(.details.invitationId == \"${INV_ID}\") | \"\(.details.userId) \(.details.inviterUserId) \(.details.role)\"] | first" "${INVITEE_ID} ${COORD_ID} viewer" "invitation.accepted by id, with its inviter" || true
ALL_AUDIT="$CREATED $ACCEPT_AUDIT $(inv_audit invitation.revoked) $(inv_audit invitation.policy.updated)"
assert_not_contains "$(printf '%s' "${ALL_AUDIT}" | jq -c '[.. | strings]' 2>/dev/null | tr -d '\n' | sed 's/","/ /g')" "@${INV_MAIL}" "No audit entry holds an address" || true
NOTIFIED=$(host_api_get "notifications?limit=50" | jq -r --arg p "${PLUGIN}" '[.notifications[]? | select(.message | contains("joined plugin \"" + $p + "\""))] | length' 2>/dev/null || echo "0")
assert_eq "${NOTIFIED}" "1" "The administrators were told someone joined, once" || true

log_section "No token at rest or in a log"

SINCE=$(host_exec "journalctl -u lamalibre-lamaste-serverd -u lamalibre-lamaste-gatekeeper --since '-20 min' --no-pager -o cat 2>/dev/null | grep -cF $(printf %q "${TOKEN}") || true" 2>/dev/null | tail -n 1 | tr -d '\r')
assert_eq "${SINCE}" "0" "The token is in no journal of the panel or Gatekeeper" || true
# One request above asked for the old path on purpose (the route is gone): only it may be logged.
NGINX=$(host_exec "cat /var/log/nginx/*.log 2>/dev/null | grep -F $(printf %q "${TOKEN}") | grep -vcF '/api/invite/${TOKEN}' || true" 2>/dev/null | tail -n 1 | tr -d '\r')
assert_eq "${NGINX}" "0" "…in no nginx log line but the one this spec's GET of the removed path made" || true
HASHED=$(host_exec "sqlite3 /etc/lamalibre/lamaste/state.db \"SELECT COUNT(*) FROM invitations WHERE token_sha256 = '${TOKEN}'\" 2>/dev/null || echo error" 2>/dev/null | tail -n 1 | tr -d '\r')
assert_eq "${HASHED}" "0" "…and state.db does not hold it" || true
assert_eq "$(host_exec "cat /etc/lamalibre/lamaste/state.db* | grep -caF $(printf %q "${TOKEN}") || true" 2>/dev/null | tail -n 1 | tr -d '\r')" "0" "…anywhere in its bytes, its write-ahead log included" || true

log_section "Nothing restarted Authelia"

assert_eq "$(authelia_pid)" "${AUTHELIA_PID}" "An invitation, its acceptance and a new user: Authelia's MainPID unchanged" || true

end_test

#!/usr/bin/env bash
# ============================================================================
# 67 — Mail: a delegated invitation mailed, and a new link (Three-VM)
# ============================================================================
# An inviter's invitation reaches the invitee by mail, in the domain's
# language, and the inviter can send a new link (design: packages/core/
# docs/mail-design.md §6.1). The inviting app plugin of the delegated
# invitations harness on B (Turkish), the relay's transport to the SMTP
# stand-in on the host VM (mail-harness.sh).
#
# 1. The inviter's page on B carries the mail words and the "new link"
#    button's words (Turkish).
# 2. A coordinator invites an address of the policy's domain: the answer
#    says the mail was sent and carries no link (the domain sends mail: the
#    link goes by mail only); the sink holds it — From the relay's sender,
#    in Turkish, its link on auth.<B>/invite#…. The inviter's list and the
#    administrator's show the mail sent. A name that reads as a host name
#    is refused.
# 3. A new link (…/<id>/reissue): the same invitation, a new token mailed
#    and not answered, the old link dead; the new one accepted.
# 4. The transport removed: an invitation answers not-configured, and its
#    link is answered — the inviter sends it.
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../e2e/helpers.sh"
# shellcheck source-path=SCRIPTDIR source=app-plugin-harness.sh
source "${SCRIPT_DIR}/app-plugin-harness.sh"
MD_SPEC=67
# shellcheck source-path=SCRIPTDIR source=multi-domain-harness.sh
source "${SCRIPT_DIR}/multi-domain-harness.sh"
# shellcheck source-path=SCRIPTDIR source=invitation-harness.sh
source "${SCRIPT_DIR}/invitation-harness.sh"
MAIL_SPEC=67
# shellcheck source-path=SCRIPTDIR source=mail-harness.sh
source "${SCRIPT_DIR}/mail-harness.sh"

require_commands multipass curl jq node npm tar perl openssl

PLUGIN="e2e-pmail"
SERVER_PACKAGE="@lamalibre/e2e-pmail-server"
AGENT_PACKAGE="@lamalibre/e2e-pmail-agent"
SUB_W="e2e59web"
POLICY_ID="e2e-apphost-59"
REMOTE_DIR="/var/tmp/e2e-59-app-plugin"
LOCAL_TMP=""
CLEAN_PLUGINS="${PLUGIN}"
CLEAN_ROUTES="${PLUGIN}"
PURGE_PACKAGES=""
RUN_ID="$(date +%s)"
COORD="e2e59-coord"
INVITEE="e2e59-inv-${RUN_ID}"
INVITEE_MAIL="deniz-${RUN_ID}@${MAIL_DOMAIN}"
LATER_MAIL="ayse-${RUN_ID}@${MAIL_DOMAIN}"
# Test credentials for this run only, never printed
PASSWORD="E2e-$(openssl rand -hex 12)"
INVITEE_PASSWORD="E2e-$(openssl rand -hex 12)"
COORD_ID=""
INVITEE_ID=""
JAR_COORD=$(md_jar coord)
FQDN=""
COORD_GRANT=""
TOKEN=""
INV_ID=""
TOKEN_2=""
INV_ID_2=""

# data_block <html> — the page's messages (its JSON data block), compact
data_block() {
  printf '%s' "$1" | node -e 'const h=require("fs").readFileSync(0,"utf8");const m=h.match(/<script type="application\/json" id="lamaste-messages">([\s\S]*?)<\/script>/);process.stdout.write(m?m[1].trim():"null")' | jq -c . 2>/dev/null || echo "null"
}

begin_test "67 — Mail: a delegated invitation mailed, and a new link (Three-VM)"

cleanup() {
  log_info "Cleaning up test resources..."
  [ -n "${DOMAIN_2:-}" ] && md_api PUT "domains/${DOMAIN_2}/language" '{"language":null}' > /dev/null 2>&1 || true
  if [ -n "${COORD_GRANT}" ]; then host_api_delete "gatekeeper/grants/${COORD_GRANT}" > /dev/null 2>&1 || true; fi
  if [ -n "${SITE_ID}" ]; then inv_drop_site_grants "${SITE_ID}"; fi
  host_api_delete "plugins/${PLUGIN}/web-surface" > /dev/null 2>&1 || true
  drop_plugin_grants "${PLUGIN}"
  inv_cleanup_users "${COORD}" "${INVITEE}"
  inv_cleanup_ids ${COORD_ID} ${INVITEE_ID}
  mail_cleanup
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
mail_cleanup
md_domain_active "${DOMAIN_2}"
RESP=$(md_api PUT "domains/${DOMAIN_2}/language" '{"language":"tr"}')
assert_json_field "$(body_of "$RESP")" '.domain.language' 'tr' "B speaks Turkish" || true
mail_sink_start
RESP=$(mail_transport_put "settings/mail" "no-reply@notify.${DOMAIN}" "E2E Relay")
assert_eq "$(status_of "$RESP")" "200" "PUT /api/settings/mail: the relay's transport to the sink" || true

log_section "The inviting plugin on B, hosted, served"

LOCAL_TMP=$(mktemp -d /tmp/e2e-59-app-plugin-XXXXXXXX)
if ! write_app_install_fixture "${LOCAL_TMP}/ship/fixtures/pmail" "${PLUGIN}" 1.0.0 main "m$(date +%s)-$$" '[]' none inviting v1 "${SUB_W}"; then
  log_fail "The fixture could not be built (npm install at the workspace root, npm run build -w packages/core/lib)"
  end_test
  exit $?
fi
log_pass "Fixture built: ${SERVER_PACKAGE}"
ship_agent_facts_probe
start_stand_in_feria fixtures/pmail/server fixtures/pmail/agent
ensure_app_host_helper
open_push_install "${POLICY_ID}" "[\"${AGENT_PACKAGE}\"]" '["install","uninstall"]'
FQDN="${SUB_W}.${DOMAIN_2}"
inv_install "${PLUGIN}" "${SERVER_PACKAGE}" "${AGENT_PACKAGE}"
inv_web_surface SITE_ID "${PLUGIN}" "${FQDN}" restricted
md_hosts "${FQDN}"

log_section "A coordinator, invitations allowed to ${MAIL_DOMAIN}"

md_user COORD_ID "${COORD}" "${PASSWORD}" "[{\"name\":\"${DOMAIN_2}\",\"kind\":\"external\"}]"
inv_entitle "${COORD}" coordinator
md_grant COORD_GRANT user "${COORD}" site "${SITE_ID}"
inv_wait_audience "${COORD_ID}" coordinator "The audience holds ${COORD} as coordinator"
RESP=$(inv_policy "{\"enabled\":true,\"emailDomains\":[\"${MAIL_DOMAIN}\"]}")
assert_eq "$(status_of "$RESP")" "200" "Invitations enabled for ${PLUGIN}, to ${MAIL_DOMAIN}" || true
md_wait_authelia "${DOMAIN_2}"
md_sign_in "${COORD}" "${PASSWORD}" "$(reset_totp "${COORD}")" "${JAR_COORD}" "${FQDN}"

# ===========================================================================
# 1. The inviter's page
# ===========================================================================

log_section "The inviter's page: the mail and \"new link\" words, in Turkish"

PAGE=$(visit_body "$(visit - "https://auth.${DOMAIN_2}/invitations/${PLUGIN}")")
assert_contains "$PAGE" '<html lang="tr">' "auth.${DOMAIN_2}/invitations/${PLUGIN}: lang=\"tr\"" || true
assert_json_field "$(data_block "$PAGE")" '.messages."invitations.reissue"' 'Yeni bağlantı' "…its data block: invitations.reissue Yeni bağlantı" || true
assert_json_field "$(data_block "$PAGE")" '(.messages."invitations.mailed" | length > 0) and (.messages."invitations.mailFailed" | length > 0)' 'true' "…and the mailed / not-mailed words" || true

# ===========================================================================
# 2. Mailed
# ===========================================================================

log_section "The invitation mailed, in Turkish"

RESP=$(inv_api "${JAR_COORD}" POST "" "$(jq -c -n --arg e "${INVITEE_MAIL}" '{email: $e, displayName: "E2E Invitee", role: "viewer"}')")
assert_eq "$(visit_status "$RESP")" "201" "${COORD} invites ${INVITEE_MAIL} as viewer: 201" || true
INV_ID=$(json_get "$(visit_body "$RESP")" '.invitation.id // empty')
assert_json_field "$(visit_body "$RESP")" '"\(.mail.status) \(.inviteUrl)"' 'sent null' "…the answer: mail sent, no link (it goes by mail only)" || true
assert_eq "$(visit_body "$RESP" | grep -cE '[a-f0-9]{64}' || true)" "0" "…no token anywhere in the answer" || true
mail_wait "${INVITEE_MAIL}" 1 "The sink holds the invitation"
MAIL=$(mail_last_to "${INVITEE_MAIL}")
assert_json_field "$MAIL" '.from' "no-reply@notify.${DOMAIN}" "…From the relay's sender" || true
assert_json_field "$MAIL" '.subject | startswith("Davetiniz")' 'true' "…in Turkish ($(json_get "$MAIL" '.subject'))" || true
URL=$(mail_link_in "$MAIL" "/invite#")
TOKEN="${URL##*#}"
assert_contains "${URL}" "https://auth.${DOMAIN_2}/invite#" "…its link on auth.${DOMAIN_2}" || true
LIST=$(visit_body "$(inv_api "${JAR_COORD}" GET)")
assert_eq "$(echo "$LIST" | jq -r --arg i "${INV_ID}" '.invitations[]? | select(.id == $i) | .mail.status' 2>/dev/null)" "sent" "The inviter's list: mail sent" || true
assert_json_field "$(inv_row "${INV_ID}")" '.mail.status' 'sent' "The administrator's list: mail sent" || true
RESP=$(inv_api "${JAR_COORD}" POST "" "$(jq -c -n --arg e "${LATER_MAIL}" '{email: $e, displayName: "pay-here.example", role: "viewer"}')")
assert_eq "$(visit_status "$RESP")" "400" "A name that reads as a host name: 400" || true
assert_json_field "$(visit_body "$RESP")" '"\(.code) \(.field)"' 'invalid_request displayName' "…invalid_request, field displayName" || true

# ===========================================================================
# 3. A new link
# ===========================================================================

log_section "A new link: the old one dead, the new one mailed"

RESP=$(inv_api "${JAR_COORD}" POST "/${INV_ID}/reissue")
assert_eq "$(visit_status "$RESP")" "200" "POST …/${PLUGIN}/${INV_ID}/reissue: 200" || true
assert_json_field "$(visit_body "$RESP")" '"\(.invitation.id) \(.mail.status) \(.inviteUrl)"' "${INV_ID} sent null" "…the same invitation, mailed again, no link answered" || true
mail_wait "${INVITEE_MAIL}" 2 "The sink holds the new link"
URL_2=$(mail_link_in "$(mail_last_to "${INVITEE_MAIL}")" "/invite#")
TOKEN_2="${URL_2##*#}"
assert_not_eq "${TOKEN_2}" "${TOKEN}" "…a new token" || true
assert_not_eq "$(visit_status "$(inv_lookup "${TOKEN}")")" "200" "The old link is dead" || true
assert_eq "$(visit_status "$(inv_lookup "${TOKEN_2}")")" "200" "The new one answers" || true
assert_json_field "$(inv_row "${INV_ID}")" '.reissuedAt != null' 'true' "The administrator's list: reissued" || true
RESP=$(inv_accept "${TOKEN_2}" "${INVITEE}" "${INVITEE_PASSWORD}")
assert_eq "$(visit_status "$RESP")" "200" "Accepted with the new link" || true
INVITEE_ID=$(json_get "$(inv_row "${INV_ID}")" '.acceptedUserId // empty')
RESP=$(inv_api "${JAR_COORD}" POST "/${INV_ID}/reissue")
assert_eq "$(visit_status "$RESP")" "409" "An accepted invitation gets no new link: 409" || true
assert_json_field "$(visit_body "$RESP")" '.code' 'invitation_not_pending' "…invitation_not_pending" || true

# ===========================================================================
# 4. No transport
# ===========================================================================

log_section "No transport: not-configured, the link answered to the inviter"

host_api_delete "settings/mail" > /dev/null 2>&1 || true
# Clearing the transport rewrites Authelia's notifier and restarts it, and
# Authelia's sessions live in memory: the inviter signs in again.
md_wait_authelia "${DOMAIN_2}"
md_sign_in "${COORD}" "${PASSWORD}" "$(reset_totp "${COORD}")" "${JAR_COORD}" "${FQDN}"
RESP=$(inv_api "${JAR_COORD}" POST "" "$(jq -c -n --arg e "${LATER_MAIL}" '{email: $e, displayName: "E2E Later", role: "viewer"}')")
assert_eq "$(visit_status "$RESP")" "201" "Another invitation: 201" || true
INV_ID_2=$(json_get "$(visit_body "$RESP")" '.invitation.id // empty')
assert_json_field "$(visit_body "$RESP")" '"\(.mail.status) \(.inviteUrl | test("/invite#"))"' 'not-configured true' "…mail not-configured, its link answered" || true
[ -n "${INV_ID_2}" ] && inv_api "${JAR_COORD}" DELETE "/${INV_ID_2}" > /dev/null || true

end_test

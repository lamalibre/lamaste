#!/usr/bin/env bash
# ============================================================================
# 58 — Mail across domains: each portal its own reset link (Three-VM)
# ============================================================================
# Which domains can send, and what their people meet (design: packages/core/
# docs/mail-design.md §3.1, §5, §6.2, Q1). Three domains of the
# multi-domain harness — A the primary, B in Turkish, C — and the SMTP
# stand-in on the host VM (mail-harness.sh).
#
# 1. B alone has a transport of its own (no relay transport): B's portal
#    links auth.<B>/reset, A's and C's link none; a reset on C is 404
#    reset_unavailable. A member of B forgets their password: the mail
#    arrives From B's sender, in Turkish, with a link on auth.<B>.
# 2. The relay's transport added: A and C link their own /reset, B still
#    its own; a reset on C is mailed From the relay's sender, in English,
#    its link on auth.<C>. B's mail still goes From B's sender.
# 3. B's transport removed: B falls back to the relay's.
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../e2e/helpers.sh"
# shellcheck source-path=SCRIPTDIR source=app-plugin-harness.sh
source "${SCRIPT_DIR}/app-plugin-harness.sh"
MD_SPEC=58
# shellcheck source-path=SCRIPTDIR source=multi-domain-harness.sh
source "${SCRIPT_DIR}/multi-domain-harness.sh"
MAIL_SPEC=58
# shellcheck source-path=SCRIPTDIR source=mail-harness.sh
source "${SCRIPT_DIR}/mail-harness.sh"

require_commands multipass curl jq openssl

RUN_ID="$(date +%s)"
# Per-run usernames: the reset caps count mails per user over an hour
USER_B="e2e58-b-${RUN_ID}"
USER_C="e2e58-c-${RUN_ID}"
# Test credentials for this run only, never printed
PASSWORD="E2E-$(openssl rand -hex 12)"

begin_test "58 — Mail across domains: each portal its own reset link (Three-VM)"

cleanup() {
  log_info "Cleaning up test resources..."
  [ -n "${DOMAIN_2:-}" ] && md_api PUT "domains/${DOMAIN_2}/language" '{"language":null}' > /dev/null 2>&1 || true
  host_api_delete "users/${USER_B}?erase=true" > /dev/null 2>&1 || true
  host_api_delete "users/${USER_C}?erase=true" > /dev/null 2>&1 || true
  mail_cleanup
  md_cleanup
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
log_section "Pre-flight"
# ---------------------------------------------------------------------------

md_preflight
mail_cleanup
md_domain_active "${DOMAIN_2}"
md_domain_active "${DOMAIN_3}"
RESP=$(md_api PUT "domains/${DOMAIN_2}/language" '{"language":"tr"}')
assert_json_field "$(body_of "$RESP")" '.domain.language' 'tr' "B speaks Turkish" || true
mail_sink_start
mail_user "${USER_B}" "[\"${DOMAIN_2}\"]" "${PASSWORD}"
mail_user "${USER_C}" "[\"${DOMAIN_3}\"]" "${PASSWORD}"

# ===========================================================================
# 1. B alone can send
# ===========================================================================

log_section "B's own transport, no relay transport"

RESP=$(mail_transport_put "domains/${DOMAIN_2}/mail" "no-reply@notify.${DOMAIN_2}" "E2E B")
assert_eq "$(status_of "$RESP")" "200" "PUT /api/domains/${DOMAIN_2}/mail: B's own transport to the sink" || true
assert_json_field "$(body_of "$RESP")" '"\(.transport.scope) \(.transport.kind)"' 'domain smtp' "…a domain row of its own" || true
assert_eq "$(host_api_get "settings/mail" | jq -c '.transport' 2>/dev/null)" "null" "The relay has no transport" || true
md_wait_authelia "${DOMAIN}"
if wait_for 90 portal_links_reset "${DOMAIN_2}" "https://auth.${DOMAIN_2}/reset"; then
  log_pass "auth.${DOMAIN_2}/ links https://auth.${DOMAIN_2}/reset"
else
  log_fail "auth.${DOMAIN_2}/: $(portal_index_reset "${DOMAIN_2}")"
fi
assert_eq "$(portal_index_reset "${DOMAIN}")" 'data-resetpasswordcustomurl=""' "auth.${DOMAIN}/ (cannot send) links no reset page" || true
assert_eq "$(portal_index_reset "${DOMAIN_3}")" 'data-resetpasswordcustomurl=""' "auth.${DOMAIN_3}/ (cannot send) links none" || true
RESP=$(mail_portal_post "${DOMAIN_3}" /api/account/reset/start "{\"identifier\":\"${USER_C}\"}")
assert_eq "$(visit_status "$RESP")" "404" "A reset on auth.${DOMAIN_3}: 404" || true
assert_json_field "$(visit_body "$RESP")" '.code' 'reset_unavailable' "…reset_unavailable" || true

log_section "A member of B forgets their password: Turkish, From B's sender"

RESP=$(mail_portal_post "${DOMAIN_2}" /api/account/reset/start "{\"identifier\":\"${USER_B}@${MAIL_DOMAIN}\"}")
assert_eq "$(visit_status "$RESP")" "202" "POST auth.${DOMAIN_2}/api/account/reset/start (by address): 202" || true
mail_wait "${USER_B}@${MAIL_DOMAIN}" 1 "The mail is in the sink"
MAIL=$(mail_last_to "${USER_B}@${MAIL_DOMAIN}")
assert_json_field "$MAIL" '.from' "no-reply@notify.${DOMAIN_2}" "…From B's sender" || true
assert_json_field "$MAIL" '.subject' 'Şifrenizi sıfırlayın' "…in Turkish: Şifrenizi sıfırlayın" || true
assert_contains "$(mail_link_in "$MAIL" "/reset#")" "https://auth.${DOMAIN_2}/reset#" "…its link on auth.${DOMAIN_2}" || true
assert_contains "$(json_get "$MAIL" '.text')" "${USER_B}" "…naming the username" || true

# ===========================================================================
# 2. The relay's transport too
# ===========================================================================

log_section "The relay's transport added: every portal its own reset link"

RESP=$(mail_transport_put "settings/mail" "no-reply@notify.${DOMAIN}" "E2E Relay")
assert_eq "$(status_of "$RESP")" "200" "PUT /api/settings/mail: the relay's transport" || true
md_wait_authelia "${DOMAIN}"
for D in "${DOMAIN}" "${DOMAIN_2}" "${DOMAIN_3}"; do
  if wait_for 90 portal_links_reset "$D" "https://auth.${D}/reset"; then
    log_pass "auth.${D}/ links https://auth.${D}/reset"
  else
    log_fail "auth.${D}/: $(portal_index_reset "$D")"
  fi
done
CONFIG=$(host_exec "${AUTHELIA_CONFIG_JSON}" 2>/dev/null | tail -n 1 || echo '{}')
assert_json_field "$CONFIG" '.authentication_backend.password_reset.custom_url' "https://auth.${DOMAIN}/reset" "Authelia's one custom_url is the primary's; the vhosts give each portal its own" || true

log_section "A member of C: English, From the relay's sender"

RESP=$(mail_portal_post "${DOMAIN_3}" /api/account/reset/start "{\"identifier\":\"${USER_C}\"}")
assert_eq "$(visit_status "$RESP")" "202" "POST auth.${DOMAIN_3}/api/account/reset/start: 202" || true
mail_wait "${USER_C}@${MAIL_DOMAIN}" 1 "The mail is in the sink"
MAIL=$(mail_last_to "${USER_C}@${MAIL_DOMAIN}")
assert_json_field "$MAIL" '.from' "no-reply@notify.${DOMAIN}" "…From the relay's sender" || true
assert_json_field "$MAIL" '.subject' 'Reset your password' "…in English" || true
assert_contains "$(mail_link_in "$MAIL" "/reset#")" "https://auth.${DOMAIN_3}/reset#" "…its link on auth.${DOMAIN_3}" || true

log_section "A reset for a member of B asked on C's portal: no mail"

BEFORE=$(mail_count_to "${USER_B}@${MAIL_DOMAIN}")
RESP=$(mail_portal_post "${DOMAIN_3}" /api/account/reset/start "{\"identifier\":\"${USER_B}\"}")
assert_eq "$(visit_status "$RESP") $(visit_body "$RESP")" '202 {"sent":true}' "auth.${DOMAIN_3}: the same answer" || true
sleep 5
assert_eq "$(mail_count_to "${USER_B}@${MAIL_DOMAIN}")" "${BEFORE}" "…but no mail: ${USER_B} is no member of C" || true

# ===========================================================================
# 3. B back on the relay's transport
# ===========================================================================

log_section "B's own transport removed: the relay's carries its mail"

RESP=$(host_api_call DELETE "domains/${DOMAIN_2}/mail")
assert_eq "$(status_of "$RESP")" "200" "DELETE /api/domains/${DOMAIN_2}/mail" || true
assert_eq "$(portal_index_reset "${DOMAIN_2}")" "data-resetpasswordcustomurl=\"https://auth.${DOMAIN_2}/reset\"" "auth.${DOMAIN_2}/ still links its own /reset" || true
RESP=$(mail_portal_post "${DOMAIN_2}" /api/account/reset/start "{\"identifier\":\"${USER_B}\"}")
assert_eq "$(visit_status "$RESP")" "202" "Another reset on auth.${DOMAIN_2}" || true
mail_wait "${USER_B}@${MAIL_DOMAIN}" 2 "…mailed"
MAIL=$(mail_last_to "${USER_B}@${MAIL_DOMAIN}")
assert_json_field "$MAIL" '"\(.from) \(.subject)"' "no-reply@notify.${DOMAIN} Şifrenizi sıfırlayın" "…From the relay's sender, still in B's Turkish" || true

end_test

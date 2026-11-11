#!/usr/bin/env bash
# ============================================================================
# 42 — Mail: a person's own account, invitations, the Gmail API (Single-VM)
# ============================================================================
# What mail gives people on one VM (design: packages/core/docs/
# mail-design.md §3.2–§3.3, §4, §6), over a stand-in SMTP server (helpers.sh
# write_smtp_sink) and a stand-in Google (write_fake_google, reached through
# LAMALIBRE_LAMASTE_TEST_GOOGLE_BASE_URL in a unit drop-in). Spec 41 is the
# relay's side.
#
# 1. The Users listing: emailDeliverable — an address under .test is not.
# 2. Forgot password, end to end on the portal: start answers alike for a
#    user and for nobody (202, after the same delay); the mail in the sink
#    with a link https://auth.<domain>/reset#<token>; lookup names the user;
#    finish needs a current authenticator code; the user signs in through
#    Authelia with the new password; a "password changed" mail follows. A
#    second link with the code already accepted: refused (totp_invalid),
#    then a fresh code sets it. A user without an authenticator: no_totp;
#    a second start while their link is live and under 10 minutes old
#    mails nothing. A member of admins: the same answer, never a mail.
# 3. Change password, signed in: behind Gatekeeper (401 without a
#    session), the current password checked, then set; signs in with it.
#    A Remote-User sent straight to the panel's loopback port names
#    nobody (401).
# 4. An administrator's invitation: mailed with its link; reissued — the
#    old link dead, a new one mailed; the listing shows the mail and the
#    reissue; the new link accepted. One granting admins: not mailed
#    unless asked; three new links a day, the fourth 429 reissue_rate.
# 5. The Gmail API: lamaste-server mail google → the consent URL; Google's
#    redirect to auth.<domain>/mail/google/callback stores the transport
#    (the account read from the token); a test mail through messages.send;
#    Google's daily limit → the account limited for 24 h, audited, mail held;
#    mail resume → sending again; mail clear.
# ============================================================================

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/helpers.sh"

require_commands curl jq node nginx openssl oathtool sqlite3

begin_test "42 — Mail: a person's own account, invitations, the Gmail API (Single-VM)"

WORK_DIR="/var/tmp/lamalibre-lamaste-e2e-mail-42"
SINK="${WORK_DIR}/sink"
SINK_PORT=2466
SINK_USER="relay"
GOOGLE_PORT=4880
GOOGLE_CLIENT_ID="123456789012-e2elamastemailtest.apps.googleusercontent.com"
MAIL_DOMAIN="e2e-mail.example.com"
RUN_ID="$(date +%s)"
# Per-run usernames: the reset caps count mails per user over an hour
RESET_USER="e2e41-reset-${RUN_ID}"
CHANGE_USER="e2e41-change-${RUN_ID}"
BARE_USER="e2e41-bare-${RUN_ID}"
TEST_ONLY_USER="e2e41-local-${RUN_ID}"
INVITEE="e2e41-inv-${RUN_ID}"
ADMIN_USER="e2e41-admin-${RUN_ID}"
ADMIN_INVITEE="e2e41-adminv-${RUN_ID}"
# Test credentials for this run only, never printed
PASSWORD="E2e-$(openssl rand -hex 12)"
NEW_PASSWORD="E2e-$(openssl rand -hex 12)"
THIRD_PASSWORD="E2e-$(openssl rand -hex 12)"
JAR="${WORK_DIR}/person.cookies"
AUDIT_BASE=0

status_of() { printf '%s\n' "$1" | tail -n 1; }
body_of() { printf '%s\n' "$1" | sed '$d'; }
json_get() { echo "$1" | jq -r "$2" 2>/dev/null || echo ""; }

call() {
  if [ -n "${3:-}" ]; then
    _curl_mtls -X "$1" -H 'Content-Type: application/json' -d "$3" -w '\n%{http_code}' "${BASE_URL}/api/$2" 2>/dev/null || true
  else
    _curl_mtls -X "$1" -w '\n%{http_code}' "${BASE_URL}/api/$2" 2>/dev/null || true
  fi
}

wait_for() {
  local deadline=$((SECONDS + $1))
  shift
  while [ "$SECONDS" -lt "$deadline" ]; do
    if "$@"; then return 0; fi
    sleep 2
  done
  return 1
}

cli_json() {
  local out
  out=$({ sudo lamaste-server "$@" --json 2>/dev/null || true; } | grep -E '^\{' | tail -n 1 || true)
  if [ -n "${out}" ]; then printf '%s\n' "${out}"; else echo '{}'; fi
}

# portal_post <path> <json> [curl args...] — a POST from the portal's own page: the body, then the status
portal_post() {
  local path="$1" body="$2"
  shift 2
  curl -sk --max-time 20 --resolve "auth.${DOMAIN}:443:127.0.0.1" -X POST -H 'Content-Type: application/json' \
    -H "Origin: https://auth.${DOMAIN}" -H 'Sec-Fetch-Site: same-origin' "$@" -d "$body" -w '\n%{http_code}' \
    "https://auth.${DOMAIN}${path}" 2>/dev/null || echo "000"
}

reset_start() { portal_post /api/account/reset/start "$(jq -c -n --arg i "$1" '{identifier: $i}')"; }
reset_lookup() { portal_post /api/account/reset/lookup "$(jq -c -n --arg t "$1" '{token: $t}')"; }
reset_finish() { portal_post /api/account/reset/finish "$(jq -c -n --arg t "$1" --arg p "$2" --arg c "$3" '{token: $t, password: $p, totp: $c}')"; }

# token_of <link> — the token after '#'
token_of() { printf '%s' "${1#*#}"; }

# new_user <username> <email> — created with PASSWORD; asserts
new_user() {
  local resp
  resp=$(api_post "users" "{\"username\":\"$1\",\"displayname\":\"E2E $1\",\"email\":\"$2\",\"password\":\"${PASSWORD}\",\"groups\":${3:-[]}}")
  assert_json_field "$resp" '.user.username' "$1" "User $1 <$2>" || true
}

invite_post() {
  curl -s --max-time 15 -X POST -H 'Content-Type: application/json' -d "$2" -w '\n%{http_code}' "${PANEL_DIRECT_URL}/api/invite/$1" 2>/dev/null || echo "000"
}

transport() { api_get "settings/mail" | jq -c '.transport' 2>/dev/null || echo "null"; }
google_sent() { curl -s --max-time 10 "http://127.0.0.1:${GOOGLE_PORT}/-/e2e/sent" 2>/dev/null || echo '[]'; }
google_config() { curl -s --max-time 10 -X POST -H 'Content-Type: application/json' -d "$1" "http://127.0.0.1:${GOOGLE_PORT}/-/e2e/config" > /dev/null 2>&1 || true; }
audit_since() {
  api_get "audit?action=$1&limit=50" | jq -c --argjson base "${AUDIT_BASE}" '[.entries[]? | select(.id > $base)]' 2>/dev/null || echo "[]"
}

cleanup() {
  log_info "Cleaning up test resources..."
  call DELETE "settings/mail" > /dev/null 2>&1 || true
  local u id
  for id in $(api_get "invitations" 2>/dev/null | jq -r '.invitations[]? | select(.username | startswith("e2e41-")) | .id' 2>/dev/null || true); do
    call DELETE "invitations/${id}" > /dev/null 2>&1 || true
    call DELETE "invitations/${id}" > /dev/null 2>&1 || true
  done
  for u in $(api_get "users" 2>/dev/null | jq -r '.users[]? | select(.username | startswith("e2e41-")) | .username' 2>/dev/null || true); do
    api_delete "users/${u}?erase=true" > /dev/null 2>&1 || true
  done
  stop_smtp_sink
  stop_fake_google
  if sudo test -e /etc/systemd/system/lamalibre-lamaste-serverd.service.d/e2e-google.conf; then mail_google_dropin ""; fi
  sudo rm -rf "${WORK_DIR}"
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
log_section "Pre-flight: onboarding complete, an SMTP transport to the sink"
# ---------------------------------------------------------------------------

ONBOARDING=$(api_get "onboarding/status" 2>/dev/null || echo '{}')
if [ "$(json_get "$ONBOARDING" '.status')" != "COMPLETED" ]; then
  log_fail "Onboarding is not complete (provision the 'provisioned' tier)"
  end_test
  exit $?
fi
DOMAIN=$(json_get "$ONBOARDING" '.domain')
log_pass "Onboarding is complete (${DOMAIN})"
cleanup
mkdir -p "${SINK}"
# The reset's per-address count lives in the panel's memory: a restart starts this run afresh
sudo systemctl restart lamalibre-lamaste-serverd
wait_for_http "${PANEL_DIRECT_URL}/api/health" 60 || log_fail "The panel does not answer after a restart"
AUDIT_BASE=$(api_get "audit?limit=1" | jq '.entries[0].id // 0' 2>/dev/null || echo "0")
start_smtp_sink "${SINK}" "${SINK_PORT}" "${SINK_USER}" || log_fail "The SMTP sink does not start"
BODY=$(jq -c -n --arg h 127.0.0.1 --argjson p "${SINK_PORT}" --arg u "${SINK_USER}" --arg pw "$(cat "${SINK}/password")" \
  --arg ca "$(cat "${SINK}/ca.pem")" --arg s "no-reply@notify.${DOMAIN}" \
  '{host: $h, port: $p, security: "tls", username: $u, password: $pw, caPem: $ca, senderAddress: $s, senderName: "E2E Relay"}')
RESP=$(call PUT "settings/mail" "${BODY}")
assert_eq "$(status_of "$RESP")" "200" "PUT /api/settings/mail: the sink, trusted through caPem" || true
local_wait_authelia "${DOMAIN}"

# ===========================================================================
# 1. The Users listing
# ===========================================================================

log_section "Who can reset their own password"

new_user "${RESET_USER}" "${RESET_USER}@${MAIL_DOMAIN}"
new_user "${CHANGE_USER}" "${CHANGE_USER}@${MAIL_DOMAIN}"
new_user "${BARE_USER}" "${BARE_USER}@${MAIL_DOMAIN}"
new_user "${TEST_ONLY_USER}" "${TEST_ONLY_USER}@example.test"
USERS=$(api_get "users")
assert_eq "$(echo "$USERS" | jq -r --arg u "${RESET_USER}" '.users[] | select(.username == $u) | .emailDeliverable' 2>/dev/null)" "true" "GET /api/users: ${RESET_USER}@${MAIL_DOMAIN} deliverable" || true
assert_eq "$(echo "$USERS" | jq -r --arg u "${TEST_ONLY_USER}" '.users[] | select(.username == $u) | .emailDeliverable' 2>/dev/null)" "false" "…an address under .test is not" || true

# ===========================================================================
# 2. Forgot password
# ===========================================================================

log_section "The reset page"

PAGE=$(curl -sk --max-time 15 --resolve "auth.${DOMAIN}:443:127.0.0.1" "https://auth.${DOMAIN}/reset" 2>/dev/null || echo "")
assert_contains "$PAGE" '<html lang="en">' "auth.${DOMAIN}/reset: the page" || true

log_section "Start answers alike, whoever is named"

T0=$(date +%s%N)
FOUND=$(reset_start "${RESET_USER}")
T1=$(date +%s%N)
MISSING=$(reset_start "e2e41-nobody-${RUN_ID}")
T2=$(date +%s%N)
assert_eq "$(status_of "$FOUND") $(body_of "$FOUND")" '202 {"sent":true}' "A user: 202 {sent: true}" || true
assert_eq "$(status_of "$MISSING") $(body_of "$MISSING")" '202 {"sent":true}' "Nobody: the same answer" || true
assert_eq "$(( (T1 - T0) / 1000000 >= 900 )) $(( (T2 - T1) / 1000000 >= 900 ))" "1 1" "…both after the same delay (about a second)" || true
if sink_wait_count "${SINK}" "${RESET_USER}@${MAIL_DOMAIN}" 1 30; then log_pass "The user's mail is in the sink"; else log_fail "No reset mail arrived"; fi
MAIL=$(sink_last_to "${SINK}" "${RESET_USER}@${MAIL_DOMAIN}")
LINK=$(mail_link "$MAIL" "/reset#")
assert_contains "$LINK" "https://auth.${DOMAIN}/reset#" "…its link https://auth.${DOMAIN}/reset#<token>" || true
assert_contains "$(json_get "$MAIL" '.text')" "${RESET_USER}" "…naming the username" || true
TOKEN=$(token_of "$LINK")

log_section "Lookup, then finish with an authenticator code"

RESP=$(reset_lookup "${TOKEN}")
assert_json_field "$(body_of "$RESP")" '.username' "${RESET_USER}" "Lookup: the user" || true
assert_eq "$(status_of "$(reset_lookup "$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=')")")" "410" "A token nobody holds: 410" || true
SECRET=$(local_reset_totp "${RESET_USER}")
CODE=$(oathtool --totp --base32 "${SECRET}")
RESP=$(reset_finish "${TOKEN}" "${NEW_PASSWORD}" "000000")
assert_eq "$(status_of "$RESP")" "400" "A wrong code: 400" || true
assert_json_field "$(body_of "$RESP")" '.code' 'totp_invalid' "…totp_invalid" || true
RESP=$(reset_finish "${TOKEN}" "${NEW_PASSWORD}" "${CODE}")
assert_eq "$(status_of "$RESP")" "200" "The token, a new password and a current code: set" || true
assert_eq "$(status_of "$(reset_lookup "${TOKEN}")")" "410" "…the link is used up" || true
local_sign_in "${RESET_USER}" "${NEW_PASSWORD}" "${SECRET}" "${JAR}" "${DOMAIN}"
assert_eq "${SIGN_IN_RESULT}" "OK OK" "${RESET_USER} signs in through Authelia with the new password" || true
if sink_wait_count "${SINK}" "${RESET_USER}@${MAIL_DOMAIN}" 2 30; then log_pass "A \"password changed\" mail follows"; else log_fail "No \"password changed\" mail"; fi
assert_json_field "$(audit_since account.password.reset)" 'length > 0' 'true' "Audited: account.password.reset" || true
assert_not_contains "$(audit_since account.password.reset-requested)" "${RESET_USER}@" "…the request audited without the address" || true

log_section "A code is good once"

RESP=$(reset_start "${RESET_USER}")
assert_eq "$(status_of "$RESP")" "202" "Another start" || true
sink_wait_count "${SINK}" "${RESET_USER}@${MAIL_DOMAIN}" 3 30 || log_fail "No second reset mail"
TOKEN=$(token_of "$(mail_link "$(sink_last_to "${SINK}" "${RESET_USER}@${MAIL_DOMAIN}")" "/reset#")")
RESP=$(reset_finish "${TOKEN}" "${THIRD_PASSWORD}" "${CODE}")
assert_json_field "$(body_of "$RESP")" '.code' 'totp_invalid' "The code already accepted: totp_invalid" || true
wait_for_next_totp_window
RESP=$(reset_finish "${TOKEN}" "${THIRD_PASSWORD}" "$(oathtool --totp --base32 "${SECRET}")")
assert_eq "$(status_of "$RESP")" "200" "A fresh code: set" || true

log_section "No authenticator, no reset by mail"

sudo /usr/local/sbin/lamaste-priv authelia-user purge-second-factors "${BARE_USER}" > /dev/null 2>&1 || true
reset_start "${BARE_USER}" > /dev/null
sink_wait_count "${SINK}" "${BARE_USER}@${MAIL_DOMAIN}" 1 30 || log_fail "No reset mail for ${BARE_USER}"
TOKEN=$(token_of "$(mail_link "$(sink_last_to "${SINK}" "${BARE_USER}@${MAIL_DOMAIN}")" "/reset#")")
RESP=$(reset_finish "${TOKEN}" "${NEW_PASSWORD}" "123456")
assert_eq "$(status_of "$RESP")" "409" "A user without an authenticator: 409" || true
assert_json_field "$(body_of "$RESP")" '.code' 'no_totp' "…no_totp (the page says to ask an administrator)" || true
RESP=$(reset_start "${BARE_USER}")
assert_eq "$(status_of "$RESP")" "202" "A second start while that link is live: the same answer" || true
sleep 5
assert_eq "$(sink_count_to "${SINK}" "${BARE_USER}@${MAIL_DOMAIN}")" "1" "…and no new mail (the link is under 10 minutes old)" || true

log_section "An administrator never resets by mail"

new_user "${ADMIN_USER}" "${ADMIN_USER}@${MAIL_DOMAIN}" '["admins"]'
RESP=$(reset_start "${ADMIN_USER}")
assert_eq "$(status_of "$RESP") $(body_of "$RESP")" '202 {"sent":true}' "A member of admins: the same answer" || true
RESP=$(reset_start "${ADMIN_USER}@${MAIL_DOMAIN}")
assert_eq "$(status_of "$RESP")" "202" "…by address too" || true
sleep 5
assert_eq "$(sink_count_to "${SINK}" "${ADMIN_USER}@${MAIL_DOMAIN}")" "0" "…and no mail" || true

# ===========================================================================
# 3. Change password
# ===========================================================================

log_section "Change password, signed in"

RESP=$(portal_post /api/account/password "$(jq -c -n --arg c "${PASSWORD}" --arg n "${NEW_PASSWORD}" '{currentPassword: $c, newPassword: $n}')")
assert_eq "$(status_of "$RESP")" "401" "Without a session: 401 (Gatekeeper asks Authelia)" || true
RESP=$(curl -s --max-time 15 -X POST -H "Host: auth.${DOMAIN}" -H 'Content-Type: application/json' \
  -H "Origin: https://auth.${DOMAIN}" -H "Remote-User: ${CHANGE_USER}" \
  -d "$(jq -c -n --arg c "${PASSWORD}" --arg n "${NEW_PASSWORD}" '{currentPassword: $c, newPassword: $n}')" \
  -w '\n%{http_code}' "http://127.0.0.1:3100/api/account/password" 2>/dev/null || echo "000")
assert_eq "$(status_of "$RESP")" "401" "Remote-User sent straight to 127.0.0.1:3100: 401 — the panel takes the user from Gatekeeper's assertion alone" || true
VHOST=$(sudo cat "/etc/nginx/sites-available/lamalibre-lamaste-auth-${DOMAIN}" 2>/dev/null || echo "")
assert_contains "$VHOST" "proxy_pass http://127.0.0.1:9294/authz/account/${DOMAIN};" "The auth vhost asks Gatekeeper for the password change" || true
CHANGE_SECRET=$(local_reset_totp "${CHANGE_USER}")
local_sign_in "${CHANGE_USER}" "${PASSWORD}" "${CHANGE_SECRET}" "${JAR}" "${DOMAIN}"
assert_eq "${SIGN_IN_RESULT}" "OK OK" "${CHANGE_USER} signs in" || true
assert_eq "$(curl -sk --max-time 15 --resolve "auth.${DOMAIN}:443:127.0.0.1" -b "${JAR}" -o /dev/null -w '%{http_code}' "https://auth.${DOMAIN}/account/password" 2>/dev/null)" "200" "auth.${DOMAIN}/account/password: the page" || true
RESP=$(portal_post /api/account/password "$(jq -c -n --arg c "wrong-${PASSWORD}" --arg n "${NEW_PASSWORD}" '{currentPassword: $c, newPassword: $n}')" -b "${JAR}")
assert_json_field "$(body_of "$RESP")" '.code' 'current_password_invalid' "A wrong current password: current_password_invalid" || true
RESP=$(portal_post /api/account/password "$(jq -c -n --arg c "${PASSWORD}" --arg n "${NEW_PASSWORD}" '{currentPassword: $c, newPassword: $n}')" -b "${JAR}")
assert_eq "$(status_of "$RESP")" "200" "The current password, then the new one: set" || true
local_sign_in "${CHANGE_USER}" "${NEW_PASSWORD}" "${CHANGE_SECRET}" "${JAR}" "${DOMAIN}"
assert_eq "${SIGN_IN_RESULT}" "OK OK" "…signs in with it" || true
if sink_wait_count "${SINK}" "${CHANGE_USER}@${MAIL_DOMAIN}" 1 30; then log_pass "A \"password changed\" mail"; else log_fail "No \"password changed\" mail"; fi

# ===========================================================================
# 4. An administrator's invitation
# ===========================================================================

log_section "Mailed, reissued, accepted"

INV=$(api_post "invitations" "{\"username\":\"${INVITEE}\",\"email\":\"${INVITEE}@${MAIL_DOMAIN}\"}")
INV_ID=$(json_get "$INV" '.invitation.id')
OLD_TOKEN=$(json_get "$INV" '.token')
assert_json_field "$INV" '.mail.status' 'sent' "POST /api/invitations: mailed" || true
sink_wait_count "${SINK}" "${INVITEE}@${MAIL_DOMAIN}" 1 30 || log_fail "No invitation mail"
assert_eq "$(mail_link "$(sink_last_to "${SINK}" "${INVITEE}@${MAIL_DOMAIN}")" "/invite#")" "$(json_get "$INV" '.inviteUrl')" "…the mail carries the link answered" || true
RE=$(api_post "invitations/${INV_ID}/reissue" '{}')
NEW_TOKEN=$(json_get "$RE" '.token')
assert_json_field "$RE" '"\(.mail.status) \(.invitation.id)"' "sent ${INV_ID}" "POST /api/invitations/${INV_ID}/reissue: the same invitation, mailed again" || true
assert_not_eq "${NEW_TOKEN}" "${OLD_TOKEN}" "…a new token" || true
sink_wait_count "${SINK}" "${INVITEE}@${MAIL_DOMAIN}" 2 30 || log_fail "No second invitation mail"
assert_eq "$(mail_link "$(sink_last_to "${SINK}" "${INVITEE}@${MAIL_DOMAIN}")" "/invite#")" "$(json_get "$RE" '.inviteUrl')" "…the new link mailed" || true
OLD=$(invite_post lookup "{\"token\":\"${OLD_TOKEN}\"}")
assert_not_eq "$(status_of "$OLD")" "200" "The old link is dead ($(status_of "$OLD"))" || true
ROW=$(api_get "invitations" | jq -c --arg i "${INV_ID}" '.invitations[] | select(.id == $i)' 2>/dev/null || echo '{}')
assert_json_field "$ROW" '"\(.mail.status) \(.reissuedAt != null)"' 'sent true' "The listing: mail sent, reissued" || true
RESP=$(invite_post accept "$(jq -c -n --arg t "${NEW_TOKEN}" --arg p "${PASSWORD}" '{token: $t, password: $p}')")
assert_eq "$(status_of "$RESP")" "200" "The new link accepted" || true

log_section "An invitation that makes an administrator: not mailed unless asked"

INV=$(api_post "invitations" "{\"username\":\"${ADMIN_INVITEE}\",\"email\":\"${ADMIN_INVITEE}@${MAIL_DOMAIN}\",\"groups\":[\"admins\"]}")
ADMIN_INV_ID=$(json_get "$INV" '.invitation.id')
assert_json_field "$INV" '"\(.mail) \(.inviteUrl | test("/invite#"))"' 'null true' "POST /api/invitations (admins): not mailed, its link answered" || true
RE=$(api_post "invitations/${ADMIN_INV_ID}/reissue" '{}')
assert_json_field "$RE" '.mail' 'null' "…a new link: not mailed either" || true
RE=$(api_post "invitations/${ADMIN_INV_ID}/reissue" '{"mail":true}')
assert_json_field "$RE" '.mail.status' 'sent' "…a new link with mail: true — mailed" || true
sink_wait_count "${SINK}" "${ADMIN_INVITEE}@${MAIL_DOMAIN}" 1 30 || log_fail "No mail for the administrator's invitation asked to be mailed"
RE=$(api_post "invitations/${ADMIN_INV_ID}/reissue" '{"mail":false}')
assert_json_field "$RE" '.mail' 'null' "A third new link: allowed" || true
RESP=$(call POST "invitations/${ADMIN_INV_ID}/reissue" '{}')
assert_eq "$(status_of "$RESP")" "429" "A fourth new link the same day: 429" || true
assert_json_field "$(body_of "$RESP")" '.code' 'reissue_rate' "…reissue_rate" || true
call DELETE "invitations/${ADMIN_INV_ID}" > /dev/null 2>&1 || true

# ===========================================================================
# 5. The Gmail API
# ===========================================================================

log_section "Google's consent, against a stand-in Google"

start_fake_google "${WORK_DIR}/google" "${GOOGLE_PORT}" "${GOOGLE_CLIENT_ID}" "relay@${MAIL_DOMAIN}" || log_fail "The stand-in Google does not start"
mail_google_dropin "http://127.0.0.1:${GOOGLE_PORT}"
BEFORE=$(json_get "$(transport)" '.updatedAt')
OUT=$({ sudo lamaste-server mail google --client-id "${GOOGLE_CLIENT_ID}" --client-secret-stdin \
  --sender "no-reply@notify.${DOMAIN}" --sender-name "E2E Relay" --no-wait --json < "${WORK_DIR}/google/client-secret" 2>/dev/null || true; } | grep -E '^\{' | head -n 1 || echo '{}')
AUTHORIZE=$(json_get "$OUT" '.authorizeUrl')
assert_contains "${AUTHORIZE}" "http://127.0.0.1:${GOOGLE_PORT}/o/oauth2/v2/auth?" "mail google: the consent URL" || true
assert_contains "${AUTHORIZE}" "code_challenge_method=S256" "…with PKCE" || true
assert_contains "${AUTHORIZE}" "access_type=offline" "…offline access" || true
BACK=$(curl -s --max-time 15 -o /dev/null -w '%{redirect_url}' "${AUTHORIZE}" 2>/dev/null || echo "")
assert_contains "${BACK}" "https://auth.${DOMAIN}/mail/google/callback?" "Google sends the browser back to auth.${DOMAIN}/mail/google/callback" || true
PAGE=$(curl -sk --max-time 30 --resolve "auth.${DOMAIN}:443:127.0.0.1" -w '\n%{http_code}' "${BACK}" 2>/dev/null || echo "000")
assert_eq "$(status_of "$PAGE")" "200" "…which answers" || true
assert_contains "$(body_of "$PAGE")" "Mail Is Set Up" "…Mail Is Set Up" || true
assert_eq "$(status_of "$(curl -sk --max-time 30 --resolve "auth.${DOMAIN}:443:127.0.0.1" -o /dev/null -w '\n%{http_code}' "${BACK}" 2>/dev/null)")" "200" "The same return again: answered" || true
assert_not_contains "$(curl -sk --max-time 30 --resolve "auth.${DOMAIN}:443:127.0.0.1" "${BACK}" 2>/dev/null)" "Mail Is Set Up" "…but not stored again (the state is single use)" || true
T=$(transport)
assert_json_field "$T" '"\(.kind) \(.settings.account) \(.settings.clientId)"' "gmail-api relay@${MAIL_DOMAIN} ${GOOGLE_CLIENT_ID}" "GET /api/settings/mail: gmail-api, the account read from Google's token" || true
assert_not_eq "$(json_get "$T" '.updatedAt')" "${BEFORE}" "…a newer transport than the SMTP one" || true
assert_not_contains "$T" "$(cat "${WORK_DIR}/google/client-secret")" "…never the client secret" || true

log_section "Sending through messages.send"

OUT=$(cli_json mail test "google-check@${MAIL_DOMAIN}")
assert_json_field "$OUT" '.mail.status' 'sent' "mail test: sent" || true
SENT=$(google_sent | jq -c --arg t "google-check@${MAIL_DOMAIN}" '[.[] | select(.to | test($t))] | last' 2>/dev/null || echo null)
assert_json_field "$SENT" '.from | test("no-reply@notify")' 'true' "…through the stand-in Google, From the sender" || true

log_section "Google's daily limit: the account rests for 24 hours"

google_config '{"sendError":{"status":403,"reason":"dailyLimitExceeded"}}'
OUT=$(cli_json mail test "google-limit@${MAIL_DOMAIN}")
assert_not_eq "$(json_get "$OUT" '.mail.status')" "sent" "mail test: not sent ($(json_get "$OUT" '.mail.status'))" || true
assert_json_field "$(transport)" '.budget.limitedUntil != null' 'true' "The account limited" || true
assert_json_field "$(audit_since mail.transport.limited)" 'length > 0' 'true' "Audited: mail.transport.limited" || true
google_config '{"sendError":null}'
OUT=$(cli_json mail test "google-held@${MAIL_DOMAIN}")
assert_not_eq "$(json_get "$OUT" '.mail.status')" "sent" "While limited no mail is tried, even with Google willing" || true
OUT=$(cli_json mail resume)
assert_json_field "$OUT" '.transport.budget.limitedUntil' 'null' "mail resume: no longer limited" || true
OUT=$(cli_json mail test "google-again@${MAIL_DOMAIN}")
assert_json_field "$OUT" '.mail.status' 'sent' "…a test mail sent again" || true

log_section "Cleared"

OUT=$(cli_json mail clear)
assert_json_field "$OUT" '.event' 'complete' "mail clear" || true
assert_eq "$(transport)" "null" "…no transport" || true

end_test

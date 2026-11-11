#!/usr/bin/env bash
# ============================================================================
# 41 — Mail: the relay's transport and Authelia's mail (Single-VM)
# ============================================================================
# The relay's side of mail on one VM (design: packages/core/docs/
# mail-design.md §3–§5, §7, §8). The relay reaches no real mail server: the
# transport is `smtp` to a stand-in on this VM (helpers.sh write_smtp_sink,
# implicit TLS, a certificate from a private CA the transport trusts through
# caPem). Spec 42 is a person's side (reset, change, invitations) and the
# Gmail API transport.
#
# 1. Without mail: no transport, Authelia's notifier a file, nothing on
#    127.0.0.1:9295, no reset link on the portal, /api/account/reset 404.
# 2. The transport through lamaste-server: refused without the private CA
#    (tls), stored with it (--ca-file, --password-stdin), shown without a
#    secret, the CA bundle kept when a change omits it, a test mail in the
#    sink From the sender, the daily limit and its shares.
# 3. Authelia's mail: the listener on 9295 (its CA name-constrained to
#    lamaste-mail.localhost), Authelia's notifier submitting
#    to it with its password through a template line (kept by every later
#    rewrite), the reset link and the change-password link on the portal;
#    Authelia's one-time code (session elevation) arrives in the sink From
#    the relay's sender; the listener refuses a wrong password.
# 4. D6: a tunnel and a site on the sending host refused; a sender on a
#    hostname a tunnel serves refused.
# 5. A tunnel holding 9295 (a relay older than 4.14): the listener refused,
#    audited, the administrators told, Authelia back to the file notifier;
#    the tunnel moved, the listener back.
# 6. A domain's own sender over the relay's transport.
# 7. The budget: an administrator's invitation mailed until the ceiling
#    (the reserve no other class reaches), then deferred-budget,
#    mail.budget.exhausted audited.
# 8. The sink down: an invitation answers failed with its link; Authelia
#    still signs people in.
# ============================================================================

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/helpers.sh"

require_commands curl jq node nginx openssl oathtool sqlite3 ss

begin_test "41 — Mail: the relay's transport and Authelia's mail (Single-VM)"

STATE_DIR="/etc/lamalibre/lamaste"
WORK_DIR="/var/tmp/lamalibre-lamaste-e2e-mail-41"
SINK_PORT=2465
SINK_USER="relay"
USER_ONE="e2e40-one"
MAIL_DOMAIN="e2e-mail.example.com"
OWNER_LABEL="e2e40-owner-$(date +%s)"
HOLD_SUB="e2e40hold"
HOLD_PORT=19295
SENDER_SUB="e2e40snd"
SITE_NAME="notify"
# Test credentials for this run only, never printed
PASSWORD="E2e-$(openssl rand -hex 12)"
JAR="${WORK_DIR}/one.cookies"
AUDIT_BASE=0
SECRET_ONE=""
HOLD_ID=""
SENDER_TUNNEL_ID=""

status_of() { printf '%s\n' "$1" | tail -n 1; }
body_of() { printf '%s\n' "$1" | sed '$d'; }
json_get() { echo "$1" | jq -r "$2" 2>/dev/null || echo ""; }

# call <method> <api path> [<json>] — the panel API as the admin: the body, then the status
call() {
  if [ -n "${3:-}" ]; then
    _curl_mtls -X "$1" -H 'Content-Type: application/json' -d "$3" -w '\n%{http_code}' "${BASE_URL}/api/$2" 2>/dev/null || true
  else
    _curl_mtls -X "$1" -w '\n%{http_code}' "${BASE_URL}/api/$2" 2>/dev/null || true
  fi
}

# wait_for <seconds> <command...> — until the command succeeds (every 2 s)
wait_for() {
  local deadline=$((SECONDS + $1))
  shift
  while [ "$SECONDS" -lt "$deadline" ]; do
    if "$@"; then return 0; fi
    sleep 2
  done
  return 1
}

restart_panel() {
  sudo systemctl restart lamalibre-lamaste-serverd
  wait_for_http "${PANEL_DIRECT_URL}/api/health" 60 || log_fail "The panel does not answer after a restart"
}

# cli_json <args...> — lamaste-server <args> --json: its last JSON line
cli_json() {
  local out
  out=$({ sudo lamaste-server "$@" --json 2>/dev/null || true; } | grep -E '^\{' | tail -n 1 || true)
  if [ -n "${out}" ]; then printf '%s\n' "${out}"; else echo '{}'; fi
}

# set_smtp <extra flags...> — mail set-smtp against the sink, the password on stdin
set_smtp() {
  local out
  out=$({ sudo lamaste-server mail set-smtp --host 127.0.0.1 --port "${SINK_PORT}" --security tls \
    --username "${SINK_USER}" --password-stdin --sender "no-reply@notify.${DOMAIN}" \
    --sender-name "E2E Relay" "$@" --json < "${WORK_DIR}/sink/password" 2>/dev/null || true; } | grep -E '^\{' | tail -n 1 || true)
  if [ -n "${out}" ]; then printf '%s\n' "${out}"; else echo '{}'; fi
}

transport() { api_get "settings/mail" | jq -c '.transport' 2>/dev/null || echo "null"; }
listening() { [ -n "$(ss -ltnH 'sport = :9295' 2>/dev/null)" ]; }
not_listening() { ! listening; }
authelia_config() { sudo bash -c "${AUTHELIA_CONFIG_JSON}" 2>/dev/null || echo '{}'; }
notifier_kind() { authelia_config | jq -r '.notifier | if .smtp then "smtp" elif .filesystem then "filesystem" else "none" end' 2>/dev/null || echo ""; }
notifier_is() { [ "$(notifier_kind)" = "$1" ]; }
auth_get() { curl -sk --max-time 15 --resolve "auth.${DOMAIN}:443:127.0.0.1" "https://auth.${DOMAIN}$1" 2>/dev/null || echo ""; }
reset_link_of_portal() { auth_get / | grep -o 'data-resetpasswordcustomurl="[^"]*"' | head -n 1 || true; }
portal_links() { [ "$(reset_link_of_portal)" = "data-resetpasswordcustomurl=\"$1\"" ]; }
audit_since() {
  api_get "audit?action=$1&limit=50" | jq -c --argjson base "${AUDIT_BASE}" '[.entries[]? | select(.id > $base)]' 2>/dev/null || echo "[]"
}
sender_named() { [ "$(authelia_config | jq -r --arg n "$1" '.notifier.smtp.sender // "" | startswith($n)' 2>/dev/null)" = "true" ]; }
template_lines() { sudo grep -c 'mail-submission-password' /etc/authelia/configuration.yml 2>/dev/null || echo 0; }
sink_holds() { sink_wait_count "${WORK_DIR}/sink" "$1" "$2" "${3:-30}"; }

# admin_invite <username> — an administrator's invitation to <username>@MAIL_DOMAIN: the answer, compact
admin_invite() {
  api_post "invitations" "{\"username\":\"$1\",\"email\":\"$1@${MAIL_DOMAIN}\"}" | jq -c '.' 2>/dev/null || echo '{}'
}

cleanup() {
  log_info "Cleaning up test resources..."
  call DELETE "settings/mail" > /dev/null 2>&1 || true
  [ -n "${DOMAIN:-}" ] && call DELETE "domains/${DOMAIN}/mail" > /dev/null 2>&1 || true
  local id
  for id in $(api_get "invitations" 2>/dev/null | jq -r '.invitations[]? | select(.username | startswith("e2e40-")) | .id' 2>/dev/null || true); do
    call DELETE "invitations/${id}" > /dev/null 2>&1 || true
    call DELETE "invitations/${id}" > /dev/null 2>&1 || true
  done
  api_delete "users/${USER_ONE}?erase=true" > /dev/null 2>&1 || true
  for id in $(api_get "tunnels" 2>/dev/null | jq -r --arg a "${HOLD_SUB}" --arg b "${SENDER_SUB}" '.tunnels[]? | select(.subdomain == $a or .subdomain == $b or .subdomain == "notify") | .id' 2>/dev/null || true); do
    api_delete "tunnels/${id}" > /dev/null 2>&1 || true
  done
  for id in $(api_get "sites" 2>/dev/null | jq -r --arg n "${SITE_NAME}" '.sites[]? | select(.name == $n) | .id' 2>/dev/null || true); do
    api_delete "sites/${id}" > /dev/null 2>&1 || true
  done
  api_delete "certs/agent/${OWNER_LABEL}" > /dev/null 2>&1 || true
  stop_smtp_sink
  sudo rm -rf "${WORK_DIR}"
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
log_section "Pre-flight: onboarding complete"
# ---------------------------------------------------------------------------

ONBOARDING=$(api_get "onboarding/status" 2>/dev/null || echo '{}')
if [ "$(json_get "$ONBOARDING" '.status')" != "COMPLETED" ]; then
  log_fail "Onboarding is not complete (provision the 'provisioned' tier)"
  end_test
  exit $?
fi
DOMAIN=$(json_get "$ONBOARDING" '.domain')
log_pass "Onboarding is complete (${DOMAIN})"
# Leftovers of an interrupted run (rodeo ends a spec at ten minutes without its trap)
cleanup
mkdir -p "${WORK_DIR}/sink"
AUDIT_BASE=$(api_get "audit?limit=1" | jq '.entries[0].id // 0' 2>/dev/null || echo "0")
OWNER=$(api_post "certs/agent" "{\"label\":\"${OWNER_LABEL}\",\"capabilities\":[\"tunnels:read\"]}")
assert_json_field "$OWNER" '.ok' 'true' "An owning agent certificate for the spec's tunnels (${OWNER_LABEL})" || true

# ===========================================================================
# 1. Without mail
# ===========================================================================

log_section "Without mail: a file notifier, no listener, no reset link"

assert_eq "$(transport)" "null" "GET /api/settings/mail: no transport" || true
if wait_for 60 notifier_is filesystem; then log_pass "Authelia's notifier is a file"; else log_fail "Authelia's notifier: $(notifier_kind)"; fi
if wait_for 30 not_listening; then log_pass "Nothing listens on 127.0.0.1:9295"; else log_fail "Something listens on 9295 without a transport"; fi
assert_json_field "$(authelia_config)" '"\(.authentication_backend.password_reset.disable) \(.authentication_backend.password_change.disable)"' 'true true' "Authelia's own reset and change are off" || true
assert_eq "$(reset_link_of_portal)" 'data-resetpasswordcustomurl=""' "The portal links no reset page" || true
RESP=$(curl -sk --max-time 15 --resolve "auth.${DOMAIN}:443:127.0.0.1" -X POST -H 'Content-Type: application/json' -H "Origin: https://auth.${DOMAIN}" -d '{"identifier":"nobody"}' -w '\n%{http_code}' "https://auth.${DOMAIN}/api/account/reset/start" 2>/dev/null || echo "000")
assert_eq "$(status_of "$RESP")" "404" "POST auth.${DOMAIN}/api/account/reset/start: 404 (no mail, no reset)" || true
assert_json_field "$(body_of "$RESP")" '.code' 'reset_unavailable' "…reset_unavailable" || true

# ===========================================================================
# 2. The transport
# ===========================================================================

log_section "The stand-in SMTP server"

if start_smtp_sink "${WORK_DIR}/sink" "${SINK_PORT}" "${SINK_USER}"; then
  log_pass "The SMTP sink answers on 127.0.0.1:${SINK_PORT} (implicit TLS, a private CA)"
else
  log_fail "The SMTP sink does not start: $(tail -n 5 "${WORK_DIR}/sink/sink.log" 2>/dev/null)"
fi

log_section "lamaste-server mail set-smtp: refused without the CA, stored with it"

OUT=$(set_smtp)
assert_json_field "$OUT" '"\(.event) \(.code)"' 'error mail_check_failed' "Without --ca-file: refused at the check (mail_check_failed)" || true
assert_eq "$(transport)" "null" "…nothing stored" || true
OUT=$(set_smtp --ca-file "${WORK_DIR}/sink/ca.pem")
assert_json_field "$OUT" '"\(.event) \(.transport.kind) \(.transport.settings.hasCaPem) \(.transport.health.status)"' 'complete smtp true up' "With --ca-file and --password-stdin: checked and stored, healthy" || true
assert_json_field "$OUT" '"\(.transport.budget.dailyLimit) \(.transport.budget.ceiling)"' '500 450' "…the default daily limit 500, ceiling 450" || true
assert_json_field "$OUT" '"\(.transport.budget.essentialCap) \(.transport.budget.publicCap) \(.transport.budget.adminReserve)"' '180 180 90' "…shared: Authelia's 180, public 180, the administrators' reserve 90" || true
SHOWN=$(cli_json mail show)
assert_json_field "$SHOWN" '"\(.transport.sender.address) \(.transport.sender.name) \(.transport.hasSecret)"' "no-reply@notify.${DOMAIN} E2E Relay true" "mail show: the sender, a secret held" || true
assert_not_contains "$SHOWN" "$(cat "${WORK_DIR}/sink/password")" "…never the password" || true
assert_not_contains "$SHOWN" "BEGIN CERTIFICATE" "…never the CA bundle" || true
assert_not_contains "$(api_get "audit?action=mail.transport.set&limit=5")" "$(cat "${WORK_DIR}/sink/password")" "The audit carries no password" || true

OUT=$(set_smtp)
assert_json_field "$OUT" '"\(.event) \(.transport.settings.hasCaPem)"' 'complete true' "set-smtp again without --ca-file: the stored CA bundle kept (same host)" || true

log_section "A test mail, the daily limit"

OUT=$(cli_json mail test "check@${MAIL_DOMAIN}")
assert_json_field "$OUT" '.mail.status' 'sent' "mail test check@${MAIL_DOMAIN}: sent" || true
if sink_holds "check@${MAIL_DOMAIN}" 1; then log_pass "…in the sink"; else log_fail "…not in the sink"; fi
MAIL=$(sink_last_to "${WORK_DIR}/sink" "check@${MAIL_DOMAIN}")
assert_json_field "$MAIL" '.from' "no-reply@notify.${DOMAIN}" "…envelope From the sender" || true
assert_json_field "$MAIL" '.headers.from | test("E2E Relay")' 'true' "…From header names the sender's name" || true
assert_json_field "$MAIL" '.headers."auto-submitted"' 'auto-generated' "…Auto-Submitted: auto-generated" || true
assert_json_field "$MAIL" '.to | length' '1' "…one recipient" || true
OUT=$(cli_json mail limit 2000)
assert_json_field "$OUT" '"\(.transport.budget.dailyLimit) \(.transport.budget.ceiling)"' '2000 1800' "mail limit 2000: ceiling 1800" || true

# ===========================================================================
# 3. Authelia's mail
# ===========================================================================

log_section "Authelia submits to the listener"

if wait_for 60 listening; then log_pass "The submission listener listens on 127.0.0.1:9295"; else log_fail "Nothing listens on 9295"; fi
if wait_for 60 notifier_is smtp; then log_pass "Authelia's notifier is SMTP"; else log_fail "Authelia's notifier: $(notifier_kind)"; fi
CONFIG=$(authelia_config)
assert_json_field "$CONFIG" '"\(.notifier.smtp.address) \(.notifier.smtp.username) \(.notifier.smtp.tls.server_name) \(.notifier.disable_startup_check)"' 'submissions://127.0.0.1:9295 authelia lamaste-mail.localhost true' "…submissions://127.0.0.1:9295 as authelia, the listener's name checked, no startup check" || true
assert_json_field "$CONFIG" '.certificates_directory' '/etc/authelia/certs' "…certificates_directory /etc/authelia/certs" || true
assert_json_field "$CONFIG" '.notifier.smtp.sender | test("no-reply@notify")' 'true' "…the relay's sender" || true
assert_eq "$(template_lines)" "1" "The password is a template line naming /etc/authelia/mail-submission-password (once)" || true
assert_eq "$(sudo stat -c '%a %U:%G' /etc/authelia/mail-submission-password 2>/dev/null)" "640 lamaste:lamaste-authelia" "…the password file 0640 lamaste:lamaste-authelia" || true
assert_eq "$(sudo ls /etc/authelia/certs 2>/dev/null | tr '\n' ' ')" "lamaste-mail-ca.pem " "/etc/authelia/certs holds the listener's CA alone" || true
CA_TEXT=$(sudo openssl x509 -noout -text -in /etc/authelia/certs/lamaste-mail-ca.pem 2>/dev/null || echo "")
assert_contains "$CA_TEXT" "X509v3 Name Constraints: critical" "…name-constrained (critical)" || true
assert_contains "$CA_TEXT" "DNS:lamaste-mail.localhost" "…to lamaste-mail.localhost alone" || true
CALLBACK=$(sudo cat "/etc/nginx/sites-available/lamalibre-lamaste-auth-${DOMAIN}" 2>/dev/null | awk '/location = \/mail\/google\/callback/,/}/' || echo "")
assert_contains "$CALLBACK" "access_log off;" "The consent callback keeps no access log (its query carries Google's code)" || true
assert_json_field "$CONFIG" '"\(.authentication_backend.password_reset.custom_url) \(.authentication_backend.password_change.disable)"' "https://auth.${DOMAIN}/reset true" "password_reset.custom_url is the portal's /reset; change stays off" || true
local_wait_authelia "${DOMAIN}"
if wait_for 60 portal_links "https://auth.${DOMAIN}/reset"; then
  log_pass "The portal links https://auth.${DOMAIN}/reset"
else
  log_fail "The portal's reset link: $(reset_link_of_portal)"
fi
assert_contains "$(auth_get /)" 'href="/account/password"' "…and the change-password page" || true

log_section "The template line survives a rewrite"

OUT=$(cli_json mail sender --name "E2E Relay Two")
assert_json_field "$OUT" '.transport.sender.name' 'E2E Relay Two' "mail sender --name: renamed" || true
if wait_for 60 sender_named "E2E Relay Two"; then
  log_pass "Authelia's sender follows"
else
  log_fail "Authelia's sender: $(authelia_config | jq -r '.notifier.smtp.sender')"
fi
assert_eq "$(template_lines)" "1" "…the template line still there, once" || true
local_wait_authelia "${DOMAIN}"

log_section "Authelia's one-time code through the listener"

RESP=$(api_post "users" "{\"username\":\"${USER_ONE}\",\"displayname\":\"E2E One\",\"email\":\"${USER_ONE}@${MAIL_DOMAIN}\",\"password\":\"${PASSWORD}\",\"groups\":[]}")
assert_json_field "$RESP" '.user.username' "${USER_ONE}" "A user with a deliverable address" || true
SECRET_ONE=$(local_reset_totp "${USER_ONE}")
local_sign_in "${USER_ONE}" "${PASSWORD}" "${SECRET_ONE}" "${JAR}" "${DOMAIN}"
assert_eq "${SIGN_IN_RESULT}" "OK OK" "${USER_ONE} signs in (two factors)" || true
BEFORE=$(sink_count_to "${WORK_DIR}/sink" "${USER_ONE}@${MAIL_DOMAIN}")
ELEVATE=$(curl -sk --max-time 20 --resolve "auth.${DOMAIN}:443:127.0.0.1" -b "${JAR}" -c "${JAR}" -X POST -H 'Content-Type: application/json' -d '{}' "https://auth.${DOMAIN}/api/user/session/elevation" 2>/dev/null || echo '{}')
assert_json_field "$ELEVATE" '.status' 'OK' "POST /api/user/session/elevation: Authelia mails a one-time code" || true
if sink_holds "${USER_ONE}@${MAIL_DOMAIN}" $((BEFORE + 1)) 45; then
  log_pass "…which arrives in the sink"
else
  log_fail "…which never arrives (sink $(sink_count_to "${WORK_DIR}/sink" "${USER_ONE}@${MAIL_DOMAIN}"), $(sudo journalctl -u lamalibre-lamaste-serverd --since '-2 min' --no-pager 2>/dev/null | grep -i submission | tail -n 3))"
fi
MAIL=$(sink_last_to "${WORK_DIR}/sink" "${USER_ONE}@${MAIL_DOMAIN}")
assert_json_field "$MAIL" '.from' "no-reply@notify.${DOMAIN}" "…From the relay's sender" || true
assert_json_field "$MAIL" '.to | join(",")' "${USER_ONE}@${MAIL_DOMAIN}" "…to the user alone" || true

log_section "The listener admits Authelia alone"

LISTENER=$(printf 'EHLO e2e\r\nAUTH PLAIN %s\r\nQUIT\r\n' "$(printf '\0authelia\0wrong-password' | base64 -w0)" | timeout 10 openssl s_client -quiet -connect 127.0.0.1:9295 2>/dev/null || true)
assert_contains "$LISTENER" "535" "A wrong password: 535" || true
LISTENER=$(printf 'EHLO e2e\r\nMAIL FROM:<x@example.com>\r\nQUIT\r\n' | timeout 10 openssl s_client -quiet -connect 127.0.0.1:9295 2>/dev/null || true)
assert_not_contains "$LISTENER" "250 2.1.0" "MAIL without AUTH: not accepted" || true

# ===========================================================================
# 4. D6 — the sending host is not a web hostname
# ===========================================================================

log_section "The sending host: no tunnel, no site there"

RESP=$(call POST "tunnels" "{\"subdomain\":\"notify\",\"port\":19401,\"description\":\"e2e40 sender host\",\"agentLabel\":\"${OWNER_LABEL}\"}")
assert_eq "$(status_of "$RESP")" "400" "A tunnel at notify.${DOMAIN}: 400" || true
assert_contains "$(body_of "$RESP")" "sending domain" "…the relay's mail holds it" || true
RESP=$(call POST "sites" "{\"name\":\"${SITE_NAME}\",\"type\":\"managed\",\"spaMode\":false,\"autheliaProtected\":false}")
assert_eq "$(status_of "$RESP")" "400" "A site named ${SITE_NAME}: 400" || true
assert_json_field "$(body_of "$RESP")" '.code // .error' 'MAIL_SENDER_HOST' "…MAIL_SENDER_HOST" || true
RESP=$(api_post "tunnels" "{\"subdomain\":\"${SENDER_SUB}\",\"port\":19402,\"description\":\"e2e40 a tunnel's host\",\"agentLabel\":\"${OWNER_LABEL}\"}")
SENDER_TUNNEL_ID=$(json_get "$RESP" '.tunnel.id // empty')
RESP=$(call PATCH "settings/mail" "{\"senderAddress\":\"no-reply@${SENDER_SUB}.${DOMAIN}\"}")
assert_eq "$(status_of "$RESP")" "409" "A sender at ${SENDER_SUB}.${DOMAIN}, which a tunnel serves: 409" || true
assert_json_field "$(body_of "$RESP")" '.code' 'mail_sender_host_taken' "…mail_sender_host_taken" || true
[ -n "${SENDER_TUNNEL_ID}" ] && api_delete "tunnels/${SENDER_TUNNEL_ID}" > /dev/null 2>&1 || true

# ===========================================================================
# 5. A tunnel holding 9295
# ===========================================================================

log_section "Port 9295 reserved; a tunnel left there by an older relay"

assert_eq "$(api_post_status "tunnels" "{\"subdomain\":\"e2e40res\",\"port\":9295,\"description\":\"e2e40 reserved\",\"agentLabel\":\"${OWNER_LABEL}\"}")" "400" "A new tunnel on 9295: 400 (reserved)" || true
RESP=$(api_post "tunnels" "{\"subdomain\":\"${HOLD_SUB}\",\"port\":${HOLD_PORT},\"description\":\"e2e40 holder\",\"agentLabel\":\"${OWNER_LABEL}\"}")
HOLD_ID=$(json_get "$RESP" '.tunnel.id // empty')
AUDIT_HOLD=$(api_get "audit?limit=1" | jq '.entries[0].id // 0' 2>/dev/null || echo "0")
sudo systemctl stop lamalibre-lamaste-serverd
sudo bash -c "jq 'map(if .id == \"${HOLD_ID}\" then .port = 9295 else . end)' ${STATE_DIR}/tunnels.json > ${WORK_DIR}/tunnels.json && cat ${WORK_DIR}/tunnels.json > ${STATE_DIR}/tunnels.json"
restart_panel
if wait_for 60 not_listening; then log_pass "The listener does not run while a tunnel holds 9295"; else log_fail "The listener runs beside a tunnel on 9295"; fi
REFUSED=$(api_get "audit?action=mail.submission.refused&limit=10" | jq -c --argjson base "${AUDIT_HOLD}" '[.entries[]? | select(.id > $base)]' 2>/dev/null || echo "[]")
assert_json_field "$REFUSED" '.[0].details.reason' 'tunnel' "Audited: mail.submission.refused {reason: tunnel}" || true
assert_contains "$(api_get "notifications?limit=20")" "A tunnel uses port 9295" "The administrators are told" || true
if wait_for 60 notifier_is filesystem; then log_pass "Authelia's mail goes to a file meanwhile"; else log_fail "Authelia's notifier: $(notifier_kind)"; fi
assert_eq "$(api_get "tunnels" | jq -r --arg i "${HOLD_ID}" '.tunnels[]? | select(.id == $i) | .port' 2>/dev/null)" "9295" "The tunnel is left where it is" || true
sudo systemctl stop lamalibre-lamaste-serverd
sudo bash -c "jq 'map(if .id == \"${HOLD_ID}\" then .port = ${HOLD_PORT} else . end)' ${STATE_DIR}/tunnels.json > ${WORK_DIR}/tunnels.json && cat ${WORK_DIR}/tunnels.json > ${STATE_DIR}/tunnels.json"
restart_panel
if wait_for 60 listening; then log_pass "The tunnel moved: the listener runs again"; else log_fail "The listener did not come back"; fi
RECOVERED=$(api_get "audit?action=mail.submission.recovered&limit=10" | jq -c --argjson base "${AUDIT_HOLD}" '[.entries[]? | select(.id > $base)]' 2>/dev/null || echo "[]")
assert_json_field "$RECOVERED" '.[0].details.previous' 'tunnel' "Audited: mail.submission.recovered {previous: tunnel}" || true
if wait_for 60 notifier_is smtp; then log_pass "…Authelia submits to it again"; else log_fail "Authelia's notifier: $(notifier_kind)"; fi
api_delete "tunnels/${HOLD_ID}" > /dev/null 2>&1 || true
local_wait_authelia "${DOMAIN}"

# ===========================================================================
# 6. A domain's own sender
# ===========================================================================

log_section "A domain's sender over the relay's transport"

OUT=$(cli_json domains mail "${DOMAIN}" sender --address "team@notify.${DOMAIN}" --name "E2E Team")
assert_json_field "$OUT" '"\(.event) \(.transport.kind) \(.transport.sender.address)"' "complete null team@notify.${DOMAIN}" "domains mail ${DOMAIN} sender: a sender alone (no transport of its own)" || true
OUT=$(cli_json domains mail "${DOMAIN}" test "team-check@${MAIL_DOMAIN}")
assert_json_field "$OUT" '.mail.status' 'sent' "domains mail ${DOMAIN} test: sent" || true
sink_holds "team-check@${MAIL_DOMAIN}" 1 > /dev/null || true
assert_json_field "$(sink_last_to "${WORK_DIR}/sink" "team-check@${MAIL_DOMAIN}")" '.from' "team@notify.${DOMAIN}" "…From the domain's sender, over the relay's sink" || true
OUT=$(cli_json domains mail "${DOMAIN}" clear)
assert_json_field "$OUT" '.event' 'complete' "domains mail ${DOMAIN} clear" || true
assert_json_field "$(api_get "domains/${DOMAIN}/mail")" '.transport' 'null' "…the domain has no row of its own" || true

# ===========================================================================
# 7. The budget
# ===========================================================================

log_section "The budget: an administrator's invitations until the ceiling"

SENT=$(json_get "$(transport)" '.budget.sent24h')
CEILING=$((SENT + 1))
LIMIT=$(node -e 'const c=Number(process.argv[1]);let l=Math.ceil(c/0.9);while(Math.floor(l*0.9)>c)l--;while(Math.floor(l*0.9)<c)l++;console.log(l)' "${CEILING}")
OUT=$(cli_json mail limit "${LIMIT}")
assert_json_field "$OUT" '.transport.budget.ceiling' "${CEILING}" "mail limit ${LIMIT}: the ceiling one above the ${SENT} sent in 24 h" || true
AUDIT_BUDGET=$(api_get "audit?limit=1" | jq '.entries[0].id // 0' 2>/dev/null || echo "0")
INV=$(admin_invite "e2e40-first")
assert_json_field "$INV" '"\(.mail.status) \(.inviteUrl | test("/invite#"))"' 'sent true' "An administrator's invitation: mailed (the last of the ceiling is the administrators')" || true
INV=$(admin_invite "e2e40-second")
assert_json_field "$INV" '"\(.mail.status) \(.inviteUrl | test("/invite#"))"' 'deferred-budget true' "The next one: deferred-budget, its link answered for sharing another way" || true
EXHAUSTED=$(api_get "audit?action=mail.budget.exhausted&limit=10" | jq -c --argjson base "${AUDIT_BUDGET}" '[.entries[]? | select(.id > $base)]' 2>/dev/null || echo "[]")
assert_json_field "$EXHAUSTED" 'length > 0' 'true' "Audited: mail.budget.exhausted" || true
assert_json_field "$(transport)" '(.budget.resumesAt != null) and (.budget.sent24h >= .budget.ceiling)' 'true' "GET /api/settings/mail: at the ceiling, when sending resumes" || true
OUT=$(cli_json mail limit 500)
assert_json_field "$OUT" '.transport.budget.dailyLimit' '500' "Back to 500" || true

# ===========================================================================
# 8. The sink down
# ===========================================================================

log_section "The mail server down: invitations still answer, Authelia still signs in"

stop_smtp_sink
INV=$(admin_invite "e2e40-third")
assert_json_field "$INV" '"\(.mail.status) \(.inviteUrl | test("/invite#"))"' 'failed true' "An invitation: mail failed, its link answered" || true
local_sign_in "${USER_ONE}" "${PASSWORD}" "${SECRET_ONE}" "${JAR}" "${DOMAIN}"
assert_eq "${SIGN_IN_RESULT}" "OK OK" "${USER_ONE} still signs in" || true
start_smtp_sink "${WORK_DIR}/sink" "${SINK_PORT}" "${SINK_USER}" || log_fail "The sink does not start again"

log_section "No transport: back as before"

OUT=$(cli_json mail clear)
assert_json_field "$OUT" '.event' 'complete' "mail clear" || true
if wait_for 60 notifier_is filesystem; then log_pass "Authelia's notifier is a file again"; else log_fail "Authelia's notifier: $(notifier_kind)"; fi
if wait_for 30 not_listening; then log_pass "The listener stopped"; else log_fail "The listener still runs"; fi
local_wait_authelia "${DOMAIN}"
if wait_for 60 portal_links ""; then log_pass "The portal links no reset page"; else log_fail "The portal's reset link: $(reset_link_of_portal)"; fi
assert_json_field "$(audit_since mail.transport.cleared)" 'length > 0' 'true' "Audited: mail.transport.cleared" || true

end_test

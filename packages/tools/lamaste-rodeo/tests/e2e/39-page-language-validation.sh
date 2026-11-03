#!/usr/bin/env bash
# ============================================================================
# 39 — A domain's page language: the relay's side (Single-VM)
# ============================================================================
# The relay's side of the page language on one VM (design: packages/core/
# docs/page-language-design.md, "Proof (rodeo)"); three-VM 56 is the pages
# as people meet them on three domains.
#
# 1. The API: a language that is not one (or not one in that spelling), a
#    field it does not know, no body — 400 invalid_language; a domain that
#    is not there — 404 domain_not_found. Set to tr: a rendering of a
#    language alone (revision 0, the running Authelia, the pin), the forced
#    locale files, the pages in Turkish; null clears it and the rendering
#    goes.
# 2. The auth vhost: the forced-locale location and the lang and noscript
#    filters as written, ASCII only, accepted by lamaste-priv; nginx -t.
#    Unset, none of it is left.
# 3. The reconcile: after a panel restart the rendering is still current;
#    a rendered.json naming another language is rendered again within the
#    minute.
# 4. lamaste-server domains language: shown, set, cleared, a refusal with
#    its code.
# 5. The refusals of /api/invite/*, each with its code: invitation_not_found,
#    invitation_closed, invitation_expired, invitation_used — the error text
#    stays English. Gatekeeper's GET /access-request is gone; the stock
#    "not available" page is in place.
#
# The inviter's API (/api/delegated-invitations/*) needs Gatekeeper's
# assertion for a signed-in user: three-VM 56 asserts its not_found.
# ============================================================================

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/helpers.sh"

require_commands curl jq node nginx openssl sqlite3

begin_test "39 — A domain's page language: the relay's side (Single-VM)"

STATE_DIR="/etc/lamalibre/lamaste"
WORK_DIR="/tmp/lamalibre-lamaste-e2e-page-language-39"
WEB_ROOT="/var/www/lamaste/auth"
AVAILABLE="/etc/nginx/sites-available"
USER_ONE="e2e39-one"
USER_TWO="e2e39-two"
USER_THREE="e2e39-three"
# Test credentials for this run only, never printed
PASSWORD="E2e-$(openssl rand -hex 12)"
FORCED_LOCATION='location ~ "^/locales/[^/]{1,64}/(consent|portal|settings)[.]json$" {'
# shellcheck disable=SC2016 # nginx's $1, written as the vhost carries it
FORCED_TRY='try_files /locales/forced/$1.json @authelia;'
LANG_FILTER="sub_filter '<html lang=\"' '<html lang=\"tr\" data-authelia-lang=\"';"
NOSCRIPT_FILTER="sub_filter 'You need to enable JavaScript to run this app.' 'Bu uygulama i&#231;in taray&#305;c&#305;n&#305;zda JavaScript etkin olmal&#305;d&#305;r.';"
AUDIT_BASE=0

cleanup() {
  log_info "Cleaning up test resources..."
  if [ -n "${DOMAIN:-}" ]; then
    call PUT "domains/${DOMAIN}/language" '{"language":null}' > /dev/null 2>&1 || true
  fi
  local u
  for u in "${USER_ONE}" "${USER_TWO}" "${USER_THREE}"; do
    api_delete "users/${u}?erase=true" > /dev/null 2>&1 || true
  done
  local id
  for id in $(api_get "invitations" 2>/dev/null | jq -r --arg a "${USER_ONE}" --arg b "${USER_TWO}" --arg c "${USER_THREE}" '.invitations[]? | select(.username == $a or .username == $b or .username == $c) | .id' 2>/dev/null || true); do
    call DELETE "invitations/${id}" > /dev/null 2>&1 || true
    call DELETE "invitations/${id}" > /dev/null 2>&1 || true
  done
  sudo rm -rf "${WORK_DIR}"
}
trap cleanup EXIT

status_of() { printf '%s\n' "$1" | tail -n 1; }
body_of() { printf '%s\n' "$1" | sed '$d'; }
json_get() { echo "$1" | jq -r "$2" 2>/dev/null || echo ""; }

# call <method> <api path> [<json>] — one panel API call as the admin: the
# body, then the HTTP status on a line of its own
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

# restart_panel — the panel restarted, answering again
restart_panel() {
  sudo systemctl restart lamalibre-lamaste-serverd
  wait_for_http "${PANEL_DIRECT_URL}/api/health" 60 || log_fail "The panel does not answer after a restart"
}

# language_put <json> — PUT /api/domains/<DOMAIN>/language: the body, then the status
language_put() { call PUT "domains/${DOMAIN}/language" "$1"; }

# domain_entry — the primary as GET /api/domains lists it
domain_entry() { api_get "domains" | jq -c --arg n "${DOMAIN}" '[.domains[]? | select(.name == $n)] | first // null' 2>/dev/null || echo "null"; }

# rendered — the domain's rendered.json ('{}' when there is none)
rendered() { sudo cat "${WEB_ROOT}/${DOMAIN}/rendered.json" 2>/dev/null || echo '{}'; }

# rendered_language_is <language> — rendered.json names it
rendered_language_is() { [ "$(rendered | jq -r '.language // "null"' 2>/dev/null)" = "$1" ]; }

# rendering_gone — no entry for the domain under the web root
rendering_gone() { ! sudo test -e "${WEB_ROOT}/${DOMAIN}"; }

# auth_get <path> — a page of auth.<DOMAIN> from this VM
auth_get() { curl -sk --max-time 15 --resolve "auth.${DOMAIN}:443:127.0.0.1" "https://auth.${DOMAIN}$1" 2>/dev/null || echo ""; }

# auth_vhost — the installed auth vhost of the domain
auth_vhost() { sudo cat "${AVAILABLE}/$(vhost_name auth "${DOMAIN}")" 2>/dev/null || echo ""; }

# vhost_forces — the installed auth vhost carries the forced-locale location
vhost_forces() { [[ "$(auth_vhost)" == *"${FORCED_LOCATION}"* ]]; }
vhost_free() { ! vhost_forces; }

# invite_post <lookup|accept> <json> — POST /api/invite/<…> on the panel's
# loopback port (public): the body, then the status
invite_post() {
  curl -s --max-time 15 -X POST -H 'Content-Type: application/json' -d "$2" -w '\n%{http_code}' "${PANEL_DIRECT_URL}/api/invite/$1" 2>/dev/null || echo "000"
}

# assert_refusal <response> <status> <code> <what> — the status and its code, the text in English
assert_refusal() {
  assert_eq "$(status_of "$1")" "$2" "$4: $2" || true
  assert_json_field "$(body_of "$1")" '.code' "$3" "…$3" || true
  assert_json_field "$(body_of "$1")" '.error | test("^[ -~]+$")' 'true' "…its error text English (ASCII)" || true
}

# admin_invitation <username> — an administrator's invitation: "<id> <token>"
admin_invitation() {
  api_post "invitations" "{\"username\":\"$1\",\"email\":\"$1@example.test\"}" | jq -r '"\(.invitation.id) \(.token)"' 2>/dev/null || echo " "
}

# cli_json <args...> — lamaste-server <args> --json: its last JSON line (a
# refusal exits 1 after its error line: that line is the answer)
cli_json() {
  local out
  out=$({ sudo lamaste-server "$@" --json 2>/dev/null || true; } | grep -E '^\{' | tail -n 1 || true)
  if [ -n "${out}" ]; then printf '%s\n' "${out}"; else echo '{}'; fi
}

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
api_delete "domains/${DOMAIN}/branding" > /dev/null 2>&1 || true
mkdir -p "${WORK_DIR}"
AUDIT_BASE=$(api_get "audit?limit=1" | jq '.entries[0].id // 0' 2>/dev/null || echo "0")
PINNED=$(api_get "domains" | jq -r '.authelia.pinned // empty' 2>/dev/null || echo "")
assert_eq "$(api_get "domains" | jq -r '"\(.authelia.running) \(.authelia.pinned)"' 2>/dev/null)" "${PINNED} ${PINNED}" "GET /api/domains: the running Authelia is the pinned release (${PINNED})" || true
assert_json_field "$(domain_entry)" '"\(.language) \(.rendering)"' 'null null' "${DOMAIN}: no language, no rendering" || true

# ===========================================================================
# 1. The API
# ===========================================================================

log_section "Refused: not a language, not that spelling, an unknown field, no body"

assert_refusal "$(language_put '{"language":"fr"}')" 400 invalid_language "{language: fr}"
assert_refusal "$(language_put '{"language":"TR"}')" 400 invalid_language "{language: TR}"
assert_refusal "$(language_put '{"language":"tr-TR"}')" 400 invalid_language "{language: tr-TR}"
assert_refusal "$(language_put '{"language":"tr","default":true}')" 400 invalid_language "{language: tr, default: true}"
assert_refusal "$(language_put '{}')" 400 invalid_language "{}"
assert_refusal "$(call PUT "domains/e2e39-none.example.test/language" '{"language":"tr"}')" 404 domain_not_found "A domain that is not there"
assert_json_field "$(domain_entry)" '.language' 'null' "…and ${DOMAIN} still has none" || true

log_section "Turkish: a rendering of a language alone"

RESP=$(language_put '{"language":"tr"}')
assert_eq "$(status_of "$RESP")" "200" "PUT …/language {language: tr}: 200" || true
assert_json_field "$(body_of "$RESP")" '"\(.changed) \(.domain.language) \(.warnings // [] | length)"' 'true tr 0' "…changed, tr, no warning" || true
if wait_for 60 rendered_language_is tr; then log_pass "rendered.json names tr"; else log_fail "rendered.json: $(rendered | jq -c .)"; fi
assert_json_field "$(rendered)" '"\(.revision) \(.autheliaVersion) \(.autheliaPinned)"' "0 ${PINNED} ${PINNED}" "…revision 0 (no brand), the running Authelia and the pin" || true
assert_json_field "$(rendered)" '.pagesDigest | test("^[0-9a-f]{64}$")' 'true' "…the pages' digest" || true
for NS in portal settings consent; do
  if sudo test -s "${WEB_ROOT}/${DOMAIN}/locales/forced/${NS}.json"; then
    log_pass "locales/forced/${NS}.json rendered"
  else
    log_fail "locales/forced/${NS}.json is missing"
  fi
done
assert_eq "$(sudo jq -r '.Loading' "${WEB_ROOT}/${DOMAIN}/locales/forced/portal.json" 2>/dev/null)" "Yükleniyor" "…portal.json: Loading → Yükleniyor (Lamaste's supplement)" || true
assert_contains "$(sudo cat "${WEB_ROOT}/${DOMAIN}/invite/index.html" 2>/dev/null)" '<html lang="tr">' "invite/index.html in Turkish" || true
assert_contains "$(sudo cat "${WEB_ROOT}/${DOMAIN}/unavailable/index.html" 2>/dev/null)" '<html lang="tr">' "unavailable/index.html in Turkish" || true
assert_contains "$(sudo cat "${WEB_ROOT}/${DOMAIN}/brand.css" 2>/dev/null)" "#language-button" "brand.css hides the language menu" || true
assert_json_field "$(domain_entry)" '"\(.language) \(.rendering.current)"' 'tr true' "GET /api/domains: tr, its rendering current" || true
AUDIT=$(api_get "audit?action=domain.language.updated&limit=50" | jq -c --argjson base "${AUDIT_BASE}" '[.entries[]? | select(.id > $base)]' 2>/dev/null || echo "[]")
assert_json_field "${AUDIT}" '[.[] | "\(.details.domain) \(.details.from) \(.details.to)"] | join(",")' "${DOMAIN} null tr" "Audited once: domain.language.updated {domain, from: null, to: tr}" || true

# ===========================================================================
# 2. The auth vhost
# ===========================================================================

log_section "The auth vhost: the forced locales and the filters, accepted by lamaste-priv"

if wait_for 60 vhost_forces; then log_pass "The auth vhost has the forced-locale location"; else log_fail "The auth vhost has no forced-locale location"; fi
VHOST=$(auth_vhost)
assert_contains "${VHOST}" "${FORCED_TRY}" "…serving one file per namespace, Authelia behind it" || true
assert_contains "${VHOST}" "${LANG_FILTER}" "…the lang filter" || true
assert_contains "${VHOST}" "${NOSCRIPT_FILTER}" "…the noscript sentence as ASCII character references" || true
assert_eq "$(printf '%s\n' "${VHOST}" | grep -v '^[[:space:]]*#' | LC_ALL=C grep -c '[^[:print:][:space:]]' || true)" "0" "…every byte outside its comments printable ASCII (lamaste-priv allows other bytes in comments only)" || true
AUTH_NAME=$(vhost_name auth "${DOMAIN}")
if sudo cat "${AVAILABLE}/${AUTH_NAME}" | sudo /usr/local/sbin/lamaste-priv nginx-site write "${AUTH_NAME}" > /dev/null 2>&1; then
  log_pass "lamaste-priv nginx-site write accepts the auth vhost as installed"
else
  log_fail "lamaste-priv nginx-site write refused the auth vhost"
fi
if sudo nginx -t > /dev/null 2>&1; then log_pass "nginx -t passes"; else log_fail "nginx -t fails"; fi
assert_contains "$(auth_get /)" '<html lang="tr" data-authelia-lang="' "auth.${DOMAIN}/: lang=\"tr\"" || true
assert_eq "$(auth_get /locales/de-AT/portal.json | jq -r '.Loading' 2>/dev/null)" "Yükleniyor" "auth.${DOMAIN}/locales/de-AT/portal.json: the forced Turkish" || true
assert_eq "$(auth_get /locales/en/portal.json | jq -r '.Loading' 2>/dev/null)" "Yükleniyor" "…/locales/en/portal.json too" || true
LIST=$(auth_get /locales)
assert_not_contains "${LIST}" "Yükleniyor" "…/locales (Authelia's language list) is not a locale file" || true

# ===========================================================================
# 3. The reconcile
# ===========================================================================

log_section "The reconcile: after a restart; after rendered.json names another language"

restart_panel
assert_json_field "$(domain_entry)" '"\(.language) \(.rendering.current)"' 'tr true' "After a panel restart: tr, its rendering current" || true
sudo bash -c "jq '.language = \"en\"' ${WEB_ROOT}/${DOMAIN}/rendered.json > ${WORK_DIR}/rendered.json && cat ${WORK_DIR}/rendered.json > ${WEB_ROOT}/${DOMAIN}/rendered.json"
log_info "rendered.json made to say en"
if wait_for 100 rendered_language_is tr; then
  log_pass "The minute reconcile rendered it again (tr)"
else
  log_fail "rendered.json still says $(rendered | jq -r '.language')"
fi
assert_json_field "$(domain_entry)" '.rendering.current' 'true' "…current again" || true

# ===========================================================================
# 4. The CLI
# ===========================================================================

log_section "lamaste-server domains language"

assert_json_field "$(cli_json domains language "${DOMAIN}")" '"\(.domain) \(.language) \(.rendering.current)"' "${DOMAIN} tr true" "domains language ${DOMAIN}: shown — tr, rendered" || true
OUT=$(cli_json domains language "${DOMAIN}" fr)
assert_json_field "$OUT" '"\(.event) \(.code)"' 'error invalid_language' "…fr: refused, invalid_language" || true
OUT=$(cli_json domains language "${DOMAIN}" en)
assert_json_field "$OUT" '"\(.event) \(.changed) \(.domain.language)"' 'complete true en' "…en: set" || true
OUT=$(cli_json domains language "${DOMAIN}" --unset)
assert_json_field "$OUT" '"\(.event) \(.changed) \(.domain.language)"' 'complete true null' "…--unset: cleared" || true
assert_json_field "$(cli_json domains language e2e39-none.example.test)" '"\(.event) \(.code)"' 'error domain_not_found' "…a domain that is not there: domain_not_found" || true

log_section "Unset: the rendering gone, the vhost without the language"

if wait_for 60 rendering_gone; then log_pass "No rendering of ${DOMAIN} is left (no brand, no language)"; else log_fail "A rendering of ${DOMAIN} is left"; fi
if wait_for 60 vhost_free; then log_pass "The auth vhost has no forced-locale location"; else log_fail "The auth vhost still forces a language"; fi
VHOST=$(auth_vhost)
assert_not_contains "${VHOST}" "data-authelia-lang" "…no lang filter" || true
assert_not_contains "${VHOST}" "taray&#305;c" "…no noscript filter" || true
assert_json_field "$(domain_entry)" '"\(.language) \(.rendering)"' 'null null' "GET /api/domains: no language, no rendering" || true
assert_contains "$(auth_get /invite)" '<html lang="en">' "auth.${DOMAIN}/invite: the stock English page" || true
assert_contains "$(sudo cat /var/www/lamaste/unavailable/index.html 2>/dev/null)" '<html lang="en">' "The stock \"not available\" page is in place, in English" || true

# ===========================================================================
# 5. The refusals of /api/invite/*
# ===========================================================================

log_section "The invitation API's refusals, each with its code"

assert_refusal "$(invite_post lookup "{\"token\":\"$(openssl rand -hex 32)\"}")" 404 invitation_not_found "A token nobody holds"
read -r ID_ONE TOKEN_ONE <<< "$(admin_invitation "${USER_ONE}")"
call DELETE "invitations/${ID_ONE}" > /dev/null
assert_refusal "$(invite_post lookup "{\"token\":\"${TOKEN_ONE}\"}")" 410 invitation_closed "A revoked invitation's token"
assert_refusal "$(invite_post accept "$(jq -c -n --arg t "${TOKEN_ONE}" --arg p "${PASSWORD}" '{token: $t, password: $p}')")" 410 invitation_closed "…accepted all the same"
read -r ID_TWO TOKEN_TWO <<< "$(admin_invitation "${USER_TWO}")"
sudo sqlite3 "${STATE_DIR}/state.db" "UPDATE invitations SET expires_at = '2020-01-01T00:00:00.000Z' WHERE id = '${ID_TWO}'"
assert_refusal "$(invite_post lookup "{\"token\":\"${TOKEN_TWO}\"}")" 410 invitation_expired "An expired invitation's token"
read -r _ TOKEN_THREE <<< "$(admin_invitation "${USER_THREE}")"
RESP=$(invite_post accept "$(jq -c -n --arg t "${TOKEN_THREE}" --arg p "${PASSWORD}" '{token: $t, password: $p}')")
assert_eq "$(status_of "$RESP")" "200" "An invitation accepted" || true
assert_refusal "$(invite_post lookup "{\"token\":\"${TOKEN_THREE}\"}")" 410 invitation_used "…its token looked up again"
assert_refusal "$(invite_post accept "$(jq -c -n --arg t "${TOKEN_THREE}" --arg p "${PASSWORD}" '{token: $t, password: $p}')")" 410 invitation_used "…accepted again"

log_section "Gatekeeper: GET /access-request is gone"

assert_eq "$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 http://127.0.0.1:9294/access-request 2>/dev/null || echo 000)" "404" "http://127.0.0.1:9294/access-request: 404" || true

end_test

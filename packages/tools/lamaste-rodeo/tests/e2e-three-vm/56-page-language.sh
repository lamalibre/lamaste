#!/usr/bin/env bash
# ============================================================================
# 56 — A domain's page language: Turkish where set, English elsewhere (Three-VM)
# ============================================================================
# Every page a person meets on a domain speaks the domain's language (design:
# packages/core/docs/page-language-design.md, "Proof (rodeo)"). Three
# domains of the multi-domain harness:
#   B — branded, language `tr` (the plugin's domain: the inviting harness
#       works on B);
#   C — unbranded, language `en`;
#   A — the primary, no language: exactly 4.9's behaviour.
#
# 1. The language set on B and C (PUT /api/domains/:name/language; again =
#    unchanged); GET /api/domains lists it, each rendering current, and the
#    running Authelia is the pinned release. Nothing restarts Authelia.
# 2. Authelia's portal: B's index says lang="tr" (the cookie's value moved
#    to data-authelia-lang) with the noscript sentence in Turkish, C's
#    lang="en"; A's is untouched. /brand.css hides the language menu on B
#    and C. Every locale path on B (en, de-AT, tr) answers the forced
#    Turkish — a key Lamaste supplements ("Loading" → "Yükleniyor") and a
#    correction ("Powered by" → "Altyapı: <brand>"); on C the forced
#    English; on A Authelia's own files.
# 3. Lamaste's pages: the invitation page and the inviter's page on B in
#    Turkish (lang, title, the data block), on C and A in English, whatever
#    Accept-Language says; one script and one CSP for all three.
# 4. The plugin's site on B before it is served: Lamaste's "not available"
#    page in Turkish (P8), with its CSP — then the plugin approved, hosted,
#    served.
# 5. The people: a coordinator (external of B) invites; the refusal codes
#    the pages map (invitation_not_found, invitation_closed,
#    invitation_used, not_found); the invitee, refused on B's
#    authenticated tunnel, meets the access-request page in Turkish, with
#    Turkish message templates (P6); a member of B and C meets it in
#    Turkish on B, in English on C; a member of A alone meets the domain
#    refusal in Turkish on B, in English on C (P7); Gatekeeper's "not
#    allowed" page (P9) follows the domain the path names.
# 6. B and C back to unset: B's portal follows the browser again, its pages
#    English with its brand; C's language-only rendering is gone. The audit
#    holds each change ({domain, from, to}); no language change restarts
#    Authelia.
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../e2e/helpers.sh"
# shellcheck source-path=SCRIPTDIR source=app-plugin-harness.sh
source "${SCRIPT_DIR}/app-plugin-harness.sh"
MD_SPEC=56
# shellcheck source-path=SCRIPTDIR source=multi-domain-harness.sh
source "${SCRIPT_DIR}/multi-domain-harness.sh"
# shellcheck source-path=SCRIPTDIR source=invitation-harness.sh
source "${SCRIPT_DIR}/invitation-harness.sh"

require_commands multipass curl jq node npm tar perl openssl

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

PLUGIN="e2e-plang"
SERVER_PACKAGE="@lamalibre/e2e-plang-server"
AGENT_PACKAGE="@lamalibre/e2e-plang-agent"
SUB_W="e2e56web"
SUB_TB="e2e56bauth"
SUB_RB="e2e56bres"
SUB_RC="e2e56cres"
SUB_TC="e2e56cauth"
PORT_TB=19961
PORT_RB=19962
PORT_RC=19963
PORT_TC=19964
POLICY_ID="e2e-apphost-56"
REMOTE_DIR="/var/tmp/e2e-56-app-plugin"
LOCAL_TMP=""
CLEAN_PLUGINS="${PLUGIN}"
CLEAN_ROUTES="${PLUGIN}"
PURGE_PACKAGES=""
BRAND_B="E2E Marka 56"
ACCENT_B="#7c3aed"
COORD="e2e56-coord"
MEM="e2e56-member"
OUT="e2e56-outsider"
INVITEE="e2e56-invitee-$(date +%s)"
# Test credentials for this run only, never printed
PASSWORD="E2e-$(openssl rand -hex 12)"
INVITEE_PASSWORD="E2e-$(openssl rand -hex 12)"
COORD_ID=""
MEM_ID=""
OUT_ID=""
INVITEE_ID=""
JAR_COORD=$(md_jar coord)
JAR_MEM_B=$(md_jar member-b)
JAR_MEM_C=$(md_jar member-c)
JAR_OUT_B=$(md_jar outsider-b)
JAR_OUT_C=$(md_jar outsider-c)
JAR_INV=$(md_jar invitee)
FQDN=""
TUNNEL_TB=""
TUNNEL_RB=""
TUNNEL_RC=""
TUNNEL_TC=""
COORD_GRANT=""
TOKEN=""
INV_ID=""
TOKEN_2=""
INV_ID_2=""
AUTHELIA_PID=""
MEM_SECRET=""
OUT_SECRET=""
# The Turkish noscript sentence as the vhost writes it (ASCII character references)
NOSCRIPT_TR='Bu uygulama i&#231;in taray&#305;c&#305;n&#305;zda JavaScript etkin olmal&#305;d&#305;r.'

# auth_url <domain> <path> — a page of the domain's sign-in host
auth_url() { echo "https://auth.$1$2"; }

# language_of <domain> — the domain's language as GET /api/domains lists it ('null' when none)
language_of() { json_get "$(domain_entry "$1")" '.language'; }

# set_language <domain> <tr|en|null> — PUT /api/domains/<domain>/language, the response
set_language() {
  local value="$2"
  if [ "$value" != "null" ]; then value="\"$2\""; fi
  md_api PUT "domains/$1/language" "{\"language\":${value}}"
}

# rendering_current <domain> — the domain's rendering serves what its record says
rendering_current() { [ "$(json_get "$(domain_entry "$1")" '.rendering.current')" = "true" ]; }

# rendering_gone <domain> — the domain has no rendering (no brand, no language)
rendering_gone() { [ "$(json_get "$(domain_entry "$1")" '.rendering')" = "null" ]; }

# page_of <domain> <path> [curl args...] — the page on the domain's sign-in host, as visit prints it
page_of() {
  local d="$1" p="$2"
  shift 2
  visit - "$@" "$(auth_url "$d" "$p")"
}

# index_says <domain> <substring> — the sign-in page of <domain> carries <substring>
index_says() { [[ "$(visit_body "$(page_of "$1" /)")" == *"$2"* ]]; }

# index_lacks <domain> <substring> — the sign-in page of <domain> does not carry <substring>
index_lacks() { ! index_says "$@"; }

# locale_file <domain> <locale> <namespace> — the locale file as the portal gets it
locale_file() { visit_body "$(page_of "$1" "/locales/$2/$3.json")"; }

# loading_of <domain> <locale> — the portal's "Loading" text there ('null' when the file lacks it)
loading_of() { json_get "$(locale_file "$1" "$2" portal)" '.Loading'; }

# data_block <html> — the page's messages (its JSON data block), compact
data_block() {
  printf '%s' "$1" | node -e 'const h=require("fs").readFileSync(0,"utf8");const m=h.match(/<script type="application\/json" id="lamaste-messages">([\s\S]*?)<\/script>/);process.stdout.write(m?m[1].trim():"null")' | jq -c . 2>/dev/null || echo "null"
}

# script_of <html> — the page's hashed <script> section alone
script_of() { printf '%s\n' "$1" | sed -n '/<script>/,/<\/script>/p'; }

# csp_of <visit response> — its Content-Security-Policy header
csp_of() { visit_headers "$1" | awk 'tolower($1) == "content-security-policy:" {sub(/^[^:]*: */, ""); print}' | tail -n 1; }

# gatekeeper_forbidden <fqdn> — Gatekeeper's answer to a shell check with no
# original request (refused: P9), from the host VM: the status, then the body
gatekeeper_forbidden() {
  host_exec "curl -s --max-time 15 -w '\n%{http_code}' http://127.0.0.1:9294/authz/user-surface-shell/$1 || echo 000" 2>/dev/null | tr -d '\r'
}

# language_audit <domain> — the domain.language.updated entries of <domain>
# since the spec began, oldest first, as "<from> <to>" lines joined by ","
language_audit() {
  host_api_get "audit?action=domain.language.updated&limit=200" 2>/dev/null |
    jq -r --arg d "$1" --argjson base "${AUDIT_BASE}" '[.entries[]? | select(.id > $base and .details.domain == $d)] | sort_by(.id) | map("\(.details.from) \(.details.to)") | join(",")' 2>/dev/null || echo ""
}

begin_test "56 — A domain's page language: Turkish where set, English elsewhere (Three-VM)"

cleanup() {
  log_info "Cleaning up test resources..."
  local id d
  for d in "${DOMAIN}" "${DOMAIN_2}" "${DOMAIN_3}"; do
    [ -n "$d" ] && md_api PUT "domains/${d}/language" '{"language":null}' > /dev/null 2>&1 || true
  done
  if [ -n "${DOMAIN_2}" ]; then host_api_delete "domains/${DOMAIN_2}/branding" > /dev/null 2>&1 || true; fi
  if [ -n "${COORD_GRANT}" ]; then host_api_delete "gatekeeper/grants/${COORD_GRANT}" > /dev/null 2>&1 || true; fi
  if [ -n "${SITE_ID}" ]; then inv_drop_site_grants "${SITE_ID}"; fi
  for id in ${TUNNEL_TB} ${TUNNEL_RB} ${TUNNEL_RC} ${TUNNEL_TC}; do
    host_api_delete "tunnels/${id}" > /dev/null 2>&1 || true
  done
  host_api_delete "plugins/${PLUGIN}/web-surface" > /dev/null 2>&1 || true
  drop_plugin_grants "${PLUGIN}"
  inv_cleanup_users "${COORD}" "${MEM}" "${OUT}" "${INVITEE}"
  inv_cleanup_ids ${COORD_ID} ${MEM_ID} ${OUT_ID} ${INVITEE_ID}
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
for D in "${DOMAIN}" "${DOMAIN_2}" "${DOMAIN_3}"; do
  md_api PUT "domains/${D}/language" '{"language":null}' > /dev/null 2>&1 || true
done
host_api_delete "domains/${DOMAIN_2}/branding" > /dev/null 2>&1 || true
AUDIT_BASE=$(host_api_get "audit?limit=1" 2>/dev/null | jq '.entries[0].id // 0' 2>/dev/null || echo "0")

# ===========================================================================
# 1. The languages
# ===========================================================================

log_section "B and C active; B branded; A, the primary, left alone"

md_domain_active "${DOMAIN_2}"
md_domain_active "${DOMAIN_3}"
assert_eq "$(language_of "${DOMAIN}") $(language_of "${DOMAIN_2}") $(language_of "${DOMAIN_3}")" "null null null" "No domain has a language yet" || true
RESP=$(md_api PUT "domains/${DOMAIN_2}/branding" "$(jq -c -n --arg n "${BRAND_B}" --arg a "${ACCENT_B}" '{name: $n, theme: "light", accent: $a}')")
assert_json_field "$(body_of "$RESP")" '"\(.branding.name) \(.warnings // [] | length)"' "${BRAND_B} 0" "B branded ${BRAND_B}, no warning" || true
if wait_for 90 rendering_current "${DOMAIN_2}"; then
  log_pass "…rendered"
else
  log_fail "B's brand is not rendered: $(json_get "$(domain_entry "${DOMAIN_2}")" '.rendering')"
fi
md_wait_authelia "${DOMAIN_2}"
md_wait_authelia "${DOMAIN_3}"
AUTHELIA_PID=$(authelia_pid)

log_section "B speaks Turkish, C English"

RESP=$(set_language "${DOMAIN_2}" tr)
assert_eq "$(status_of "$RESP")" "200" "PUT /api/domains/${DOMAIN_2}/language {language: tr}: 200" || true
assert_json_field "$(body_of "$RESP")" '"\(.changed) \(.domain.language) \(.warnings // [] | length)"' "true tr 0" "…changed, tr, no warning" || true
RESP=$(set_language "${DOMAIN_3}" en)
assert_json_field "$(body_of "$RESP")" '"\(.changed) \(.domain.language) \(.warnings // [] | length)"' "true en 0" "PUT /api/domains/${DOMAIN_3}/language {language: en}: changed, no warning" || true
RESP=$(set_language "${DOMAIN_2}" tr)
assert_json_field "$(body_of "$RESP")" '"\(.changed) \(.domain.language)"' "false tr" "The same language again: unchanged" || true
assert_eq "$(language_of "${DOMAIN}") $(language_of "${DOMAIN_2}") $(language_of "${DOMAIN_3}")" "null tr en" "GET /api/domains: A none, B tr, C en" || true
if wait_for 90 rendering_current "${DOMAIN_2}" && wait_for 90 rendering_current "${DOMAIN_3}"; then
  log_pass "B's rendering (brand and language) and C's (language alone) are current"
else
  log_fail "A rendering is not current: B $(json_get "$(domain_entry "${DOMAIN_2}")" '.rendering'), C $(json_get "$(domain_entry "${DOMAIN_3}")" '.rendering')"
fi
assert_json_field "$(domain_entry "${DOMAIN_3}")" '"\(.rendering.rendered.revision) \(.rendering.rendered.language)"' "0 en" "…C's rendering: revision 0 (no brand), language en" || true
VERSIONS=$(host_api_get "domains" 2>/dev/null | jq -c '.authelia // {}' 2>/dev/null || echo '{}')
assert_json_field "${VERSIONS}" '(.running != null) and (.running == .pinned)' "true" "The running Authelia is the pinned release (${VERSIONS})" || true
assert_eq "$(authelia_pid)" "${AUTHELIA_PID}" "Setting a language restarted no Authelia" || true

# ===========================================================================
# 2. Authelia's portal
# ===========================================================================

log_section "The sign-in page: lang follows the domain, the menu hidden"

if wait_for 60 index_says "${DOMAIN_2}" '<html lang="tr" data-authelia-lang="'; then
  log_pass "auth.${DOMAIN_2}/: <html lang=\"tr\" data-authelia-lang=\"…\">"
else
  log_fail "auth.${DOMAIN_2}/ does not say lang=\"tr\": $(visit_body "$(page_of "${DOMAIN_2}" /)" | grep -o '<html[^>]*>' | head -n 1)"
fi
INDEX_B=$(visit_body "$(page_of "${DOMAIN_2}" /)")
assert_contains "${INDEX_B}" "${NOSCRIPT_TR}" "…its noscript sentence in Turkish (ASCII character references)" || true
assert_contains "${INDEX_B}" '<link rel="stylesheet" href="/brand.css">' "…links /brand.css" || true
CSS_B=$(visit_body "$(page_of "${DOMAIN_2}" /brand.css)")
assert_contains "${CSS_B}" "#language-button" "auth.${DOMAIN_2}/brand.css hides the language menu (#language-button)" || true
assert_contains "${CSS_B}" "${ACCENT_B}" "…and keeps the brand's accent" || true
if wait_for 60 index_says "${DOMAIN_3}" '<html lang="en" data-authelia-lang="'; then
  log_pass "auth.${DOMAIN_3}/: <html lang=\"en\" data-authelia-lang=\"…\">"
else
  log_fail "auth.${DOMAIN_3}/ does not say lang=\"en\""
fi
INDEX_C=$(visit_body "$(page_of "${DOMAIN_3}" /)")
assert_not_contains "${INDEX_C}" "taray&#305;c" "…no Turkish noscript sentence" || true
assert_contains "$(visit_body "$(page_of "${DOMAIN_3}" /brand.css)")" "#language-button" "auth.${DOMAIN_3}/brand.css hides the menu too (a language, no brand)" || true
INDEX_A=$(visit_body "$(page_of "${DOMAIN}" /)")
assert_contains "${INDEX_A}" '<html lang="' "auth.${DOMAIN}/: Authelia's own <html lang>" || true
assert_not_contains "${INDEX_A}" "data-authelia-lang" "…not rewritten (no language)" || true

log_section "Every locale path answers the domain's language"

for LOC in en de-AT tr; do
  assert_eq "$(loading_of "${DOMAIN_2}" "${LOC}")" "Yükleniyor" "auth.${DOMAIN_2}/locales/${LOC}/portal.json: \"Loading\" is Lamaste's supplement, Yükleniyor" || true
  assert_json_field "$(locale_file "${DOMAIN_2}" "${LOC}" portal)" '."Powered by {{authelia}}"' "Altyapı: ${BRAND_B}" "…\"Powered by\" corrected and brand-spliced: Altyapı: ${BRAND_B}" || true
done
SETTINGS_B=$(locale_file "${DOMAIN_2}" de-AT settings)
assert_eq "${SETTINGS_B}" "$(locale_file "${DOMAIN_2}" tr settings)" "…settings.json the same file for de-AT and tr" || true
assert_not_eq "${SETTINGS_B}" "$(locale_file "${DOMAIN_3}" tr settings)" "…and not C's" || true
assert_json_field "$(locale_file "${DOMAIN_2}" ar consent)" '[.. | strings] | length > 0' "true" "…consent.json answered for ar as well" || true
for LOC in tr de-AT; do
  assert_eq "$(loading_of "${DOMAIN_3}" "${LOC}")" "Loading" "auth.${DOMAIN_3}/locales/${LOC}/portal.json: English (Loading)" || true
done
assert_json_field "$(locale_file "${DOMAIN_3}" tr portal)" '."Powered by {{authelia}}"' "Powered by {{authelia}}" "…Authelia's English, no brand to splice" || true
assert_eq "$(loading_of "${DOMAIN}" tr)" "null" "auth.${DOMAIN}/locales/tr/portal.json: Authelia's own (its Turkish lacks \"Loading\")" || true
assert_not_eq "$(locale_file "${DOMAIN}" de-AT portal)" "$(locale_file "${DOMAIN}" en portal)" "…and its de-AT is not its English" || true

# ===========================================================================
# 3. Lamaste's pages
# ===========================================================================

log_section "The invitation page and the inviter's page: Turkish on B, English on C and A"

INVITE_B_RESP=$(page_of "${DOMAIN_2}" /invite)
INVITE_C_RESP=$(page_of "${DOMAIN_3}" /invite)
INVITE_A_RESP=$(page_of "${DOMAIN}" /invite)
INVITE_B=$(visit_body "${INVITE_B_RESP}")
INVITE_C=$(visit_body "${INVITE_C_RESP}")
INVITE_A=$(visit_body "${INVITE_A_RESP}")
assert_eq "$(visit_status "${INVITE_B_RESP}") $(visit_status "${INVITE_C_RESP}") $(visit_status "${INVITE_A_RESP}")" "200 200 200" "auth.<B|C|A>/invite: 200" || true
assert_contains "${INVITE_B}" '<html lang="tr">' "B: lang=\"tr\"" || true
assert_contains "${INVITE_B}" "<title>${BRAND_B} — Daveti kabul edin</title>" "…titled ${BRAND_B} — Daveti kabul edin" || true
assert_json_field "$(data_block "${INVITE_B}")" '"\(.lang) \(.messages."invite.title")"' "tr Daveti kabul edin" "…its data block: tr, invite.title Daveti kabul edin" || true
assert_json_field "$(data_block "${INVITE_B}")" '.messages."invite.invalidLink"' "Bu davet bağlantısı geçerli değil." "…invite.invalidLink in Turkish" || true
assert_contains "${INVITE_C}" '<html lang="en">' "C: lang=\"en\"" || true
assert_contains "${INVITE_C}" "<title>Lamaste — Accept Invitation</title>" "…the stock English title" || true
assert_json_field "$(data_block "${INVITE_C}")" '"\(.lang) \(.messages."invite.title")"' "en Accept Invitation" "…its data block: en" || true
assert_contains "${INVITE_A}" '<html lang="en">' "A (no language): lang=\"en\"" || true
assert_json_field "$(data_block "${INVITE_A}")" '.lang' "en" "…its data block: en" || true
assert_contains "$(visit_body "$(page_of "${DOMAIN_2}" /invite -H 'Accept-Language: en-US,en;q=0.9')")" '<html lang="tr">' "B with Accept-Language: en-US: still Turkish (the domain decides)" || true
assert_contains "$(visit_body "$(page_of "${DOMAIN}" /invite -H 'Accept-Language: tr-TR,tr;q=0.9')")" '<html lang="en">' "A with Accept-Language: tr-TR: still English" || true
assert_eq "$(script_of "${INVITE_B}")" "$(script_of "${INVITE_C}")" "B's and C's invitation page: byte for byte the same script" || true
assert_eq "$(script_of "${INVITE_B}")" "$(script_of "${INVITE_A}")" "…and A's" || true
assert_eq "$(csp_of "${INVITE_B_RESP}")" "$(csp_of "${INVITE_C_RESP}")" "…one Content-Security-Policy on B and C" || true
assert_eq "$(csp_of "${INVITE_B_RESP}")" "$(csp_of "${INVITE_A_RESP}")" "…and A" || true

INVITERS_B_RESP=$(page_of "${DOMAIN_2}" "/invitations/${PLUGIN}")
INVITERS_C_RESP=$(page_of "${DOMAIN_3}" "/invitations/${PLUGIN}")
INVITERS_B=$(visit_body "${INVITERS_B_RESP}")
assert_contains "${INVITERS_B}" '<html lang="tr">' "The inviter's page on B: lang=\"tr\"" || true
assert_contains "${INVITERS_B}" "<title>${BRAND_B} — Kişi davet edin</title>" "…titled ${BRAND_B} — Kişi davet edin" || true
assert_json_field "$(data_block "${INVITERS_B}")" '.lang' "tr" "…its data block: tr" || true
assert_contains "$(visit_body "${INVITERS_C_RESP}")" "<title>Lamaste — Invite People</title>" "…on C: Lamaste — Invite People" || true
assert_eq "$(csp_of "${INVITERS_B_RESP}")" "$(csp_of "${INVITERS_C_RESP}")" "…one Content-Security-Policy on B and C" || true

# ===========================================================================
# 4. The plugin's site before it is served
# ===========================================================================

log_section "The plugin installed on B; its site before approval: the \"not available\" page in Turkish"

LOCAL_TMP=$(mktemp -d /tmp/e2e-56-app-plugin-XXXXXXXX)
if ! write_app_install_fixture "${LOCAL_TMP}/ship/fixtures/plang" "${PLUGIN}" 1.0.0 main "l$(date +%s)-$$" '[]' none inviting v1 "${SUB_W}"; then
  log_fail "The fixture could not be built (npm install at the workspace root, npm run build -w packages/core/lib)"
  end_test
  exit $?
fi
log_pass "Fixture built: ${SERVER_PACKAGE}"
ship_agent_facts_probe
start_stand_in_feria fixtures/plang/server fixtures/plang/agent
ensure_app_host_helper
open_push_install "${POLICY_ID}" "[\"${AGENT_PACKAGE}\"]" '["install","uninstall"]'
FQDN="${SUB_W}.${DOMAIN_2}"
RESP=$(host_api_post "plugins/install" "{\"packageName\":\"${SERVER_PACKAGE}@1.0.0\"}")
assert_json_field "$RESP" '.plugin.version' '1.0.0' "Installed ${SERVER_PACKAGE}@1.0.0, not approved" || true
RESP=$(host_api_call PUT "plugins/${PLUGIN}/domain" "{\"domain\":\"${DOMAIN_2}\"}")
assert_eq "$(status_of "$RESP")" "200" "…moved to B" || true
RESP=$(host_api_call POST "plugins/${PLUGIN}/web-surface" '{"accessMode":"restricted"}')
assert_eq "$(status_of "$RESP")" "201" "Its web surface created, restricted" || true
SITE_ID=$(json_get "$(body_of "$RESP")" '.webSurface.site.id // empty')
assert_json_field "$(web_surface "${PLUGIN}")" '"\(.served) \(.reason)"' "false not_approved" "…not served: not approved" || true
md_hosts "${FQDN}"
wait_status - "https://${FQDN}/" 503 "https://${FQDN}/: 503 until it is served"
RESP=$(visit - "https://${FQDN}/")
P8=$(visit_body "$RESP")
assert_contains "${P8}" '<html lang="tr">' "…Lamaste's page, lang=\"tr\" (P8)" || true
assert_contains "${P8}" "<h1>Uygulama şu anda kullanılamıyor</h1>" "…Uygulama şu anda kullanılamıyor" || true
assert_contains "${P8}" "Lütfen birkaç dakika sonra yeniden deneyin." "…Lütfen birkaç dakika sonra yeniden deneyin." || true
assert_contains "${P8}" "${BRAND_B}" "…in B's brand" || true
assert_not_contains "${P8}" "nginx" "…not nginx's stock page" || true
assert_contains "$(csp_of "$RESP")" "style-src 'sha256-" "…its CSP names its style by hash" || true
assert_contains "$(visit_headers "$RESP" | tr '[:upper:]' '[:lower:]')" "cache-control: no-store" "…never cached" || true

log_section "Approved, hosted, served"

DIGEST=$(json_get "$(host_api_get "plugins/${PLUGIN}/hooks")" '.hooks.approval.digest // empty')
RESP=$(host_api_post "plugins/${PLUGIN}/hooks/approve" "{\"digest\":\"${DIGEST}\"}")
assert_json_field "$RESP" '.hooks.approval.state' 'approved' "${PLUGIN} approved" || true
host_api_post "plugins/${PLUGIN}/enable" '{}' > /dev/null
OP=$(host_plugin "${PLUGIN}" 300 nudge)
assert_json_field "$OP" '.status' 'succeeded' "…hosted on ${HOST_AGENT_LABEL} ($(json_get "$OP" '.error // .refused.error // ""'))" || true
if wait_for 60 health_up "${PLUGIN}"; then log_pass "…its hosting is up"; else log_fail "…its hosting: $(hosting_field "${PLUGIN}" '.hosting.health')"; fi
if wait_for 120 identity_ready "${PLUGIN}"; then
  log_pass "…ready: its agent half's first complete sync ended at the head"
else
  log_fail "…not ready: $(identity_view "${PLUGIN}" | jq -c '.readiness')"
fi
if wait_for 120 web_served "${PLUGIN}"; then
  log_pass "…its web surface served"
else
  log_fail "…its web surface not served: $(web_surface "${PLUGIN}" | jq -c '{served, reason}')"
fi

# ===========================================================================
# 5. The people
# ===========================================================================

log_section "A coordinator (external of B), a member of B and C, a member of A alone; tunnels on B and C"

md_user COORD_ID "${COORD}" "${PASSWORD}" "[{\"name\":\"${DOMAIN_2}\",\"kind\":\"external\"}]"
md_user MEM_ID "${MEM}" "${PASSWORD}" "[\"${DOMAIN_2}\",\"${DOMAIN_3}\"]"
md_user OUT_ID "${OUT}" "${PASSWORD}" "[\"${DOMAIN}\"]"
md_tunnel TUNNEL_TB "${SUB_TB}" "${DOMAIN_2}" "${PORT_TB}" authenticated
md_tunnel TUNNEL_RB "${SUB_RB}" "${DOMAIN_2}" "${PORT_RB}" restricted
md_tunnel TUNNEL_RC "${SUB_RC}" "${DOMAIN_3}" "${PORT_RC}" restricted
md_tunnel TUNNEL_TC "${SUB_TC}" "${DOMAIN_3}" "${PORT_TC}" authenticated
inv_entitle "${COORD}" coordinator
md_grant COORD_GRANT user "${COORD}" site "${SITE_ID}"
inv_wait_audience "${COORD_ID}" coordinator "The audience holds ${COORD} as coordinator"
RESP=$(inv_policy "{\"enabled\":true,\"emailDomains\":[\"${INV_MAIL}\"]}")
assert_eq "$(status_of "$RESP")" "200" "Invitations enabled for ${PLUGIN}" || true
md_wait_authelia "${DOMAIN_2}"
md_wait_authelia "${DOMAIN_3}"
md_sign_in "${COORD}" "${PASSWORD}" "$(reset_totp "${COORD}")" "${JAR_COORD}" "${FQDN}"

log_section "The refusals the pages map: each with its code"

RESP=$(inv_lookup "$(openssl rand -hex 32)")
assert_eq "$(visit_status "$RESP")" "404" "A token nobody holds: 404" || true
assert_json_field "$(visit_body "$RESP")" '.code' 'invitation_not_found' "…invitation_not_found" || true
inv_new TOKEN_2 INV_ID_2 "${JAR_COORD}" "ayse@${INV_MAIL}" viewer "${COORD} invites ayse@${INV_MAIL} as viewer"
RESP=$(inv_api "${JAR_COORD}" DELETE "/${INV_ID_2}")
assert_eq "$(visit_status "$RESP")" "200" "…and revokes it" || true
RESP=$(inv_lookup "${TOKEN_2}")
assert_eq "$(visit_status "$RESP")" "410" "Its token: 410" || true
assert_json_field "$(visit_body "$RESP")" '.code' 'invitation_closed' "…invitation_closed" || true
RESP=$(inv_api "${JAR_COORD}" DELETE "/00000000-0000-4000-8000-000000000000")
assert_eq "$(visit_status "$RESP")" "404" "The inviter revokes an invitation that does not exist: 404" || true
assert_json_field "$(visit_body "$RESP")" '.code' 'not_found' "…not_found (the inviter's page's key)" || true
inv_new TOKEN INV_ID "${JAR_COORD}" "deniz@${INV_MAIL}" viewer "${COORD} invites deniz@${INV_MAIL} as viewer"
RESP=$(inv_accept "${TOKEN}" "${INVITEE}" "${INVITEE_PASSWORD}")
assert_eq "$(visit_status "$RESP")" "200" "Accepted" || true
SECRET=$(inv_secret "$RESP")
INVITEE_ID=$(json_get "$(inv_row "${INV_ID}")" '.acceptedUserId // empty')
RESP=$(inv_lookup "${TOKEN}")
assert_eq "$(visit_status "$RESP")" "410" "Its token once used: 410" || true
assert_json_field "$(visit_body "$RESP")" '.code' 'invitation_used' "…invitation_used" || true
assert_not_contains "$(visit_body "$RESP")" "Bu davet" "…the API answers codes, never the page's words" || true

log_section "The access-request page: Turkish on B, English on C (P6)"

md_sign_in "${INVITEE}" "${INVITEE_PASSWORD}" "${SECRET}" "${JAR_INV}" "${FQDN}"
RESP=$(visit "${JAR_INV}" "https://${SUB_TB}.${DOMAIN_2}/")
assert_eq "$(visit_status "$RESP")" "403" "${INVITEE} (external, not granted) on B's authenticated tunnel: 403" || true
P6=$(visit_body "$RESP")
assert_contains "${P6}" '<html lang="tr">' "…the access-request page in Turkish (lang=\"tr\")" || true
assert_contains "${P6}" "<h1>Erişim izni gerekiyor" "…Erişim izni gerekiyor" || true
assert_contains "${P6}" "Giriş yapılan hesap: <span class=\"user-badge\">${INVITEE}</span>" "…Giriş yapılan hesap: ${INVITEE}" || true
assert_contains "${P6}" "Konu:" "…its e-mail template's Subject is Konu:" || true
assert_contains "${P6}" "${SUB_TB}.${DOMAIN_2} için erişim talebi" "…the subject in Turkish" || true
assert_contains "${P6}" "Kullanıcı adım: ${INVITEE}" "…the message templates in Turkish" || true
assert_not_contains "${P6}" "Access Required" "…no English heading" || true
MEM_SECRET=$(reset_totp "${MEM}")
md_sign_in "${MEM}" "${PASSWORD}" "${MEM_SECRET}" "${JAR_MEM_B}" "${SUB_RB}.${DOMAIN_2}"
RESP=$(visit "${JAR_MEM_B}" "https://${SUB_RB}.${DOMAIN_2}/")
assert_eq "$(visit_status "$RESP")" "403" "${MEM} (member of B, no grant) on B's restricted tunnel: 403" || true
assert_contains "$(visit_body "$RESP")" "<h1>Erişim izni gerekiyor" "…in Turkish" || true
md_sign_in "${MEM}" "${PASSWORD}" "${MEM_SECRET}" "${JAR_MEM_C}" "${SUB_RC}.${DOMAIN_3}"
RESP=$(visit "${JAR_MEM_C}" "https://${SUB_RC}.${DOMAIN_3}/")
assert_access_request "$RESP" "${MEM} (member of C, no grant) on C's restricted tunnel"
assert_contains "$(visit_body "$RESP")" '<html lang="en">' "…in English (lang=\"en\")" || true
assert_contains "$(visit_body "$RESP")" "Subject:" "…Subject:" || true

log_section "The domain refusal: Turkish on B, English on C (P7)"

OUT_SECRET=$(reset_totp "${OUT}")
md_sign_in "${OUT}" "${PASSWORD}" "${OUT_SECRET}" "${JAR_OUT_B}" "${SUB_TB}.${DOMAIN_2}"
RESP=$(visit "${JAR_OUT_B}" "https://${SUB_TB}.${DOMAIN_2}/")
assert_eq "$(visit_status "$RESP")" "403" "${OUT} (member of A alone) on B's tunnel: 403" || true
P7=$(visit_body "$RESP")
assert_contains "${P7}" '<html lang="tr">' "…the domain refusal in Turkish (lang=\"tr\")" || true
assert_contains "${P7}" "<span class=\"fqdn\">${DOMAIN_2}</span> üyesi değilsiniz" "…${DOMAIN_2} üyesi değilsiniz" || true
assert_contains "${P7}" "<title>İzin verilmiyor — ${DOMAIN_2}" "…titled İzin verilmiyor — ${DOMAIN_2}" || true
assert_contains "${P7}" "<a href=\"https://auth.${DOMAIN_2}/logout\">oturumu kapatın</a>" "…the sign-out link in Turkish, on B's sign-in host" || true
assert_not_contains "${P7}" "Not a member" "…no English" || true
md_sign_in "${OUT}" "${PASSWORD}" "${OUT_SECRET}" "${JAR_OUT_C}" "${SUB_TC}.${DOMAIN_3}"
RESP=$(visit "${JAR_OUT_C}" "https://${SUB_TC}.${DOMAIN_3}/")
assert_domain_refusal "$RESP" "${DOMAIN_3}" "${OUT} on C's tunnel"
assert_contains "$(visit_body "$RESP")" '<html lang="en">' "…in English (lang=\"en\")" || true

log_section "Gatekeeper's \"not allowed\" page follows the domain the path names (P9)"

RESP=$(gatekeeper_forbidden "${FQDN}")
assert_eq "$(printf '%s\n' "$RESP" | tail -n 1)" "403" "A shell check of ${FQDN} without its original request: 403" || true
assert_contains "$RESP" '<html lang="tr">' "…Gatekeeper's page in Turkish (lang=\"tr\")" || true
assert_contains "$RESP" "<h1>İzin verilmiyor</h1>" "…İzin verilmiyor" || true
RESP=$(gatekeeper_forbidden "e2e56none.${DOMAIN_3}")
assert_contains "$RESP" '<html lang="en">' "…for a host on C: in English" || true
assert_contains "$RESP" "Not Allowed" "…Not Allowed" || true

# ===========================================================================
# 6. Back to unset
# ===========================================================================

log_section "B and C back to unset"

# The plugin's registry credential (OIDC) restarted Authelia in section 4:
# what counts here is that clearing the languages does not.
AUTHELIA_PID=$(authelia_pid)
RESP=$(set_language "${DOMAIN_2}" null)
assert_json_field "$(body_of "$RESP")" '"\(.changed) \(.domain.language) \(.warnings // [] | length)"' "true null 0" "PUT /api/domains/${DOMAIN_2}/language {language: null}: cleared, no warning" || true
if wait_for 60 index_lacks "${DOMAIN_2}" "data-authelia-lang"; then
  log_pass "auth.${DOMAIN_2}/: lang no longer rewritten"
else
  log_fail "auth.${DOMAIN_2}/ still rewrites lang"
fi
assert_not_eq "$(loading_of "${DOMAIN_2}" de-AT)" "Yükleniyor" "…its de-AT locale is no longer the forced Turkish" || true
assert_not_contains "$(visit_body "$(page_of "${DOMAIN_2}" /brand.css)")" "#language-button" "…its menu shown again (brand.css without the rule)" || true
INVITE_B=$(visit_body "$(page_of "${DOMAIN_2}" /invite)")
assert_contains "${INVITE_B}" '<html lang="en">' "…its invitation page in English" || true
assert_contains "${INVITE_B}" "<title>${BRAND_B} — Accept Invitation</title>" "…with its brand" || true
RESP=$(set_language "${DOMAIN_3}" null)
assert_json_field "$(body_of "$RESP")" '"\(.changed) \(.domain.language)"' "true null" "${DOMAIN_3} cleared" || true
if wait_for 90 rendering_gone "${DOMAIN_3}"; then
  log_pass "…its language-only rendering is gone"
else
  log_fail "…a rendering is left: $(json_get "$(domain_entry "${DOMAIN_3}")" '.rendering')"
fi
CSS_C=$(page_of "${DOMAIN_3}" /brand.css)
assert_eq "$(visit_status "${CSS_C}")" "200" "auth.${DOMAIN_3}/brand.css: the stock stylesheet (4.13)" || true
assert_not_contains "$(visit_body "${CSS_C}")" "#language-button" "…without the language rule" || true
assert_eq "$(language_audit "${DOMAIN_2}")" "null tr,tr null" "The audit: domain.language.updated for ${DOMAIN_2}, null → tr, then tr → null" || true
assert_eq "$(language_audit "${DOMAIN_3}")" "null en,en null" "…for ${DOMAIN_3}, null → en, then en → null" || true
assert_eq "$(authelia_pid)" "${AUTHELIA_PID}" "Clearing the languages restarted no Authelia" || true

end_test

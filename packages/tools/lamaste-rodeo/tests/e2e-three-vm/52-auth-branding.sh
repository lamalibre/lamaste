#!/usr/bin/env bash
# ============================================================================
# 52 — Per-domain branding: two brands, a stock third (Three-VM)
# ============================================================================
# The auth pages of a domain carry its brand (design: packages/core/docs/
# auth-branding-design.md): A — the relay's primary — and B are branded
# differently, C has no brand and must be exactly the stock page
# (multi-domain-harness.sh names B and C).
#
# 1. B and C active. Two logos (PNG) and two favicons (an ICO, a PNG) made
#    on the host VM, their digests kept. Brand A (dark, an accent, a
#    support e-mail and URL, logo A, favicon A) and brand B (light, another
#    accent, logo B, favicon B) through the API; each answer names the
#    revision and the asset's digest, carries no warning; both rendered.
# 2. The sign-in pages, from the visitor: A's index says data-theme="dark",
#    data-logooverride="true" and links /brand.css; B's "light"; C's
#    "light", "false" and no stylesheet — and Authelia's CSP is untouched.
#    /brand.css carries the accent and the hidden footer, nosniff and the
#    assets' cache policy; C has none (404). The logos and favicons are the
#    fixtures' bytes under the content type of the extension; C gets
#    Authelia's placeholder logo and its own favicon. The locale files say
#    "Login - Brand A" in English and the brand in Turkish, no {{authelia}}
#    left in a value; C's are Authelia's own.
# 3. The invitation page of A carries the brand's name, logo and tagline
#    with the stock page's script; C's is the stock page.
# 4. Gatekeeper's pages: a member of A, signed in at B, gets B's branded
#    domain refusal on B's tunnel; without a grant, A's branded
#    access-request page on A's restricted tunnel (its support contact);
#    on C's tunnel the stock refusal, no brand.
# 5. A's theme changed to oled: the page and its vhost say so; A's logo
#    removed: the logo switch off, the placeholder back; B's brand removed:
#    the stock page, its rendering gone. The audit names fields and
#    digests, never the name or the bytes.
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../e2e/helpers.sh"
# shellcheck source-path=SCRIPTDIR source=app-plugin-harness.sh
source "${SCRIPT_DIR}/app-plugin-harness.sh"
MD_SPEC=52
# shellcheck source-path=SCRIPTDIR source=multi-domain-harness.sh
source "${SCRIPT_DIR}/multi-domain-harness.sh"

require_commands multipass curl jq perl openssl

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

USER_A="e2e52-a"
# Test credentials for this run only, never printed
PASSWORD_A="E2e-$(openssl rand -hex 12)"
ID_A=""
SECRET_A=""
BRAND_A="Brand A"
BRAND_B="Brand B"
TAGLINE_A="Sign in to A"
ACCENT_A="#1d4ed8"
ACCENT_B="#b91c1c"
SUPPORT_A="support-a@example.test"
HELP_A="https://help.example.test/a"
# The pages' own accent (Gatekeeper's PAGE_DEFAULT_ACCENT), on a stock page
STOCK_ACCENT="#22d3ee"
SUB_A="e2e52a"
SUB_B="e2e52b"
SUB_C="e2e52c"
PORT_A=18521
PORT_B=18522
PORT_C=18523
TUNNEL_A=""
TUNNEL_B=""
TUNNEL_C=""
# The fixtures on the host VM (images and their JSON bodies)
FIXTURES="/var/tmp/e2e-52-branding"
WEB_ROOT="/var/www/lamaste/auth"
LOGO_A_SHA=""
LOGO_B_SHA=""
FAVICON_A_SHA=""
FAVICON_B_SHA=""
PLACEHOLDER_SHA=""
LOGO_A_B64_HEAD=""
ICO_TYPE=""

# brand_body <name> <tagline | -> <theme> <accent> <support e-mail | -> <support URL | -> — a PUT body
brand_body() {
  jq -c -n --arg n "$1" --arg t "$2" --arg th "$3" --arg a "$4" --arg e "$5" --arg u "$6" \
    '{name: $n, theme: $th, accent: $a} + (if $t != "-" then {tagline: $t} else {} end) + (if $e != "-" then {supportEmail: $e} else {} end) + (if $u != "-" then {supportUrl: $u} else {} end)'
}

# auth_url <domain> <path> — a page of the domain's sign-in host
auth_url() { echo "https://auth.$1$2"; }

# branding_of <domain> — GET /api/domains/<domain>/branding, its body
branding_of() { body_of "$(host_api_call GET "domains/$1/branding")"; }

# rendered_current <domain> — the rendering nginx serves is the record's revision
rendered_current() { [ "$(json_get "$(branding_of "$1")" '.branding.renderedCurrent')" = "true" ]; }

# page_says <domain> <substring> — the sign-in page of <domain> carries <substring>
page_says() { [[ "$(visit_body "$(visit - "$(auth_url "$1" /)")")" == *"$2"* ]]; }

# fetch_digest <url> — "<status> <content type> <sha256 of the body>" of one request from the visitor
fetch_digest() {
  visitor_exec "curl -sk --max-time 20 -o /tmp/e2e-52-body -w '%{http_code} %{content_type} ' $(q "$1") && sha256sum /tmp/e2e-52-body | cut -d' ' -f1 || echo fetch-failed" 2>/dev/null | tr -d '\r\n' || echo ""
}

# host_digest <file on the host VM> — its SHA-256
host_digest() { host_exec "sha256sum $(printf %q "$1") | cut -d' ' -f1" 2>/dev/null | tail -n 1 | tr -d '\r' || echo ""; }

# locale_file <domain> <locale> <namespace> — the locale file as served on the domain's sign-in host
locale_file() { visit_body "$(visit - "$(auth_url "$1" "/locales/$2/$3.json")")"; }

# script_of <html> — the page's <script> section alone
script_of() { printf '%s\n' "$1" | sed -n '/<script>/,/<\/script>/p'; }

# renders_of <domain> — how many rendering directories of <domain>
# (`<domain>-<revision>-<hex>`) are under .renders/
renders_of() { host_exec "ls ${WEB_ROOT}/.renders 2>/dev/null | awk -v p=$(printf %q "$1-") 'index(\$0, p) == 1' | wc -l | tr -d ' '" 2>/dev/null | tail -n 1 | tr -d '\r' || echo "?"; }

# renders_gone <domain> — none is left
renders_gone() { [ "$(renders_of "$1")" = "0" ]; }

# entry_gone <domain> — the domain has no entry under the web root (no link, no directory)
entry_gone() { [ "$(host_exec "test -L ${WEB_ROOT}/$1 -o -e ${WEB_ROOT}/$1 && echo there || echo gone" 2>/dev/null | tail -n 1 | tr -d '\r')" = "gone" ]; }

# stock_page <domain> — the sign-in page of <domain> is the stock one: no logo switch, no stylesheet
stock_page() {
  local body
  body=$(visit_body "$(visit - "$(auth_url "$1" /)")")
  [[ "$body" == *'data-logooverride="false"'* && "$body" != *'brand.css'* ]]
}

# write_fixtures — the images on the host VM, deterministic (python3 with
# zlib: a solid PNG of each colour; the ICO wraps a PNG entry), each with a
# JSON body {data: <base64>} beside it; never printed
write_fixtures() {
  local script
  script=$(
    cat << 'PY'
import base64, json, os, struct, sys, zlib
out = sys.argv[1]
def chunk(kind, data):
    return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)
def png(w, h, rgb):
    raw = b''.join(b'\x00' + bytes(rgb) * w for _ in range(h))
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))
def ico(entry, w, h):
    return struct.pack('<HHH', 0, 1, 1) + struct.pack('<BBBBHHII', w, h, 0, 0, 1, 32, len(entry), 22) + entry
files = {
    'logo-a.png': png(48, 48, (29, 78, 216)),
    'logo-b.png': png(64, 32, (185, 28, 28)),
    'favicon-a.ico': ico(png(16, 16, (29, 78, 216)), 16, 16),
    'favicon-b.png': png(32, 32, (185, 28, 28)),
}
for name, data in files.items():
    with open(os.path.join(out, name), 'wb') as f:
        f.write(data)
    with open(os.path.join(out, name + '.json'), 'w') as f:
        json.dump({'data': base64.b64encode(data).decode('ascii')}, f)
PY
  )
  host_exec "rm -rf ${FIXTURES} && mkdir -p ${FIXTURES} && echo $(printf '%s' "$script" | base64 | tr -d '\n') | base64 -d > ${FIXTURES}/mkimages.py && python3 ${FIXTURES}/mkimages.py ${FIXTURES} && ls ${FIXTURES}" > /dev/null 2>&1 || true
  LOGO_A_SHA=$(host_digest "${FIXTURES}/logo-a.png")
  LOGO_B_SHA=$(host_digest "${FIXTURES}/logo-b.png")
  FAVICON_A_SHA=$(host_digest "${FIXTURES}/favicon-a.ico")
  FAVICON_B_SHA=$(host_digest "${FIXTURES}/favicon-b.png")
  LOGO_A_B64_HEAD=$(host_exec "base64 -w0 ${FIXTURES}/logo-a.png | head -c 24" 2>/dev/null | tail -n 1 | tr -d '\r' || echo "")
  assert_eq "$(printf '%s\n%s\n%s\n%s\n' "${LOGO_A_SHA}" "${LOGO_B_SHA}" "${FAVICON_A_SHA}" "${FAVICON_B_SHA}" | grep -cE '^[0-9a-f]{64}$' || true)" "4" "Four image fixtures written on the host VM, each with a digest" || true
  assert_eq "$(printf '%s\n%s\n%s\n%s\n' "${LOGO_A_SHA}" "${LOGO_B_SHA}" "${FAVICON_A_SHA}" "${FAVICON_B_SHA}" | sort -u | wc -l | tr -d ' ')" "4" "…all four distinct" || true
}

begin_test "52 — Per-domain branding: two brands, a stock third (Three-VM)"

cleanup() {
  log_info "Cleaning up test resources..."
  local id d
  for d in "${DOMAIN}" "${DOMAIN_2}"; do
    host_api_delete "domains/${d}/branding" > /dev/null 2>&1 || true
  done
  for id in ${TUNNEL_A} ${TUNNEL_B} ${TUNNEL_C}; do
    host_api_delete "tunnels/${id}" > /dev/null 2>&1 || true
  done
  host_api_delete "users/${USER_A}?erase=true" > /dev/null 2>&1 || true
  timed_exec 30 multipass exec "${HOST_VM}" -- sudo bash -c "rm -rf ${FIXTURES}; true" > /dev/null 2>&1
  timed_exec 30 multipass exec "${VISITOR_VM}" -- sudo bash -c "rm -f /tmp/e2e-52-body; true" > /dev/null 2>&1
  md_cleanup
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
log_section "Pre-flight"
# ---------------------------------------------------------------------------

md_preflight
if [ "$(domain_entry "${DOMAIN_3}")" != "null" ]; then
  log_info "${DOMAIN_3} is left over from an interrupted run — removed first"
  md_api DELETE "domains/${DOMAIN_3}" > /dev/null || true
fi
# A brand left by an interrupted run would make "created" and the revisions lie
host_api_delete "domains/${DOMAIN}/branding" > /dev/null 2>&1 || true
host_api_delete "domains/${DOMAIN_2}/branding" > /dev/null 2>&1 || true

# ===========================================================================
# 1. Three domains, two brands
# ===========================================================================

log_section "Domains B and C active; the image fixtures"

md_domain_active "${DOMAIN_2}"
md_domain_active "${DOMAIN_3}"
write_fixtures
PLACEHOLDER_SHA=$(host_digest /etc/authelia/assets/logo.png)
assert_eq "$(printf '%s\n' "${PLACEHOLDER_SHA}" | grep -cE '^[0-9a-f]{64}$' || true)" "1" "Authelia's asset directory holds the placeholder logo (/etc/authelia/assets/logo.png)" || true
ICO_TYPE=$(host_exec "awk '\$NF == \"ico;\" {print \$1}' /etc/nginx/mime.types" 2>/dev/null | tail -n 1 | tr -d '\r' || echo "")
assert_contains "${ICO_TYPE}" "image/" "nginx's mime.types names a type for .ico (${ICO_TYPE})" || true

log_section "Brand A (dark, logo, ICO favicon) and brand B (light, logo, PNG favicon); C stays stock"

RESP=$(md_api PUT "domains/${DOMAIN}/branding" "$(brand_body "${BRAND_A}" "${TAGLINE_A}" dark "${ACCENT_A}" "${SUPPORT_A}" "${HELP_A}")")
assert_eq "$(status_of "$RESP")" "200" "PUT /api/domains/${DOMAIN}/branding: ${BRAND_A}, dark, ${ACCENT_A}, support contact" || true
assert_json_field "$(body_of "$RESP")" '"\(.created) \(.branding.revision) \(.branding.theme) \(.warnings // [] | length)"' "true 1 dark 0" "…created at revision 1, dark, no warning" || true
RESP=$(API_TIMEOUT=60 host_api_call_file PUT "domains/${DOMAIN}/branding/logo" "${FIXTURES}/logo-a.png.json")
assert_eq "$(status_of "$RESP")" "200" "PUT …/branding/logo: logo A (base64 in JSON)" || true
assert_json_field "$(body_of "$RESP")" '"\(.changed) \(.branding.revision) \(.branding.logo.format) \(.branding.logo.width)x\(.branding.logo.height) \(.warnings // [] | length)"' "true 2 png 48x48 0" "…revision 2, a 48×48 PNG, no warning" || true
assert_json_field "$(body_of "$RESP")" '.branding.logo.sha256' "${LOGO_A_SHA}" "…the answer's digest is the fixture's" || true
RESP=$(API_TIMEOUT=60 host_api_call_file PUT "domains/${DOMAIN}/branding/favicon" "${FIXTURES}/favicon-a.ico.json")
assert_json_field "$(body_of "$RESP")" '"\(.changed) \(.branding.revision) \(.branding.favicon.format) \(.branding.favicon.sha256) \(.warnings // [] | length)"' "true 3 ico ${FAVICON_A_SHA} 0" "PUT …/branding/favicon: favicon A, an ICO — revision 3, its digest, no warning" || true

RESP=$(md_api PUT "domains/${DOMAIN_2}/branding" "$(brand_body "${BRAND_B}" - light "${ACCENT_B}" - -)")
assert_json_field "$(body_of "$RESP")" '"\(.created) \(.branding.revision) \(.branding.theme) \(.branding.tagline) \(.branding.supportEmail) \(.warnings // [] | length)"' "true 1 light null null 0" "PUT /api/domains/${DOMAIN_2}/branding: ${BRAND_B}, light, ${ACCENT_B}, nothing else" || true
RESP=$(API_TIMEOUT=60 host_api_call_file PUT "domains/${DOMAIN_2}/branding/logo" "${FIXTURES}/logo-b.png.json")
assert_json_field "$(body_of "$RESP")" '"\(.branding.revision) \(.branding.logo.sha256) \(.warnings // [] | length)"' "2 ${LOGO_B_SHA} 0" "Logo B set — revision 2, the fixture's digest" || true
RESP=$(API_TIMEOUT=60 host_api_call_file PUT "domains/${DOMAIN_2}/branding/favicon" "${FIXTURES}/favicon-b.png.json")
assert_json_field "$(body_of "$RESP")" '"\(.branding.revision) \(.branding.favicon.format) \(.branding.favicon.sha256) \(.warnings // [] | length)"' "3 png ${FAVICON_B_SHA} 0" "Favicon B set, a PNG — revision 3, the fixture's digest" || true
assert_json_field "$(branding_of "${DOMAIN_3}")" '.branding' "null" "${DOMAIN_3} has no brand" || true

if wait_for 60 rendered_current "${DOMAIN}" && wait_for 60 rendered_current "${DOMAIN_2}"; then
  log_pass "Both brands are rendered at their revision (renderedCurrent)"
else
  log_fail "A brand is not rendered: A $(json_get "$(branding_of "${DOMAIN}")" '.branding.rendered'), B $(json_get "$(branding_of "${DOMAIN_2}")" '.branding.rendered')"
fi

# ===========================================================================
# 2. The sign-in pages
# ===========================================================================

log_section "The sign-in pages: theme, logo switch, stylesheet — C is the stock page"

RESP=$(visit - "$(auth_url "${DOMAIN}" /)")
assert_eq "$(visit_status "$RESP")" "200" "auth.${DOMAIN}/: 200" || true
PAGE_A=$(visit_body "$RESP")
assert_contains "${PAGE_A}" 'data-theme="dark"' "…data-theme=\"dark\" (A's theme)" || true
assert_contains "${PAGE_A}" 'data-logooverride="true"' "…data-logooverride=\"true\" (A serves a logo)" || true
assert_contains "${PAGE_A}" '<link rel="stylesheet" href="/brand.css">' "…links /brand.css" || true
CSP_A=$(visit_headers "$RESP" | tr '[:upper:]' '[:lower:]' | awk '$1 == "content-security-policy:" {print}' | tail -n 1)
assert_contains "${CSP_A}" "style-src 'self'" "…Authelia's Content-Security-Policy is sent, style-src 'self' as Authelia writes it" || true
assert_not_contains "${PAGE_A}" 'data-theme="light"' "…no light theme left anywhere in the page" || true

PAGE_B=$(visit_body "$(visit - "$(auth_url "${DOMAIN_2}" /)")")
assert_contains "${PAGE_B}" 'data-theme="light"' "auth.${DOMAIN_2}/: data-theme=\"light\" (B's theme)" || true
assert_contains "${PAGE_B}" 'data-logooverride="true"' "…data-logooverride=\"true\" (B serves a logo)" || true
assert_contains "${PAGE_B}" '<link rel="stylesheet" href="/brand.css">' "…links /brand.css" || true

RESP=$(visit - "$(auth_url "${DOMAIN_3}" /)")
PAGE_C=$(visit_body "$RESP")
assert_eq "$(visit_status "$RESP")" "200" "auth.${DOMAIN_3}/: 200" || true
assert_contains "${PAGE_C}" 'data-theme="light"' "…data-theme=\"light\" (the stock theme)" || true
assert_contains "${PAGE_C}" 'data-logooverride="false"' "…data-logooverride=\"false\" (the placeholder is never shown)" || true
assert_not_contains "${PAGE_C}" 'brand.css' "…no stylesheet: exactly the stock page" || true
assert_contains "$(visit_headers "$RESP" | tr '[:upper:]' '[:lower:]' | awk '$1 == "content-security-policy:" {print}' | tail -n 1)" "style-src 'self'" "…the same CSP as a branded domain's" || true

log_section "/brand.css: the accent, the hidden footer, the asset headers"

RESP=$(visit - "$(auth_url "${DOMAIN}" /brand.css)")
assert_eq "$(visit_status "$RESP")" "200" "auth.${DOMAIN}/brand.css: 200" || true
HEADERS=$(visit_headers "$RESP" | tr '[:upper:]' '[:lower:]')
assert_contains "${HEADERS}" "content-type: text/css" "…text/css (by the extension)" || true
assert_contains "${HEADERS}" "x-content-type-options: nosniff" "…X-Content-Type-Options: nosniff" || true
assert_contains "${HEADERS}" "cache-control: public, max-age=0, must-revalidate" "…Cache-Control: public, max-age=0, must-revalidate" || true
CSS_A=$(visit_body "$RESP")
assert_contains "${CSS_A}" "--primary: ${ACCENT_A} !important;" "…--primary is A's accent" || true
assert_contains "${CSS_A}" 'a[href^="https://www.authelia.com"] { display: none !important; }' "…the \"Powered by\" footer link is hidden" || true
assert_contains "$(visit_body "$(visit - "$(auth_url "${DOMAIN_2}" /brand.css)")")" "--primary: ${ACCENT_B} !important;" "auth.${DOMAIN_2}/brand.css: --primary is B's accent" || true
assert_eq "$(visit_status "$(visit - "$(auth_url "${DOMAIN_3}" /brand.css)")")" "404" "auth.${DOMAIN_3}/brand.css: 404 (no brand, no stylesheet)" || true

log_section "The logos and favicons: the fixtures' bytes; C gets Authelia's"

assert_eq "$(fetch_digest "$(auth_url "${DOMAIN}" /static/media/logo.png)")" "200 image/png ${LOGO_A_SHA}" "auth.${DOMAIN}/static/media/logo.png: logo A's bytes, image/png" || true
assert_eq "$(fetch_digest "$(auth_url "${DOMAIN_2}" /static/media/logo.png)")" "200 image/png ${LOGO_B_SHA}" "auth.${DOMAIN_2}/static/media/logo.png: logo B's bytes" || true
assert_eq "$(fetch_digest "$(auth_url "${DOMAIN_3}" /static/media/logo.png)")" "200 image/png ${PLACEHOLDER_SHA}" "auth.${DOMAIN_3}/static/media/logo.png: Authelia's placeholder (the asset directory's logo.png)" || true
assert_eq "$(fetch_digest "$(auth_url "${DOMAIN}" /favicon.ico)")" "200 ${ICO_TYPE} ${FAVICON_A_SHA}" "auth.${DOMAIN}/favicon.ico: favicon A's bytes, ${ICO_TYPE}" || true
assert_eq "$(fetch_digest "$(auth_url "${DOMAIN_2}" /favicon.ico)")" "200 ${ICO_TYPE} ${FAVICON_B_SHA}" "auth.${DOMAIN_2}/favicon.ico: favicon B's PNG bytes under the .ico name, ${ICO_TYPE} by the extension" || true
FAVICON_C=$(fetch_digest "$(auth_url "${DOMAIN_3}" /favicon.ico)")
assert_eq "${FAVICON_C%% *}" "200" "auth.${DOMAIN_3}/favicon.ico: 200, Authelia's own" || true
assert_not_contains "${FAVICON_C}" "${FAVICON_A_SHA}" "…not favicon A" || true
assert_not_contains "${FAVICON_C}" "${FAVICON_B_SHA}" "…not favicon B" || true

log_section "The locale files: the brand name in place of {{authelia}}, in English and Turkish"

EN_A=$(locale_file "${DOMAIN}" en portal)
assert_json_field "${EN_A}" '."Login - {{authelia}}"' "Login - ${BRAND_A}" "auth.${DOMAIN}/locales/en/portal.json: \"Login - {{authelia}}\" → \"Login - ${BRAND_A}\"" || true
assert_json_field "${EN_A}" '."Powered by {{authelia}}"' "Powered by ${BRAND_A}" "…\"Powered by {{authelia}}\" → \"Powered by ${BRAND_A}\"" || true
assert_json_field "${EN_A}" '[.. | strings | select(contains("{{authelia}}"))] | length' "0" "…no {{authelia}} left in any value" || true
TR_A=$(json_get "$(locale_file "${DOMAIN}" tr portal)" '."Login - {{authelia}}"')
assert_contains "${TR_A}" "${BRAND_A}" "auth.${DOMAIN}/locales/tr/portal.json: the Turkish title carries ${BRAND_A} (${TR_A})" || true
assert_not_contains "${TR_A}" "{{authelia}}" "…and no placeholder" || true
assert_json_field "$(locale_file "${DOMAIN_2}" en portal)" '."Login - {{authelia}}"' "Login - ${BRAND_B}" "auth.${DOMAIN_2}/locales/en/portal.json says ${BRAND_B}" || true
EN_C=$(locale_file "${DOMAIN_3}" en portal)
assert_json_field "${EN_C}" '."Login - {{authelia}}"' "Login - {{authelia}}" "auth.${DOMAIN_3}/locales/en/portal.json is Authelia's own: the title still interpolates {{authelia}}" || true
assert_not_contains "${EN_C}" "${BRAND_A}" "…no brand of another domain" || true
assert_json_field "$(locale_file "${DOMAIN}" en settings)" '[.. | strings | select(contains("'"${BRAND_A}"'"))] | length > 0' "true" "auth.${DOMAIN}/locales/en/settings.json carries ${BRAND_A} too" || true

# ===========================================================================
# 3. The invitation page
# ===========================================================================

log_section "The invitation page: A's branded, C's the stock page, the same script"

RESP=$(visit - "$(auth_url "${DOMAIN}" /invite/x)")
assert_eq "$(visit_status "$RESP")" "200" "auth.${DOMAIN}/invite/x: 200" || true
INVITE_A=$(visit_body "$RESP")
assert_contains "${INVITE_A}" "<title>${BRAND_A} — Accept Invitation</title>" "…titled ${BRAND_A} — Accept Invitation" || true
assert_contains "${INVITE_A}" "<div class=\"brand-name\">${BRAND_A}</div>" "…the brand's name in the header" || true
assert_contains "${INVITE_A}" "<div class=\"brand-tagline\">${TAGLINE_A}</div>" "…and its tagline" || true
assert_contains "${INVITE_A}" '<img class="brand-logo" src="/static/media/logo.png"' "…the logo from the same origin" || true
assert_contains "${INVITE_A}" "--accent: ${ACCENT_A};" "…the accent" || true
RESP=$(visit - "$(auth_url "${DOMAIN_3}" /invite/x)")
assert_eq "$(visit_status "$RESP")" "200" "auth.${DOMAIN_3}/invite/x: 200" || true
INVITE_C=$(visit_body "$RESP")
assert_contains "${INVITE_C}" "<title>Lamaste — Accept Invitation</title>" "…the stock page" || true
assert_not_contains "${INVITE_C}" 'class="brand' "…no brand header" || true
assert_eq "$(script_of "${INVITE_A}" | wc -l | tr -d ' ')" "$(script_of "${INVITE_C}" | wc -l | tr -d ' ')" "Both pages carry a script of the same length" || true
assert_eq "$(script_of "${INVITE_A}")" "$(script_of "${INVITE_C}")" "…byte for byte the same script (the API calls are unchanged)" || true

# ===========================================================================
# 4. Gatekeeper's pages
# ===========================================================================

log_section "A member of A; a tunnel on each domain (B and C authenticated, A restricted)"

md_user ID_A "${USER_A}" "${PASSWORD_A}" "[\"${DOMAIN}\"]"
assert_eq "$(is_uuid "${ID_A}")" "true" "${USER_A} has a directory id" || true
md_tunnel TUNNEL_B "${SUB_B}" "${DOMAIN_2}" "${PORT_B}" authenticated
md_tunnel TUNNEL_A "${SUB_A}" "${DOMAIN}" "${PORT_A}" restricted
md_tunnel TUNNEL_C "${SUB_C}" "${DOMAIN_3}" "${PORT_C}" authenticated
SECRET_A=$(reset_totp "${USER_A}")
md_wait_authelia "${DOMAIN}"
md_sign_in "${USER_A}" "${PASSWORD_A}" "${SECRET_A}" "$(md_jar a-b)" "${SUB_B}.${DOMAIN_2}"
md_sign_in "${USER_A}" "${PASSWORD_A}" "${SECRET_A}" "$(md_jar a-a)" "${SUB_A}.${DOMAIN}"
md_sign_in "${USER_A}" "${PASSWORD_A}" "${SECRET_A}" "$(md_jar a-c)" "${SUB_C}.${DOMAIN_3}"

log_section "The domain refusal on B's tunnel carries brand B"

RESP=$(visit "$(md_jar a-b)" "https://${SUB_B}.${DOMAIN_2}/index.html")
assert_domain_refusal "$RESP" "${DOMAIN_2}" "${USER_A} (a member of A) on B's tunnel"
REFUSAL_B=$(visit_body "$RESP")
assert_contains "${REFUSAL_B}" "<title>Not allowed — ${DOMAIN_2} — ${BRAND_B}</title>" "…titled with ${BRAND_B}" || true
assert_contains "${REFUSAL_B}" "<div class=\"brand-name\">${BRAND_B}</div>" "…${BRAND_B} in the header" || true
assert_contains "${REFUSAL_B}" "src=\"https://auth.${DOMAIN_2}/static/media/logo.png\"" "…the logo from B's sign-in host" || true
assert_contains "${REFUSAL_B}" "--accent: ${ACCENT_B};" "…B's accent" || true
assert_not_contains "${REFUSAL_B}" "Help:" "…no Help link (B names no support URL)" || true
assert_not_contains "${REFUSAL_B}" "${BRAND_A}" "…nothing of brand A" || true

log_section "The access-request page on A's restricted tunnel carries brand A and its support contact"

RESP=$(visit "$(md_jar a-a)" "https://${SUB_A}.${DOMAIN}/index.html")
assert_access_request "$RESP" "${USER_A} on A's restricted tunnel without a grant"
REQUEST_A=$(visit_body "$RESP")
assert_contains "${REQUEST_A}" "<title>Access Required — ${SUB_A}.${DOMAIN} — ${BRAND_A}</title>" "…titled with ${BRAND_A}" || true
assert_contains "${REQUEST_A}" "<div class=\"brand-name\">${BRAND_A}</div>" "…${BRAND_A} in the header" || true
assert_contains "${REQUEST_A}" "<div class=\"brand-tagline\">${TAGLINE_A}</div>" "…its tagline" || true
assert_contains "${REQUEST_A}" "src=\"https://auth.${DOMAIN}/static/media/logo.png\"" "…the logo from A's sign-in host" || true
assert_contains "${REQUEST_A}" "--accent: ${ACCENT_A};" "…A's accent" || true
assert_contains "${REQUEST_A}" "Admin: <a href=\"mailto:${SUPPORT_A}\">${SUPPORT_A}</a>" "…the brand's support e-mail as the contact" || true
assert_contains "${REQUEST_A}" "Help: <a href=\"${HELP_A}\" rel=\"noopener\">${HELP_A}</a>" "…and its support URL as the Help link" || true

log_section "On C's tunnel the refusal is the stock page"

RESP=$(visit "$(md_jar a-c)" "https://${SUB_C}.${DOMAIN_3}/index.html")
assert_domain_refusal "$RESP" "${DOMAIN_3}" "${USER_A} on C's tunnel"
REFUSAL_C=$(visit_body "$RESP")
assert_contains "${REFUSAL_C}" "<title>Not allowed — ${DOMAIN_3}</title>" "…titled without a brand" || true
assert_not_contains "${REFUSAL_C}" 'class="brand' "…no brand header" || true
assert_contains "${REFUSAL_C}" "--accent: ${STOCK_ACCENT};" "…the pages' own accent" || true

# ===========================================================================
# 5. A change, a logo removed, a brand removed
# ===========================================================================

log_section "A's theme changed to oled: the page and its vhost follow"

RESP=$(md_api PUT "domains/${DOMAIN}/branding" "$(brand_body "${BRAND_A}" "${TAGLINE_A}" oled "${ACCENT_A}" "${SUPPORT_A}" "${HELP_A}")")
assert_json_field "$(body_of "$RESP")" '"\(.changed) \(.branding.revision) \(.branding.theme) \(.warnings // [] | length)"' "true 4 oled 0" "PUT …/branding with theme oled: revision 4, no warning" || true
if wait_for 90 page_says "${DOMAIN}" 'data-theme="oled"'; then
  log_pass "auth.${DOMAIN}/ says data-theme=\"oled\""
else
  log_fail "auth.${DOMAIN}/ does not say data-theme=\"oled\" within 90 s"
fi
VHOST_A=$(host_exec "cat /etc/nginx/sites-available/$(vhost_name auth "${DOMAIN}")" 2>/dev/null || echo "")
assert_contains "${VHOST_A}" "sub_filter 'data-theme=\"light\"' 'data-theme=\"oled\"';" "The installed auth vhost of ${DOMAIN} rewrites the theme to oled" || true
assert_contains "${VHOST_A}" "sub_filter 'data-logooverride=\"true\"' 'data-logooverride=\"true\"';" "…and keeps the logo switch on" || true
if host_exec "nginx -t" > /dev/null 2>&1; then
  log_pass "nginx -t passes"
else
  log_fail "nginx -t fails with the rewritten auth vhost"
fi

log_section "A's logo removed: the logo switch off, the placeholder back"

RESP=$(md_api DELETE "domains/${DOMAIN}/branding/logo")
assert_json_field "$(body_of "$RESP")" '"\(.removed) \(.branding.logo) \(.branding.revision) \(.warnings // [] | length)"' "true null 5 0" "DELETE …/branding/logo: removed, revision 5, no warning" || true
if wait_for 90 page_says "${DOMAIN}" 'data-logooverride="false"'; then
  log_pass "auth.${DOMAIN}/ says data-logooverride=\"false\""
else
  log_fail "auth.${DOMAIN}/ still says the logo is served, 90 s after its removal"
fi
assert_eq "$(fetch_digest "$(auth_url "${DOMAIN}" /static/media/logo.png)")" "200 image/png ${PLACEHOLDER_SHA}" "auth.${DOMAIN}/static/media/logo.png is Authelia's placeholder again" || true
assert_contains "$(visit_body "$(visit - "$(auth_url "${DOMAIN}" /)")")" '<link rel="stylesheet" href="/brand.css">' "…the stylesheet stays (the brand does)" || true

log_section "B's brand removed: the stock page, its rendering gone"

RESP=$(md_api DELETE "domains/${DOMAIN_2}/branding")
assert_json_field "$(body_of "$RESP")" '"\(.removed) \(.warnings // [] | length)"' "true 0" "DELETE /api/domains/${DOMAIN_2}/branding: removed, no warning" || true
assert_json_field "$(branding_of "${DOMAIN_2}")" '.branding' "null" "GET says ${DOMAIN_2} has no brand" || true
if wait_for 90 stock_page "${DOMAIN_2}"; then
  log_pass "auth.${DOMAIN_2}/ is the stock page: data-logooverride=\"false\", no stylesheet"
else
  log_fail "auth.${DOMAIN_2}/ is not the stock page 90 s after the removal"
fi
assert_contains "$(visit_body "$(visit - "$(auth_url "${DOMAIN_2}" /)")")" 'data-theme="light"' "…data-theme=\"light\"" || true
assert_eq "$(visit_status "$(visit - "$(auth_url "${DOMAIN_2}" /brand.css)")")" "404" "auth.${DOMAIN_2}/brand.css: 404" || true
assert_eq "$(fetch_digest "$(auth_url "${DOMAIN_2}" /static/media/logo.png)")" "200 image/png ${PLACEHOLDER_SHA}" "auth.${DOMAIN_2}/static/media/logo.png: the placeholder" || true
if wait_for 90 entry_gone "${DOMAIN_2}"; then
  log_pass "${WEB_ROOT}/${DOMAIN_2} is gone"
else
  log_fail "${WEB_ROOT}/${DOMAIN_2} is still there"
fi
if wait_for 90 renders_gone "${DOMAIN_2}"; then
  log_pass "No rendering of ${DOMAIN_2} is left under .renders/"
else
  log_fail "A rendering of ${DOMAIN_2} is left under .renders/ ($(renders_of "${DOMAIN_2}"))"
fi
assert_eq "$(renders_of "${DOMAIN}")" "1" "Exactly one rendering of ${DOMAIN} serves (the previous ones removed)" || true

log_section "The audit names fields and digests, never the name or the bytes"

AUDIT=$(host_api_get "audit?action=domain.branding.updated&limit=200" 2>/dev/null | jq -c --arg d "${DOMAIN}" --argjson base "${AUDIT_BASE}" '[.entries[]? | select(.id > $base and .details.domain == $d)]' 2>/dev/null || echo "[]")
assert_json_field "${AUDIT}" 'length' "5" "Five domain.branding.updated entries for ${DOMAIN}: fields, logo, favicon, fields, logo removed" || true
assert_json_field "${AUDIT}" '[.[] | select(.details.fields != null) | .details.fields[]] | unique | contains(["name", "theme", "accent"])' "true" "…the field entries name the fields (name, theme, accent, …)" || true
assert_json_field "${AUDIT}" '[.[] | select(.details.asset == "logo" and .details.removed != true) | .details.sha256] | first' "${LOGO_A_SHA}" "…the logo entry carries its digest" || true
assert_json_field "${AUDIT}" '[.[] | select(.details.asset == "logo" and .details.removed == true)] | length' "1" "…and the removal is one entry" || true
assert_json_field "${AUDIT}" '[.[] | .details.revision] | sort' "[1,2,3,4,5]" "…revisions 1 to 5" || true
assert_not_contains "${AUDIT}" "${BRAND_A}" "…no entry carries the brand's name" || true
assert_not_contains "${AUDIT}" "${LOGO_A_B64_HEAD}" "…nor the logo's bytes" || true
assert_json_field "$(host_api_get "audit?action=domain.branding.removed&limit=50" 2>/dev/null | jq -c --arg d "${DOMAIN_2}" --argjson base "${AUDIT_BASE}" '[.entries[]? | select(.id > $base and .details.domain == $d)]' 2>/dev/null || echo "[]")" 'length' "1" "One domain.branding.removed entry for ${DOMAIN_2}" || true

end_test

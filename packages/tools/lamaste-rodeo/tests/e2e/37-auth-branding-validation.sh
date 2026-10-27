#!/usr/bin/env bash
# ============================================================================
# 37 — Per-domain branding: refusals, reconcile, removal (Single-VM)
# ============================================================================
# The relay's side of a domain's brand (design: packages/core/docs/
# auth-branding-design.md) on the one VM, for the primary domain:
#
# 1. Refusals name the field or the reason and never echo a value: a name
#    with a tag or too long, an unknown theme, an accent that is not
#    #rrggbb, an http:// support URL, an unknown field (400
#    invalid_branding by field), an SVG logo (400 invalid_image), a logo
#    over 512 KiB (413 asset_too_large), a logo before any brand (404
#    no_branding), a stale ifRevision (409 revision_mismatch with the
#    current one), a domain the relay lacks (404 unknown_domain), an agent
#    certificate (403).
# 2. The rendering is a projection of the record: the link nginx serves
#    deleted by hand comes back at the panel's restart; rendered.json names
#    the pinned Authelia release; a tampered rendered.json is rendered
#    again by the minute reconcile. The installed auth vhost carries the
#    four override locations, @authelia and the index rewrite, and
#    lamaste-priv accepts it as written.
# 3. lamaste-server domains branding: show (--json and plain), set, logo,
#    logo --remove, preview, remove — the record and the directory follow.
# 4. Authelia's base: theme light and server.asset_path in its
#    configuration, the placeholder logo in the asset directory (group
#    lamaste-authelia); two panel restarts restart Authelia for it no more.
# ============================================================================

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/helpers.sh"

require_commands curl jq nginx python3 sha256sum openssl node

begin_test "37 — Per-domain branding: refusals, reconcile, removal (Single-VM)"

RUN_ID="$(date +%s)"
AGENT_LABEL_37="branding-e2e-${RUN_ID}"
WORK_DIR="/tmp/lamalibre-lamaste-e2e-branding-37"
AGENT_CERT_DIR="${WORK_DIR}/agent-cert"
STATE_DIR="/etc/lamalibre/lamaste"
LAMASTE_LIB="/opt/lamalibre/lamaste/serverd/node_modules/@lamalibre/lamaste"
WEB_ROOT="/var/www/lamaste/auth"
BRAND="E2E Brand 37"
ACCENT="#0f766e"
NO_SUCH_DOMAIN="nosuch-e2e37.example.test"
LOGO_SHA=""
FAVICON_SHA=""

cleanup() {
  log_info "Cleaning up test resources..."
  api_delete "domains/${DOMAIN}/branding" > /dev/null 2>&1 || true
  api_delete "certs/agent/${AGENT_LABEL_37}" > /dev/null 2>&1 || true
  sudo rm -rf "${WORK_DIR}"
}
trap cleanup EXIT

# brand_call <method> <path> [json] — the body, then the HTTP status on a
# line of its own (status_of / body_of split them)
brand_call() {
  local data=()
  if [ -n "${3:-}" ]; then data=(-H 'Content-Type: application/json' -d "$3"); fi
  _curl_mtls -X "$1" "${data[@]}" -w '\n%{http_code}' "${BASE_URL}/api/$2" 2>/dev/null || echo "000"
}
# brand_call_file <method> <path> <file> — the JSON body read from a file (a base64 asset)
brand_call_file() {
  _curl_mtls -X "$1" -H 'Content-Type: application/json' --data-binary "@$3" -w '\n%{http_code}' "${BASE_URL}/api/$2" 2>/dev/null || echo "000"
}
status_of() { printf '%s\n' "$1" | tail -n 1; }
body_of() { printf '%s\n' "$1" | sed '$d'; }

# wait_for <seconds> <command...> — until the command succeeds (every 3 s)
wait_for() {
  local deadline=$((SECONDS + $1))
  shift
  while [ "$SECONDS" -lt "$deadline" ]; do
    if "$@"; then return 0; fi
    sleep 3
  done
  return 1
}

# assert_refused <response> <status> <code> <field> <what> — a refusal by
# field: the status, the code, the field among the errors' names
assert_refused() {
  local fields
  fields=$(body_of "$1" | jq -r '[.errors[]?.field] | join(",")' 2>/dev/null || echo "")
  assert_eq "$(status_of "$1") $(body_of "$1" | jq -r '.code // "-"' 2>/dev/null || echo "-")" "$2 $3" "$5: $2 $3" || true
  assert_contains ",${fields}," ",$4," "…the error names the field $4 (errors: ${fields})" || true
}

branding_json() { api_get "domains/${DOMAIN}/branding" 2>/dev/null || echo '{}'; }
rendered_current() { [ "$(branding_json | jq -r '.branding.renderedCurrent' 2>/dev/null)" = "true" ]; }
# link_target — what the domain's entry under the web root links to ("-" when it is not a link)
link_target() { sudo readlink "${WEB_ROOT}/${DOMAIN}" 2>/dev/null || echo "-"; }
entry_gone() { ! sudo test -L "${WEB_ROOT}/${DOMAIN}" && ! sudo test -e "${WEB_ROOT}/${DOMAIN}"; }
# auth_get <path> — one request to auth.<DOMAIN><path> through this VM's nginx: the body, then the status
auth_get() { curl -sk --max-time 15 --resolve "auth.${DOMAIN}:443:127.0.0.1" -w '\n%{http_code}' "https://auth.${DOMAIN}$1" 2>/dev/null || echo "000"; }
# cli_json <args...> — lamaste-server domains branding <DOMAIN> <args> --json: its JSON line
cli_json() { sudo lamaste-server domains branding "${DOMAIN}" "$@" --json 2>/dev/null | grep -E '^\{' | tail -n 1 || echo '{}'; }
# cli_plain <args...>
cli_plain() { sudo lamaste-server domains branding "${DOMAIN}" "$@" 2>&1 || true; }
# restart_panel — the panel restarted and answering
restart_panel() {
  sudo systemctl restart lamalibre-lamaste-serverd
  if wait_for_http "${BASE_URL}/api/health" 90 --cert "${CERT_PATH}" --key "${KEY_PATH}" --cacert "${CA_PATH}"; then
    log_pass "The panel is back after its restart"
  else
    log_fail "The panel did not come back after its restart"
  fi
}
# config_json — Authelia's configuration as JSON
config_json() { sudo bash -c "${AUTHELIA_CONFIG_JSON}" 2>/dev/null || echo '{}'; }
# branding_base_restarts <audit id> — authelia.restarted entries with reason branding-base after <audit id>
branding_base_restarts() {
  api_get "audit?action=authelia.restarted&limit=200" 2>/dev/null |
    jq --argjson base "$1" '[.entries[]? | select(.id > $base and .details.reason == "branding-base")] | length' 2>/dev/null || echo "?"
}

# write_fixtures — the images in WORK_DIR, deterministic (python3 with zlib):
# a solid PNG logo, an ICO wrapping a PNG entry, a PNG 100 bytes over the
# logo limit (padded with an ancillary chunk, a whole image still), an SVG;
# each with a JSON body {data: <base64>} beside it. Never printed.
write_fixtures() {
  python3 - "${WORK_DIR}" << 'PY'
import base64, json, os, struct, sys, zlib
out = sys.argv[1]
LIMIT = 512 * 1024
def chunk(kind, data):
    return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)
def png(w, h, rgb, pad=0):
    raw = b''.join(b'\x00' + bytes(rgb) * w for _ in range(h))
    body = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 9))
    if pad:
        body += chunk(b'tEXt', b'\x00' * pad)
    return body + chunk(b'IEND', b'')
def ico(entry, w, h):
    return struct.pack('<HHH', 0, 1, 1) + struct.pack('<BBBBHHII', w, h, 0, 0, 1, 32, len(entry), 22) + entry
small = png(2, 2, (15, 118, 110))
big = png(2, 2, (15, 118, 110), pad=LIMIT + 100 - len(small) - 12)
assert len(big) == LIMIT + 100, len(big)
files = {
    'logo.png': png(48, 48, (15, 118, 110)),
    'favicon.ico': ico(png(16, 16, (15, 118, 110)), 16, 16),
    'big.png': big,
    'logo.svg': b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><script>void 0</script></svg>',
}
for name, data in files.items():
    with open(os.path.join(out, name), 'wb') as f:
        f.write(data)
    with open(os.path.join(out, name + '.json'), 'w') as f:
        json.dump({'data': base64.b64encode(data).decode('ascii')}, f)
PY
  LOGO_SHA=$(sha256sum "${WORK_DIR}/logo.png" | cut -d' ' -f1)
  FAVICON_SHA=$(sha256sum "${WORK_DIR}/favicon.ico" | cut -d' ' -f1)
  assert_eq "$(stat -c %s "${WORK_DIR}/big.png")" "$((512 * 1024 + 100))" "Fixtures written: a logo, a favicon, a PNG 100 bytes over the logo limit, an SVG" || true
}

# ---------------------------------------------------------------------------
log_section "Pre-flight: check onboarding is complete"
# ---------------------------------------------------------------------------

ONBOARDING=$(api_get "onboarding/status" 2>/dev/null || echo '{}')
if [ "$(echo "$ONBOARDING" | jq -r '.status' 2>/dev/null || echo unknown)" != "COMPLETED" ]; then
  log_skip "Onboarding not completed — skipping"
  end_test
  exit $?
fi
DOMAIN=$(echo "$ONBOARDING" | jq -r '.domain // empty')
log_pass "Onboarding is complete (domain ${DOMAIN})"
# A brand left by an interrupted run would make "created" and the revisions lie
api_delete "domains/${DOMAIN}/branding" > /dev/null 2>&1 || true
rm -rf "${WORK_DIR}"
mkdir -p "${WORK_DIR}" "${AGENT_CERT_DIR}"
write_fixtures

# ===========================================================================
# 1. Refusals
# ===========================================================================

log_section "Refusals name the field, never the value"

RESP=$(brand_call PUT "domains/${DOMAIN}/branding" '{"name":"<script>alert(1)</script>"}')
assert_refused "$RESP" 400 invalid_branding name "A name with a tag"
assert_not_contains "$(body_of "$RESP")" "<script>" "…the answer does not echo the name" || true
LONG_NAME=$(printf 'n%.0s' $(seq 1 65))
assert_refused "$(brand_call PUT "domains/${DOMAIN}/branding" "{\"name\":\"${LONG_NAME}\"}")" 400 invalid_branding name "A 65-character name"
RESP=$(brand_call PUT "domains/${DOMAIN}/branding" '{"name":"E2E","theme":"solarized"}')
assert_refused "$RESP" 400 invalid_branding theme "Theme solarized"
assert_not_contains "$(body_of "$RESP")" "solarized" "…the answer does not echo the theme" || true
assert_refused "$(brand_call PUT "domains/${DOMAIN}/branding" '{"name":"E2E","accent":"#FFF"}')" 400 invalid_branding accent "Accent #FFF (not #rrggbb lower case)"
RESP=$(brand_call PUT "domains/${DOMAIN}/branding" '{"name":"E2E","supportUrl":"http://help.example.test/e2e37"}')
assert_refused "$RESP" 400 invalid_branding supportUrl "An http:// support URL"
assert_not_contains "$(body_of "$RESP")" "help.example.test" "…the answer does not echo the URL" || true
assert_refused "$(brand_call PUT "domains/${DOMAIN}/branding" '{"name":"E2E","css":"body { display: none }"}')" 400 invalid_branding css "An unknown field (css)"

log_section "Refusals of an asset: before any brand, an SVG, over the limit"

RESP=$(brand_call_file PUT "domains/${DOMAIN}/branding/logo" "${WORK_DIR}/logo.png.json")
assert_eq "$(status_of "$RESP") $(body_of "$RESP" | jq -r '.code // "-"')" "404 no_branding" "A logo before any brand: 404 no_branding" || true
RESP=$(brand_call_file PUT "domains/${DOMAIN}/branding/logo" "${WORK_DIR}/logo.svg.json")
assert_eq "$(status_of "$RESP") $(body_of "$RESP" | jq -r '"\(.code // "-") \(.reason // "-")"')" "400 invalid_image not_png" "An SVG as the logo: 400 invalid_image, reason not_png" || true
assert_not_contains "$(body_of "$RESP")" "svg" "…the answer does not echo the bytes" || true
RESP=$(brand_call_file PUT "domains/${DOMAIN}/branding/logo" "${WORK_DIR}/big.png.json")
assert_eq "$(status_of "$RESP") $(body_of "$RESP" | jq -r '.code // "-"')" "413 asset_too_large" "A PNG 100 bytes over 512 KiB: 413 asset_too_large" || true
RESP=$(brand_call_file PUT "domains/${DOMAIN}/branding/favicon" "${WORK_DIR}/logo.svg.json")
assert_eq "$(status_of "$RESP") $(body_of "$RESP" | jq -r '"\(.code // "-") \(.reason // "-")"')" "400 invalid_image not_ico_or_png" "An SVG as the favicon: 400 invalid_image, reason not_ico_or_png" || true

log_section "The brand set; a stale revision, an unknown domain, an agent certificate"

RESP=$(brand_call PUT "domains/${DOMAIN}/branding" "{\"name\":\"${BRAND}\",\"theme\":\"dark\",\"accent\":\"${ACCENT}\"}")
assert_eq "$(status_of "$RESP")" "200" "PUT /api/domains/${DOMAIN}/branding: ${BRAND}, dark, ${ACCENT}" || true
assert_json_field "$(body_of "$RESP")" '"\(.created) \(.branding.revision) \(.warnings // [] | length)"' "true 1 0" "…created at revision 1, no warning" || true
RESP=$(brand_call PUT "domains/${DOMAIN}/branding" "{\"name\":\"${BRAND}\",\"theme\":\"grey\",\"ifRevision\":99}")
assert_eq "$(status_of "$RESP") $(body_of "$RESP" | jq -r '"\(.code // "-") \(.revision // "-")"')" "409 revision_mismatch 1" "ifRevision 99: 409 revision_mismatch, the current revision named (1)" || true
assert_json_field "$(branding_json)" '"\(.branding.theme) \(.branding.revision)"' "dark 1" "…nothing changed" || true
RESP=$(brand_call PUT "domains/${NO_SUCH_DOMAIN}/branding" '{"name":"E2E"}')
assert_eq "$(status_of "$RESP") $(body_of "$RESP" | jq -r '.code // "-"')" "404 unknown_domain" "A domain the relay lacks: 404 unknown_domain" || true
assert_eq "$(brand_call GET "domains/${NO_SUCH_DOMAIN}/branding" | tail -n 1)" "404" "…GET too" || true

CERT_RESPONSE=$(api_post "certs/agent" "{\"label\":\"${AGENT_LABEL_37}\",\"capabilities\":[\"tunnels:read\"]}")
assert_json_field "$CERT_RESPONSE" '.ok' 'true' "A throwaway agent ${AGENT_LABEL_37} enrolled" || true
P12_PASS=$(echo "$CERT_RESPONSE" | jq -r '.p12Password' 2>/dev/null || echo "")
sudo openssl pkcs12 -in "${STATE_DIR}/pki/agents/${AGENT_LABEL_37}/client.p12" -out "${AGENT_CERT_DIR}/client.crt" -clcerts -nokeys -passin pass:"${P12_PASS}" 2>/dev/null
sudo openssl pkcs12 -in "${STATE_DIR}/pki/agents/${AGENT_LABEL_37}/client.p12" -out "${AGENT_CERT_DIR}/client.key" -nocerts -nodes -passin pass:"${P12_PASS}" 2>/dev/null
sudo chmod 600 "${AGENT_CERT_DIR}/client.key"
unset P12_PASS
AGENT_STATUS=$(sudo curl -sk --max-time 30 -o /dev/null -w '%{http_code}' --cert "${AGENT_CERT_DIR}/client.crt" --key "${AGENT_CERT_DIR}/client.key" --cacert "${STATE_DIR}/pki/ca.crt" "${BASE_URL}/api/domains/${DOMAIN}/branding" 2>/dev/null || echo "000")
assert_eq "${AGENT_STATUS}" "403" "An agent certificate: 403 on GET /api/domains/${DOMAIN}/branding (admin only)" || true
AGENT_STATUS=$(sudo curl -sk --max-time 30 -o /dev/null -w '%{http_code}' -X PUT -H 'Content-Type: application/json' -d '{"name":"E2E"}' --cert "${AGENT_CERT_DIR}/client.crt" --key "${AGENT_CERT_DIR}/client.key" --cacert "${STATE_DIR}/pki/ca.crt" "${BASE_URL}/api/domains/${DOMAIN}/branding" 2>/dev/null || echo "000")
assert_eq "${AGENT_STATUS}" "403" "…and on PUT" || true

# ===========================================================================
# 2. The rendering and the vhost
# ===========================================================================

log_section "The rendering: the record's revision from the pinned Authelia release"

RESP=$(brand_call_file PUT "domains/${DOMAIN}/branding/logo" "${WORK_DIR}/logo.png.json")
assert_json_field "$(body_of "$RESP")" '"\(.changed) \(.branding.revision) \(.branding.logo.sha256) \(.warnings // [] | length)"' "true 2 ${LOGO_SHA} 0" "The logo set: revision 2, the fixture's digest, no warning" || true
RESP=$(brand_call_file PUT "domains/${DOMAIN}/branding/favicon" "${WORK_DIR}/favicon.ico.json")
assert_json_field "$(body_of "$RESP")" '"\(.changed) \(.branding.revision) \(.branding.favicon.format) \(.branding.favicon.sha256)"' "true 3 ico ${FAVICON_SHA}" "The favicon set: revision 3, an ICO, the fixture's digest" || true
if wait_for 30 rendered_current; then
  log_pass "The rendering is current (revision 3)"
else
  log_fail "The rendering is not current: $(branding_json | jq -c '.branding.rendered')"
fi
TARGET_1=$(link_target)
assert_contains "${TARGET_1}" ".renders/${DOMAIN}-3-" "${WEB_ROOT}/${DOMAIN} links to a rendering of revision 3 under .renders/ (${TARGET_1})" || true
PINNED=$(node --input-type=module -e "import { AUTHELIA_RELEASE } from '${LAMASTE_LIB}/dist/index.js'; console.log(AUTHELIA_RELEASE.version);" 2>/dev/null || echo "")
assert_eq "$(printf '%s\n' "${PINNED}" | grep -cE '^[0-9]+\.[0-9]+\.[0-9]+$' || true)" "1" "The installed core library pins an Authelia release (${PINNED})" || true
assert_eq "$(sudo jq -r '"\(.v) \(.revision) \(.autheliaVersion)"' "${WEB_ROOT}/${DOMAIN}/rendered.json" 2>/dev/null || echo "")" "1 3 ${PINNED}" "rendered.json: v 1, revision 3, the pinned Authelia release" || true
assert_eq "$(sudo stat -c '%U:%G %a' "${WEB_ROOT}/${DOMAIN}/brand.json" 2>/dev/null || echo "")" "lamaste:www-data 640" "The rendered files are lamaste:www-data 0640 (nginx reads through the group)" || true
assert_eq "$(sudo jq -r '"\(.domain) \(.name) \(.logo.sha256)"' "${WEB_ROOT}/${DOMAIN}/brand.json" 2>/dev/null || echo "")" "${DOMAIN} ${BRAND} ${LOGO_SHA}" "brand.json names the domain, the brand and the logo's digest" || true

log_section "The served link deleted by hand: back at the panel's restart"

sudo rm -f "${WEB_ROOT}/${DOMAIN}"
assert_eq "$(link_target)" "-" "The link is gone" || true
assert_json_field "$(branding_json)" '"\(.branding.renderedCurrent) \(.branding.rendered)"' "false null" "GET says the brand is not rendered (renderedCurrent false, rendered null)" || true
restart_panel
if wait_for 90 rendered_current; then
  log_pass "The start's reconcile rendered the brand again (renderedCurrent within 90 s)"
else
  log_fail "The brand is not rendered 90 s after the restart: $(branding_json | jq -c '.branding.rendered')"
fi
TARGET_2=$(link_target)
assert_contains "${TARGET_2}" ".renders/${DOMAIN}-3-" "…the link points at a rendering of revision 3 again" || true
assert_not_eq "${TARGET_2}" "${TARGET_1}" "…a new one (the deleted link's directory was pruned)" || true

log_section "rendered.json tampered: rendered again by the minute reconcile"

sudo sed -i 's/"revision": 3/"revision": 300/' "${WEB_ROOT}/${DOMAIN}/rendered.json"
assert_json_field "$(branding_json)" '"\(.branding.renderedCurrent) \(.branding.rendered.revision)"' "false 300" "GET reads the tampered revision and says the rendering is not current" || true
if wait_for 90 rendered_current; then
  log_pass "The reconcile rendered the brand again within 90 s"
else
  log_fail "The tampered rendering stayed for 90 s"
fi
TARGET_3=$(link_target)
assert_not_eq "${TARGET_3}" "${TARGET_2}" "…into a new directory (${TARGET_3})" || true
assert_eq "$(sudo ls "${WEB_ROOT}/.renders" | grep -c "^${DOMAIN}-" || true)" "1" "…and only that one is left under .renders/" || true

log_section "The auth vhost: the override locations, the index rewrite, accepted by lamaste-priv"

VHOST_NAME=$(vhost_name auth "${DOMAIN}")
VHOST=$(sudo cat "/etc/nginx/sites-available/${VHOST_NAME}" 2>/dev/null || echo "")
assert_contains "${VHOST}" "location = /favicon.ico {" "The installed ${VHOST_NAME} overrides /favicon.ico" || true
assert_contains "${VHOST}" "location = /static/media/logo.png {" "…/static/media/logo.png" || true
assert_contains "${VHOST}" "location /locales/ {" "…/locales/" || true
assert_contains "${VHOST}" "location = /brand.css {" "…and serves /brand.css" || true
assert_contains "${VHOST}" "root ${WEB_ROOT}/${DOMAIN};" "…from the domain's rendering" || true
assert_contains "${VHOST}" "location @authelia {" "…with @authelia as the fallback" || true
assert_contains "${VHOST}" "sub_filter_once off;" "…and rewrites every occurrence in the index (sub_filter_once off)" || true
assert_contains "${VHOST}" "sub_filter 'data-theme=\"light\"' 'data-theme=\"dark\"';" "…the theme to dark" || true
assert_contains "${VHOST}" "sub_filter 'data-logooverride=\"true\"' 'data-logooverride=\"true\"';" "…the logo switch on" || true
assert_contains "${VHOST}" "sub_filter '</head>' '<link rel=\"stylesheet\" href=\"/brand.css\"></head>';" "…the stylesheet link" || true
if sudo cat "/etc/nginx/sites-available/${VHOST_NAME}" | sudo /usr/local/sbin/lamaste-priv nginx-site write "${VHOST_NAME}" > /dev/null 2>&1; then
  log_pass "lamaste-priv nginx-site write accepts the vhost as installed (sub_filter allowed)"
else
  log_fail "lamaste-priv nginx-site write refused the installed vhost"
fi
if sudo nginx -t > /dev/null 2>&1; then
  log_pass "nginx -t passes"
else
  log_fail "nginx -t fails"
fi
RESP=$(auth_get /)
assert_eq "$(status_of "$RESP")" "200" "https://auth.${DOMAIN}/ answers 200" || true
assert_contains "$(body_of "$RESP")" 'data-theme="dark"' "…data-theme=\"dark\"" || true
assert_contains "$(body_of "$RESP")" '<link rel="stylesheet" href="/brand.css">' "…with the stylesheet" || true
RESP=$(auth_get /brand.css)
assert_eq "$(status_of "$RESP")" "200" "https://auth.${DOMAIN}/brand.css answers 200" || true
assert_contains "$(body_of "$RESP")" "--primary: ${ACCENT} !important;" "…with the accent" || true
assert_eq "$(curl -sk --max-time 15 --resolve "auth.${DOMAIN}:443:127.0.0.1" "https://auth.${DOMAIN}/static/media/logo.png" 2>/dev/null | sha256sum | cut -d' ' -f1)" "${LOGO_SHA}" "https://auth.${DOMAIN}/static/media/logo.png is the logo's bytes" || true

# ===========================================================================
# 3. The CLI
# ===========================================================================

log_section "lamaste-server domains branding: show, set, logo, preview, remove"

SHOWN=$(cli_json)
assert_json_field "${SHOWN}" '"\(.branding.name) \(.branding.theme) \(.branding.revision) \(.branding.renderedCurrent)"' "${BRAND} dark 3 true" "branding ${DOMAIN} --json: the brand, revision 3, rendered" || true
PLAIN=$(cli_plain)
assert_contains "${PLAIN}" "${BRAND}" "branding ${DOMAIN}: names the brand" || true
assert_contains "${PLAIN}" "current" "…and says the rendering is current" || true
OUT=$(cli_plain set --theme grey)
assert_contains "${OUT}" "revision 4" "set --theme grey: saved at revision 4" || true
assert_json_field "$(branding_json)" '"\(.branding.theme) \(.branding.revision) \(.branding.accent)"' "grey 4 ${ACCENT}" "…the theme is grey, the accent kept (set merges over the brand read)" || true
OUT=$(cli_plain logo --remove)
assert_contains "${OUT}" "logo of ${DOMAIN} removed" "logo --remove" || true
assert_json_field "$(branding_json)" '"\(.branding.logo) \(.branding.revision)"' "null 5" "…no logo, revision 5" || true
SET=$(cli_json logo "${WORK_DIR}/logo.png")
assert_json_field "${SET}" '"\(.event) \(.changed) \(.branding.logo.sha256) \(.branding.revision)"' "complete true ${LOGO_SHA} 6" "logo <file> --json: the fixture's digest, revision 6" || true
OUT=$(cli_plain logo "${WORK_DIR}/big.png")
assert_contains "${OUT}" "512 KiB" "logo <a file over the limit>: refused before the request, the limit named" || true
assert_json_field "$(branding_json)" '.branding.revision' "6" "…nothing sent" || true
PREVIEW=$(cli_json preview)
assert_json_field "${PREVIEW}" '"\(.title) | \(.footer) | \(.theme) | \(.logo)"' "Login - ${BRAND} | Powered by ${BRAND} | grey | true" "preview --json: the English title and footer, the theme, the logo served" || true
assert_contains "$(cli_plain preview)" "Login - ${BRAND}" "preview: prints the title" || true
assert_contains "$(cli_plain preview)" "display: none" "…and the generated brand.css" || true
OUT=$(cli_plain remove)
assert_contains "${OUT}" "removed" "remove" || true
assert_json_field "$(branding_json)" '.branding' "null" "…GET says the domain has no brand" || true
if entry_gone; then
  log_pass "${WEB_ROOT}/${DOMAIN} is gone"
else
  log_fail "${WEB_ROOT}/${DOMAIN} is still there"
fi
RESP=$(auth_get /)
assert_contains "$(body_of "$RESP")" 'data-logooverride="false"' "https://auth.${DOMAIN}/ is the stock page again: data-logooverride=\"false\"" || true
assert_not_contains "$(body_of "$RESP")" 'brand.css' "…no stylesheet" || true
assert_eq "$(status_of "$(auth_get /brand.css)")" "404" "…/brand.css 404" || true
SHOWN=$(cli_plain)
assert_contains "${SHOWN}" "has no brand" "branding ${DOMAIN}: says the domain has no brand" || true

# ===========================================================================
# 4. Authelia's base
# ===========================================================================

log_section "Authelia's base: theme light, the asset path, the placeholder — one restart, never again"

CONFIG=$(config_json)
assert_json_field "$CONFIG" '"\(.theme) \(.server.asset_path)"' "light /etc/authelia/assets" "configuration.yml: theme light, server.asset_path /etc/authelia/assets" || true
assert_eq "$(sudo stat -c '%G %a' /etc/authelia/assets/logo.png 2>/dev/null || echo "missing")" "lamaste-authelia 640" "/etc/authelia/assets/logo.png exists, group lamaste-authelia, 0640" || true
assert_eq "$(sudo python3 -c 'import sys; sys.exit(0 if open("/etc/authelia/assets/logo.png","rb").read(8) == b"\x89PNG\r\n\x1a\n" else 1)' > /dev/null 2>&1 && echo png || echo other)" "png" "…a PNG" || true
TOTAL_BASE_RESTARTS=$(branding_base_restarts 0)
AUDIT_BASE=$(api_get "audit?limit=1" 2>/dev/null | jq '.entries[0].id // 0' 2>/dev/null || echo "0")
restart_panel
restart_panel
assert_eq "$(branding_base_restarts "${AUDIT_BASE}")" "0" "Two panel restarts later: no further authelia.restarted with reason branding-base" || true
assert_eq "$([ "${TOTAL_BASE_RESTARTS}" -le 1 ] && echo "at most one" || echo "${TOTAL_BASE_RESTARTS}")" "at most one" "…at most one such restart in the whole audit (${TOTAL_BASE_RESTARTS})" || true
assert_eq "$(systemctl is-active authelia)" "active" "Authelia is running" || true

end_test

#!/usr/bin/env bash
# ============================================================================
# 13 — Site Lifecycle
# ============================================================================
# Verifies static site CRUD operations:
# - Create a managed static site via POST /api/sites
# - Verify site appears in GET /api/sites listing
# - List files — default index.html exists
# - Upload test file via multipart POST
# - Verify uploaded file in listing
# - Delete file via DELETE /api/sites/:id/files
# - Verify file removed
# - Update settings via PATCH (toggle spaMode)
# - Verify settings persisted
# - Delete site via DELETE /api/sites/:id
# - Verify site removed from listing
# - Validation: duplicate name, reserved name, invalid UUID
# - Custom-domain site aliases:
#   - validation 400s: aliases on a managed site, alias equal to the site's
#     own domain, Lamaste hostnames (panel./auth./tunnel./base domain),
#     malformed names, more than 10, collisions with another site's domain or
#     alias and with a tunnel's hostname
#   - a tunnel cannot take a hostname a site or alias already serves
#   - verify-dns issues one certificate lineage covering the domain and every
#     alias (real subjectAltName), and the vhost 301s aliases to the domain
#   - PATCH aliases on a live site: an alias that does not resolve here is
#     rejected (nothing changes); a resolving one is added to the certificate
#     (one issue, --cert-name <domain>) and the redirect block; swapping
#     aliases issues for the union of old and new names, then for exactly the
#     new set; removing one re-issues once for exactly the new set and drops
#     it from the redirect block (argv checked in the certbot shim's call log)
# ============================================================================

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/helpers.sh"

require_commands curl jq

begin_test "13 — Site Lifecycle"

# redirect_after_reload <host> <path> <expected> — "<code> <location>" for
# https://<host><path>, retried for up to 10 s until it equals <expected>:
# `systemctl reload nginx` returns once nginx is signalled, and the old
# workers answer with the previous configuration for a moment.
redirect_after_reload() {
  local host="$1" path="$2" expected="$3" got=""
  for _ in $(seq 1 20); do
    got=$(curl -sk -o /dev/null -w '%{http_code} %{redirect_url}' --max-time 10 \
      --resolve "${host}:443:127.0.0.1" "https://${host}${path}" 2>/dev/null || echo "000")
    [ "$got" = "$expected" ] && break
    sleep 0.5
  done
  echo "$got"
}

# ---------------------------------------------------------------------------
log_section "Pre-flight: check onboarding is complete"
# ---------------------------------------------------------------------------

ONBOARDING_STATUS=$(api_get "onboarding/status" | jq -r '.status' 2>/dev/null || echo "unknown")
if [ "$ONBOARDING_STATUS" != "COMPLETED" ]; then
  log_skip "Onboarding not completed — skipping site tests"
  end_test
  exit $?
fi
log_pass "Onboarding is complete"

# ---------------------------------------------------------------------------
log_section "Create managed static site"
# ---------------------------------------------------------------------------

SITE_NAME="e2esite"
CREATE_RESPONSE=$(api_post "sites" "{\"name\":\"${SITE_NAME}\",\"type\":\"managed\",\"spaMode\":false,\"autheliaProtected\":false}")
assert_json_field "$CREATE_RESPONSE" '.ok' 'true' "Site creation returned ok: true" || true

SITE_ID=$(echo "$CREATE_RESPONSE" | jq -r '.site.id' 2>/dev/null || echo "")
assert_json_field_not_empty "$CREATE_RESPONSE" '.site.id' "Site has an ID" || true
assert_json_field "$CREATE_RESPONSE" '.site.name' "$SITE_NAME" "Site name matches" || true
assert_json_field "$CREATE_RESPONSE" '.site.type' "managed" "Site type is managed" || true

SITE_FQDN=$(echo "$CREATE_RESPONSE" | jq -r '.site.fqdn' 2>/dev/null || echo "")
log_info "Created site: ${SITE_FQDN} (ID: ${SITE_ID})"

# Resources of the custom-domain alias sections (cleaned up on any exit)
RUN_ID="$(date +%s)"
ALIAS_SITE_ID=""
ALIAS_TUNNEL_ID=""
ALIAS_AGENT_LABEL="site-alias-e2e-${RUN_ID}"
ALIAS_DNSMASQ_CONF="/etc/dnsmasq.d/lamaste-e2e-13-aliases.conf"
# Every certbot call, argv verbatim, as recorded by the E2E certbot shim
CERTBOT_CALLS="/etc/letsencrypt/e2e-certbot-calls.log"

# Cleanup function
cleanup() {
  if [ -n "$SITE_ID" ] && [ "$SITE_ID" != "null" ]; then
    api_delete "sites/${SITE_ID}" 2>/dev/null || true
  fi
  if [ -n "$ALIAS_SITE_ID" ] && [ "$ALIAS_SITE_ID" != "null" ]; then
    api_delete "sites/${ALIAS_SITE_ID}" > /dev/null 2>&1 || true
  fi
  if [ -n "$ALIAS_TUNNEL_ID" ] && [ "$ALIAS_TUNNEL_ID" != "null" ]; then
    api_delete "tunnels/${ALIAS_TUNNEL_ID}" > /dev/null 2>&1 || true
  fi
  api_delete "certs/agent/${ALIAS_AGENT_LABEL}" > /dev/null 2>&1 || true
  if [ -f "$ALIAS_DNSMASQ_CONF" ]; then
    sudo rm -f "$ALIAS_DNSMASQ_CONF" 2>/dev/null || true
    sudo systemctl restart dnsmasq 2>/dev/null || true
  fi
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
log_section "Verify site in listing"
# ---------------------------------------------------------------------------

SITES_LIST=$(api_get "sites")
FOUND_SITE=$(echo "$SITES_LIST" | jq -r ".sites[] | select(.id == \"${SITE_ID}\") | .name" 2>/dev/null || echo "")
assert_eq "$FOUND_SITE" "$SITE_NAME" "Site appears in listing" || true

# ---------------------------------------------------------------------------
log_section "List files — default content"
# ---------------------------------------------------------------------------

FILES_RESPONSE=$(api_get "sites/${SITE_ID}/files?path=.")
FILE_COUNT=$(echo "$FILES_RESPONSE" | jq '.files | length' 2>/dev/null || echo "0")
if [ "$FILE_COUNT" -gt 0 ]; then
  log_pass "Site has default files (count: ${FILE_COUNT})"
else
  log_fail "Site has no default files"
fi

DEFAULT_FILE=$(echo "$FILES_RESPONSE" | jq -r '.files[] | select(.name == "index.html") | .name' 2>/dev/null || echo "")
assert_eq "$DEFAULT_FILE" "index.html" "Default index.html exists" || true

# ---------------------------------------------------------------------------
log_section "Upload test file"
# ---------------------------------------------------------------------------

TEST_FILE=$(mktemp /tmp/e2e-site-test-XXXXXX.html)
echo "<html><body><h1>E2E Test</h1></body></html>" > "$TEST_FILE"
UPLOAD_RESPONSE=$(api_upload_file "sites/${SITE_ID}/files?path=." "$TEST_FILE")
UPLOADED_BASENAME=$(basename "$TEST_FILE")
rm -f "$TEST_FILE"
assert_json_field "$UPLOAD_RESPONSE" '.ok' 'true' "File upload returned ok: true" || true

# ---------------------------------------------------------------------------
log_section "Verify uploaded file in listing"
# ---------------------------------------------------------------------------

FILES_AFTER_UPLOAD=$(api_get "sites/${SITE_ID}/files?path=.")
FOUND_UPLOAD=$(echo "$FILES_AFTER_UPLOAD" | jq -r ".files[] | select(.name == \"${UPLOADED_BASENAME}\") | .name" 2>/dev/null || echo "")
assert_eq "$FOUND_UPLOAD" "$UPLOADED_BASENAME" "Uploaded file appears in listing" || true

# ---------------------------------------------------------------------------
log_section "Delete uploaded file"
# ---------------------------------------------------------------------------

DELETE_FILE_RESPONSE=$(_curl_mtls \
  -X DELETE \
  -H "Content-Type: application/json" \
  -d "{\"path\":\"${UPLOADED_BASENAME}\"}" \
  "${BASE_URL}/api/sites/${SITE_ID}/files")
assert_json_field "$DELETE_FILE_RESPONSE" '.ok' 'true' "File deletion returned ok: true" || true

# ---------------------------------------------------------------------------
log_section "Verify file removed"
# ---------------------------------------------------------------------------

FILES_AFTER_DELETE=$(api_get "sites/${SITE_ID}/files?path=.")
FOUND_DELETED=$(echo "$FILES_AFTER_DELETE" | jq -r ".files[] | select(.name == \"${UPLOADED_BASENAME}\") | .name" 2>/dev/null || echo "")
assert_eq "$FOUND_DELETED" "" "Deleted file no longer in listing" || true

# ---------------------------------------------------------------------------
log_section "Update site settings"
# ---------------------------------------------------------------------------

PATCH_RESPONSE=$(api_patch "sites/${SITE_ID}" '{"spaMode":true}')
assert_json_field "$PATCH_RESPONSE" '.ok' 'true' "Settings update returned ok: true" || true
assert_json_field "$PATCH_RESPONSE" '.site.spaMode' 'true' "SPA mode is now enabled" || true

# Verify settings persisted
SITE_DETAIL=$(api_get "sites" | jq ".sites[] | select(.id == \"${SITE_ID}\")")
assert_json_field "$SITE_DETAIL" '.spaMode' 'true' "SPA mode persisted in listing" || true

# ---------------------------------------------------------------------------
log_section "File extension validation"
# ---------------------------------------------------------------------------

# Disallowed extension (.php) — should be rejected with 400
PHP_FILE=$(mktemp /tmp/e2e-site-test-XXXXXX.php)
echo "<?php echo 'pwned'; ?>" > "$PHP_FILE"
PHP_STATUS=$(api_upload_file_status "sites/${SITE_ID}/files?path=." "$PHP_FILE")
rm -f "$PHP_FILE"
assert_eq "$PHP_STATUS" "400" "Upload of .php file rejected with 400" || true

# Disallowed extension (.exe) — should be rejected with 400
EXE_FILE=$(mktemp /tmp/e2e-site-test-XXXXXX.exe)
echo "MZ" > "$EXE_FILE"
EXE_STATUS=$(api_upload_file_status "sites/${SITE_ID}/files?path=." "$EXE_FILE")
rm -f "$EXE_FILE"
assert_eq "$EXE_STATUS" "400" "Upload of .exe file rejected with 400" || true

# No extension — should be rejected with 400
NOEXT_FILE=$(mktemp /tmp/e2e-site-test-XXXXXX)
echo "no extension" > "$NOEXT_FILE"
# Rename to strip any suffix mktemp might add
NOEXT_CLEAN="/tmp/e2e-noext-testfile"
cp "$NOEXT_FILE" "$NOEXT_CLEAN"
rm -f "$NOEXT_FILE"
NOEXT_STATUS=$(api_upload_file_status "sites/${SITE_ID}/files?path=." "$NOEXT_CLEAN")
rm -f "$NOEXT_CLEAN"
assert_eq "$NOEXT_STATUS" "400" "Upload of file with no extension rejected with 400" || true

# Allowed extension (.css) — should succeed
CSS_FILE=$(mktemp /tmp/e2e-site-test-XXXXXX.css)
echo "body { color: red; }" > "$CSS_FILE"
CSS_RESPONSE=$(api_upload_file "sites/${SITE_ID}/files?path=." "$CSS_FILE")
CSS_BASENAME=$(basename "$CSS_FILE")
rm -f "$CSS_FILE"
assert_json_field "$CSS_RESPONSE" '.ok' 'true' "Upload of .css file succeeds" || true

# Clean up the uploaded css file
_curl_mtls \
  -X DELETE \
  -H "Content-Type: application/json" \
  -d "{\"path\":\"${CSS_BASENAME}\"}" \
  "${BASE_URL}/api/sites/${SITE_ID}/files" > /dev/null 2>&1 || true

# ---------------------------------------------------------------------------
log_section "Input validation"
# ---------------------------------------------------------------------------

# Duplicate name
DUP_STATUS=$(api_post_status "sites" "{\"name\":\"${SITE_NAME}\",\"type\":\"managed\"}")
assert_eq "$DUP_STATUS" "400" "Duplicate site name rejected with 400" || true

# Reserved name
RESERVED_STATUS=$(api_post_status "sites" '{"name":"panel","type":"managed"}')
assert_eq "$RESERVED_STATUS" "400" "Reserved name 'panel' rejected with 400" || true

RESERVED_STATUS2=$(api_post_status "sites" '{"name":"auth","type":"managed"}')
assert_eq "$RESERVED_STATUS2" "400" "Reserved name 'auth' rejected with 400" || true

# Invalid UUID for site operations
INVALID_ID_STATUS=$(api_get_status "sites/not-a-uuid/files?path=.")
assert_eq "$INVALID_ID_STATUS" "400" "Invalid UUID rejected with 400" || true

# ---------------------------------------------------------------------------
log_section "Custom site aliases: validation"
# ---------------------------------------------------------------------------

DOMAIN=$(api_get "onboarding/status" | jq -r '.domain' 2>/dev/null || echo "")
SERVER_IP=$(api_get "onboarding/status" | jq -r '.ip' 2>/dev/null || echo "")
CUSTOM_DOMAIN="e2e-alias-${RUN_ID}.test"
ALIAS_WWW="www.${CUSTOM_DOMAIN}"
ALIAS_BLOG="blog.${CUSTOM_DOMAIN}"
ALIAS_SHOP="shop.${CUSTOM_DOMAIN}"
# An alias under the Lamaste domain, so the tunnel collision below can aim at it
ALIAS_SUB="e2ealiased${RUN_ID}"
ALIAS_IN_DOMAIN="${ALIAS_SUB}.${DOMAIN}"
# .invalid never resolves (RFC 6761)
ALIAS_UNRESOLVED="nowhere-${RUN_ID}.invalid"
ALIAS_TUNNEL_SUB="e2esitetun${RUN_ID}"

# custom_site_status <aliases-json> — POST a custom site with the given
# aliases on a fresh domain and print the HTTP status
custom_site_status() {
  api_post_status "sites" "{\"name\":\"e2ealiasv${RUN_ID}\",\"type\":\"custom\",\"customDomain\":\"e2e-aliasv-${RUN_ID}.test\",\"aliases\":$1}"
}

# A tunnel whose hostname an alias must not take
ALIAS_AGENT_RESPONSE=$(api_post "certs/agent" '{"label":"'"${ALIAS_AGENT_LABEL}"'","capabilities":["tunnels:read"]}')
assert_json_field "$ALIAS_AGENT_RESPONSE" '.ok' 'true' "Agent enrolled to own the collision tunnel" || true
ALIAS_TUNNEL_RESPONSE=$(api_post "tunnels" "{\"subdomain\":\"${ALIAS_TUNNEL_SUB}\",\"port\":19971,\"description\":\"site alias collision\",\"agentLabel\":\"${ALIAS_AGENT_LABEL}\"}")
ALIAS_TUNNEL_ID=$(echo "$ALIAS_TUNNEL_RESPONSE" | jq -r '.tunnel.id // empty' 2>/dev/null || echo "")
assert_json_field_not_empty "$ALIAS_TUNNEL_RESPONSE" '.tunnel.id' "Collision tunnel ${ALIAS_TUNNEL_SUB}.${DOMAIN} created" || true

MANAGED_ALIAS_STATUS=$(api_post_status "sites" "{\"name\":\"e2emanagedalias${RUN_ID}\",\"type\":\"managed\",\"aliases\":[\"${ALIAS_WWW}\"]}")
assert_eq "$MANAGED_ALIAS_STATUS" "400" "Aliases on a managed site rejected (HTTP 400)" || true

SELF_ALIAS_STATUS=$(custom_site_status "[\"e2e-aliasv-${RUN_ID}.test\"]")
assert_eq "$SELF_ALIAS_STATUS" "400" "Alias equal to the site's own domain rejected (HTTP 400)" || true

for reserved in "panel.${DOMAIN}" "auth.${DOMAIN}" "tunnel.${DOMAIN}" "${DOMAIN}"; do
  RESERVED_ALIAS_STATUS=$(custom_site_status "[\"${reserved}\"]")
  assert_eq "$RESERVED_ALIAS_STATUS" "400" "Lamaste hostname ${reserved} rejected as alias (HTTP 400)" || true
done

MALFORMED_ALIAS_STATUS=$(custom_site_status '["bad_alias.test"]')
assert_eq "$MALFORMED_ALIAS_STATUS" "400" "Malformed alias rejected (HTTP 400)" || true

DOTLESS_ALIAS_STATUS=$(custom_site_status '["localhostalias"]')
assert_eq "$DOTLESS_ALIAS_STATUS" "400" "Alias without a dot rejected (HTTP 400)" || true

ELEVEN_ALIASES=$(for i in $(seq 1 11); do printf '"a%s.e2e-many-%s.test"\n' "$i" "$RUN_ID"; done | paste -sd, -)
TOO_MANY_STATUS=$(custom_site_status "[${ELEVEN_ALIASES}]")
assert_eq "$TOO_MANY_STATUS" "400" "More than 10 aliases rejected (HTTP 400)" || true

TUNNEL_ALIAS_STATUS=$(custom_site_status "[\"${ALIAS_TUNNEL_SUB}.${DOMAIN}\"]")
assert_eq "$TUNNEL_ALIAS_STATUS" "400" "Alias equal to a tunnel's hostname rejected (HTTP 400)" || true

SITE_ALIAS_STATUS=$(custom_site_status "[\"${SITE_FQDN}\"]")
assert_eq "$SITE_ALIAS_STATUS" "400" "Alias equal to another site's domain rejected (HTTP 400)" || true

LEFTOVER_SITES=$(api_get "sites" | jq --arg n "e2ealiasv${RUN_ID}" '[.sites[] | select(.name == $n)] | length' 2>/dev/null || echo "unknown")
assert_eq "$LEFTOVER_SITES" "0" "Rejected alias creates left no site behind" || true

# ---------------------------------------------------------------------------
log_section "Custom site aliases: create and collisions"
# ---------------------------------------------------------------------------

ALIAS_SITE_RESPONSE=$(api_post "sites" "{\"name\":\"e2ealias${RUN_ID}\",\"type\":\"custom\",\"customDomain\":\"${CUSTOM_DOMAIN}\",\"aliases\":[\"${ALIAS_WWW}\",\"${ALIAS_IN_DOMAIN}\"],\"autheliaProtected\":false}")
assert_json_field "$ALIAS_SITE_RESPONSE" '.ok' 'true' "Custom site with aliases created" || true
ALIAS_SITE_ID=$(echo "$ALIAS_SITE_RESPONSE" | jq -r '.site.id // empty' 2>/dev/null || echo "")
assert_json_field "$ALIAS_SITE_RESPONSE" '.site.aliases | join(",")' "${ALIAS_WWW},${ALIAS_IN_DOMAIN}" "Site echoes its aliases" || true
assert_contains "$(echo "$ALIAS_SITE_RESPONSE" | jq -r '.message // empty' 2>/dev/null || echo "")" "$ALIAS_WWW" "Create message asks for an A record for every alias" || true

TAKEN_ALIAS_STATUS=$(api_post_status "sites" "{\"name\":\"e2ealiasb${RUN_ID}\",\"type\":\"custom\",\"customDomain\":\"e2e-aliasb-${RUN_ID}.test\",\"aliases\":[\"${ALIAS_WWW}\"]}")
assert_eq "$TAKEN_ALIAS_STATUS" "400" "Alias already served by another site rejected (HTTP 400)" || true

TAKEN_FQDN_STATUS=$(api_post_status "sites" "{\"name\":\"e2ealiasb${RUN_ID}\",\"type\":\"custom\",\"customDomain\":\"e2e-aliasb-${RUN_ID}.test\",\"aliases\":[\"${CUSTOM_DOMAIN}\"]}")
assert_eq "$TAKEN_FQDN_STATUS" "400" "Alias equal to another custom site's domain rejected (HTTP 400)" || true

ALIAS_AS_DOMAIN_STATUS=$(api_post_status "sites" "{\"name\":\"e2ealiasb${RUN_ID}\",\"type\":\"custom\",\"customDomain\":\"${ALIAS_WWW}\"}")
assert_eq "$ALIAS_AS_DOMAIN_STATUS" "400" "Domain already an alias of another site rejected (HTTP 400)" || true

# A tunnel cannot take a hostname a site or an alias already serves
TUNNEL_ON_ALIAS_RESPONSE=$(api_post "tunnels" "{\"subdomain\":\"${ALIAS_SUB}\",\"port\":19972,\"description\":\"alias collision\",\"agentLabel\":\"${ALIAS_AGENT_LABEL}\"}")
assert_contains "$(echo "$TUNNEL_ON_ALIAS_RESPONSE" | jq -r '.details // empty' 2>/dev/null || echo "")" "already served by a static site" "Tunnel on a site alias's hostname rejected" || true
TUNNEL_ON_ALIAS_STATUS=$(api_post_status "tunnels" "{\"subdomain\":\"${ALIAS_SUB}\",\"port\":19972,\"description\":\"alias collision\",\"agentLabel\":\"${ALIAS_AGENT_LABEL}\"}")
assert_eq "$TUNNEL_ON_ALIAS_STATUS" "400" "Tunnel on a site alias's hostname returns HTTP 400" || true

TUNNEL_ON_SITE_STATUS=$(api_post_status "tunnels" "{\"subdomain\":\"${SITE_NAME}\",\"port\":19973,\"description\":\"site collision\",\"agentLabel\":\"${ALIAS_AGENT_LABEL}\"}")
assert_eq "$TUNNEL_ON_SITE_STATUS" "400" "Tunnel on a managed site's hostname returns HTTP 400" || true

MANAGED_PATCH_STATUS=$(api_patch_status "sites/${SITE_ID}" "{\"aliases\":[\"${ALIAS_BLOG}\"]}")
assert_eq "$MANAGED_PATCH_STATUS" "400" "PATCH aliases on a managed site rejected (HTTP 400)" || true

BAD_PATCH_STATUS=$(api_patch_status "sites/${ALIAS_SITE_ID}" '{"aliases":["panel.'"${DOMAIN}"'"]}')
assert_eq "$BAD_PATCH_STATUS" "400" "PATCH with a reserved alias rejected (HTTP 400)" || true
ALIASES_AFTER_BAD=$(api_get "sites" | jq -r --arg id "$ALIAS_SITE_ID" '.sites[] | select(.id == $id) | .aliases | join(",")' 2>/dev/null || echo "")
assert_eq "$ALIASES_AFTER_BAD" "${ALIAS_WWW},${ALIAS_IN_DOMAIN}" "Rejected PATCH left the aliases unchanged" || true

# ---------------------------------------------------------------------------
log_section "Custom site aliases: verify DNS, certificate and redirect"
# ---------------------------------------------------------------------------

# Resolve the custom domain and every name under it to this server, the same
# way setup-host.sh points the Lamaste domain at it
echo "address=/${CUSTOM_DOMAIN}/${SERVER_IP}" | sudo tee "$ALIAS_DNSMASQ_CONF" > /dev/null
sudo systemctl restart dnsmasq 2>/dev/null || true
sleep 1
RESOLVED_WWW=$(getent ahostsv4 "$ALIAS_WWW" 2>/dev/null | awk 'NR==1 {print $1}' || echo "")

if [ -z "$ALIAS_SITE_ID" ]; then
  log_skip "Custom site with aliases was not created — skipping live alias checks"
elif [ -z "$SERVER_IP" ] || [ "$RESOLVED_WWW" != "$SERVER_IP" ]; then
  log_skip "dnsmasq does not resolve ${ALIAS_WWW} to ${SERVER_IP} (got '${RESOLVED_WWW}') — skipping live alias checks"
else
  VERIFY_RESPONSE=$(api_post "sites/${ALIAS_SITE_ID}/verify-dns")
  assert_json_field "$VERIFY_RESPONSE" '.ok' 'true' "verify-dns succeeds once the domain and every alias resolve here" || true

  LINEAGE="/etc/letsencrypt/live/${CUSTOM_DOMAIN}/fullchain.pem"
  SAN=$(sudo openssl x509 -noout -ext subjectAltName -in "$LINEAGE" 2>/dev/null || echo "")
  assert_contains "$SAN" "DNS:${CUSTOM_DOMAIN}" "Certificate lineage covers the site's domain" || true
  assert_contains "$SAN" "DNS:${ALIAS_WWW}" "Certificate lineage covers ${ALIAS_WWW}" || true
  assert_contains "$SAN" "DNS:${ALIAS_IN_DOMAIN}" "Certificate lineage covers ${ALIAS_IN_DOMAIN}" || true

  SITE_VHOST="/etc/nginx/sites-available/lamalibre-lamaste-site-${ALIAS_SITE_ID}"
  VHOST_CONTENT=$(sudo cat "$SITE_VHOST" 2>/dev/null || echo "")
  assert_contains "$VHOST_CONTENT" "server_name ${ALIAS_WWW} ${ALIAS_IN_DOMAIN};" "Vhost has a server block for the aliases" || true
  assert_contains "$VHOST_CONTENT" "return 301 https://${CUSTOM_DOMAIN}\$request_uri;" "Alias server block 301s to the site's domain" || true

  NGINX_TEST=$(sudo nginx -t 2>&1 || true)
  assert_contains "$NGINX_TEST" "syntax is ok" "nginx -t passes with the alias redirect block" || true

  REDIRECT=$(redirect_after_reload "${ALIAS_WWW}" "/docs/page?x=1" "301 https://${CUSTOM_DOMAIN}/docs/page?x=1")
  assert_eq "$REDIRECT" "301 https://${CUSTOM_DOMAIN}/docs/page?x=1" "Alias answers 301 to the same path on the site's domain" || true

  # A new alias that does not resolve here is refused and nothing changes
  UNRESOLVED_PATCH_STATUS=$(api_patch_status "sites/${ALIAS_SITE_ID}" "{\"aliases\":[\"${ALIAS_WWW}\",\"${ALIAS_IN_DOMAIN}\",\"${ALIAS_UNRESOLVED}\"]}")
  assert_eq "$UNRESOLVED_PATCH_STATUS" "400" "Adding an alias that does not resolve here rejected (HTTP 400)" || true
  UNRESOLVED_PATCH_RESPONSE=$(api_patch "sites/${ALIAS_SITE_ID}" "{\"aliases\":[\"${ALIAS_WWW}\",\"${ALIAS_IN_DOMAIN}\",\"${ALIAS_UNRESOLVED}\"]}")
  assert_contains "$(echo "$UNRESOLVED_PATCH_RESPONSE" | jq -r '.details // empty' 2>/dev/null || echo "")" "$ALIAS_UNRESOLVED" "Rejection names the alias that must resolve first" || true
  ALIASES_AFTER_UNRESOLVED=$(api_get "sites" | jq -r --arg id "$ALIAS_SITE_ID" '.sites[] | select(.id == $id) | .aliases | join(",")' 2>/dev/null || echo "")
  assert_eq "$ALIASES_AFTER_UNRESOLVED" "${ALIAS_WWW},${ALIAS_IN_DOMAIN}" "Aliases unchanged after the rejected PATCH" || true
  SAN_AFTER_UNRESOLVED=$(sudo openssl x509 -noout -ext subjectAltName -in "$LINEAGE" 2>/dev/null || echo "")
  assert_not_contains "$SAN_AFTER_UNRESOLVED" "$ALIAS_UNRESOLVED" "Certificate not re-issued for the rejected alias" || true

  # A resolving alias is added to the certificate and to the redirect block.
  # The certbot shim logs every call's argv (the lamaste-certbot wrapper's
  # exact shape), so the issue sequence can be checked.
  CALLS_BEFORE_ADD=$(sudo cat "$CERTBOT_CALLS" 2>/dev/null | wc -l | tr -d ' ')
  ADD_PATCH_RESPONSE=$(api_patch "sites/${ALIAS_SITE_ID}" "{\"aliases\":[\"${ALIAS_WWW}\",\"${ALIAS_IN_DOMAIN}\",\"${ALIAS_BLOG}\"]}")
  assert_json_field "$ADD_PATCH_RESPONSE" '.ok' 'true' "Adding a resolving alias to a live site succeeds" || true
  SAN_AFTER_ADD=$(sudo openssl x509 -noout -ext subjectAltName -in "$LINEAGE" 2>/dev/null || echo "")
  assert_contains "$SAN_AFTER_ADD" "DNS:${ALIAS_BLOG}" "Certificate re-issued to cover ${ALIAS_BLOG}" || true
  ADD_ISSUES=$(sudo tail -n +$((CALLS_BEFORE_ADD + 1)) "$CERTBOT_CALLS" 2>/dev/null | grep ' certonly ' || true)
  assert_eq "$(echo "$ADD_ISSUES" | grep -c ' certonly ' || true)" "1" "Adding an alias issues the certificate once" || true
  assert_contains "$ADD_ISSUES" "--cert-name ${CUSTOM_DOMAIN} " "The issue keeps the site's lineage (--cert-name ${CUSTOM_DOMAIN})" || true
  BLOG_REDIRECT=$(redirect_after_reload "${ALIAS_BLOG}" "/" "301 https://${CUSTOM_DOMAIN}/")
  assert_eq "$BLOG_REDIRECT" "301 https://${CUSTOM_DOMAIN}/" "New alias answers 301 to the site's domain" || true

  # Swapping aliases (adding one while removing others) keeps the live site
  # served throughout: the certificate is first issued for the union of the
  # old and new names, then re-issued for exactly the new set
  CALLS_BEFORE_SWAP=$(sudo cat "$CERTBOT_CALLS" 2>/dev/null | wc -l | tr -d ' ')
  SWAP_PATCH_RESPONSE=$(api_patch "sites/${ALIAS_SITE_ID}" "{\"aliases\":[\"${ALIAS_WWW}\",\"${ALIAS_SHOP}\"]}")
  assert_json_field "$SWAP_PATCH_RESPONSE" '.site.aliases | join(",")' "${ALIAS_WWW},${ALIAS_SHOP}" "Aliases swapped to ${ALIAS_WWW},${ALIAS_SHOP}" || true
  SWAP_ISSUES=$(sudo tail -n +$((CALLS_BEFORE_SWAP + 1)) "$CERTBOT_CALLS" 2>/dev/null | grep ' certonly ' || true)
  assert_eq "$(echo "$SWAP_ISSUES" | grep -c ' certonly ' || true)" "2" "Swapping aliases issues the certificate twice (union, then exact)" || true
  UNION_ISSUE=$(echo "$SWAP_ISSUES" | sed -n '1p')
  EXACT_ISSUE=$(echo "$SWAP_ISSUES" | sed -n '2p')
  for name in "$CUSTOM_DOMAIN" "$ALIAS_WWW" "$ALIAS_IN_DOMAIN" "$ALIAS_BLOG" "$ALIAS_SHOP"; do
    assert_contains "$UNION_ISSUE " "-d ${name} " "First issue covers the union of old and new names: ${name}" || true
  done
  for name in "$CUSTOM_DOMAIN" "$ALIAS_WWW" "$ALIAS_SHOP"; do
    assert_contains "$EXACT_ISSUE " "-d ${name} " "Second issue covers the new set: ${name}" || true
  done
  for name in "$ALIAS_IN_DOMAIN" "$ALIAS_BLOG"; do
    assert_not_contains "$EXACT_ISSUE " "-d ${name} " "Second issue drops the removed alias ${name}" || true
  done
  for issue in "$UNION_ISSUE" "$EXACT_ISSUE"; do
    assert_contains "$issue " "--cert-name ${CUSTOM_DOMAIN} " "Every issue names the site's lineage (--cert-name ${CUSTOM_DOMAIN})" || true
  done
  SAN_AFTER_SWAP=$(sudo openssl x509 -noout -ext subjectAltName -in "$LINEAGE" 2>/dev/null || echo "")
  assert_contains "$SAN_AFTER_SWAP" "DNS:${ALIAS_SHOP}" "Certificate covers the added alias ${ALIAS_SHOP}" || true
  assert_not_contains "$SAN_AFTER_SWAP" "DNS:${ALIAS_BLOG}" "Certificate no longer names the removed alias ${ALIAS_BLOG}" || true
  assert_not_contains "$SAN_AFTER_SWAP" "DNS:${ALIAS_IN_DOMAIN}" "Certificate no longer names the removed alias ${ALIAS_IN_DOMAIN}" || true

  # Removing an alias only needs no union step: one issue for exactly the new
  # set, and the alias drops out of the redirect block
  CALLS_BEFORE_REMOVE=$(sudo cat "$CERTBOT_CALLS" 2>/dev/null | wc -l | tr -d ' ')
  REMOVE_PATCH_RESPONSE=$(api_patch "sites/${ALIAS_SITE_ID}" "{\"aliases\":[\"${ALIAS_WWW}\"]}")
  assert_json_field "$REMOVE_PATCH_RESPONSE" '.site.aliases | join(",")' "$ALIAS_WWW" "Alias list shrunk to ${ALIAS_WWW}" || true
  VHOST_AFTER_REMOVE=$(sudo cat "$SITE_VHOST" 2>/dev/null || echo "")
  assert_contains "$VHOST_AFTER_REMOVE" "server_name ${ALIAS_WWW};" "Redirect block now names only ${ALIAS_WWW}" || true
  assert_not_contains "$VHOST_AFTER_REMOVE" "$ALIAS_SHOP" "Removed alias gone from the vhost" || true

  REMOVE_ISSUES=$(sudo tail -n +$((CALLS_BEFORE_REMOVE + 1)) "$CERTBOT_CALLS" 2>/dev/null | grep ' certonly ' || true)
  assert_eq "$(echo "$REMOVE_ISSUES" | grep -c ' certonly ' || true)" "1" "Removing an alias re-issues the certificate once, for exactly the new set" || true
  assert_contains "$REMOVE_ISSUES " "-d ${ALIAS_WWW} " "The re-issue keeps ${ALIAS_WWW}" || true
  assert_not_contains "$REMOVE_ISSUES " "-d ${ALIAS_SHOP} " "The re-issue drops ${ALIAS_SHOP}" || true
  SAN_AFTER_REMOVE=$(sudo openssl x509 -noout -ext subjectAltName -in "$LINEAGE" 2>/dev/null || echo "")
  assert_contains "$SAN_AFTER_REMOVE" "DNS:${CUSTOM_DOMAIN}" "Certificate still covers the site's domain" || true
  assert_contains "$SAN_AFTER_REMOVE" "DNS:${ALIAS_WWW}" "Certificate still covers ${ALIAS_WWW}" || true
  assert_not_contains "$SAN_AFTER_REMOVE" "DNS:${ALIAS_SHOP}" "Certificate no longer names the removed alias ${ALIAS_SHOP}" || true
fi

# ---------------------------------------------------------------------------
log_section "Custom site aliases: teardown"
# ---------------------------------------------------------------------------

if [ -n "$ALIAS_SITE_ID" ]; then
  ALIAS_DELETE=$(api_delete "sites/${ALIAS_SITE_ID}")
  assert_json_field "$ALIAS_DELETE" '.ok' 'true' "Custom site with aliases deleted" || true
  ALIAS_SITE_ID=""
fi
if [ -n "$ALIAS_TUNNEL_ID" ]; then
  api_delete "tunnels/${ALIAS_TUNNEL_ID}" > /dev/null 2>&1 || true
  ALIAS_TUNNEL_ID=""
fi
api_delete "certs/agent/${ALIAS_AGENT_LABEL}" > /dev/null 2>&1 || true
sudo rm -f "$ALIAS_DNSMASQ_CONF" 2>/dev/null || true
sudo systemctl restart dnsmasq 2>/dev/null || true
log_pass "Alias test resources removed"

# ---------------------------------------------------------------------------
log_section "Delete site"
# ---------------------------------------------------------------------------

# Remove trap so cleanup doesn't double-delete
trap - EXIT
DELETE_RESPONSE=$(api_delete "sites/${SITE_ID}")
assert_json_field "$DELETE_RESPONSE" '.ok' 'true' "Site deletion returned ok: true" || true

# ---------------------------------------------------------------------------
log_section "Verify site removed"
# ---------------------------------------------------------------------------

SITES_AFTER_DELETE=$(api_get "sites")
FOUND_DELETED_SITE=$(echo "$SITES_AFTER_DELETE" | jq -r ".sites[] | select(.id == \"${SITE_ID}\") | .name" 2>/dev/null || echo "")
assert_eq "$FOUND_DELETED_SITE" "" "Deleted site no longer in listing" || true

# Non-existent site returns 404
GONE_STATUS=$(api_get_status "sites/${SITE_ID}/files?path=.")
assert_eq "$GONE_STATUS" "404" "Deleted site returns 404" || true

end_test

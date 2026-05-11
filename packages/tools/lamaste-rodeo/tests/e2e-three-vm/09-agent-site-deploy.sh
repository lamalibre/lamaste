#!/usr/bin/env bash
# ============================================================================
# 09 — Agent Site Deploy (Three-VM)
# ============================================================================
# Verifies the per-site scoped access model for agent certificates:
#
# 1. On host: admin creates a managed site via POST /api/sites
# 2. On host: generate agent cert with sites capabilities + allowedSites
# 3. From host (using agent cert): upload test HTML file
# 4. From host (using agent cert): list files
# 5. From visitor VM: verify site is accessible and returns uploaded content
# 6. From host (admin cert): delete site
# 7. Verify cleanup (site gone from listing)
# 8. Negative test: agent WITHOUT the site in allowedSites gets 403 on upload
# 9. Verify agent with sites:read + allowedSites sees only assigned sites
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../e2e/helpers.sh"

require_commands multipass curl jq

# ---------------------------------------------------------------------------
# VM exec helpers
# ---------------------------------------------------------------------------

host_exec() { multipass exec lamaste-host -- sudo bash -c "$1"; }
visitor_exec() { multipass exec lamaste-visitor -- sudo bash -c "$1"; }

host_api_get() {
  host_exec "curl -skf --max-time 30 --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key --cacert /etc/lamalibre/lamaste/pki/ca.crt -H 'Accept: application/json' https://127.0.0.1:9292/api/$1"
}

host_api_post() {
  host_exec "curl -skf --max-time 30 --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key --cacert /etc/lamalibre/lamaste/pki/ca.crt -X POST -H 'Content-Type: application/json' -H 'Accept: application/json' -d '$2' https://127.0.0.1:9292/api/$1"
}

host_api_delete() {
  host_exec "curl -skf --max-time 30 --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key --cacert /etc/lamalibre/lamaste/pki/ca.crt -X DELETE -H 'Accept: application/json' https://127.0.0.1:9292/api/$1"
}

# Agent cert API helpers — use extracted PEM cert/key from the agent's .p12
host_agent_api_get() {
  local cert_path="$1"
  local key_path="$2"
  local api_path="$3"
  host_exec "curl -skf --max-time 30 --cert ${cert_path} --key ${key_path} --cacert /etc/lamalibre/lamaste/pki/ca.crt -H 'Accept: application/json' https://127.0.0.1:9292/api/${api_path}"
}

host_agent_api_upload() {
  local cert_path="$1"
  local key_path="$2"
  local api_path="$3"
  local file_path="$4"
  host_exec "curl -skf --max-time 30 --cert ${cert_path} --key ${key_path} --cacert /etc/lamalibre/lamaste/pki/ca.crt -X POST -F 'file=@${file_path}' -H 'Accept: application/json' https://127.0.0.1:9292/api/${api_path}"
}

host_agent_api_upload_status() {
  local cert_path="$1"
  local key_path="$2"
  local api_path="$3"
  local file_path="$4"
  host_exec "curl -sk -o /dev/null -w '%{http_code}' --max-time 30 --cert ${cert_path} --key ${key_path} --cacert /etc/lamalibre/lamaste/pki/ca.crt -X POST -F 'file=@${file_path}' -H 'Accept: application/json' https://127.0.0.1:9292/api/${api_path}" 2>/dev/null || echo "000"
}

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

SITE_NAME="e2esite"
SITE_ID=""
SITE_FQDN=""
AGENT_LABEL="site-agent"
AGENT_CERT_PATH=""
AGENT_KEY_PATH=""
NOPERM_LABEL="site-agent-noperm"
NOPERM_CERT_PATH=""
NOPERM_KEY_PATH=""
NOPERM_SITE_ID=""
MARKER="E2E_AGENT_SITE_$(date +%s)"

begin_test "09 — Agent Site Deploy (Three-VM)"

# ---------------------------------------------------------------------------
# Cleanup function — always runs on exit
# ---------------------------------------------------------------------------

cleanup() {
  log_info "Cleaning up test resources..."
  visitor_exec "sed -i '/${SITE_NAME}/d' /etc/hosts 2>/dev/null || true" 2>/dev/null || true
  if [ -n "$SITE_ID" ] && [ "$SITE_ID" != "null" ]; then
    host_api_delete "sites/${SITE_ID}" 2>/dev/null || true
  fi
  if [ -n "$NOPERM_SITE_ID" ] && [ "$NOPERM_SITE_ID" != "null" ]; then
    host_api_delete "sites/${NOPERM_SITE_ID}" 2>/dev/null || true
  fi
  # Revoke agent certs via DELETE /api/certs/agent/:label
  host_api_delete "certs/agent/${AGENT_LABEL}" 2>/dev/null || true
  host_api_delete "certs/agent/${NOPERM_LABEL}" 2>/dev/null || true
  # Clean up extracted PEM files
  host_exec "rm -f /tmp/e2e-agent-site-*.pem /tmp/e2e-agent-site-*.html /tmp/index.html 2>/dev/null || true" 2>/dev/null || true
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
log_section "Pre-flight: verify onboarding is complete"
# ---------------------------------------------------------------------------

ONBOARDING_STATUS=$(host_api_get "onboarding/status" | jq -r '.status' 2>/dev/null || echo "unknown")
if [ "$ONBOARDING_STATUS" != "COMPLETED" ]; then
  log_skip "Onboarding not completed (status: $ONBOARDING_STATUS). Skipping agent site deploy tests."
  end_test
  exit $?
fi

# ---------------------------------------------------------------------------
log_section "Create managed site using admin cert"
# ---------------------------------------------------------------------------

CREATE_RESPONSE=$(host_api_post "sites" '{"name":"'"${SITE_NAME}"'","type":"managed","spaMode":false,"autheliaProtected":false}')
assert_json_field "$CREATE_RESPONSE" '.ok' 'true' "Site creation via admin cert returned ok: true" || true

SITE_ID=$(echo "$CREATE_RESPONSE" | jq -r '.site.id' 2>/dev/null || echo "")
assert_json_field_not_empty "$CREATE_RESPONSE" '.site.id' "Site has an ID" || true

SITE_FQDN=$(echo "$CREATE_RESPONSE" | jq -r '.site.fqdn' 2>/dev/null || echo "")
assert_json_field_not_empty "$CREATE_RESPONSE" '.site.fqdn' "Site has an FQDN" || true

log_info "Created site: ${SITE_FQDN} (ID: ${SITE_ID})"

# ---------------------------------------------------------------------------
log_section "Generate agent cert with sites capabilities and allowedSites"
# ---------------------------------------------------------------------------

# POST /api/certs/agent returns { ok, label, p12Password, serial, expiresAt }
# P12 file is at /etc/lamalibre/lamaste/pki/agents/<label>/client.p12
CERT_RESPONSE=$(host_api_post "certs/agent" '{"label":"'"${AGENT_LABEL}"'","capabilities":["tunnels:read","sites:read","sites:write"],"allowedSites":["'"${SITE_NAME}"'"]}')
assert_json_field "$CERT_RESPONSE" '.ok' 'true' "Agent cert creation returned ok: true" || true

P12_PASSWORD=$(echo "$CERT_RESPONSE" | jq -r '.p12Password' 2>/dev/null || echo "")
assert_json_field_not_empty "$CERT_RESPONSE" '.p12Password' "Agent cert has a p12 password" || true
assert_json_field "$CERT_RESPONSE" '.label' "$AGENT_LABEL" "Agent cert label matches" || true

log_info "Created agent cert: ${AGENT_LABEL} (allowedSites: [${SITE_NAME}])"

# Extract PEM cert and key from .p12 for use with curl
P12_PATH="/etc/lamalibre/lamaste/pki/agents/${AGENT_LABEL}/client.p12"
AGENT_CERT_PATH="/tmp/e2e-agent-site-cert.pem"
AGENT_KEY_PATH="/tmp/e2e-agent-site-key.pem"
host_exec "openssl pkcs12 -in '${P12_PATH}' -clcerts -nokeys -out '${AGENT_CERT_PATH}' -passin 'pass:${P12_PASSWORD}' -legacy 2>/dev/null || openssl pkcs12 -in '${P12_PATH}' -clcerts -nokeys -out '${AGENT_CERT_PATH}' -passin 'pass:${P12_PASSWORD}'"
host_exec "openssl pkcs12 -in '${P12_PATH}' -nocerts -nodes -out '${AGENT_KEY_PATH}' -passin 'pass:${P12_PASSWORD}' -legacy 2>/dev/null || openssl pkcs12 -in '${P12_PATH}' -nocerts -nodes -out '${AGENT_KEY_PATH}' -passin 'pass:${P12_PASSWORD}'"

log_pass "Extracted PEM cert and key from .p12"

# ---------------------------------------------------------------------------
log_section "Upload test HTML file using agent cert"
# ---------------------------------------------------------------------------

# Create a test HTML file on the host (named index.html to overwrite the default)
host_exec "echo '<html><body><h1>${MARKER}</h1></body></html>' > /tmp/e2e-agent-site-upload.html"

# Upload as index.html by renaming before upload
host_exec "cp /tmp/e2e-agent-site-upload.html /tmp/index.html"
UPLOAD_RESPONSE=$(host_agent_api_upload "$AGENT_CERT_PATH" "$AGENT_KEY_PATH" "sites/${SITE_ID}/files?path=." "/tmp/index.html")
assert_json_field "$UPLOAD_RESPONSE" '.ok' 'true' "File upload via agent cert returned ok: true" || true

# ---------------------------------------------------------------------------
log_section "Verify site listing using agent cert (sites:read + allowedSites)"
# ---------------------------------------------------------------------------

LIST_RESPONSE=$(host_agent_api_get "$AGENT_CERT_PATH" "$AGENT_KEY_PATH" "sites")
FOUND_SITE=$(echo "$LIST_RESPONSE" | jq -r ".sites[] | select(.id == \"${SITE_ID}\") | .name" 2>/dev/null || echo "")
assert_eq "$FOUND_SITE" "$SITE_NAME" "Agent can list sites and find assigned site" || true

# Agent should only see sites in its allowedSites list
SITE_COUNT=$(echo "$LIST_RESPONSE" | jq '.sites | length' 2>/dev/null || echo "0")
assert_eq "$SITE_COUNT" "1" "Agent sees only its assigned site (count: 1)" || true

# ---------------------------------------------------------------------------
log_section "Verify site accessible from visitor VM"
# ---------------------------------------------------------------------------

# Add /etc/hosts entry on visitor for the site subdomain
visitor_exec "grep -q '${SITE_FQDN}' /etc/hosts || echo '${HOST_IP} ${SITE_FQDN}' >> /etc/hosts"

# Wait for nginx to settle after site creation
sleep 2

VISITOR_STATUS=$(visitor_exec "curl -sk -o /dev/null -w '%{http_code}' --max-time 15 https://${SITE_FQDN}/ 2>/dev/null" || echo "000")
assert_eq "$VISITOR_STATUS" "200" "Site returns HTTP 200 from visitor VM" || true

VISITOR_CONTENT=$(visitor_exec "curl -sk --max-time 15 https://${SITE_FQDN}/ 2>/dev/null" || echo "")
assert_contains "$VISITOR_CONTENT" "$MARKER" "Site content matches uploaded HTML from visitor VM" || true

# ---------------------------------------------------------------------------
log_section "File extension validation — disallowed extensions rejected"
# ---------------------------------------------------------------------------

# Create a .php file on the host
host_exec "echo '<?php echo 1; ?>' > /tmp/e2e-agent-site-blocked.php"

# Attempt to upload .php via agent cert — should fail with 400
PHP_UPLOAD_STATUS=$(host_agent_api_upload_status "$AGENT_CERT_PATH" "$AGENT_KEY_PATH" "sites/${SITE_ID}/files?path=." "/tmp/e2e-agent-site-blocked.php")
assert_eq "$PHP_UPLOAD_STATUS" "400" "Upload of .php file rejected with 400" || true

# Create a .exe file on the host
host_exec "echo 'MZ' > /tmp/e2e-agent-site-blocked.exe"

# Attempt to upload .exe via agent cert — should fail with 400
EXE_UPLOAD_STATUS=$(host_agent_api_upload_status "$AGENT_CERT_PATH" "$AGENT_KEY_PATH" "sites/${SITE_ID}/files?path=." "/tmp/e2e-agent-site-blocked.exe")
assert_eq "$EXE_UPLOAD_STATUS" "400" "Upload of .exe file rejected with 400" || true

# Allowed extension (.css) — should succeed via agent cert
host_exec "echo 'body { color: red; }' > /tmp/e2e-agent-site-allowed.css"
CSS_UPLOAD_RESPONSE=$(host_agent_api_upload "$AGENT_CERT_PATH" "$AGENT_KEY_PATH" "sites/${SITE_ID}/files?path=." "/tmp/e2e-agent-site-allowed.css")
assert_json_field "$CSS_UPLOAD_RESPONSE" '.ok' 'true' "Upload of .css file succeeds via agent cert" || true

# Clean up test files
host_exec "rm -f /tmp/e2e-agent-site-blocked.php /tmp/e2e-agent-site-blocked.exe /tmp/e2e-agent-site-allowed.css" 2>/dev/null || true

# ---------------------------------------------------------------------------
log_section "Delete site using admin cert (site CRUD is admin-only)"
# ---------------------------------------------------------------------------

SITE_ID_TO_DELETE="$SITE_ID"
SITE_ID=""  # Clear so cleanup doesn't double-delete

DELETE_RESPONSE=$(host_api_delete "sites/${SITE_ID_TO_DELETE}")
assert_json_field "$DELETE_RESPONSE" '.ok' 'true' "Site deletion via admin cert returned ok: true" || true

# Verify site is gone from listing (admin view)
LIST_AFTER_DELETE=$(host_api_get "sites")
FOUND_DELETED=$(echo "$LIST_AFTER_DELETE" | jq -r ".sites[] | select(.id == \"${SITE_ID_TO_DELETE}\") | .name" 2>/dev/null || echo "")
assert_eq "$FOUND_DELETED" "" "Deleted site no longer in listing" || true

# ---------------------------------------------------------------------------
log_section "Negative test: agent WITHOUT site in allowedSites gets 403 on file upload"
# ---------------------------------------------------------------------------

# Create a new site for the negative test (admin-only)
NOPERM_SITE_NAME="e2enoperm"
NOPERM_SITE_RESPONSE=$(host_api_post "sites" '{"name":"'"${NOPERM_SITE_NAME}"'","type":"managed","spaMode":false,"autheliaProtected":false}')
NOPERM_SITE_ID=$(echo "$NOPERM_SITE_RESPONSE" | jq -r '.site.id' 2>/dev/null || echo "")

# Create an agent cert with sites:write but WITHOUT this site in allowedSites
NOPERM_RESPONSE=$(host_api_post "certs/agent" '{"label":"'"${NOPERM_LABEL}"'","capabilities":["tunnels:read","sites:read","sites:write"],"allowedSites":["some-other-site"]}')
assert_json_field "$NOPERM_RESPONSE" '.ok' 'true' "No-perm agent cert creation returned ok: true" || true

NOPERM_P12_PASSWORD=$(echo "$NOPERM_RESPONSE" | jq -r '.p12Password' 2>/dev/null || echo "")
NOPERM_P12_PATH="/etc/lamalibre/lamaste/pki/agents/${NOPERM_LABEL}/client.p12"

# Extract PEM cert and key
NOPERM_CERT_PATH="/tmp/e2e-agent-site-noperm-cert.pem"
NOPERM_KEY_PATH="/tmp/e2e-agent-site-noperm-key.pem"
host_exec "openssl pkcs12 -in '${NOPERM_P12_PATH}' -clcerts -nokeys -out '${NOPERM_CERT_PATH}' -passin 'pass:${NOPERM_P12_PASSWORD}' -legacy 2>/dev/null || openssl pkcs12 -in '${NOPERM_P12_PATH}' -clcerts -nokeys -out '${NOPERM_CERT_PATH}' -passin 'pass:${NOPERM_P12_PASSWORD}'"
host_exec "openssl pkcs12 -in '${NOPERM_P12_PATH}' -nocerts -nodes -out '${NOPERM_KEY_PATH}' -passin 'pass:${NOPERM_P12_PASSWORD}' -legacy 2>/dev/null || openssl pkcs12 -in '${NOPERM_P12_PATH}' -nocerts -nodes -out '${NOPERM_KEY_PATH}' -passin 'pass:${NOPERM_P12_PASSWORD}'"

# Create a test file for the upload attempt
host_exec "echo '<html><body>noperm test</body></html>' > /tmp/e2e-agent-site-noperm.html"

# Attempt to upload a file to a site NOT in the agent's allowedSites — should fail with 403
NOPERM_UPLOAD_STATUS=$(host_agent_api_upload_status "$NOPERM_CERT_PATH" "$NOPERM_KEY_PATH" "sites/${NOPERM_SITE_ID}/files?path=." "/tmp/e2e-agent-site-noperm.html")
assert_eq "$NOPERM_UPLOAD_STATUS" "403" "Agent without site in allowedSites rejected with 403 on file upload" || true

# Verify agent with sites:read sees only its assigned sites (not the noperm site)
NOPERM_LIST=$(host_agent_api_get "$NOPERM_CERT_PATH" "$NOPERM_KEY_PATH" "sites")
NOPERM_LIST_COUNT=$(echo "$NOPERM_LIST" | jq '.sites | length' 2>/dev/null || echo "")
# Agent's allowedSites is ["some-other-site"] which doesn't match any real site
assert_eq "$NOPERM_LIST_COUNT" "0" "Agent sees only assigned sites (none match real sites)" || true

# Clean up negative test site (cleanup trap will also handle this)
NOPERM_SITE_ID_TO_DELETE="$NOPERM_SITE_ID"
NOPERM_SITE_ID=""
host_api_delete "sites/${NOPERM_SITE_ID_TO_DELETE}" 2>/dev/null || true

end_test

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
# ============================================================================

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/helpers.sh"

require_commands curl jq

begin_test "13 — Site Lifecycle"

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

# Cleanup function
cleanup() {
  if [ -n "$SITE_ID" ] && [ "$SITE_ID" != "null" ]; then
    api_delete "sites/${SITE_ID}" 2>/dev/null || true
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

#!/usr/bin/env bash
# ============================================================================
# 24 — Storage Servers and Bindings (Three-VM)
# ============================================================================
# 24 — Storage Servers and Bindings (Three-VM) — exercises /api/storage CRUD without real provider
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "/Users/onurdevrimvatan/lama/repositories/lamalibre/lamaste/packages/tools/lamaste-rodeo/tests/e2e/helpers.sh"

require_commands multipass curl jq

# ---------------------------------------------------------------------------
# VM exec helpers
# ---------------------------------------------------------------------------

host_exec() { multipass exec lamaste-host -- sudo bash -c "$1"; }

host_api_get() {
  host_exec "curl -skf --max-time 30 --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key --cacert /etc/lamalibre/lamaste/pki/ca.crt -H 'Accept: application/json' https://127.0.0.1:9292/api/$1"
}

host_api_post() {
  host_exec "curl -skf --max-time 30 --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key --cacert /etc/lamalibre/lamaste/pki/ca.crt -X POST -H 'Content-Type: application/json' -H 'Accept: application/json' -d '$2' https://127.0.0.1:9292/api/$1"
}

host_api_delete() {
  host_exec "curl -skf --max-time 30 --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key --cacert /etc/lamalibre/lamaste/pki/ca.crt -X DELETE -H 'Accept: application/json' https://127.0.0.1:9292/api/$1"
}

host_api_patch() {
  host_exec "curl -skf --max-time 30 --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key --cacert /etc/lamalibre/lamaste/pki/ca.crt -X PATCH -H 'Content-Type: application/json' -H 'Accept: application/json' -d '$2' https://127.0.0.1:9292/api/$1"
}

host_api_post_status() {
  host_exec "curl -sk --max-time 30 --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key --cacert /etc/lamalibre/lamaste/pki/ca.crt -X POST -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' -H 'Accept: application/json' -d '$2' https://127.0.0.1:9292/api/$1" 2>/dev/null || echo "000"
}

host_api_get_status() {
  host_exec "curl -sk --max-time 30 --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key --cacert /etc/lamalibre/lamaste/pki/ca.crt -X GET -o /dev/null -w '%{http_code}' -H 'Accept: application/json' https://127.0.0.1:9292/api/$1" 2>/dev/null || echo "000"
}

host_api_delete_status() {
  host_exec "curl -sk --max-time 30 --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key --cacert /etc/lamalibre/lamaste/pki/ca.crt -X DELETE -o /dev/null -w '%{http_code}' -H 'Accept: application/json' https://127.0.0.1:9292/api/$1" 2>/dev/null || echo "000"
}

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

STORAGE_LABEL="rodeo-test-storage"
STORAGE_PROVIDER="digitalocean-spaces"
STORAGE_REGION="nyc3"
STORAGE_BUCKET="rodeo-test-bucket"
STORAGE_ENDPOINT="https://nyc3.digitaloceanspaces.com"
STORAGE_ACCESS_KEY="FAKEACCESSKEY1234567890"
STORAGE_SECRET_KEY="FAKESECRETKEY1234567890ABCDEFGHIJKLMNOP"
MISSING_PLUGIN="nonexistent-plugin-24"

begin_test "24 — Storage Servers and Bindings (Three-VM)"

# ---------------------------------------------------------------------------
# Cleanup function — always runs on exit
# ---------------------------------------------------------------------------

cleanup() {
  log_info "Cleaning up test resources..."
  if [ -n "$BOUND_PLUGIN" ] && [ "$BOUND_PLUGIN" != "null" ]; then
    host_api_delete "storage/bindings/${BOUND_PLUGIN}" 2>/dev/null || true
  fi
  if [ -n "$STORAGE_ID" ] && [ "$STORAGE_ID" != "null" ]; then
    host_api_delete "storage/servers/${STORAGE_ID}" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
log_section "Initialize cleanup trap variables"
# ---------------------------------------------------------------------------

BOUND_PLUGIN=""
STORAGE_ID=""

# ---------------------------------------------------------------------------
log_section "Pre-flight: check onboarding is complete"
# ---------------------------------------------------------------------------

ONBOARDING_STATUS=$(host_api_get "onboarding/status" | jq -r '.status' 2>/dev/null || echo "")
assert_eq "$ONBOARDING_STATUS" "COMPLETED" "Onboarding is complete on host VM" || true

# ---------------------------------------------------------------------------
log_section "Generate UUID for storage server"
# ---------------------------------------------------------------------------

STORAGE_ID=$(host_exec "cat /proc/sys/kernel/random/uuid")
log_info "Generated storage server id: ${STORAGE_ID}"
if [ -n "$STORAGE_ID" ] && [ "$STORAGE_ID" != "null" ]; then log_pass "Generated storage server UUID is non-empty"; else log_fail "Generated storage server UUID is non-empty" || true; fi

# ---------------------------------------------------------------------------
log_section "Initial storage servers list"
# ---------------------------------------------------------------------------

INITIAL_SERVERS=$(host_api_get "storage/servers")
INITIAL_SERVERS_TYPE=$(echo "$INITIAL_SERVERS" | jq -r '.servers | type' 2>/dev/null || echo "")
assert_eq "$INITIAL_SERVERS_TYPE" "array" "Initial GET /api/storage/servers returns .servers as an array" || true

# ---------------------------------------------------------------------------
log_section "Register storage server (fake credentials)"
# ---------------------------------------------------------------------------

REGISTER_BODY=$(host_api_post "storage/servers" "{\"id\":\"${STORAGE_ID}\",\"label\":\"${STORAGE_LABEL}\",\"provider\":\"${STORAGE_PROVIDER}\",\"region\":\"${STORAGE_REGION}\",\"bucket\":\"${STORAGE_BUCKET}\",\"endpoint\":\"${STORAGE_ENDPOINT}\",\"accessKey\":\"${STORAGE_ACCESS_KEY}\",\"secretKey\":\"${STORAGE_SECRET_KEY}\"}")
assert_json_field "$REGISTER_BODY" '.id' "$STORAGE_ID" "POST /api/storage/servers response .id matches request id" || true
assert_json_field "$REGISTER_BODY" '.label' "$STORAGE_LABEL" "POST /api/storage/servers response .label matches request" || true
assert_json_field "$REGISTER_BODY" '.bucket' "$STORAGE_BUCKET" "POST /api/storage/servers response .bucket matches request" || true
assert_json_field_not_empty "$REGISTER_BODY" '.registeredAt' "POST /api/storage/servers response has .registeredAt" || true
assert_not_contains "$REGISTER_BODY" "$STORAGE_ACCESS_KEY" "POST /api/storage/servers response redacts accessKey" || true
assert_not_contains "$REGISTER_BODY" "$STORAGE_SECRET_KEY" "POST /api/storage/servers response redacts secretKey" || true

# ---------------------------------------------------------------------------
log_section "List after register includes new server"
# ---------------------------------------------------------------------------

SERVERS_AFTER=$(host_api_get "storage/servers")
FOUND_ID=$(echo "$SERVERS_AFTER" | jq -r --arg _storage_id_v "$STORAGE_ID" '.servers[] | select(.id == $_storage_id_v) | .id' 2>/dev/null || echo "")
assert_eq "$FOUND_ID" "$STORAGE_ID" "Newly registered server appears in GET /api/storage/servers" || true
assert_not_contains "$SERVERS_AFTER" "$STORAGE_ACCESS_KEY" "GET /api/storage/servers does not leak accessKey" || true

# ---------------------------------------------------------------------------
log_section "Duplicate register returns 409"
# ---------------------------------------------------------------------------

DUP_STATUS=$(host_api_post_status "storage/servers" "{\"id\":\"${STORAGE_ID}\",\"label\":\"${STORAGE_LABEL}\",\"provider\":\"${STORAGE_PROVIDER}\",\"region\":\"${STORAGE_REGION}\",\"bucket\":\"${STORAGE_BUCKET}\",\"endpoint\":\"${STORAGE_ENDPOINT}\",\"accessKey\":\"${STORAGE_ACCESS_KEY}\",\"secretKey\":\"${STORAGE_SECRET_KEY}\"}")
assert_eq "$DUP_STATUS" "409" "Re-registering same UUID returns 409 Conflict" || true

# ---------------------------------------------------------------------------
log_section "Invalid body returns 4xx"
# ---------------------------------------------------------------------------

INVALID_STATUS=$(host_api_post_status "storage/servers" "{\"id\":\"not-a-uuid\",\"label\":\"x\",\"provider\":\"p\",\"region\":\"r\",\"bucket\":\"b\",\"endpoint\":\"https://x.example.com\",\"accessKey\":\"a\",\"secretKey\":\"s\"}")
assert_eq "$INVALID_STATUS" "400" "POST /api/storage/servers with non-uuid id rejected with 4xx/5xx" || true

# ---------------------------------------------------------------------------
log_section "List bindings (initial)"
# ---------------------------------------------------------------------------

BINDINGS_INITIAL=$(host_api_get "storage/bindings")
BINDINGS_TYPE=$(echo "$BINDINGS_INITIAL" | jq -r '.bindings | type' 2>/dev/null || echo "")
assert_eq "$BINDINGS_TYPE" "array" "GET /api/storage/bindings returns .bindings as array" || true

# ---------------------------------------------------------------------------
log_section "Binding for missing plugin returns 404"
# ---------------------------------------------------------------------------

BIND_MISSING_STATUS=$(host_api_post_status "storage/bindings" "{\"pluginName\":\"${MISSING_PLUGIN}\",\"storageServerId\":\"${STORAGE_ID}\"}")
assert_eq "$BIND_MISSING_STATUS" "404" "POST /api/storage/bindings for plugin not in registry returns 404" || true

# ---------------------------------------------------------------------------
log_section "Binding with invalid plugin name returns 4xx"
# ---------------------------------------------------------------------------

BIND_BADNAME_STATUS=$(host_api_post_status "storage/bindings" "{\"pluginName\":\"Bad_Name\",\"storageServerId\":\"${STORAGE_ID}\"}")
assert_eq "$BIND_BADNAME_STATUS" "400" "POST /api/storage/bindings with invalid pluginName rejected with 4xx/5xx" || true

# ---------------------------------------------------------------------------
log_section "GET binding for unbound plugin returns 404"
# ---------------------------------------------------------------------------

GET_BINDING_STATUS=$(host_api_get_status "storage/bindings/${MISSING_PLUGIN}")
assert_eq "$GET_BINDING_STATUS" "404" "GET /api/storage/bindings/:pluginName for unbound plugin returns 404" || true

# ---------------------------------------------------------------------------
log_section "Delete storage server"
# ---------------------------------------------------------------------------

DELETE_RESULT=$(host_api_delete "storage/servers/${STORAGE_ID}")
assert_json_field "$DELETE_RESULT" '.ok' 'true' "DELETE /api/storage/servers/:id returns ok:true" || true
STORAGE_ID=""

# ---------------------------------------------------------------------------
log_section "Delete already-removed server returns 404"
# ---------------------------------------------------------------------------

GHOST_UUID=$(host_exec "cat /proc/sys/kernel/random/uuid")
DELETE_GHOST_STATUS=$(host_api_delete_status "storage/servers/${GHOST_UUID}")
assert_eq "$DELETE_GHOST_STATUS" "404" "DELETE /api/storage/servers/:id for unknown id returns 404" || true

end_test

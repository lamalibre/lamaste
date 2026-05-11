#!/usr/bin/env bash
# ============================================================================
# 27 — Enrollment Public Endpoints (Three-VM)
# ============================================================================
# 27 — Enrollment Public Endpoints (Three-VM)
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "/Users/onurdevrimvatan/lama/repositories/lamalibre/lamaste/packages/tools/lamaste-rodeo/tests/e2e/helpers.sh"

require_commands multipass curl jq openssl

# ---------------------------------------------------------------------------
# VM exec helpers
# ---------------------------------------------------------------------------

host_exec() { multipass exec lamaste-host -- sudo bash -c "$1"; }
agent_exec() { multipass exec lamaste-agent -- sudo bash -c "$1"; }

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

host_api_post_dual() {
  host_exec "curl -sk --max-time 30 --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key --cacert /etc/lamalibre/lamaste/pki/ca.crt -X POST -w '\n%{http_code}' -H 'Content-Type: application/json' -H 'Accept: application/json' -d '$2' https://127.0.0.1:9292/api/$1" 2>/dev/null || printf '\n000'
}

host_api_delete_dual() {
  host_exec "curl -sk --max-time 30 --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key --cacert /etc/lamalibre/lamaste/pki/ca.crt -X DELETE -w '\n%{http_code}' -H 'Accept: application/json' https://127.0.0.1:9292/api/$1" 2>/dev/null || printf '\n000'
}

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

TEST_LABEL="enroll-public-27"

begin_test "27 — Enrollment Public Endpoints (Three-VM)"

# ---------------------------------------------------------------------------
# Cleanup function — always runs on exit
# ---------------------------------------------------------------------------

cleanup() {
  log_info "Cleaning up test resources..."
  if [ "$ENROLL_OK" = "true" ]; then
    host_api_delete "certs/agent/${TEST_LABEL}" 2>/dev/null || true
  fi
  if [ -n "$LOOKUP_TOKEN" ] && [ "$LOOKUP_TOKEN" != "null" ]; then
    host_api_delete "certs/agent/enroll/${TEST_LABEL}-lookup" 2>/dev/null || true
  fi
  agent_exec "rm -f /tmp/enroll-27.key /tmp/enroll-27.csr /tmp/enroll-27-body.json" 2>/dev/null || true
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
log_section "Initialize cleanup-referenced variables"
# ---------------------------------------------------------------------------

ENROLL_OK=""
LOOKUP_TOKEN=""

# ---------------------------------------------------------------------------
log_section "Pre-flight: onboarding complete"
# ---------------------------------------------------------------------------

ONBOARDING=$(host_api_get "onboarding/status")
ONBOARDING_STATUS=$(echo "$ONBOARDING" | jq -r '.status' 2>/dev/null || echo "")
assert_eq "$ONBOARDING_STATUS" "COMPLETED" "Onboarding is COMPLETED"

# ---------------------------------------------------------------------------
log_section "Admin creates enrollment token for enroll-public-27"
# ---------------------------------------------------------------------------

_DUAL_CT_1=$(host_api_post_dual "certs/agent/enroll" "{\"label\":\"${TEST_LABEL}\",\"capabilities\":[\"tunnels:read\"]}")
TOKEN_RESPONSE=$(printf '%s' "$_DUAL_CT_1" | sed '$d')
TOKEN_STATUS=$(printf '%s' "$_DUAL_CT_1" | tail -n1)
assert_eq "$TOKEN_STATUS" "200" "POST /certs/agent/enroll returns 200" || true
assert_json_field "$TOKEN_RESPONSE" '.ok' 'true' "Token response ok=true" || true
ENROLL_TOKEN=$(echo "$TOKEN_RESPONSE" | jq -r '.token // ""' 2>/dev/null || echo "")
assert_not_eq "$ENROLL_TOKEN" "" "Enrollment token value is non-empty" || true

# ---------------------------------------------------------------------------
log_section "Generate CSR on agent VM"
# ---------------------------------------------------------------------------

agent_exec "openssl genrsa -out /tmp/enroll-27.key 2048 2>/dev/null"
agent_exec "openssl req -new -key /tmp/enroll-27.key -out /tmp/enroll-27.csr -subj '/CN=agent:enroll-public-27/O=Lamaste' 2>/dev/null"
CSR_PEM=$(multipass exec lamaste-agent -- cat /tmp/enroll-27.csr)
assert_contains "$CSR_PEM" "" "CSR contains BEGIN CERTIFICATE REQUEST marker" || true

# ---------------------------------------------------------------------------
log_section "POST /api/enroll/ from agent VM without mTLS"
# ---------------------------------------------------------------------------

ENROLL_BODY=$(jq -n --arg token "$ENROLL_TOKEN" --arg csr "$CSR_PEM" '{token:$token, csr:$csr}')
LOCAL_TMP=$(mktemp /tmp/enroll-27-body-XXXXXXXX.json); echo "$ENROLL_BODY" > "$LOCAL_TMP"; multipass transfer "$LOCAL_TMP" lamaste-agent:/tmp/enroll-27-body.json; rm -f "$LOCAL_TMP"; echo done
ENROLL_RESPONSE=$(multipass exec lamaste-agent -- curl -sk --max-time 60 -X POST -H 'Content-Type: application/json' -d @/tmp/enroll-27-body.json "https://${HOST_IP}:9292/api/enroll/" 2>/dev/null || echo '{"ok":false,"error":"curl failed"}')
ENROLL_OK=$(echo "$ENROLL_RESPONSE" | jq -r '.ok // false' 2>/dev/null || echo "")
assert_eq "$ENROLL_OK" "true" "POST /api/enroll/ returns ok=true" || true
assert_json_field "$ENROLL_RESPONSE" '.label' "$TEST_LABEL" "Enroll response .label matches requested label" || true
assert_json_field_not_empty "$ENROLL_RESPONSE" '.serial' "Enroll response .serial is non-empty" || true
assert_json_field_not_empty "$ENROLL_RESPONSE" '.cert' "Enroll response .cert is non-empty" || true

# ---------------------------------------------------------------------------
log_section "Negative: POST /api/enroll/ with invalid token returns 401"
# ---------------------------------------------------------------------------

jq -n --arg csr "$CSR_PEM" '{token:"deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef", csr:$csr}' > /tmp/enroll-27-bad.json; echo ok
multipass transfer /tmp/enroll-27-bad.json lamaste-agent:/tmp/enroll-27-bad.json; rm -f /tmp/enroll-27-bad.json; echo done
BAD_ENROLL_STATUS=$(multipass exec lamaste-agent -- curl -sk -o /dev/null -w '%{http_code}' --max-time 30 -X POST -H 'Content-Type: application/json' -d @/tmp/enroll-27-bad.json "https://${HOST_IP}:9292/api/enroll/" 2>/dev/null || echo 000)
assert_eq "$BAD_ENROLL_STATUS" "401" "POST /api/enroll/ with invalid token returns 401" || true
agent_exec "rm -f /tmp/enroll-27-bad.json" || true

# ---------------------------------------------------------------------------
log_section "POST /api/enroll/lookup returns pending token label"
# ---------------------------------------------------------------------------

LOOKUP_TOKEN_RESPONSE=$(host_api_post "certs/agent/enroll" "{\"label\":\"${TEST_LABEL}-lookup\",\"capabilities\":[\"tunnels:read\"]}")
LOOKUP_TOKEN=$(echo "$LOOKUP_TOKEN_RESPONSE" | jq -r '.token // ""' 2>/dev/null || echo "")
assert_not_eq "$LOOKUP_TOKEN" "" "Second enrollment token captured for lookup test" || true
jq -n --arg token "$LOOKUP_TOKEN" '{token:$token}' > /tmp/enroll-27-lookup.json; echo ok
multipass transfer /tmp/enroll-27-lookup.json lamaste-agent:/tmp/enroll-27-lookup.json; rm -f /tmp/enroll-27-lookup.json; echo done
LOOKUP_RESPONSE=$(multipass exec lamaste-agent -- curl -sk --max-time 30 -X POST -H 'Content-Type: application/json' -d @/tmp/enroll-27-lookup.json "https://${HOST_IP}:9292/api/enroll/lookup" 2>/dev/null || echo '{"ok":false}')
assert_json_field "$LOOKUP_RESPONSE" '.ok' 'true' "POST /api/enroll/lookup returns ok=true" || true
assert_json_field "$LOOKUP_RESPONSE" '.label' 'enroll-public-27-lookup' "Lookup .label matches issued token label" || true
agent_exec "rm -f /tmp/enroll-27-lookup.json" || true

# ---------------------------------------------------------------------------
log_section "Negative: POST /api/enroll/lookup with invalid token returns 401"
# ---------------------------------------------------------------------------

echo '{"token":"0000000000000000000000000000000000000000000000000000000000000000"}' > /tmp/enroll-27-badlookup.json; echo ok
multipass transfer /tmp/enroll-27-badlookup.json lamaste-agent:/tmp/enroll-27-badlookup.json; rm -f /tmp/enroll-27-badlookup.json; echo done
BAD_LOOKUP_STATUS=$(multipass exec lamaste-agent -- curl -sk -o /dev/null -w '%{http_code}' --max-time 30 -X POST -H 'Content-Type: application/json' -d @/tmp/enroll-27-badlookup.json "https://${HOST_IP}:9292/api/enroll/lookup" 2>/dev/null || echo 000)
assert_eq "$BAD_LOOKUP_STATUS" "401" "POST /api/enroll/lookup with invalid token returns 401" || true
agent_exec "rm -f /tmp/enroll-27-badlookup.json" || true

# ---------------------------------------------------------------------------
log_section "DELETE /api/certs/agent/enroll/:label revokes the unused lookup token"
# ---------------------------------------------------------------------------

_DUAL_DEL_1=$(host_api_delete_dual "certs/agent/enroll/${TEST_LABEL}-lookup")
DELETE_RESPONSE=$(printf '%s' "$_DUAL_DEL_1" | sed '$d')
DELETE_STATUS=$(printf '%s' "$_DUAL_DEL_1" | tail -n1)
assert_eq "$DELETE_STATUS" "200" "DELETE /certs/agent/enroll/:label returns 200" || true
assert_json_field "$DELETE_RESPONSE" '.revoked' 'true' "Delete response .revoked=true (unused token was removed)" || true
# Wait long enough for nginx's `enroll` rate-limit zone to refill at least one
# slot (5r/m → ~12s per token) so the post-delete lookup is not 503'd before
# reaching the panel. Earlier assertions already consumed the burst.
sleep 13
LOOKUP_TOKEN=""
POST_DELETE_LOOKUP_STATUS=$(jq -n --arg token "$(jq -r '.token' <<<"$LOOKUP_TOKEN_RESPONSE")" '{token:$token}' > /tmp/enroll-27-postdel.json; multipass transfer /tmp/enroll-27-postdel.json lamaste-agent:/tmp/enroll-27-postdel.json 2>/dev/null; rm -f /tmp/enroll-27-postdel.json; multipass exec lamaste-agent -- curl -sk -o /dev/null -w '%{http_code}' --max-time 30 -X POST -H 'Content-Type: application/json' -d @/tmp/enroll-27-postdel.json "https://${HOST_IP}:9292/api/enroll/lookup" 2>/dev/null || echo 000)
assert_eq "$POST_DELETE_LOOKUP_STATUS" "401" "Lookup of revoked token returns 401" || true
agent_exec "rm -f /tmp/enroll-27-postdel.json" || true

end_test

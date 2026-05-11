#!/usr/bin/env bash
# ============================================================================
# 23 — Tickets Lifecycle (Three-VM)
# ============================================================================
# 23 — Tickets Lifecycle (Three-VM)
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

host_api_patch() {
  host_exec "curl -skf --max-time 30 --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key --cacert /etc/lamalibre/lamaste/pki/ca.crt -X PATCH -H 'Content-Type: application/json' -H 'Accept: application/json' -d '$2' https://127.0.0.1:9292/api/$1"
}

host_api_delete() {
  host_exec "curl -skf --max-time 30 --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key --cacert /etc/lamalibre/lamaste/pki/ca.crt -X DELETE -H 'Accept: application/json' https://127.0.0.1:9292/api/$1"
}

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

TICKET_SCOPE_NAME="rodeo-tickets"
SUB_SCOPE="plugin:rodeo-tickets:connect"
SOURCE_LABEL="rodeo-tickets-source"
TARGET_LABEL="rodeo-tickets-target"

begin_test "23 — Tickets Lifecycle (Three-VM)"

# ---------------------------------------------------------------------------
# Cleanup function — always runs on exit
# ---------------------------------------------------------------------------

cleanup() {
  log_info "Cleaning up test resources..."
  if [ -n "$INSTANCE_ID" ] && [ "$INSTANCE_ID" != "null" ]; then
    host_api_delete "tickets/instances/${INSTANCE_ID}" 2>/dev/null || true
  fi
  host_api_delete "tickets/scopes/${TICKET_SCOPE_NAME}" 2>/dev/null || true
  host_api_delete "certs/agent/${SOURCE_LABEL}" 2>/dev/null || true
  host_api_delete "certs/agent/${TARGET_LABEL}" 2>/dev/null || true
  host_exec "rm -f /tmp/e2e-tickets-*.pem 2>/dev/null || true" 2>/dev/null || true
}
trap cleanup EXIT

# Initialize cleanup variables to avoid 'unbound variable' errors if early failures trigger EXIT trap.
INSTANCE_ID=""
INSTANCE_SCOPE=""
TICKET_ID=""
SESSION_ID=""

# ---------------------------------------------------------------------------
log_section "1. Register ticket scope"
# ---------------------------------------------------------------------------

SCOPE_CREATE_RESP=$(host_api_post "tickets/scopes" '{"name":"'"${TICKET_SCOPE_NAME}"'","version":"1.0.0","description":"Rodeo e2e ticket lifecycle test scope","scopes":[{"name":"'"${SUB_SCOPE}"'","description":"Connect sub-scope for rodeo test","instanceScoped":true}],"transport":{"strategies":["tunnel"],"preferred":"tunnel","port":0,"protocol":"wss"}}')
assert_json_field "$SCOPE_CREATE_RESP" '.ok' 'true' "POST /api/tickets/scopes response has ok: true" || true
assert_contains "$SCOPE_CREATE_RESP" "$SUB_SCOPE" "Scope create response lists the registered sub-scope name" || true

# ---------------------------------------------------------------------------
log_section "2. List ticket scopes"
# ---------------------------------------------------------------------------

SCOPES_LIST=$(host_api_get "tickets/scopes")
assert_contains "$SCOPES_LIST" "$TICKET_SCOPE_NAME" "GET /api/tickets/scopes response contains registered scope name" || true

# ---------------------------------------------------------------------------
log_section "3. Create source and target agent certs with sub-scope capability"
# ---------------------------------------------------------------------------

SOURCE_CERT_RESP=$(host_api_post "certs/agent" '{"label":"'"${SOURCE_LABEL}"'","capabilities":["tunnels:read","'"${SUB_SCOPE}"'"]}')
assert_json_field "$SOURCE_CERT_RESP" '.ok' 'true' "Source agent cert creation returns ok: true" || true
SOURCE_P12_PASS=$(echo "$SOURCE_CERT_RESP" | jq -r '.p12Password' 2>/dev/null || echo "")

TARGET_CERT_RESP=$(host_api_post "certs/agent" '{"label":"'"${TARGET_LABEL}"'","capabilities":["tunnels:read","'"${SUB_SCOPE}"'"]}')
assert_json_field "$TARGET_CERT_RESP" '.ok' 'true' "Target agent cert creation returns ok: true" || true
TARGET_P12_PASS=$(echo "$TARGET_CERT_RESP" | jq -r '.p12Password' 2>/dev/null || echo "")

host_exec "openssl pkcs12 -in '/etc/lamalibre/lamaste/pki/agents/${SOURCE_LABEL}/client.p12' -clcerts -nokeys -out /tmp/e2e-tickets-src-cert.pem -passin 'pass:${SOURCE_P12_PASS}' -legacy 2>/dev/null || openssl pkcs12 -in '/etc/lamalibre/lamaste/pki/agents/${SOURCE_LABEL}/client.p12' -clcerts -nokeys -out /tmp/e2e-tickets-src-cert.pem -passin 'pass:${SOURCE_P12_PASS}'"
host_exec "openssl pkcs12 -in '/etc/lamalibre/lamaste/pki/agents/${SOURCE_LABEL}/client.p12' -nocerts -nodes -out /tmp/e2e-tickets-src-key.pem -passin 'pass:${SOURCE_P12_PASS}' -legacy 2>/dev/null || openssl pkcs12 -in '/etc/lamalibre/lamaste/pki/agents/${SOURCE_LABEL}/client.p12' -nocerts -nodes -out /tmp/e2e-tickets-src-key.pem -passin 'pass:${SOURCE_P12_PASS}'"
host_exec "openssl pkcs12 -in '/etc/lamalibre/lamaste/pki/agents/${TARGET_LABEL}/client.p12' -clcerts -nokeys -out /tmp/e2e-tickets-tgt-cert.pem -passin 'pass:${TARGET_P12_PASS}' -legacy 2>/dev/null || openssl pkcs12 -in '/etc/lamalibre/lamaste/pki/agents/${TARGET_LABEL}/client.p12' -clcerts -nokeys -out /tmp/e2e-tickets-tgt-cert.pem -passin 'pass:${TARGET_P12_PASS}'"
host_exec "openssl pkcs12 -in '/etc/lamalibre/lamaste/pki/agents/${TARGET_LABEL}/client.p12' -nocerts -nodes -out /tmp/e2e-tickets-tgt-key.pem -passin 'pass:${TARGET_P12_PASS}' -legacy 2>/dev/null || openssl pkcs12 -in '/etc/lamalibre/lamaste/pki/agents/${TARGET_LABEL}/client.p12' -nocerts -nodes -out /tmp/e2e-tickets-tgt-key.pem -passin 'pass:${TARGET_P12_PASS}'"
log_pass "Extracted PEM cert/key pairs for source and target agents"

# ---------------------------------------------------------------------------
log_section "4. Register instance via source agent cert"
# ---------------------------------------------------------------------------

INST_RAW=$(host_exec "curl -sk --max-time 30 -w '\n%{http_code}' --cert /tmp/e2e-tickets-src-cert.pem --key /tmp/e2e-tickets-src-key.pem --cacert /etc/lamalibre/lamaste/pki/ca.crt -X POST -H 'Content-Type: application/json' -H 'Accept: application/json' -d '{\"scope\":\"${SUB_SCOPE}\",\"transport\":{\"strategies\":[\"tunnel\"],\"preferred\":\"tunnel\"}}' https://127.0.0.1:9292/api/tickets/instances")
INST_STATUS=$(printf '%s' "$INST_RAW" | tail -n1)
INST_BODY=$(printf '%s' "$INST_RAW" | sed '$d')
assert_eq "$INST_STATUS" "201" "POST /api/tickets/instances returns 201 for new instance" || true
INSTANCE_ID=$(echo "$INST_BODY" | jq -r '.instanceId' 2>/dev/null || echo "")
INSTANCE_SCOPE=$(echo "$INST_BODY" | jq -r '.instanceScope' 2>/dev/null || echo "")
assert_not_eq "$INSTANCE_ID" "" "Instance registration returned a non-empty instanceId" || true
assert_not_eq "$INSTANCE_SCOPE" "" "Instance registration returned a non-empty instanceScope" || true
assert_contains "$INSTANCE_SCOPE" "$SUB_SCOPE" "Instance scope embeds the registered sub-scope prefix" || true

# ---------------------------------------------------------------------------
log_section "5. Re-registering same instance returns 200 (idempotent)"
# ---------------------------------------------------------------------------

INST2_STATUS=$(host_exec "curl -sk -o /dev/null -w '%{http_code}' --max-time 30 --cert /tmp/e2e-tickets-src-cert.pem --key /tmp/e2e-tickets-src-key.pem --cacert /etc/lamalibre/lamaste/pki/ca.crt -X POST -H 'Content-Type: application/json' -H 'Accept: application/json' -d '{\"scope\":\"${SUB_SCOPE}\",\"transport\":{\"strategies\":[\"tunnel\"],\"preferred\":\"tunnel\"}}' https://127.0.0.1:9292/api/tickets/instances" 2>/dev/null || echo "000")
assert_eq "$INST2_STATUS" "200" "Re-registering same (scope, agent) returns 200 (idempotent path)" || true

# ---------------------------------------------------------------------------
log_section "6. Instance heartbeat"
# ---------------------------------------------------------------------------

HB_STATUS=$(host_exec "curl -sk -o /dev/null -w '%{http_code}' --max-time 30 --cert /tmp/e2e-tickets-src-cert.pem --key /tmp/e2e-tickets-src-key.pem --cacert /etc/lamalibre/lamaste/pki/ca.crt -X POST -H 'Accept: application/json' https://127.0.0.1:9292/api/tickets/instances/${INSTANCE_ID}/heartbeat" 2>/dev/null || echo "000")
assert_eq "$HB_STATUS" "200" "POST /api/tickets/instances/:id/heartbeat returns 200" || true

# Heartbeat on non-existent instance returns 404 (defense-in-depth check path)
HB_404=$(host_exec "curl -sk -o /dev/null -w '%{http_code}' --max-time 30 --cert /tmp/e2e-tickets-src-cert.pem --key /tmp/e2e-tickets-src-key.pem --cacert /etc/lamalibre/lamaste/pki/ca.crt -X POST -H 'Accept: application/json' https://127.0.0.1:9292/api/tickets/instances/deadbeefdeadbeefdeadbeefdeadbeef/heartbeat" 2>/dev/null || echo "000")
assert_eq "$HB_404" "404" "Heartbeat on non-existent instance returns 404" || true

# ---------------------------------------------------------------------------
log_section "7. Admin lists assignments (filtered by our agent)"
# ---------------------------------------------------------------------------

ASSIGN_LIST=$(host_api_get "tickets/assignments?agentLabel=${TARGET_LABEL}")
assert_json_field "$ASSIGN_LIST" '.assignments' '[]' "GET /api/tickets/assignments filtered by our target label is initially empty" || true

# ---------------------------------------------------------------------------
log_section "8. Assignment validation — malformed instanceScope is rejected"
# ---------------------------------------------------------------------------

# Submit an assignment with a syntactically-invalid instanceScope: expect Zod 400.
BAD_ASSIGN_STATUS=$(host_exec "curl -sk -o /dev/null -w '%{http_code}' --max-time 30 --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key --cacert /etc/lamalibre/lamaste/pki/ca.crt -X POST -H 'Content-Type: application/json' -H 'Accept: application/json' -d '{\"agentLabel\":\"${TARGET_LABEL}\",\"instanceScope\":\"not-a-valid-scope\"}' https://127.0.0.1:9292/api/tickets/assignments" 2>/dev/null || echo "000")
assert_eq "$BAD_ASSIGN_STATUS" "400" "POST /api/tickets/assignments with malformed instanceScope returns 400" || true

# DELETE with a non-existent agentLabel/instanceScope pair that matches the regex returns 404.
DEL_404=$(host_exec "curl -sk -o /dev/null -w '%{http_code}' --max-time 30 --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key --cacert /etc/lamalibre/lamaste/pki/ca.crt -X DELETE -H 'Accept: application/json' https://127.0.0.1:9292/api/tickets/assignments/no-such-agent/plugin:rodeo-tickets:connect:deadbeef" 2>/dev/null || echo "000")
assert_eq "$DEL_404" "404" "DELETE /api/tickets/assignments/:agent/:scope for non-existent row returns 404" || true

# ---------------------------------------------------------------------------
log_section "9. Ticket request without assignment returns 404"
# ---------------------------------------------------------------------------

# Source agent requesting a ticket for target that has no assignment must fail with 404
# (the panel collapses 'not assigned', 'not found', and 'self-ticket' to the same 404 on purpose).
TK_STATUS=$(host_exec "curl -sk -o /dev/null -w '%{http_code}' --max-time 30 --cert /tmp/e2e-tickets-src-cert.pem --key /tmp/e2e-tickets-src-key.pem --cacert /etc/lamalibre/lamaste/pki/ca.crt -X POST -H 'Content-Type: application/json' -H 'Accept: application/json' -d '{\"scope\":\"${SUB_SCOPE}\",\"instanceId\":\"${INSTANCE_ID}\",\"target\":\"${TARGET_LABEL}\"}' https://127.0.0.1:9292/api/tickets" 2>/dev/null || echo "000")
assert_eq "$TK_STATUS" "404" "POST /api/tickets without a matching assignment returns 404" || true

# ---------------------------------------------------------------------------
log_section "10. Admin lists tickets and sessions; agent reads own inbox"
# ---------------------------------------------------------------------------

TICKETS_LIST=$(host_api_get "tickets")
assert_json_field_not_empty "$TICKETS_LIST" '.tickets' "GET /api/tickets (admin) returns a tickets field" || true

SESS_LIST=$(host_api_get "tickets/sessions")
assert_json_field_not_empty "$SESS_LIST" '.sessions' "GET /api/tickets/sessions (admin) returns a sessions field" || true

# Target agent reads own inbox — must return empty tickets array (no ticket was issued)
INBOX_BODY=$(host_exec "curl -skf --max-time 30 --cert /tmp/e2e-tickets-tgt-cert.pem --key /tmp/e2e-tickets-tgt-key.pem --cacert /etc/lamalibre/lamaste/pki/ca.crt -H 'Accept: application/json' https://127.0.0.1:9292/api/tickets/inbox" 2>/dev/null || echo "{}")
assert_json_field "$INBOX_BODY" '.tickets' '[]' "Target agent inbox is empty when no assignment exists" || true

# ---------------------------------------------------------------------------
log_section "11. Ticket validate/revoke negative paths"
# ---------------------------------------------------------------------------

# Validate a syntactically valid but unknown ticketId — must be rejected with the generic error code (401).
VAL_STATUS=$(host_exec "curl -sk -o /dev/null -w '%{http_code}' --max-time 30 --cert /tmp/e2e-tickets-tgt-cert.pem --key /tmp/e2e-tickets-tgt-key.pem --cacert /etc/lamalibre/lamaste/pki/ca.crt -X POST -H 'Content-Type: application/json' -H 'Accept: application/json' -d '{\"ticketId\":\"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef\"}' https://127.0.0.1:9292/api/tickets/validate" 2>/dev/null || echo "000")
assert_eq "$VAL_STATUS" "401" "POST /api/tickets/validate on unknown ticket returns 401 (generic denial)" || true

# Session creation with an unused-but-unknown ticket returns 400.
SESS_CREATE_STATUS=$(host_exec "curl -sk -o /dev/null -w '%{http_code}' --max-time 30 --cert /tmp/e2e-tickets-tgt-cert.pem --key /tmp/e2e-tickets-tgt-key.pem --cacert /etc/lamalibre/lamaste/pki/ca.crt -X POST -H 'Content-Type: application/json' -H 'Accept: application/json' -d '{\"ticketId\":\"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef\"}' https://127.0.0.1:9292/api/tickets/sessions" 2>/dev/null || echo "000")
assert_eq "$SESS_CREATE_STATUS" "400" "POST /api/tickets/sessions on unknown ticket returns 400" || true

# Session heartbeat on unknown sessionId returns 404.
SESS_HB_STATUS=$(host_exec "curl -sk -o /dev/null -w '%{http_code}' --max-time 30 --cert /tmp/e2e-tickets-tgt-cert.pem --key /tmp/e2e-tickets-tgt-key.pem --cacert /etc/lamalibre/lamaste/pki/ca.crt -X POST -H 'Accept: application/json' https://127.0.0.1:9292/api/tickets/sessions/unknown-session-id/heartbeat" 2>/dev/null || echo "000")
assert_eq "$SESS_HB_STATUS" "404" "POST /api/tickets/sessions/:id/heartbeat on unknown session returns 404" || true

# PATCH session on unknown sessionId returns 404.
SESS_PATCH_STATUS=$(host_exec "curl -sk -o /dev/null -w '%{http_code}' --max-time 30 --cert /tmp/e2e-tickets-tgt-cert.pem --key /tmp/e2e-tickets-tgt-key.pem --cacert /etc/lamalibre/lamaste/pki/ca.crt -X PATCH -H 'Content-Type: application/json' -H 'Accept: application/json' -d '{\"status\":\"grace\"}' https://127.0.0.1:9292/api/tickets/sessions/unknown-session-id" 2>/dev/null || echo "000")
assert_eq "$SESS_PATCH_STATUS" "404" "PATCH /api/tickets/sessions/:id on unknown session returns 404" || true

# Revoke an unknown ticketId returns 404.
REVOKE_STATUS=$(host_exec "curl -sk -o /dev/null -w '%{http_code}' --max-time 30 --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key --cacert /etc/lamalibre/lamaste/pki/ca.crt -X DELETE -H 'Accept: application/json' https://127.0.0.1:9292/api/tickets/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" 2>/dev/null || echo "000")
assert_eq "$REVOKE_STATUS" "404" "DELETE /api/tickets/:id on unknown ticket returns 404" || true

# ---------------------------------------------------------------------------
log_section "12. Lifecycle coverage complete"
# ---------------------------------------------------------------------------

log_info "Tickets lifecycle coverage complete; cleanup handled by EXIT trap"

end_test

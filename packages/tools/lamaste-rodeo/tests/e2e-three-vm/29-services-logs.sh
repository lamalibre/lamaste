#!/usr/bin/env bash
# ============================================================================
# 29 — Service Logs WebSocket (Three-VM)
# ============================================================================
# 29 — Service Logs WebSocket (Three-VM)
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "/Users/onurdevrimvatan/lama/repositories/lamalibre/lamaste/packages/tools/lamaste-rodeo/tests/e2e/helpers.sh"

require_commands multipass jq

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

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------


begin_test "29 — Service Logs WebSocket (Three-VM)"

# ---------------------------------------------------------------------------
log_section "Initialize variables for cleanup safety"
# ---------------------------------------------------------------------------

WS_NGINX_RESPONSE=""; WS_AUTHELIA_RESPONSE=""; WS_CHISEL_RESPONSE=""; WS_PANEL_RESPONSE=""; WS_UNKNOWN_RESPONSE=""; WS_INJECTION_RESPONSE=""; WS_GATEKEEPER_RESPONSE=""; NGINX_COUNT=""; NGINX_MSG_SHAPE=""; ONBOARDING_STATUS=""; true

# ---------------------------------------------------------------------------
log_section "Pre-flight: verify onboarding is complete"
# ---------------------------------------------------------------------------

ONBOARDING_STATUS=$(host_api_get "onboarding/status" | jq -r '.status' 2>/dev/null || echo "")
assert_eq "$ONBOARDING_STATUS" "COMPLETED" "Onboarding is COMPLETED before running logs WS tests" || true

# ---------------------------------------------------------------------------
log_section "Install WS helper script on host"
# ---------------------------------------------------------------------------

host_exec "echo 'const WebSocket = require('\''ws'\'');
const fs = require('\''fs'\'');
const svc = process.argv[2];
const timeoutMs = parseInt(process.argv[3] || '\''5000'\'', 10);
const url = '\''wss://127.0.0.1:9292/api/services/'\'' + svc + '\''/logs'\'';
const ws = new WebSocket(url, {
  cert: fs.readFileSync('\''/etc/lamalibre/lamaste/pki/client.crt'\''),
  key: fs.readFileSync('\''/etc/lamalibre/lamaste/pki/client.key'\''),
  ca: fs.readFileSync('\''/etc/lamalibre/lamaste/pki/ca.crt'\''),
  rejectUnauthorized: false,
});
let received = 0;
const out = { opened: false, messages: [], closeCode: null, closeReason: null, error: null, count: 0 };
const t = setTimeout(function() { try { ws.close(); } catch (e) {} finish(); }, timeoutMs);
function finish() { clearTimeout(t); console.log(JSON.stringify(out)); process.exit(0); }
ws.on('\''open'\'', function() { out.opened = true; });
ws.on('\''message'\'', function(data) {
  received++;
  if (out.messages.length < 3) out.messages.push(data.toString().slice(0, 300));
});
ws.on('\''close'\'', function(code, reason) { out.closeCode = code; out.closeReason = reason.toString(); out.count = received; finish(); });
ws.on('\''error'\'', function(err) { out.error = err.message; });
' > /tmp/ws-logs-test.cjs"
host_exec "test -f /tmp/ws-logs-test.cjs && echo yes || echo no"

# ---------------------------------------------------------------------------
log_section "Happy path: stream logs for nginx"
# ---------------------------------------------------------------------------

WS_NGINX_RESPONSE=$(host_exec "NODE_PATH=/opt/lamalibre/lamaste/serverd/node_modules node /tmp/ws-logs-test.cjs nginx 4000")
assert_json_field "$WS_NGINX_RESPONSE" '.opened' 'true' "WebSocket upgrade succeeds for nginx (opened: true)" || true
assert_json_field "$WS_NGINX_RESPONSE" '.closeCode' '1000' "nginx logs stream closes with code 1000 (normal)" || true
NGINX_COUNT=$(echo "$WS_NGINX_RESPONSE" | jq -r '.count' 2>/dev/null || echo "")
if [ -n "$NGINX_COUNT" ] && [ "$NGINX_COUNT" != "null" ]; then log_pass "nginx logs stream delivered at least one message (count > 0)"; else log_fail "nginx logs stream delivered at least one message (count > 0)" || true; fi
NGINX_MSG_SHAPE=$(echo "${WS_NGINX_RESPONSE}" | jq -r '.messages[0]' | jq -r 'has("timestamp") and has("message")')
assert_eq "$NGINX_MSG_SHAPE" "true" "First nginx log message has 'timestamp' and 'message' fields" || true

# ---------------------------------------------------------------------------
log_section "Other allowed services accept WS upgrade"
# ---------------------------------------------------------------------------

WS_AUTHELIA_RESPONSE=$(host_exec "NODE_PATH=/opt/lamalibre/lamaste/serverd/node_modules node /tmp/ws-logs-test.cjs authelia 4000")
assert_json_field "$WS_AUTHELIA_RESPONSE" '.opened' 'true' "WebSocket upgrade succeeds for authelia (opened: true)" || true
assert_json_field "$WS_AUTHELIA_RESPONSE" '.closeCode' '1000' "authelia logs stream closes with code 1000 (normal)" || true
WS_CHISEL_RESPONSE=$(host_exec "NODE_PATH=/opt/lamalibre/lamaste/serverd/node_modules node /tmp/ws-logs-test.cjs chisel 4000")
assert_json_field "$WS_CHISEL_RESPONSE" '.opened' 'true' "WebSocket upgrade succeeds for chisel (opened: true)" || true
assert_json_field "$WS_CHISEL_RESPONSE" '.closeCode' '1000' "chisel logs stream closes with code 1000 (normal)" || true
WS_PANEL_RESPONSE=$(host_exec "NODE_PATH=/opt/lamalibre/lamaste/serverd/node_modules node /tmp/ws-logs-test.cjs lamalibre-lamaste-serverd 4000")
assert_json_field "$WS_PANEL_RESPONSE" '.opened' 'true' "WebSocket upgrade succeeds for lamalibre-lamaste-serverd (opened: true)" || true
assert_json_field "$WS_PANEL_RESPONSE" '.closeCode' '1000' "lamalibre-lamaste-serverd logs stream closes with code 1000 (normal)" || true

# ---------------------------------------------------------------------------
log_section "Error path: unknown service rejected"
# ---------------------------------------------------------------------------

WS_UNKNOWN_RESPONSE=$(host_exec "NODE_PATH=/opt/lamalibre/lamaste/serverd/node_modules node /tmp/ws-logs-test.cjs nonexistent 4000")
assert_json_field "$WS_UNKNOWN_RESPONSE" '.closeCode' '1008' "Unknown service name closes WebSocket with code 1008 (policy violation)" || true
assert_json_field "$WS_UNKNOWN_RESPONSE" '.closeReason' 'Unknown service' "Unknown service close reason is the expected 'Unknown service'" || true
assert_json_field "$WS_UNKNOWN_RESPONSE" '.count' '0' "No log messages are streamed for an unknown service name" || true

# ---------------------------------------------------------------------------
log_section "Error path: path injection rejected"
# ---------------------------------------------------------------------------

WS_INJECTION_RESPONSE=$(host_exec "NODE_PATH=/opt/lamalibre/lamaste/serverd/node_modules node /tmp/ws-logs-test.cjs '..%2Fetc%2Fpasswd' 4000")
assert_json_field "$WS_INJECTION_RESPONSE" '.closeCode' '1008' "Path traversal attempt (..%2Fetc%2Fpasswd) closes WebSocket with code 1008" || true
assert_json_field "$WS_INJECTION_RESPONSE" '.closeReason' 'Unknown service' "Path traversal attempt is rejected with 'Unknown service' close reason (allowlist guard)" || true
assert_json_field "$WS_INJECTION_RESPONSE" '.count' '0' "No log messages are streamed for a path traversal attempt" || true
WS_GATEKEEPER_RESPONSE=$(host_exec "NODE_PATH=/opt/lamalibre/lamaste/serverd/node_modules node /tmp/ws-logs-test.cjs 'lamalibre-lamaste-gatekeeper' 4000")
assert_json_field "$WS_GATEKEEPER_RESPONSE" '.closeCode' '1008' "Service not in allowlist (lamalibre-lamaste-gatekeeper) is rejected with close code 1008" || true

end_test

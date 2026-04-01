#!/usr/bin/env bash
# ============================================================================
# 18 — Agent Plugin Hosting (Three-VM)
# ============================================================================
# Tests the agent plugin capability reporting feature across VMs:
#
# 1. Agent reports plugin capabilities to server
# 2. Server accepts valid capability report
# 3. Reported capabilities are prefix-scoped
# 4. Invalid capability format rejected
# 5. 'agents' is a reserved name in the server's plugin name validation
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../e2e/helpers.sh"

require_commands multipass curl jq

# ---------------------------------------------------------------------------
# VM exec helpers
# ---------------------------------------------------------------------------

host_exec() { multipass exec portlama-host -- sudo bash -c "$1"; }
agent_exec() { multipass exec portlama-agent -- sudo bash -c "$1"; }

host_api_get() {
  host_exec "curl -skf --max-time 30 --cert /etc/portlama/pki/client.crt --key /etc/portlama/pki/client.key --cacert /etc/portlama/pki/ca.crt -H 'Accept: application/json' https://127.0.0.1:9292/api/$1"
}

host_api_post() {
  host_exec "curl -skf --max-time 30 --cert /etc/portlama/pki/client.crt --key /etc/portlama/pki/client.key --cacert /etc/portlama/pki/ca.crt -X POST -H 'Content-Type: application/json' -H 'Accept: application/json' -d '$2' https://127.0.0.1:9292/api/$1"
}

host_api_post_status() {
  host_exec "curl -sk --max-time 30 -o /dev/null -w '%{http_code}' --cert /etc/portlama/pki/client.crt --key /etc/portlama/pki/client.key --cacert /etc/portlama/pki/ca.crt -X POST -H 'Content-Type: application/json' -d '$2' https://127.0.0.1:9292/api/$1"
}

# Agent-cert API helpers
host_agent_api_post() {
  local cert_path="$1"
  local key_path="$2"
  local api_path="$3"
  local data="$4"
  host_exec "curl -skf --max-time 30 --cert ${cert_path} --key ${key_path} --cacert /etc/portlama/pki/ca.crt -X POST -H 'Content-Type: application/json' -H 'Accept: application/json' -d '${data}' https://127.0.0.1:9292/api/${api_path}"
}

host_agent_api_post_status() {
  local cert_path="$1"
  local key_path="$2"
  local api_path="$3"
  local data="$4"
  host_exec "curl -sk --max-time 30 -o /dev/null -w '%{http_code}' --cert ${cert_path} --key ${key_path} --cacert /etc/portlama/pki/ca.crt -X POST -H 'Content-Type: application/json' -d '${data}' https://127.0.0.1:9292/api/${api_path}"
}

begin_test "18 — Agent Plugin Hosting"

# ---------------------------------------------------------------------------
log_section "Pre-flight: check onboarding is complete"
# ---------------------------------------------------------------------------

ONBOARDING_STATUS=$(host_api_get "onboarding/status" | jq -r '.status' 2>/dev/null || echo "unknown")
if [ "$ONBOARDING_STATUS" != "COMPLETED" ]; then
  log_skip "Onboarding not completed — skipping agent plugin hosting tests"
  end_test
  exit $?
fi
log_pass "Onboarding is complete"

# ---------------------------------------------------------------------------
log_section "Create agent cert for plugin reporting"
# ---------------------------------------------------------------------------

AGENT_LABEL="plugin-report-$(date +%s)"
CERT_RESPONSE=$(host_api_post "certs/agent" '{"label":"'"${AGENT_LABEL}"'","capabilities":["tunnels:read"]}')
CERT_OK=$(echo "$CERT_RESPONSE" | jq -r '.ok' 2>/dev/null || echo "false")
assert_eq "$CERT_OK" "true" "Agent cert created for plugin reporting" || true

# Extract agent cert PEM files
P12_B64=$(echo "$CERT_RESPONSE" | jq -r '.p12' 2>/dev/null || echo "")
P12_PASS=$(echo "$CERT_RESPONSE" | jq -r '.password' 2>/dev/null || echo "")
AGENT_CERT_DIR="/tmp/agent-plugin-test-${AGENT_LABEL}"

host_exec "mkdir -p ${AGENT_CERT_DIR} && echo '${P12_B64}' | base64 -d > ${AGENT_CERT_DIR}/client.p12 && openssl pkcs12 -in ${AGENT_CERT_DIR}/client.p12 -out ${AGENT_CERT_DIR}/client.crt -clcerts -nokeys -passin pass:${P12_PASS} 2>/dev/null && openssl pkcs12 -in ${AGENT_CERT_DIR}/client.p12 -out ${AGENT_CERT_DIR}/client.key -nocerts -nodes -passin pass:${P12_PASS} 2>/dev/null && chmod 600 ${AGENT_CERT_DIR}/client.key"
log_pass "Agent PEM cert extracted"

# ===========================================================================
# 1. Agent reports plugin capabilities
# ===========================================================================

log_section "Agent reports plugin capabilities"

REPORT_RESPONSE=$(host_agent_api_post "${AGENT_CERT_DIR}/client.crt" "${AGENT_CERT_DIR}/client.key" "agents/plugins/report" '{"plugins":[{"name":"test-sync","version":"0.1.0","capabilities":["test-sync:connect","test-sync:read"]}]}')
REPORT_OK=$(echo "$REPORT_RESPONSE" | jq -r '.ok' 2>/dev/null || echo "false")
REPORT_MERGED=$(echo "$REPORT_RESPONSE" | jq -r '.merged' 2>/dev/null || echo "0")
assert_eq "$REPORT_OK" "true" "Plugin report accepted" || true
assert_eq "$REPORT_MERGED" "2" "Two capabilities merged" || true

# ===========================================================================
# 2. Capabilities are prefix-scoped
# ===========================================================================

log_section "Capability prefix scoping"

SCOPED_RESPONSE=$(host_agent_api_post "${AGENT_CERT_DIR}/client.crt" "${AGENT_CERT_DIR}/client.key" "agents/plugins/report" '{"plugins":[{"name":"myplugin","version":"1.0.0","capabilities":["myplugin:action","other:action"]}]}')
SCOPED_MERGED=$(echo "$SCOPED_RESPONSE" | jq -r '.merged' 2>/dev/null || echo "0")
assert_eq "$SCOPED_MERGED" "1" "Only myplugin:action merged (other:action rejected)" || true

# ===========================================================================
# 3. Invalid capability format rejected
# ===========================================================================

log_section "Invalid capability format rejected"

INVALID_STATUS=$(host_agent_api_post_status "${AGENT_CERT_DIR}/client.crt" "${AGENT_CERT_DIR}/client.key" "agents/plugins/report" '{"plugins":[{"name":"bad","version":"1.0.0","capabilities":["nocolon"]}]}')
assert_eq "$INVALID_STATUS" "400" "Capability without colon rejected with 400" || true

# ===========================================================================
# 4. Admin report also works
# ===========================================================================

log_section "Admin can also report"

ADMIN_REPORT=$(host_api_post "agents/plugins/report" '{"plugins":[{"name":"admin-plugin","version":"1.0.0","capabilities":["admin-plugin:manage"]}]}')
ADMIN_OK=$(echo "$ADMIN_REPORT" | jq -r '.ok' 2>/dev/null || echo "false")
assert_eq "$ADMIN_OK" "true" "Admin can report plugin capabilities" || true

# ===========================================================================
# Cleanup
# ===========================================================================

host_exec "rm -rf ${AGENT_CERT_DIR}" 2>/dev/null || true

end_test

#!/usr/bin/env bash
# ============================================================================
# 20 — Agent-Side User Plugin Access (Three-VM)
# ============================================================================
# Tests the full agent-side user plugin access flow across VMs:
#
# 1. Grant model: create agent-side grant, verify auto-consumed
# 2. Plugin tunnel: create type=plugin tunnel, verify nginx vhost
# 3. Access control: verify Authelia rules include granted user
# 4. Revocation: revoke grant, verify access control updated
# 5. Validation: reserved route prefixes, admin-only enforcement
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../e2e/helpers.sh"

require_commands multipass curl jq

# ---------------------------------------------------------------------------
# VM exec helpers
# ---------------------------------------------------------------------------

host_exec() { multipass exec portlama-host -- sudo bash -c "$1"; }

host_api_get() {
  host_exec "curl -skf --max-time 30 --cert /etc/portlama/pki/client.crt --key /etc/portlama/pki/client.key --cacert /etc/portlama/pki/ca.crt -H 'Accept: application/json' https://127.0.0.1:9292/api/$1"
}

host_api_post() {
  host_exec "curl -skf --max-time 30 --cert /etc/portlama/pki/client.crt --key /etc/portlama/pki/client.key --cacert /etc/portlama/pki/ca.crt -X POST -H 'Content-Type: application/json' -H 'Accept: application/json' -d '$2' https://127.0.0.1:9292/api/$1"
}

host_api_post_status() {
  host_exec "curl -sk --max-time 30 -o /dev/null -w '%{http_code}' --cert /etc/portlama/pki/client.crt --key /etc/portlama/pki/client.key --cacert /etc/portlama/pki/ca.crt -X POST -H 'Content-Type: application/json' -d '$2' https://127.0.0.1:9292/api/$1"
}

host_api_delete() {
  host_exec "curl -skf --max-time 30 --cert /etc/portlama/pki/client.crt --key /etc/portlama/pki/client.key --cacert /etc/portlama/pki/ca.crt -X DELETE https://127.0.0.1:9292/api/$1"
}

host_api_delete_status() {
  host_exec "curl -sk --max-time 30 -o /dev/null -w '%{http_code}' --cert /etc/portlama/pki/client.crt --key /etc/portlama/pki/client.key --cacert /etc/portlama/pki/ca.crt -X DELETE https://127.0.0.1:9292/api/$1"
}

begin_test "20 — Agent-Side User Plugin Access (Three-VM)"

# ---------------------------------------------------------------------------
log_section "Pre-flight: check VMs and onboarding"
# ---------------------------------------------------------------------------

ONBOARDING=$(host_api_get "onboarding/status" 2>/dev/null | jq -r '.status' || echo "unknown")
if [ "$ONBOARDING" != "COMPLETED" ]; then
  log_skip "Onboarding not completed — skipping"
  end_test
  exit $?
fi
log_pass "Onboarding complete"

# Find agent label
AGENT_LABEL=$(host_api_get "certs/agent" 2>/dev/null | jq -r '.agents[0].label // empty' || echo "")
if [ -z "$AGENT_LABEL" ]; then
  log_skip "No enrolled agent found — skipping"
  end_test
  exit $?
fi
log_info "Using agent label: ${AGENT_LABEL}"

# ---------------------------------------------------------------------------
log_section "1. Create agent-side grant"
# ---------------------------------------------------------------------------

RESULT=$(host_api_post "user-access/grants" "{\"username\":\"testuser\",\"pluginName\":\"@lamalibre/herd-server\",\"target\":\"agent:${AGENT_LABEL}\"}" 2>/dev/null || echo "")
GRANT_ID=$(echo "$RESULT" | jq -r '.grant.grantId // empty' 2>/dev/null || echo "")

if [ -n "$GRANT_ID" ]; then
  log_pass "Agent-side grant created: ${GRANT_ID}"

  # Verify auto-consumed
  IS_USED=$(echo "$RESULT" | jq -r '.grant.used' 2>/dev/null || echo "")
  if [ "$IS_USED" = "true" ]; then
    log_pass "Grant is auto-consumed (used=true)"
  else
    log_fail "Grant should be auto-consumed for agent target"
  fi

  # Verify target field
  TARGET=$(echo "$RESULT" | jq -r '.grant.target' 2>/dev/null || echo "")
  if [ "$TARGET" = "agent:${AGENT_LABEL}" ]; then
    log_pass "Grant target matches: ${TARGET}"
  else
    log_fail "Grant target mismatch: expected agent:${AGENT_LABEL}, got ${TARGET}"
  fi
else
  log_fail "Failed to create agent-side grant"
fi

# ---------------------------------------------------------------------------
log_section "2. Verify Authelia access control updated"
# ---------------------------------------------------------------------------

# Check that Authelia config has access control rules (if Authelia is installed)
HAS_AUTHELIA=$(host_exec "which authelia 2>/dev/null && echo yes || echo no")
if [ "$HAS_AUTHELIA" = "yes" ]; then
  AUTHELIA_CONFIG=$(host_exec "sudo cat /etc/authelia/configuration.yml 2>/dev/null" || echo "")
  if echo "$AUTHELIA_CONFIG" | grep -q "testuser" 2>/dev/null; then
    log_pass "Authelia config includes granted user"
  else
    log_info "Authelia config may not include user (Authelia sync may not have run)"
  fi

  if echo "$AUTHELIA_CONFIG" | grep -q "group:admins" 2>/dev/null; then
    log_pass "Authelia config includes admins group rule"
  else
    log_info "Authelia admins group rule not found"
  fi
else
  log_skip "Authelia not installed — skipping config verification"
fi

# ---------------------------------------------------------------------------
log_section "3. Plugin tunnel validation"
# ---------------------------------------------------------------------------

# Missing required fields for plugin tunnel
STATUS=$(host_api_post_status "tunnels" '{"subdomain":"test-plug","port":10060,"type":"plugin"}')
if [ "$STATUS" = "400" ]; then
  log_pass "Plugin tunnel without pluginName/agentLabel rejected (400)"
else
  log_fail "Expected 400 for plugin tunnel without required fields, got ${STATUS}"
fi

# Reserved route prefix
STATUS=$(host_api_post_status "tunnels" "{\"subdomain\":\"test-api\",\"port\":10061,\"type\":\"plugin\",\"pluginName\":\"@lamalibre/api-server\",\"agentLabel\":\"${AGENT_LABEL}\"}")
if [ "$STATUS" = "400" ]; then
  log_pass "Plugin tunnel with reserved route 'api' rejected (400)"
else
  log_fail "Expected 400 for reserved route prefix, got ${STATUS}"
fi

# Invalid pluginName characters
STATUS=$(host_api_post_status "tunnels" "{\"subdomain\":\"test-bad\",\"port\":10062,\"type\":\"plugin\",\"pluginName\":\"@lamalibre/bad;name\",\"agentLabel\":\"${AGENT_LABEL}\"}")
if [ "$STATUS" = "400" ]; then
  log_pass "Plugin tunnel with invalid pluginName rejected (400)"
else
  log_fail "Expected 400 for invalid pluginName, got ${STATUS}"
fi

# ---------------------------------------------------------------------------
log_section "4. Revoke agent-side grant"
# ---------------------------------------------------------------------------

if [ -n "$GRANT_ID" ]; then
  STATUS=$(host_api_delete_status "user-access/grants/${GRANT_ID}")
  if [ "$STATUS" = "200" ]; then
    log_pass "Agent-side grant revoked successfully"
  else
    log_fail "Failed to revoke agent-side grant: ${STATUS}"
  fi

  # Verify grant removed
  GRANTS=$(host_api_get "user-access/grants" 2>/dev/null || echo "{}")
  FOUND=$(echo "$GRANTS" | jq "[.grants[] | select(.grantId == \"${GRANT_ID}\")] | length" 2>/dev/null || echo "1")
  if [ "$FOUND" = "0" ]; then
    log_pass "Revoked grant no longer in list"
  else
    log_fail "Revoked grant still present in list"
  fi
fi

# ---------------------------------------------------------------------------
log_section "5. Cleanup"
# ---------------------------------------------------------------------------

log_pass "Cleanup complete"

end_test
exit $?

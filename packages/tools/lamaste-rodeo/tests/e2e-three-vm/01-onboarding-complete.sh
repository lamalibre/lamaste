#!/usr/bin/env bash
# ============================================================================
# 01 — Onboarding Complete Verification (Three-VM)
# ============================================================================
# Verifies that setup-host.sh completed successfully:
# - Onboarding status is COMPLETED
# - All core services are running (nginx, chisel, authelia, lamalibre-lamaste-serverd)
# - Self-signed certificates exist at expected paths
# - Panel is accessible via domain with mTLS
# - DNS resolves TEST_DOMAIN to HOST_IP
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../e2e/helpers.sh"

require_commands multipass curl jq dig

# ---------------------------------------------------------------------------
# VM exec helpers — run commands on host/agent VMs via multipass
# ---------------------------------------------------------------------------

host_exec() { multipass exec lamaste-host -- sudo bash -c "$1"; }
agent_exec() { multipass exec lamaste-agent -- sudo bash -c "$1"; }
visitor_exec() { multipass exec lamaste-visitor -- sudo bash -c "$1"; }

# mTLS API helpers — execute curl on the host VM using its local certs
host_api_get() {
  host_exec "curl -skf --max-time 30 --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key --cacert /etc/lamalibre/lamaste/pki/ca.crt -H 'Accept: application/json' https://127.0.0.1:9292/api/$1"
}

begin_test "01 — Onboarding Complete Verification (Three-VM)"

# ---------------------------------------------------------------------------
log_section "Onboarding status"
# ---------------------------------------------------------------------------

STATUS_JSON=$(host_api_get "onboarding/status" || echo '{}')
ONBOARDING_STATUS=$(echo "$STATUS_JSON" | jq -r '.status' 2>/dev/null || echo "unknown")
assert_eq "$ONBOARDING_STATUS" "COMPLETED" "Onboarding status is COMPLETED" || true

DOMAIN_FROM_API=$(echo "$STATUS_JSON" | jq -r '.domain' 2>/dev/null || echo "")
if [ -n "$DOMAIN_FROM_API" ] && [ "$DOMAIN_FROM_API" != "null" ]; then
  log_pass "Domain is set in onboarding status: $DOMAIN_FROM_API"
else
  log_fail "Domain is not set in onboarding status"
fi

# ---------------------------------------------------------------------------
log_section "Core services running"
# ---------------------------------------------------------------------------

SERVICES=(nginx chisel authelia lamalibre-lamaste-serverd)

for svc in "${SERVICES[@]}"; do
  SVC_STATUS=$(host_exec "systemctl is-active $svc 2>/dev/null || echo inactive")
  assert_eq "$SVC_STATUS" "active" "Service $svc is active" || true
done

# ---------------------------------------------------------------------------
log_section "Self-signed certificates exist"
# ---------------------------------------------------------------------------

CERT_PATHS=(
  "/etc/lamalibre/lamaste/pki/ca.crt"
  "/etc/lamalibre/lamaste/pki/ca.key"
  "/etc/lamalibre/lamaste/pki/client.crt"
  "/etc/lamalibre/lamaste/pki/client.key"
  "/etc/lamalibre/lamaste/pki/self-signed.pem"
  "/etc/lamalibre/lamaste/pki/self-signed-key.pem"
)

for cert_path in "${CERT_PATHS[@]}"; do
  EXISTS=$(host_exec "test -f $cert_path && echo yes || echo no")
  assert_eq "$EXISTS" "yes" "Certificate exists: $cert_path" || true
done

# ---------------------------------------------------------------------------
log_section "Panel accessible via domain (mTLS)"
# ---------------------------------------------------------------------------

# curl from the host VM to the panel domain — nginx should serve it
PANEL_STATUS=$(host_exec "curl -sk -o /dev/null -w '%{http_code}' --max-time 15 --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key --cacert /etc/lamalibre/lamaste/pki/ca.crt https://panel.${TEST_DOMAIN}" || echo "000")
if [ "$PANEL_STATUS" = "200" ] || [ "$PANEL_STATUS" = "302" ]; then
  log_pass "Panel accessible via https://panel.${TEST_DOMAIN} (HTTP $PANEL_STATUS)"
else
  log_fail "Panel not accessible via https://panel.${TEST_DOMAIN} (HTTP $PANEL_STATUS)"
fi

# ---------------------------------------------------------------------------
log_section "DNS resolution"
# ---------------------------------------------------------------------------

# Use dig to resolve the domain — should return HOST_IP via dnsmasq on the host
RESOLVED_IP=$(dig +short "${TEST_DOMAIN}" "@${HOST_IP}" 2>/dev/null | head -1 || echo "")
if [ "$RESOLVED_IP" = "$HOST_IP" ]; then
  log_pass "DNS resolves ${TEST_DOMAIN} to ${HOST_IP}"
else
  # Also check from the host VM itself
  RESOLVED_IP_HOST=$(host_exec "dig +short ${TEST_DOMAIN} @127.0.0.1 2>/dev/null | head -1" || echo "")
  if [ "$RESOLVED_IP_HOST" = "$HOST_IP" ]; then
    log_pass "DNS resolves ${TEST_DOMAIN} to ${HOST_IP} (from host VM)"
  else
    log_fail "DNS does not resolve ${TEST_DOMAIN} to ${HOST_IP} (got: '${RESOLVED_IP}' externally, '${RESOLVED_IP_HOST}' from host)"
  fi
fi

# ---------------------------------------------------------------------------
log_section "Agent VM connectivity"
# ---------------------------------------------------------------------------

# Verify agent VM can reach the host VM
AGENT_PING=$(agent_exec "curl -sk -o /dev/null -w '%{http_code}' --max-time 10 https://${HOST_IP}:9292 2>/dev/null" || echo "000")
# Without mTLS cert, the agent should get a TLS error or 4xx — but the TCP connection should succeed
if [ "$AGENT_PING" != "000" ]; then
  log_pass "Agent VM can reach host VM at ${HOST_IP}:9292 (HTTP $AGENT_PING)"
else
  log_fail "Agent VM cannot reach host VM at ${HOST_IP}:9292"
fi

# ---------------------------------------------------------------------------
log_section "Visitor VM connectivity"
# ---------------------------------------------------------------------------

# Verify visitor VM can reach the host VM (no mTLS certs — should get rejected but reachable)
VISITOR_PING=$(visitor_exec "curl -sk -o /dev/null -w '%{http_code}' --max-time 10 https://${HOST_IP}:9292 2>/dev/null" || echo "000")
if [ "$VISITOR_PING" != "000" ]; then
  log_pass "Visitor VM can reach host VM at ${HOST_IP}:9292 (HTTP $VISITOR_PING)"
else
  log_fail "Visitor VM cannot reach host VM at ${HOST_IP}:9292"
fi

# Verify visitor can reach Authelia portal (no mTLS required for auth vhost)
VISITOR_AUTH=$(visitor_exec "curl -sk -o /dev/null -w '%{http_code}' --max-time 10 https://auth.${TEST_DOMAIN}/ 2>/dev/null" || echo "000")
if [ "$VISITOR_AUTH" != "000" ]; then
  log_pass "Visitor VM can reach Authelia at auth.${TEST_DOMAIN} (HTTP $VISITOR_AUTH)"
else
  log_fail "Visitor VM cannot reach Authelia at auth.${TEST_DOMAIN}"
fi

end_test

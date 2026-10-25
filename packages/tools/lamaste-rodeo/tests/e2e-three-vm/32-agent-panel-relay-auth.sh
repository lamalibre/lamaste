#!/usr/bin/env bash
# ============================================================================
# 32 — Agent Panel Relay Auth (Three-VM)
# ============================================================================
# lamaste-agentd behind the real agent-panel vhost. The daemon listens on the
# agent's loopback, and the panel tunnel ends on the host's loopback: both can
# be reached without going through nginx, so the daemon trusts no header that
# only claims a caller. It accepts the relay only with the relay assertion the
# panel signs for each request (the vhost's auth_request), and the owner only
# with the Bearer token of agentd.token:
#
# 1. Admin grants test-agent panel:expose (restored on exit); lamaste-agentd
#    is installed on demand and the panel exposed with
#    `lamaste-agent panel --enable` (the agent's own certificate)
# 2. The vhost asks the panel to authorize every request; the relay signing
#    key is 0600 and the panel user's; the agent can read the public key
# 3. Through the vhost: the admin certificate has full access; test-agent's
#    own certificate its capabilities (owner-only routes refused, also when it
#    sends headers claiming admin); a client-sent assertion is replaced
# 4. From the host's loopback — any relay process — and as an unprivileged
#    user on the agent VM: forged X-SSL-Client-*, Remote-User and assertion
#    headers and percent-escaped paths are refused with 401, and agentd.token
#    is not readable
# 5. The panel is disabled again (tunnel retracted, service stopped)
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../e2e/helpers.sh"

require_commands multipass curl jq

# ---------------------------------------------------------------------------
# VM exec helpers
# ---------------------------------------------------------------------------

host_exec() { multipass exec lamaste-host -- sudo bash -c "$1"; }
agent_exec() { multipass exec lamaste-agent -- sudo bash -c "$1"; }

host_api_get() {
  host_exec "curl -skf --max-time 30 --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key --cacert /etc/lamalibre/lamaste/pki/ca.crt -H 'Accept: application/json' https://127.0.0.1:9292/api/$1"
}

host_api_patch() {
  host_exec "curl -skf --max-time 30 --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key --cacert /etc/lamalibre/lamaste/pki/ca.crt -X PATCH -H 'Content-Type: application/json' -H 'Accept: application/json' -d '$2' https://127.0.0.1:9292/api/$1"
}

# agent_api_get — the panel API with test-agent's own certificate, from the agent VM
agent_api_get() {
  agent_exec "curl -skf --max-time 30 --cert ${AGENT_CERT_PEM} --key ${AGENT_KEY_PEM} -H 'Accept: application/json' https://${HOST_IP}:9292/api/$1"
}

# vhost_admin_status <path> [curl args] — through the agent-panel vhost with
# the admin certificate (on the host, the vhost's name resolved to itself)
vhost_admin_status() {
  host_exec "curl -sk -o /dev/null -w '%{http_code}' --max-time 15 --resolve ${PANEL_FQDN}:443:127.0.0.1 --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key ${2:-} https://${PANEL_FQDN}$1" 2>/dev/null || echo "000"
}

vhost_admin_get() {
  host_exec "curl -skf --max-time 15 --resolve ${PANEL_FQDN}:443:127.0.0.1 --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key -H 'Accept: application/json' https://${PANEL_FQDN}$1" 2>/dev/null || echo ""
}

# vhost_agent_status <path> [curl args] — through the vhost with test-agent's certificate
vhost_agent_status() {
  agent_exec "curl -sk -o /dev/null -w '%{http_code}' --max-time 15 --resolve ${PANEL_FQDN}:443:${HOST_IP} --cert ${AGENT_CERT_PEM} --key ${AGENT_KEY_PEM} ${2:-} https://${PANEL_FQDN}$1" 2>/dev/null || echo "000"
}

# relay_loopback_status <path> [curl args] — straight to the panel tunnel's
# port on the host's loopback, as any process on the host could
relay_loopback_status() {
  host_exec "curl -s -o /dev/null -w '%{http_code}' --max-time 10 ${2:-} http://127.0.0.1:${PANEL_PORT}$1" 2>/dev/null || echo "000"
}

# agent_nobody_status <path> [curl args] — straight to the daemon on the
# agent VM, as an unprivileged local user
agent_nobody_status() {
  agent_exec "runuser -u nobody -- curl -s -o /dev/null -w '%{http_code}' --max-time 10 ${2:-} http://127.0.0.1:${PANEL_PORT}$1" 2>/dev/null || echo "000"
}

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

AGENT_LOCAL_LABEL="e2e-agent"
AGENT_CONFIG="/root/.lamalibre/lamaste/agents/${AGENT_LOCAL_LABEL}/config.json"
AGENT_CERT_PEM="/tmp/e2e-32-agent-cert.pem"
AGENT_KEY_PEM="/tmp/e2e-32-agent-key.pem"
PANEL_PORT=9393
PANEL_AGENT=""
PANEL_FQDN=""
ORIGINAL_CAPS=""
FORGED_ADMIN="-H 'X-SSL-Client-Verify: SUCCESS' -H 'X-SSL-Client-DN: CN=admin' -H 'X-SSL-Client-Serial: 01'"

begin_test "32 — Agent Panel Relay Auth (Three-VM)"

# ---------------------------------------------------------------------------
# Cleanup function — always runs on exit
# ---------------------------------------------------------------------------

cleanup() {
  log_info "Cleaning up test resources..."
  # Retract the panel tunnel and stop the daemon (the agent's own certificate)
  timed_exec 90 multipass exec lamaste-agent -- sudo bash -c "lamaste-agent panel --disable 2>/dev/null; true" > /dev/null 2>&1 || true
  if [ -n "$ORIGINAL_CAPS" ] && [ "$ORIGINAL_CAPS" != "null" ] && [ -n "$PANEL_AGENT" ]; then
    host_api_patch "certs/agent/${PANEL_AGENT}/capabilities" "{\"capabilities\":${ORIGINAL_CAPS}}" > /dev/null 2>&1 || true
  fi
  agent_exec "shred -u ${AGENT_CERT_PEM} ${AGENT_KEY_PEM} 2>/dev/null || rm -f ${AGENT_CERT_PEM} ${AGENT_KEY_PEM}" 2>/dev/null || true
  agent_exec "lamaste-agent sync --label ${AGENT_LOCAL_LABEL} 2>/dev/null || true" 2>/dev/null || true
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
log_section "Pre-flight: onboarding complete, test-agent enrolled"
# ---------------------------------------------------------------------------

ONBOARDING_STATUS=$(host_api_get "onboarding/status" | jq -r '.status' 2>/dev/null || echo "unknown")
if [ "$ONBOARDING_STATUS" != "COMPLETED" ]; then
  log_skip "Onboarding not completed (status: $ONBOARDING_STATUS) — skipping"
  end_test
  exit $?
fi
log_pass "Onboarding is complete"

# The host knows the agent by the label its enrollment token carried
PANEL_AGENT=$(agent_exec "node -p \"require('${AGENT_CONFIG}').agentLabel ?? ''\"" 2>/dev/null || echo "")
PANEL_AGENT="${PANEL_AGENT:-test-agent}"
PANEL_FQDN="agent-${PANEL_AGENT}.${TEST_DOMAIN}"

AGENTS_JSON=$(host_api_get "certs/agent" || echo '{"agents":[]}')
ORIGINAL_CAPS=$(echo "$AGENTS_JSON" | jq -c --arg l "$PANEL_AGENT" '[.agents[] | select(.label == $l and .revoked == false)] | last | .capabilities' 2>/dev/null || echo "")
if [ -z "$ORIGINAL_CAPS" ] || [ "$ORIGINAL_CAPS" = "null" ]; then
  log_fail "${PANEL_AGENT} is not an enrolled, non-revoked agent"
  end_test
  exit 1
fi
log_pass "${PANEL_AGENT} is enrolled"

# ---------------------------------------------------------------------------
log_section "Expose the real agent panel"
# ---------------------------------------------------------------------------

WITH_EXPOSE=$(echo "$ORIGINAL_CAPS" | jq -c '. + ["panel:expose"] | unique')
CAPS_RESPONSE=$(host_api_patch "certs/agent/${PANEL_AGENT}/capabilities" "{\"capabilities\":${WITH_EXPOSE}}" 2>/dev/null || echo '{}')
assert_contains "$CAPS_RESPONSE" "panel:expose" "${PANEL_AGENT} granted panel:expose" || true

# The agent VM is set up with @lamalibre/lamaste-agent only; lamaste-agentd is
# installed on demand from the registry /root/.npmrc points @lamalibre at
AGENTD_PRESENT=$(agent_exec "command -v lamaste-agentd > /dev/null 2>&1 && echo yes || echo no")
if [ "$AGENTD_PRESENT" != "yes" ]; then
  timed_exec 180 multipass exec lamaste-agent -- sudo bash -c "npm install -g @lamalibre/lamaste-agentd > /tmp/e2e-agentd-install.log 2>&1"
  AGENTD_PRESENT=$(agent_exec "command -v lamaste-agentd > /dev/null 2>&1 && echo yes || echo no")
fi
assert_eq "$AGENTD_PRESENT" "yes" "lamaste-agentd is installed on the agent VM" || true

# A daemon left running local-only would make `panel --enable` return early
# without exposing it
timed_exec 60 multipass exec lamaste-agent -- sudo bash -c "lamaste-agent panel --disable --local-only 2>/dev/null; true" > /dev/null 2>&1 || true
ENABLE_OUT=$(timed_exec 120 multipass exec lamaste-agent -- sudo bash -c "lamaste-agent panel --enable --port ${PANEL_PORT} --json 2>/dev/null" || echo '{}')
assert_json_field "$ENABLE_OUT" '.ok' 'true' "lamaste-agent panel --enable exposed the panel" || true

# The CLI converges at once; allow the sync timer as a fallback
TUNNEL_READY=false
for _ in $(seq 1 30); do
  HEALTH=$(host_exec "curl -sf --max-time 3 http://127.0.0.1:${PANEL_PORT}/api/health 2>/dev/null" || echo "")
  if echo "$HEALTH" | jq -e '.status == "ok"' &>/dev/null; then
    TUNNEL_READY=true
    break
  fi
  sleep 2
done
if [ "$TUNNEL_READY" = "true" ]; then
  log_pass "The panel tunnel reaches lamaste-agentd from the host's loopback"
else
  log_fail "lamaste-agentd not reachable through the panel tunnel after 60 seconds"
  end_test
  exit 1
fi

# ---------------------------------------------------------------------------
log_section "The vhost, the signing key, the public key"
# ---------------------------------------------------------------------------

PANEL_VHOST="/etc/nginx/sites-available/lamalibre-lamaste-agent-panel-${PANEL_FQDN}"
VHOST_AUTHZ=$(host_exec "grep -cF 'auth_request /internal/lamaste/agent-panel-authz;' ${PANEL_VHOST} 2>/dev/null || true")
assert_eq "$VHOST_AUTHZ" "1" "Panel vhost asks the panel to authorize every request" || true

KEY_MODE=$(host_exec "stat -c '%a %U' /etc/lamalibre/lamaste/relay-signing-key.json 2>/dev/null" || echo "")
assert_eq "$KEY_MODE" "600 lamaste" "Relay signing key is 0600 and the panel user's" || true

# test-agent's certificate, extracted from its P12 (0600 PEMs, removed on exit)
agent_exec "P12=\$(node -p \"require('${AGENT_CONFIG}').p12Path\"); PW=\$(node -p \"require('${AGENT_CONFIG}').p12Password\"); umask 077; \
  openssl pkcs12 -in \"\$P12\" -clcerts -nokeys -out '${AGENT_CERT_PEM}' -passin \"pass:\$PW\" -legacy 2>/dev/null || \
  openssl pkcs12 -in \"\$P12\" -clcerts -nokeys -out '${AGENT_CERT_PEM}' -passin \"pass:\$PW\"; \
  openssl pkcs12 -in \"\$P12\" -nocerts -nodes -out '${AGENT_KEY_PEM}' -passin \"pass:\$PW\" -legacy 2>/dev/null || \
  openssl pkcs12 -in \"\$P12\" -nocerts -nodes -out '${AGENT_KEY_PEM}' -passin \"pass:\$PW\"" 2>/dev/null || true

RELAY_KEYS=$(agent_api_get "agents/me/relay-keys" || echo '{}')
assert_json_field "$RELAY_KEYS" '.keys | length' '1' "The agent reads the relay's public key" || true

# ---------------------------------------------------------------------------
log_section "Through the vhost: relay assertions"
# ---------------------------------------------------------------------------

STATUS_JSON=$(vhost_admin_get "/api/status")
assert_json_field "$STATUS_JSON" '.installed' 'true' "Admin certificate: /api/status answered by lamaste-agentd" || true
assert_eq "$(vhost_admin_status /api/plugins)" "200" "Admin certificate: owner-only /api/plugins → 200" || true

# nginx sets the assertion itself: one a client sends never reaches the daemon
assert_eq "$(vhost_admin_status /api/plugins "-H 'X-Lamalibre-Relay-Assertion: forged.assertion'")" \
  "200" "A client-sent assertion header is replaced by the panel's" || true

assert_eq "$(vhost_agent_status /api/status)" "200" "${PANEL_AGENT}'s certificate: /api/status → 200" || true
assert_eq "$(vhost_agent_status /api/plugins)" "403" "${PANEL_AGENT}'s certificate: owner-only /api/plugins → 403" || true
assert_eq "$(vhost_agent_status /api/plugins "${FORGED_ADMIN}")" \
  "403" "${PANEL_AGENT}'s certificate claiming admin in headers is still ${PANEL_AGENT}" || true

# ---------------------------------------------------------------------------
log_section "From the host's loopback: no header is proof"
# ---------------------------------------------------------------------------

assert_eq "$(relay_loopback_status /api/plugins "${FORGED_ADMIN}")" "401" "Forged admin certificate headers → 401" || true
assert_eq "$(relay_loopback_status /api/plugins/install "${FORGED_ADMIN} -X POST -H 'Content-Type: application/json' -d '{}'")" \
  "401" "Forged admin headers cannot reach plugin install → 401" || true
assert_eq "$(relay_loopback_status /api/status "-H 'Remote-User: admin' -H 'Remote-Groups: admins'")" \
  "401" "Forged Authelia identity headers → 401" || true
assert_eq "$(relay_loopback_status /api/status "-H 'X-Lamalibre-Relay-Assertion: forged.assertion'")" \
  "401" "Made-up relay assertion → 401" || true
assert_eq "$(relay_loopback_status /%61pi/status)" "401" "Percent-escaped /api path → 401" || true

# ---------------------------------------------------------------------------
log_section "On the agent VM, as an unprivileged user: no header is proof"
# ---------------------------------------------------------------------------

assert_eq "$(agent_nobody_status /api/plugins "${FORGED_ADMIN}")" "401" "Forged admin certificate headers → 401" || true
assert_eq "$(agent_nobody_status /api/status "-H 'Remote-User: admin'")" "401" "Forged Remote-User → 401" || true
assert_eq "$(agent_nobody_status /%61pi/status)" "401" "Percent-escaped /api path → 401" || true

TOKEN_READ=$(agent_exec "runuser -u nobody -- cat /root/.lamalibre/lamaste/agentd.token > /dev/null 2>&1 && echo readable || echo denied")
assert_eq "$TOKEN_READ" "denied" "agentd.token is not readable by other users" || true

end_test

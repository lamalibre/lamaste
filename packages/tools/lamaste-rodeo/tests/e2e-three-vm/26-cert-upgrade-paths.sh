#!/usr/bin/env bash
# ============================================================================
# 26 — Cert Upgrade Paths (Three-VM)
# ============================================================================
# 26 — Agent Certificate Upgrade Paths (Three-VM)
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "/Users/onurdevrimvatan/lama/repositories/lamalibre/lamaste/packages/tools/lamaste-rodeo/tests/e2e/helpers.sh"

require_commands multipass curl jq openssl

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


begin_test "26 — Cert Upgrade Paths (Three-VM)"

# ---------------------------------------------------------------------------
# Cleanup function — always runs on exit
# ---------------------------------------------------------------------------

cleanup() {
  log_info "Cleaning up test resources..."
  host_exec "curl -sk --max-time 10 --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key --cacert /etc/lamalibre/lamaste/pki/ca.crt -X DELETE https://127.0.0.1:9292/api/certs/agent/cert-upgrade-agent 2>/dev/null || true" 2>/dev/null || true
  host_exec "SID=\$(curl -skf --max-time 10 --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key --cacert /etc/lamalibre/lamaste/pki/ca.crt https://127.0.0.1:9292/api/sites 2>/dev/null | jq -r '.sites[] | select(.name==\"cert-upgrade-site\") | .id' | head -n1); [ -n \"\$SID\" ] && curl -sk --max-time 10 --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key --cacert /etc/lamalibre/lamaste/pki/ca.crt -X DELETE https://127.0.0.1:9292/api/sites/\$SID 2>/dev/null || true" 2>/dev/null || true
  host_exec "rm -f /tmp/e2e-26-*.pem /tmp/e2e-26-*.key /tmp/e2e-26-*.csr /tmp/e2e-26-*.crt /tmp/e2e-26-*.json /tmp/e2e-26-p12pass 2>/dev/null || true" 2>/dev/null || true
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
log_section "Pre-flight: verify onboarding is complete"
# ---------------------------------------------------------------------------

ONBOARDING_STATUS=$(host_api_get "onboarding/status" | jq -r '.status' 2>/dev/null || echo "")
assert_eq "$ONBOARDING_STATUS" "COMPLETED" "Onboarding must be COMPLETED for cert upgrade path tests" || true

# ---------------------------------------------------------------------------
log_section "Clear any stale test state from previous runs"
# ---------------------------------------------------------------------------

PRECLEAN_SITE=$(host_exec "SID=\$(curl -skf --max-time 10 --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key --cacert /etc/lamalibre/lamaste/pki/ca.crt https://127.0.0.1:9292/api/sites 2>/dev/null | jq -r '.sites[] | select(.name==\"cert-upgrade-site\") | .id' | head -n1); if [ -n \"\$SID\" ]; then curl -sk --max-time 10 --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key --cacert /etc/lamalibre/lamaste/pki/ca.crt -X DELETE https://127.0.0.1:9292/api/sites/\$SID > /dev/null 2>&1 || true; fi; echo done") || true
PRECLEAN_AGENT=$(host_exec "curl -sk --max-time 10 --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key --cacert /etc/lamalibre/lamaste/pki/ca.crt -X DELETE https://127.0.0.1:9292/api/certs/agent/cert-upgrade-agent > /dev/null 2>&1 || true; echo done") || true

# ---------------------------------------------------------------------------
log_section "Create fixture site for allowed-sites scoping"
# ---------------------------------------------------------------------------

SITE_RESPONSE=$(host_exec "curl -sk --max-time 30 --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key --cacert /etc/lamalibre/lamaste/pki/ca.crt -X POST -H 'Content-Type: application/json' -H 'Accept: application/json' -d '{\"name\":\"cert-upgrade-site\",\"type\":\"managed\",\"spaMode\":false,\"autheliaProtected\":false}' https://127.0.0.1:9292/api/sites 2>/dev/null || echo '{\"ok\":false}'")
assert_json_field "$SITE_RESPONSE" '.ok' 'true' "Fixture site created (ok: true)" || true

# ---------------------------------------------------------------------------
log_section "Create agent cert (p12) with tunnels:read"
# ---------------------------------------------------------------------------

CERT_RESPONSE=$(host_exec "curl -sk --max-time 30 --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key --cacert /etc/lamalibre/lamaste/pki/ca.crt -X POST -H 'Content-Type: application/json' -H 'Accept: application/json' -d '{\"label\":\"cert-upgrade-agent\",\"capabilities\":[\"tunnels:read\"],\"allowedSites\":[]}' https://127.0.0.1:9292/api/certs/agent 2>/dev/null || echo '{\"ok\":false}'")
assert_json_field "$CERT_RESPONSE" '.ok' 'true' "Agent cert creation returned ok: true" || true
OLD_SERIAL=$(echo "$CERT_RESPONSE" | jq -r '.serial' 2>/dev/null || echo "")
P12_PASSWORD=$(echo "$CERT_RESPONSE" | jq -r '.p12Password' 2>/dev/null || echo "")
multipass exec lamaste-host -- sudo bash -c "echo -n '$P12_PASSWORD' > /tmp/e2e-26-p12pass && chmod 0600 /tmp/e2e-26-p12pass"
host_exec "openssl pkcs12 -in /etc/lamalibre/lamaste/pki/agents/cert-upgrade-agent/client.p12 -clcerts -nokeys -out /tmp/e2e-26-cert.pem -passin file:/tmp/e2e-26-p12pass -legacy 2>/dev/null || openssl pkcs12 -in /etc/lamalibre/lamaste/pki/agents/cert-upgrade-agent/client.p12 -clcerts -nokeys -out /tmp/e2e-26-cert.pem -passin file:/tmp/e2e-26-p12pass"
host_exec "openssl pkcs12 -in /etc/lamalibre/lamaste/pki/agents/cert-upgrade-agent/client.p12 -nocerts -nodes -out /tmp/e2e-26-key.pem -passin file:/tmp/e2e-26-p12pass -legacy 2>/dev/null || openssl pkcs12 -in /etc/lamalibre/lamaste/pki/agents/cert-upgrade-agent/client.p12 -nocerts -nodes -out /tmp/e2e-26-key.pem -passin file:/tmp/e2e-26-p12pass"
host_exec "chmod 0600 /tmp/e2e-26-key.pem && rm -f /tmp/e2e-26-p12pass"

# ---------------------------------------------------------------------------
log_section "Agent upgrade-cert: generate new CSR, post with agent cert, assert new cert issued"
# ---------------------------------------------------------------------------

REVOKED_JSON_BEFORE=$(host_exec "cat /etc/lamalibre/lamaste/pki/revoked.json 2>/dev/null || echo '{\"revoked\":[]}'")
REVOKED_BEFORE_COUNT=$(echo "$REVOKED_JSON_BEFORE" | jq -r '[.revoked[]? | select(.label | startswith("agent:cert-upgrade-agent"))] | length' 2>/dev/null || echo "")
host_exec "openssl genrsa -out /tmp/e2e-26-new.key 2048 2>/dev/null"
host_exec "openssl req -new -key /tmp/e2e-26-new.key -out /tmp/e2e-26-new.csr -subj '/CN=agent:cert-upgrade-agent/O=Lamaste' 2>/dev/null"
BUILD_BODY_OK=$(host_exec "jq -n --arg csr \"\$(cat /tmp/e2e-26-new.csr)\" '{csr: \$csr}' > /tmp/e2e-26-upgrade-body.json && echo ok")
UPGRADE_RESPONSE=$(host_exec "curl -sk --max-time 30 --cert /tmp/e2e-26-cert.pem --key /tmp/e2e-26-key.pem --cacert /etc/lamalibre/lamaste/pki/ca.crt -X POST -H 'Content-Type: application/json' -H 'Accept: application/json' -d @/tmp/e2e-26-upgrade-body.json https://127.0.0.1:9292/api/certs/agent/upgrade-cert 2>/dev/null || echo '{\"ok\":false,\"error\":\"curl failed\"}'")
assert_json_field "$UPGRADE_RESPONSE" '.ok' 'true' "upgrade-cert returned ok: true" || true
NEW_SERIAL=$(echo "$UPGRADE_RESPONSE" | jq -r '.serial // ""' 2>/dev/null || echo "")
assert_not_eq "$NEW_SERIAL" "" "upgrade-cert returns a new certificate serial" || true
assert_not_eq "$NEW_SERIAL" "$OLD_SERIAL" "upgrade-cert issues a cert with a different serial than the old one" || true
assert_contains "$UPGRADE_RESPONSE" "BEGIN CERTIFICATE" "upgrade-cert response contains a signed certificate PEM" || true
AGENTS_LIST=$(host_api_get "certs/agent")
NEW_METHOD=$(echo "$AGENTS_LIST" | jq -r '[.agents[] | select(.label=="cert-upgrade-agent" and .revoked==false)] | last | .enrollmentMethod // "unknown"')
assert_eq "$NEW_METHOD" "hardware-bound" "After upgrade-cert, agent registry shows enrollmentMethod=hardware-bound" || true
REVOKED_JSON_AFTER=$(host_exec "cat /etc/lamalibre/lamaste/pki/revoked.json 2>/dev/null || echo '{\"revoked\":[]}'")
REVOKED_AFTER_COUNT=$(echo "$REVOKED_JSON_AFTER" | jq -r '[.revoked[]? | select(.label | startswith("agent:cert-upgrade-agent"))] | length' 2>/dev/null || echo "")
REVOKED_DELTA=$(echo $(( REVOKED_AFTER_COUNT - REVOKED_BEFORE_COUNT )))
assert_not_eq "$REVOKED_DELTA" "0" "Old agent cert has been revoked during upgrade (revoked.json count grew)" || true

# ---------------------------------------------------------------------------
log_section "enroll-delegated: validate role guards"
# ---------------------------------------------------------------------------

DELEGATED_ADMIN_STATUS=$(host_exec "curl -sk -o /dev/null -w '%{http_code}' --max-time 30 --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key --cacert /etc/lamalibre/lamaste/pki/ca.crt -X POST -H 'Content-Type: application/json' -H 'Accept: application/json' -d '{\"pluginAgentLabel\":\"never-used\",\"scope\":\"plugin:noop\"}' https://127.0.0.1:9292/api/certs/agent/enroll-delegated 2>/dev/null || echo 000")
assert_eq "$DELEGATED_ADMIN_STATUS" "403" "enroll-delegated rejects admin cert with 403 (route requires agent role)" || true
host_exec "cp /tmp/e2e-26-new.key /tmp/e2e-26-agent.key && chmod 0600 /tmp/e2e-26-agent.key"
LOCAL_CERT_PATH=$(LOCAL_CERT=$(mktemp /tmp/e2e-26-agent-cert-XXXXXXXX.crt) && echo "$UPGRADE_RESPONSE" | jq -r '.cert' > "$LOCAL_CERT" && echo "$LOCAL_CERT")
NEW_CERT_WRITTEN=$(multipass transfer "$LOCAL_CERT_PATH" lamaste-host:/tmp/e2e-26-agent.crt && multipass exec lamaste-host -- sudo chmod 0644 /tmp/e2e-26-agent.crt && rm -f "$LOCAL_CERT_PATH" && echo ok)
assert_eq "$NEW_CERT_WRITTEN" "ok" "New cert PEM successfully written to host" || true
DELEGATED_AGENT_STATUS=$(host_exec "curl -sk -o /dev/null -w '%{http_code}' --max-time 30 --cert /tmp/e2e-26-agent.crt --key /tmp/e2e-26-agent.key --cacert /etc/lamalibre/lamaste/pki/ca.crt -X POST -H 'Content-Type: application/json' -H 'Accept: application/json' -d '{\"pluginAgentLabel\":\"never-used\",\"scope\":\"plugin:noop\"}' https://127.0.0.1:9292/api/certs/agent/enroll-delegated 2>/dev/null || echo 000")
assert_contains "$DELEGATED_AGENT_STATUS" "4" "enroll-delegated returns 4xx for agent without ticket scope/instance" || true
log_info "enroll-delegated with agent cert (no ticket instance) returned HTTP $DELEGATED_AGENT_STATUS"

# ---------------------------------------------------------------------------
log_section "PATCH /certs/agent/:label/allowed-sites"
# ---------------------------------------------------------------------------

PATCH_EMPTY=$(host_api_patch "certs/agent/cert-upgrade-agent/allowed-sites" "{\"allowedSites\":[]}")
assert_json_field "$PATCH_EMPTY" '.ok' 'true' "PATCH allowed-sites=[] returned ok: true" || true
assert_json_field "$PATCH_EMPTY" '.label' 'cert-upgrade-agent' "PATCH allowed-sites response echoes agent label" || true
PATCH_FIXTURE=$(host_api_patch "certs/agent/cert-upgrade-agent/allowed-sites" "{\"allowedSites\":[\"cert-upgrade-site\"]}")
assert_json_field "$PATCH_FIXTURE" '.ok' 'true' "PATCH allowed-sites=[cert-upgrade-site] returned ok: true" || true
assert_json_field "$PATCH_FIXTURE" '.allowedSites[0]' 'cert-upgrade-site' "PATCH allowed-sites response lists the fixture site" || true
AGENTS_AFTER_PATCH=$(host_api_get "certs/agent")
PERSISTED_SITE=$(echo "$AGENTS_AFTER_PATCH" | jq -r '[.agents[] | select(.label=="cert-upgrade-agent" and .revoked==false)] | last | .allowedSites[0] // ""')
assert_eq "$PERSISTED_SITE" "cert-upgrade-site" "allowedSites persists to agent registry after PATCH" || true
INVALID_PATCH_STATUS=$(host_exec "curl -sk -o /dev/null -w '%{http_code}' --max-time 30 --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key --cacert /etc/lamalibre/lamaste/pki/ca.crt -X PATCH -H 'Content-Type: application/json' -H 'Accept: application/json' -d '{\"allowedSites\":[\"INVALID-UPPERCASE\"]}' https://127.0.0.1:9292/api/certs/agent/cert-upgrade-agent/allowed-sites 2>/dev/null || echo 000")
assert_eq "$INVALID_PATCH_STATUS" "400" "PATCH allowed-sites rejects uppercase site names with 400 (Zod regex validation)" || true
UNKNOWN_PATCH_STATUS=$(host_exec "curl -sk -o /dev/null -w '%{http_code}' --max-time 30 --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key --cacert /etc/lamalibre/lamaste/pki/ca.crt -X PATCH -H 'Content-Type: application/json' -H 'Accept: application/json' -d '{\"allowedSites\":[]}' https://127.0.0.1:9292/api/certs/agent/does-not-exist-26/allowed-sites 2>/dev/null || echo 000")
assert_eq "$UNKNOWN_PATCH_STATUS" "404" "PATCH allowed-sites on unknown label returns 404" || true

end_test

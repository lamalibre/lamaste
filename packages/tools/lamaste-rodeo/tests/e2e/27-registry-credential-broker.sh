#!/usr/bin/env bash
# ============================================================================
# 27 — Registry credential broker (Feria stand-in)
# ============================================================================
# Runs a stand-in Feria on the VM, enrolls a throwaway agent (token → CSR →
# POST /api/enroll, revoked at the end) and verifies how the panel brokers
# npm registry tokens for agents:
# - `registry-credential set --oidc`: the panel registers its own
#   lamaste-server client in Authelia, obtains a client-credentials JWT,
#   logs in at the registry and stores the credential only after whoami
#   reports the read and admin scopes; a workload rule granting admin alone
#   is refused when the credential is set, not at the first install
# - GET /api/agents/me/registry-credential hands the agent a read token owned
#   by agent:<label> that expires within an hour, created by the panel's
#   OIDC identity; a second call reuses it
# - the per-agent issuance limit answers 429 with Retry-After
# The agent-daemon install path (isolated npm userconfig) needs a machine
# set up with lamaste-agent; the three-VM spec 10 covers it.
# - `--token-stdin` is the explicit fallback; `clear` removes everything
# ============================================================================

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/helpers.sh"

require_commands curl jq node npm openssl lamaste-server

begin_test "27 — Registry credential broker"

# ---------------------------------------------------------------------------
log_section "Pre-flight: check onboarding is complete"
# ---------------------------------------------------------------------------

ONBOARDING_STATUS=$(api_get "onboarding/status" | jq -r '.status' 2>/dev/null || echo "unknown")
if [ "$ONBOARDING_STATUS" != "COMPLETED" ]; then
  log_skip "Onboarding not completed — skipping registry credential tests"
  end_test
  exit $?
fi
log_pass "Onboarding is complete"

DOMAIN=$(api_get "onboarding/status" | jq -r '.domain' 2>/dev/null || echo "null")
if [ -z "$DOMAIN" ] || [ "$DOMAIN" = "null" ]; then
  log_skip "No domain configured — skipping"
  end_test
  exit $?
fi

STATE_DIR="/etc/lamalibre/lamaste"
WORK_DIR="/tmp/lamalibre-lamaste-e2e-broker"
STUB_PORT=4874
STUB_URL="http://127.0.0.1:${STUB_PORT}"
STUB_ADMIN_TOKEN="feria_e2eadmin_broker_00000000000000000"
AGENT_LABEL="e2e-broker-$(date +%s)"
AGENT_CERT="${WORK_DIR}/agent.crt"
AGENT_KEY="${WORK_DIR}/agent.key"

# stub_get path / stub_post path body — the stand-in registry as its admin
stub_get() {
  curl -s --max-time 15 -H "Authorization: Bearer ${STUB_ADMIN_TOKEN}" "${STUB_URL}/$1"
}
stub_post() {
  curl -s --max-time 15 -H "Authorization: Bearer ${STUB_ADMIN_TOKEN}" -X POST -H "Content-Type: application/json" -d "$2" "${STUB_URL}/$1"
}

# agent_get path — the panel API as the agent (mTLS)
agent_get() {
  curl -s --max-time "$CURL_TIMEOUT" --insecure --cert "$AGENT_CERT" --key "$AGENT_KEY" --cacert "$CA_PATH" -H "Accept: application/json" "${BASE_URL}/api/$1"
}
agent_get_status() {
  curl -s --max-time "$CURL_TIMEOUT" --insecure --cert "$AGENT_CERT" --key "$AGENT_KEY" --cacert "$CA_PATH" -o /dev/null -w '%{http_code}' "${BASE_URL}/api/$1" 2>/dev/null || echo "000"
}

cleanup() {
  lamaste-server registry-credential clear > /dev/null 2>&1 || true
  api_delete "certs/agent/${AGENT_LABEL}" > /dev/null 2>&1 || true
  pkill -f '[s]tub-registry.mjs' 2>/dev/null || true
  rm -rf "${WORK_DIR}"
}
trap cleanup EXIT

# ===========================================================================
# 0. A throwaway agent: enrollment token → CSR → public enrollment
# ===========================================================================

log_section "Enroll a throwaway agent"

rm -rf "${WORK_DIR}"
mkdir -p "${WORK_DIR}"
TOKEN_RESPONSE=$(api_post "certs/agent/enroll" "{\"label\":\"${AGENT_LABEL}\",\"capabilities\":[\"tunnels:read\"]}")
ENROLL_TOKEN=$(echo "$TOKEN_RESPONSE" | jq -r '.token // empty' 2>/dev/null || echo "")
assert_not_eq "$ENROLL_TOKEN" "" "Enrollment token issued for ${AGENT_LABEL}" || true

openssl genrsa -out "$AGENT_KEY" 2048 2>/dev/null
openssl req -new -key "$AGENT_KEY" -out "${WORK_DIR}/agent.csr" -subj "/CN=agent:${AGENT_LABEL}/O=Lamaste" 2>/dev/null
ENROLL_RESPONSE=$(curl -s --max-time "$CURL_TIMEOUT" --insecure -X POST -H "Content-Type: application/json" \
  -d "{\"token\":\"${ENROLL_TOKEN}\",\"csr\":$(jq -Rs . < "${WORK_DIR}/agent.csr")}" \
  "${BASE_URL}/api/enroll" 2>/dev/null || echo '{"error":"request failed"}')
assert_json_field "$ENROLL_RESPONSE" '.ok' 'true' "Agent enrolled through POST /api/enroll" || true
assert_json_field "$ENROLL_RESPONSE" '.label' "${AGENT_LABEL}" "Certificate issued for the agent label" || true
echo "$ENROLL_RESPONSE" | jq -r '.cert // empty' > "$AGENT_CERT"
if [ ! -s "$AGENT_CERT" ]; then
  log_fail "No certificate in the enrollment response — cannot continue"
  end_test
  exit $?
fi
chmod 600 "$AGENT_KEY"
CERT_CN=$(openssl x509 -in "$AGENT_CERT" -noout -subject 2>/dev/null | sed -n 's/.*CN *= *\([^,/]*\).*/\1/p')
assert_eq "$CERT_CN" "agent:${AGENT_LABEL}" "Certificate CN is agent:${AGENT_LABEL}" || true
log_info "Agent label: ${AGENT_LABEL}"

# ===========================================================================
# 1. Stand-in registry
# ===========================================================================

log_section "Stand-in registry"

write_oidc_fixture_plugin "${WORK_DIR}/fixture"
if start_stub_registry "${WORK_DIR}" "${WORK_DIR}/fixture"; then
  log_pass "Stand-in registry is up on ${STUB_URL}"
else
  log_fail "Stand-in registry did not start: $(cat "${WORK_DIR}/stub.log" 2>/dev/null)"
  end_test
  exit $?
fi

NO_CREDENTIAL_STATUS=$(agent_get_status "agents/me/registry-credential")
assert_eq "$NO_CREDENTIAL_STATUS" "404" "Without a credential the agent is told there is none" || true

# ===========================================================================
# 2. registry-credential set --oidc: the panel's own Authelia client
# ===========================================================================

log_section "registry-credential set --oidc"

# A workload rule that grants admin but not read let the panel broker agent
# tokens while its own installs failed with 403; the panel refuses it now.
stub_post "-/e2e/config" '{"workloadScopes":["admin"]}' > /dev/null
REFUSED_OUTPUT=$(timed_exec 120 lamaste-server registry-credential set --url "${STUB_URL}" --oidc --json 2>&1 || true)
assert_contains "$REFUSED_OUTPUT" "missing: read" "A registry identity without the read scope is refused ($(echo "$REFUSED_OUTPUT" | tail -c 300))" || true
REFUSED_SHOW=$(lamaste-server registry-credential show --json 2>/dev/null | grep -E '^\{' | tail -1 || echo "{}")
assert_json_field "$REFUSED_SHOW" '.configured' 'false' "...and nothing is stored" || true
REFUSED_CLIENT=$(grep -c 'client_id: lamaste-server' /etc/authelia/configuration.yml || true)
assert_eq "$REFUSED_CLIENT" "0" "...and the lamaste-server client is removed from Authelia again" || true
WORKLOAD_RESET=$(stub_post "-/e2e/config" '{"workloadScopes":["read","admin"]}' | jq -c '.workloadScopes' 2>/dev/null || echo "")
assert_eq "$WORKLOAD_RESET" '["read","admin"]' "The stand-in grants the documented workload scopes again" || true

SET_OUTPUT=$(timed_exec 120 lamaste-server registry-credential set --url "${STUB_URL}" --oidc --json 2>&1 || true)
SET_JSON=$(echo "$SET_OUTPUT" | grep -E '^\{' | tail -1 || echo "{}")
assert_json_field "$SET_JSON" '.configured' 'true' "Credential configured through the OIDC chain ($(echo "$SET_OUTPUT" | tail -c 300))" || true
assert_json_field "$SET_JSON" '.auth' 'oidc' "Auth kind is oidc" || true
assert_json_field "$SET_JSON" '.clientId' 'lamaste-server' "Client id is lamaste-server" || true
assert_json_field "$SET_JSON" '.owner' "ci:auth.${DOMAIN}/lamaste-server" "The registry identified the panel as ci:auth.${DOMAIN}/lamaste-server" || true

SHOW_JSON=$(lamaste-server registry-credential show --json 2>/dev/null | grep -E '^\{' | tail -1 || echo "{}")
assert_json_field "$SHOW_JSON" '.auth' 'oidc' "show reports the oidc credential" || true
assert_not_contains "$SHOW_JSON" "feria_" "show never carries a token" || true

CONFIG_YML=$(cat /etc/authelia/configuration.yml)
assert_contains "$CONFIG_YML" "client_id: lamaste-server" "Authelia carries the lamaste-server client" || true
assert_contains "$CONFIG_YML" "lamaste.registry" "The lamaste.registry scope is defined" || true
assert_contains "$CONFIG_YML" "- ${STUB_URL}" "The registry is the client's audience" || true
LAMASTE_SECRET_PLUGIN=$(jq -r '.clients["lamaste-server"].plugin // empty' "${STATE_DIR}/oidc-clients.json" 2>/dev/null || echo "")
assert_eq "$LAMASTE_SECRET_PLUGIN" "lamaste" "The client secret is stored for the panel" || true

LOGIN_SEEN=$(stub_get "-/e2e/requests" | jq '[.requests[] | select(.path == "/-/feria/login")] | length' 2>/dev/null || echo "0")
assert_not_eq "$LOGIN_SEEN" "0" "The panel logged in at the registry with its JWT" || true
WHOAMI_SEEN=$(stub_get "-/e2e/requests" | jq '[.requests[] | select(.path == "/-/whoami" and .owner == "ci:auth.'"${DOMAIN}"'/lamaste-server")] | length' 2>/dev/null || echo "0")
assert_not_eq "$WHOAMI_SEEN" "0" "The panel verified its identity with whoami" || true

# ===========================================================================
# 3. The agent gets a token owned by agent:<label>
# ===========================================================================

log_section "Agent registry credential"

CRED_1=$(agent_get "agents/me/registry-credential")
assert_json_field "$CRED_1" '.registryUrl' "${STUB_URL}/" "Credential points at the registry" || true
assert_json_field "$CRED_1" '.scope' '@lamalibre' "Credential scope is @lamalibre" || true
TOKEN_1=$(echo "$CRED_1" | jq -r '.token // empty')
TOKEN_ID_1=$(echo "$CRED_1" | jq -r '.tokenId // empty')
EXPIRES_1=$(echo "$CRED_1" | jq -r '.expiresAt // empty')
assert_not_eq "$TOKEN_1" "" "The agent received a token" || true
if [ -n "$EXPIRES_1" ]; then
  LIFETIME=$(( $(date -d "$EXPIRES_1" +%s) - $(date +%s) ))
  if [ "$LIFETIME" -gt 0 ] && [ "$LIFETIME" -le 3600 ]; then
    log_pass "Token expires within an hour (${LIFETIME}s)"
  else
    log_fail "Token lifetime out of range: ${LIFETIME}s"
  fi
fi

OWNED=$(stub_get "-/feria/tokens?owner=agent:${AGENT_LABEL}")
assert_json_field "$OWNED" '.tokens | length' '1' "The registry holds one token for agent:${AGENT_LABEL}" || true
assert_json_field "$OWNED" '.tokens[0].kind' 'agent' "Token kind is agent" || true
assert_json_field "$OWNED" '.tokens[0].scopes | join(",")' 'read' "Token scope is read only" || true
assert_json_field "$OWNED" '.tokens[0].createdBy' "ci:auth.${DOMAIN}/lamaste-server" "Brokered by the panel's OIDC identity" || true

CRED_2=$(agent_get "agents/me/registry-credential")
assert_json_field "$CRED_2" '.tokenId' "$TOKEN_ID_1" "A second call within the hour returns the same token" || true

ADMIN_CRED_STATUS=$(api_get_status "agents/me/registry-credential")
assert_eq "$ADMIN_CRED_STATUS" "403" "An admin certificate has no agent credential" || true

# ===========================================================================
# 4. Agent-daemon install path
# ===========================================================================

log_section "Agent-daemon install path"

# The throwaway agent has no lamaste-agent setup on this host, so the agent
# daemon cannot run an install here; the three-VM spec 10 installs the
# fixture plugin on the real agent VM through the brokered token.
log_skip "Agent-daemon plugin install through the broker is covered by three-VM spec 10 (no lamaste-agent setup for ${AGENT_LABEL} on this host)"

# ===========================================================================
# 5. Per-agent issuance limit
# ===========================================================================

log_section "Per-agent issuance limit"

# Short-lived tokens are never good for an install, so every call brokers a
# new one. The panel still holds the one-hour token from section 3 for this
# agent (good until five minutes before expiry), so the credential is set
# again first — an operator's reconfiguration drops every cached token and
# the issuance records — and then the eleventh new token this hour is
# refused.
TTL_SET=$(stub_post "-/e2e/config" '{"agentTokenTtlSeconds":240}')
assert_json_field "$TTL_SET" '.agentTokenTtlSeconds' '240' "Registry now issues 4-minute agent tokens" || true
RESET_OUTPUT=$(timed_exec 120 lamaste-server registry-credential set --url "${STUB_URL}" --oidc --json 2>&1 || true)
RESET_JSON=$(echo "$RESET_OUTPUT" | grep -E '^\{' | tail -1 || echo "{}")
assert_json_field "$RESET_JSON" '.configured' 'true' "Credential set again — the panel's broker cache is reset" || true

STATUSES=""
RETRY_AFTER=""
for i in $(seq 1 12); do
  RESPONSE_HEADERS="${WORK_DIR}/headers-${i}.txt"
  STATUS=$(curl -s --max-time "$CURL_TIMEOUT" --insecure --cert "$AGENT_CERT" --key "$AGENT_KEY" --cacert "$CA_PATH" \
    -D "$RESPONSE_HEADERS" -o /dev/null -w '%{http_code}' "${BASE_URL}/api/agents/me/registry-credential" 2>/dev/null || echo "000")
  STATUSES="${STATUSES}${STATUS} "
  if [ "$STATUS" = "429" ] && [ -z "$RETRY_AFTER" ]; then
    RETRY_AFTER=$(grep -i '^retry-after:' "$RESPONSE_HEADERS" | awk '{print $2}' | tr -d '\r')
  fi
done
log_info "Statuses: ${STATUSES}"
assert_contains "$STATUSES" "429" "The eleventh new token in an hour is refused with 429" || true
assert_not_eq "$RETRY_AFTER" "" "429 carries Retry-After (${RETRY_AFTER}s)" || true
OK_COUNT=$(echo "$STATUSES" | tr ' ' '\n' | grep -c '^200$' || true)
assert_eq "$OK_COUNT" "10" "Ten tokens were issued before the limit (ten per hour)" || true

# Section 3 issued one token (its second call reused it); this loop ten more.
ISSUED_TOTAL=$(stub_get "-/feria/tokens?owner=agent:${AGENT_LABEL}" | jq '.tokens | length')
assert_eq "$ISSUED_TOTAL" "11" "The registry issued exactly eleven tokens for the agent (1 + 10)" || true

# ===========================================================================
# 6. --token-stdin fallback and clear
# ===========================================================================

log_section "Long-lived token fallback and clear"

TOKEN_SET_JSON=$(printf '%s' "${STUB_ADMIN_TOKEN}" | lamaste-server registry-credential set --url "${STUB_URL}" --token-stdin --json 2>/dev/null | grep -E '^\{' | tail -1 || echo "{}")
assert_json_field "$TOKEN_SET_JSON" '.configured' 'true' "Credential configured with a pasted token" || true
assert_json_field "$TOKEN_SET_JSON" '.auth' 'token' "Auth kind is token" || true
assert_json_field "$TOKEN_SET_JSON" '.owner' 'machine:e2e-admin' "The registry identified the pasted token" || true
LAMASTE_CLIENT_AFTER=$(grep -c 'client_id: lamaste-server' /etc/authelia/configuration.yml || true)
assert_eq "$LAMASTE_CLIENT_AFTER" "0" "Switching to a pasted token removes the lamaste-server client from Authelia" || true
LAMASTE_SECRET_AFTER=$(jq -r '.clients | has("lamaste-server")' "${STATE_DIR}/oidc-clients.json" 2>/dev/null || echo "false")
assert_eq "$LAMASTE_SECRET_AFTER" "false" "...and deletes its secret" || true

# Reconfiguring resets the per-agent budget and cache.
stub_post "-/e2e/config" '{"agentTokenTtlSeconds":3600}' > /dev/null
CRED_3=$(agent_get "agents/me/registry-credential")
TOKEN_3=$(echo "$CRED_3" | jq -r '.token // empty')
assert_not_eq "$TOKEN_3" "" "The agent gets a token again after the reconfiguration" || true
assert_not_eq "$TOKEN_3" "$TOKEN_1" "...a new one" || true
CREATED_BY_3=$(stub_get "-/feria/tokens?owner=agent:${AGENT_LABEL}" | jq -r '.tokens[-1].createdBy')
assert_eq "$CREATED_BY_3" "machine:e2e-admin" "Brokered by the pasted token's identity" || true

CLEAR_JSON=$(lamaste-server registry-credential clear --json 2>/dev/null | grep -E '^\{' | tail -1 || echo "{}")
assert_json_field "$CLEAR_JSON" '.removed' 'true' "Credential cleared" || true
CLEARED_STATUS=$(agent_get_status "agents/me/registry-credential")
assert_eq "$CLEARED_STATUS" "404" "Without a credential the agent is told there is none again" || true

end_test

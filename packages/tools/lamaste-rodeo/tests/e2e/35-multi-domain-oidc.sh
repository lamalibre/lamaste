#!/usr/bin/env bash
# ============================================================================
# 35 — Multi-domain relay: OIDC sign-in by domain membership (Single-VM)
# ============================================================================
# Authelia's access_control does not apply to OpenID Connect authorization:
# a client's authorization_policy does. The relay renders one policy per
# user-facing client, `lamaste_client_<id>`, admitting the members of its
# plugin's domain by the domain's member group (`lamaste:m:<key>` in
# users.yml — packages/core/docs/external-members-design.md) and external
# members only with a grant (single-VM spec 36). A is the
# relay's primary domain, B a second one (the primary's first label
# replaced by `second`).
#
# A server plugin with a public authorization-code client (helpers.sh,
# write_oidc_domain_fixture_plugin) is served by a stand-in registry, as in
# spec 26. A developer is a member of A and B, a customer of B only.
#
# 1. The client belongs to A: its policy admits A's member group, which
#    users.yml gives the developer and not the customer.
# 2. Signed in at auth.A, the developer's authorization request goes on
#    (Authelia's consent, no error); the customer's — valid credentials, not
#    a member of A — is refused (error=access_denied to the redirect URI).
# 3. The plugin moved to B: the client's policy admits B's member group;
#    signed in at auth.B, the customer's request goes on too.
# 4. B is an issuer of its own: auth.B's discovery says
#    https://auth.<B>, auth.A's https://auth.<A>.
# ============================================================================

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/helpers.sh"

require_commands curl jq node openssl oathtool python3

begin_test "35 — Multi-domain relay: OIDC sign-in by domain membership"

# ---------------------------------------------------------------------------
log_section "Pre-flight: check onboarding is complete"
# ---------------------------------------------------------------------------

ONBOARDING=$(api_get "onboarding/status" 2>/dev/null || echo '{}')
if [ "$(echo "$ONBOARDING" | jq -r '.status' 2>/dev/null || echo unknown)" != "COMPLETED" ]; then
  log_skip "Onboarding not completed — skipping"
  end_test
  exit $?
fi
DOMAIN=$(echo "$ONBOARDING" | jq -r '.domain // empty')
DOMAIN_2=$(test_domain_n "${DOMAIN}" second)
log_pass "Onboarding is complete: A = ${DOMAIN}, B = ${DOMAIN_2}"

STATE_DIR="/etc/lamalibre/lamaste"
WORK_DIR="/tmp/lamalibre-lamaste-e2e-35"
STUB_PORT=4874
STUB_URL="http://127.0.0.1:${STUB_PORT}"
STUB_ADMIN_TOKEN="feria_e2eadmin_mdoidc_00000000000000000"
PLUGIN_PACKAGE="@lamalibre/e2e-mdoidc-server"
PLUGIN_NAME="e2e-mdoidc"
CLIENT_ID="e2e-mdoidc-web"
REDIRECT_URI="https://e2e-mdoidc.example.test/callback"
DEV="e2e35-dev"
CUST="e2e35-cust"
# Test credentials for this run only, never printed
DEV_PASSWORD="E2e-$(openssl rand -hex 12)"
CUST_PASSWORD="E2e-$(openssl rand -hex 12)"
ADDED_B=""

cleanup() {
  log_info "Cleaning up test resources..."
  api_post "plugins/${PLUGIN_NAME}/disable" > /dev/null 2>&1 || true
  api_delete "plugins/${PLUGIN_NAME}" > /dev/null 2>&1 || true
  for u in "${DEV}" "${CUST}"; do api_delete "users/${u}?erase=true" > /dev/null 2>&1 || true; done
  if [ -n "${ADDED_B}" ]; then CURL_TIMEOUT=150 api_delete "domains/${DOMAIN_2}" > /dev/null 2>&1 || true; fi
  sudo rm -f "${STATE_DIR}/.npmrc"
  pkill -f '[s]tub-registry.mjs' 2>/dev/null || true
  rm -rf "${WORK_DIR}"
}
trap cleanup EXIT

# portal <domain> — curl's --resolve for auth.<domain> on this VM
portal() { echo "--resolve auth.$1:443:127.0.0.1"; }

# authorize <jar> <domain> — an authorization request for the client at
# auth.<domain> with the session in <jar>; prints Authelia's Location
authorize() {
  local verifier challenge state
  verifier=$(openssl rand -hex 32)
  challenge=$(printf '%s' "$verifier" | openssl dgst -sha256 -binary | openssl base64 -A | tr '+/' '-_' | tr -d '=')
  state=$(openssl rand -hex 16)
  # shellcheck disable=SC2046
  curl -sk --max-time 15 $(portal "$2") -b "$1" -o /dev/null -w '%{redirect_url}' -G \
    --data-urlencode "client_id=${CLIENT_ID}" --data-urlencode "redirect_uri=${REDIRECT_URI}" \
    --data-urlencode 'response_type=code' --data-urlencode 'scope=openid profile' \
    --data-urlencode "state=${state}" --data-urlencode "code_challenge=${challenge}" \
    --data-urlencode 'code_challenge_method=S256' \
    "https://auth.$2/api/oidc/authorization" 2>/dev/null || echo ""
}

# client_policy <client id> — the authorization_policy Authelia holds for the client
client_policy() {
  sudo bash -c "${AUTHELIA_CONFIG_JSON}" | jq -r --arg c "$1" '[.identity_providers.oidc.clients[]? | select(.client_id == $c) | .authorization_policy] | first // ""' 2>/dev/null || echo ""
}

# policy_subjects <name> — the subjects of an authorization policy's rules
# (a rule's ANDed subjects joined by "+"), sorted, comma-separated
policy_subjects() {
  sudo bash -c "${AUTHELIA_CONFIG_JSON}" | jq -r --arg p "$1" '[.identity_providers.oidc.authorization_policies[$p].rules[]?.subject[]? | if type == "array" then join("+") else . end] | sort | join(",")' 2>/dev/null || echo ""
}

# member_key <domain> — the domain's group key, as Authelia's rules name it
member_key() { sudo bash -c "${AUTHELIA_CONFIG_JSON}" | jq -r --arg d "$1" "${AUTHELIA_MEMBER_KEY}" 2>/dev/null || echo ""; }

# user_groups <username> — the user's groups in users.yml, sorted, comma-separated
user_groups() { sudo bash -c "${AUTHELIA_USERS_GROUPS_JSON}" | jq -r --arg u "$1" '(.[$u] // []) | sort | join(",")' 2>/dev/null || echo ""; }

# ===========================================================================
# 1. Domain B, the users, the plugin
# ===========================================================================

log_section "Domain B active; a developer of A and B, a customer of B"

local_domain_dns "${DOMAIN_2}"
if [ "$(api_get "domains" | jq -r --arg n "${DOMAIN_2}" '[.domains[]? | select(.name == $n)] | length')" = "0" ]; then
  RESP=$(api_post "domains" "{\"name\":\"${DOMAIN_2}\"}")
  assert_json_field "$RESP" '.domain.status' 'pending' "Domain ${DOMAIN_2} added" || true
  ADDED_B="yes"
fi
RESP=$(CURL_TIMEOUT=150 api_post "domains/${DOMAIN_2}/activate")
assert_json_field "$RESP" '.domain.status' 'active' "Domain ${DOMAIN_2} active" || true
local_wait_authelia "${DOMAIN_2}"

for u in "${DEV}" "${CUST}"; do api_delete "users/${u}?erase=true" > /dev/null 2>&1 || true; done
RESP=$(api_post "users" "{\"username\":\"${DEV}\",\"displayname\":\"E2E Dev\",\"email\":\"${DEV}@example.test\",\"password\":\"${DEV_PASSWORD}\",\"groups\":[],\"domains\":[\"${DOMAIN}\",\"${DOMAIN_2}\"]}")
assert_json_field "$RESP" '[.user.domains[].name] | sort | join(",")' "$(printf '%s\n%s\n' "${DOMAIN}" "${DOMAIN_2}" | sort | paste -sd, -)" "${DEV}: a member of A and B" || true
RESP=$(api_post "users" "{\"username\":\"${CUST}\",\"displayname\":\"E2E Cust\",\"email\":\"${CUST}@example.test\",\"password\":\"${CUST_PASSWORD}\",\"groups\":[],\"domains\":[\"${DOMAIN_2}\"]}")
assert_json_field "$RESP" '[.user.domains[].name] | join(",")' "${DOMAIN_2}" "${CUST}: a member of B only" || true

log_section "The plugin with an authorization-code client, served by a stand-in registry"

rm -rf "${WORK_DIR}"
mkdir -p "${WORK_DIR}"
write_oidc_domain_fixture_plugin "${WORK_DIR}/fixture"
if start_stub_registry "${WORK_DIR}" "${WORK_DIR}/fixture"; then
  log_pass "Stand-in registry is up on ${STUB_URL}"
else
  log_fail "Stand-in registry did not start: $(cat "${WORK_DIR}/stub.log" 2>/dev/null)"
  end_test
  exit $?
fi
printf '@lamalibre:registry=%s/\n//127.0.0.1:%s/:_authToken=%s\n' "${STUB_URL}" "${STUB_PORT}" "${STUB_ADMIN_TOKEN}" > "${WORK_DIR}/npmrc"
sudo install -o lamaste -g lamaste -m 0600 "${WORK_DIR}/npmrc" "${STATE_DIR}/.npmrc"
RESP=$(api_post "plugins/install" "{\"packageName\":\"${PLUGIN_PACKAGE}\"}")
assert_json_field "$RESP" '.ok' 'true' "Fixture plugin installed" || true
RESP=$(api_post "plugins/${PLUGIN_NAME}/enable")
assert_json_field "$RESP" '.status' 'enabled' "Plugin enabled" || true
assert_json_field "$(api_get "plugins/${PLUGIN_NAME}")" '.plugin.domain' "${DOMAIN}" "The plugin belongs to the primary domain A" || true
local_wait_authelia "${DOMAIN}"

# ===========================================================================
# 2. A's client admits A's members
# ===========================================================================

log_section "The client belongs to A: A's members sign in, a customer of B does not"

POLICY="lamaste_client_${CLIENT_ID}"
KEY_A=$(member_key "${DOMAIN}")
KEY_B=$(member_key "${DOMAIN_2}")
assert_eq "$(client_policy "${CLIENT_ID}")" "${POLICY}" "The client's authorization_policy is its own, ${POLICY}" || true
SUBJECTS=$(policy_subjects "${POLICY}")
assert_contains ",${SUBJECTS}," ",group:lamaste:m:${KEY_A}," "…admitting A's member group" || true
assert_not_contains ",${SUBJECTS}," ",group:lamaste:m:${KEY_B}," "…not B's" || true
assert_not_contains "${SUBJECTS}" "user:" "…naming no user" || true
assert_contains ",$(user_groups "${DEV}")," ",lamaste:m:${KEY_A}," "users.yml gives ${DEV} A's member group" || true
assert_not_contains ",$(user_groups "${CUST}")," ",lamaste:m:${KEY_A}," "…not ${CUST}" || true

SECRET_DEV=$(local_reset_totp "${DEV}")
SECRET_CUST=$(local_reset_totp "${CUST}")
local_wait_authelia "${DOMAIN}"
local_sign_in "${DEV}" "${DEV_PASSWORD}" "${SECRET_DEV}" "${WORK_DIR}/dev-a.jar" "${DOMAIN}"
assert_eq "${SIGN_IN_RESULT}" "OK OK" "${DEV} signed in at auth.A" || true
local_sign_in "${CUST}" "${CUST_PASSWORD}" "${SECRET_CUST}" "${WORK_DIR}/cust-a.jar" "${DOMAIN}"
assert_eq "${SIGN_IN_RESULT}" "OK OK" "${CUST} signed in at auth.A (valid credentials)" || true

LOCATION=$(authorize "${WORK_DIR}/dev-a.jar" "${DOMAIN}")
assert_not_eq "${LOCATION}" "" "${DEV}'s authorization request at auth.A is answered with a redirect" || true
assert_not_contains "${LOCATION}" "error=" "…that goes on, no error (${LOCATION%%\?*})" || true
LOCATION=$(authorize "${WORK_DIR}/cust-a.jar" "${DOMAIN}")
assert_contains "${LOCATION}" "${REDIRECT_URI}" "${CUST}'s is sent back to the client's redirect URI" || true
assert_contains "${LOCATION}" "error=access_denied" "…refused: access_denied (not a member of A)" || true

# ===========================================================================
# 3. Moved to B
# ===========================================================================

log_section "The plugin moved to B: B's members sign in"

RESP=$(api_put "plugins/${PLUGIN_NAME}/domain" "{\"domain\":\"${DOMAIN_2}\"}")
assert_json_field "$RESP" '"\(.domain) \(.changed)"' "${DOMAIN_2} true" "PUT /api/plugins/${PLUGIN_NAME}/domain {domain: B}" || true
local_wait_authelia "${DOMAIN_2}"
assert_eq "$(client_policy "${CLIENT_ID}")" "${POLICY}" "The client keeps its own policy" || true
SUBJECTS=$(policy_subjects "${POLICY}")
assert_contains ",${SUBJECTS}," ",group:lamaste:m:${KEY_B}," "…which now admits B's member group" || true
assert_not_contains ",${SUBJECTS}," ",group:lamaste:m:${KEY_A}," "…no longer A's" || true
assert_contains ",$(user_groups "${CUST}")," ",lamaste:m:${KEY_B}," "users.yml gives ${CUST} B's member group" || true

local_sign_in "${CUST}" "${CUST_PASSWORD}" "${SECRET_CUST}" "${WORK_DIR}/cust-b.jar" "${DOMAIN_2}"
assert_eq "${SIGN_IN_RESULT}" "OK OK" "${CUST} signed in at auth.B" || true
LOCATION=$(authorize "${WORK_DIR}/cust-b.jar" "${DOMAIN_2}")
assert_not_eq "${LOCATION}" "" "${CUST}'s authorization request at auth.B is answered with a redirect" || true
assert_not_contains "${LOCATION}" "error=" "…that goes on now, no error" || true

# ===========================================================================
# 4. An issuer per domain
# ===========================================================================

log_section "An issuer per domain"

# shellcheck disable=SC2046
ISSUER_B=$(curl -sk --max-time 15 $(portal "${DOMAIN_2}") "https://auth.${DOMAIN_2}/.well-known/openid-configuration" 2>/dev/null | jq -r '.issuer // empty' 2>/dev/null || echo "")
# shellcheck disable=SC2046
ISSUER_A=$(curl -sk --max-time 15 $(portal "${DOMAIN}") "https://auth.${DOMAIN}/.well-known/openid-configuration" 2>/dev/null | jq -r '.issuer // empty' 2>/dev/null || echo "")
assert_eq "${ISSUER_B}" "https://auth.${DOMAIN_2}" "auth.B's discovery: issuer https://auth.${DOMAIN_2}" || true
assert_eq "${ISSUER_A}" "https://auth.${DOMAIN}" "auth.A's: https://auth.${DOMAIN}" || true

end_test

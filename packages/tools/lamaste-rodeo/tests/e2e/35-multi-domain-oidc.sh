#!/usr/bin/env bash
# ============================================================================
# 35 — Multi-domain relay: OIDC sign-in by domain membership (Single-VM)
# ============================================================================
# Authelia's access_control does not apply to OpenID Connect authorization:
# a client's authorization_policy does. The relay renders one policy per
# domain and factor naming the domain's members, and points each user-facing
# client at its plugin's domain's policy (design: packages/core/docs/
# multi-domain-relay-design.md, "OIDC: one issuer per domain"). A is the
# relay's primary domain, B a second one (the primary's first label
# replaced by `second`).
#
# A server plugin with a public authorization-code client (helpers.sh,
# write_oidc_domain_fixture_plugin) is served by a stand-in registry, as in
# spec 26. A developer is a member of A and B, a customer of B only.
#
# 1. The client belongs to A: its authorization_policy is A's two-factor
#    policy, which names the developer and not the customer.
# 2. Signed in at auth.A, the developer's authorization request goes on
#    (Authelia's consent, no error); the customer's — valid credentials, not
#    a member of A — is refused (error=access_denied to the redirect URI).
# 3. The plugin moved to B: the client's policy is B's; signed in at
#    auth.B, the customer's request goes on too.
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
DOMAIN_2="${TEST_DOMAIN_2:-second.${DOMAIN#*.}}"
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
DNSMASQ_CONF="/etc/dnsmasq.d/lamaste-test.conf"

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

# sign_in <username> <password> <secret> <jar> <domain> — both factors at
# auth.<domain> into <jar>; prints "<first> <second>"
sign_in() {
  local body first code second
  rm -f "$4"
  body=$(jq -c -n --arg u "$1" --arg p "$2" --arg t "https://auth.$5/" '{username: $u, password: $p, keepMeLoggedIn: false, targetURL: $t}')
  # shellcheck disable=SC2046 # portal is two words on purpose
  first=$(curl -sk --max-time 15 $(portal "$5") -c "$4" -X POST -H 'Content-Type: application/json' -d "$body" "https://auth.$5/api/firstfactor" 2>/dev/null | jq -r '.status // "none"' 2>/dev/null || echo "none")
  code=$(oathtool --totp --base32 "$3" 2>/dev/null || echo "")
  body=$(jq -c -n --arg c "$code" --arg t "https://auth.$5/" '{token: $c, targetURL: $t}')
  # shellcheck disable=SC2046
  second=$(curl -sk --max-time 15 $(portal "$5") -b "$4" -c "$4" -X POST -H 'Content-Type: application/json' -d "$body" "https://auth.$5/api/secondfactor/totp" 2>/dev/null | jq -r '.status // "none"' 2>/dev/null || echo "none")
  echo "${first} ${second}"
}

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

# authelia_yaml client <client id> — the authorization_policy Authelia holds for the client
# authelia_yaml policy <name> — the subjects of an authorization policy's rules, sorted, comma-separated
authelia_yaml() {
  sudo python3 -c 'import json,sys,yaml
c=yaml.safe_load("".join(l for l in open("/etc/authelia/configuration.yml") if "{{" not in l))
o=(c.get("identity_providers") or {}).get("oidc") or {}
if sys.argv[1]=="client":
  print(next((x.get("authorization_policy","") for x in o.get("clients") or [] if x.get("client_id")==sys.argv[2]),""))
else:
  p=(o.get("authorization_policies") or {}).get(sys.argv[2]) or {}
  print(",".join(sorted(s for r in p.get("rules") or [] for s in (r.get("subject") or []))))' "$@" 2>/dev/null || echo ""
}

# shellcheck disable=SC2046
authelia_up() { [ "$(curl -sk --max-time 5 $(portal "$1") -o /dev/null -w '%{http_code}' "https://auth.$1/api/health" 2>/dev/null || echo 000)" = "200" ]; }
wait_authelia() {
  local _
  for _ in $(seq 1 45); do
    if authelia_up "$1"; then return 0; fi
    sleep 2
  done
  log_fail "Authelia does not answer at auth.$1"
}

# ===========================================================================
# 1. Domain B, the users, the plugin
# ===========================================================================

log_section "Domain B active; a developer of A and B, a customer of B"

# B resolves here as A does (setup-host.sh adds it; a VM from an older snapshot lacks it).
if ! sudo grep -q "^address=/${DOMAIN_2}/" "${DNSMASQ_CONF}"; then
  HOST_ADDRESS=$(sudo sed -n "s#^address=/${DOMAIN}/##p" "${DNSMASQ_CONF}" | head -n 1)
  echo "address=/${DOMAIN_2}/${HOST_ADDRESS:-127.0.0.1}" | sudo tee -a "${DNSMASQ_CONF}" > /dev/null
  sudo systemctl restart dnsmasq
fi
if [ "$(api_get "domains" | jq -r --arg n "${DOMAIN_2}" '[.domains[]? | select(.name == $n)] | length')" = "0" ]; then
  RESP=$(api_post "domains" "{\"name\":\"${DOMAIN_2}\"}")
  assert_json_field "$RESP" '.domain.status' 'pending' "Domain ${DOMAIN_2} added" || true
  ADDED_B="yes"
fi
RESP=$(CURL_TIMEOUT=150 api_post "domains/${DOMAIN_2}/activate")
assert_json_field "$RESP" '.domain.status' 'active' "Domain ${DOMAIN_2} active" || true
wait_authelia "${DOMAIN_2}"

for u in "${DEV}" "${CUST}"; do api_delete "users/${u}?erase=true" > /dev/null 2>&1 || true; done
RESP=$(api_post "users" "{\"username\":\"${DEV}\",\"displayname\":\"E2E Dev\",\"email\":\"${DEV}@example.test\",\"password\":\"${DEV_PASSWORD}\",\"groups\":[],\"domains\":[\"${DOMAIN}\",\"${DOMAIN_2}\"]}")
assert_json_field "$RESP" '.user.domains | sort | join(",")' "$(printf '%s\n%s\n' "${DOMAIN}" "${DOMAIN_2}" | sort | paste -sd, -)" "${DEV}: a member of A and B" || true
RESP=$(api_post "users" "{\"username\":\"${CUST}\",\"displayname\":\"E2E Cust\",\"email\":\"${CUST}@example.test\",\"password\":\"${CUST_PASSWORD}\",\"groups\":[],\"domains\":[\"${DOMAIN_2}\"]}")
assert_json_field "$RESP" '.user.domains | join(",")' "${DOMAIN_2}" "${CUST}: a member of B only" || true

log_section "The plugin with an authorization-code client, served by a stand-in registry"

rm -rf "${WORK_DIR}"
mkdir -p "${WORK_DIR}"
write_stub_registry "${WORK_DIR}/stub-registry.mjs"
write_oidc_domain_fixture_plugin "${WORK_DIR}/fixture"
pkill -f '[s]tub-registry.mjs' 2>/dev/null || true
nohup node "${WORK_DIR}/stub-registry.mjs" --port "${STUB_PORT}" --admin-token "${STUB_ADMIN_TOKEN}" --issuer "https://auth.${DOMAIN}" --audience "${STUB_URL}" --jwks-url http://127.0.0.1:9091/jwks.json --package "${WORK_DIR}/fixture" &> "${WORK_DIR}/stub.log" &
if wait_for_http "${STUB_URL}/-/ping" 30; then
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
wait_authelia "${DOMAIN}"

# ===========================================================================
# 2. A's client admits A's members
# ===========================================================================

log_section "The client belongs to A: A's members sign in, a customer of B does not"

POLICY_A="lamaste_${DOMAIN//./_}_two_factor"
POLICY_B="lamaste_${DOMAIN_2//./_}_two_factor"
assert_eq "$(authelia_yaml client "${CLIENT_ID}")" "${POLICY_A}" "The client's authorization_policy is A's two-factor policy" || true
SUBJECTS_A=$(authelia_yaml policy "${POLICY_A}")
assert_contains ",${SUBJECTS_A}," ",user:${DEV}," "A's policy names ${DEV}" || true
assert_not_contains ",${SUBJECTS_A}," ",user:${CUST}," "…not ${CUST}" || true

SECRET_DEV=$(api_post "users/${DEV}/reset-totp" '{}' | jq -r '.totpUri // empty' | sed -n 's/.*secret=\([A-Z2-7]*\).*/\1/p')
SECRET_CUST=$(api_post "users/${CUST}/reset-totp" '{}' | jq -r '.totpUri // empty' | sed -n 's/.*secret=\([A-Z2-7]*\).*/\1/p')
wait_authelia "${DOMAIN}"
wait_for_next_totp_window
assert_eq "$(sign_in "${DEV}" "${DEV_PASSWORD}" "${SECRET_DEV}" "${WORK_DIR}/dev-a.jar" "${DOMAIN}")" "OK OK" "${DEV} signed in at auth.A" || true
assert_eq "$(sign_in "${CUST}" "${CUST_PASSWORD}" "${SECRET_CUST}" "${WORK_DIR}/cust-a.jar" "${DOMAIN}")" "OK OK" "${CUST} signed in at auth.A (valid credentials)" || true

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
wait_authelia "${DOMAIN_2}"
assert_eq "$(authelia_yaml client "${CLIENT_ID}")" "${POLICY_B}" "The client's authorization_policy is B's two-factor policy" || true
SUBJECTS_B=$(authelia_yaml policy "${POLICY_B}")
assert_contains ",${SUBJECTS_B}," ",user:${CUST}," "B's policy names ${CUST}" || true
assert_contains ",${SUBJECTS_B}," ",user:${DEV}," "…and ${DEV}" || true

wait_for_next_totp_window
assert_eq "$(sign_in "${CUST}" "${CUST_PASSWORD}" "${SECRET_CUST}" "${WORK_DIR}/cust-b.jar" "${DOMAIN_2}")" "OK OK" "${CUST} signed in at auth.B" || true
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

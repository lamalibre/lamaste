#!/usr/bin/env bash
# ============================================================================
# 36 — External members: OIDC sign-in by grant (Single-VM)
# ============================================================================
# Authelia's access_control does not apply to OpenID Connect authorization:
# a client's authorization_policy does. Each user-facing client has a
# policy of its own, `lamaste_client_<id>`: the members of its plugin's
# domain (their member group, `lamaste:m:<key>`), and its external members
# only together with the client's grant group (`lamaste:oidc@<id>`), both in
# Authelia's users.yml (design: packages/core/docs/external-members-
# design.md, "OIDC"). A grant is a Gatekeeper grant
# `resourceType: oidc-client`. A is the relay's primary domain.
#
# A server plugin with an authorization-code and a device-code client
# (helpers.sh, write_oidc_grant_fixture_plugin) is served by a stand-in
# registry, as in spec 35. A member and an external member of A.
#
# 1. The authorization-code client: the member's authorization request goes
#    on; the external member's is refused (access_denied). Granted, the same
#    session's next request goes on; revoked, refused again — Authelia
#    re-reads their groups at each authorization, and is never restarted.
# 2. The device-code client: Authelia's device flow checks the groups a
#    session last read (residual R5), so revoking a grant on a device-code
#    client restarts Authelia (audited authelia.restarted, reason
#    device-code) — the external member's session of before is gone.
# ============================================================================

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/helpers.sh"

require_commands curl jq node openssl oathtool python3

begin_test "36 — External members: OIDC sign-in by grant"

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
log_pass "Onboarding is complete: A = ${DOMAIN}"

STATE_DIR="/etc/lamalibre/lamaste"
WORK_DIR="/tmp/lamalibre-lamaste-e2e-36"
STUB_PORT=4874
STUB_URL="http://127.0.0.1:${STUB_PORT}"
STUB_ADMIN_TOKEN="feria_e2eadmin_emoidc_00000000000000000"
PLUGIN_PACKAGE="@lamalibre/e2e-emoidc-server"
PLUGIN_NAME="e2e-emoidc"
WEB_ID="e2e-emoidc-web"
CLI_ID="e2e-emoidc-cli"
REDIRECT_URI="https://e2e-emoidc.example.test/callback"
MEM="e2e36-member"
EXT="e2e36-ext"
# Test credentials for this run only, never printed
MEM_PASSWORD="E2e-$(openssl rand -hex 12)"
EXT_PASSWORD="E2e-$(openssl rand -hex 12)"
GRANT_WEB=""
GRANT_CLI=""
AUDIT_BASE=0

cleanup() {
  log_info "Cleaning up test resources..."
  local id
  for id in ${GRANT_WEB} ${GRANT_CLI}; do api_delete "gatekeeper/grants/${id}" > /dev/null 2>&1 || true; done
  api_post "plugins/${PLUGIN_NAME}/disable" > /dev/null 2>&1 || true
  api_delete "plugins/${PLUGIN_NAME}" > /dev/null 2>&1 || true
  for id in "${MEM}" "${EXT}"; do api_delete "users/${id}?erase=true" > /dev/null 2>&1 || true; done
  sudo rm -f "${STATE_DIR}/.npmrc"
  pkill -f '[s]tub-registry.mjs' 2>/dev/null || true
  rm -rf "${WORK_DIR}"
}
trap cleanup EXIT

# wait_for <seconds> <command...> — until the command succeeds (every 3 s)
wait_for() {
  local deadline=$((SECONDS + $1))
  shift
  while [ "$SECONDS" -lt "$deadline" ]; do
    if "$@"; then return 0; fi
    sleep 3
  done
  return 1
}

# portal — curl's --resolve for auth.<A> on this VM
portal() { echo "--resolve auth.${DOMAIN}:443:127.0.0.1"; }

# authorize <jar> — an authorization request for the web client at auth.A
# with the session in <jar>; prints Authelia's Location
authorize() {
  local verifier challenge state
  verifier=$(openssl rand -hex 32)
  challenge=$(printf '%s' "$verifier" | openssl dgst -sha256 -binary | openssl base64 -A | tr '+/' '-_' | tr -d '=')
  state=$(openssl rand -hex 16)
  # shellcheck disable=SC2046
  curl -sk --max-time 15 $(portal) -b "$1" -o /dev/null -w '%{redirect_url}' -G \
    --data-urlencode "client_id=${WEB_ID}" --data-urlencode "redirect_uri=${REDIRECT_URI}" \
    --data-urlencode 'response_type=code' --data-urlencode 'scope=openid profile' \
    --data-urlencode "state=${state}" --data-urlencode "code_challenge=${challenge}" \
    --data-urlencode 'code_challenge_method=S256' \
    "https://auth.${DOMAIN}/api/oidc/authorization" 2>/dev/null || echo ""
}

# admitted <jar> / refused <jar> — the web client's authorization request goes on / is refused
admitted() {
  local location
  location=$(authorize "$1")
  [ -n "$location" ] && [[ "$location" != *"error="* ]]
}
refused() { [[ "$(authorize "$1")" == *"error=access_denied"* ]]; }

# config_json — Authelia's configuration as JSON
config_json() { sudo bash -c "${AUTHELIA_CONFIG_JSON}" 2>/dev/null || echo '{}'; }

# policy_subjects <name> — the subjects of an authorization policy's rules
# (a rule's ANDed subjects joined by "+"), sorted, comma-separated
policy_subjects() {
  config_json | jq -r --arg p "$1" '[.identity_providers.oidc.authorization_policies[$p].rules[]?.subject[]? | if type == "array" then join("+") else . end] | sort | join(",")' 2>/dev/null || echo ""
}

# client_policy <client id> — the authorization_policy Authelia holds for the client
client_policy() {
  config_json | jq -r --arg c "$1" '[.identity_providers.oidc.clients[]? | select(.client_id == $c) | .authorization_policy] | first // ""' 2>/dev/null || echo ""
}

# user_groups <username> — the user's groups in users.yml, sorted, comma-separated
user_groups() { sudo bash -c "${AUTHELIA_USERS_GROUPS_JSON}" 2>/dev/null | jq -r --arg u "$1" '(.[$u] // []) | sort | join(",")' 2>/dev/null || echo ""; }
holds_group() { [[ ",$(user_groups "$1")," == *",$2,"* ]]; }
lacks_group() { ! holds_group "$@"; }

# authelia_pid — Authelia's MainPID (0 when it is not running)
authelia_pid() { systemctl show -p MainPID --value authelia 2> /dev/null || echo "0"; }

# session_user <jar> — the user Authelia's /api/state names for the session ("" when signed out)
session_user() {
  # shellcheck disable=SC2046
  curl -sk --max-time 15 $(portal) -b "$1" "https://auth.${DOMAIN}/api/state" 2>/dev/null | jq -r '.data.username // ""' 2>/dev/null || echo ""
}

# grant <variable> <client id> — a Gatekeeper grant of the client to the external member; its id into <variable>
grant() {
  local resp id
  resp=$(api_post "gatekeeper/grants" "{\"principalType\":\"user\",\"principalId\":\"${EXT}\",\"resourceType\":\"oidc-client\",\"resourceId\":\"$2\"}")
  id=$(echo "$resp" | jq -r '.grant.grantId // empty' 2>/dev/null || echo "")
  assert_not_eq "${id}" "" "${EXT} granted the client $2 (resourceType oidc-client)" || true
  printf -v "$1" '%s' "$id"
}

# device_code_restarts — authelia.restarted entries since the spec began, reason device-code
device_code_restarts() {
  api_get "audit?action=authelia.restarted&limit=50" 2>/dev/null |
    jq --argjson base "${AUDIT_BASE}" '[.entries[]? | select(.id > $base and .details.reason == "device-code")] | length' 2>/dev/null || echo 0
}
restarted_for_device_code() { [ "$(device_code_restarts)" -ge 1 ]; }

# ===========================================================================
# 1. The users, the plugin
# ===========================================================================

log_section "A member and an external member of A"

AUDIT_BASE=$(api_get "audit?limit=1" 2>/dev/null | jq -r '[.entries[]?.id] | max // 0' 2>/dev/null || echo 0)
for u in "${MEM}" "${EXT}"; do api_delete "users/${u}?erase=true" > /dev/null 2>&1 || true; done
RESP=$(api_post "users" "{\"username\":\"${MEM}\",\"displayname\":\"E2E Member\",\"email\":\"${MEM}@example.test\",\"password\":\"${MEM_PASSWORD}\",\"groups\":[],\"domains\":[\"${DOMAIN}\"]}")
assert_json_field "$RESP" '[.user.domains[] | "\(.name):\(.kind)"] | join(",")' "${DOMAIN}:member" "${MEM}: a member of A" || true
RESP=$(api_post "users" "{\"username\":\"${EXT}\",\"displayname\":\"E2E External\",\"email\":\"${EXT}@example.test\",\"password\":\"${EXT_PASSWORD}\",\"groups\":[],\"domains\":[{\"name\":\"${DOMAIN}\",\"kind\":\"external\"}]}")
assert_json_field "$RESP" '[.user.domains[] | "\(.name):\(.kind)"] | join(",")' "${DOMAIN}:external" "${EXT}: an external member of A" || true

log_section "The plugin with an authorization-code and a device-code client"

rm -rf "${WORK_DIR}"
mkdir -p "${WORK_DIR}"
write_oidc_grant_fixture_plugin "${WORK_DIR}/fixture"
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
local_wait_authelia "${DOMAIN}"

KEY=$(config_json | jq -r --arg d "${DOMAIN}" "${AUTHELIA_MEMBER_KEY}" 2>/dev/null || echo "")
assert_eq "$(printf '%s\n' "${KEY}" | grep -cE '^[0-9a-f]{16}$' || true)" "1" "A's rules name its group key" || true
for c in "${WEB_ID}" "${CLI_ID}"; do
  assert_eq "$(client_policy "$c")" "lamaste_client_${c}" "${c}'s authorization_policy is its own" || true
  assert_eq "$(policy_subjects "lamaste_client_${c}")" "group:lamaste:m:${KEY},group:lamaste:x:${KEY}+group:lamaste:oidc@${c}" "…A's members, or A's external members granted ${c}" || true
done
if wait_for 30 holds_group "${EXT}" "lamaste:x:${KEY}"; then
  log_pass "users.yml gives ${EXT} A's external group"
else
  log_fail "${EXT}'s groups: $(user_groups "${EXT}")"
fi

SECRET_MEM=$(local_reset_totp "${MEM}")
SECRET_EXT=$(local_reset_totp "${EXT}")
local_wait_authelia "${DOMAIN}"
local_sign_in "${MEM}" "${MEM_PASSWORD}" "${SECRET_MEM}" "${WORK_DIR}/mem.jar" "${DOMAIN}"
assert_eq "${SIGN_IN_RESULT}" "OK OK" "${MEM} signed in at auth.A" || true
local_sign_in "${EXT}" "${EXT_PASSWORD}" "${SECRET_EXT}" "${WORK_DIR}/ext.jar" "${DOMAIN}"
assert_eq "${SIGN_IN_RESULT}" "OK OK" "${EXT} signed in at auth.A" || true
PID=$(authelia_pid)
assert_not_eq "${PID:-0}" "0" "Authelia runs (MainPID ${PID})" || true

# ===========================================================================
# 2. The authorization-code client
# ===========================================================================

log_section "The authorization-code client: by grant, no restart"

if admitted "${WORK_DIR}/mem.jar"; then log_pass "${MEM}'s authorization request goes on"; else log_fail "${MEM}: $(authorize "${WORK_DIR}/mem.jar")"; fi
LOCATION=$(authorize "${WORK_DIR}/ext.jar")
assert_contains "${LOCATION}" "${REDIRECT_URI}" "${EXT}'s is sent back to the client's redirect URI" || true
assert_contains "${LOCATION}" "error=access_denied" "…refused: access_denied (an external member, not granted)" || true

grant GRANT_WEB "${WEB_ID}"
if wait_for 30 holds_group "${EXT}" "lamaste:oidc@${WEB_ID}"; then
  log_pass "users.yml gives ${EXT} the client's grant group"
else
  log_fail "${EXT}'s groups: $(user_groups "${EXT}")"
fi
if wait_for 30 admitted "${WORK_DIR}/ext.jar"; then
  log_pass "${EXT}, granted: the same session's authorization request goes on"
else
  log_fail "${EXT}, granted: $(authorize "${WORK_DIR}/ext.jar")"
fi
assert_eq "$(user_groups "${EXT}")" "lamaste:oidc@${WEB_ID},lamaste:x:${KEY}" "…and holds nothing more (no member group, no other client)" || true

api_delete "gatekeeper/grants/${GRANT_WEB}" > /dev/null 2>&1 || true
GRANT_WEB=""
if wait_for 30 lacks_group "${EXT}" "lamaste:oidc@${WEB_ID}"; then
  log_pass "Revoked: users.yml takes the grant group from ${EXT}"
else
  log_fail "${EXT}'s groups: $(user_groups "${EXT}")"
fi
if wait_for 30 refused "${WORK_DIR}/ext.jar"; then
  log_pass "${EXT}, revoked: refused at the next authorization (access_denied)"
else
  log_fail "${EXT}, revoked: $(authorize "${WORK_DIR}/ext.jar")"
fi
if admitted "${WORK_DIR}/mem.jar"; then log_pass "${MEM} admitted throughout"; else log_fail "${MEM}: $(authorize "${WORK_DIR}/mem.jar")"; fi
assert_eq "$(authelia_pid)" "${PID}" "Authelia was not restarted by the grant or its revocation (MainPID ${PID})" || true
assert_eq "$(device_code_restarts)" "0" "…no restart audited" || true

# ===========================================================================
# 3. The device-code client
# ===========================================================================

log_section "The device-code client: a revocation restarts Authelia"

grant GRANT_CLI "${CLI_ID}"
if wait_for 30 holds_group "${EXT}" "lamaste:oidc@${CLI_ID}"; then
  log_pass "users.yml gives ${EXT} the device-code client's grant group"
else
  log_fail "${EXT}'s groups: $(user_groups "${EXT}")"
fi
assert_eq "$(authelia_pid)" "${PID}" "A grant widens: no restart" || true
assert_eq "$(session_user "${WORK_DIR}/ext.jar")" "${EXT}" "${EXT}'s session of before is signed in" || true

api_delete "gatekeeper/grants/${GRANT_CLI}" > /dev/null 2>&1 || true
GRANT_CLI=""
if wait_for 60 restarted_for_device_code; then
  log_pass "Revoked: Authelia restarted for it (audited authelia.restarted, reason device-code)"
else
  log_fail "No device-code restart audited: $(api_get "audit?action=authelia.restarted&limit=5" | jq -c '[.entries[]? | .details]')"
fi
local_wait_authelia "${DOMAIN}"
assert_not_eq "$(authelia_pid)" "${PID}" "…a new MainPID" || true
assert_eq "$(session_user "${WORK_DIR}/ext.jar")" "" "${EXT}'s session of before is gone: no device code can be approved with it" || true
if lacks_group "${EXT}" "lamaste:oidc@${CLI_ID}"; then
  log_pass "…and users.yml no longer gives ${EXT} the client's grant group"
else
  log_fail "${EXT}'s groups: $(user_groups "${EXT}")"
fi

end_test

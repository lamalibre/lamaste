#!/usr/bin/env bash
# ============================================================================
# 59 — A call on behalf of a user (Three-VM)
# ============================================================================
# Slice 8's identity propagation. The consumer e2e-pcons (hosted on the
# visitor VM's second agent) has a user surface — an authenticated tunnel the
# second agent carries, bound to its route — and its /app/me-via-peer calls
# the provider e2e-pdir (agent VM) on behalf of the person asking
# (onBehalfOf: the request, so the delegation the relay gave with it):
#
# 1. A user entitled to both plugins (viewer in each): the provider sees the
#    peer caller with the user — the directory's userId, the username, the
#    user's roles in the provider — and the consumer was given a delegation
#    with the request.
# 2. A user entitled to the consumer only: the relay refuses to name them to
#    a provider whose audience does not hold them (403 user_not_entitled).
# 3. A delegation the consumer makes up (as a plugin inventing a user
#    would): 401 delegation_invalid; the provider's handler never runs.
# 4. Once the both-plugins user is disabled, their next request is refused at
#    the user surface already, and no call is made on their behalf.
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../e2e/helpers.sh"
# shellcheck source-path=SCRIPTDIR source=app-plugin-harness.sh
source "${SCRIPT_DIR}/app-plugin-harness.sh"
# shellcheck source-path=SCRIPTDIR source=peers-harness.sh
source "${SCRIPT_DIR}/peers-harness.sh"

require_commands multipass curl jq node npm tar perl openssl

POLICY_ID="e2e-apphost-59"
REMOTE_DIR="/var/tmp/e2e-59-peers"
LOCAL_TMP=""
CLEAN_PLUGINS="${CONSUMER} ${PROVIDER}"
CLEAN_ROUTES="${PROVIDER}"
PURGE_PACKAGES=""
BOTH="e2e59-both"
ONLY="e2e59-only"
BOTH_PASSWORD="E2e-$(openssl rand -hex 12)"
ONLY_PASSWORD="E2e-$(openssl rand -hex 12)"
JAR_BOTH="/tmp/e2e-59-both.cookies"
JAR_ONLY="/tmp/e2e-59-only.cookies"
SUB="e2e59pc"
PORT_SUB=18459
TUNNEL=""
FQDN=""
BOTH_ID=""
ONLY_ID=""
APP="/api/${CONSUMER}/app"

begin_test "59 — A call on behalf of a user (Three-VM)"

cleanup() {
  log_info "Cleaning up test resources..."
  local id
  drop_plugin_grants "${CONSUMER}"
  drop_plugin_grants "${PROVIDER}"
  if [ -n "${TUNNEL}" ]; then host_api_delete "tunnels/${TUNNEL}" > /dev/null 2>&1 || true; fi
  timed_exec 60 multipass exec "${VISITOR_VM}" -- sudo bash -c "rm -f ${JAR_BOTH} ${JAR_ONLY}; sed -i '/${SUB}\\./d' /etc/hosts; true" > /dev/null 2>&1
  for id in "${BOTH}" "${ONLY}"; do host_api_delete "users/${id}?erase=true" > /dev/null 2>&1 || true; done
  for id in ${BOTH_ID} ${ONLY_ID}; do host_api_post "identity/directory/${id}/erase" '{}' > /dev/null 2>&1 || true; done
  peers_cleanup
}
trap cleanup EXIT

# me_via_peer <jar> — the user's GET /api/e2e-pcons/app/me-via-peer from the
# visitor VM: status, a blank, then the JSON body on one line
me_via_peer() {
  local resp
  resp=$(visit "$1" "https://${FQDN}${APP}/me-via-peer")
  printf '%s\n%s\n' "$(visit_status "$resp")" "$(visit_body "$resp" | jq -c . 2>/dev/null || echo '{}')"
}
in_audience() { [ "$(audience_row "$1" "$2" | jq -r '"\(.change.kind) \(.change.member.status)"' 2>/dev/null)" = "upsert active" ]; }

# ---------------------------------------------------------------------------
log_section "Pre-flight, users, both plugins hosted, the shelf applied"
# ---------------------------------------------------------------------------

app_plugin_preflight
if ! visitor_has_oathtool; then
  log_fail "The visitor VM has no oathtool: no one can sign in"
  end_test
  exit $?
fi
drop_plugin_grants "${CONSUMER}"
drop_plugin_grants "${PROVIDER}"
for user in "${BOTH}" "${ONLY}"; do host_api_delete "users/${user}?erase=true" > /dev/null 2>&1 || true; done
host_api_delete "peers/shelves/${SHELF_ID}" > /dev/null 2>&1 || true
LOCAL_TMP=$(mktemp -d /tmp/e2e-59-peers-XXXXXXXX)
FQDN="${SUB}.${DOMAIN:-}"

RESP=$(users_call POST "users" "{\"username\":\"${BOTH}\",\"displayname\":\"E2E Both\",\"email\":\"${BOTH}@example.test\",\"password\":\"${BOTH_PASSWORD}\",\"groups\":[]}")
assert_eq "$(status_of "$RESP")" "201" "User ${BOTH} created" || true
BOTH_ID=$(json_get "$(body_of "$RESP")" '.user.userId // empty')
RESP=$(users_call POST "users" "{\"username\":\"${ONLY}\",\"displayname\":\"E2E Only\",\"email\":\"${ONLY}@example.test\",\"password\":\"${ONLY_PASSWORD}\",\"groups\":[]}")
assert_eq "$(status_of "$RESP")" "201" "User ${ONLY} created" || true
ONLY_ID=$(json_get "$(body_of "$RESP")" '.user.userId // empty')

peers_setup "${POLICY_ID}"
FQDN="${SUB}.${DOMAIN}"
RESP=$(apply_shelf)
assert_eq "$(status_of "$RESP")" "200" "The shelf grants ${SCOPE_READ} to ${CONSUMER}" || true

RESP=$(host_api_call PUT "plugins/${CONSUMER}/entitlements" "{\"principalType\":\"user\",\"principalId\":\"${BOTH}\",\"roles\":[\"viewer\"]}")
assert_eq "$(status_of "$RESP")" "200" "${BOTH} entitled to ${CONSUMER} (viewer)" || true
RESP=$(host_api_call PUT "plugins/${PROVIDER}/entitlements" "{\"principalType\":\"user\",\"principalId\":\"${BOTH}\",\"roles\":[\"viewer\"]}")
assert_eq "$(status_of "$RESP")" "200" "${BOTH} entitled to ${PROVIDER} (viewer)" || true
RESP=$(host_api_call PUT "plugins/${CONSUMER}/entitlements" "{\"principalType\":\"user\",\"principalId\":\"${ONLY}\",\"roles\":[\"viewer\"]}")
assert_eq "$(status_of "$RESP")" "200" "${ONLY} entitled to ${CONSUMER} only" || true
if wait_for 60 in_audience "${CONSUMER}" "${BOTH_ID}" && wait_for 60 in_audience "${PROVIDER}" "${BOTH_ID}" && wait_for 60 in_audience "${CONSUMER}" "${ONLY_ID}"; then
  log_pass "The audiences hold them: ${BOTH} in both, ${ONLY} in ${CONSUMER}"
else
  log_fail "Audiences: $(audience_row "${PROVIDER}" "${BOTH_ID}") $(audience_row "${CONSUMER}" "${ONLY_ID}")"
fi

# ===========================================================================
# The consumer's user surface on its own agent
# ===========================================================================

log_section "The consumer's user surface, on a tunnel its hosting agent carries"

RESP=$(host_api_post "tunnels" "{\"subdomain\":\"${SUB}\",\"port\":${PORT_SUB},\"accessMode\":\"authenticated\",\"agentLabel\":\"${AGENT2_LABEL}\"}")
TUNNEL=$(json_get "$RESP" '.tunnel.id // empty')
assert_json_field "$RESP" '"\(.tunnel.fqdn) \(.tunnel.agentLabel)"' "${FQDN} ${AGENT2_LABEL}" "Tunnel ${FQDN}, carried by ${AGENT2_LABEL}" || true
RESP=$(host_api_call PUT "tunnels/${TUNNEL}/user-surface" "{\"route\":\"${CONSUMER}\"}")
assert_eq "$(status_of "$RESP")" "200" "Bound as ${CONSUMER}'s user surface" || true
assert_json_field "$(body_of "$RESP")" '.tunnel.userSurfaceStatus[0] | "\(.route) \(.served)"' "${CONSUMER} true" "…served: the tunnel's agent is the plugin's hosting agent" || true
visitor_exec "grep -q '${FQDN}' /etc/hosts || echo '${HOST_IP} ${FQDN}' >> /etc/hosts" > /dev/null 2>&1 || true

SECRET_B=$(reset_totp "${BOTH}")
SECRET_O=$(reset_totp "${ONLY}")
wait_for_next_totp_window
assert_eq "$(sign_in "${BOTH}" "${BOTH_PASSWORD}" "${SECRET_B}" "${JAR_BOTH}" "${FQDN}")" "OK OK" "${BOTH} signed in from the visitor VM" || true
assert_eq "$(sign_in "${ONLY}" "${ONLY_PASSWORD}" "${SECRET_O}" "${JAR_ONLY}" "${FQDN}")" "OK OK" "${ONLY} signed in" || true
SECRET_B=""
SECRET_O=""

# ===========================================================================
# 1. On behalf of a user entitled to both
# ===========================================================================

log_section "On behalf of ${BOTH}: the provider learns who"

OUT=$(me_via_peer "${JAR_BOTH}")
assert_eq "$(echo "$OUT" | head -n 1)" "200" "GET ${APP}/me-via-peer as ${BOTH}: 200" || true
BODY=$(echo "$OUT" | tail -n 1)
assert_json_field "$BODY" '.delegated' 'true' "The relay gave the consumer a delegation with the request" || true
assert_json_field "$BODY" '.result.status' '200' "The call on ${BOTH}'s behalf: 200 from the provider ($(json_get "$BODY" '.result.error.code // ""'))" || true
assert_json_field "$BODY" '.result.body.caller | "\(.type) \(.peer) \(.endpoint)"' "peer ${CONSUMER} GET /people/:userId/info" "…the peer caller: ${CONSUMER}, its endpoint" || true
assert_json_field "$BODY" '.result.body.caller.user | "\(.userId) \(.username) \(.roles | join(","))"' "${BOTH_ID} ${BOTH} viewer" "…and the user: the directory's id, the username, the roles in the provider" || true
assert_json_field "$BODY" '.result.body.userId' "${BOTH_ID}" "…for the path the consumer built from the user it was told" || true

# ===========================================================================
# 2. A user outside the provider's audience
# ===========================================================================

log_section "On behalf of ${ONLY}, whom the provider's audience does not hold"

OUT=$(me_via_peer "${JAR_ONLY}")
assert_eq "$(echo "$OUT" | head -n 1)" "200" "GET ${APP}/me-via-peer as ${ONLY}: the consumer answers" || true
assert_json_field "$(echo "$OUT" | tail -n 1)" '"\(.result.error.code) \(.result.error.status)"' 'user_not_entitled 403' "…its call on ${ONLY}'s behalf: 403 user_not_entitled — never named to the provider" || true

# ===========================================================================
# 3. A forged delegation
# ===========================================================================

log_section "A delegation the consumer made up"

CALLS_BEFORE=$(provider_peerlog | jq '.calls | length' 2>/dev/null || echo -1)
OUT=$(consumer_call "${SCOPE_READ}" GET "/people/${BOTH_ID}/info" null forge)
assert_json_field "$OUT" '"\(.error.code) \(.error.status)"' 'delegation_invalid 401' "A made-up delegation: 401 delegation_invalid" || true
assert_eq "$(provider_peerlog | jq '.calls | length' 2>/dev/null || echo -2)" "${CALLS_BEFORE}" "…the provider's handler never ran" || true
OUT=$(consumer_call "${SCOPE_READ}" GET "/people/${BOTH_ID}/info")
assert_json_field "$OUT" '"\(.status) \(.body.caller.user // "none")"' '200 none' "Without a delegation the same call is the plugin's own: no user" || true

# ===========================================================================
# 4. Disabled
# ===========================================================================

log_section "${BOTH} disabled"

RESP=$(users_call PUT "users/${BOTH}" '{"disabled":true}')
assert_eq "$(status_of "$RESP")" "200" "${BOTH} disabled" || true
CALLS_BEFORE=$(provider_peerlog | jq '.calls | length' 2>/dev/null || echo -1)
OUT=$(me_via_peer "${JAR_BOTH}")
assert_contains "401 403" "$(echo "$OUT" | head -n 1)" "${BOTH}'s next request is refused at the user surface ($(echo "$OUT" | head -n 1))" || true
assert_eq "$(provider_peerlog | jq '.calls | length' 2>/dev/null || echo -2)" "${CALLS_BEFORE}" "…and nothing is called on their behalf" || true

end_test

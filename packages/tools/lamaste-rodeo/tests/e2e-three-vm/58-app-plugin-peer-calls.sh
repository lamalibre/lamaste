#!/usr/bin/env bash
# ============================================================================
# 58 — Calls between app plugins on two agents (Three-VM)
# ============================================================================
# Slice 8: one app plugin's agent half calls another's through the relay. The
# provider e2e-pdir is hosted on the agent VM's agent, the consumer e2e-pcons
# on a second agent the visitor VM runs (peers-harness.sh:
# ensure_second_agent) — two agents, two VMs, one relay. The consumer's half
# calls through the peer channel the relay opened to it
# (POST /admin/e2e/call, an administrator's request through the forwarder):
#
# 1. Nothing applied: every call is 403 not_granted; GET /api/peers shows
#    both declarations and no shelf.
# 2. Applying a shelf: a scope named for another plugin and an edge the
#    consumer does not declare are refused; the shelf granting
#    e2e-pdir:read to e2e-pcons is applied and its edge is effective.
# 3. A granted call reaches the provider's handler with the `peer` caller
#    the relay signed — consumer, scope, major, the endpoint pattern the
#    relay matched, one hop, no user.
# 4. Denied: a scope the shelf does not grant (403 not_granted); a path the
#    provider serves but does not declare (403 endpoint_not_allowed, never
#    reaching it); a static sibling route the declared `:unitId` pattern
#    matches — the provider's SDK refuses it, since its route is not the
#    endpoint the relay matched (403, no handler ran). Refusals are audited.
# 5. The shelf widened to e2e-pdir:write: the POST endpoint answers, with
#    its body.
# 6. The provider cannot be uninstalled or unhosted while the consumer's
#    edges use it (409 peer_dependents naming e2e-pcons), unless the
#    administrator breaks them on purpose (the cleanup does).
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../e2e/helpers.sh"
# shellcheck source-path=SCRIPTDIR source=app-plugin-harness.sh
source "${SCRIPT_DIR}/app-plugin-harness.sh"
# shellcheck source-path=SCRIPTDIR source=peers-harness.sh
source "${SCRIPT_DIR}/peers-harness.sh"

require_commands multipass curl jq node npm tar perl openssl

POLICY_ID="e2e-apphost-58"
REMOTE_DIR="/var/tmp/e2e-58-peers"
LOCAL_TMP=""
CLEAN_PLUGINS="${CONSUMER} ${PROVIDER}"
CLEAN_ROUTES="${PROVIDER}"
PURGE_PACKAGES=""

begin_test "58 — Calls between app plugins on two agents (Three-VM)"

cleanup() {
  log_info "Cleaning up test resources..."
  peers_cleanup
}
trap cleanup EXIT

# call_code <scope> <method> <path> — the relay's code of a refused call, or the provider's status
call_code() {
  local out
  out=$(consumer_call "$1" "$2" "$3")
  echo "$out" | jq -r '.error.code // (.status | tostring)' 2>/dev/null || echo "unreadable"
}

# ---------------------------------------------------------------------------
log_section "Pre-flight, the second agent, both plugins hosted"
# ---------------------------------------------------------------------------

app_plugin_preflight
LOCAL_TMP=$(mktemp -d /tmp/e2e-58-peers-XXXXXXXX)
host_api_delete "peers/shelves/${SHELF_ID}" > /dev/null 2>&1 || true
peers_setup "${POLICY_ID}"

# ===========================================================================
# 1. Nothing applied
# ===========================================================================

log_section "No shelf applied: nothing is granted"

assert_eq "$(call_code "${SCOPE_READ}" GET /units/7)" "not_granted" "A call before any shelf is applied: 403 not_granted" || true
assert_eq "$(call_code "nosuch:read" GET /units/7)" "not_granted" "…a scope no installed plugin provides is answered alike (not_granted)" || true
VIEW=$(peers_view)
assert_json_field "$VIEW" "[.plugins[]? | select(.name == \"${PROVIDER}\") | .provides | keys | join(\",\")] | first" "${SCOPE_READ},${SCOPE_WRITE}" "GET /api/peers: ${PROVIDER} provides ${SCOPE_READ} and ${SCOPE_WRITE}" || true
assert_json_field "$VIEW" "[.shelves[]? | select(.shelfId == \"${SHELF_ID}\")] | length" "0" "…no shelf ${SHELF_ID} applied" || true

# ===========================================================================
# 2. Applying a shelf
# ===========================================================================

log_section "Applying a shelf: refusals, then the edge"

RESP=$(apply_shelf "{\"${SCOPE_READ}\":{\"provider\":\"${CONSUMER}\",\"consumers\":[\"${CONSUMER}\"]}}")
assert_eq "$(status_of "$RESP")" "400" "A scope whose namespace is not its provider's route is refused (400)" || true
RESP=$(apply_shelf "{\"${SCOPE_READ}\":{\"provider\":\"${PROVIDER}\",\"consumers\":[\"e2e-idsurf\"]}}")
assert_contains "200 409" "$(status_of "$RESP")" "A consumer that is not installed is kept pending or refused: $(status_of "$RESP") $(body_of "$RESP" | jq -c '.code // .shelf.edges // empty' 2>/dev/null)" || true
host_api_delete "peers/shelves/${SHELF_ID}" > /dev/null 2>&1 || true
RESP=$(apply_shelf)
assert_eq "$(status_of "$RESP")" "200" "PUT /api/peers/shelves/${SHELF_ID}: ${SCOPE_READ} granted to ${CONSUMER}" || true
if wait_for 30 eval '[ "$(edge_state "${SCOPE_READ}")" = "effective" ]'; then
  log_pass "GET /api/peers: the edge ${CONSUMER} → ${SCOPE_READ} is effective"
else
  log_fail "The edge: $(peers_view | jq -c '.shelves')"
fi
assert_not_eq "$(audit_action_count peer.shelf.applied)" "0" "Audited: peer.shelf.applied" || true

# ===========================================================================
# 3. A granted call
# ===========================================================================

log_section "A granted call, from the visitor VM's agent to the agent VM's"

OUT=$(consumer_call "${SCOPE_READ}" GET /units/7)
assert_json_field "$OUT" '.status' '200' "GET /units/7 on ${SCOPE_READ}: 200 from the provider" || true
assert_json_field "$OUT" '.body | "\(.unitId) \(.caller.type) \(.caller.peer) \(.caller.scope) \(.caller.major) \(.caller.hops)"' "7 peer ${CONSUMER} ${SCOPE_READ} 1 1" "…the provider saw the peer caller the relay signed: ${CONSUMER}, ${SCOPE_READ}, major 1, one hop" || true
assert_json_field "$OUT" '.body.caller.endpoint' 'GET /units/:unitId' "…and the endpoint pattern the relay matched" || true
assert_json_field "$OUT" '.body.caller.user // "none"' 'none' "…no user: the plugin called as itself" || true

# ===========================================================================
# 4. Denied calls
# ===========================================================================

log_section "Denied: no grant, not in the allowlist, a sibling route"

assert_eq "$(call_code "${SCOPE_WRITE}" POST /echo)" "not_granted" "${SCOPE_WRITE} is not granted: 403 not_granted" || true
assert_eq "$(call_code "${SCOPE_READ}" GET /secret)" "endpoint_not_allowed" "GET /secret, which the provider serves but does not declare: 403 endpoint_not_allowed" || true
OUT=$(consumer_call "${SCOPE_READ}" GET /units/export)
assert_json_field "$OUT" '.status' '403' "GET /units/export (matches /units/:unitId, a static route of its own on the provider): 403" || true
assert_contains "$(json_get "$OUT" '.body.error')" "not the endpoint" "…the provider's SDK refused it: its route is not the endpoint the relay matched" || true
LOG=$(provider_peerlog)
assert_json_field "$LOG" '[.calls[]?.route] | unique | join(",")' '/peer/units/:unitId' "The provider's handlers ran only for the allowlisted route — never /secret, never /units/export" || true
DENIED=$(audit_action_count peer.call.denied)
if [ "${DENIED}" -ge 2 ] 2>/dev/null; then
  log_pass "The relay's refusals are audited (peer.call.denied: ${DENIED})"
else
  log_fail "peer.call.denied entries: ${DENIED}"
fi

# ===========================================================================
# 5. The shelf widened
# ===========================================================================

log_section "The shelf widened to ${SCOPE_WRITE}"

RESP=$(apply_shelf "{\"${SCOPE_READ}\":{\"provider\":\"${PROVIDER}\",\"consumers\":[\"${CONSUMER}\"]},\"${SCOPE_WRITE}\":{\"provider\":\"${PROVIDER}\",\"consumers\":[\"${CONSUMER}\"]}}")
assert_eq "$(status_of "$RESP")" "200" "Re-applied with ${SCOPE_WRITE} too" || true
OUT=$(consumer_call "${SCOPE_WRITE}" POST /echo '{"hello":"peers"}')
assert_json_field "$OUT" '"\(.status) \(.body.echoed.hello) \(.body.caller.scope)"' "200 peers ${SCOPE_WRITE}" "POST /echo with a body: 200, echoed, under ${SCOPE_WRITE}" || true
assert_eq "$(call_code "${SCOPE_READ}" GET /units/8)" "200" "${SCOPE_READ} still answers (its edge kept across the re-apply)" || true

# ===========================================================================
# 6. The provider's dependents
# ===========================================================================

log_section "The provider cannot go while the consumer depends on it"

RESP=$(host_api_call DELETE "plugins/${PROVIDER}/hosting?force=true")
assert_eq "$(status_of "$RESP")" "409" "Unhosting the provider: 409, even with force" || true
assert_json_field "$(body_of "$RESP")" '"\(.code) \([.consumers[]? | if type == "object" then .consumer // .name else . end] | join(","))"' "peer_dependents ${CONSUMER}" "…peer_dependents, naming ${CONSUMER}" || true
RESP=$(host_api_call DELETE "plugins/${PROVIDER}?force=true")
assert_eq "$(status_of "$RESP")" "409" "Uninstalling the provider: 409 peer_dependents" || true
assert_eq "$(call_code "${SCOPE_READ}" GET /units/9)" "200" "…and it still answers" || true

end_test

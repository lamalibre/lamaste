#!/usr/bin/env bash
# ============================================================================
# 61 — The provider offline (Three-VM)
# ============================================================================
# Slice 8's failure handling. The consumer e2e-pcons (visitor VM's second
# agent) calls the provider e2e-pdir (agent VM):
#
# 1. The provider's agent half stopped (its socket and service): once the
#    relay's health monitor reports it down (reason app — the tunnel still
#    answers, the half does not), a call is refused at once: 503
#    peer_unavailable, reason down_app, with Retry-After; nothing waits on a
#    dead port. Started again: up, and the call answers.
# 2. The provider's whole agent unreachable (its chisel client and sync timer
#    stopped on the agent VM): down, reason tunnel → 503 peer_unavailable,
#    down_tunnel. The agent back: up, and the call answers; events published
#    after the recovery are delivered.
#
# The last peers spec: its cleanup also removes the second agent from the
# visitor VM (the suite leaves the VMs as it found them).
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../e2e/helpers.sh"
# shellcheck source-path=SCRIPTDIR source=app-plugin-harness.sh
source "${SCRIPT_DIR}/app-plugin-harness.sh"
# shellcheck source-path=SCRIPTDIR source=peers-harness.sh
source "${SCRIPT_DIR}/peers-harness.sh"

require_commands multipass curl jq node npm tar perl openssl

POLICY_ID="e2e-apphost-61"
REMOTE_DIR="/var/tmp/e2e-61-peers"
LOCAL_TMP=""
CLEAN_PLUGINS="${CONSUMER} ${PROVIDER}"
CLEAN_ROUTES="${PROVIDER}"
PURGE_PACKAGES=""
PROVIDER_UNITS="lamalibre-app-${PROVIDER}.socket lamalibre-app-${PROVIDER}.service"
CHISEL_UNIT="lamalibre-lamaste-chisel-${AGENT_LABEL}"

begin_test "61 — The provider offline (Three-VM)"

cleanup() {
  log_info "Cleaning up test resources..."
  timed_exec 60 multipass exec "${AGENT_VM}" -- sudo bash -c "systemctl start ${PROVIDER_UNITS} > /dev/null 2>&1; XDG_RUNTIME_DIR=/run/user/0 systemctl --user start ${SYNC_TIMER} ${CHISEL_UNIT} > /dev/null 2>&1; true" > /dev/null 2>&1
  peers_cleanup
  remove_second_agent
}
trap cleanup EXIT

provider_health() { hosting_field "${PROVIDER}" '.hosting.health | "\(.state) \(.reason)"'; }
provider_state_is() { [ "$(hosting_field "${PROVIDER}" '.hosting.health.state')" = "$1" ]; }
call_answers() { [ "$(consumer_call "${SCOPE_READ}" GET /units/1 | jq -r '.status // empty' 2>/dev/null)" = "200" ]; }

# ---------------------------------------------------------------------------
log_section "Pre-flight, both plugins hosted, the shelf applied"
# ---------------------------------------------------------------------------

app_plugin_preflight
host_api_delete "peers/shelves/${SHELF_ID}" > /dev/null 2>&1 || true
LOCAL_TMP=$(mktemp -d /tmp/e2e-61-peers-XXXXXXXX)
peers_setup "${POLICY_ID}"
RESP=$(apply_shelf)
assert_eq "$(status_of "$RESP")" "200" "The shelf grants ${SCOPE_READ} to ${CONSUMER}" || true
if wait_for 30 call_answers; then
  log_pass "A call answers while the provider is up"
else
  log_fail "The call: $(consumer_call "${SCOPE_READ}" GET /units/1)"
fi

# ===========================================================================
# 1. The provider's agent half stopped
# ===========================================================================

log_section "The provider's agent half stopped"

agent_exec "systemctl stop ${PROVIDER_UNITS}" > /dev/null 2>&1 || true
if wait_for 90 provider_state_is down; then
  log_pass "The relay's health of ${PROVIDER}: $(provider_health)"
else
  log_fail "Health: $(provider_health)"
fi
assert_eq "$(provider_health)" "down app" "…reason app: the tunnel answers, the half does not" || true
T0=$SECONDS
OUT=$(consumer_call "${SCOPE_READ}" GET /units/1)
assert_json_field "$OUT" '"\(.error.code) \(.error.status) \(.error.reason)"' 'peer_unavailable 503 down_app' "A call: 503 peer_unavailable, down_app" || true
assert_not_eq "$(json_get "$OUT" '.error.retryAfter // empty')" "" "…with Retry-After ($(json_get "$OUT" '.error.retryAfter // ""') s)" || true
if [ $((SECONDS - T0)) -le 10 ]; then
  log_pass "…answered at once ($((SECONDS - T0)) s): nothing waited on the dead port"
else
  log_fail "The refusal took $((SECONDS - T0)) s"
fi
agent_exec "systemctl start ${PROVIDER_UNITS}" > /dev/null 2>&1 || true
if wait_for 90 provider_state_is up && wait_for 60 call_answers; then
  log_pass "Started again: up, and the call answers"
else
  log_fail "After the restart: $(provider_health), $(consumer_call "${SCOPE_READ}" GET /units/1)"
fi

# ===========================================================================
# 2. The provider's agent unreachable
# ===========================================================================

log_section "The provider's agent unreachable (its chisel client stopped)"

user_systemctl "stop ${SYNC_TIMER} ${CHISEL_UNIT}" > /dev/null 2>&1 || true
if wait_for 90 provider_state_is down; then
  log_pass "Down: $(provider_health)"
else
  log_fail "Health: $(provider_health)"
fi
assert_eq "$(provider_health)" "down tunnel" "…reason tunnel: nothing answers on the relay's end" || true
OUT=$(consumer_call "${SCOPE_READ}" GET /units/1)
assert_json_field "$OUT" '"\(.error.code) \(.error.status) \(.error.reason)"' 'peer_unavailable 503 down_tunnel' "A call: 503 peer_unavailable, down_tunnel" || true
user_systemctl "start ${CHISEL_UNIT} ${SYNC_TIMER}" > /dev/null 2>&1 || true
nudge_sync
if wait_for 120 provider_state_is up && wait_for 60 call_answers; then
  log_pass "The agent back: up, and the call answers"
else
  log_fail "After the recovery: $(provider_health), $(consumer_call "${SCOPE_READ}" GET /units/1)"
fi
BEFORE=$(consumer_state | jq '.events | length' 2>/dev/null || echo 0)
provider_publish 2 after > /dev/null
if wait_for 60 eval '[ "$(consumer_state | jq ".events | length" 2>/dev/null || echo 0)" = "$((BEFORE + 2))" ]'; then
  log_pass "Events published after the recovery are delivered"
else
  log_fail "Events: $(consumer_state | jq -c '.events')"
fi

end_test

#!/usr/bin/env bash
# ============================================================================
# 60 — Events between app plugins across a consumer restart (Three-VM)
# ============================================================================
# Slice 8's events. The provider e2e-pdir (agent VM) writes events into its
# outbox in the transaction of each change; the consumer e2e-pcons (visitor
# VM's second agent), subscribed to unit.changed, pulls them over its peer
# channel and applies each in the transaction that moves its cursor; its
# handler records every event it is given (no uniqueness: a duplicate would
# show):
#
# 1. First contact: the consumer starts with an `initial` gap (onGap runs)
#    and then receives every event published after it, in order.
# 2. The consumer's agent half stopped (its socket and service on the
#    visitor VM): events published meanwhile wait in the provider's outbox;
#    started again, the relay attaches anew and the consumer catches up
#    from its cursor — each event exactly once, in order.
# 3. The grant removed (the shelf deleted): events published meanwhile are
#    never delivered — the consumer had no grant for them. Granted again,
#    the subscription has a new epoch: a `granted` gap, then only what comes
#    after it. A pull made by hand with that epoch and stream from an older
#    position (0) is answered a gap, never the events the consumer had no
#    grant for: the relay keeps the floor it gave the gap with.
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../e2e/helpers.sh"
# shellcheck source-path=SCRIPTDIR source=app-plugin-harness.sh
source "${SCRIPT_DIR}/app-plugin-harness.sh"
# shellcheck source-path=SCRIPTDIR source=peers-harness.sh
source "${SCRIPT_DIR}/peers-harness.sh"

require_commands multipass curl jq node npm tar perl openssl

POLICY_ID="e2e-apphost-60"
REMOTE_DIR="/var/tmp/e2e-60-peers"
LOCAL_TMP=""
CLEAN_PLUGINS="${CONSUMER} ${PROVIDER}"
CLEAN_ROUTES="${PROVIDER}"
PURGE_PACKAGES=""
CONSUMER_UNITS="lamalibre-app-${CONSUMER}.socket lamalibre-app-${CONSUMER}.service"

begin_test "60 — Events between app plugins across a consumer restart (Three-VM)"

cleanup() {
  log_info "Cleaning up test resources..."
  timed_exec 60 multipass exec "${VISITOR_VM}" -- sudo bash -c "systemctl start ${CONSUMER_UNITS} > /dev/null 2>&1; true" > /dev/null 2>&1
  peers_cleanup
}
trap cleanup EXIT

# events_tags — the consumer's recorded events as "<tag>-<n>" in the order recorded
events_tags() { consumer_state | jq -r '[.events[]? | "\(.tag)-\(.n)"] | join(",")' 2>/dev/null || echo "?"; }
# events_seq_ok — the recorded seqs strictly increase (in order, no duplicate)
events_seq_ok() {
  consumer_state | jq -e '[.events[]?.seq] as $s | ($s | length) == ($s | unique | length) and $s == ($s | sort)' > /dev/null 2>&1
}
gap_reasons() { consumer_state | jq -r '[.gaps[]?.reason] | join(",")' 2>/dev/null || echo "?"; }
tags_are() { [ "$(events_tags)" = "$1" ]; }
gaps_are() { [ "$(gap_reasons)" = "$1" ]; }
consumer_health() { hosting_field "${CONSUMER}" '.hosting.health.state'; }
consumer_down() { [ "$(consumer_health)" = "down" ]; }
consumer_up() { [ "$(consumer_health)" = "up" ]; }

# ---------------------------------------------------------------------------
log_section "Pre-flight, both plugins hosted, the shelf applied"
# ---------------------------------------------------------------------------

app_plugin_preflight
host_api_delete "peers/shelves/${SHELF_ID}" > /dev/null 2>&1 || true
LOCAL_TMP=$(mktemp -d /tmp/e2e-60-peers-XXXXXXXX)
peers_setup "${POLICY_ID}"
OUT=$(provider_publish 2 before)
assert_json_field "$OUT" '.seqs | length' '2' "Two events published before the consumer was ever granted anything" || true
RESP=$(apply_shelf)
assert_eq "$(status_of "$RESP")" "200" "The shelf grants ${SCOPE_READ} (and its unit.changed events) to ${CONSUMER}" || true
assert_json_field "$(peers_view)" "[.edges[]? | select(.consumer == \"${CONSUMER}\" and .scope == \"${SCOPE_READ}\") | .events | join(\",\")] | first" "${EVENT_TYPE}" "GET /api/peers: the subscription to ${EVENT_TYPE}" || true

# ===========================================================================
# 1. First contact
# ===========================================================================

log_section "First contact: an initial gap, then the events in order"

if wait_for 60 gaps_are initial; then
  log_pass "The consumer started with an 'initial' gap: onGap ran (its reconcile)"
else
  log_fail "Gaps: $(gap_reasons)"
fi
assert_eq "$(events_tags)" "" "…and was given none of the events from before its starting point" || true
provider_publish 3 a > /dev/null
if wait_for 60 tags_are "a-1,a-2,a-3"; then
  log_pass "Three events delivered in order: a-1,a-2,a-3"
else
  log_fail "Recorded: $(events_tags)"
fi

# ===========================================================================
# 2. The consumer stopped and started again
# ===========================================================================

log_section "The consumer's agent half stopped: events wait, then come once"

visitor_exec "systemctl stop ${CONSUMER_UNITS}" > /dev/null 2>&1 || true
if wait_for 90 consumer_down; then
  log_pass "The relay's health of ${CONSUMER} is down ($(hosting_field "${CONSUMER}" '.hosting.health.reason'))"
else
  log_fail "Health of ${CONSUMER}: $(hosting_field "${CONSUMER}" '.hosting.health')"
fi
OUT=$(provider_publish 4 b)
assert_json_field "$OUT" '.seqs | length' '4' "Four events published while the consumer is stopped" || true
visitor_exec "systemctl start ${CONSUMER_UNITS}" > /dev/null 2>&1 || true
if wait_for 90 consumer_up && wait_for 60 consumer_connected; then
  log_pass "Started again: up, and the relay attached its channel anew"
else
  log_fail "After the restart: health $(consumer_health), $(consumer_state | jq -c '{connected}')"
fi
if wait_for 60 tags_are "a-1,a-2,a-3,b-1,b-2,b-3,b-4"; then
  log_pass "It caught up from its cursor: b-1..b-4 after a-1..a-3"
else
  log_fail "Recorded: $(events_tags)"
fi
if events_seq_ok; then
  log_pass "Every event exactly once, in order of the provider's seq"
else
  log_fail "Seqs: $(consumer_state | jq -c '[.events[]?.seq]')"
fi
assert_eq "$(gap_reasons)" "initial" "No gap across the restart: the cursor was enough" || true

# ===========================================================================
# 3. The grant removed, then granted again
# ===========================================================================

log_section "The grant removed, events meanwhile, granted again"

RESP=$(host_api_call DELETE "peers/shelves/${SHELF_ID}")
assert_eq "$(status_of "$RESP")" "200" "The shelf removed" || true
provider_publish 2 c > /dev/null
sleep 20
assert_eq "$(events_tags)" "a-1,a-2,a-3,b-1,b-2,b-3,b-4" "Events published without a grant are not delivered" || true
RESP=$(apply_shelf)
assert_eq "$(status_of "$RESP")" "200" "The shelf applied again" || true
if wait_for 60 gaps_are "initial,granted"; then
  log_pass "Granted again: a 'granted' gap (a new epoch), onGap ran"
else
  log_fail "Gaps: $(gap_reasons)"
fi
provider_publish 1 d > /dev/null
if wait_for 60 tags_are "a-1,a-2,a-3,b-1,b-2,b-3,b-4,d-1"; then
  log_pass "Only what came after the new grant is delivered: d-1, never c-1 or c-2"
else
  log_fail "Recorded: $(events_tags)"
fi
if events_seq_ok; then
  log_pass "Still each exactly once, in order"
else
  log_fail "Seqs: $(consumer_state | jq -c '[.events[]?.seq]')"
fi
CURSOR=$(consumer_state | jq -c --arg s "${SCOPE_READ}" '[.cursors[]? | select(.scope == $s)] | first // {}')
EPOCH=$(json_get "$CURSOR" '.epoch // empty')
STREAM=$(json_get "$CURSOR" '.stream_id // empty')
assert_not_eq "${EPOCH}" "" "The consumer's cursor of ${SCOPE_READ}: epoch and stream after the granted gap ($(json_get "$CURSOR" '.cursor'))" || true
OUT=$(consumer_rawpull "${SCOPE_READ}" 0 "${EPOCH}" "${STREAM}")
assert_json_field "$OUT" '.status' '200' "A pull by hand with that epoch and stream from position 0: answered" || true
assert_json_field "$OUT" '"\(.body.gap != null) \((.body.events // []) | length)"' 'true 0' "…with a gap and no events: c-1 and c-2, published without a grant, stay out of reach ($(json_get "$OUT" '.body.gap.reason // ""'))" || true

end_test

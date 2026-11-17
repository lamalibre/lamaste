#!/usr/bin/env bash
# ============================================================================
# 69 — A provider restored from a backup renews its event stream (Three-VM)
# ============================================================================
# 4.14.2. The provider e2e-pdir (agent VM) is restored from a backup of its
# database while the consumer e2e-pcons (visitor VM's second agent) is away.
# A restored outbox reissues the `seq` values it had given out after the
# backup, under the stream id it had then. The restore is done as a
# plugin's runbook would: the agent half stopped (its socket and service),
# the backup copied over data.db by the plugin's own account, and — where
# the spec says so — the plugin's restore step, renewPeerOutboxStream on
# data.db, run as that account under the unit's protections; then the half
# started again.
#
# 1. Without renewal (the case renewStream closes): the consumer read two
#    events past the backup; the restored provider writes three new ones,
#    so its head passes the consumer's cursor under the same stream. The
#    consumer continues from reissued seq values: it never sees the first
#    two and is told nothing.
# 2. With renewal, the same restore: the consumer's next pull is answered
#    the gap `stream_changed` at the head — none of the restored history
#    crosses as events — and it reads on, on the new stream.
# 3. With renewal and nothing written since the restore, the consumer's
#    cursor ahead of the restored head: `stream_changed` too, not a stalled
#    pull (the relay reads a provider's answer for a cursor past its head
#    as the head since 4.14.2).
# 4. Without renewal, the cursor ahead of the restored head and the relay's
#    floor above it (a gap after the backup): one `stream_changed`, the
#    floor following the head down, and events again — not a gap after
#    every pull.
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../e2e/helpers.sh"
# shellcheck source-path=SCRIPTDIR source=app-plugin-harness.sh
source "${SCRIPT_DIR}/app-plugin-harness.sh"
# shellcheck source-path=SCRIPTDIR source=peers-harness.sh
source "${SCRIPT_DIR}/peers-harness.sh"

require_commands multipass curl jq node npm tar perl openssl

POLICY_ID="e2e-apphost-69"
REMOTE_DIR="/var/tmp/e2e-69-peers"
LOCAL_TMP=""
CLEAN_PLUGINS="${CONSUMER} ${PROVIDER}"
CLEAN_ROUTES="${PROVIDER}"
PURGE_PACKAGES=""
CONSUMER_UNITS="lamalibre-app-${CONSUMER}.socket lamalibre-app-${CONSUMER}.service"
PROVIDER_UNITS="lamalibre-app-${PROVIDER}.socket lamalibre-app-${PROVIDER}.service"
PROVIDER_USER="lamaste-app-${PROVIDER}"
PROVIDER_DATA="/var/lib/lamalibre/apps/${PROVIDER}"

begin_test "69 — A provider restored from a backup renews its event stream (Three-VM)"

cleanup() {
  log_info "Cleaning up test resources..."
  timed_exec 60 multipass exec "${VISITOR_VM}" -- sudo bash -c "systemctl start ${CONSUMER_UNITS} > /dev/null 2>&1; true" > /dev/null 2>&1
  timed_exec 60 multipass exec "${AGENT_VM}" -- sudo bash -c "systemctl start ${PROVIDER_UNITS} > /dev/null 2>&1; rm -f ${PROVIDER_DATA}/e2e-backup.db; true" > /dev/null 2>&1
  peers_cleanup
}
trap cleanup EXIT

events_tags() { consumer_state | jq -r '[.events[]? | "\(.tag)-\(.n)"] | join(",")' 2>/dev/null || echo "?"; }
gap_reasons() { consumer_state | jq -r '[.gaps[]?.reason] | join(",")' 2>/dev/null || echo "?"; }
gaps_are() { [ "$(gap_reasons)" = "$1" ]; }
has_tag() { events_tags | tr ',' '\n' | grep -qx "$1"; }
health_of() { hosting_field "$1" '.hosting.health.state'; }
is_up() { [ "$(health_of "$1")" = "up" ]; }
is_down() { [ "$(health_of "$1")" = "down" ]; }
stream_of_provider() { json_get "$(provider_outbox)" '.state.streamId'; }
cursor_stream() { json_get "$(consumer_cursor "${SCOPE_READ}")" '.stream_id'; }

# consumer_away — the consumer's agent half stopped; waits for the relay to see it down
consumer_away() {
  visitor_exec "systemctl stop ${CONSUMER_UNITS}" > /dev/null 2>&1 || true
  if wait_for 90 is_down "${CONSUMER}"; then
    log_pass "$1: ${CONSUMER} stopped, the relay sees it down"
  else
    log_fail "$1: health of ${CONSUMER} $(hosting_field "${CONSUMER}" '.hosting.health')"
  fi
}

# consumer_back — started again: up and its channel attached
consumer_back() {
  visitor_exec "systemctl start ${CONSUMER_UNITS}" > /dev/null 2>&1 || true
  if wait_for 90 is_up "${CONSUMER}" && wait_for 60 consumer_connected; then
    log_pass "$1: ${CONSUMER} back, its channel attached"
  else
    log_fail "$1: health $(health_of "${CONSUMER}"), $(consumer_state | jq -c '{connected}')"
  fi
}

# restore_provider <renew|keep> — the provider's half stopped; the backup
# copied over data.db and its WAL dropped (the backup is the whole
# database) by the plugin's own account — root never acts on a path that
# account controls; with <renew>, the restore step run as that account
# under the unit's own protections (systemd-run: no network, the data
# directory the only writable path); the half started. Prints the restore
# step's output (its JSON line) and RESTORED.
restore_provider() {
  timed_exec 180 multipass exec "${AGENT_VM}" -- sudo bash -c "
    set -e
    systemctl stop ${PROVIDER_UNITS}
    runuser -u ${PROVIDER_USER} -- sh -c 'cd ${PROVIDER_DATA} && cp -- e2e-backup.db data.db.restoring && rm -f data.db-wal data.db-shm && mv -f data.db.restoring data.db'
    if [ '$1' = renew ]; then
      argv=\$(systemctl show -p ExecStart --value lamalibre-app-${PROVIDER}.service | sed -n 's/.*argv\[\]=\([^;]*\) ;.*/\1/p')
      systemd-run --wait --pipe --collect --quiet \\
        -p User=${PROVIDER_USER} -p Group=${PROVIDER_USER} -p WorkingDirectory=${PROVIDER_DATA} \\
        -p NoNewPrivileges=yes -p ProtectSystem=strict -p ReadWritePaths=${PROVIDER_DATA} \\
        -p ProtectHome=yes -p PrivateTmp=yes -p PrivateDevices=yes -p PrivateNetwork=yes -p MemoryMax=256M \\
        -E LAMASTE_APP_DATA_DIR=${PROVIDER_DATA} -E NODE_ENV=production \\
        \$argv --renew-peer-stream
    fi
    systemctl start ${PROVIDER_UNITS}
    echo RESTORED" 2>&1 || true
}

# provider_back — the provider's half answers health checks again
provider_back() {
  if wait_for 120 is_up "${PROVIDER}"; then
    log_pass "$1: ${PROVIDER} up again"
  else
    log_fail "$1: health of ${PROVIDER} $(hosting_field "${PROVIDER}" '.hosting.health')"
  fi
}

# ---------------------------------------------------------------------------
log_section "Pre-flight, both plugins hosted, the shelf applied"
# ---------------------------------------------------------------------------

app_plugin_preflight
host_api_delete "peers/shelves/${SHELF_ID}" > /dev/null 2>&1 || true
LOCAL_TMP=$(mktemp -d /tmp/e2e-69-peers-XXXXXXXX)
peers_setup "${POLICY_ID}"
RESP=$(apply_shelf)
assert_eq "$(status_of "$RESP")" "200" "The shelf grants ${SCOPE_READ} and its ${EVENT_TYPE} events to ${CONSUMER}" || true
if wait_for 90 gaps_are initial && wait_for 60 consumer_cursor_ready "${SCOPE_READ}"; then
  log_pass "The consumer started with an 'initial' gap and holds a cursor"
else
  log_fail "Gaps $(gap_reasons), cursor $(consumer_cursor "${SCOPE_READ}")"
fi

# ===========================================================================
# 1. Without renewal: the loss is silent
# ===========================================================================

log_section "Restored without renewing the stream: reissued seq values, no gap"

OUT=$(provider_backup)
BACKUP_HEAD=$(json_get "$OUT" '.state.head')
STREAM_A=$(json_get "$OUT" '.state.streamId')
assert_not_eq "${STREAM_A}" "" "A backup of the provider's database at head ${BACKUP_HEAD}" || true
provider_publish 2 x > /dev/null
if wait_for 60 has_tag x-2; then
  log_pass "The consumer read x-1 and x-2, written after the backup"
else
  log_fail "Recorded: $(events_tags)"
fi
consumer_away "Before the restore"
OUT=$(restore_provider keep)
assert_contains "$OUT" "RESTORED" "The provider restored from the backup, its stream kept" || true
provider_back "Restored"
assert_eq "$(stream_of_provider)" "${STREAM_A}" "The restored outbox has the backup's stream id" || true
OUT=$(provider_publish 3 y)
assert_eq "$(json_get "$OUT" '.seqs[0]')" "$((BACKUP_HEAD + 1))" "The restored outbox reissues seq $((BACKUP_HEAD + 1)), which x-1 had" || true
consumer_back "After the restore"
if wait_for 60 has_tag y-3; then
  log_pass "The consumer reads on from its cursor: y-3"
else
  log_fail "Recorded: $(events_tags)"
fi
if has_tag y-1 || has_tag y-2; then
  log_fail "y-1 or y-2 reached the consumer: $(events_tags)"
else
  log_pass "y-1 and y-2 never reach it — their seq values are behind its cursor"
fi
assert_eq "$(gap_reasons)" "initial" "…and it is told nothing: the loss renewStream() closes" || true

# ===========================================================================
# 2. With renewal: stream_changed, whatever the cursor
# ===========================================================================

log_section "Restored and the stream renewed: the gap stream_changed"

wait_for 60 consumer_cursor_ready "${SCOPE_READ}" > /dev/null || true
OUT=$(provider_backup)
STREAM_B=$(json_get "$OUT" '.state.streamId')
provider_publish 2 z > /dev/null
if wait_for 60 has_tag z-2; then
  log_pass "The consumer read z-1 and z-2, written after the second backup"
else
  log_fail "Recorded: $(events_tags)"
fi
# What the consumer recorded before it goes away (its half answers nothing while stopped).
EVENTS_BEFORE=$(events_tags)
consumer_away "Before the second restore"
OUT=$(restore_provider renew)
assert_contains "$OUT" "RESTORED" "The provider restored, its restore step run as ${PROVIDER_USER} under the unit's protections" || true
RENEWED=$(printf '%s\n' "$OUT" | grep '^{"renewed"' | head -n 1)
STREAM_C=$(json_get "$RENEWED" '.renewed.streamId // empty')
assert_not_eq "${STREAM_C}" "" "renewPeerOutboxStream answered a new stream (${RENEWED})" || true
assert_not_eq "${STREAM_C}" "${STREAM_B}" "…not the backup's" || true
provider_back "Restored and renewed"
assert_eq "$(stream_of_provider)" "${STREAM_C}" "The running outbox serves the renewed stream" || true
provider_publish 3 w > /dev/null
consumer_back "After the second restore"
if wait_for 90 gaps_are "initial,stream_changed"; then
  log_pass "The consumer's next pull was answered the gap stream_changed (onGap ran)"
else
  log_fail "Gaps: $(gap_reasons)"
fi
if wait_for 60 consumer_cursor_ready "${SCOPE_READ}"; then
  log_pass "The gap reconciled: a cursor again, no gap pending"
else
  log_fail "Cursor: $(consumer_cursor "${SCOPE_READ}")"
fi
assert_eq "$(cursor_stream)" "${STREAM_C}" "The consumer's cursor is on the renewed stream" || true
assert_eq "$(events_tags)" "${EVENTS_BEFORE}" "None of w-1..w-3 crossed as events — the reconcile covers them" || true
provider_publish 1 v > /dev/null
if wait_for 60 has_tag v-1; then
  log_pass "It reads on, on the new stream: v-1"
else
  log_fail "Recorded: $(events_tags)"
fi

# ===========================================================================
# 3. A cursor ahead of the restored head
# ===========================================================================

log_section "Restored and renewed, nothing written since: the cursor ahead of the head"

wait_for 60 consumer_cursor_ready "${SCOPE_READ}" > /dev/null || true
provider_backup > /dev/null
provider_publish 2 u > /dev/null
if wait_for 60 has_tag u-2; then
  log_pass "The consumer read u-1 and u-2, written after the third backup"
else
  log_fail "Recorded: $(events_tags)"
fi
consumer_away "Before the third restore"
OUT=$(restore_provider renew)
assert_contains "$OUT" "RESTORED" "The provider restored and renewed again" || true
STREAM_D=$(json_get "$(printf '%s\n' "$OUT" | grep '^{"renewed"' | head -n 1)" '.renewed.streamId // empty')
provider_back "Restored a third time"
consumer_back "After the third restore"
if wait_for 90 gaps_are "initial,stream_changed,stream_changed"; then
  log_pass "Its cursor past the restored head: stream_changed again, not a stalled pull"
else
  log_fail "Gaps: $(gap_reasons); cursor $(consumer_cursor "${SCOPE_READ}")"
fi
if wait_for 60 consumer_cursor_ready "${SCOPE_READ}"; then
  assert_eq "$(cursor_stream)" "${STREAM_D}" "The consumer's cursor is on the third stream" || true
else
  log_fail "Cursor: $(consumer_cursor "${SCOPE_READ}")"
fi
provider_publish 1 t > /dev/null
if wait_for 60 has_tag t-1; then
  log_pass "It reads on: t-1"
else
  log_fail "Recorded: $(events_tags)"
fi

# ===========================================================================
# 4. Without renewal, the cursor ahead and the floor above the restored head
# ===========================================================================

log_section "Restored without renewal, a gap after the backup: one stream_changed, no loop"

wait_for 60 consumer_cursor_ready "${SCOPE_READ}" > /dev/null || true
provider_backup > /dev/null
provider_publish 2 s > /dev/null
if wait_for 60 has_tag s-2; then
  log_pass "The consumer read s-1 and s-2, written after the fourth backup"
else
  log_fail "Recorded: $(events_tags)"
fi
# The grant renewed: a gap whose floor is the head after s-2, above the backup.
host_api_delete "peers/shelves/${SHELF_ID}" > /dev/null 2>&1 || true
RESP=$(apply_shelf)
assert_eq "$(status_of "$RESP")" "200" "The shelf applied again: a new grant" || true
if wait_for 90 gaps_are "initial,stream_changed,stream_changed,granted" && wait_for 60 consumer_cursor_ready "${SCOPE_READ}"; then
  log_pass "A 'granted' gap at the head after the backup: the relay's floor is above it"
else
  log_fail "Gaps: $(gap_reasons)"
fi
consumer_away "Before the fourth restore"
OUT=$(restore_provider keep)
assert_contains "$OUT" "RESTORED" "The provider restored, its stream kept" || true
provider_back "Restored a fourth time"
consumer_back "After the fourth restore"
if wait_for 90 gaps_are "initial,stream_changed,stream_changed,granted,stream_changed"; then
  log_pass "Its cursor past the restored head: stream_changed"
else
  log_fail "Gaps: $(gap_reasons)"
fi
sleep 20
assert_eq "$(gap_reasons)" "initial,stream_changed,stream_changed,granted,stream_changed" "Twenty seconds on, no further gap: the floor followed the head down" || true
provider_publish 1 r > /dev/null
if wait_for 60 has_tag r-1; then
  log_pass "It reads on from the restored head: r-1"
else
  log_fail "Recorded: $(events_tags)"
fi
end_test

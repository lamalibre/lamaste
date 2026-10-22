#!/usr/bin/env bash
# ============================================================================
# 38 — App plugin with its hosting agent offline (Three-VM)
# ============================================================================
# An app plugin with settings (fixture @lamalibre/e2e-apphost-off-server,
# helpers.sh: write_app_install_fixture … v1) is hosted on the agent VM from
# the panel as in spec 34 and configured (a test secret that exists only on
# the host VM, as in spec 37); then the agent VM itself is taken down:
#
# 1. While the agent runs, the relay records when it last saw it — each
#    sync's GET /api/tunnels/agent-config — as agentLastSeenAt on the
#    hosting and lastSeenAt on GET /api/certs/agent, and it advances.
# 2. The agent VM stopped: the health monitor reports the hosting down,
#    reason tunnel; while it is down the forwarder answers 502 (tunnel)
#    without connecting to the port (the plugin declares no tunnel:down
#    fallback); agentLastSeenAt stays at the agent's last sync before it
#    went down (read again 70 seconds later); GET settings answers from the
#    relay's cache (source cache, the secret { set: true }); a change is
#    refused with 503 hosting_offline — one carrying a new secret too, which
#    is then on no relay file, row, journal line or answer: the relay keeps
#    nothing to deliver later.
# 3. The agent VM started again: the hosting is up, the pages answer, GET
#    settings is live again, a change is accepted and reaches the agent
#    half, agentLastSeenAt advances; the offline write never arrives.
#
# The cleanup starts the agent VM again should the spec end while it is
# down, then uninstalls with purge.
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../e2e/helpers.sh"
# shellcheck source-path=SCRIPTDIR source=app-plugin-harness.sh
source "${SCRIPT_DIR}/app-plugin-harness.sh"

require_commands multipass curl jq node npm tar perl

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

PLUGIN="e2e-apphost-off"
SERVER_PACKAGE="@lamalibre/e2e-apphost-off-server"
AGENT_PACKAGE="@lamalibre/e2e-apphost-off-agent"
POLICY_ID="e2e-apphost-38"
REMOTE_DIR="/var/tmp/e2e-38-app-plugin"
PRIV="${REMOTE_DIR}/private"
LOCAL_TMP=""
CLEAN_PLUGINS="${PLUGIN}"
CLEAN_ROUTES="${PLUGIN}"
PURGE_PACKAGES=""
# Set while the agent VM is stopped: the cleanup starts it again
AGENT_STOPPED=""

health_up() { [ "$(hosting_field "${PLUGIN}" '.hosting.health.state')" = "up" ]; }
health_down() { [ "$(hosting_field "${PLUGIN}" '.hosting.health.state')" = "down" ]; }
vm_up() { [ "$(timed_exec 20 multipass exec "${AGENT_VM}" -- echo up 2>/dev/null)" = "up" ]; }
vm_state() {
  multipass info "${AGENT_VM}" --format json 2>/dev/null | jq -r ".info[\"${AGENT_VM}\"].state // \"unknown\"" 2>/dev/null || echo "unknown"
}
host_now() { host_exec "date +%s" 2>/dev/null || echo "0"; }

# last_seen — agentLastSeenAt of the hosting (ISO 8601)
last_seen() { hosting_field "${PLUGIN}" '.hosting.agentLastSeenAt // empty'; }

# cert_last_seen — lastSeenAt of the agent on GET /api/certs/agent
cert_last_seen() {
  host_api_get "certs/agent" 2>/dev/null | jq -r "[.agents[]? | select(.label == \"${HOST_AGENT_LABEL}\" and (.revoked // false) == false) | .lastSeenAt] | first // empty" 2>/dev/null || echo ""
}

# seen_after <epoch> — agentLastSeenAt is later than <epoch> (the agent
# synced since); the agent's sync is started on each try
seen_after() {
  nudge_sync
  local now
  now=$(iso_epoch "$(last_seen)")
  [ -n "$now" ] && [ "$now" -gt "$1" ] 2>/dev/null
}

# assert_epoch_le <a> <b> <message> — Unix times, a ≤ b
assert_epoch_le() {
  if [ -n "$1" ] && [ -n "$2" ] && [ "$1" -le "$2" ] 2>/dev/null; then
    log_pass "$3"
    return 0
  fi
  log_fail "$3 (${1:-none} is not at or before ${2:-none})"
  return 1
}

begin_test "38 — App plugin with its hosting agent offline (Three-VM)"

cleanup() {
  log_info "Cleaning up test resources..."
  if [ -n "${AGENT_STOPPED}" ]; then
    timed_exec 240 multipass start "${AGENT_VM}" > /dev/null 2>&1
    wait_for 180 vm_up || true
  fi
  app_plugin_cleanup
}
trap cleanup EXIT

SPEC_START=$(host_now)

# ---------------------------------------------------------------------------
log_section "Pre-flight"
# ---------------------------------------------------------------------------

app_plugin_preflight
log_info "Hosting agent: ${HOST_AGENT_LABEL} (local name ${AGENT_LABEL}), relay domain ${DOMAIN}"

# ===========================================================================
# 1. Install, host and configure
# ===========================================================================

log_section "Install, host and configure the plugin"

LOCAL_TMP=$(mktemp -d /tmp/e2e-38-app-plugin-XXXXXXXX)
if ! write_app_install_fixture "${LOCAL_TMP}/ship/fixtures/v1" "${PLUGIN}" 1.0.0 main "r$(date +%s)-$$" '[]' v1; then
  log_fail "The fixture could not be built (npm install at the workspace root, npm run build -w packages/core/lib)"
  end_test
  exit $?
fi
log_pass "Fixture built: ${SERVER_PACKAGE} 1.0.0 (settings v1) and its agent package"
write_settings_call_script "${LOCAL_TMP}/ship/settings-call.sh"
ship_agent_facts_probe
start_stand_in_feria fixtures/v1/server fixtures/v1/agent
prepare_settings_priv
assert_eq "$(make_test_secret a)" "48" "Test secret A, made on the host VM in a 0600 file" || true
assert_eq "$(make_test_secret c)" "48" "Test secret C, for a change while the agent is offline" || true
DIGEST_A=$(secret_digest a)
ensure_app_host_helper
open_push_install "${POLICY_ID}" "[\"${AGENT_PACKAGE}\"]" '["install","uninstall"]'

INSTALL=$(install_approved "${PLUGIN}" "${SERVER_PACKAGE}@1.0.0")
assert_json_field "$INSTALL" '.plugin.version' '1.0.0' "Installed ${SERVER_PACKAGE}@1.0.0 and approved its agent half" || true
OP=$(host_plugin "${PLUGIN}" 300 nudge)
assert_json_field "$OP" '.status' 'succeeded' "Hosted on ${HOST_AGENT_LABEL} ($(json_get "$OP" '.error // .refused.error // ""'))" || true
if wait_for 60 health_up; then
  log_pass "The relay's health of the hosting is up"
else
  log_fail "Health: $(hosting_field "${PLUGIN}" '.hosting.health')"
fi
BODY_FILE=$(secret_put_body a 0 '{"region":"us"}')
RESP=$(settings_api_file PUT "plugins/${PLUGIN}/settings" "${BODY_FILE}")
host_exec "rm -f ${BODY_FILE}" > /dev/null 2>&1 || true
assert_eq "$(status_of "$RESP")" "200" "Configured: secret A and region us" || true
SET_AT_A=$(json_get "$(body_of "$RESP")" '.values.apiKey.setAt // empty')
PROBE=$(settings_probe "${PLUGIN}")
assert_json_field "$PROBE" '.secretDigests.apiKey' "${DIGEST_A}" "The agent half holds secret A (by digest)…" || true
assert_json_field "$PROBE" '.values.region' 'us' "…and region us" || true

# ===========================================================================
# 2. Presence while the agent runs
# ===========================================================================

log_section "While the agent runs, the relay sees it sync"

SEEN=$(last_seen)
SEEN_EPOCH=$(iso_epoch "$SEEN")
NOW=$(host_now)
if [ -n "$SEEN_EPOCH" ] && [ $((NOW - SEEN_EPOCH)) -le 120 ] 2>/dev/null; then
  log_pass "The hosting carries agentLastSeenAt ${SEEN}: the agent synced within the last two minutes"
else
  log_fail "agentLastSeenAt is '${SEEN}' (the relay's clock: ${NOW})"
fi
assert_not_eq "$(cert_last_seen)" "" "GET /api/certs/agent: ${HOST_AGENT_LABEL} carries lastSeenAt" || true
VIEW=$(settings_view "${PLUGIN}")
assert_json_field "$VIEW" '"\(.source) \(.hosting.state) \(.hosting.agentLastSeenAt != null)"' 'live up true' "GET settings: live, the hosting up, the agent's last contact shown" || true
if wait_for 90 seen_after "${SEEN_EPOCH:-0}"; then
  log_pass "agentLastSeenAt advances as the agent syncs ($(last_seen))"
else
  log_fail "agentLastSeenAt stayed at ${SEEN} while the agent synced"
fi
SYNCED_LIVE=$(json_get "$(settings_view "${PLUGIN}")" '.syncedAt // empty')

# ===========================================================================
# 3. The agent VM down
# ===========================================================================

log_section "The agent VM down: offline, read from the cache, writes refused"

STOP_BEGIN=$(host_now)
log_info "Stopping ${AGENT_VM}"
AGENT_STOPPED=1
timed_exec 180 multipass stop "${AGENT_VM}" > /dev/null 2>&1
assert_eq "$(vm_state)" "Stopped" "The agent VM is stopped" || true
STOPPED_AT=$(host_now)
SEEN_DOWN=$(last_seen)
CERT_SEEN_DOWN=$(cert_last_seen)
FROZEN_FROM=$SECONDS
assert_epoch_le "$(iso_epoch "$SEEN_DOWN")" "${STOPPED_AT}" "agentLastSeenAt (${SEEN_DOWN}) is from before the agent went down" || true
assert_epoch_le "$((STOP_BEGIN - 120))" "$(iso_epoch "$SEEN_DOWN")" "…its last sync, shortly before" || true

if wait_for 90 health_down; then
  log_pass "The health monitor reports the hosting down"
else
  log_fail "Health: $(hosting_field "${PLUGIN}" '.hosting.health')"
fi
HOSTING=$(host_api_get "plugins/${PLUGIN}/hosting")
assert_json_field "$HOSTING" '.hosting.health | "\(.state) \(.reason)"' 'down tunnel' "Hosting view: down, reason tunnel — nothing answers on the relay's end of the tunnel" || true
assert_epoch_le "${STOP_BEGIN}" "$(iso_epoch "$(json_get "$HOSTING" '.hosting.health.since')")" "…since the agent went down ($(json_get "$HOSTING" '.hosting.health.since'))" || true
assert_json_field "$HOSTING" '.hosting.agentLastSeenAt' "${SEEN_DOWN}" "…its agentLastSeenAt still the last sync" || true
PING=$(host_api_call GET "${PLUGIN}/ping")
assert_eq "$(status_of "$PING")" "502" "The pages answer 502 while the hosting is down…" || true
assert_json_field "$(body_of "$PING")" '.reason' 'tunnel' "…reason tunnel: the hosting agent is unreachable" || true
LISTED=$(host_api_get "plugins" | jq -c ".plugins[]? | select(.name == \"${PLUGIN}\")" 2>/dev/null || echo '{}')
assert_json_field "$LISTED" '.agentHosting.health.state' 'down' "GET /api/plugins shows the hosting down" || true
assert_json_field "$LISTED" '.settings.configured' 'true' "…and the plugin configured, from the cache" || true

RESP=$(settings_api GET "plugins/${PLUGIN}/settings")
assert_eq "$(status_of "$RESP")" "200" "GET settings still answers" || true
VIEW=$(body_of "$RESP")
assert_json_field "$VIEW" '.source' 'cache' "…from the relay's cache" || true
assert_json_field "$VIEW" '.hosting | "\(.state) \(.reason)"' 'down tunnel' "…saying the hosting is down (tunnel)" || true
assert_json_field "$VIEW" '.hosting.agentLastSeenAt' "${SEEN_DOWN}" "…and when the agent was last seen" || true
assert_json_field "$VIEW" '"\(.configured) \(.values.region) \(.values.apiKey.set) \(.values.apiKey.setAt)"' "true us true ${SET_AT_A}" "…with what was last synced: configured, region us, apiKey { set: true, setAt }" || true
assert_epoch_le "$(iso_epoch "$(json_get "$VIEW" '.syncedAt')")" "${STOPPED_AT}" "…synced before the agent went down ($(json_get "$VIEW" '.syncedAt'); last live read ${SYNCED_LIVE})" || true

RESP=$(settings_api PUT "plugins/${PLUGIN}/settings" "{\"revision\":$(json_get "$VIEW" '.revision'),\"values\":{\"region\":\"eu\"}}")
assert_eq "$(status_of "$RESP")" "503" "A change is refused while the agent is offline (503)" || true
assert_json_field "$(body_of "$RESP")" '"\(.code) \(.hosting.state)"' 'hosting_offline down' "…hosting_offline, with the hosting's state" || true
BODY_FILE=$(secret_put_body c "$(json_get "$VIEW" '.revision')" '{}')
RESP=$(settings_api_file PUT "plugins/${PLUGIN}/settings" "${BODY_FILE}")
host_exec "rm -f ${BODY_FILE}" > /dev/null 2>&1 || true
assert_eq "$(status_of "$RESP")" "503" "…so is one that carries a new secret, C" || true
SCAN=$(relay_secret_scan "${PLUGIN}" "${SPEC_START}")
assert_json_field "$SCAN" '"\(.files) \(.stateDb) \(.journal) \(.responses)"' '0 0 0 0' "Secret C (and A) is on no relay file, in no state.db row, journal line or answer: nothing kept to deliver later" || true
assert_json_field "$SCAN" '"\(.filesControl > 0) \(.stateDbLines > 0) \(.journalLines > 0)"' 'true true true' "…searches that find what is there" || true

# agentLastSeenAt must not move while the agent is down — read again after
# more than two of the agent's 30-second syncs (and the relay's once-a-minute
# write of it) would have passed.
WAIT=$((70 - (SECONDS - FROZEN_FROM)))
if [ "$WAIT" -gt 0 ]; then sleep "$WAIT"; fi
assert_eq "$(last_seen)" "${SEEN_DOWN}" "agentLastSeenAt has not moved $((SECONDS - FROZEN_FROM)) seconds later" || true
assert_eq "$(cert_last_seen)" "${CERT_SEEN_DOWN}" "…nor the agent's lastSeenAt on GET /api/certs/agent (${CERT_SEEN_DOWN})" || true
assert_epoch_le "$(iso_epoch "${CERT_SEEN_DOWN}")" "${STOPPED_AT}" "…which is from before the agent went down too" || true

# ===========================================================================
# 4. The agent VM back
# ===========================================================================

log_section "The agent VM back: up, live, writes accepted"

log_info "Starting ${AGENT_VM}"
timed_exec 240 multipass start "${AGENT_VM}" > /dev/null 2>&1
if wait_for 180 vm_up; then
  AGENT_STOPPED=""
  log_pass "The agent VM is back"
else
  log_fail "The agent VM did not come back within 180 seconds"
fi
up_again() {
  nudge_sync
  health_up
}
if wait_for 180 up_again; then
  log_pass "The health monitor reports the hosting up again"
else
  log_fail "Health: $(hosting_field "${PLUGIN}" '.hosting.health')"
fi
pages_back() { [ "$(json_get "$(host_api_get "${PLUGIN}/ping" 2>/dev/null)" '.pong')" = "true" ]; }
if wait_for 60 pages_back; then
  log_pass "The pages answer again"
else
  log_fail "The pages do not answer: $(host_api_get "${PLUGIN}/ping" 2>/dev/null)"
fi
VIEW=$(settings_view "${PLUGIN}")
assert_json_field "$VIEW" '"\(.source) \(.hosting.state)"' 'live up' "GET settings is live again" || true
REVISION=$(json_get "$VIEW" '.revision')
RESP=$(settings_api PUT "plugins/${PLUGIN}/settings" "{\"revision\":${REVISION:-0},\"values\":{\"region\":\"eu\"}}")
assert_eq "$(status_of "$RESP")" "200" "A change is accepted again" || true
PROBE=$(settings_probe "${PLUGIN}")
assert_json_field "$PROBE" '"\(.revision) \(.values.region)"' "$((${REVISION:-0} + 1)) eu" "…and reaches the agent half (region eu, revision $((${REVISION:-0} + 1)))" || true
assert_json_field "$PROBE" '.secretDigests.apiKey' "${DIGEST_A}" "The agent half still holds secret A: the offline write with secret C never arrived" || true
if wait_for 120 seen_after "$(iso_epoch "${SEEN_DOWN}")"; then
  log_pass "agentLastSeenAt advances again ($(last_seen))"
else
  log_fail "agentLastSeenAt stayed at ${SEEN_DOWN} after the agent came back"
fi
cert_seen_again() {
  nudge_sync
  [ "$(cert_last_seen)" != "${CERT_SEEN_DOWN}" ] && [ -n "$(cert_last_seen)" ]
}
if wait_for 90 cert_seen_again; then
  log_pass "…and so does lastSeenAt on GET /api/certs/agent ($(cert_last_seen))"
else
  log_fail "GET /api/certs/agent: lastSeenAt stayed at ${CERT_SEEN_DOWN}"
fi

end_test

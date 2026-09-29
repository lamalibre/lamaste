#!/usr/bin/env bash
# ============================================================================
# 03 — Tunnel Toggle Traffic (Three-VM)
# ============================================================================
# Tests that tunnel changes on the panel reach the agent through its sync
# timer alone — no `lamaste-agent update` anywhere — and that disabling,
# reassigning or deleting one tunnel never takes the agent's other tunnels
# down with it:
#
# 1. Create two tunnels owned by test-agent (the agent VM's chisel client)
#    and start an HTTP server for each. Each serves within 60 seconds with no
#    manual update: the 30-second sync timer picks up the new tunnel. Adding a
#    grant hot-reloads the chisel server's authfile (no chisel restart).
# 2. Disable the first tunnel: nginx vhost removed, chisel grant removed, and
#    the chisel server restarts (a revocation). The agent's client, which
#    still asked for the disabled port, would have its whole session refused;
#    the sync timer drops that remote so the second tunnel serves again
#    within 60 seconds while the disabled port stays closed.
# 3. Re-enable it: it serves again within 60 seconds, no update.
# 4. Reassign it to a second agent (no chisel client): the grant moves, the
#    port stays closed, and test-agent keeps serving its other tunnel.
# 5. Hand it back: it serves again within 60 seconds, no update.
# 6. Delete the second tunnel: its port closes and the first keeps serving.
# 7. Authenticate through Authelia (1FA + TOTP) and fetch the first tunnel
#    through nginx.
# 8. Clean up
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../e2e/helpers.sh"

require_commands multipass curl jq

# ---------------------------------------------------------------------------
# VM exec helpers
# ---------------------------------------------------------------------------

host_exec() { multipass exec lamaste-host -- sudo bash -c "$1"; }
agent_exec() { multipass exec lamaste-agent -- sudo bash -c "$1"; }

host_api_get() {
  host_exec "curl -skf --max-time 30 --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key --cacert /etc/lamalibre/lamaste/pki/ca.crt -H 'Accept: application/json' https://127.0.0.1:9292/api/$1"
}

host_api_post() {
  host_exec "curl -skf --max-time 30 --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key --cacert /etc/lamalibre/lamaste/pki/ca.crt -X POST -H 'Content-Type: application/json' -H 'Accept: application/json' -d '$2' https://127.0.0.1:9292/api/$1"
}

host_api_patch() {
  host_exec "curl -skf --max-time 30 --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key --cacert /etc/lamalibre/lamaste/pki/ca.crt -X PATCH -H 'Content-Type: application/json' -H 'Accept: application/json' -d '$2' https://127.0.0.1:9292/api/$1"
}

host_api_delete() {
  host_exec "curl -skf --max-time 30 --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key --cacert /etc/lamalibre/lamaste/pki/ca.crt -X DELETE -H 'Accept: application/json' https://127.0.0.1:9292/api/$1"
}

# chisel_grants <label> — the reverse remotes the host's chisel authfile grants
# the chisel user agent-<label>, one per line. Only the user half of each
# "<user>:<password>" key is matched and only the grants are printed, so no
# chisel password reaches the test output.
chisel_grants() {
  host_exec "cat /etc/lamalibre/lamaste/chisel-users" 2>/dev/null \
    | jq -r --arg u "agent-$1:" 'to_entries[] | select(.key | startswith($u)) | .value[]' 2>/dev/null \
    || true
}

# direct_status <port> <file> — HTTP status of a marker page through the
# host's chisel listener for a tunnel port (bypassing nginx); "200" only while
# the agent's chisel client holds that reverse remote
direct_status() {
  host_exec "curl -sf -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:$1/$2 2>/dev/null" || echo "000"
}

# port_opens_within <port> <file> <seconds> — succeed once the port serves the
# marker page, polling every 2 seconds. The agent's sync timer runs 5 seconds
# after activation and then 30 seconds after each run, and the client then
# reconnects, so 60 seconds covers a full cycle with margin.
port_opens_within() {
  local deadline=$((SECONDS + $3))
  while [ "$SECONDS" -lt "$deadline" ]; do
    if [ "$(direct_status "$1" "$2")" = "200" ]; then
      return 0
    fi
    sleep 2
  done
  return 1
}

# port_stays_closed <port> <file> <seconds> — succeed if the port never serves
# the marker page during the window (probing every 2 seconds)
port_stays_closed() {
  local deadline=$((SECONDS + $3))
  while [ "$SECONDS" -lt "$deadline" ]; do
    if [ "$(direct_status "$1" "$2")" = "200" ]; then
      return 1
    fi
    sleep 2
  done
  return 0
}

# chisel_server_pid — MainPID of the host's chisel server
chisel_server_pid() {
  host_exec "systemctl show -p MainPID --value chisel 2>/dev/null" 2>/dev/null || echo "0"
}

# chisel_pid_changes_from <pid> <seconds> — succeed once the chisel server's
# MainPID differs from <pid> (it was restarted)
chisel_pid_changes_from() {
  local deadline=$((SECONDS + $2)) now
  while [ "$SECONDS" -lt "$deadline" ]; do
    now=$(chisel_server_pid)
    if [ -n "$now" ] && [ "$now" != "0" ] && [ "$now" != "$1" ]; then
      return 0
    fi
    sleep 1
  done
  return 1
}

# agent_unit_execstart — the ExecStart= line of the agent's chisel unit
agent_unit_execstart() {
  agent_exec "grep '^ExecStart=' '${CHISEL_UNIT_PATH}' 2>/dev/null" 2>/dev/null || echo ""
}

# unit_drops_remote_within <remote> <seconds> — succeed once the agent's chisel
# unit no longer asks for <remote>
unit_drops_remote_within() {
  local deadline=$((SECONDS + $2))
  while [ "$SECONDS" -lt "$deadline" ]; do
    if ! agent_unit_execstart | grep -qF "$1"; then
      return 0
    fi
    sleep 2
  done
  return 1
}

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

TUNNEL_SUBDOMAIN="e2etoggle"
TUNNEL_PORT=18081
SECOND_SUBDOMAIN="e2etoggle2"
SECOND_PORT=18082
# The agent enrolled by setup-host.sh. Its VM runs the Chisel client, so it
# must own the tunnels for traffic to flow.
TUNNEL_AGENT="test-agent"
# The agent VM's local label (setup-agent.sh) names its units and data dir
AGENT_LOCAL_LABEL="e2e-agent"
CHISEL_UNIT_PATH="/root/.config/systemd/user/lamalibre-lamaste-chisel-${AGENT_LOCAL_LABEL}.service"
# A second enrolled agent with no chisel client, to reassign the tunnel to
OTHER_AGENT="e2e-other-$(date +%s)"
# The anchored reverse remote the host's chisel authfile grants the owner
GRANT_PATTERN="^R:127\\.0\\.0\\.1:${TUNNEL_PORT}\$"
SECOND_GRANT_PATTERN="^R:127\\.0\\.0\\.1:${SECOND_PORT}\$"
# The remotes as the agent's chisel unit asks for them
TUNNEL_REMOTE="R:127.0.0.1:${TUNNEL_PORT}:127.0.0.1:${TUNNEL_PORT}"
SECOND_REMOTE="R:127.0.0.1:${SECOND_PORT}:127.0.0.1:${SECOND_PORT}"
TUNNEL_FQDN="${TUNNEL_SUBDOMAIN}.${TEST_DOMAIN}"
TUNNEL_ID=""
SECOND_ID=""
MARKER="LAMASTE_TOGGLE_OK_$(date +%s)"
SECOND_MARKER="LAMASTE_TOGGLE_SECOND_OK_$(date +%s)"
PAGE="e2e-toggle-index.html"
SECOND_PAGE="e2e-toggle2-index.html"

begin_test "03 — Tunnel Toggle Traffic (Three-VM)"

# ---------------------------------------------------------------------------
# Cleanup function
# ---------------------------------------------------------------------------

cleanup() {
  log_info "Cleaning up test resources..."
  agent_exec "pkill -f 'python3 -m http.server ${TUNNEL_PORT}' 2>/dev/null || true" 2>/dev/null || true
  agent_exec "pkill -f 'python3 -m http.server ${SECOND_PORT}' 2>/dev/null || true" 2>/dev/null || true
  agent_exec "sed -i '/${TUNNEL_FQDN}/d' /etc/hosts 2>/dev/null || true" 2>/dev/null || true
  agent_exec "rm -f /tmp/${PAGE} /tmp/${SECOND_PAGE} 2>/dev/null || true" 2>/dev/null || true
  host_exec "rm -f /tmp/authelia-cookies-toggle.txt 2>/dev/null || true" 2>/dev/null || true
  if [ -n "$TUNNEL_ID" ] && [ "$TUNNEL_ID" != "null" ]; then
    host_api_delete "tunnels/${TUNNEL_ID}" 2>/dev/null || true
  fi
  if [ -n "$SECOND_ID" ] && [ "$SECOND_ID" != "null" ]; then
    host_api_delete "tunnels/${SECOND_ID}" 2>/dev/null || true
  fi
  host_api_delete "certs/agent/${OTHER_AGENT}" > /dev/null 2>&1 || true
  # Converge now rather than on the next timer tick, so the next test starts
  # from an idle agent
  agent_exec "lamaste-agent sync --label ${AGENT_LOCAL_LABEL} 2>/dev/null || true" 2>/dev/null || true
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
log_section "Pre-flight: verify onboarding is complete"
# ---------------------------------------------------------------------------

ONBOARDING_STATUS=$(host_api_get "onboarding/status" | jq -r '.status' 2>/dev/null || echo "unknown")
if [ "$ONBOARDING_STATUS" != "COMPLETED" ]; then
  log_skip "Onboarding not completed (status: $ONBOARDING_STATUS). Skipping toggle traffic tests."
  end_test
  exit $?
fi

# The chisel restart-vs-reload checks below assume the host runs the pinned
# chisel release, which reloads its authfile for new grants without a restart
SERVER_CHISEL_VERSION=$(host_exec "/usr/local/bin/chisel --version 2>/dev/null" 2>/dev/null | sed 's/^v//' || echo "")
assert_eq "$SERVER_CHISEL_VERSION" "1.12.0" "Host chisel server is the pinned release 1.12.0" || true
PINNED_SERVER=false
if [ "$SERVER_CHISEL_VERSION" = "1.12.0" ]; then
  PINNED_SERVER=true
fi

# ---------------------------------------------------------------------------
log_section "Start HTTP servers on the agent"
# ---------------------------------------------------------------------------

agent_exec "grep -q 'tunnel.${TEST_DOMAIN}' /etc/hosts || echo '${HOST_IP} tunnel.${TEST_DOMAIN}' >> /etc/hosts"
agent_exec "grep -q '${TUNNEL_FQDN}' /etc/hosts || echo '${HOST_IP} ${TUNNEL_FQDN}' >> /etc/hosts"

agent_exec "echo '${MARKER}' > /tmp/${PAGE}"
agent_exec "echo '${SECOND_MARKER}' > /tmp/${SECOND_PAGE}"
agent_exec "nohup python3 -m http.server ${TUNNEL_PORT} --bind 127.0.0.1 -d /tmp &>/dev/null & exit"
agent_exec "nohup python3 -m http.server ${SECOND_PORT} --bind 127.0.0.1 -d /tmp &>/dev/null & exit"
sleep 2

LOCAL_FIRST=$(agent_exec "curl -sf -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:${TUNNEL_PORT}/${PAGE} 2>/dev/null" || echo "000")
assert_eq "$LOCAL_FIRST" "200" "HTTP server running on agent at port ${TUNNEL_PORT}" || true
LOCAL_SECOND=$(agent_exec "curl -sf -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:${SECOND_PORT}/${SECOND_PAGE} 2>/dev/null" || echo "000")
assert_eq "$LOCAL_SECOND" "200" "HTTP server running on agent at port ${SECOND_PORT}" || true

# ---------------------------------------------------------------------------
log_section "Create the first tunnel — it serves with no manual update"
# ---------------------------------------------------------------------------

PID_BEFORE_CREATE=$(chisel_server_pid)

# accessMode "authenticated" so the 2FA'd test user can reach it after login.
# The server-side default is "restricted" (per-user grants) which is correct
# for sensitive internal tunnels but would strand this flow.
CREATE_RESPONSE=$(host_api_post "tunnels" "{\"subdomain\":\"${TUNNEL_SUBDOMAIN}\",\"port\":${TUNNEL_PORT},\"accessMode\":\"authenticated\",\"agentLabel\":\"${TUNNEL_AGENT}\"}")
assert_json_field "$CREATE_RESPONSE" '.ok' 'true' "Tunnel creation returned ok: true" || true

TUNNEL_ID=$(echo "$CREATE_RESPONSE" | jq -r '.tunnel.id' 2>/dev/null || echo "")
assert_json_field_not_empty "$CREATE_RESPONSE" '.tunnel.id' "Tunnel has an ID" || true
assert_json_field "$CREATE_RESPONSE" '.tunnel.agentLabel' "$TUNNEL_AGENT" "Tunnel is owned by ${TUNNEL_AGENT}" || true
log_info "Created tunnel ID: $TUNNEL_ID"

if [ "$PINNED_SERVER" = "true" ]; then
  PID_AFTER_CREATE=$(chisel_server_pid)
  assert_eq "$PID_AFTER_CREATE" "$PID_BEFORE_CREATE" "New grant hot-reloaded: chisel server not restarted by the tunnel creation" || true
else
  log_skip "Host chisel is not the pinned release — skipping the no-restart-on-grant check"
fi

# No `lamaste-agent update`: the sync timer converges the agent on its own
if port_opens_within "$TUNNEL_PORT" "$PAGE" 60; then
  log_pass "New tunnel serves within 60 seconds with no lamaste-agent update (sync timer)"
else
  log_fail "New tunnel did not serve within 60 seconds without lamaste-agent update"
  AGENT_LOG=$(agent_exec "tail -20 ~/.lamalibre/lamaste/agents/${AGENT_LOCAL_LABEL}/logs/sync.log 2>/dev/null || echo 'no sync log'")
  log_info "Agent sync log: $AGENT_LOG"
fi

CONTENT_BEFORE=$(host_exec "curl -sf --max-time 10 http://127.0.0.1:${TUNNEL_PORT}/${PAGE} 2>/dev/null" || echo "")
assert_contains "$CONTENT_BEFORE" "$MARKER" "Traffic flows through the first tunnel" || true

# ---------------------------------------------------------------------------
log_section "Create a second tunnel on the same agent"
# ---------------------------------------------------------------------------

PID_BEFORE_SECOND=$(chisel_server_pid)
SECOND_RESPONSE=$(host_api_post "tunnels" "{\"subdomain\":\"${SECOND_SUBDOMAIN}\",\"port\":${SECOND_PORT},\"agentLabel\":\"${TUNNEL_AGENT}\"}")
assert_json_field "$SECOND_RESPONSE" '.ok' 'true' "Second tunnel creation returned ok: true" || true
SECOND_ID=$(echo "$SECOND_RESPONSE" | jq -r '.tunnel.id' 2>/dev/null || echo "")

if [ "$PINNED_SERVER" = "true" ]; then
  PID_AFTER_SECOND=$(chisel_server_pid)
  assert_eq "$PID_AFTER_SECOND" "$PID_BEFORE_SECOND" "Second grant hot-reloaded: chisel server not restarted" || true
fi

if port_opens_within "$SECOND_PORT" "$SECOND_PAGE" 60; then
  log_pass "Second tunnel serves within 60 seconds with no lamaste-agent update"
else
  log_fail "Second tunnel did not serve within 60 seconds without lamaste-agent update"
fi
if port_opens_within "$TUNNEL_PORT" "$PAGE" 30; then
  log_pass "First tunnel still serves alongside the second"
else
  log_fail "First tunnel stopped serving after the second was added"
fi

BOTH_EXECSTART=$(agent_unit_execstart)
assert_contains "$BOTH_EXECSTART" "$TUNNEL_REMOTE" "Agent chisel unit asks for the first tunnel's remote" || true
assert_contains "$BOTH_EXECSTART" "$SECOND_REMOTE" "Agent chisel unit asks for the second tunnel's remote" || true

# ---------------------------------------------------------------------------
log_section "Disable the first tunnel — the second keeps serving"
# ---------------------------------------------------------------------------

PID_BEFORE_DISABLE=$(chisel_server_pid)
DISABLE_RESPONSE=$(host_api_patch "tunnels/${TUNNEL_ID}" '{"enabled":false}')
assert_json_field "$DISABLE_RESPONSE" '.ok' 'true' "Tunnel disable returned ok: true" || true

LIST_DISABLED=$(host_api_get "tunnels")
ENABLED_STATE=$(echo "$LIST_DISABLED" | jq -r --arg id "$TUNNEL_ID" '.tunnels[] | select(.id == $id) | .enabled' 2>/dev/null || echo "")
assert_eq "$ENABLED_STATE" "false" "Tunnel shows as disabled in list" || true

# A disabled tunnel's port is granted to no agent
DISABLED_GRANTS=$(chisel_grants "$TUNNEL_AGENT")
assert_not_contains "$DISABLED_GRANTS" "$GRANT_PATTERN" "Chisel grant removed while the tunnel is disabled" || true
assert_contains "$DISABLED_GRANTS" "$SECOND_GRANT_PATTERN" "Second tunnel's grant untouched" || true

# Withdrawing a grant must end the live session that holds it: chisel restarts
if [ "$PINNED_SERVER" = "true" ]; then
  if chisel_pid_changes_from "$PID_BEFORE_DISABLE" 15; then
    log_pass "Revoked grant restarts the chisel server"
  else
    log_fail "Chisel server was not restarted after a grant was revoked"
  fi
fi

# The regression this guards: chisel refuses a client's whole session when one
# remote it asks for is not granted. The agent's sync timer must drop the
# disabled remote so its other tunnel comes back — without any manual update.
if port_opens_within "$SECOND_PORT" "$SECOND_PAGE" 60; then
  log_pass "Second tunnel serves again within 60 seconds of disabling the first (no update)"
else
  log_fail "Second tunnel stayed dark after the first was disabled"
fi

if unit_drops_remote_within "$TUNNEL_REMOTE" 60; then
  log_pass "Agent chisel unit dropped the disabled tunnel's remote"
else
  log_fail "Agent chisel unit still asks for the disabled tunnel's remote after 60 seconds"
fi
assert_contains "$(agent_unit_execstart)" "$SECOND_REMOTE" "Agent chisel unit still asks for the second tunnel's remote" || true

# When the tunnel is disabled, the nginx vhost for the subdomain is removed.
# Without a matching server_name, nginx may fall through to another server block
# on port 443 (e.g., the chisel tunnel vhost), so the HTTP status may still be
# 200. The definitive check is that the tunnel CONTENT is not accessible.
DISABLED_CONTENT=$(host_exec "curl -sk --max-time 10 https://${TUNNEL_FQDN}/${PAGE} 2>/dev/null" || echo "")
if ! echo "$DISABLED_CONTENT" | grep -qF "$MARKER"; then
  log_pass "Tunnel content not accessible after disable (vhost removed)"
else
  log_fail "Tunnel content still accessible after tunnel disable"
fi

VHOST_EXISTS=$(host_exec "test -L /etc/nginx/sites-enabled/lamalibre-lamaste-app-${TUNNEL_SUBDOMAIN} && echo yes || echo no")
assert_eq "$VHOST_EXISTS" "no" "Nginx vhost symlink removed after disable" || true

if port_stays_closed "$TUNNEL_PORT" "$PAGE" 10; then
  log_pass "Disabled tunnel's port stays closed"
else
  log_fail "Disabled tunnel's port was bound again"
fi

# ---------------------------------------------------------------------------
log_section "Re-enable the first tunnel"
# ---------------------------------------------------------------------------

PID_BEFORE_ENABLE=$(chisel_server_pid)
ENABLE_RESPONSE=$(host_api_patch "tunnels/${TUNNEL_ID}" '{"enabled":true}')
assert_json_field "$ENABLE_RESPONSE" '.ok' 'true' "Tunnel re-enable returned ok: true" || true

LIST_ENABLED=$(host_api_get "tunnels")
ENABLED_STATE2=$(echo "$LIST_ENABLED" | jq -r --arg id "$TUNNEL_ID" '.tunnels[] | select(.id == $id) | .enabled' 2>/dev/null || echo "")
assert_eq "$ENABLED_STATE2" "true" "Tunnel shows as enabled in list" || true

ENABLED_GRANTS=$(chisel_grants "$TUNNEL_AGENT")
assert_contains "$ENABLED_GRANTS" "$GRANT_PATTERN" "Chisel grant restored for the re-enabled tunnel" || true

if [ "$PINNED_SERVER" = "true" ]; then
  PID_AFTER_ENABLE=$(chisel_server_pid)
  assert_eq "$PID_AFTER_ENABLE" "$PID_BEFORE_ENABLE" "Restored grant hot-reloaded: chisel server not restarted" || true
fi

if port_opens_within "$TUNNEL_PORT" "$PAGE" 60; then
  log_pass "Re-enabled tunnel serves within 60 seconds with no lamaste-agent update"
else
  log_fail "Re-enabled tunnel did not serve within 60 seconds"
fi
if port_opens_within "$SECOND_PORT" "$SECOND_PAGE" 30; then
  log_pass "Second tunnel serves alongside the re-enabled one"
else
  log_fail "Second tunnel stopped serving after the first was re-enabled"
fi

CONTENT_AFTER=$(host_exec "curl -sf --max-time 10 http://127.0.0.1:${TUNNEL_PORT}/${PAGE} 2>/dev/null" || echo "")
assert_contains "$CONTENT_AFTER" "$MARKER" "Traffic flows through re-enabled tunnel" || true

# The vhost is back: without a session nginx answers with an Authelia redirect
REENABLED_STATUS=$(host_exec "curl -sk -o /dev/null -w '%{http_code}' --max-time 10 https://${TUNNEL_FQDN}/ 2>/dev/null" || echo "000")
if [ "$REENABLED_STATUS" = "200" ] || [ "$REENABLED_STATUS" = "302" ] || [ "$REENABLED_STATUS" = "401" ]; then
  log_pass "Nginx vhost restored after re-enable (HTTP $REENABLED_STATUS)"
else
  log_fail "Nginx vhost not restored after re-enable (HTTP $REENABLED_STATUS)"
fi

# ---------------------------------------------------------------------------
log_section "Reassign the first tunnel to another agent"
# ---------------------------------------------------------------------------

OTHER_RESPONSE=$(host_api_post "certs/agent" "{\"label\":\"${OTHER_AGENT}\",\"capabilities\":[\"tunnels:read\"]}" 2>/dev/null || echo '{}')
assert_json_field "$OTHER_RESPONSE" '.ok' 'true' "Second agent cert created (${OTHER_AGENT})" || true

PID_BEFORE_REASSIGN=$(chisel_server_pid)
REASSIGN_RESPONSE=$(host_api_patch "tunnels/${TUNNEL_ID}" "{\"agentLabel\":\"${OTHER_AGENT}\"}" 2>/dev/null || echo '{}')
assert_json_field "$REASSIGN_RESPONSE" '.tunnel.agentLabel' "$OTHER_AGENT" "Tunnel reassigned to ${OTHER_AGENT}" || true

MOVED_TO=$(chisel_grants "$OTHER_AGENT")
assert_contains "$MOVED_TO" "$GRANT_PATTERN" "Chisel grant moved to the new owner" || true
MOVED_FROM=$(chisel_grants "$TUNNEL_AGENT")
assert_not_contains "$MOVED_FROM" "$GRANT_PATTERN" "Chisel grant removed from ${TUNNEL_AGENT}" || true

OLD_OWNER_CONFIG_PORT=$(host_api_get "tunnels/agent-config?agent=${TUNNEL_AGENT}" 2>/dev/null \
  | jq -r --arg sd "$TUNNEL_SUBDOMAIN" '.tunnels[]? | select(.subdomain == $sd) | .port' 2>/dev/null || echo "")
assert_eq "$OLD_OWNER_CONFIG_PORT" "" "${TUNNEL_AGENT}'s agent-config no longer lists the tunnel" || true

if [ "$PINNED_SERVER" = "true" ]; then
  if chisel_pid_changes_from "$PID_BEFORE_REASSIGN" 15; then
    log_pass "Reassignment (a revocation for the previous owner) restarts the chisel server"
  else
    log_fail "Chisel server was not restarted after the tunnel moved away from ${TUNNEL_AGENT}"
  fi
fi

# test-agent drops the remote on its next sync and keeps its other tunnel up;
# the new owner runs no client, so nobody binds the reassigned port
if port_opens_within "$SECOND_PORT" "$SECOND_PAGE" 60; then
  log_pass "${TUNNEL_AGENT} keeps serving its other tunnel after the reassignment"
else
  log_fail "${TUNNEL_AGENT}'s other tunnel stayed dark after the reassignment"
fi
if unit_drops_remote_within "$TUNNEL_REMOTE" 60; then
  log_pass "${TUNNEL_AGENT}'s chisel unit dropped the reassigned tunnel's remote"
else
  log_fail "${TUNNEL_AGENT}'s chisel unit still asks for the reassigned tunnel's remote"
fi
if port_stays_closed "$TUNNEL_PORT" "$PAGE" 10; then
  log_pass "Reassigned tunnel's port stays closed (its new owner runs no client)"
else
  log_fail "Reassigned tunnel's port is still bound by ${TUNNEL_AGENT}"
fi

# ---------------------------------------------------------------------------
log_section "Hand the first tunnel back"
# ---------------------------------------------------------------------------

RETURN_RESPONSE=$(host_api_patch "tunnels/${TUNNEL_ID}" "{\"agentLabel\":\"${TUNNEL_AGENT}\"}" 2>/dev/null || echo '{}')
assert_json_field "$RETURN_RESPONSE" '.tunnel.agentLabel' "$TUNNEL_AGENT" "Tunnel handed back to ${TUNNEL_AGENT}" || true

RETURNED_GRANTS=$(chisel_grants "$TUNNEL_AGENT")
assert_contains "$RETURNED_GRANTS" "$GRANT_PATTERN" "Chisel grant back with ${TUNNEL_AGENT}" || true

if port_opens_within "$TUNNEL_PORT" "$PAGE" 60; then
  log_pass "Handed-back tunnel serves within 60 seconds with no lamaste-agent update"
else
  log_fail "Handed-back tunnel did not serve within 60 seconds"
fi

RETURNED_CONTENT=$(host_exec "curl -sf --max-time 10 http://127.0.0.1:${TUNNEL_PORT}/${PAGE} 2>/dev/null" || echo "")
assert_contains "$RETURNED_CONTENT" "$MARKER" "Traffic flows through the tunnel after it was handed back" || true

# ---------------------------------------------------------------------------
log_section "Delete the second tunnel — the first keeps serving"
# ---------------------------------------------------------------------------

DELETE_SECOND=$(host_api_delete "tunnels/${SECOND_ID}" 2>/dev/null || echo '{}')
assert_json_field "$DELETE_SECOND" '.ok' 'true' "Second tunnel deleted" || true
SECOND_ID=""

if unit_drops_remote_within "$SECOND_REMOTE" 60; then
  log_pass "Agent chisel unit dropped the deleted tunnel's remote"
else
  log_fail "Agent chisel unit still asks for the deleted tunnel's remote after 60 seconds"
fi
if port_opens_within "$TUNNEL_PORT" "$PAGE" 60; then
  log_pass "First tunnel serves after the second was deleted"
else
  log_fail "First tunnel stayed dark after the second was deleted"
fi
if port_stays_closed "$SECOND_PORT" "$SECOND_PAGE" 10; then
  log_pass "Deleted tunnel's port stays closed"
else
  log_fail "Deleted tunnel's port is still bound"
fi

# ${OTHER_AGENT} is revoked in cleanup: revoking restarts chisel, which would
# drop the tunnel again right before the full-path checks below.

# ---------------------------------------------------------------------------
log_section "Reset TOTP before authentication"
# ---------------------------------------------------------------------------

# Ensure oathtool is available on the host VM
OATHTOOL_CHECK=$(host_exec "command -v oathtool >/dev/null 2>&1 && echo yes || echo no")
if [ "$OATHTOOL_CHECK" != "yes" ]; then
  log_skip "oathtool not available on host VM. Skipping TOTP-dependent tests."
  end_test
  exit $?
fi

# Reset TOTP for test user via panel API to get a fresh secret
# IMPORTANT: TOTP must be reset BEFORE firstfactor auth, not after.
# If reset after firstfactor, Authelia may reject the secondfactor because
# the TOTP configuration changed mid-session.
TOTP_RESPONSE=$(host_api_post "users/${TEST_USER}/reset-totp" "{}")
assert_json_field_not_empty "$TOTP_RESPONSE" '.totpUri' "TOTP reset returned otpauth URI" || true

# Extract the TOTP secret from the otpauth URI (the secret= parameter)
OTPAUTH_URI=$(echo "$TOTP_RESPONSE" | jq -r '.totpUri' 2>/dev/null || echo "")
TOTP_SECRET=$(echo "$OTPAUTH_URI" | sed -n 's/.*secret=\([A-Z2-7]*\).*/\1/p')

if [ -z "$TOTP_SECRET" ]; then
  log_fail "Failed to extract TOTP secret from otpauth URI: $OTPAUTH_URI"
  end_test
  exit $?
fi
log_pass "Extracted TOTP secret from otpauth URI"

# Allow Authelia to pick up the new TOTP configuration and ensure we submit
# the code in a fresh 30-second window (anti-replay protection would reject
# a code reused from a prior test within the same window).
wait_for_next_totp_window

# ---------------------------------------------------------------------------
log_section "Authenticate with Authelia (first factor)"
# ---------------------------------------------------------------------------

AUTH_RESPONSE=$(host_exec "curl -sk --max-time 15 -c /tmp/authelia-cookies-toggle.txt -X POST -H 'Content-Type: application/json' -d '{\"username\":\"${TEST_USER}\",\"password\":\"${TEST_USER_PASSWORD}\",\"keepMeLoggedIn\":false,\"targetURL\":\"https://${TUNNEL_FQDN}/\"}' https://auth.${TEST_DOMAIN}/api/firstfactor 2>/dev/null" || echo '{}')

AUTH_STATUS=$(echo "$AUTH_RESPONSE" | jq -r '.status' 2>/dev/null || echo "unknown")
if [ "$AUTH_STATUS" = "OK" ]; then
  log_pass "Authelia first factor authentication succeeded"
else
  log_fail "Authelia first factor authentication failed (status: $AUTH_STATUS, response: $AUTH_RESPONSE)"
fi

# ---------------------------------------------------------------------------
log_section "Second factor authentication (TOTP)"
# ---------------------------------------------------------------------------

# Generate a TOTP code on host VM
TOTP_CODE=$(host_exec "oathtool --totp --base32 ${TOTP_SECRET}" 2>/dev/null || echo "")
if [ -z "$TOTP_CODE" ] || [ ${#TOTP_CODE} -ne 6 ]; then
  log_fail "oathtool failed to generate a valid 6-digit TOTP code (got: '${TOTP_CODE}')"
  end_test
  exit $?
fi
log_info "Generated TOTP code: ${TOTP_CODE}"

# POST second factor to Authelia
TOTP_AUTH_RESPONSE=$(host_exec "curl -sk --max-time 15 -b /tmp/authelia-cookies-toggle.txt -c /tmp/authelia-cookies-toggle.txt -X POST -H 'Content-Type: application/json' -d '{\"token\":\"${TOTP_CODE}\",\"targetURL\":\"https://${TUNNEL_FQDN}/\"}' https://auth.${TEST_DOMAIN}/api/secondfactor/totp 2>/dev/null" || echo '{}')

TOTP_AUTH_STATUS=$(echo "$TOTP_AUTH_RESPONSE" | jq -r '.status' 2>/dev/null || echo "unknown")
if [ "$TOTP_AUTH_STATUS" = "OK" ]; then
  log_pass "Second factor authentication succeeded (TOTP accepted)"
else
  log_fail "Second factor authentication failed (status: $TOTP_AUTH_STATUS, response: $TOTP_AUTH_RESPONSE)"
fi

# ---------------------------------------------------------------------------
log_section "Verify traffic through nginx with full 2FA (re-enabled tunnel)"
# ---------------------------------------------------------------------------

# Fetch the tunnel URL through nginx with the fully authenticated session cookie
FULL_PATH_CONTENT=$(host_exec "curl -sk --max-time 15 -b /tmp/authelia-cookies-toggle.txt https://${TUNNEL_FQDN}/e2e-toggle-index.html 2>/dev/null" || echo "")
assert_contains "$FULL_PATH_CONTENT" "$MARKER" "Full-path tunnel traffic (nginx + Authelia 2FA) returns expected content" || true

# Clean up the cookie jar
host_exec "rm -f /tmp/authelia-cookies-toggle.txt 2>/dev/null || true" 2>/dev/null || true

end_test

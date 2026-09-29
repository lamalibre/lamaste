#!/usr/bin/env bash
# ============================================================================
# 30 — Agent Sync Timer (Three-VM)
# ============================================================================
# The agent VM's sync timer (lamalibre-lamaste-sync-e2e-agent.timer) runs
# `lamaste-agent sync` every 30 seconds and converges the chisel client with
# the panel. This test covers what the timer must and must not do:
#
# 1. A tunnel assigned on the panel is carried within 60 seconds; the run is
#    recorded in sync-state.json and sync.log, and `lamaste-agent status`
#    reports it. A manual `lamaste-agent sync` with nothing to change leaves
#    the running client alone.
# 2. The agent daemon's POST /api/stop is remembered (tunnelsStopped): for
#    more than 40 seconds — over a full sync cycle — the timer keeps the
#    client stopped and the tunnel dark. POST /api/start resumes it.
# 3. An agent set up by an older version (no chiselCredentialSealedAt — its
#    credential once sat in process arguments and a 0644 unit) rotates its
#    chisel credential once on its own, then keeps serving. A fresh setup is
#    sealed and never rotates.
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

host_api_delete() {
  host_exec "curl -skf --max-time 30 --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key --cacert /etc/lamalibre/lamaste/pki/ca.crt -X DELETE -H 'Accept: application/json' https://127.0.0.1:9292/api/$1"
}

# user_systemctl <args> — systemctl --user for root on the agent VM
user_systemctl() {
  agent_exec "XDG_RUNTIME_DIR=/run/user/0 systemctl --user $1"
}

# agentd_post <path> — POST to the local agent daemon with the owner's Bearer
# token (the `token` field of ~/.lamalibre/lamaste/agentd.token, 0600);
# prints the HTTP status
agentd_post() {
  agent_exec "curl -s -o /tmp/e2e-30-agentd.json -w '%{http_code}' --max-time 60 -X POST -H \"Authorization: Bearer \$(jq -r .token /root/.lamalibre/lamaste/agentd.token)\" http://127.0.0.1:${AGENTD_PORT}/api/$1" 2>/dev/null || echo "000"
}

# direct_status — HTTP status of the marker page through the host's chisel
# listener for the tunnel port (bypassing nginx)
direct_status() {
  host_exec "curl -sf -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:${TUNNEL_PORT}/${PAGE} 2>/dev/null" || echo "000"
}

# port_opens_within <seconds> — succeed once the tunnel serves (every 2 s)
port_opens_within() {
  local deadline=$((SECONDS + $1))
  while [ "$SECONDS" -lt "$deadline" ]; do
    if [ "$(direct_status)" = "200" ]; then
      return 0
    fi
    sleep 2
  done
  return 1
}

# agent_config_field <field> — a top-level field of the agent's config.json
# (node: the agent VM has no jq)
agent_config_field() {
  agent_exec "node -p \"require('${AGENT_CONFIG}')['$1'] ?? ''\"" 2>/dev/null || echo ""
}

# chisel_env_digest — SHA-256 of the agent's chisel.env, so a credential
# change is visible without printing the credential
chisel_env_digest() {
  agent_exec "sha256sum '${CHISEL_ENV}' 2>/dev/null | cut -d' ' -f1" 2>/dev/null || echo ""
}

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

TUNNEL_AGENT="test-agent"
AGENT_LOCAL_LABEL="e2e-agent"
AGENT_DIR="/root/.lamalibre/lamaste/agents/${AGENT_LOCAL_LABEL}"
AGENT_CONFIG="${AGENT_DIR}/config.json"
CHISEL_ENV="${AGENT_DIR}/chisel.env"
SYNC_STATE="${AGENT_DIR}/sync-state.json"
SYNC_LOG="${AGENT_DIR}/logs/sync.log"
# sync.log spans every earlier test on this agent (a panel restart elsewhere
# legitimately logs "sync failed"); judge only what this test adds to it
SYNC_LOG_START=$(agent_exec "wc -l < '${SYNC_LOG}' 2>/dev/null || echo 0" 2>/dev/null || echo "0")
SYNC_LOG_START=${SYNC_LOG_START//[^0-9]/}
CHISEL_SERVICE="lamalibre-lamaste-chisel-${AGENT_LOCAL_LABEL}.service"
SYNC_TIMER="lamalibre-lamaste-sync-${AGENT_LOCAL_LABEL}.timer"
AGENTD_PORT=9393
TUNNEL_SUBDOMAIN="e2esync30"
TUNNEL_PORT=18095
TUNNEL_ID=""
PAGE="e2e-sync30-index.html"
MARKER="LAMASTE_SYNC30_OK_$(date +%s)"
PANEL_STARTED_HERE=false

begin_test "30 — Agent Sync Timer (Three-VM)"

# ---------------------------------------------------------------------------
# Cleanup function — always runs on exit
# ---------------------------------------------------------------------------

cleanup() {
  log_info "Cleaning up test resources..."
  # Never leave the agent's tunnels stopped for the next test
  agentd_post "start" > /dev/null 2>&1 || true
  agent_exec "node -e \"const fs=require('fs');const f='${AGENT_CONFIG}';const c=JSON.parse(fs.readFileSync(f,'utf8'));if(c.tunnelsStopped){delete c.tunnelsStopped;fs.writeFileSync(f,JSON.stringify(c,null,2)+'\\\\n',{mode:0o600});}\" 2>/dev/null || true" 2>/dev/null || true
  if [ "$PANEL_STARTED_HERE" = "true" ]; then
    agent_exec "lamaste-agent panel --disable 2>/dev/null || true" 2>/dev/null || true
  fi
  agent_exec "pkill -f 'python3 -m http.server ${TUNNEL_PORT}' 2>/dev/null || true" 2>/dev/null || true
  agent_exec "rm -f /tmp/${PAGE} /tmp/e2e-30-agentd.json 2>/dev/null || true" 2>/dev/null || true
  if [ -n "$TUNNEL_ID" ] && [ "$TUNNEL_ID" != "null" ]; then
    host_api_delete "tunnels/${TUNNEL_ID}" 2>/dev/null || true
  fi
  agent_exec "lamaste-agent sync --label ${AGENT_LOCAL_LABEL} 2>/dev/null || true" 2>/dev/null || true
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
log_section "Pre-flight: onboarding complete, sync timer running"
# ---------------------------------------------------------------------------

ONBOARDING_STATUS=$(host_api_get "onboarding/status" | jq -r '.status' 2>/dev/null || echo "unknown")
if [ "$ONBOARDING_STATUS" != "COMPLETED" ]; then
  log_skip "Onboarding not completed (status: $ONBOARDING_STATUS). Skipping sync timer tests."
  end_test
  exit $?
fi

TIMER_STATE=$(user_systemctl "is-active ${SYNC_TIMER} 2>/dev/null || true")
assert_eq "$TIMER_STATE" "active" "Sync timer ${SYNC_TIMER} is active" || true

# A fresh setup marks its credential sealed and never rotates it
SEALED_AT=$(agent_config_field "chiselCredentialSealedAt")
assert_not_eq "$SEALED_AT" "" "Fresh setup recorded chiselCredentialSealedAt" || true
# Rotations already in the log (an earlier run of this test simulated an upgrade)
ROTATED_BEFORE=$(agent_exec "grep -c 'chisel credential rotated' '${SYNC_LOG}' 2>/dev/null || true" 2>/dev/null || echo "0")

# ---------------------------------------------------------------------------
log_section "A tunnel assigned on the panel is carried by the timer"
# ---------------------------------------------------------------------------

agent_exec "echo '${MARKER}' > /tmp/${PAGE}"
agent_exec "nohup python3 -m http.server ${TUNNEL_PORT} --bind 127.0.0.1 -d /tmp &>/dev/null & exit"
sleep 2

CREATE_RESPONSE=$(host_api_post "tunnels" "{\"subdomain\":\"${TUNNEL_SUBDOMAIN}\",\"port\":${TUNNEL_PORT},\"agentLabel\":\"${TUNNEL_AGENT}\"}")
assert_json_field "$CREATE_RESPONSE" '.ok' 'true' "Tunnel ${TUNNEL_SUBDOMAIN} created for ${TUNNEL_AGENT}" || true
TUNNEL_ID=$(echo "$CREATE_RESPONSE" | jq -r '.tunnel.id' 2>/dev/null || echo "")

if port_opens_within 60; then
  log_pass "Tunnel carried within 60 seconds with no lamaste-agent update"
else
  log_fail "Tunnel not carried within 60 seconds"
fi

# The timer's run is recorded; `quiet` runs log only when something changed
STATE_JSON=""
for _ in $(seq 1 20); do
  STATE_JSON=$(agent_exec "cat '${SYNC_STATE}' 2>/dev/null" 2>/dev/null || echo "")
  if [ "$(echo "$STATE_JSON" | jq -r '.lastState // empty' 2>/dev/null)" = "running" ]; then
    break
  fi
  sleep 2
done
assert_json_field "$STATE_JSON" '.lastState' "running" "sync-state.json records the tunnel client running" || true
assert_json_field "$STATE_JSON" '.lastError' "null" "sync-state.json records no error" || true
CARRIED=$(echo "$STATE_JSON" | jq -r '.tunnels // 0' 2>/dev/null || echo "0")
if [ "$CARRIED" -ge 1 ] 2>/dev/null; then
  log_pass "sync-state.json records ${CARRIED} carried tunnel(s)"
else
  log_fail "sync-state.json records ${CARRIED} carried tunnels (expected at least 1)"
fi

SYNC_LOG_TAIL=$(agent_exec "tail -n +$(( ${SYNC_LOG_START:-0} + 1 )) '${SYNC_LOG}' 2>/dev/null" 2>/dev/null || echo "")
assert_contains "$SYNC_LOG_TAIL" "${AGENT_LOCAL_LABEL}: carrying" "sync.log records the change it applied" || true
assert_not_contains "$SYNC_LOG_TAIL" "sync failed" "sync.log records no failure" || true

STATUS_OUTPUT=$(agent_exec "lamaste-agent status --label ${AGENT_LOCAL_LABEL} 2>&1 || true")
STATUS_SYNC=$(echo "$STATUS_OUTPUT" | grep "Sync:" | head -1 || true)
assert_contains "$STATUS_SYNC" "every 30s, last ok" "lamaste-agent status reports the timer's last successful run" || true
assert_contains "$STATUS_SYNC" "tunnel(s)" "lamaste-agent status reports the carried tunnel count" || true

# A manual sync with nothing to change converges to the same state and leaves
# the running client alone
PID_BEFORE_SYNC=$(user_systemctl "show -p MainPID --value ${CHISEL_SERVICE} 2>/dev/null || true")
MANUAL_SYNC=$(agent_exec "lamaste-agent sync --label ${AGENT_LOCAL_LABEL} 2>&1; echo \"exit=\$?\"" 2>/dev/null || echo "")
assert_contains "$MANUAL_SYNC" "exit=0" "Manual lamaste-agent sync exits 0" || true
assert_contains "$MANUAL_SYNC" "carrying" "Manual lamaste-agent sync reports the carried tunnels" || true
assert_not_contains "$MANUAL_SYNC" "(re)started" "Manual sync with nothing to change did not restart the client" || true
PID_AFTER_SYNC=$(user_systemctl "show -p MainPID --value ${CHISEL_SERVICE} 2>/dev/null || true")
assert_eq "$PID_AFTER_SYNC" "$PID_BEFORE_SYNC" "Chisel client PID unchanged by a no-op sync" || true

# ---------------------------------------------------------------------------
log_section "Agent daemon: stop is respected by the timer"
# ---------------------------------------------------------------------------

AGENTD_READY=false
if [ -z "$(agent_exec "command -v lamaste-agentd 2>/dev/null || true")" ]; then
  # The documented install (the Feria registry serves @lamalibre/* to VMs)
  agent_exec "npm install -g @lamalibre/lamaste-agentd >/dev/null 2>&1 || true" || true
fi
if [ -n "$(agent_exec "command -v lamaste-agentd 2>/dev/null || true")" ]; then
  HEALTH=$(agent_exec "curl -sf --max-time 5 http://127.0.0.1:${AGENTD_PORT}/api/health 2>/dev/null || true")
  if ! echo "$HEALTH" | jq -e '.status == "ok"' > /dev/null 2>&1; then
    agent_exec "lamaste-agent panel --enable --local-only --port ${AGENTD_PORT} 2>/dev/null || true" || true
    PANEL_STARTED_HERE=true
  fi
  for _ in $(seq 1 15); do
    HEALTH=$(agent_exec "curl -sf --max-time 5 http://127.0.0.1:${AGENTD_PORT}/api/health 2>/dev/null || true")
    if echo "$HEALTH" | jq -e '.status == "ok"' > /dev/null 2>&1; then
      AGENTD_READY=true
      break
    fi
    sleep 2
  done
fi

if [ "$AGENTD_READY" != "true" ]; then
  log_fail "Agent daemon (lamaste-agentd) not reachable on port ${AGENTD_PORT} — cannot check stop/start"
else
  log_pass "Agent daemon is running on port ${AGENTD_PORT}"

  STOP_STATUS=$(agentd_post "stop")
  assert_eq "$STOP_STATUS" "200" "POST /api/stop on the agent daemon returns 200" || true
  STOPPED_FLAG=$(agent_config_field "tunnelsStopped")
  assert_eq "$STOPPED_FLAG" "true" "Stop is persisted in the agent config (tunnelsStopped: true)" || true

  # Longer than a full sync cycle: the timer must not start the client again
  STOP_HELD=true
  STOP_DEADLINE=$((SECONDS + 45))
  while [ "$SECONDS" -lt "$STOP_DEADLINE" ]; do
    CHISEL_STATE=$(user_systemctl "is-active ${CHISEL_SERVICE} 2>/dev/null || true")
    if [ "$CHISEL_STATE" = "active" ] || [ "$CHISEL_STATE" = "activating" ] || [ "$(direct_status)" = "200" ]; then
      STOP_HELD=false
      break
    fi
    sleep 3
  done
  if [ "$STOP_HELD" = "true" ]; then
    log_pass "Tunnel client stayed stopped for 45 seconds of sync runs after agentd /stop"
  else
    log_fail "The sync timer started the tunnel client again after agentd /stop"
  fi

  STOPPED_STATE=$(agent_exec "cat '${SYNC_STATE}' 2>/dev/null" 2>/dev/null || echo "{}")
  assert_json_field "$STOPPED_STATE" '.lastState' "stopped" "sync-state.json records the tunnels stopped by the operator" || true
  STOPPED_STATUS=$(agent_exec "lamaste-agent status --label ${AGENT_LOCAL_LABEL} 2>&1 || true" | grep "Sync:" | head -1 || true)
  assert_contains "$STOPPED_STATUS" "tunnels stopped by the operator" "lamaste-agent status reports the tunnels stopped by the operator" || true

  START_STATUS=$(agentd_post "start")
  assert_eq "$START_STATUS" "200" "POST /api/start on the agent daemon returns 200" || true
  START_BODY=$(agent_exec "cat /tmp/e2e-30-agentd.json 2>/dev/null" 2>/dev/null || echo "{}")
  assert_json_field "$START_BODY" '.state' "running" "Start converges the client back to running" || true
  STOPPED_AFTER_START=$(agent_config_field "tunnelsStopped")
  assert_eq "$STOPPED_AFTER_START" "" "Start clears tunnelsStopped from the agent config" || true
  if port_opens_within 30; then
    log_pass "Tunnel serves again after agentd /start"
  else
    log_fail "Tunnel did not serve within 30 seconds of agentd /start"
  fi
fi

# Two sections of syncs ran with the credential sealed: none may rotate it
ROTATED_SEALED=$(agent_exec "grep -c 'chisel credential rotated' '${SYNC_LOG}' 2>/dev/null || true" 2>/dev/null || echo "0")
assert_eq "$(( ${ROTATED_SEALED:-0} - ${ROTATED_BEFORE:-0} ))" "0" "Syncs never rotate a sealed credential" || true

# ---------------------------------------------------------------------------
log_section "An upgraded agent rotates its chisel credential once"
# ---------------------------------------------------------------------------

# Make the agent look set up by an older version: no chiselCredentialSealedAt.
# The panel only lets an agent rotate a credential older than 10 minutes, so
# the current one is backdated in the panel's store (in place, keeping owner
# and mode; the temp copy is private).
ENV_BEFORE=$(chisel_env_digest)
ISSUED_BEFORE=$(host_api_get "tunnels/agent-config?agent=${TUNNEL_AGENT}" 2>/dev/null | jq -r '.chiselCredentialIssuedAt // empty' 2>/dev/null || echo "")
host_exec "umask 077; f=/etc/lamalibre/lamaste/chisel-credentials.json; t=\$(date -u -d '11 minutes ago' +%Y-%m-%dT%H:%M:%S.000Z); jq --arg l '${TUNNEL_AGENT}' --arg t \"\$t\" '.[\$l].createdAt = \$t' \"\$f\" > /tmp/e2e-30-creds.json && cat /tmp/e2e-30-creds.json > \"\$f\"; rm -f /tmp/e2e-30-creds.json"
agent_exec "node -e \"const fs=require('fs');const f='${AGENT_CONFIG}';const c=JSON.parse(fs.readFileSync(f,'utf8'));delete c.chiselCredentialSealedAt;fs.writeFileSync(f,JSON.stringify(c,null,2)+'\\\\n',{mode:0o600});\""
UNSEALED=$(agent_config_field "chiselCredentialSealedAt")
assert_eq "$UNSEALED" "" "Agent config no longer marks the credential sealed (simulated upgrade)" || true

RESEALED=""
for _ in $(seq 1 30); do
  RESEALED=$(agent_config_field "chiselCredentialSealedAt")
  if [ -n "$RESEALED" ]; then
    break
  fi
  sleep 2
done
assert_not_eq "$RESEALED" "" "The next sync rotated the credential and sealed it (within 60 seconds)" || true

ROTATED_LOG=$(agent_exec "grep -c 'chisel credential rotated' '${SYNC_LOG}' 2>/dev/null || true" 2>/dev/null || echo "0")
assert_eq "$(( ${ROTATED_LOG:-0} - ${ROTATED_BEFORE:-0} ))" "1" "sync.log records exactly one credential rotation" || true
ISSUED_AFTER=$(host_api_get "tunnels/agent-config?agent=${TUNNEL_AGENT}" 2>/dev/null | jq -r '.chiselCredentialIssuedAt // empty' 2>/dev/null || echo "")
assert_not_eq "$ISSUED_AFTER" "$ISSUED_BEFORE" "The panel issued a new credential (chiselCredentialIssuedAt changed)" || true
ENV_AFTER=$(chisel_env_digest)
assert_not_eq "$ENV_AFTER" "$ENV_BEFORE" "chisel.env now holds the rotated credential" || true
ENV_MODE=$(agent_exec "stat -c '%a' '${CHISEL_ENV}' 2>/dev/null" || echo "missing")
assert_eq "$ENV_MODE" "600" "chisel.env is still mode 600" || true

if port_opens_within 60; then
  log_pass "Tunnel serves with the rotated credential"
else
  log_fail "Tunnel did not serve within 60 seconds of the credential rotation"
fi

# Sealed again: the next timer run rotates nothing more. Wait for sync-state's
# lastRunAt to move past the run that rotated (bounded poll).
LAST_RUN=$(agent_exec "cat '${SYNC_STATE}' 2>/dev/null" 2>/dev/null | jq -r '.lastRunAt // empty' 2>/dev/null || echo "")
NEXT_RUN_SEEN=false
for _ in $(seq 1 30); do
  RUN_NOW=$(agent_exec "cat '${SYNC_STATE}' 2>/dev/null" 2>/dev/null | jq -r '.lastRunAt // empty' 2>/dev/null || echo "")
  if [ -n "$RUN_NOW" ] && [ "$RUN_NOW" != "$LAST_RUN" ]; then
    NEXT_RUN_SEEN=true
    break
  fi
  sleep 2
done
if [ "$NEXT_RUN_SEEN" = "true" ]; then
  log_pass "The sync timer ran again after the rotation (lastRunAt advanced)"
else
  log_fail "The sync timer did not run again within 60 seconds of the rotation"
fi
ROTATED_LATER=$(agent_exec "grep -c 'chisel credential rotated' '${SYNC_LOG}' 2>/dev/null || true" 2>/dev/null || echo "0")
assert_eq "${ROTATED_LATER:-0}" "1" "No further rotation after the credential was sealed" || true

end_test

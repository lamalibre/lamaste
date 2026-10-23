# shellcheck shell=bash
# ============================================================================
# App plugin harness — what the three-VM specs 34 to 41 share
# ============================================================================
# Sourced after ../e2e/helpers.sh by the specs in which Lamaste installs an
# app plugin's agent half onto the agent VM from the panel (slice 3):
#
# - VM exec and panel API helpers (URLs always quoted: query strings carry
#   ? and &), operation and audit polling;
# - start_stand_in_feria: the fixture packages (write_app_install_fixture)
#   and the stand-in Feria (write_stub_registry) on the host VM, reachable
#   from the agent VM; the panel installs from it and holds its registry
#   credential through its own OIDC client, which brokers the agent's
#   read tokens;
# - the operator's one-time `lamaste-agent apphost enable --user root` (the
#   rodeo agent runs as root: the helper needs no sudoers rule), which also
#   pins the relay's signing key — the helper runs only app jobs it signed;
# - open_push_install: the push-install gates an agent-half push passes —
#   called in the spec's own shell (never in a command substitution: the
#   cleanup reads what it records), its window's answer left in
#   PUSH_WINDOW_RESPONSE;
# - agent_facts / relay_leftovers: the agent VM's and the relay's state of an
#   agent half — its units, the socket systemd holds its port with and who
#   listens on that port among it — each read in one call and never
#   including a secret; port_probe: what that socket leaves another local
#   process (spec 35);
# - nudge_sync: start the agent's sync unit now instead of when its timer
#   fires — the same unit, so never two syncs at once. Spec 34 hosts on the
#   timer alone; the specs nudge later operations to stay inside rodeo's
#   ten minutes per spec;
# - settings (slice 4, specs 37 and 38): test secrets that exist only on the
#   host VM, the settings API called through a script there that never
#   prints a response holding one, and scans of the relay and the agent VM
#   that report counts, never a secret;
# - identity (slice 6, specs 39 to 41): the panel's view of a plugin's
#   identity feed, what the agent half's projection holds (its
#   /admin/e2e/projection, through the forwarder as the admin, or — while no
#   agent half runs — read from the data the agent keeps), its request log,
#   the users API waiting out its rate limit, and a way to tamper with the
#   projection as the agent half's own account could;
# - app_plugin_cleanup: what the specs' cleanup traps run.
#
# Runs on the machine driving the VMs, under bash 3.2 (macOS): no arrays.
# A spec sets REMOTE_DIR, LOCAL_TMP, CLEAN_PLUGINS, CLEAN_ROUTES and
# PURGE_PACKAGES (space-separated lists) before it uses these; one that uses
# the settings helpers also sets PRIV (a directory under REMOTE_DIR).
# ============================================================================

HOST_VM="lamaste-host"
AGENT_VM="lamaste-agent"
HOST_IP="${HOST_IP:-10.13.37.1}"
AGENT_IP="${AGENT_IP:-10.13.37.2}"
CURL_MTLS="curl -sk --max-time 30 --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key --cacert /etc/lamalibre/lamaste/pki/ca.crt"
PANEL="https://127.0.0.1:9292/api"
# AGENT_LABEL is the agent VM's local registry name; HOST_AGENT_LABEL (read
# from its config.json by app_plugin_preflight) is the label it is enrolled
# under on the host: certificate CN, registry token owner, push-install target.
AGENT_LABEL="e2e-agent"
AGENT_DIR="/root/.lamalibre/lamaste/agents/${AGENT_LABEL}"
AGENT_CONFIG="${AGENT_DIR}/config.json"
SYNC_TIMER="lamalibre-lamaste-sync-${AGENT_LABEL}.timer"
SYNC_SERVICE="lamalibre-lamaste-sync-${AGENT_LABEL}.service"
APPHOST_HELPER="/usr/local/sbin/lamaste-apphost"
STUB_PORT=4874
# The agent VM reaches the stand-in Feria on the host's static address.
STUB_URL="http://${HOST_IP}:${STUB_PORT}"
STUB_ADMIN_TOKEN="feria_e2eadmin_threevm_apphost_000000000"

DOMAIN=""
HOST_AGENT_LABEL=""
APPHOST_STATUS_BEFORE=""
# The id of the key the relay signs app jobs with (relay_kid_on_host); once
# set, wait_for_app_host_facts also waits for the agent to report it pinned.
RELAY_KID=""
AUDIT_BASE=0
# The hosting's port once the spec knows it: agent_facts reports who listens
# on it (after a purge too, when no file names it any more)
FACTS_PORT=""
# What the cleanup restores (set as the spec changes it)
APPHOST_ENABLED_HERE=""
PUSH_GLOBAL_BEFORE=""
PUSH_POLICY=""
PUSH_WINDOW=""
# The panel's answer to the last open_push_install's window
PUSH_WINDOW_RESPONSE=""
CREDENTIAL_SET=""
STUB_STARTED=""
# The host VM's private directory for test secrets (settings helpers; the
# spec sets it under REMOTE_DIR, which the cleanup removes)
PRIV=""

# ---------------------------------------------------------------------------
# VM exec and panel API
# ---------------------------------------------------------------------------

host_exec() { multipass exec "${HOST_VM}" -- sudo bash -c "$1"; }
agent_exec() { multipass exec "${AGENT_VM}" -- sudo bash -c "$1"; }

host_api_get() {
  host_exec "${CURL_MTLS} -H 'Accept: application/json' '${PANEL}/$1'"
}
host_api_get_status() {
  host_exec "${CURL_MTLS} -o /dev/null -w '%{http_code}' '${PANEL}/$1' || true" 2>/dev/null || echo "000"
}
host_api_post() {
  host_exec "${CURL_MTLS} -X POST -H 'Content-Type: application/json' -H 'Accept: application/json' -d '$2' '${PANEL}/$1'"
}
host_api_patch() {
  host_exec "${CURL_MTLS} -X PATCH -H 'Content-Type: application/json' -H 'Accept: application/json' -d '$2' '${PANEL}/$1'"
}
host_api_delete() {
  host_exec "${CURL_MTLS} -X DELETE -H 'Accept: application/json' '${PANEL}/$1'"
}
# host_api_call <method> <path> [json] — the body, then the HTTP status on a
# line of its own (status_of / body_of split them)
host_api_call() {
  local data=""
  if [ -n "${3:-}" ]; then data="-H 'Content-Type: application/json' -d '$3'"; fi
  host_exec "${CURL_MTLS} -X $1 -H 'Accept: application/json' ${data} -w '\n%{http_code}' '${PANEL}/$2' || true" 2>/dev/null || echo "000"
}
status_of() { printf '%s\n' "$1" | tail -n 1; }
body_of() { printf '%s\n' "$1" | sed '$d'; }

# json_get <json> <jq expr> — one value (raw), "" when it is not there
json_get() { echo "$1" | jq -r "$2" 2>/dev/null || echo ""; }

# assert_refused <outcome> <message> — a sandbox probe's outcome is an error
# code (EROFS, EACCES, …): not ALLOWED, and not missing either
assert_refused() {
  if [ -n "$1" ] && [ "$1" != "null" ] && [ "$1" != "ALLOWED" ]; then
    log_pass "$2 ($1)"
    return 0
  fi
  log_fail "$2 (got: '${1}')"
  return 1
}

# user_systemctl <args> — systemctl --user for root on the agent VM
user_systemctl() {
  agent_exec "XDG_RUNTIME_DIR=/run/user/0 systemctl --user $1"
}

# agent_config_field <field> — a top-level field of the agent's config.json
# (node: the agent VM has no jq)
agent_config_field() {
  agent_exec "node -p \"require('${AGENT_CONFIG}')['$1'] ?? ''\"" 2>/dev/null || echo ""
}

# hosting_field <plugin> <jq expr> — a field of GET /api/plugins/<plugin>/hosting
hosting_field() {
  host_api_get "plugins/$1/hosting" 2>/dev/null | jq -r "$2" 2>/dev/null || echo ""
}

# stub_get <path> — the stand-in Feria, as its admin, from the host VM
stub_get() {
  host_exec "curl -s --max-time 15 -H 'Authorization: Bearer ${STUB_ADMIN_TOKEN}' 'http://127.0.0.1:${STUB_PORT}/$1'"
}

# nudge_sync — start the agent's sync unit now rather than when its timer
# fires; a sync that is running is left to finish
nudge_sync() {
  agent_exec "XDG_RUNTIME_DIR=/run/user/0 systemctl --user start --no-block ${SYNC_SERVICE} > /dev/null 2>&1; true" > /dev/null 2>&1 || true
}

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

# wait_operation <plugin> <operation id> <seconds> [nudge] — prints the
# operation once it ended (still running after <seconds>: as it is; the
# caller asserts its status). Always returns 0: a timeout must not end the
# spec under `set -e`. "nudge" starts the agent's sync on every poll.
wait_operation() {
  local plugin="$1" id="$2" deadline=$((SECONDS + $3)) nudge="${4:-}" op='{}' status=""
  while [ "$SECONDS" -lt "$deadline" ]; do
    if [ "$nudge" = "nudge" ]; then nudge_sync; fi
    op=$(host_api_get "plugins/${plugin}/operations/${id}" 2>/dev/null | jq -c '.operation // {}' 2>/dev/null || echo '{}')
    status=$(echo "$op" | jq -r '.status // ""' 2>/dev/null || echo "")
    if [ "$status" = "succeeded" ] || [ "$status" = "failed" ] || [ "$status" = "rolled-back" ]; then
      echo "$op"
      return 0
    fi
    sleep 3
  done
  echo "$op"
  return 0
}

# step_status <operation json> <step name> — the status of one step (its last run)
step_status() {
  echo "$1" | jq -r --arg n "$2" '[.steps[]? | select(.name == $n) | .status] | last // "absent"' 2>/dev/null || echo "absent"
}

# step_order <operation json> <step> <step> — "true" when the first step ran before the second
step_order() {
  echo "$1" | jq -r --arg a "$2" --arg b "$3" '[.steps[]?.name] | (index($a) != null and index($b) != null and index($a) < index($b))' 2>/dev/null || echo "false"
}

# audit_count <plugin> <action> [<jq filter on details>] — this run's entries
# (the audit log outlives a run: those after AUDIT_BASE)
audit_count() {
  host_api_get "audit?plugin=$1&action=$2&limit=200" | jq "[.entries[]? | select(.id > ${AUDIT_BASE}) | select(.details | ${3:-true})] | length" 2>/dev/null || echo "0"
}

# agent_host_facts — the host facts the relay holds for the agent ('null' when
# none); a revoked certificate's record under the same label is not the agent
agent_host_facts() {
  host_api_get "certs/agent" 2>/dev/null | jq -c "[.agents[]? | select(.label == \"${HOST_AGENT_LABEL}\" and (.revoked // false) == false) | .hostFacts] | first // null" 2>/dev/null || echo "null"
}

# wait_for_app_host_facts <seconds> [nudge] — until the relay's host facts of
# the agent name an enabled app host helper (and, once RELAY_KID is known,
# the relay's key pinned for it)
wait_for_app_host_facts() {
  local deadline=$((SECONDS + $1)) nudge="${2:-}" facts
  while [ "$SECONDS" -lt "$deadline" ]; do
    if [ "$nudge" = "nudge" ]; then nudge_sync; fi
    facts=$(agent_host_facts)
    if [ "$(echo "$facts" | jq -r '.apphost.version // 0' 2>/dev/null || echo 0)" -ge 1 ] 2>/dev/null &&
      { [ -z "${RELAY_KID}" ] || [ "$(json_get "$facts" '.apphost.relayKid')" = "${RELAY_KID}" ]; }; then
      return 0
    fi
    sleep 3
  done
  return 1
}

# relay_kid_on_host — the id of the key the relay signs with (relayKeyId:
# SHA-256 of its public key's DER SPKI, hex, 32 characters), from the
# relay's own key file; only the id is printed
relay_kid_on_host() {
  host_exec "node -e \"const c = require('node:crypto'); const f = JSON.parse(require('node:fs').readFileSync('/etc/lamalibre/lamaste/relay-signing-key.json', 'utf8')); const der = c.createPublicKey(c.createPrivateKey(f.privateKey)).export({ type: 'spki', format: 'der' }); console.log(c.createHash('sha256').update(der).digest('hex').slice(0, 32));\"" 2>/dev/null || echo ""
}

# agent_relay_kid — the key GET /api/agents/me/relay-keys names first, as the
# agent fetches it over its own pinned mTLS channel
agent_relay_kid() {
  agent_exec "lamaste-agent apphost relay-keys --label ${AGENT_LABEL} --json 2>/dev/null" 2>/dev/null | grep -E '^\{' | tail -n 1 | jq -r '.relays[0].keys[0].kid // ""' 2>/dev/null || echo ""
}

# agent_epoch — the agent VM's clock, for journal reads after it
agent_epoch() { agent_exec "date +%s" 2>/dev/null || echo "0"; }

# agent_epoch_after_now — the agent VM's clock once it has moved past the
# current second (up to ~5 s). A journal read takes whole seconds
# (`--since @<epoch>`): from this epoch on it holds nothing logged before
# the call, not even a line of a request answered in the same second.
agent_epoch_after_now() {
  local start now tries=0
  start=$(agent_epoch)
  now="${start}"
  while [ "${now}" -le "${start}" ] && [ "${tries}" -lt 25 ]; do
    sleep 0.2
    now=$(agent_epoch)
    tries=$((tries + 1))
  done
  echo "${now}"
}

# unit_journal_since <unit> <epoch> — the unit's messages since then
unit_journal_since() {
  agent_exec "journalctl -u $1 --since @$2 --no-pager -o cat 2>/dev/null" 2>/dev/null || echo ""
}

# sync_log_lines — how many lines the agent's sync.log has (it outlives a run);
# sync_log_since <count> — the lines after that many
sync_log_lines() { agent_exec "cat ${AGENT_DIR}/logs/sync.log 2>/dev/null | wc -l | tr -d ' '" 2>/dev/null || echo "0"; }
sync_log_since() { agent_exec "tail -n +$(($1 + 1)) ${AGENT_DIR}/logs/sync.log 2>/dev/null" 2>/dev/null || echo ""; }

# ---------------------------------------------------------------------------
# Pre-flight
# ---------------------------------------------------------------------------

# app_plugin_preflight — onboarding done, the agent enrolled and syncing, its
# lamaste-agent able to enable the app host helper. Sets DOMAIN,
# HOST_AGENT_LABEL, APPHOST_STATUS_BEFORE and AUDIT_BASE; ends the spec
# (skip or failure) otherwise.
app_plugin_preflight() {
  local onboarding enrolled timer
  onboarding=$(host_api_get "onboarding/status" 2>/dev/null || echo '{}')
  if [ "$(echo "$onboarding" | jq -r '.status' 2>/dev/null || echo unknown)" != "COMPLETED" ]; then
    log_skip "Onboarding not completed — skipping"
    end_test
    exit $?
  fi
  log_pass "Onboarding is complete"
  DOMAIN=$(echo "$onboarding" | jq -r '.domain // empty' 2>/dev/null || echo "")
  if [ -z "$DOMAIN" ]; then
    log_skip "No domain configured — skipping"
    end_test
    exit $?
  fi

  HOST_AGENT_LABEL=$(agent_config_field "agentLabel")
  HOST_AGENT_LABEL="${HOST_AGENT_LABEL:-test-agent}"
  enrolled=$(host_api_get "certs/agent" | jq -r "[.agents[]? | select(.label == \"${HOST_AGENT_LABEL}\" and (.revoked // false) == false)] | length" 2>/dev/null || echo "0")
  if [ "$enrolled" = "0" ]; then
    log_skip "Agent ${HOST_AGENT_LABEL} is not enrolled on the host — skipping"
    end_test
    exit $?
  fi
  log_pass "Agent ${HOST_AGENT_LABEL} is enrolled on the host"

  timer=$(user_systemctl "is-active ${SYNC_TIMER} 2>/dev/null || true")
  assert_eq "$timer" "active" "Sync timer ${SYNC_TIMER} is active on the agent VM" || true

  APPHOST_STATUS_BEFORE=$(agent_exec "lamaste-agent apphost status --json 2>/dev/null" 2>/dev/null | grep -E '^\{' | tail -n 1 || echo "")
  if ! echo "$APPHOST_STATUS_BEFORE" | jq -e '.helper' > /dev/null 2>&1; then
    log_fail "The agent VM's lamaste-agent has no apphost command (it predates slice 3)"
    end_test
    exit $?
  fi
  log_pass "The agent VM's lamaste-agent has the apphost command"

  AUDIT_BASE=$(host_api_get "audit?limit=1" | jq '.entries[0].id // 0' 2>/dev/null || echo "0")
}

# app_host_helper_was_enabled — "true" when the helper was installed before the spec
app_host_helper_was_enabled() {
  echo "$APPHOST_STATUS_BEFORE" | jq -r '.helper.installed == true' 2>/dev/null || echo "false"
}

# ensure_app_host_helper — the operator's one-time step when it was not done
# yet (the cleanup undoes it then) — a helper enabled before has the relay's
# key pinned again, in case the relay changed it since — and the relay told
# by the agent's sync
ensure_app_host_helper() {
  RELAY_KID=$(relay_kid_on_host)
  if [ "$(app_host_helper_was_enabled)" != "true" ]; then
    agent_exec "lamaste-agent apphost enable --user root --json > /dev/null 2>&1" || true
    APPHOST_ENABLED_HERE=1
  else
    agent_exec "lamaste-agent apphost pin --json > /dev/null 2>&1" || true
  fi
  if wait_for_app_host_facts 90 nudge; then
    log_pass "The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts"
  else
    log_fail "The relay's host facts of ${HOST_AGENT_LABEL} name no app host helper with relay key ${RELAY_KID}: $(agent_host_facts)"
  fi
}

# ---------------------------------------------------------------------------
# The stand-in Feria and the panel's registry
# ---------------------------------------------------------------------------

# start_stand_in_feria <package dir>... — ship ${LOCAL_TMP}/ship (the
# fixtures written there) and the stand-in Feria to the host VM's REMOTE_DIR
# and start it on 0.0.0.0:STUB_PORT serving each <package dir> (relative to
# REMOTE_DIR); the agent VM reaches it at STUB_URL (a firewall rule for its
# address). The panel then holds its registry credential through its own
# OIDC client — and installs from the stand-in with that credential alone:
# nothing is written to the state directory's .npmrc, so the panel's own
# installs, update staging and agent-half pinning prove they authenticate
# with the service token (the stand-in records each request's owner).
start_stand_in_feria() {
  local packages="" dir up="no" set_out set_json reach
  for dir in "$@"; do packages="${packages} --package ${REMOTE_DIR}/${dir}"; done
  write_stub_registry "${LOCAL_TMP}/ship/stub-registry.mjs"
  # No AppleDouble files from a macOS tar.
  COPYFILE_DISABLE=1 tar -C "${LOCAL_TMP}/ship" -czf "${LOCAL_TMP}/ship.tgz" .
  host_exec "rm -rf ${REMOTE_DIR} && mkdir -p ${REMOTE_DIR} && chmod a+rwx ${REMOTE_DIR}"
  multipass transfer "${LOCAL_TMP}/ship.tgz" "${HOST_VM}:${REMOTE_DIR}/ship.tgz"
  host_exec "tar -C ${REMOTE_DIR} -xzf ${REMOTE_DIR}/ship.tgz 2>/dev/null; chmod -R a+rX ${REMOTE_DIR}"

  host_exec "pkill -f '[s]tub-registry.mjs' 2>/dev/null || true"
  # The host's firewall denies incoming by default.
  host_exec "ufw status 2>/dev/null | grep -q '^Status: active' && ufw allow from ${AGENT_IP} to any port ${STUB_PORT} proto tcp > /dev/null || true"
  STUB_STARTED=1
  host_exec "nohup node ${REMOTE_DIR}/stub-registry.mjs --port ${STUB_PORT} --host 0.0.0.0 --base-url ${STUB_URL} --admin-token ${STUB_ADMIN_TOKEN} --issuer https://auth.${DOMAIN} --audience ${STUB_URL} --jwks-url http://127.0.0.1:9091/jwks.json${packages} &> ${REMOTE_DIR}/stub.log & exit"
  for _ in $(seq 1 60); do
    if host_exec "curl -sf --max-time 3 http://127.0.0.1:${STUB_PORT}/-/ping > /dev/null 2>&1"; then
      up="yes"
      break
    fi
    sleep 1
  done
  assert_eq "$up" "yes" "Stand-in Feria is up on the host VM ($(host_exec "tail -n 2 ${REMOTE_DIR}/stub.log 2>/dev/null" 2>/dev/null | tr '\n' ' '))" || true
  reach=$(agent_exec "curl -s -o /dev/null -w '%{http_code}' --max-time 10 ${STUB_URL}/-/ping 2>/dev/null" 2>/dev/null || echo "000")
  assert_eq "$reach" "200" "The agent VM reaches it at ${STUB_URL}" || true

  CREDENTIAL_SET=1
  set_out=$(timed_exec 120 multipass exec "${HOST_VM}" -- sudo bash -c "lamaste-server registry-credential set --url ${STUB_URL} --oidc --json 2>&1")
  set_json=$(echo "$set_out" | grep -E '^\{' | tail -n 1 || echo "{}")
  assert_json_field "$set_json" '.configured' 'true' "The panel holds the stand-in Feria's credential ($(echo "$set_out" | tail -c 200))" || true
  assert_json_field "$set_json" '.auth' 'oidc' "…through its own OIDC client" || true
}

# feria_integrity <package> <version> — what the stand-in Feria publishes as
# the tarball's integrity
feria_integrity() {
  stub_get "$1" | jq -r --arg v "$2" '.versions[$v].dist.integrity // empty' 2>/dev/null || echo ""
}

# ---------------------------------------------------------------------------
# Push-install gates
# ---------------------------------------------------------------------------

remember_push_install() {
  if [ -z "${PUSH_GLOBAL_BEFORE}" ]; then
    PUSH_GLOBAL_BEFORE=$(host_api_get "plugins/push-install/config" 2>/dev/null | jq -r '.enabled // false' 2>/dev/null || echo "false")
  fi
}

# open_push_install <policy id> <packages json> <actions json> — push-install
# on, a policy allowing exactly <actions> on exactly the agent <packages>, and
# the agent's window (60 minutes) under that policy; the panel's answer to
# opening the window is left in PUSH_WINDOW_RESPONSE. Call it in the spec's
# own shell, never in a command substitution: what it records for the
# cleanup to undo (PUSH_GLOBAL_BEFORE, PUSH_POLICY, PUSH_WINDOW) would be
# lost with the subshell, and the policy and the window would outlive the
# spec.
open_push_install() {
  remember_push_install
  host_api_patch "plugins/push-install/config" '{"enabled":true}' > /dev/null
  host_api_delete "plugins/push-install/policies/$1" > /dev/null 2>&1 || true
  PUSH_POLICY="$1"
  host_api_post "plugins/push-install/policies" "{\"name\":\"$1\",\"id\":\"$1\",\"description\":\"e2e: agent-half pushes\",\"allowedPlugins\":$2,\"allowedActions\":$3}" > /dev/null
  PUSH_WINDOW=1
  # shellcheck disable=SC2034 # read by the specs that source this file
  PUSH_WINDOW_RESPONSE=$(host_api_post "plugins/push-install/enable/${HOST_AGENT_LABEL}" "{\"durationMinutes\":60,\"policyId\":\"$1\"}") || PUSH_WINDOW_RESPONSE='{}'
}

# ---------------------------------------------------------------------------
# Plugins
# ---------------------------------------------------------------------------

# install_approved <plugin> <package spec> — install from the stand-in Feria,
# approve what the version brings (the digest it shows) and enable it;
# prints the install response
install_approved() {
  local install digest
  install=$(host_api_post "plugins/install" "{\"packageName\":\"$2\"}")
  digest=$(echo "$install" | jq -r '.hooks.approval.digest // empty' 2>/dev/null || echo "")
  host_api_post "plugins/$1/hooks/approve" "{\"digest\":\"${digest}\"}" > /dev/null
  host_api_post "plugins/$1/enable" '{}' > /dev/null
  echo "$install"
}

# host_plugin <plugin> <seconds> [nudge] — host it on the agent VM's agent and
# wait for the operation; prints it, or {"refused": <response>}
host_plugin() {
  local response id
  response=$(host_api_post "plugins/$1/hosting" "{\"agentLabel\":\"${HOST_AGENT_LABEL}\"}")
  id=$(echo "$response" | jq -r '.operation.id // empty' 2>/dev/null || echo "")
  if [ -z "$id" ]; then
    echo "{\"refused\":$(echo "$response" | jq -c . 2>/dev/null || echo null)}"
    return 0
  fi
  wait_operation "$1" "$id" "$2" "${3:-}"
}

# ---------------------------------------------------------------------------
# State probes
# ---------------------------------------------------------------------------

# write_agent_facts_probe <file> — a Node script printing, as one line of
# JSON, an agent half's state on the agent VM: its unit (as written and as
# systemd applies it), its socket unit (the same, and the file's digest), the
# unit's drop-in directory, who listens on its port (ss: the processes
# sharing the listening socket, its inode) and what the running service's
# descriptor 3 is, account, code, data, config, the agent's own copy of the
# plugin config and record, the helper, and system packages. A secret is
# only ever compared on the VM, never printed.
#
#   [E2E_FACTS_PORT=<port>] node agent-facts.mjs <route> <service user> <agent label> [<system package>...]
#
# The port looked at is E2E_FACTS_PORT when set (the specs pass the
# hosting's, so "nothing listens" can be read after a purge), else the
# plugin config's, else the socket file's.
write_agent_facts_probe() {
  cat > "$1" <<'PROBE_EOF'
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { listenersOn, run, showProps, socketInodeOf } from './probe-lib.mjs';

const [route, user, label, ...packages] = process.argv.slice(2);
const unit = `lamalibre-app-${route}.service`;
const socketUnit = `lamalibre-app-${route}.socket`;
const codeDir = `/opt/lamalibre/apps/${route}`;
const dataDir = `/var/lib/lamalibre/apps/${route}`;
const configDir = `/etc/lamalibre/apps/${route}`;
const agentDir = `/root/.lamalibre/lamaste/agents/${label}`;

const names = { passwd: new Map(), group: new Map() };
function nameOf(db, id) {
  if (!names[db].has(id)) names[db].set(id, run('getent', [db, String(id)]).split(':')[0] || String(id));
  return names[db].get(id);
}
function statOf(p) {
  try {
    const s = fs.lstatSync(p);
    const type = s.isDirectory() ? 'dir' : s.isSymbolicLink() ? 'link' : s.isFile() ? 'file' : 'other';
    return { mode: (s.mode & 0o7777).toString(8), user: nameOf('passwd', s.uid), group: nameOf('group', s.gid), type };
  } catch {
    return null;
  }
}
function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}
function linkOf(p) {
  try {
    return fs.readlinkSync(p);
  } catch {
    return null;
  }
}

const PROPS = [
  'LoadState', 'ActiveState', 'SubState', 'UnitFileState', 'MainPID', 'User', 'Group', 'ExecStart',
  'Environment', 'ProtectSystem', 'ProtectHome', 'NoNewPrivileges', 'PrivateTmp',
  'PrivateDevices', 'ReadWritePaths', 'RestrictSUIDSGID', 'LockPersonality', 'MemoryMax',
  'CapabilityBoundingSet', 'UMask', 'Restart', 'LimitCORE', 'TriggeredBy',
  'Requires', 'After', 'ActiveEnterTimestamp', 'NRestarts',
];
const SOCKET_PROPS = [
  'LoadState', 'ActiveState', 'SubState', 'UnitFileState', 'Listen', 'Accept', 'NoDelay',
  'Triggers', 'ActiveEnterTimestamp',
];
// A unit file's section headers and directives, as written (no comments, no blank lines)
function unitLines(file) {
  try {
    return fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l !== '' && !l.startsWith('#'));
  } catch {
    return [];
  }
}
const props = showProps(unit, PROPS);
const lines = unitLines(`/etc/systemd/system/${unit}`);
const pid = Number(props.MainPID ?? 0);

// The socket unit that holds the agent half's port: as written, as systemd runs it.
const socketPath = `/etc/systemd/system/${socketUnit}`;
let socketText = null;
try {
  socketText = fs.readFileSync(socketPath, 'utf8');
} catch {
  socketText = null;
}
const socketLines = unitLines(socketPath);
const socket = {
  name: socketUnit,
  file: socketText !== null,
  stat: statOf(socketPath),
  lines: socketLines,
  sha256: socketText === null ? null : crypto.createHash('sha256').update(socketText).digest('hex'),
  // Lines that look like an installation secret (64 hex characters)
  secretLines: socketLines.filter((l) => /[0-9a-f]{64}/.test(l)).length,
  props: showProps(socketUnit, SOCKET_PROPS),
};
let processUser = null;
if (pid > 0) {
  try {
    processUser = nameOf('passwd', fs.statSync(`/proc/${pid}`).uid);
  } catch {
    processUser = null;
  }
}

const pw = run('getent', ['passwd', user]).split(':');
const gr = run('getent', ['group', user]).split(':');
const account = {
  user: pw.length >= 7 ? { uid: Number(pw[2]), gid: Number(pw[3]), home: pw[5], shell: pw[6] } : null,
  group: gr.length >= 3 ? { gid: Number(gr[2]) } : null,
};
account.homeExists = account.user !== null && fs.existsSync(account.user.home);

const versions = [];
let notRootOwned = 0;
let writableByOthers = 0;
function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const s = fs.lstatSync(p);
    if (s.isSymbolicLink()) continue;
    if (s.uid !== 0) notRootOwned++;
    if (s.mode & 0o022) writableByOthers++;
    if (s.isDirectory()) walk(p);
  }
}
if (statOf(codeDir)?.type === 'dir') {
  for (const name of fs.readdirSync(codeDir)) {
    if (/^\d+\.\d+\.\d+/.test(name) && statOf(path.join(codeDir, name))?.type === 'dir') versions.push(name);
  }
  versions.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  walk(codeDir);
}

const config = readJson(`${configDir}/plugin-config.json`);
const agentCopy = readJson(`${agentDir}/app-plugins/${route}.json`);
const state = readJson(`${dataDir}/state.json`);
const record = readJson(`${agentDir}/apphost-state.json`);

// Who holds the port: the spec's (it outlives a purge), else the config's,
// else the socket file's.
const socketFilePort = Number(/^ListenStream=127\.0\.0\.1:([0-9]{1,5})$/m.exec(socketText ?? '')?.[1] ?? 0);
const port =
  Number(process.env.E2E_FACTS_PORT ?? '') || (Number.isInteger(config?.port) ? config.port : 0) || socketFilePort || null;
let history = '';
try {
  history = fs.readFileSync('/var/log/apt/history.log', 'utf8');
} catch {
  history = '';
}
const commandLines = history.split('\n').filter((l) => l.startsWith('Commandline:'));
// apt-get runs the way the helper runs it, naming the package (apt's history)
const aptRuns = (p) =>
  commandLines.filter(
    (l) => / install /.test(l) && l.includes('--no-install-recommends') && l.split(/\s+/).includes(p),
  ).length;

process.stdout.write(
  `${JSON.stringify({
    unit: { name: unit, file: lines.length > 0, lines, props, processUser },
    socket,
    dropInDir: statOf(`/etc/systemd/system/${unit}.d`),
    listen: {
      port,
      listeners: port === null ? null : listenersOn(port),
      // The listening socket the running agent half was given (systemd's), by inode
      fd3Inode: pid > 0 ? socketInodeOf(pid, 3) : null,
    },
    account,
    code: {
      dir: statOf(codeDir),
      current: linkOf(`${codeDir}/current`),
      previous: linkOf(`${codeDir}/previous`),
      versions,
      notRootOwned,
      writableByOthers,
    },
    data: {
      dir: statOf(dataDir),
      state: state ? { instance: state.instance, starts: state.starts, versions: state.versions } : null,
    },
    config: {
      dir: statOf(configDir),
      file: statOf(`${configDir}/plugin-config.json`),
      plugin: config?.plugin ?? null,
      port: config?.port ?? null,
      issuedAt: config?.issuedAt ?? null,
      secretMatchesAgentCopy: Boolean(config?.secret) && config?.secret === agentCopy?.secret,
    },
    agentCopy: agentCopy ? { issuedAt: agentCopy.issuedAt ?? null, acknowledged: agentCopy.acknowledged === true } : null,
    apphostRecord: record?.apps?.[route]?.version ?? null,
    helper: statOf('/usr/local/sbin/lamaste-apphost'),
    sudoersRule: fs.existsSync('/etc/sudoers.d/lamaste-apphost'),
    packages: Object.fromEntries(packages.map((p) => [p, run('dpkg-query', ['-W', '-f=${Status}', p]) || 'absent'])),
    aptRuns: Object.fromEntries(packages.map((p) => [p, aptRuns(p)])),
    runLockMode: statOf('/run/lock')?.mode ?? null,
    privateTmpLeak: fs.existsSync(`/tmp/e2e-${route}-private-tmp`),
    privateVarTmpLeak: fs.existsSync(`/var/tmp/e2e-${route}-private-var-tmp`),
    privateShmLeak: fs.existsSync(`/dev/shm/e2e-${route}-private-shm`),
  })}\n`,
);
PROBE_EOF
}

# write_probe_lib <file> — probe-lib.mjs, what the agent VM's probes share:
# run (a command's output, "" when it fails), showProps (`systemctl show`
# properties of a unit), listenersOn (who listens on a TCP port, from ss as
# root: each listening socket's address, the processes sharing it and its
# inode) and socketInodeOf (the socket behind a process's descriptor)
write_probe_lib() {
  cat > "$1" <<'PROBE_EOF'
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

export function run(file, args) {
  try {
    return execFileSync(file, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch (err) {
    return typeof err.stdout === 'string' ? err.stdout.trim() : '';
  }
}

export function showProps(name, wanted) {
  const out = {};
  for (const line of run('systemctl', ['show', name, `--property=${wanted.join(',')}`]).split('\n')) {
    const eq = line.indexOf('=');
    if (eq > 0) out[line.slice(0, eq)] = line.slice(eq + 1);
  }
  return out;
}

// `ss -Hltnpe 'sport = :<port>'`: one entry per listening TCP socket on the
// port — `users:(("node",pid=…,fd=3),("systemd",pid=1,fd=…))` names every
// process holding it, `ino:` is the socket's inode.
export function listenersOn(port) {
  return run('ss', ['-Hltnpe', `sport = :${port}`])
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const fields = line.trim().split(/\s+/);
      const users = [...line.matchAll(/\("([^"]*)",pid=([0-9]+),fd=([0-9]+)\)/g)].map((m) => ({
        name: m[1],
        pid: Number(m[2]),
        fd: Number(m[3]),
      }));
      const inode = /\bino:([0-9]+)/.exec(line)?.[1];
      return { state: fields[0] ?? null, local: fields[3] ?? null, users, inode: inode ? Number(inode) : null };
    });
}

export function socketInodeOf(pid, fd) {
  try {
    const m = /^socket:\[([0-9]+)\]$/.exec(fs.readlinkSync(`/proc/${pid}/fd/${fd}`));
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
}
PROBE_EOF
}

# write_port_probe <file> — port-probe.mjs (spec 35): what holds an agent
# half's port, and what that leaves another local process. Run as root on
# the agent VM; prints one line of JSON.
#
#   node port-probe.mjs bind <port> <user>
#       <user> (unprivileged) tries to listen on 127.0.0.1:<port> and on
#       0.0.0.0:<port>: {"127.0.0.1": <outcome>, "0.0.0.0": <outcome>}, an
#       outcome being the error code (EADDRINUSE) or BOUND
#   node port-probe.mjs stopped <route> <port> <user>
#       `systemctl stop` the agent half's service, then at once the socket
#       unit's state, who listens on the port and the binds above; `valid`:
#       the service stayed inactive throughout the sample (a connection —
#       the relay's health probe through the tunnel — starts it again)
#   node port-probe.mjs loop <port> <seconds> <out file>
#       one request after another to 127.0.0.1:<port>/admin/health for
#       <seconds>, each on a new connection and allowed 20 s; the tally
#       (statuses, error codes, the longest wait) goes to <out file> at the
#       end, written atomically
write_port_probe() {
  cat > "$1" <<'PROBE_EOF'
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import { listenersOn, showProps } from './probe-lib.mjs';

const [action, ...rest] = process.argv.slice(2);

// A child node as <user>: listen on host:port, print the outcome.
const BIND = `const net = require('node:net');
const [host, port] = process.argv.slice(1);
const s = net.createServer();
s.once('error', (e) => { process.stdout.write(String(e.code || 'error')); process.exit(0); });
s.listen({ host, port: Number(port) }, () => { process.stdout.write('BOUND'); s.close(); });`;
function bindAs(user, host, port) {
  try {
    return execFileSync('runuser', ['-u', user, '--', process.execPath, '-e', BIND, host, String(port)], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 15_000,
    }).trim();
  } catch (err) {
    return `failed:${err.code ?? err.status ?? 'error'}`;
  }
}
function binds(port, user) {
  return { '127.0.0.1': bindAs(user, '127.0.0.1', port), '0.0.0.0': bindAs(user, '0.0.0.0', port) };
}

function healthOnce(port) {
  return new Promise((resolve) => {
    const started = Date.now();
    const req = http.get({ host: '127.0.0.1', port, path: '/admin/health', agent: false, timeout: 20_000 }, (res) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode, ms: Date.now() - started }));
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('timed out'), { code: 'TIMEOUT' })));
    req.on('error', (err) => resolve({ error: String(err.code ?? 'error'), ms: Date.now() - started }));
  });
}

if (action === 'bind') {
  const [port, user] = rest;
  process.stdout.write(`${JSON.stringify(binds(Number(port), user))}\n`);
} else if (action === 'stopped') {
  const [route, port, user] = rest;
  const service = `lamalibre-app-${route}.service`;
  const socketUnit = `lamalibre-app-${route}.socket`;
  execFileSync('systemctl', ['stop', service], { stdio: 'ignore', timeout: 60_000 });
  const before = showProps(service, ['ActiveState', 'MainPID']);
  const socket = showProps(socketUnit, ['ActiveState', 'SubState', 'Listen']);
  const listeners = listenersOn(Number(port));
  const bound = binds(Number(port), user);
  const after = showProps(service, ['ActiveState', 'MainPID']);
  process.stdout.write(
    `${JSON.stringify({
      valid: before.ActiveState === 'inactive' && after.ActiveState === 'inactive',
      service: { before, after },
      socket,
      listeners,
      binds: bound,
    })}\n`,
  );
} else if (action === 'loop') {
  const [port, seconds, outFile] = rest;
  const deadline = Date.now() + Number(seconds) * 1000;
  const tally = { requests: 0, statuses: {}, errors: {}, longestMs: 0 };
  while (Date.now() < deadline) {
    const r = await healthOnce(Number(port));
    tally.requests += 1;
    tally.longestMs = Math.max(tally.longestMs, r.ms);
    if (r.error) tally.errors[r.error] = (tally.errors[r.error] ?? 0) + 1;
    else tally.statuses[r.status] = (tally.statuses[r.status] ?? 0) + 1;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  fs.writeFileSync(`${outFile}.tmp`, `${JSON.stringify(tally)}\n`);
  fs.renameSync(`${outFile}.tmp`, outFile);
} else {
  process.stderr.write('usage: port-probe.mjs bind <port> <user> | stopped <route> <port> <user> | loop <port> <seconds> <out file>\n');
  process.exit(2);
}
PROBE_EOF
}

# ship_agent_facts_probe — write the agent VM's probes (agent-facts.mjs,
# port-probe.mjs and the probe-lib.mjs they import) and put them in a fresh
# REMOTE_DIR there
ship_agent_facts_probe() {
  local probe
  write_probe_lib "${LOCAL_TMP}/probe-lib.mjs"
  write_agent_facts_probe "${LOCAL_TMP}/agent-facts.mjs"
  write_port_probe "${LOCAL_TMP}/port-probe.mjs"
  agent_exec "rm -rf ${REMOTE_DIR} && mkdir -p ${REMOTE_DIR} && chmod a+rwx ${REMOTE_DIR}"
  for probe in probe-lib.mjs agent-facts.mjs port-probe.mjs; do
    multipass transfer "${LOCAL_TMP}/${probe}" "${AGENT_VM}:${REMOTE_DIR}/${probe}"
  done
}

# agent_facts <route> <service user> [<system package>...] — see
# write_agent_facts_probe; FACTS_PORT (set by the spec once it knows the
# hosting's port) is the port whose listeners it reports
agent_facts() {
  local route="$1" user="$2"
  shift 2
  agent_exec "E2E_FACTS_PORT=${FACTS_PORT:-} node ${REMOTE_DIR}/agent-facts.mjs ${route} ${user} ${AGENT_LABEL} $*" 2>/dev/null || echo '{}'
}

# port_probe <arguments> — see write_port_probe ('{}' when it fails)
port_probe() {
  agent_exec "node ${REMOTE_DIR}/port-probe.mjs $*" 2>/dev/null || echo '{}'
}

# relay_leftovers <plugin> — the relay's hosting record (HTTP status of its
# view), internal tunnels and the host capability on the agent's certificate
relay_leftovers() {
  host_exec "h=\$(${CURL_MTLS} -o /dev/null -w '%{http_code}' '${PANEL}/plugins/$1/hosting'); t=\$(${CURL_MTLS} '${PANEL}/tunnels?limit=500' | jq '[.tunnels[]? | select(.pluginRoute == \"$1\")] | length'); c=\$(${CURL_MTLS} '${PANEL}/certs/agent' | jq '[.agents[]? | select(.label == \"${HOST_AGENT_LABEL}\" and (.revoked // false) == false) | .capabilities[]? | select(. == \"plugin:$1:host\")] | length'); printf '{\"hosting\":\"%s\",\"tunnels\":%s,\"capabilities\":%s}\n' \"\$h\" \"\${t:-null}\" \"\${c:-null}\"" 2>/dev/null || echo '{}'
}

# assert_relay_clean <plugin> <message prefix> — no hosting, tunnel or capability
assert_relay_clean() {
  local left
  left=$(relay_leftovers "$1")
  assert_json_field "$left" '.hosting' '404' "$2: no hosting record (no secret)" || true
  assert_json_field "$left" '.tunnels' '0' "$2: no internal tunnel" || true
  assert_json_field "$left" '.capabilities' '0' "$2: no plugin:$1:host on the agent's certificate" || true
}

# agent_copy_gone <route> — the agent's own copy of the plugin config is gone
# (its sync removes it once the hosting is)
agent_copy_gone() {
  nudge_sync
  [ "$(agent_exec "if [ -e ${AGENT_DIR}/app-plugins/$1.json ]; then echo present; else echo gone; fi" 2>/dev/null)" = "gone" ]
}

# ---------------------------------------------------------------------------
# Settings (slice 4) — specs 37 and 38
# ---------------------------------------------------------------------------
#
# A test secret exists only on the host VM, in PRIV (0700; its files 0600):
# generated there (secret-<name>), put into request bodies there — jq reads
# the file, so the value is never an argument — and compared by its SHA-256.
# PRIV/patterns holds every test secret, one per line, for the scans
# (grep -F -f, which report counts). Settings calls go through
# settings-call.sh in REMOTE_DIR, which keeps every response in
# PRIV/responses.log and never prints one holding a test secret.

# write_settings_call_script <file> — settings-call.sh (see its header);
# shipped to the host VM's REMOTE_DIR
write_settings_call_script() {
  cat > "$1" <<'CALL_EOF'
#!/bin/bash
# settings-call.sh <method> <api path> [<body file>] — one panel API call as
# the admin. Prints the response, then its HTTP status on a line of its own,
# and keeps both in private/responses.log for the specs' scan. A response
# holding a test secret (private/patterns) is never printed: a marker is.
set -u
priv="$(cd "$(dirname "$0")" && pwd)/private"
out="$(mktemp "${priv}/response.XXXXXXXX")"
status=""
if [ -n "${3:-}" ]; then
  status=$(curl -sk --max-time 30 --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key \
    --cacert /etc/lamalibre/lamaste/pki/ca.crt -X "$1" -H 'Accept: application/json' -H 'Content-Type: application/json' \
    --data-binary "@$3" -o "$out" -w '%{http_code}' "https://127.0.0.1:9292/api/$2" 2>/dev/null) || true
else
  status=$(curl -sk --max-time 30 --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key \
    --cacert /etc/lamalibre/lamaste/pki/ca.crt -X "$1" -H 'Accept: application/json' \
    -o "$out" -w '%{http_code}' "https://127.0.0.1:9292/api/$2" 2>/dev/null) || true
fi
[ -n "$status" ] || status="000"
{
  printf '### %s %s %s\n' "$1" "$2" "$status"
  cat "$out"
  printf '\n'
} >> "${priv}/responses.log"
if [ -s "${priv}/patterns" ] && grep -qaF -f "${priv}/patterns" "$out"; then
  printf '{"redacted":"the response held a test secret"}\n'
else
  cat "$out"
  printf '\n'
fi
printf '%s\n' "$status"
rm -f "$out"
CALL_EOF
}

# write_cli_sampled_script <file> — cli-sampled.sh (see its header); shipped
# to the host VM's REMOTE_DIR
write_cli_sampled_script() {
  cat > "$1" <<'CLI_EOF'
#!/bin/bash
# cli-sampled.sh <stdin file | -> <lamaste-server arguments...> — run
# lamaste-server with that file on its stdin (- for none) while, every
# 50 ms, every process's arguments are appended to private/ps.log and the
# /proc/<pid>/cmdline and /proc/<pid>/environ files holding a test secret
# (private/patterns) are listed in private/cmdline.log and
# private/environ.log. Prints the CLI's exit status, then its output — or a
# marker when the output holds a test secret.
set -u
priv="$(cd "$(dirname "$0")" && pwd)/private"
input="$1"
shift
out="$(mktemp "${priv}/cli.XXXXXXXX")"
flag="${priv}/sampling"
touch "$flag" "${priv}/ps.log" "${priv}/cmdline.log" "${priv}/environ.log"
(
  while [ -e "$flag" ]; do
    ps -e -ww -o pid=,args= >> "${priv}/ps.log" 2>/dev/null
    printf '=== sample\n' >> "${priv}/ps.log"
    if [ -s "${priv}/patterns" ]; then
      grep -laF -f "${priv}/patterns" /proc/[0-9]*/cmdline >> "${priv}/cmdline.log" 2>/dev/null
      grep -laF -f "${priv}/patterns" /proc/[0-9]*/environ >> "${priv}/environ.log" 2>/dev/null
    fi
    sleep 0.05
  done
) &
sampler=$!
sleep 0.3
if [ "$input" = "-" ]; then
  lamaste-server "$@" > "$out" 2>&1 < /dev/null
else
  lamaste-server "$@" > "$out" 2>&1 < "$input"
fi
rc=$?
sleep 0.2
rm -f "$flag"
wait "$sampler" 2>/dev/null
printf '%s\n' "$rc"
if [ -s "${priv}/patterns" ] && grep -qaF -f "${priv}/patterns" "$out"; then
  printf '[the output held a test secret]\n'
else
  cat "$out"
fi
rm -f "$out"
CLI_EOF
}

# prepare_settings_priv — on the host VM, after start_stand_in_feria shipped
# the scripts: PRIV (0700), an empty patterns file, the scripts shipped
# (settings-call.sh, and cli-sampled.sh when the spec uses it) executable
prepare_settings_priv() {
  host_exec "install -d -m 0700 ${PRIV} && install -m 0600 /dev/null ${PRIV}/patterns; for s in settings-call.sh cli-sampled.sh; do if [ -f ${REMOTE_DIR}/\$s ]; then chmod 0755 ${REMOTE_DIR}/\$s; fi; done" > /dev/null 2>&1 || true
}

# make_test_secret <name> — a new test secret on the host VM: 48 hex
# characters in PRIV/secret-<name> (0600), added to PRIV/patterns. Prints
# its length — never the secret.
make_test_secret() {
  host_exec "umask 077; openssl rand -hex 24 > ${PRIV}/secret-$1 && cat ${PRIV}/secret-$1 >> ${PRIV}/patterns && tr -d '\n' < ${PRIV}/secret-$1 | wc -c" 2>/dev/null | tr -d ' ' || echo "0"
}

# secret_digest <name> — the SHA-256 (hex) of test secret <name>
secret_digest() {
  host_exec "tr -d '\n' < ${PRIV}/secret-$1 | sha256sum | cut -c1-64" 2>/dev/null || echo ""
}

# secret_put_body <name> <revision> <values json> — on the host VM, the
# body of PUT /api/plugins/<name>/settings that sets apiKey to test secret
# <name> (PRIV/put-<name>.json, 0600); prints its path
secret_put_body() {
  local file="${PRIV}/put-$1.json"
  host_exec "umask 077; jq -c -n --rawfile k ${PRIV}/secret-$1 --argjson r $2 --argjson v '$3' '{revision: \$r, values: \$v, secrets: {apiKey: (\$k | rtrimstr(\"\\n\"))}}' > ${file}" > /dev/null 2>&1 || true
  echo "$file"
}

# secret_stdin_body <name> — on the host VM, what `plugins configure
# --secrets-stdin` reads to set apiKey to test secret <name>
# (PRIV/stdin-<name>.json, 0600); prints its path
secret_stdin_body() {
  local file="${PRIV}/stdin-$1.json"
  host_exec "umask 077; jq -c -n --rawfile k ${PRIV}/secret-$1 '{apiKey: (\$k | rtrimstr(\"\\n\"))}' > ${file}" > /dev/null 2>&1 || true
  echo "$file"
}

# settings_api <method> <api path> [<json>] — through settings-call.sh: the
# response, then its HTTP status on a line of its own (status_of / body_of).
# <json> must hold no single quote.
settings_api() {
  if [ -n "${3:-}" ]; then
    host_exec "umask 077; printf '%s' '$3' > ${PRIV}/body.json; ${REMOTE_DIR}/settings-call.sh $1 '$2' ${PRIV}/body.json" 2>/dev/null || echo "000"
  else
    host_exec "${REMOTE_DIR}/settings-call.sh $1 '$2'" 2>/dev/null || echo "000"
  fi
}

# settings_api_file <method> <api path> <body file on the host VM>
settings_api_file() {
  host_exec "${REMOTE_DIR}/settings-call.sh $1 '$2' $3" 2>/dev/null || echo "000"
}

# settings_view <plugin> — the body of GET /api/plugins/<plugin>/settings
settings_view() { body_of "$(settings_api GET "plugins/$1/settings")"; }

# settings_probe <plugin> — what the agent half's settings store holds,
# through the forwarder (/admin/probe/settings: digests, never a secret)
settings_probe() { body_of "$(settings_api GET "$1/probe/settings")"; }

# settings_summary <plugin> — the plugin's `settings` in GET /api/plugins
settings_summary() {
  body_of "$(settings_api GET plugins)" | jq -c ".plugins[]? | select(.name == \"$1\") | .settings // null" 2>/dev/null || echo "null"
}

# cli_sampled <stdin file | -> <lamaste-server arguments...> — through
# cli-sampled.sh: the exit status, then the output
cli_sampled() {
  local input="$1"
  shift
  timed_exec 120 multipass exec "${HOST_VM}" -- sudo bash -c "${REMOTE_DIR}/cli-sampled.sh ${input} $*" 2>/dev/null || echo "-1"
}

# cli_sample_report — what the samples of cli-sampled.sh saw, as JSON: how
# many samples, how many lines show lamaste-server running a configure, and
# how many argument lines, cmdline files and environment files held a test
# secret
cli_sample_report() {
  host_exec "s=\$(grep -c '^=== sample\$' ${PRIV}/ps.log 2>/dev/null); c=\$(grep -cE 'lamaste-server(\\.js)? plugins configure' ${PRIV}/ps.log 2>/dev/null); a=\$(grep -caF -f ${PRIV}/patterns ${PRIV}/ps.log 2>/dev/null); l=\$(wc -l < ${PRIV}/cmdline.log 2>/dev/null); e=\$(wc -l < ${PRIV}/environ.log 2>/dev/null); printf '{\"samples\":%s,\"cli\":%s,\"secretArgs\":%s,\"secretCmdlines\":%s,\"secretEnv\":%s}\n' \"\${s:-null}\" \"\${c:-null}\" \"\${a:-null}\" \"\${l:-null}\" \"\${e:-null}\"" 2>/dev/null || echo '{}'
}

# settings_sweep <plugin> — read, through settings-call.sh (so into
# PRIV/responses.log), every API answer that could carry a secret: the
# plugin list and record, its settings, hosting, hooks and operations, the
# audit log, the agents, the notifications, the agent half's probe
settings_sweep() {
  local paths="'plugins' 'plugins/$1' 'plugins/$1/settings' 'plugins/$1/hosting' 'plugins/$1/hooks' 'plugins/$1/operations' 'audit?plugin=$1&limit=200' 'audit?limit=200' 'certs/agent' 'notifications?limit=200' '$1/probe/settings'"
  host_exec "for p in ${paths}; do ${REMOTE_DIR}/settings-call.sh GET \"\$p\" > /dev/null; done" > /dev/null 2>&1 || true
}

# relay_secret_scan <plugin> <since epoch> — where the test secrets are on
# the relay, as counts: files under /etc/lamalibre, /var/lib/lamalibre,
# /opt/lamalibre, /var/log, /tmp and /run holding one (and, as a control,
# files under /etc/lamalibre naming <plugin>); lines of state.db's dump
# (with its size, and whether it holds plugin_settings); lines of the
# host's journal since <since>; lines of PRIV/responses.log (and how many
# responses it holds)
relay_secret_scan() {
  host_exec "p=${PRIV}/patterns; runuser -u lamaste -- sqlite3 -readonly /etc/lamalibre/lamaste/state.db .dump > ${PRIV}/state.sql 2>/dev/null; journalctl --since @$2 --no-pager -o cat > ${PRIV}/journal.txt 2>/dev/null; f=\$(grep -rlaF --devices=skip -f \$p /etc/lamalibre /var/lib/lamalibre /opt/lamalibre /var/log /tmp /run 2>/dev/null | wc -l); fc=\$(grep -rlaF --devices=skip -e '$1' /etc/lamalibre 2>/dev/null | wc -l); d=\$(grep -caF -f \$p ${PRIV}/state.sql); dl=\$(wc -l < ${PRIV}/state.sql); dt=\$(grep -c 'plugin_settings' ${PRIV}/state.sql); j=\$(grep -caF -f \$p ${PRIV}/journal.txt); jl=\$(wc -l < ${PRIV}/journal.txt); r=\$(grep -caF -f \$p ${PRIV}/responses.log); rc=\$(grep -c '^### ' ${PRIV}/responses.log); rm -f ${PRIV}/state.sql ${PRIV}/journal.txt; printf '{\"files\":%s,\"filesControl\":%s,\"stateDb\":%s,\"stateDbLines\":%s,\"stateDbSettingsTable\":%s,\"journal\":%s,\"journalLines\":%s,\"responses\":%s,\"responseCount\":%s}\n' \"\${f:-null}\" \"\${fc:-null}\" \"\${d:-null}\" \"\${dl:-null}\" \"\${dt:-null}\" \"\${j:-null}\" \"\${jl:-null}\" \"\${r:-null}\" \"\${rc:-null}\"" 2>/dev/null || echo '{}'
}

# settings_cache_row <plugin> — the relay's cache of the plugin's settings
# (plugin_settings in state.db), {} when there is no row: its revision,
# configured flag, the keys of its values and of its secrets, and how many
# secret entries are timestamps (setAt). Never a value: a secret the relay
# wrongly kept is not printed here — relay_secret_scan counts it.
settings_cache_row() {
  local row
  row=$(host_exec "runuser -u lamaste -- sqlite3 -readonly -json /etc/lamalibre/lamaste/state.db \"SELECT plugin, schema_version AS schemaVersion, revision, configured, (SELECT group_concat(key) FROM json_each(values_json)) AS valueKeys, (SELECT group_concat(key) FROM json_each(secrets_set_json)) AS secretKeys, (SELECT count(*) FROM json_each(secrets_set_json) WHERE value GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*') AS setAtTimestamps FROM plugin_settings WHERE plugin = '$1'\" 2>/dev/null" 2>/dev/null | jq -c '.[0] // {}' 2>/dev/null || echo "")
  [ -n "$row" ] || row='{}'
  echo "$row"
}

# write_settings_facts_probe <file> — a Node script printing, as one line of
# JSON, what an agent half's settings store left on the agent VM:
# settings.json and secrets.json (mode, owner), the values settings.json
# holds with their recorded types, the secrets' keys with the SHA-256 of
# their values and when they were set, and how many files outside
# secrets.json — and lines of the journal — hold one of those values. A
# secret is only ever compared on the VM, never printed.
#
#   node settings-facts.mjs <route> <agent label>
write_settings_facts_probe() {
  cat > "$1" <<'PROBE_EOF'
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const [route, label] = process.argv.slice(2);
const dataDir = `/var/lib/lamalibre/apps/${route}`;
const settingsPath = path.join(dataDir, 'settings.json');
const secretsPath = path.join(dataDir, 'secrets.json');
const FILE_LIMIT = 16 * 1024 * 1024;

const names = { passwd: new Map(), group: new Map() };
function nameOf(db, id) {
  if (!names[db].has(id)) {
    let entry = '';
    try {
      entry = execFileSync('getent', [db, String(id)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      entry = '';
    }
    names[db].set(id, entry.split(':')[0] || String(id));
  }
  return names[db].get(id);
}
function statOf(p) {
  try {
    const s = fs.lstatSync(p);
    const type = s.isDirectory() ? 'dir' : s.isSymbolicLink() ? 'link' : s.isFile() ? 'file' : 'other';
    return { mode: (s.mode & 0o7777).toString(8), user: nameOf('passwd', s.uid), group: nameOf('group', s.gid), type };
  } catch {
    return null;
  }
}
function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

const secretsFile = readJson(secretsPath);
const stored = secretsFile?.secrets && typeof secretsFile.secrets === 'object' ? secretsFile.secrets : {};
const values = Object.values(stored)
  .map((s) => (typeof s?.value === 'string' ? s.value : ''))
  .filter((v) => v.length > 0);
const holds = (data) => values.some((v) => data.includes(v));

// Regular files under <dir> (but <skip>) whose content holds a stored secret
function filesHolding(dir, skip) {
  let n = 0;
  const walk = (d) => {
    let entries = [];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (p === skip) continue;
      if (e.isDirectory()) {
        walk(p);
      } else if (e.isFile()) {
        try {
          if (fs.statSync(p).size <= FILE_LIMIT && holds(fs.readFileSync(p))) n++;
        } catch {
          // gone, or not readable
        }
      }
    }
  };
  walk(dir);
  return n;
}

const settingsFile = readJson(settingsPath);
const shown = {};
for (const [key, entry] of Object.entries(settingsFile?.values ?? {})) {
  const type = entry?.type ?? null;
  shown[key] = holds(String(entry?.value ?? '')) ? { type, redacted: true } : { type, value: entry?.value ?? null };
}
let journal = '';
if (values.length > 0) {
  try {
    journal = execFileSync('journalctl', ['-b', '--no-pager', '-o', 'cat'], {
      encoding: 'utf8',
      maxBuffer: 512 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    journal = '';
  }
}
const digest = (v) => crypto.createHash('sha256').update(String(v), 'utf8').digest('hex');

process.stdout.write(
  `${JSON.stringify({
    dataDir: statOf(dataDir),
    settings: settingsFile
      ? { file: statOf(settingsPath), schemaVersion: settingsFile.schemaVersion ?? null, revision: settingsFile.revision ?? null, values: shown }
      : null,
    secrets: secretsFile
      ? {
          file: statOf(secretsPath),
          keys: Object.keys(stored),
          digests: Object.fromEntries(Object.entries(stored).map(([k, s]) => [k, digest(s?.value ?? '')])),
          setAt: Object.fromEntries(Object.entries(stored).map(([k, s]) => [k, s?.setAt ?? null])),
        }
      : null,
    secretElsewhere:
      values.length === 0
        ? null
        : {
            settingsFile: fs.existsSync(settingsPath) && holds(fs.readFileSync(settingsPath)) ? 1 : 0,
            dataDir: filesHolding(dataDir, secretsPath),
            configDir: filesHolding(`/etc/lamalibre/apps/${route}`, null),
            codeDir: filesHolding(`/opt/lamalibre/apps/${route}`, null),
            agentDir: filesHolding(`/root/.lamalibre/lamaste/agents/${label}`, null),
            journal: journal.split('\n').filter((line) => holds(line)).length,
          },
  })}\n`,
);
PROBE_EOF
}

# ship_settings_facts_probe — write the probe and put it on the agent VM,
# after ship_agent_facts_probe (which makes REMOTE_DIR there)
ship_settings_facts_probe() {
  write_settings_facts_probe "${LOCAL_TMP}/settings-facts.mjs"
  multipass transfer "${LOCAL_TMP}/settings-facts.mjs" "${AGENT_VM}:${REMOTE_DIR}/settings-facts.mjs"
}

# settings_facts <route> — see write_settings_facts_probe
settings_facts() {
  agent_exec "node ${REMOTE_DIR}/settings-facts.mjs $1 ${AGENT_LABEL}" 2>/dev/null || echo '{}'
}

# iso_epoch <ISO 8601 timestamp> — its Unix time, "" when it is not one
iso_epoch() {
  jq -rn --arg t "$1" '$t | sub("\\.[0-9]+"; "") | fromdateiso8601' 2>/dev/null || echo ""
}

# ---------------------------------------------------------------------------
# Identity (slice 6) — specs 39 to 41
# ---------------------------------------------------------------------------
#
# The fixtures are write_app_install_fixture … <identity> (helpers.sh): an
# agent half keeping a projection of its plugin's users, answering a user
# caller on /app/echo and /app/me, showing an administrator its projection on
# /admin/e2e/projection, and logging every request that reaches it in
# requests.log in its data directory.

# A directory id, a user id: a UUID v4, lower case
UUID_RE='^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'

# is_uuid <value> — "true" when it is a UUID v4
is_uuid() { jq -rn --arg v "$1" --arg re "${UUID_RE}" '$v | test($re)' 2>/dev/null || echo "false"; }

# identity_view <plugin> — GET /api/plugins/<plugin>/identity's `identity`
# ('{}' when there is none): declared block, readiness, the feed's state
# (cursor, head, behind, readyVersion, lastSyncAt, lastMismatches,
# lastError), audience counts, pending erasures
identity_view() {
  host_api_get "plugins/$1/identity" 2>/dev/null | jq -c '.identity // {}' 2>/dev/null || echo '{}'
}

# identity_ready <plugin> — users may reach it: its installed version
# declares identity and is approved, its hosting is active, and since that
# version was installed its agent half applied everything up to the head
# after a complete replay (answering protocol 1 alone is not ready)
identity_ready() { [ "$(json_get "$(identity_view "$1")" '.readiness.ready')" = "true" ]; }

# identity_caught_up <plugin> — its agent half follows this directory and
# holds every change of its audience (cursor at the head, none behind)
identity_caught_up() {
  [ "$(json_get "$(identity_view "$1")" '(.sync.behind == 0) and (.sync.cursor == .sync.head) and (.sync.halfDirectoryId == .sync.directoryId) and (.sync.directoryId != null)')" = "true" ]
}

# audience_row <plugin> <userId> — the plugin's audience row of that user
# ('null' when the audience never held them)
audience_row() {
  host_api_get "plugins/$1/audience" 2>/dev/null | jq -c --arg id "$2" '[.audience[]? | select(.userId == $id)] | first // null' 2>/dev/null || echo "null"
}

# directory_user <userId> — the directory's record of that user ('null' when none)
directory_user() {
  host_api_get "identity/directory" 2>/dev/null | jq -c --arg id "$1" '[.users[]? | select(.userId == $id)] | first // null' 2>/dev/null || echo "null"
}

# listed_user <username> — the user as GET /api/users lists them ('null' when absent)
listed_user() {
  host_api_get "users" 2>/dev/null | jq -c --arg u "$1" '[.users[]? | select(.username == $u)] | first // null' 2>/dev/null || echo "null"
}

# projection <plugin> — what the agent half's projection holds: its state,
# every row (removed and erased ones too) and the users its onErase ran for
projection() { host_api_get "$1/e2e/projection" 2>/dev/null || echo '{}'; }

# projection_has <plugin> <jq filter> — the agent half's projection satisfies it
projection_has() { projection "$1" | jq -e "$2" > /dev/null 2>&1; }

# projected_user <plugin> <userId> — the projection's row of that user ('null' when none)
projected_user() {
  projection "$1" | jq -c --arg id "$2" '[.users[]? | select(.userId == $id)] | first // null' 2>/dev/null || echo "null"
}

# drop_plugin_grants <route> — remove every Gatekeeper grant on the plugin
# (its entitlements, grants without roles): they outlive an uninstall, and
# an interrupted run's would make someone a member of the next run's audience
drop_plugin_grants() {
  local id
  for id in $(host_api_get "gatekeeper/grants?resourceType=plugin&resourceId=$1" 2>/dev/null | jq -r '.grants[]?.grantId // empty' 2>/dev/null || true); do
    host_api_delete "gatekeeper/grants/${id}" > /dev/null 2>&1 || true
  done
}

# users_call <method> <path> [json] — host_api_call for the users API,
# waiting out its rate limit (5 creations or updates a minute): retried on
# 429 for up to 75 seconds
users_call() {
  local out deadline=$((SECONDS + 75))
  while :; do
    out=$(host_api_call "$@")
    if [ "$(status_of "$out")" != "429" ] || [ "$SECONDS" -ge "$deadline" ]; then
      echo "$out"
      return 0
    fi
    sleep 15
  done
}

# half_requests <route> <extended regex> — how many lines of the agent half's
# request log (requests.log in its data directory: `<time> <method> <path>`)
# match; -1 when the log cannot be read — never a count a spec could take
# for "nothing arrived"
half_requests() {
  local n
  n=$(agent_exec "f=/var/lib/lamalibre/apps/$1/requests.log; if [ -f \$f ]; then grep -cE $(printf %q "$2") \$f || true; else echo -1; fi" 2>/dev/null | tail -n 1) || n=""
  echo "${n:--1}"
}

# write_identity_tamper <file> — identity-tamper.mjs: what an intruder in an
# agent half's own account could do to its projection, as one SQLite
# transaction from outside the running half — the given user gets the
# editor role, and a member the directory never named (e2e-phantom, active,
# viewer) is slipped in. With `erase`, the given user's row is scrubbed to
# the bare id instead, as the agent half's own erasure leaves it (removed,
# erased, no name, address or roles): the projection then holds an erasure
# the relay's ledger does not — what a relay restored from a backup taken
# before the erasure would contradict. Prints {"changed": n, "inserted": n}.
#
#   node identity-tamper.mjs <identity.db> <userId> [erase]
write_identity_tamper() {
  cat > "$1" <<'TAMPER_EOF'
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const [file, userId, mode] = process.argv.slice(2);
const db = new DatabaseSync(file);
const now = new Date().toISOString();
db.exec('PRAGMA busy_timeout = 10000');
db.exec('BEGIN IMMEDIATE');
let changed = 0;
let inserted = 0;
if (mode === 'erase') {
  changed = db
    .prepare(
      `UPDATE lamaste_users SET username = NULL, display_name = NULL, email = NULL, roles = '[]',
         status = 'removed', removed_reason = 'erased', removed_at = COALESCE(removed_at, ?),
         erased_at = ?, updated_at = ?
       WHERE user_id = ?`,
    )
    .run(now, now, now, userId).changes;
} else {
  changed = db.prepare('UPDATE lamaste_users SET roles = ? WHERE user_id = ?').run('["editor"]', userId).changes;
  inserted = db
    .prepare(
      `INSERT INTO lamaste_users (user_id, username, display_name, email, roles, status, removed_reason,
         removed_at, erased_at, version, seen_pass, updated_at)
       VALUES (?, 'e2e-phantom', 'E2E Phantom', NULL, '["viewer"]', 'active', NULL, NULL, NULL, 1, NULL, ?)`,
    )
    .run(crypto.randomUUID(), now).changes;
}
db.exec('COMMIT');
db.close();
process.stdout.write(`${JSON.stringify({ changed: Number(changed), inserted: Number(inserted) })}\n`);
TAMPER_EOF
}

# ship_identity_tamper — write identity-tamper.mjs and put it in the agent
# VM's REMOTE_DIR, after ship_agent_facts_probe (which makes it)
ship_identity_tamper() {
  write_identity_tamper "${LOCAL_TMP}/identity-tamper.mjs"
  multipass transfer "${LOCAL_TMP}/identity-tamper.mjs" "${AGENT_VM}:${REMOTE_DIR}/identity-tamper.mjs"
  agent_exec "chmod 0644 ${REMOTE_DIR}/identity-tamper.mjs" > /dev/null 2>&1 || true
}

# tamper_projection <route> <service user> <userId> [erase] — run it on the
# agent half's database as the agent half's own account (its files stay its
# own); prints its answer ('{}' when it failed)
tamper_projection() {
  agent_exec "runuser -u $2 -- node ${REMOTE_DIR}/identity-tamper.mjs /var/lib/lamalibre/apps/$1/identity.db $3 ${4:-} 2>/dev/null" 2>/dev/null | grep -E '^\{' | tail -n 1 || echo '{}'
}

# write_identity_peek <file> — identity-peek.mjs: the row an agent half's
# projection holds of one user, read from the data an agent keeps while no
# agent half runs (an uninstall without purge). It reads a copy — the
# database and its -wal and -shm files, taken together into a directory of
# its own and removed after — so the files the next agent half opens stay
# its account's, untouched. Prints the row ({userId, username, displayName,
# status, removedReason, erasedAt}) or null.
#
#   node identity-peek.mjs <identity.db> <userId>
write_identity_peek() {
  cat > "$1" <<'PEEK_EOF'
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const [file, userId] = process.argv.slice(2);
if (!fs.existsSync(file)) {
  process.stderr.write(`no projection at ${file}\n`);
  process.exit(1);
}
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-identity-peek-'));
try {
  const copy = path.join(dir, 'identity.db');
  for (const suffix of ['', '-wal', '-shm']) {
    if (fs.existsSync(`${file}${suffix}`)) fs.copyFileSync(`${file}${suffix}`, `${copy}${suffix}`);
  }
  const db = new DatabaseSync(copy);
  const row = db
    .prepare(
      `SELECT user_id AS userId, username, display_name AS displayName, status,
         removed_reason AS removedReason, erased_at AS erasedAt
       FROM lamaste_users WHERE user_id = ?`,
    )
    .get(userId);
  db.close();
  process.stdout.write(`${JSON.stringify(row ?? null)}\n`);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
PEEK_EOF
}

# ship_identity_peek — write identity-peek.mjs and put it in the agent VM's
# REMOTE_DIR, after ship_agent_facts_probe (which makes it)
ship_identity_peek() {
  write_identity_peek "${LOCAL_TMP}/identity-peek.mjs"
  multipass transfer "${LOCAL_TMP}/identity-peek.mjs" "${AGENT_VM}:${REMOTE_DIR}/identity-peek.mjs"
  agent_exec "chmod 0644 ${REMOTE_DIR}/identity-peek.mjs" > /dev/null 2>&1 || true
}

# kept_projection_user <route> <userId> — the row the projection in the data
# the agent keeps for <route> holds of that user ('null' when none, '{}' when
# it cannot be read); as root, on a copy (write_identity_peek)
kept_projection_user() {
  agent_exec "node ${REMOTE_DIR}/identity-peek.mjs /var/lib/lamalibre/apps/$1/identity.db $2 2>/dev/null" 2>/dev/null | grep -E '^(\{|null)' | tail -n 1 || echo '{}'
}

# agent_has_node_sqlite — the agent VM's Node.js has node:sqlite unflagged
# (22.13 and later), which the identity fixture's agent half needs
agent_has_node_sqlite() {
  [ "$(agent_exec "node -e \"require('node:sqlite'); console.log('yes')\" 2>/dev/null" 2>/dev/null | tail -n 1)" = "yes" ]
}

# ---------------------------------------------------------------------------
# The visitor VM (slices 6 and 7) — specs 40, 42 and 43
# ---------------------------------------------------------------------------
#
# A person's browser: requests from the visitor VM, which reaches the relay's
# hosts through /etc/hosts entries the specs write, and signs in to Authelia
# with a password and a TOTP code (oathtool).

VISITOR_VM="lamaste-visitor"

visitor_exec() { multipass exec "${VISITOR_VM}" -- sudo bash -c "$1"; }

# q <arguments...> — each quoted for the remote shell (printf %q), joined by spaces
q() {
  local out="" a
  for a in "$@"; do out="${out} $(printf %q "$a")"; done
  printf '%s' "${out# }"
}

# visit <cookie jar | -> <curl arguments...> — one request from the visitor
# VM: the response headers, a blank line, the body, then the HTTP status on
# a line of its own (visit_status, visit_headers, visit_body split them)
visit() {
  local jar="$1" cookies=""
  shift
  if [ "$jar" != "-" ]; then cookies="-b $(printf %q "$jar")"; fi
  visitor_exec "curl -sk --max-time 20 -D - -w '\n%{http_code}' ${cookies} $(q "$@") || true" 2>/dev/null || echo "000"
}
visit_status() { printf '%s\n' "$1" | tail -n 1; }
# Read to the end (no early exit): under pipefail the writer must not die of SIGPIPE.
visit_headers() { printf '%s\n' "$1" | sed '$d' | tr -d '\r' | awk 'f == 0 && /^$/ {f = 1} f == 0 {print}'; }
visit_body() { printf '%s\n' "$1" | sed '$d' | tr -d '\r' | awk 'f == 1 {print} f == 0 && /^$/ {f = 1}'; }

# reset_totp <username> — a fresh TOTP secret for the user (the panel's
# reset, as the admin); prints the base32 secret
reset_totp() {
  host_api_post "users/$1/reset-totp" '{}' 2>/dev/null | jq -r '.totpUri // empty' 2>/dev/null | sed -n 's/.*secret=\([A-Z2-7]*\).*/\1/p' || true
}

# sign_in <username> <password> <totp secret> <cookie jar> <host> — Authelia's
# two factors from the visitor VM into <jar>, for a page of <host>; prints
# "<first> <second>" (OK OK)
sign_in() {
  local body first code second
  visitor_exec "rm -f $(printf %q "$4")" > /dev/null 2>&1 || true
  body=$(jq -c -n --arg u "$1" --arg p "$2" --arg t "https://$5/" '{username: $u, password: $p, keepMeLoggedIn: false, targetURL: $t}')
  first=$(visitor_exec "curl -sk --max-time 15 -c $(q "$4" -X POST -H 'Content-Type: application/json' -d "$body" "https://auth.${DOMAIN}/api/firstfactor") || true" 2>/dev/null | jq -r '.status // "none"' 2>/dev/null || true)
  code=$(visitor_exec "oathtool --totp --base32 $(printf %q "$3")" 2>/dev/null | tail -n 1 || true)
  body=$(jq -c -n --arg c "$code" --arg t "https://$5/" '{token: $c, targetURL: $t}')
  second=$(visitor_exec "curl -sk --max-time 15 -b $(q "$4") -c $(q "$4" -X POST -H 'Content-Type: application/json' -d "$body" "https://auth.${DOMAIN}/api/secondfactor/totp") || true" 2>/dev/null | jq -r '.status // "none"' 2>/dev/null || true)
  echo "${first:-none} ${second:-none}"
}

# session_cookie <jar> — the authelia_session cookie in a visitor's jar
session_cookie() {
  # shellcheck disable=SC2016 # an awk program, for the remote shell to pass on as it is
  visitor_exec "awk $(printf %q '$6 == "authelia_session" {print $7}') $(printf %q "$1") || true" 2>/dev/null | tail -n 1 || true
}

# visitor_has_oathtool — the visitor VM can make Authelia's second factor
visitor_has_oathtool() {
  [ "$(visitor_exec "command -v oathtool > /dev/null && echo yes || echo no" 2>/dev/null | tail -n 1)" = "yes" ]
}

# tunnel_entry <id> — the tunnel as GET /api/tunnels lists it ('null' when gone)
tunnel_entry() {
  host_api_get "tunnels?limit=500" 2>/dev/null | jq -c --arg id "$1" '[.tunnels[]? | select(.id == $id)] | first // null' 2>/dev/null || echo "null"
}

# ---------------------------------------------------------------------------
# Web surfaces (slice 7) — specs 42 and 43
# ---------------------------------------------------------------------------
#
# The fixtures are write_app_install_fixture … <identity> <web tag>
# (helpers.sh): a web tree under web/ in the server package, whose
# index.html carries E2E_WEB_<tag>.

# page <jar | -> <path> [curl arguments...] — a request for <path> on the
# spec's host (FQDN) from the visitor VM, as visit prints it
page() {
  local jar="$1" path="$2"
  shift 2
  visit "$jar" "$@" "https://${FQDN}${path}"
}
page_status() { visit_status "$(page "$@")"; }

# web_surface <plugin> — GET /api/plugins/<plugin>/web-surface's `webSurface` ('{}' when none)
web_surface() {
  host_api_get "plugins/$1/web-surface" 2>/dev/null | jq -c '.webSurface // {}' 2>/dev/null || echo '{}'
}

# web_served <plugin> — the plugin's web surface is served
web_served() { [ "$(json_get "$(web_surface "$1")" '.served')" = "true" ]; }

# tree_link <route> <current|previous> — the digest the relay's tree store
# link names on the host VM ("" when there is none)
tree_link() {
  host_exec "readlink /var/www/lamaste/apps/$1/$2 2>/dev/null || true" 2>/dev/null | tr -d '\r\n' || true
}

# tree_dirs <route> — the trees the store holds, sorted, comma-separated
tree_dirs() {
  host_exec "ls /var/www/lamaste/apps/$1 2>/dev/null | grep -E '^[a-f0-9]{64}$' | sort | paste -sd, - || true" 2>/dev/null | tr -d '\r\n' || true
}

# ---------------------------------------------------------------------------
# Cleanup
# ---------------------------------------------------------------------------

# app_plugin_cleanup — what the specs' cleanup traps run, leaving both VMs as
# they were. The plugins in CLEAN_PLUGINS are uninstalled (a hosted one with
# purge: removing its agent half is a push, so the gates are opened again for
# it; an operation still running is waited for, up to three minutes). What
# may be left of the routes in CLEAN_ROUTES on the agent VM is purged with
# the helper directly. Then what the spec changed goes back: the push-install
# window, policy and switch, the panel's registry credential, the
# stand-in Feria and its firewall rule, the app host helper (only if this
# spec enabled it) and the system packages in PURGE_PACKAGES (those the spec
# saw missing before Lamaste installed them).
app_plugin_cleanup() {
  local plugin route deadline code
  if [ -n "${PUSH_POLICY}" ]; then
    host_api_patch "plugins/push-install/config" '{"enabled":true}' > /dev/null 2>&1 || true
    host_api_post "plugins/push-install/enable/${HOST_AGENT_LABEL}" "{\"durationMinutes\":15,\"policyId\":\"${PUSH_POLICY}\"}" > /dev/null 2>&1 || true
  fi
  for plugin in ${CLEAN_PLUGINS:-}; do
    # A web surface outlives its plugin's uninstall: deleted first (its
    # site, vhost, trees and grants).
    host_api_delete "plugins/${plugin}/web-surface" > /dev/null 2>&1 || true
    deadline=$((SECONDS + 180))
    while [ "$SECONDS" -lt "$deadline" ]; do
      code=$(host_api_get_status "plugins/${plugin}")
      if [ "$code" = "404" ] || [ "$code" = "000" ]; then break; fi
      host_api_post "plugins/${plugin}/disable" '{}' > /dev/null 2>&1 || true
      if [ "$(host_api_get_status "plugins/${plugin}/hosting")" = "200" ]; then
        host_api_delete "plugins/${plugin}?force=true&purge=true" > /dev/null 2>&1 || true
      else
        host_api_delete "plugins/${plugin}?force=true" > /dev/null 2>&1 || true
      fi
      nudge_sync
      sleep 3
    done
  done
  for route in ${CLEAN_ROUTES:-}; do
    # As the agent that owns the route (the helper refuses any other).
    timed_exec 120 multipass exec "${AGENT_VM}" -- sudo bash -c "if [ -x ${APPHOST_HELPER} ]; then ${APPHOST_HELPER} remove ${AGENT_LABEL} ${route} --purge > /dev/null 2>&1; fi; true" > /dev/null 2>&1
  done
  if [ -n "${PUSH_WINDOW}" ]; then
    host_api_delete "plugins/push-install/enable/${HOST_AGENT_LABEL}" > /dev/null 2>&1 || true
  fi
  if [ -n "${PUSH_POLICY}" ]; then
    host_api_delete "plugins/push-install/policies/${PUSH_POLICY}" > /dev/null 2>&1 || true
  fi
  if [ -n "${PUSH_GLOBAL_BEFORE}" ]; then
    host_api_patch "plugins/push-install/config" "{\"enabled\":${PUSH_GLOBAL_BEFORE}}" > /dev/null 2>&1 || true
  fi
  if [ -n "${CREDENTIAL_SET}" ]; then
    timed_exec 90 multipass exec "${HOST_VM}" -- sudo bash -c "lamaste-server registry-credential clear > /dev/null 2>&1; true" > /dev/null 2>&1
  fi
  if [ -n "${STUB_STARTED}" ]; then
    timed_exec 60 multipass exec "${HOST_VM}" -- sudo bash -c "pkill -f '[s]tub-registry.mjs' 2>/dev/null; ufw delete allow from ${AGENT_IP} to any port ${STUB_PORT} proto tcp > /dev/null 2>&1; true" > /dev/null 2>&1
  fi
  timed_exec 30 multipass exec "${HOST_VM}" -- sudo bash -c "rm -rf ${REMOTE_DIR}" > /dev/null 2>&1
  timed_exec 30 multipass exec "${AGENT_VM}" -- sudo bash -c "rm -rf ${REMOTE_DIR}" > /dev/null 2>&1
  if [ -n "${APPHOST_ENABLED_HERE}" ]; then
    timed_exec 180 multipass exec "${AGENT_VM}" -- sudo bash -c "lamaste-agent apphost disable --force > /dev/null 2>&1; true" > /dev/null 2>&1
  fi
  if [ -n "${PURGE_PACKAGES:-}" ]; then
    timed_exec 180 multipass exec "${AGENT_VM}" -- sudo bash -c "DEBIAN_FRONTEND=noninteractive apt-get purge -y -qq ${PURGE_PACKAGES} > /dev/null 2>&1; true" > /dev/null 2>&1
  fi
  if [ -n "${LOCAL_TMP:-}" ]; then rm -rf "${LOCAL_TMP}"; fi
}

# shellcheck shell=bash
# ============================================================================
# App plugin harness — what the three-VM specs 34, 35 and 36 share
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
# - open_push_install: the push-install gates an agent-half push passes;
# - agent_facts / relay_leftovers: the agent VM's and the relay's state of an
#   agent half, each read in one call and never including a secret;
# - nudge_sync: start the agent's sync unit now instead of when its timer
#   fires — the same unit, so never two syncs at once. Spec 34 hosts on the
#   timer alone; the specs nudge later operations to stay inside rodeo's
#   ten minutes per spec;
# - app_plugin_cleanup: what the specs' cleanup traps run.
#
# Runs on the machine driving the VMs, under bash 3.2 (macOS): no arrays.
# A spec sets REMOTE_DIR, LOCAL_TMP, CLEAN_PLUGINS, CLEAN_ROUTES and
# PURGE_PACKAGES (space-separated lists) before it uses these.
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
STATE_NPMRC="/etc/lamalibre/lamaste/.npmrc"
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
# What the cleanup restores (set as the spec changes it)
APPHOST_ENABLED_HERE=""
PUSH_GLOBAL_BEFORE=""
PUSH_POLICY=""
PUSH_WINDOW=""
CREDENTIAL_SET=""
NPMRC_WRITTEN=""
STUB_STARTED=""

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
# address). The panel then installs from it (STATE_NPMRC with the stand-in's
# admin token; a file already there is kept aside and put back by the
# cleanup) and holds its registry credential through its own OIDC client.
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

  NPMRC_WRITTEN=1
  host_exec "if [ -f ${STATE_NPMRC} ] && [ ! -f ${STATE_NPMRC}.e2e-before ]; then cp -p ${STATE_NPMRC} ${STATE_NPMRC}.e2e-before; fi; printf '@lamalibre:registry=%s/\n//%s:%s/:_authToken=%s\n' '${STUB_URL}' '${HOST_IP}' '${STUB_PORT}' '${STUB_ADMIN_TOKEN}' > ${REMOTE_DIR}/npmrc && install -o lamaste -g lamaste -m 0600 ${REMOTE_DIR}/npmrc ${STATE_NPMRC} && rm -f ${REMOTE_DIR}/npmrc"

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
# the agent's window (60 minutes) under that policy. Prints the window.
open_push_install() {
  remember_push_install
  host_api_patch "plugins/push-install/config" '{"enabled":true}' > /dev/null
  host_api_delete "plugins/push-install/policies/$1" > /dev/null 2>&1 || true
  PUSH_POLICY="$1"
  host_api_post "plugins/push-install/policies" "{\"name\":\"$1\",\"id\":\"$1\",\"description\":\"e2e: agent-half pushes\",\"allowedPlugins\":$2,\"allowedActions\":$3}" > /dev/null
  PUSH_WINDOW=1
  host_api_post "plugins/push-install/enable/${HOST_AGENT_LABEL}" "{\"durationMinutes\":60,\"policyId\":\"$1\"}"
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
# systemd applies it), account, code, data, config, the agent's own copy of
# the plugin config and record, the helper, and system packages. A secret is
# only ever compared on the VM, never printed.
#
#   node agent-facts.mjs <route> <service user> <agent label> [<system package>...]
write_agent_facts_probe() {
  cat > "$1" <<'PROBE_EOF'
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const [route, user, label, ...packages] = process.argv.slice(2);
const unit = `lamalibre-app-${route}.service`;
const codeDir = `/opt/lamalibre/apps/${route}`;
const dataDir = `/var/lib/lamalibre/apps/${route}`;
const configDir = `/etc/lamalibre/apps/${route}`;
const agentDir = `/root/.lamalibre/lamaste/agents/${label}`;

function run(file, args) {
  try {
    return execFileSync(file, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch (err) {
    return typeof err.stdout === 'string' ? err.stdout.trim() : '';
  }
}
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
  'LoadState', 'ActiveState', 'UnitFileState', 'MainPID', 'User', 'Group', 'ExecStart',
  'Environment', 'ProtectSystem', 'ProtectHome', 'NoNewPrivileges', 'PrivateTmp',
  'PrivateDevices', 'ReadWritePaths', 'RestrictSUIDSGID', 'LockPersonality', 'MemoryMax',
  'CapabilityBoundingSet', 'UMask', 'Restart',
];
const props = {};
for (const line of run('systemctl', ['show', unit, `--property=${PROPS.join(',')}`]).split('\n')) {
  const eq = line.indexOf('=');
  if (eq > 0) props[line.slice(0, eq)] = line.slice(eq + 1);
}
let lines = [];
try {
  lines = fs
    .readFileSync(`/etc/systemd/system/${unit}`, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('#'));
} catch {
  lines = [];
}
const pid = Number(props.MainPID ?? 0);
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
  })}\n`,
);
PROBE_EOF
}

# ship_agent_facts_probe — write the probe and put it on the agent VM (REMOTE_DIR)
ship_agent_facts_probe() {
  write_agent_facts_probe "${LOCAL_TMP}/agent-facts.mjs"
  agent_exec "rm -rf ${REMOTE_DIR} && mkdir -p ${REMOTE_DIR} && chmod a+rwx ${REMOTE_DIR}"
  multipass transfer "${LOCAL_TMP}/agent-facts.mjs" "${AGENT_VM}:${REMOTE_DIR}/agent-facts.mjs"
}

# agent_facts <route> <service user> [<system package>...] — see write_agent_facts_probe
agent_facts() {
  local route="$1" user="$2"
  shift 2
  agent_exec "node ${REMOTE_DIR}/agent-facts.mjs ${route} ${user} ${AGENT_LABEL} $*" 2>/dev/null || echo '{}'
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
# Cleanup
# ---------------------------------------------------------------------------

# app_plugin_cleanup — what the specs' cleanup traps run, leaving both VMs as
# they were. The plugins in CLEAN_PLUGINS are uninstalled (a hosted one with
# purge: removing its agent half is a push, so the gates are opened again for
# it; an operation still running is waited for, up to three minutes). What
# may be left of the routes in CLEAN_ROUTES on the agent VM is purged with
# the helper directly. Then what the spec changed goes back: the push-install
# window, policy and switch, the panel's registry credential and .npmrc, the
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
  if [ -n "${NPMRC_WRITTEN}" ]; then
    timed_exec 30 multipass exec "${HOST_VM}" -- sudo bash -c "if [ -f ${STATE_NPMRC}.e2e-before ]; then mv -f ${STATE_NPMRC}.e2e-before ${STATE_NPMRC}; else rm -f ${STATE_NPMRC}; fi" > /dev/null 2>&1
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

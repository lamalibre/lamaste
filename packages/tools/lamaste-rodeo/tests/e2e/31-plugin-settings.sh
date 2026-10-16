#!/usr/bin/env bash
# ============================================================================
# 31 — Plugin settings: manifest refusals, the panel's checks, the agent half
# ============================================================================
# Slice 4 on one VM, with fixtures served by a stand-in registry on the VM
# (helpers.sh, write_settings_fixture_plugins):
# - a manifest's settings block is checked at install: settings without an
#   agent block, a default on a secret, a pattern that does not compile and
#   51 fields are each refused (400, naming the issue) and leave nothing; a
#   plugin without a settings block has none to read (404 no_settings)
# - installed but not hosted, the plugin shows its fields and refuses a
#   change (503 hosting_offline)
# - hosted, with its agent half on the relay loopback as spec 29 runs it
#   (write_app_plugin_half --manifest: Lamaste's createSettingsStore and
#   createSettingsHandler): GET settings is live; each rule of the panel's
#   checks refuses with a message per field that never repeats the value
#   (a setting the schema does not know is counted, never named), without a
#   call to the agent half; a pattern is refused by the agent half (422), a
#   stale revision with 409; a secret PUT from a 0600 file reads back as
#   { set: true } and the agent half proves it holds it by digest; its files
#   are 0600 and the secret is in secrets.json alone
# - /api/<route>/settings and everything under it is not forwarded (404)
# - the agent half stopped: a change is 502 (refused) until the health
#   monitor reports it down, then 503 hosting_offline while GET reads the
#   cache; an agent half without settings (its authenticated 404) is 502
#   settings_unsupported; back with its settings, it reloads its files and
#   changes are accepted
# - a squatter takes the agent half's port the moment it lets go — an
#   unprivileged process (nobody) answering 200 to everything, with a
#   forged X-Lamalibre-Responder, and logging every request: a settings
#   change carrying a new test secret, sent while the relay still believes
#   the hosting up, is 502 unauthenticated; the squatter got the secret
#   sealed, never in clear; health turns down (reason app) and a forwarded
#   page or the panel bundle is 502, never the squatter's answer; the agent
#   half back, it never saw that change
# - the relay keeps no secret: state.db (dumped), the journal since the
#   spec started, the files under /etc/lamalibre, /var/lib/lamalibre and
#   /opt/lamalibre, every answer read; uninstalling drops the cached settings
#
# The test secrets are made on the VM into 0600 files and only ever compared
# by digest or counted. Settings reaching an agent half Lamaste installed on
# another machine, through the tunnel, are three-VM spec 37; the hosting
# agent offline is spec 38; what systemd's socket leaves a squatter on the
# agent's side is spec 35.
# ============================================================================

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/helpers.sh"

require_commands curl jq node npm openssl sqlite3 runuser

begin_test "31 — Plugin settings: manifest refusals, the panel's checks, the agent half"

# The journal is scanned from here on.
SPEC_START=$(date +%s)

# ---------------------------------------------------------------------------
log_section "Pre-flight: check onboarding is complete"
# ---------------------------------------------------------------------------

ONBOARDING_STATUS=$(api_get "onboarding/status" | jq -r '.status' 2>/dev/null || echo "unknown")
if [ "$ONBOARDING_STATUS" != "COMPLETED" ]; then
  log_skip "Onboarding not completed — skipping plugin settings tests"
  end_test
  exit $?
fi
log_pass "Onboarding is complete"

DOMAIN=$(api_get "onboarding/status" | jq -r '.domain' 2>/dev/null || echo "null")
if [ -z "$DOMAIN" ] || [ "$DOMAIN" = "null" ]; then
  log_skip "No domain configured — skipping"
  end_test
  exit $?
fi
log_info "Domain: ${DOMAIN}"

STATE_DIR="/etc/lamalibre/lamaste"
WORK_DIR="/tmp/lamalibre-lamaste-e2e-settings"
PRIV="${WORK_DIR}/private"
STUB_PORT=4874
STUB_URL="http://127.0.0.1:${STUB_PORT}"
STUB_ADMIN_TOKEN="feria_e2eadmin_settings_0000000000000000"
PLUGIN="e2e-settings"
PACKAGE="@lamalibre/e2e-settings-server"
PLAIN_PLUGIN="e2e-app-plugin"
PLAIN_PACKAGE="@lamalibre/e2e-app-plugin-server"
AGENT_LABEL="e2e-cfghost-$(date +%s)"
AGENT_CERT_DIR="${WORK_DIR}/agent-cert"
HALF_CONFIG="${WORK_DIR}/plugin-config.json"
HALF_LOG="${WORK_DIR}/half.log"
HALF_DATA="${WORK_DIR}/half-data"
HALF_MANIFEST="${WORK_DIR}/fixtures/ok/lamaste-plugin.json"
LAMASTE_LIB="/opt/lamalibre/lamaste/serverd/node_modules/@lamalibre/lamaste"
PORT=""
# The squatter: an unprivileged account, a root-owned directory for its
# script and one of its own (0700) for the log of what it was sent
SQUATTER_USER="nobody"
SQUAT_DIR="/var/tmp/lamalibre-lamaste-e2e-squatter"
SQUAT_LOG="${SQUAT_DIR}/log/requests.ndjson"
SQUAT_MARK="e2e-squatter-7c41"

cleanup() {
  pkill -f '[a]pp-plugin-half.mjs' 2>/dev/null || true
  pkill -f '[s]quatter.mjs' 2>/dev/null || true
  rm -rf "${SQUAT_DIR}"
  # Uninstalling tears a hosting down first (an operation); one still
  # running refuses it until it ends.
  api_post "plugins/${PLUGIN}/disable" > /dev/null 2>&1 || true
  local deadline=$((SECONDS + 180)) name
  while [ "$SECONDS" -lt "$deadline" ] && [ "$(api_get_status "plugins/${PLUGIN}")" != "404" ]; do
    api_delete "plugins/${PLUGIN}?force=true" > /dev/null 2>&1 || true
    sleep 3
  done
  # Refused at install, so never there — unless a refusal regressed.
  for name in "${PLAIN_PLUGIN}" e2e-settings-noagent e2e-settings-secretdefault e2e-settings-badpattern e2e-settings-toomany; do
    api_delete "plugins/${name}?force=true" > /dev/null 2>&1 || true
  done
  api_delete "certs/agent/${AGENT_LABEL}" > /dev/null 2>&1 || true
  rm -f "${STATE_DIR}/.npmrc"
  pkill -f '[s]tub-registry.mjs' 2>/dev/null || true
  rm -rf "${WORK_DIR}"
}
trap cleanup EXIT

status_of() { printf '%s\n' "$1" | tail -n 1; }
body_of() { printf '%s\n' "$1" | sed '$d'; }
json_get() { echo "$1" | jq -r "$2" 2>/dev/null || echo ""; }

# settings_call <method> <api path> [<json> | @<file>] — one panel API call
# as the admin: the response, then its HTTP status on a line of its own.
# Every response is kept in PRIV/responses.log for the scan; one holding the
# test secret (PRIV/patterns) is never printed — a marker is.
settings_call() {
  local out status
  out=$(mktemp "${PRIV}/response.XXXXXXXX")
  if [ -n "${3:-}" ]; then
    if [ "${3#@}" = "$3" ]; then
      printf '%s' "$3" > "${PRIV}/body.json"
      set -- "$1" "$2" "@${PRIV}/body.json"
    fi
    status=$(_curl_mtls -o "$out" -w '%{http_code}' -X "$1" -H 'Content-Type: application/json' --data-binary "$3" "${BASE_URL}/api/$2" 2>/dev/null) || true
  else
    status=$(_curl_mtls -o "$out" -w '%{http_code}' -X "$1" "${BASE_URL}/api/$2" 2>/dev/null) || true
  fi
  [ -n "$status" ] || status="000"
  {
    printf '### %s %s %s\n' "$1" "$2" "$status"
    cat "$out"
    printf '\n'
  } >> "${PRIV}/responses.log"
  if [ -s "${PRIV}/patterns" ] && grep -qaF -f "${PRIV}/patterns" "$out"; then
    printf '{"redacted":"the response held the test secret"}\n'
  else
    cat "$out"
    printf '\n'
  fi
  printf '%s\n' "$status"
  rm -f "$out"
}

# secret_lines <file> — how many lines of the file hold the test secret
secret_lines() { grep -caF -f "${PRIV}/patterns" "$1" 2>/dev/null || true; }

# agent_api_get path / agent_api_post path json — as the test agent (its certificate)
agent_api_get() {
  curl -sk --max-time 30 --cert "${AGENT_CERT_DIR}/client.crt" --key "${AGENT_CERT_DIR}/client.key" --cacert "${STATE_DIR}/pki/ca.crt" -H 'Accept: application/json' "${BASE_URL}/api/$1"
}
agent_api_post() {
  curl -sk --max-time 30 --cert "${AGENT_CERT_DIR}/client.crt" --key "${AGENT_CERT_DIR}/client.key" --cacert "${STATE_DIR}/pki/ca.crt" -X POST -H 'Content-Type: application/json' -H 'Accept: application/json' -d "$2" "${BASE_URL}/api/$1"
}

# hosting_field jq-expr — a field of GET /api/plugins/<plugin>/hosting
hosting_field() {
  api_get "plugins/${PLUGIN}/hosting" | jq -r "$1" 2>/dev/null || echo ""
}

# wait_operation <operation id> <seconds> — prints the operation once it ended
# (still running after <seconds>: printed as is; the caller asserts its status)
wait_operation() {
  local id="$1" deadline=$((SECONDS + $2)) op='{}'
  while [ "$SECONDS" -lt "$deadline" ]; do
    op=$(api_get "plugins/${PLUGIN}/operations/${id}" | jq -c '.operation' 2>/dev/null || echo '{}')
    if [ "$(echo "$op" | jq -r '.status' 2>/dev/null)" != "running" ]; then
      echo "$op"
      return 0
    fi
    sleep 2
  done
  echo "$op"
  return 0
}

# wait_health <state> <seconds> — until the hosting's health.state is <state>
wait_health() {
  local want="$1" deadline=$((SECONDS + $2))
  while [ "$SECONDS" -lt "$deadline" ]; do
    if [ "$(hosting_field '.hosting.health.state')" = "$want" ]; then
      return 0
    fi
    sleep 3
  done
  return 1
}

# write_half_config <plugin-config json> — the file the agent would write
write_half_config() {
  echo "$1" | jq '. + {fetchedAt: (now | todate), acknowledged: false}' > "${HALF_CONFIG}.tmp"
  chmod 600 "${HALF_CONFIG}.tmp"
  mv "${HALF_CONFIG}.tmp" "${HALF_CONFIG}"
}

# start_half [plain] — (re)start the agent half on the config the agent
# fetched: with its settings store over HALF_DATA, or without settings
# ("plain"); waits until it refuses a bare call (401)
start_half() {
  local deadline
  pkill -f '[a]pp-plugin-half.mjs' 2>/dev/null || true
  deadline=$((SECONDS + 10))
  while [ "$SECONDS" -lt "$deadline" ] && [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "http://127.0.0.1:${PORT}/admin/health" 2>/dev/null)" != "000" ]; do
    sleep 1
  done
  if [ "${1:-}" = "plain" ]; then
    nohup node "${WORK_DIR}/app-plugin-half.mjs" --config "${HALF_CONFIG}" --plugin "${PLUGIN}" --lamaste "${LAMASTE_LIB}" --log "${HALF_LOG}" &> "${WORK_DIR}/half.out" &
  else
    nohup node "${WORK_DIR}/app-plugin-half.mjs" --config "${HALF_CONFIG}" --plugin "${PLUGIN}" --lamaste "${LAMASTE_LIB}" --log "${HALF_LOG}" \
      --manifest "${HALF_MANIFEST}" --data "${HALF_DATA}" &> "${WORK_DIR}/half.out" &
  fi
  deadline=$((SECONDS + 20))
  while [ "$SECONDS" -lt "$deadline" ]; do
    if [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "http://127.0.0.1:${PORT}/admin/health" 2>/dev/null)" = "401" ]; then
      return 0
    fi
    sleep 1
  done
  return 1
}

# refused <body json> <field> <message> <value or ""> <what> — PUT it: 400,
# <message> for <field>, and the value nowhere in the answer
refused() {
  local resp body
  resp=$(settings_call PUT "plugins/${PLUGIN}/settings" "$1")
  body=$(body_of "$resp")
  assert_eq "$(status_of "$resp")" "400" "$5: 400" || true
  assert_json_field "$body" ".errors[\"$2\"]" "$3" "…${2}: ${3}" || true
  if [ -n "$4" ]; then
    assert_not_contains "$body" "$4" "…without repeating the value" || true
  fi
}

# health_calls — how many of the relay's health probes the agent half has
# answered 200 (createHealthHandler's lines in its log)
health_calls() { grep -c 'GET /admin/health 200 health-call' "${HALF_LOG}" 2>/dev/null || true; }

# write_squatter <file> — squatter.mjs <port> <log> <mark>: what takes a
# loopback port the moment the agent half lets go of it, without the
# installation secret. It answers every request 200 with a body naming
# <mark> and an X-Lamalibre-Responder of the right shape it cannot have
# computed, and appends each request (method, path, body) to <log> (0600).
write_squatter() {
  cat > "$1" <<'SQUATTER_EOF'
import crypto from 'node:crypto';
import { appendFileSync } from 'node:fs';
import http from 'node:http';

const [port, log, mark] = process.argv.slice(2);
http
  .createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      appendFileSync(log, `${JSON.stringify({ method: req.method, url: req.url, body })}\n`, { mode: 0o600 });
      res.writeHead(200, {
        'content-type': 'application/json',
        // 32 bytes, base64url: a real one's length, no secret behind it
        'x-lamalibre-responder': crypto.randomBytes(32).toString('base64url'),
      });
      res.end(JSON.stringify({ ok: true, squatter: mark }));
    });
  })
  .listen(Number(port), '127.0.0.1');
SQUATTER_EOF
}

# start_squatter — SQUATTER_USER runs squatter.mjs on the agent half's port
# (free: the agent half was just stopped); waits until it answers (200)
start_squatter() {
  local node_bin
  node_bin=$(command -v node)
  nohup runuser -u "${SQUATTER_USER}" -- "${node_bin}" "${SQUAT_DIR}/squatter.mjs" "${PORT}" "${SQUAT_LOG}" "${SQUAT_MARK}" &> /dev/null &
  for _ in $(seq 1 50); do
    if [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 1 "http://127.0.0.1:${PORT}/" 2>/dev/null)" = "200" ]; then
      return 0
    fi
    sleep 0.2
  done
  return 1
}

# ===========================================================================
# 1. Stand-in registry with the fixtures; the test secret
# ===========================================================================

log_section "Stand-in registry with the settings fixtures; the test secret"

rm -rf "${WORK_DIR}"
mkdir -p "${WORK_DIR}" "${AGENT_CERT_DIR}" "${HALF_DATA}"
chmod 700 "${AGENT_CERT_DIR}" "${HALF_DATA}"
install -d -m 0700 "${PRIV}"
install -m 0600 /dev/null "${PRIV}/patterns"
write_stub_registry "${WORK_DIR}/stub-registry.mjs"
write_settings_fixture_plugins "${WORK_DIR}/fixtures"
write_app_plugin_fixture "${WORK_DIR}/fixtures/plain"
write_app_plugin_half "${WORK_DIR}/app-plugin-half.mjs"
pkill -f '[s]tub-registry.mjs' 2>/dev/null || true
nohup node "${WORK_DIR}/stub-registry.mjs" --port "${STUB_PORT}" --admin-token "${STUB_ADMIN_TOKEN}" --issuer "https://auth.${DOMAIN}" --audience "${STUB_URL}" --jwks-url http://127.0.0.1:9091/jwks.json \
  --package "${WORK_DIR}/fixtures/ok" --package "${WORK_DIR}/fixtures/noagent" --package "${WORK_DIR}/fixtures/secretdefault" \
  --package "${WORK_DIR}/fixtures/badpattern" --package "${WORK_DIR}/fixtures/toomany" --package "${WORK_DIR}/fixtures/plain" &> "${WORK_DIR}/stub.log" &
if wait_for_http "${STUB_URL}/-/ping" 30; then
  log_pass "Stand-in registry is up on ${STUB_URL}"
else
  log_fail "Stand-in registry did not start: $(cat "${WORK_DIR}/stub.log" 2>/dev/null)"
  end_test
  exit $?
fi
printf '@lamalibre:registry=%s/\n//127.0.0.1:%s/:_authToken=%s\n' "${STUB_URL}" "${STUB_PORT}" "${STUB_ADMIN_TOKEN}" > "${WORK_DIR}/npmrc"
install -o lamaste -g lamaste -m 0600 "${WORK_DIR}/npmrc" "${STATE_DIR}/.npmrc"

# The test secret: made here into a 0600 file, never in a variable or an argument.
(umask 077 && openssl rand -hex 24 > "${PRIV}/secret-a")
cat "${PRIV}/secret-a" >> "${PRIV}/patterns"
assert_eq "$(tr -d '\n' < "${PRIV}/secret-a" | wc -c | tr -d ' ')" "48" "Test secret A: 48 hex characters in a 0600 file" || true
DIGEST_A=$(tr -d '\n' < "${PRIV}/secret-a" | sha256sum | cut -c1-64)
(umask 077 && jq -c -n --rawfile k "${PRIV}/secret-a" '{revision: 0, values: {region: "eu"}, secrets: {apiKey: ($k | rtrimstr("\n"))}}' > "${PRIV}/put-a.json")

# ===========================================================================
# 2. Manifest refusals
# ===========================================================================

log_section "A manifest's settings block is checked at install"

for refusal in \
  "noagent|settings needs an agent block|settings without an agent block" \
  "secretdefault|A secret has no default|a default on a secret" \
  "badpattern|is not a valid regular expression|a pattern that does not compile" \
  "toomany|at most 50|51 fields"; do
  variant="${refusal%%|*}"
  rest="${refusal#*|}"
  issue="${rest%%|*}"
  what="${rest#*|}"
  name="e2e-settings-${variant}"
  RESP=$(settings_call POST "plugins/install" "{\"packageName\":\"@lamalibre/${name}-server\"}")
  assert_eq "$(status_of "$RESP")" "400" "Installing ${name} (${what}) is refused: 400" || true
  assert_contains "$(json_get "$(body_of "$RESP")" '.error')" "$issue" "…${issue}" || true
  assert_eq "$(api_get "plugins" | jq "[.plugins[] | select(.name == \"${name}\")] | length" 2>/dev/null || echo "-1")" "0" "…it is not in the registry" || true
  assert_eq "$(test -e "${STATE_DIR}/node_modules/@lamalibre/${name}-server" && echo "yes" || echo "no")" "no" "…and its package was removed" || true
done

PLAIN=$(api_post "plugins/install" "{\"packageName\":\"${PLAIN_PACKAGE}\"}")
assert_json_field "$PLAIN" '.ok' 'true' "${PLAIN_PACKAGE}, a plugin without settings, installed" || true
RESP=$(settings_call GET "plugins/${PLAIN_PLUGIN}/settings")
assert_eq "$(status_of "$RESP")" "404" "It has no settings to read (404)…" || true
assert_json_field "$(body_of "$RESP")" '.code' 'no_settings' "…no_settings" || true
api_post "plugins/${PLAIN_PLUGIN}/disable" > /dev/null 2>&1 || true
assert_eq "$(status_of "$(settings_call DELETE "plugins/${PLAIN_PLUGIN}")")" "200" "${PLAIN_PLUGIN}, never hosted, uninstalled at once" || true

# ===========================================================================
# 3. Installed, not hosted
# ===========================================================================

log_section "Installed but not hosted: the fields, no changes"

INSTALL=$(api_post "plugins/install" "{\"packageName\":\"${PACKAGE}\"}")
assert_json_field "$INSTALL" '.ok' 'true' "${PACKAGE} installed: an agent block and a settings block" || true
ENABLE=$(api_post "plugins/${PLUGIN}/enable")
assert_json_field "$ENABLE" '.status' 'enabled' "Plugin enabled" || true
RESP=$(settings_call GET "plugins/${PLUGIN}/settings")
assert_eq "$(status_of "$RESP")" "200" "GET /api/plugins/${PLUGIN}/settings answers before any hosting" || true
VIEW=$(body_of "$RESP")
assert_json_field "$VIEW" '.fields | map(.key) | join(",")' 'apiKey,schedule,retries,region,verbose' "…with the manifest's fields" || true
assert_json_field "$VIEW" '.source' 'none' "…and nothing synced yet (source none)" || true
assert_json_field "$VIEW" '"\(.configured) \(.missing | join(",")) \(.values.apiKey.set)"' 'false apiKey false' "…not configured: apiKey missing, not set" || true
RESP=$(settings_call PUT "plugins/${PLUGIN}/settings" '{"revision":0,"values":{"region":"eu"}}')
assert_eq "$(status_of "$RESP")" "503" "A change with no agent half to hold it is refused (503)" || true
assert_json_field "$(body_of "$RESP")" '.code' 'hosting_offline' "…hosting_offline" || true

# ===========================================================================
# 4. Hosted: the agent half on the relay loopback
# ===========================================================================

log_section "Hosted, the agent half on the relay loopback"

CERT_RESPONSE=$(api_post "certs/agent" "{\"label\":\"${AGENT_LABEL}\",\"capabilities\":[\"tunnels:read\"]}")
assert_json_field "$CERT_RESPONSE" '.ok' 'true' "Agent certificate issued for ${AGENT_LABEL}" || true
P12_PASS=$(echo "$CERT_RESPONSE" | jq -r '.p12Password' 2>/dev/null || echo "")
openssl pkcs12 -in "${STATE_DIR}/pki/agents/${AGENT_LABEL}/client.p12" -out "${AGENT_CERT_DIR}/client.crt" -clcerts -nokeys -passin pass:"${P12_PASS}" 2>/dev/null
openssl pkcs12 -in "${STATE_DIR}/pki/agents/${AGENT_LABEL}/client.p12" -out "${AGENT_CERT_DIR}/client.key" -nocerts -nodes -passin pass:"${P12_PASS}" 2>/dev/null
chmod 600 "${AGENT_CERT_DIR}/client.key"
unset P12_PASS

HOST_RESPONSE=$(api_post "plugins/${PLUGIN}/hosting" "{\"agentLabel\":\"${AGENT_LABEL}\"}")
assert_json_field "$HOST_RESPONSE" '.operation.kind' 'host' "Hosting on ${AGENT_LABEL} started" || log_info "The panel answered: ${HOST_RESPONSE}"
HOST_OP_ID=$(echo "$HOST_RESPONSE" | jq -r '.operation.id // empty' 2>/dev/null || echo "")
# What the agent's sync does: fetch the plugin config, acknowledge it, start
# the agent half — here on the relay loopback, as in spec 29.
PLUGIN_CONFIG="{}"
for _ in $(seq 1 60); do
  PLUGIN_CONFIG=$(agent_api_get "agents/me/plugin-config/${PLUGIN}" 2>/dev/null || echo '{}')
  if [ -n "$(echo "$PLUGIN_CONFIG" | jq -r '.port // empty' 2>/dev/null)" ]; then break; fi
  sleep 1
done
PORT=$(echo "$PLUGIN_CONFIG" | jq -r '.port // empty' 2>/dev/null || echo "")
write_half_config "$PLUGIN_CONFIG"
ACK=$(agent_api_post "agents/me/plugin-config/${PLUGIN}/ack" "{\"issuedAt\":\"$(echo "$PLUGIN_CONFIG" | jq -r '.issuedAt' 2>/dev/null)\"}")
assert_json_field "$ACK" '.acknowledged' 'true' "The agent fetched and acknowledged the plugin config (port ${PORT})" || true
if start_half; then
  log_pass "The agent half listens on 127.0.0.1:${PORT}, with its settings store"
else
  log_fail "The agent half did not start: $(cat "${WORK_DIR}/half.out" 2>/dev/null)"
fi
HOST_OP=$(wait_operation "${HOST_OP_ID}" 180)
assert_json_field "$HOST_OP" '.status' 'succeeded' "The hosting operation succeeded" || true
if wait_health up 45; then
  log_pass "Health is up"
else
  log_fail "Health did not reach up: $(hosting_field '.hosting.health')"
fi

RESP=$(settings_call GET "plugins/${PLUGIN}/settings")
VIEW=$(body_of "$RESP")
assert_json_field "$VIEW" '"\(.source) \(.hosting.agentLabel) \(.hosting.state)"' "live ${AGENT_LABEL} up" "GET settings: live from the agent half on ${AGENT_LABEL}, up" || true
assert_json_field "$VIEW" '"\(.revision) \(.configured) \(.missing | join(","))"' '0 false apiKey' "Revision 0, not configured, apiKey missing" || true
assert_json_field "$VIEW" '.values | "\(.schedule) \(.retries) \(.verbose) \(.region // "unset")"' '06:00 3 false unset' "The defaults (region has none)" || true
assert_contains "$(cat "${HALF_LOG}" 2>/dev/null)" "GET /admin/settings 200 settings-call" "The relay read them from the agent half with Lamaste's own caller assertion" || true
LISTED=$(api_get "plugins" | jq -c ".plugins[] | select(.name == \"${PLUGIN}\") | .settings" 2>/dev/null || echo "null")
assert_json_field "$LISTED" '"\(.configured) \(.missing | join(","))"' 'false apiKey' "GET /api/plugins: needs configuration (apiKey)" || true
PROBE=$(body_of "$(settings_call GET "${PLUGIN}/probe/settings")")
assert_json_field "$PROBE" '"\(.schemaVersion) \(.revision) \(.secretDigests | length)"' '1 0 0' "The agent half: schema 1, revision 0, no secret" || true

# ===========================================================================
# 5. The panel's checks
# ===========================================================================

log_section "The panel's checks: a message per field, never the value"

HALF_PUTS=$(grep -c 'PUT /admin/settings' "${HALF_LOG}" 2>/dev/null || true)
LONG="e2e-long-$(printf 'y%.0s' $(seq 1 1016))"
RESP=$(settings_call PUT "plugins/${PLUGIN}/settings" '{"revision":0,"values":{"e2e-colour-1a2b":"e2e-unknown-3c4e"}}')
assert_eq "$(status_of "$RESP")" "400" "An unknown setting: 400" || true
assert_json_field "$(body_of "$RESP")" '.errors | to_entries | map("\(.key)=\(.value)") | join(",")' '_=1 unknown setting' "…counted under _ (1 unknown setting), never named" || true
assert_not_contains "$(body_of "$RESP")" "e2e-colour-1a2b" "…the answer holds neither its name…" || true
assert_not_contains "$(body_of "$RESP")" "e2e-unknown-3c4e" "…nor its value" || true
refused '{"revision":0,"values":{"apiKey":"e2e-misplaced-3c4d"}}' apiKey 'Is a secret; send it in secrets' 'e2e-misplaced-3c4d' "A secret among the values"
refused '{"revision":0,"secrets":{"region":"e2e-misplaced-5e6f"}}' region 'Is not a secret; send it in values' 'e2e-misplaced-5e6f' "A value among the secrets"
refused '{"revision":0,"values":{"retries":987654321}}' retries 'Must be at most 10' '987654321' "An integer above its maximum"
refused '{"revision":0,"values":{"retries":-7654321}}' retries 'Must be at least 0' '7654321' "An integer below its minimum"
refused '{"revision":0,"values":{"retries":"e2e-nan-7a8b"}}' retries 'Must be an integer' 'e2e-nan-7a8b' "A string for an integer"
refused '{"revision":0,"values":{"region":"e2e-region-9c0d"}}' region 'Must be one of the options' 'e2e-region-9c0d' "A value that is not one of the options"
refused '{"revision":0,"values":{"verbose":"e2e-yes-1e2f"}}' verbose 'Must be true or false' 'e2e-yes-1e2f' "A string for a boolean"
refused "{\"revision\":0,\"values\":{\"schedule\":\"${LONG}\"}}" schedule 'Must be at most 1024 characters' 'e2e-long-' "A string over its maximum length"
refused '{"revision":0,"secrets":{"apiKey":""}}' apiKey 'Must not be empty' '' "An empty secret"
refused '{"revision":0,"secrets":{"apiKey":null}}' apiKey 'Is required' '' "Clearing a required secret"
RESP=$(settings_call PUT "plugins/${PLUGIN}/settings" '{"revision":0,"values":["e2e-envelope-3a4b"]}')
assert_eq "$(status_of "$RESP")" "400" "values that are not an object: 400" || true
assert_not_contains "$(body_of "$RESP")" "e2e-envelope-3a4b" "…without repeating them" || true
assert_eq "$(status_of "$(settings_call PUT "plugins/${PLUGIN}/settings" '{"values":{"region":"eu"}}')")" "400" "An update without the revision it was edited at: 400" || true
assert_eq "$(grep -c 'PUT /admin/settings' "${HALF_LOG}" 2>/dev/null || true)" "${HALF_PUTS:-0}" "The agent half was never asked" || true

RESP=$(settings_call PUT "plugins/${PLUGIN}/settings" '{"revision":0,"values":{"schedule":"e2e-schedule-5f6a"}}')
assert_eq "$(status_of "$RESP")" "422" "A schedule against its pattern passes the panel, which never runs a manifest's pattern, and is refused by the agent half (422)" || true
assert_json_field "$(body_of "$RESP")" '.errors.schedule' 'Does not match the required format' "…schedule: Does not match the required format" || true
assert_not_contains "$(body_of "$RESP")" "e2e-schedule-5f6a" "…without repeating the value" || true
assert_eq "$(grep -c 'PUT /admin/settings 422 settings-call' "${HALF_LOG}" 2>/dev/null || true)" "1" "The agent half answered that one" || true

# ===========================================================================
# 6. A secret round-trips
# ===========================================================================

log_section "A secret round-trips to { set: true }; the agent half holds it"

RESP=$(settings_call PUT "plugins/${PLUGIN}/settings" "@${PRIV}/put-a.json")
rm -f "${PRIV}/put-a.json"
assert_eq "$(status_of "$RESP")" "200" "PUT with secret A, from a 0600 file: 200" || true
VIEW=$(body_of "$RESP")
assert_json_field "$VIEW" '"\(.revision) \(.configured) \(.missing | length)"' '1 true 0' "Revision 1, configured" || true
assert_json_field "$VIEW" '.values.apiKey | keys | join(",")' 'set,setAt' "apiKey: when it was set, nothing else" || true
SET_AT_A=$(json_get "$VIEW" '.values.apiKey.setAt // empty')
VIEW=$(body_of "$(settings_call GET "plugins/${PLUGIN}/settings")")
assert_json_field "$VIEW" '"\(.source) \(.values.apiKey.set) \(.values.apiKey.setAt) \(.values.region)"' "live true ${SET_AT_A} eu" "GET: apiKey { set: true, setAt }, region eu" || true
PROBE=$(body_of "$(settings_call GET "${PLUGIN}/probe/settings")")
assert_json_field "$PROBE" '.secretDigests.apiKey' "${DIGEST_A}" "The agent half holds secret A: the SHA-256 of what it holds is secret A's" || true
assert_json_field "$PROBE" '"\(.revision) \(.configured)"' '1 true' "…at revision 1, configured" || true
assert_eq "$(stat -c '%a' "${HALF_DATA}/settings.json" "${HALF_DATA}/secrets.json" 2>/dev/null | tr '\n' ' ')" "600 600 " "settings.json and secrets.json are 0600" || true
assert_eq "$(secret_lines "${HALF_DATA}/secrets.json")" "1" "The secret is in secrets.json…" || true
assert_eq "$(secret_lines "${HALF_DATA}/settings.json")" "0" "…not in settings.json" || true
assert_eq "$(secret_lines "${HALF_LOG}")" "0" "…nor in the agent half's log" || true
RESP=$(settings_call PUT "plugins/${PLUGIN}/settings" '{"revision":0,"values":{"verbose":true}}')
assert_eq "$(status_of "$RESP")" "409" "An update edited at revision 0, now 1: 409" || true
assert_json_field "$(body_of "$RESP")" '"\(.code) \(.revision)"' 'revision_mismatch 1' "…revision_mismatch, with the current revision" || true
AUDIT=$(api_get "audit?plugin=${PLUGIN}&action=plugin.settings.updated&limit=20" | jq -c '.entries[0].details // {}' 2>/dev/null || echo '{}')
assert_json_field "$AUDIT" '"\(.secretsSet | join(",")) \(.changed | join(","))"' 'apiKey region' "Audit: plugin.settings.updated names the keys (secretsSet apiKey, changed region)" || true

# ===========================================================================
# 7. The reservation
# ===========================================================================

log_section "/api/${PLUGIN}/settings is not forwarded"

MARK=$(wc -l < "${HALF_LOG}" | tr -d ' ')
# Every spelling whose second segment, decoded (twice here), lower-cased and
# kept to letters and digits, starts with settings or hooks.
for reserved in settings settings/reload Settings %73ettings %2573ettings settings-v2 hooks Hooks/install:pre-tunnel; do
  assert_eq "$(api_get_status "${PLUGIN}/${reserved}")" "404" "GET /api/${PLUGIN}/${reserved}: 404" || true
done
assert_eq "$(status_of "$(settings_call PUT "${PLUGIN}/settings" '{"schemaVersion":1,"baseRevision":1,"values":{"verbose":true},"secrets":{}}')")" "404" "PUT /api/${PLUGIN}/settings: 404 — no admin writes around the panel's checks" || true
assert_eq "$(status_of "$(settings_call POST "${PLUGIN}/settings/reload" '{}')")" "404" "POST /api/${PLUGIN}/settings/reload: 404" || true
REACHED=$(tail -n +$((MARK + 1)) "${HALF_LOG}" | grep -iE '/admin/(settings|%73ettings|%2573ettings|hooks)' | grep -vc ' 200 settings-call$' || true)
assert_eq "$REACHED" "0" "The agent half saw none of them" || true
assert_json_field "$(body_of "$(settings_call GET "${PLUGIN}/probe/settings")")" '.revision' '1' "Its other admin paths are forwarded as before, and nothing changed" || true

# ===========================================================================
# 8. The agent half stopped, without settings, back
# ===========================================================================

log_section "The agent half stopped, then without settings, then back"

pkill -f '[a]pp-plugin-half.mjs' 2>/dev/null || true
sleep 1
RESP=$(settings_call PUT "plugins/${PLUGIN}/settings" '{"revision":1,"values":{"verbose":true}}')
assert_eq "$(status_of "$RESP")" "502" "Until the health monitor notices, a change reaches a closed port: 502" || true
assert_json_field "$(body_of "$RESP")" '.code' 'refused' "…refused" || true
if wait_health down 60; then
  log_pass "Health reports down"
else
  log_fail "Health did not report down: $(hosting_field '.hosting.health')"
fi
RESP=$(settings_call GET "plugins/${PLUGIN}/settings")
assert_eq "$(status_of "$RESP")" "200" "GET settings still answers" || true
VIEW=$(body_of "$RESP")
assert_json_field "$VIEW" '"\(.source) \(.hosting.state)"' 'cache down' "…from the cache, the hosting down" || true
assert_json_field "$VIEW" '"\(.configured) \(.values.region) \(.values.apiKey.set) \(.revision)"' 'true eu true 1' "…as last synced: configured, region eu, apiKey set, revision 1" || true
RESP=$(settings_call PUT "plugins/${PLUGIN}/settings" '{"revision":1,"values":{"verbose":true}}')
assert_eq "$(status_of "$RESP")" "503" "Health down: a change is refused (503)" || true
assert_json_field "$(body_of "$RESP")" '.code' 'hosting_offline' "…hosting_offline" || true

if start_half plain && wait_health up 60; then
  log_pass "An agent half without settings answers; health is up"
else
  log_fail "The agent half without settings did not come up: $(hosting_field '.hosting.health')"
fi
RESP=$(settings_call PUT "plugins/${PLUGIN}/settings" '{"revision":1,"values":{"verbose":true}}')
assert_eq "$(status_of "$RESP")" "502" "An agent half that does not answer /admin/settings: 502" || true
assert_json_field "$(body_of "$RESP")" '.code' 'settings_unsupported' "…settings_unsupported" || true

if start_half; then
  log_pass "The agent half is back with its settings store"
else
  log_fail "The agent half did not start: $(cat "${WORK_DIR}/half.out" 2>/dev/null)"
fi
wait_health up 45 || true
RESP=$(settings_call PUT "plugins/${PLUGIN}/settings" '{"revision":1,"values":{"verbose":true}}')
assert_eq "$(status_of "$RESP")" "200" "A change is accepted again" || true
assert_json_field "$(body_of "$RESP")" '"\(.revision) \(.values.verbose) \(.values.apiKey.setAt)"' "2 true ${SET_AT_A}" "…revision 2: the agent half reloaded its files, secret A kept" || true
PROBE=$(body_of "$(settings_call GET "${PLUGIN}/probe/settings")")
assert_json_field "$PROBE" '.secretDigests.apiKey' "${DIGEST_A}" "The agent half holds secret A…" || true
assert_json_field "$PROBE" '.values.verbose' 'true' "…and verbose true" || true

# ===========================================================================
# 9. A squatter on the agent half's port
# ===========================================================================

log_section "A squatter on the agent half's port gets nothing and serves nothing"

# Test secret S, for the change the squatter will be sent.
(umask 077 && openssl rand -hex 24 > "${PRIV}/secret-s")
cat "${PRIV}/secret-s" >> "${PRIV}/patterns"
(umask 077 && jq -c -n --rawfile k "${PRIV}/secret-s" '{revision: 2, values: {verbose: false}, secrets: {apiKey: ($k | rtrimstr("\n"))}}' > "${PRIV}/put-s.json")
rm -rf "${SQUAT_DIR}"
install -d -m 0755 "${SQUAT_DIR}"
install -d -m 0700 -o "${SQUATTER_USER}" "${SQUAT_DIR}/log"
write_squatter "${SQUAT_DIR}/squatter.mjs"
chmod 0644 "${SQUAT_DIR}/squatter.mjs"
if wait_health up 45; then
  log_pass "Health is up: the relay sends changes to the hosting"
else
  log_fail "Health is not up before the squatter: $(hosting_field '.hosting.health')"
fi

# Timing: the health monitor probes every 10 s and reports down after three
# failed probes in a row. The agent half is stopped right after a probe it
# answered, so the squatter's answers can turn health down no sooner than
# the third probe after it, ~30 s later (20 s at the very least). The change
# goes out within a few seconds of the squatter taking the port — while the
# relay still holds the hosting up and sends it: the moment a squatter could
# have been handed a secret.
CALLS=$(health_calls)
deadline=$((SECONDS + 15))
while [ "$SECONDS" -lt "$deadline" ] && [ "$(health_calls)" -le "${CALLS:-0}" ]; do
  sleep 1
done
pkill -f '[a]pp-plugin-half.mjs' 2>/dev/null || true
TOOK_AT=$SECONDS
if start_squatter; then
  log_pass "Right after a health probe the agent half answered, it stopped and ${SQUATTER_USER} took port ${PORT}"
else
  log_fail "The squatter did not take port ${PORT}"
fi
RESP=$(settings_call PUT "plugins/${PLUGIN}/settings" "@${PRIV}/put-s.json")
SENT_AFTER=$((SECONDS - TOOK_AT))
rm -f "${PRIV}/put-s.json"
if [ "$(status_of "$RESP")" = "503" ]; then
  log_info "503: health was down already, ${SENT_AFTER}s after the squatter took the port — this section needs the change sent well within 20 s of it"
fi
assert_eq "$(status_of "$RESP")" "502" "A settings change with secret S, sent ${SENT_AFTER}s after the squatter took the port, health still up: 502" || true
assert_json_field "$(body_of "$RESP")" '.code' 'unauthenticated' "…unauthenticated: the answer could not prove it was the agent half's" || true
RESP=$(settings_call GET "${PLUGIN}/ping")
assert_eq "$(status_of "$RESP")" "502" "A forwarded page request (/api/${PLUGIN}/ping): 502…" || true
assert_json_field "$(body_of "$RESP")" '.reason' 'app' "…reason app…" || true
assert_not_contains "$(body_of "$RESP")" "${SQUAT_MARK}" "…never the squatter's answer" || true
RESP=$(settings_call GET "${PLUGIN}/panel.js")
assert_eq "$(status_of "$RESP")" "502" "The plugin's panel bundle (/api/${PLUGIN}/panel.js): 502…" || true
assert_not_contains "$(body_of "$RESP")" "${SQUAT_MARK}" "…not the squatter's content" || true

# What the squatter was sent, as counts: never a body.
SQUATTED=$(jq -s -c '[.[] | select(.method == "PUT" and .url == "/admin/settings")] as $puts | {puts: ($puts | length), sealed: [$puts[] | (.body | fromjson? // {}) | .secrets.apiKey | select(type == "object" and .v == 1 and (.iv | type) == "string" and (.ct | type) == "string")] | length, pings: [.[] | select(.url | startswith("/admin/ping"))] | length, bundles: [.[] | select(.url == "/admin/panel.js")] | length}' "${SQUAT_LOG}" 2>/dev/null || echo '{}')
assert_json_field "$SQUATTED" '"\(.pings) \(.bundles)"' '1 1' "The forwarder did send the squatter the page and the bundle requests — and refused its answers" || true
assert_json_field "$SQUATTED" '.puts' '1' "The relay sent the squatter the settings change…" || true
assert_json_field "$SQUATTED" '.sealed' '1' "…with secret S sealed ({ v, iv, ct }: AES-256-GCM under the installation secret)…" || true
assert_eq "$(stat -c '%a %U' "${SQUAT_LOG}" 2>/dev/null || echo "")" "600 ${SQUATTER_USER}" "(the squatter's log: 0600, ${SQUATTER_USER}'s)" || true
assert_eq "$(secret_lines "${SQUAT_LOG}")" "0" "…and secret S (or A) in clear nowhere in what it received" || true

if wait_health down 45; then
  log_pass "Health reports down: the squatter's answers to the probe do not authenticate"
else
  log_fail "Health did not report down: $(hosting_field '.hosting.health')"
fi
assert_eq "$(hosting_field '.hosting.health.reason')" "app" "…reason app: something answers on the port, not the agent half" || true

pkill -f '[s]quatter.mjs' 2>/dev/null || true
if start_half && wait_health up 45; then
  log_pass "The squatter gone, the agent half is back and health up"
else
  log_fail "The agent half did not come back: $(hosting_field '.hosting.health')"
fi
PROBE=$(body_of "$(settings_call GET "${PLUGIN}/probe/settings")")
assert_json_field "$PROBE" '"\(.revision) \(.values.verbose)"' '2 true' "The change the squatter was sent never reached the agent half: revision 2, verbose true…" || true
assert_json_field "$PROBE" '.secretDigests.apiKey' "${DIGEST_A}" "…and it holds secret A, not S" || true

# ===========================================================================
# 10. The relay keeps no secret
# ===========================================================================

log_section "The relay keeps no secret"

for path in plugins "plugins/${PLUGIN}" "plugins/${PLUGIN}/settings" "plugins/${PLUGIN}/hosting" "plugins/${PLUGIN}/operations" \
  "audit?plugin=${PLUGIN}&limit=200" "audit?limit=200" "notifications?limit=200" "${PLUGIN}/probe/settings"; do
  settings_call GET "$path" > /dev/null
done
runuser -u lamaste -- sqlite3 -readonly "${STATE_DIR}/state.db" .dump > "${PRIV}/state.sql" 2>/dev/null || true
assert_eq "$(secret_lines "${PRIV}/state.sql")" "0" "state.db, dumped ($(wc -l < "${PRIV}/state.sql" | tr -d ' ') lines), holds no secret" || true
assert_eq "$(grep -q 'plugin_settings' "${PRIV}/state.sql" 2>/dev/null && echo "yes" || echo "no")" "yes" "…the dump holds plugin_settings" || true
journalctl --since "@${SPEC_START}" --no-pager -o cat > "${PRIV}/journal.txt" 2>/dev/null || true
assert_eq "$(secret_lines "${PRIV}/journal.txt")" "0" "The journal since the spec started ($(wc -l < "${PRIV}/journal.txt" | tr -d ' ') lines) holds none" || true
FILES=$(grep -rlaF --devices=skip -f "${PRIV}/patterns" /etc/lamalibre /var/lib/lamalibre /opt/lamalibre 2>/dev/null | wc -l | tr -d ' ')
assert_eq "$FILES" "0" "No file under /etc/lamalibre, /var/lib/lamalibre or /opt/lamalibre holds it" || true
assert_eq "$(secret_lines "${PRIV}/responses.log")" "0" "No answer read holds it ($(grep -c '^### ' "${PRIV}/responses.log") answers, the audit log among them)" || true
# Keys and counts only: a secret the relay wrongly cached is not printed here.
ROW=$(runuser -u lamaste -- sqlite3 -readonly -json "${STATE_DIR}/state.db" "SELECT revision, configured, (SELECT group_concat(key) FROM json_each(secrets_set_json)) AS secretKeys, (SELECT count(*) FROM json_each(secrets_set_json) WHERE value GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*') AS setAtTimestamps FROM plugin_settings WHERE plugin = '${PLUGIN}'" 2>/dev/null | jq -c '.[0] // {}' 2>/dev/null || echo "")
[ -n "$ROW" ] || ROW='{}'
assert_json_field "$ROW" '"\(.revision) \(.configured) \(.secretKeys) \(.setAtTimestamps)"' '2 1 apiKey 1' "The relay's cache (plugin_settings): revision 2, configured, and only when apiKey was set" || true
rm -f "${PRIV}/state.sql" "${PRIV}/journal.txt"

# ===========================================================================
# 11. Uninstall
# ===========================================================================

log_section "Uninstalling drops the cached settings"

api_post "plugins/${PLUGIN}/disable" > /dev/null
UNINSTALL=$(api_delete "plugins/${PLUGIN}")
UNINSTALL_OP=$(wait_operation "$(echo "$UNINSTALL" | jq -r '.operation.id // empty' 2>/dev/null)" 120)
assert_json_field "$UNINSTALL_OP" '.status' 'succeeded' "Plugin uninstalled" || true
assert_eq "$(api_get_status "plugins/${PLUGIN}/settings")" "404" "GET settings: 404" || true
LEFT=$(runuser -u lamaste -- sqlite3 -readonly "${STATE_DIR}/state.db" "SELECT count(*) FROM plugin_settings WHERE plugin = '${PLUGIN}'" 2>/dev/null || echo "?")
assert_eq "$LEFT" "0" "No plugin_settings row left" || true

end_test

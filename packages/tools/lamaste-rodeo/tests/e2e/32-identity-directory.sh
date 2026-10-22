#!/usr/bin/env bash
# ============================================================================
# 32 — Identity: the user directory, entitlements and the approval gate
# ============================================================================
# Slice 6 on one VM, with fixtures served by a stand-in registry on the VM
# (helpers.sh, write_identity_fixture_plugins) and the agent half of
# e2e-ident on the relay loopback, as spec 31 runs one
# (write_app_plugin_half --identity-db):
# - every user has a directory id (a UUID v4) and a status; the ids and the
#   directory's own id are the same after the panel restarts
# - a manifest's identity block is checked at install: on a server-hosted
#   plugin, on an agent-hosted one without an agent block, a role id that
#   is not one and an attribute outside displayName/email are each refused
#   (400, naming the issue) and leave nothing
# - the approval gate: a plugin without identity needs no approval (no
#   digest); the update that adds identity waits for an administrator
#   (digest.unapproved, identity.changed); with auto-approve on, a role
#   added and an attribute widened still wait (identity.changed, the
#   withholding audited), while narrowing the attributes with a label edit
#   only changes the digest — auto-approved
# - hosted and approved, the plugin is ready only once its agent half's
#   first complete sync ended at the head of its audience (answering
#   protocol 1 is not enough), and the half follows the panel's directory
# - entitlements: a role the plugin does not declare is refused (400
#   unknown_roles, through the plugin's entitlements and the Gatekeeper
#   proxy alike); a plugin grant without roles makes no one a member; a
#   user's roles are their own and their groups' — and the plugin receives
#   only the attributes it declares
# - disable and enable: Authelia's first factor refuses a disabled user and
#   takes them back once enabled; the audience shows them disabled; the last
#   enabled administrator cannot be disabled (400 last_admin)
# - delete: a tombstone in the directory keeping the id, the name and the
#   address; every Gatekeeper grant of the username and its group
#   memberships gone; the audience and the agent half's projection say
#   removed/deleted with the last display name; while nobody holds the
#   username nothing is given to it — a grant, a group membership or an
#   entitlement is 409 username_deleted
# - the same username created again is a new user (a new id) with no roles
# - a username Authelia holds an OpenID Connect opaque identifier for (added
#   with Authelia's own CLI, as a first sign-in to a relying party leaves
#   one) is never given to a new user: 409 username_has_oidc_identity, and
#   lamaste-priv's check says yes for it, no for a username without one
# - erase: an active user is not erased (409); Gatekeeper refuses a
#   DELETE /api/access-log that carries a query (400 — a purge of one
#   user's rows is POST /api/access-log/purge, the username in the body,
#   and never clears everything); the tombstone is scrubbed to the bare id,
#   Gatekeeper's access-request log loses the removed user's rows (not the
#   later holder's), the plugin is told remove/erased, its
#   anonymiser runs, the erasure stops pending once its cursor passed it,
#   and a second erasure is refused
# - the admin forwarder reserves /admin/identity* however it is spelled
#   (404, the agent half never asked) and never reaches /admin/app*
#   (/api/<route>/app is the user surface's: 401 without a relay assertion)
# - a client-sent X-Lamalibre-Relay-Assertion never passes the panel vhost:
#   a valid one sent with the admin certificate is 401, while the same
#   assertion, sent to the panel's loopback listener directly, is accepted
#   (404: no host serves the route) — and refused when replayed
#
# Users reaching an agent half through a bound host (Gatekeeper, a visitor's
# session) and the feed through a real tunnel are three-VM specs 40 and 39;
# an erasure reaching data an agent kept across an uninstall, and a sticky
# erasure, are three-VM spec 41.
# ============================================================================

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/helpers.sh"

require_commands curl jq node npm openssl sqlite3 runuser systemd-run

begin_test "32 — Identity: the user directory, entitlements and the approval gate"

# ---------------------------------------------------------------------------
log_section "Pre-flight: check onboarding is complete"
# ---------------------------------------------------------------------------

ONBOARDING_STATUS=$(api_get "onboarding/status" | jq -r '.status' 2>/dev/null || echo "unknown")
if [ "$ONBOARDING_STATUS" != "COMPLETED" ]; then
  log_skip "Onboarding not completed — skipping identity tests"
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
WORK_DIR="/tmp/lamalibre-lamaste-e2e-identity"
STUB_PORT=4874
STUB_URL="http://127.0.0.1:${STUB_PORT}"
STUB_ADMIN_TOKEN="feria_e2eadmin_identity_00000000000000"
# Transient units (systemd-run) for what runs in the background
STUB_UNIT="lamalibre-lamaste-e2e-32-stub"
HALF_UNIT="lamalibre-lamaste-e2e-32-half"
PLUGIN="e2e-ident"
PACKAGE="@lamalibre/e2e-ident-server"
AGENT_LABEL="e2e-idhost-$(date +%s)"
AGENT_CERT_DIR="${WORK_DIR}/agent-cert"
HALF_CONFIG="${WORK_DIR}/plugin-config.json"
HALF_LOG="${WORK_DIR}/half.log"
HALF_DB="${WORK_DIR}/half-data/identity.db"
LAMASTE_LIB="/opt/lamalibre/lamaste/serverd/node_modules/@lamalibre/lamaste"
GATEKEEPER_DB="${STATE_DIR}/gatekeeper.db"
USER_A="e2e32-alice"
# A test credential for this run only: alice signs in once, at the first factor
USER_A_PASSWORD="E2e-$(openssl rand -hex 12)"
GROUP="e2e32-team"
# A username an OpenID Connect identity is added for: never usable again on
# this VM (Authelia cannot delete an opaque identifier), so a new one each run
USER_O="e2e32-oidc-$(date +%s)"
TUNNEL_RESOURCE="e2e32-tunnel-0001"
AUTH_RESOLVE="--resolve auth.${DOMAIN}:443:127.0.0.1"
# Marks the requests the forwarder must never pass on (their query)
MARK="e2e32mark$(date +%s)"
UUID_RE='^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
PORT=""
ALICE_ID=""
NEW_ALICE_ID=""
ROLELESS_GRANT_ID=""
TUNNEL_GRANT_ID=""

cleanup() {
  systemctl stop "${HALF_UNIT}" "${STUB_UNIT}" > /dev/null 2>&1 || true
  # Gatekeeper's grants and group outlive the plugin: every grant on it (an
  # interrupted run's would make someone a member of the next run's audience)
  local gid
  for gid in $(api_get "gatekeeper/grants?resourceType=plugin&resourceId=${PLUGIN}" | jq -r '.grants[]?.grantId // empty' 2>/dev/null || true); do
    api_delete "gatekeeper/grants/${gid}" > /dev/null 2>&1 || true
  done
  if [ -n "${TUNNEL_GRANT_ID}" ]; then api_delete "gatekeeper/grants/${TUNNEL_GRANT_ID}" > /dev/null 2>&1 || true; fi
  api_delete "gatekeeper/groups/${GROUP}" > /dev/null 2>&1 || true
  # Alice, whatever state the spec left her in: deleted and erased.
  api_delete "users/${USER_A}?erase=true" > /dev/null 2>&1 || true
  local id
  for id in ${ALICE_ID} ${NEW_ALICE_ID}; do
    api_post "identity/directory/${id}/erase" > /dev/null 2>&1 || true
  done
  # Uninstalling tears a hosting down first (an operation); one still
  # running refuses it until it ends.
  api_post "plugins/${PLUGIN}/disable" > /dev/null 2>&1 || true
  local deadline=$((SECONDS + 180)) name
  while [ "$SECONDS" -lt "$deadline" ] && [ "$(api_get_status "plugins/${PLUGIN}")" != "404" ]; do
    api_delete "plugins/${PLUGIN}?force=true" > /dev/null 2>&1 || true
    sleep 3
  done
  # Refused at install, so never there — unless a refusal regressed.
  for name in e2e-ident-serverhosted e2e-ident-noagent e2e-ident-badrole e2e-ident-badattr; do
    api_delete "plugins/${name}?force=true" > /dev/null 2>&1 || true
  done
  api_delete "certs/agent/${AGENT_LABEL}" > /dev/null 2>&1 || true
  rm -f "${STATE_DIR}/.npmrc"
  rm -rf "${WORK_DIR}"
}
trap cleanup EXIT

status_of() { printf '%s\n' "$1" | tail -n 1; }
body_of() { printf '%s\n' "$1" | sed '$d'; }
json_get() { echo "$1" | jq -r "$2" 2>/dev/null || echo ""; }

# call <method> <api path> [<json>] — one panel API call as the admin: the
# body, then the HTTP status on a line of its own
call() {
  if [ -n "${3:-}" ]; then
    _curl_mtls -X "$1" -H 'Content-Type: application/json' -d "$3" -w '\n%{http_code}' "${BASE_URL}/api/$2" 2>/dev/null || true
  else
    _curl_mtls -X "$1" -w '\n%{http_code}' "${BASE_URL}/api/$2" 2>/dev/null || true
  fi
}

# users_call <method> <api path> [<json>] — call, waiting out the users
# API's rate limit (5 creations or updates a minute): retried on 429
users_call() {
  local out deadline=$((SECONDS + 75))
  while :; do
    out=$(call "$@")
    if [ "$(status_of "$out")" != "429" ] || [ "$SECONDS" -ge "$deadline" ]; then
      echo "$out"
      return 0
    fi
    sleep 15
  done
}

# agent_api_get path / agent_api_post path json — as the test agent (its certificate)
agent_api_get() {
  curl -sk --max-time 30 --cert "${AGENT_CERT_DIR}/client.crt" --key "${AGENT_CERT_DIR}/client.key" --cacert "${STATE_DIR}/pki/ca.crt" -H 'Accept: application/json' "${BASE_URL}/api/$1"
}
agent_api_post() {
  curl -sk --max-time 30 --cert "${AGENT_CERT_DIR}/client.crt" --key "${AGENT_CERT_DIR}/client.key" --cacert "${STATE_DIR}/pki/ca.crt" -X POST -H 'Content-Type: application/json' -H 'Accept: application/json' -d "$2" "${BASE_URL}/api/$1"
}

# wait_for <seconds> <command...> — until the command succeeds (every 2 s)
wait_for() {
  local deadline=$((SECONDS + $1))
  shift
  while [ "$SECONDS" -lt "$deadline" ]; do
    if "$@"; then return 0; fi
    sleep 2
  done
  return 1
}

# wait_operation <operation id> <seconds> — prints the operation once it ended
# (still running after <seconds>: printed as is; the caller asserts its status)
wait_operation() {
  local id="$1" deadline=$((SECONDS + $2)) op='{}'
  if [ -z "$id" ]; then
    echo '{}'
    return 0
  fi
  while [ "$SECONDS" -lt "$deadline" ]; do
    op=$(api_get "plugins/${PLUGIN}/operations/${id}" | jq -c '.operation // {}' 2>/dev/null || echo '{}')
    if [ "$(echo "$op" | jq -r '.status // "running"' 2>/dev/null)" != "running" ]; then
      echo "$op"
      return 0
    fi
    sleep 2
  done
  echo "$op"
  return 0
}

# hosting_field jq-expr — a field of GET /api/plugins/<plugin>/hosting
hosting_field() {
  api_get "plugins/${PLUGIN}/hosting" | jq -r "$1" 2>/dev/null || echo ""
}
health_up() { [ "$(hosting_field '.hosting.health.state')" = "up" ]; }

# identity_view — GET /api/plugins/<plugin>/identity's `identity`
identity_view() { api_get "plugins/${PLUGIN}/identity" | jq -c '.identity // {}' 2>/dev/null || echo '{}'; }
identity_ready() { [ "$(json_get "$(identity_view)" '.readiness.ready')" = "true" ]; }

# audience_row <userId> — the plugin's audience row of that user ('null' when none)
audience_row() {
  api_get "plugins/${PLUGIN}/audience" | jq -c --arg id "$1" '[.audience[]? | select(.userId == $id)] | first // null' 2>/dev/null || echo "null"
}

# directory_row <userId> — the directory's record of that user ('null' when none)
directory_row() {
  api_get "identity/directory" | jq -c --arg id "$1" '[.users[]? | select(.userId == $id)] | first // null' 2>/dev/null || echo "null"
}

# projection — what the agent half's projection holds (GET
# /admin/e2e/projection through the forwarder, as the admin)
projection() { api_get "${PLUGIN}/e2e/projection" 2>/dev/null || echo '{}'; }

# projection_has <jq filter> — the agent half's projection satisfies it
projection_has() { projection | jq -e "$1" > /dev/null 2>&1; }

# projected_user <userId> — the projection's row of that user ('null' when none)
projected_user() { projection | jq -c --arg id "$1" '[.users[]? | select(.userId == $id)] | first // null' 2>/dev/null || echo "null"; }

# first_factor <username> <password> — Authelia's first factor for the user:
# its answer's status (OK, KO), "none" when Authelia does not answer
first_factor() {
  local body
  body=$(jq -c -n --arg u "$1" --arg p "$2" --arg t "https://${DOMAIN}/" '{username: $u, password: $p, keepMeLoggedIn: false, targetURL: $t}')
  # shellcheck disable=SC2086 # AUTH_RESOLVE is two words on purpose
  curl -sk --max-time 15 ${AUTH_RESOLVE} -X POST -H 'Content-Type: application/json' -d "$body" \
    "https://auth.${DOMAIN}/api/firstfactor" 2>/dev/null | jq -r '.status // "none"' 2>/dev/null || echo "none"
}
first_factor_ok() { [ "$(first_factor "${USER_A}" "${USER_A_PASSWORD}")" = "OK" ]; }
# first_factor_answered — Authelia answers again (after a restart): OK or KO
first_factor_answered() {
  local s
  s=$(first_factor "${USER_A}" "${USER_A_PASSWORD}")
  [ "$s" = "OK" ] || [ "$s" = "KO" ]
}

# add_opaque_identifier <username> — what Authelia stores the first time a
# user signs in to an OpenID Connect relying party: an opaque identifier for
# the username (the `sub` relying parties know them by), written with
# Authelia's own CLI as its service account with its configuration, the way
# lamaste-priv runs it. Prints Authelia's output; fails when it does.
add_opaque_identifier() {
  (cd / && runuser -u lamaste-authelia -- env -i PATH=/usr/bin:/bin HOME=/nonexistent X_AUTHELIA_CONFIG_FILTERS=template \
    /usr/local/bin/authelia storage user identifiers add --config /etc/authelia/configuration.yml -- "$1") 2>&1
}

# oidc_identity_held <username> — lamaste-priv's check: yes, no ("error" when it fails)
oidc_identity_held() { /usr/local/sbin/lamaste-priv authelia-user has-oidc-identifier "$1" 2>/dev/null || echo "error"; }

# gatekeeper_direct <method> <path> — Gatekeeper's management API on its
# loopback port, as the panel calls it (its shared secret in a header read
# from a 0600 file, never on a command line): the body, then the status
gatekeeper_direct() {
  curl -s --max-time 15 -X "$1" -H @"${WORK_DIR}/gatekeeper-header" -w '\n%{http_code}' "http://127.0.0.1:9294$2" 2>/dev/null || true
}

# gatekeeper_log_rows <username> — Gatekeeper's access-request log rows of the username
gatekeeper_log_rows() {
  api_get "gatekeeper/access-log?limit=1000" | jq --arg u "$1" '[.entries[]? | select(.username == $u)] | length' 2>/dev/null || echo "-1"
}

# seed_access_log <username> — a row in Gatekeeper's access-request log for
# the username, now, as Gatekeeper writes one for a denied request (written
# as the database's owner, so its WAL files stay Gatekeeper's)
seed_access_log() {
  local owner now
  owner=$(stat -c %U "${GATEKEEPER_DB}")
  now=$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)
  runuser -u "${owner}" -- sqlite3 "${GATEKEEPER_DB}" \
    "PRAGMA busy_timeout = 5000; INSERT INTO access_request_log (timestamp, username, resource_type, resource_id, resource_fqdn) VALUES ('${now}', '$1', 'tunnel', '${TUNNEL_RESOURCE}', 'e2e32.${DOMAIN}');" > /dev/null
}

# relay_assertion <method> <path> <username> — a relay assertion for the
# panel, signed with the relay's own key (what Gatekeeper sends nginx for a
# user-surface request): valid once, for 60 seconds
relay_assertion() {
  node "${WORK_DIR}/sign-relay.mjs" "${LAMASTE_LIB}" "${STATE_DIR}/relay-signing-key.json" "$1" "$2" "$3" 2>/dev/null || true
}

# panel_direct <path> <assertion> — the request nginx would pass the panel's
# loopback listener: the body, then the status
panel_direct() {
  curl -s --max-time 15 -H "X-Lamalibre-Relay-Assertion: $2" -w '\n%{http_code}' "${PANEL_DIRECT_URL}$1" 2>/dev/null || true
}

# ===========================================================================
# 1. Stand-in registry with the fixtures
# ===========================================================================

log_section "Stand-in registry with the identity fixtures"

# Leftovers of an interrupted run (rodeo ends a spec at ten minutes without its trap)
cleanup
rm -rf "${WORK_DIR}"
mkdir -p "${WORK_DIR}" "${AGENT_CERT_DIR}" "$(dirname "${HALF_DB}")"
chmod 700 "${AGENT_CERT_DIR}" "$(dirname "${HALF_DB}")"
write_stub_registry "${WORK_DIR}/stub-registry.mjs"
write_identity_fixture_plugins "${WORK_DIR}/fixtures"
write_app_plugin_half "${WORK_DIR}/app-plugin-half.mjs"
cat > "${WORK_DIR}/sign-relay.mjs" <<'SIGN_EOF'
// sign-relay.mjs <@lamalibre/lamaste dir> <relay key file> <method> <path> <username>
// A relay assertion for the panel's user surface, as Gatekeeper signs one.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const [lib, keyFile, method, target, username] = process.argv.slice(2);
const core = await import(pathToFileURL(path.join(lib, 'dist', 'index.js')).href);
const key = await core.createRelaySigner(keyFile, { create: false }).current();
if (!key) throw new Error('no relay signing key');
const route = target.split('/')[2];
process.stdout.write(
  core.signRelayAssertion(
    { aud: core.RELAY_PANEL_AUDIENCE, port: core.RELAY_PANEL_PORT, caller: { type: 'user', username }, method, target: { route, path: target } },
    key,
  ),
);
SIGN_EOF
systemctl stop "${STUB_UNIT}" > /dev/null 2>&1 || true
systemd-run --quiet --collect --unit "${STUB_UNIT}" --setenv=PATH="${PATH}" --setenv=HOME=/root \
  "$(command -v node)" "${WORK_DIR}/stub-registry.mjs" --port "${STUB_PORT}" --admin-token "${STUB_ADMIN_TOKEN}" \
  --issuer "https://auth.${DOMAIN}" --audience "${STUB_URL}" --jwks-url http://127.0.0.1:9091/jwks.json \
  --package "${WORK_DIR}/fixtures/v1" --package "${WORK_DIR}/fixtures/v2" --package "${WORK_DIR}/fixtures/v3" \
  --package "${WORK_DIR}/fixtures/v4" --package "${WORK_DIR}/fixtures/v5" --package "${WORK_DIR}/fixtures/serverhosted" \
  --package "${WORK_DIR}/fixtures/noagent" --package "${WORK_DIR}/fixtures/badrole" --package "${WORK_DIR}/fixtures/badattr"
if wait_for_http "${STUB_URL}/-/ping" 60; then
  log_pass "Stand-in registry is up on ${STUB_URL}"
else
  log_fail "Stand-in registry did not start: $(journalctl -u "${STUB_UNIT}" --no-pager -o cat 2>/dev/null | tail -n 5)"
  end_test
  exit $?
fi
printf '@lamalibre:registry=%s/\n//127.0.0.1:%s/:_authToken=%s\n' "${STUB_URL}" "${STUB_PORT}" "${STUB_ADMIN_TOKEN}" > "${WORK_DIR}/npmrc"
install -o lamaste -g lamaste -m 0600 "${WORK_DIR}/npmrc" "${STATE_DIR}/.npmrc"
(umask 077 && printf 'X-Gatekeeper-Secret: %s\n' "$(jq -r '.secret // empty' "${STATE_DIR}/gatekeeper-secret.json" 2>/dev/null || true)" > "${WORK_DIR}/gatekeeper-header")
AUDIT_BASE=$(api_get "audit?limit=1" | jq '.entries[0].id // 0' 2>/dev/null || echo "0")

# ===========================================================================
# 2. Every user has a directory id
# ===========================================================================

log_section "Every user has a directory id and a status, the same after a panel restart"

USERS=$(api_get "users")
USER_COUNT=$(json_get "$USERS" '.users | length')
assert_json_field "$USERS" '.users | length > 0' 'true' "GET /api/users lists ${USER_COUNT} users" || true
assert_json_field "$USERS" "[.users[] | select((.userId // \"\") | test(\"${UUID_RE}\") | not)] | length" '0' "…each with a userId that is a UUID v4" || true
assert_json_field "$USERS" '[.users[] | select(.status != "active" and .status != "disabled")] | length' '0' "…and a status, active or disabled" || true
assert_json_field "$USERS" '[.users[].userId] | unique | length == length' 'true' "…no two users share an id" || true
DIRECTORY=$(api_get "identity/directory")
DIRECTORY_ID=$(json_get "$DIRECTORY" '.directoryId // empty')
assert_eq "$(echo "$DIRECTORY_ID" | grep -cE "${UUID_RE}" || true)" "1" "GET /api/identity/directory: the directory's own id is a UUID v4" || true
IDS_BEFORE=$(echo "$USERS" | jq -c '[.users[] | {username, userId}] | sort_by(.username)' 2>/dev/null || echo "[]")
assert_eq "$(echo "$DIRECTORY" | jq -c '[.users[] | select(.status != "removed") | {username, userId}] | sort_by(.username)' 2>/dev/null || echo "-")" "${IDS_BEFORE}" "The directory holds those users under those ids" || true

systemctl restart lamalibre-lamaste-serverd
PANEL_BACK="no"
for _ in $(seq 1 60); do
  if [ "$(api_get "health" 2>/dev/null | jq -r '.status' 2>/dev/null || echo "")" = "ok" ]; then
    PANEL_BACK="yes"
    break
  fi
  sleep 1
done
assert_eq "$PANEL_BACK" "yes" "The panel is back after a restart" || true
assert_eq "$(api_get "users" | jq -c '[.users[] | {username, userId}] | sort_by(.username)' 2>/dev/null || echo "-")" "${IDS_BEFORE}" "Every user keeps their id across the restart" || true
assert_json_field "$(api_get "identity/directory")" '.directoryId' "${DIRECTORY_ID}" "…and the directory its id" || true

# ===========================================================================
# 3. Manifest refusals
# ===========================================================================

log_section "A manifest's identity block is checked at install"

for refusal in \
  "serverhosted|identity needs an agent-hosted plugin with an agent half|identity on a server-hosted plugin" \
  "noagent|identity needs an agent-hosted plugin with an agent half|identity on an agent-hosted plugin without an agent block" \
  "badrole|A role id starts with a lower-case letter|a role id that is not one" \
  "badattr|displayName|an attribute outside displayName and email"; do
  variant="${refusal%%|*}"
  rest="${refusal#*|}"
  issue="${rest%%|*}"
  what="${rest#*|}"
  name="e2e-ident-${variant}"
  RESP=$(call POST "plugins/install" "{\"packageName\":\"@lamalibre/${name}-server\"}")
  assert_eq "$(status_of "$RESP")" "400" "Installing ${name} (${what}) is refused: 400" || true
  assert_contains "$(json_get "$(body_of "$RESP")" '.error')" "$issue" "…${issue}" || true
  assert_eq "$(api_get "plugins" | jq "[.plugins[] | select(.name == \"${name}\")] | length" 2>/dev/null || echo "-1")" "0" "…it is not in the registry" || true
  assert_eq "$(test -e "${STATE_DIR}/node_modules/@lamalibre/${name}-server" && echo "yes" || echo "no")" "no" "…and its package was removed" || true
done

# ===========================================================================
# 4. The approval gate
# ===========================================================================

log_section "The approval gate: identity added, a role added, attributes widened and narrowed"

INSTALL=$(api_post "plugins/install" "{\"packageName\":\"${PACKAGE}@1.0.0\"}")
assert_json_field "$INSTALL" '.plugin.version' '1.0.0' "${PACKAGE}@1.0.0 installed: agent-hosted, no identity block" || true
assert_json_field "$INSTALL" '"\(.hooks.identity.declared) \(.hooks.approval.state) \(.hooks.approval.digest)"' 'false not-required null' "…nothing to approve: no digest" || true
assert_json_field "$(identity_view)" '"\(.declared) \(.readiness.reason)"' 'null no_identity' "GET /api/plugins/${PLUGIN}/identity: no identity declared" || true
assert_eq "$(status_of "$(call GET "plugins/${PLUGIN}/audience")")" "400" "…and no audience (400 no_identity)" || true
api_post "plugins/${PLUGIN}/enable" > /dev/null

UPDATE=$(api_post "plugins/${PLUGIN}/update" '{"version":"2.0.0"}')
assert_json_field "$UPDATE" '.pendingUpdate.version' '2.0.0' "2.0.0, which adds identity, waits for approval" || true
CODES=$(json_get "$UPDATE" '[.pendingUpdate.approvalRequired[]?.code] | sort | join(",")')
assert_eq "$CODES" "digest.unapproved,identity.changed" "…as digest.unapproved and identity.changed" || true
assert_json_field "$UPDATE" '"\(.pendingUpdate.identity.before) \(.pendingUpdate.identity.rolesAdded | join(","))"' 'null viewer' "The preview: no identity before, role viewer added" || true
assert_json_field "$UPDATE" '.pendingUpdate.identity.after.attributes | join(",")' 'displayName' "…receiving displayName, the default" || true
assert_json_field_not_empty "$UPDATE" '.pendingUpdate.digest' "…with a digest to approve" || true
assert_json_field "$(api_get "plugins/${PLUGIN}")" '.plugin.version' '1.0.0' "1.0.0 stays until it is approved" || true
APPROVED=$(api_post "plugins/${PLUGIN}/hooks/approve" "{\"digest\":\"$(json_get "$UPDATE" '.pendingUpdate.digest')\"}")
OP=$(wait_operation "$(json_get "$APPROVED" '.operation.id // empty')" 120)
assert_json_field "$OP" '.status' 'succeeded' "Approved, the update to 2.0.0 succeeded ($(json_get "$OP" '.error // ""'))" || true
HOOKS=$(api_get "plugins/${PLUGIN}/hooks")
assert_json_field "$HOOKS" '"\(.hooks.identity.declared) \(.hooks.identity.approved) \(.hooks.approval.state)"' 'true true approved' "2.0.0 declares identity, approved" || true

AUTO=$(call PUT "plugins/${PLUGIN}/hooks/auto-approve" '{"enabled":true}')
assert_json_field "$(body_of "$AUTO")" '.autoApprove' 'true' "Auto-approve is on for ${PLUGIN}" || true

UPDATE=$(api_post "plugins/${PLUGIN}/update" '{"version":"3.0.0"}')
assert_json_field "$UPDATE" '.pendingUpdate.version' '3.0.0' "3.0.0 adds a role: it waits, auto-approve on" || true
assert_json_field "$UPDATE" '[.pendingUpdate.approvalRequired[]?.code] | index("identity.changed") != null' 'true' "…identity.changed" || true
assert_json_field "$UPDATE" '"\(.pendingUpdate.identity.rolesAdded | join(",")) \(.pendingUpdate.identity.attributesAdded | length)"' 'editor 0' "The preview: role editor added, no attribute" || true
assert_json_field "$UPDATE" '(.pendingUpdate.autoApproveWithheld // []) | length > 0' 'true' "Auto-approve withheld: $(json_get "$UPDATE" '(.pendingUpdate.autoApproveWithheld // []) | join("; ")')" || true
assert_eq "$(api_get "audit?plugin=${PLUGIN}&action=hooks.auto-approve.withheld&limit=50" | jq "[.entries[]? | select(.id > ${AUDIT_BASE}) | select(.details.version == \"3.0.0\" and ((.details.codes // []) | index(\"identity.changed\")) != null)] | length" 2>/dev/null || echo "-1")" "1" "Audit: hooks.auto-approve.withheld, identity.changed" || true
APPROVED=$(api_post "plugins/${PLUGIN}/hooks/approve" "{\"digest\":\"$(json_get "$UPDATE" '.pendingUpdate.digest')\"}")
OP=$(wait_operation "$(json_get "$APPROVED" '.operation.id // empty')" 120)
assert_json_field "$OP" '.status' 'succeeded' "Approved by the admin, 3.0.0 is installed ($(json_get "$OP" '.error // ""'))" || true

UPDATE=$(api_post "plugins/${PLUGIN}/update" '{"version":"4.0.0"}')
assert_json_field "$UPDATE" '.pendingUpdate.version' '4.0.0' "4.0.0 widens the attributes: it waits, auto-approve on" || true
assert_json_field "$UPDATE" '[.pendingUpdate.approvalRequired[]?.code] | index("identity.changed") != null' 'true' "…identity.changed" || true
assert_json_field "$UPDATE" '"\(.pendingUpdate.identity.attributesAdded | join(",")) \(.pendingUpdate.identity.rolesAdded | length)"' 'email 0' "The preview: email added, no role" || true
assert_eq "$(api_get "audit?plugin=${PLUGIN}&action=hooks.auto-approve.withheld&limit=50" | jq "[.entries[]? | select(.id > ${AUDIT_BASE}) | select(.details.version == \"4.0.0\" and ((.details.codes // []) | index(\"identity.changed\")) != null)] | length" 2>/dev/null || echo "-1")" "1" "Audit: hooks.auto-approve.withheld for 4.0.0" || true
APPROVED=$(api_post "plugins/${PLUGIN}/hooks/approve" "{\"digest\":\"$(json_get "$UPDATE" '.pendingUpdate.digest')\"}")
OP=$(wait_operation "$(json_get "$APPROVED" '.operation.id // empty')" 120)
assert_json_field "$OP" '.status' 'succeeded' "Approved, 4.0.0 is installed ($(json_get "$OP" '.error // ""'))" || true

UPDATE=$(api_post "plugins/${PLUGIN}/update" '{"version":"5.0.0"}')
assert_json_field "$UPDATE" '.pendingUpdate // "none"' 'none' "5.0.0 narrows the attributes and edits a label: no pending update…" || true
OP=$(wait_operation "$(json_get "$UPDATE" '.operation.id // empty')" 120)
assert_json_field "$OP" '.status' 'succeeded' "…auto-approved, the update ran at once ($(json_get "$OP" '.error // ""'))" || true
APPROVAL=$(api_get "audit?plugin=${PLUGIN}&action=hooks.approved&limit=50" | jq -c "[.entries[]? | select(.id > ${AUDIT_BASE}) | select(.details.version == \"5.0.0\")] | first // {}" 2>/dev/null || echo "{}")
assert_json_field "$APPROVAL" '"\(.actor) \(.details.codes | join(","))"' 'auto-approve digest.unapproved' "Audit: hooks.approved by auto-approve, for the digest alone" || true
HOOKS=$(api_get "plugins/${PLUGIN}/hooks")
assert_json_field "$HOOKS" '"\(.hooks.identity.block.roles | map("\(.id)=\(.label)") | join(",")) \(.hooks.identity.block.attributes | join(","))"' 'editor=Editor,viewer=Reader displayName' "5.0.0: roles editor and viewer (relabelled Reader), displayName alone" || true
assert_json_field "$(api_get "plugins/${PLUGIN}")" '.plugin.version' '5.0.0' "${PLUGIN} is at 5.0.0" || true

# ===========================================================================
# 5. Hosted: ready once the agent half synced to the head
# ===========================================================================

log_section "Hosted, the agent half on the relay loopback; ready once it synced to the head"

CERT_RESPONSE=$(api_post "certs/agent" "{\"label\":\"${AGENT_LABEL}\",\"capabilities\":[\"tunnels:read\"]}")
assert_json_field "$CERT_RESPONSE" '.ok' 'true' "Agent certificate issued for ${AGENT_LABEL}" || true
P12_PASS=$(echo "$CERT_RESPONSE" | jq -r '.p12Password' 2>/dev/null || echo "")
openssl pkcs12 -in "${STATE_DIR}/pki/agents/${AGENT_LABEL}/client.p12" -out "${AGENT_CERT_DIR}/client.crt" -clcerts -nokeys -passin pass:"${P12_PASS}" 2>/dev/null
openssl pkcs12 -in "${STATE_DIR}/pki/agents/${AGENT_LABEL}/client.p12" -out "${AGENT_CERT_DIR}/client.key" -nocerts -nodes -passin pass:"${P12_PASS}" 2>/dev/null
chmod 600 "${AGENT_CERT_DIR}/client.key"
unset P12_PASS

HOST_RESPONSE=$(api_post "plugins/${PLUGIN}/hosting" "{\"agentLabel\":\"${AGENT_LABEL}\"}")
assert_json_field "$HOST_RESPONSE" '.operation.kind' 'host' "Hosting on ${AGENT_LABEL} started" || log_info "The panel answered: ${HOST_RESPONSE}"
HOST_OP_ID=$(json_get "$HOST_RESPONSE" '.operation.id // empty')
# What the agent's sync does: fetch the plugin config, acknowledge it, start
# the agent half — here on the relay loopback, as in spec 31.
PLUGIN_CONFIG="{}"
for _ in $(seq 1 60); do
  PLUGIN_CONFIG=$(agent_api_get "agents/me/plugin-config/${PLUGIN}" 2>/dev/null || echo '{}')
  if [ -n "$(json_get "$PLUGIN_CONFIG" '.port // empty')" ]; then break; fi
  sleep 1
done
PORT=$(json_get "$PLUGIN_CONFIG" '.port // empty')
echo "$PLUGIN_CONFIG" | jq '. + {fetchedAt: (now | todate), acknowledged: false}' > "${HALF_CONFIG}.tmp"
chmod 600 "${HALF_CONFIG}.tmp"
mv "${HALF_CONFIG}.tmp" "${HALF_CONFIG}"
ACK=$(agent_api_post "agents/me/plugin-config/${PLUGIN}/ack" "{\"issuedAt\":\"$(json_get "$PLUGIN_CONFIG" '.issuedAt')\"}")
assert_json_field "$ACK" '.acknowledged' 'true' "The agent fetched and acknowledged the plugin config (port ${PORT})" || true
systemctl stop "${HALF_UNIT}" > /dev/null 2>&1 || true
systemd-run --quiet --collect --unit "${HALF_UNIT}" "$(command -v node)" "${WORK_DIR}/app-plugin-half.mjs" \
  --config "${HALF_CONFIG}" --plugin "${PLUGIN}" --lamaste "${LAMASTE_LIB}" --log "${HALF_LOG}" --identity-db "${HALF_DB}"
half_listens() { [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "http://127.0.0.1:${PORT}/admin/health" 2>/dev/null || true)" = "401" ]; }
if wait_for 30 half_listens; then
  log_pass "The agent half listens on 127.0.0.1:${PORT}, with its identity projection"
else
  log_fail "The agent half did not start: $(journalctl -u "${HALF_UNIT}" --no-pager -o cat 2>/dev/null | tail -n 5)"
fi
HOST_OP=$(wait_operation "${HOST_OP_ID}" 180)
assert_json_field "$HOST_OP" '.status' 'succeeded' "The hosting operation succeeded" || true
if wait_for 60 health_up; then
  log_pass "Health is up"
else
  log_fail "Health did not reach up: $(hosting_field '.hosting.health')"
fi
if wait_for 90 identity_ready; then
  log_pass "The plugin is ready for its users: its agent half's first complete sync ended at the head"
else
  log_fail "Not ready: $(identity_view)"
fi
VIEW=$(identity_view)
assert_json_field "$VIEW" '"\(.readiness.readyVersion) \(.sync.halfDirectoryId)"' "5.0.0 ${DIRECTORY_ID}" "5.0.0 is ready, and its agent half follows this directory" || true
assert_json_field "$VIEW" '"\(.sync.behind) \(.sync.cursor == .sync.head)"' '0 true' "…its cursor at the head: ready means synced, not merely answering" || true
assert_contains "$(cat "${HALF_LOG}" 2>/dev/null)" "POST /admin/identity/notify 200 identity-call" "The agent half was notified with Lamaste's own caller assertion" || true
assert_json_field "$(projection)" '.state.directoryId' "${DIRECTORY_ID}" "Its projection follows the panel's directory" || true

# ===========================================================================
# 6. Entitlements
# ===========================================================================

log_section "Entitlements: declared roles only; a grant without roles makes no member"

RESP=$(users_call POST "users" "{\"username\":\"${USER_A}\",\"displayname\":\"E2E Alice\",\"email\":\"${USER_A}@example.test\",\"password\":\"${USER_A_PASSWORD}\",\"groups\":[]}")
assert_eq "$(status_of "$RESP")" "201" "User ${USER_A} created" || true
ALICE_ID=$(json_get "$(body_of "$RESP")" '.user.userId // empty')
assert_eq "$(echo "$ALICE_ID" | grep -cE "${UUID_RE}" || true)" "1" "…with a directory id (${ALICE_ID})" || true
assert_json_field "$(body_of "$RESP")" '.user.status' 'active' "…active" || true

RESP=$(call PUT "plugins/${PLUGIN}/entitlements" "{\"principalType\":\"user\",\"principalId\":\"${USER_A}\",\"roles\":[\"owner\"]}")
assert_eq "$(status_of "$RESP")" "400" "A role the plugin does not declare is refused: 400" || true
assert_json_field "$(body_of "$RESP")" '"\(.code) \(.unknown | join(","))"' 'unknown_roles owner' "…unknown_roles: owner" || true
assert_eq "$(status_of "$(call PUT "plugins/${PLUGIN}/entitlements" "{\"principalType\":\"user\",\"principalId\":\"${USER_A}\",\"roles\":[]}")")" "400" "No roles at all: 400" || true
RESP=$(call POST "gatekeeper/grants" "{\"principalType\":\"user\",\"principalId\":\"${USER_A}\",\"resourceType\":\"plugin\",\"resourceId\":\"${PLUGIN}\",\"context\":{\"roles\":[\"owner\"]}}")
assert_eq "$(status_of "$RESP")" "400" "The same through the Gatekeeper proxy: 400" || true
assert_json_field "$(body_of "$RESP")" '.code' 'unknown_roles' "…unknown_roles" || true
RESP=$(call POST "gatekeeper/grants" "{\"principalType\":\"user\",\"principalId\":\"${USER_A}\",\"resourceType\":\"plugin\",\"resourceId\":\"${PLUGIN}\"}")
ROLELESS_GRANT_ID=$(json_get "$(body_of "$RESP")" '.grant.grantId // empty')
assert_json_field_not_empty "$(body_of "$RESP")" '.grant.grantId' "A plugin grant without roles is taken by Gatekeeper" || true
ENTITLEMENTS=$(api_get "plugins/${PLUGIN}/entitlements")
assert_json_field "$ENTITLEMENTS" '.roleless >= 1' 'true' "…counted as roleless ($(json_get "$ENTITLEMENTS" '.roleless'))" || true
assert_json_field "$ENTITLEMENTS" "[.entitlements[] | select(.principalId == \"${USER_A}\")] | length" '0' "…and no entitlement" || true
assert_eq "$(audience_row "${ALICE_ID}")" "null" "It makes ${USER_A} no member of the audience" || true

RESP=$(call PUT "plugins/${PLUGIN}/entitlements" "{\"principalType\":\"user\",\"principalId\":\"${USER_A}\",\"roles\":[\"viewer\",\"viewer\"]}")
assert_eq "$(status_of "$RESP")" "200" "${USER_A} entitled as viewer" || true
assert_json_field "$(body_of "$RESP")" '"\(.entitlement.userId) \(.entitlement.roles | join(","))"' "${ALICE_ID} viewer" "…named by her directory id, the role once" || true
RESP=$(call POST "gatekeeper/groups" "{\"name\":\"${GROUP}\",\"description\":\"E2E 32 team\"}")
assert_json_field "$(body_of "$RESP")" '.ok' 'true' "Group ${GROUP} created" || true
RESP=$(call POST "gatekeeper/groups/${GROUP}/members" "{\"usernames\":[\"${USER_A}\"]}")
assert_json_field "$(body_of "$RESP")" '.ok' 'true' "…with ${USER_A} in it" || true
RESP=$(call PUT "plugins/${PLUGIN}/entitlements" "{\"principalType\":\"group\",\"principalId\":\"${GROUP}\",\"roles\":[\"editor\"]}")
assert_eq "$(status_of "$RESP")" "200" "The group entitled as editor" || true
ROW=$(audience_row "${ALICE_ID}")
assert_json_field "$ROW" '"\(.change.kind) \(.change.member.status) \(.change.member.roles | join(","))"' 'upsert active editor,viewer' "The audience: ${USER_A} active, her roles and her group's (editor, viewer)" || true
assert_json_field "$ROW" '"\(.change.member.displayName) \(.change.member | has("email"))"' 'E2E Alice false' "…her display name, never the address 5.0.0 does not declare" || true
if wait_for 30 projection_has "[.users[] | select(.userId == \"${ALICE_ID}\" and .status == \"active\" and .roles == [\"editor\",\"viewer\"])] | length == 1"; then
  log_pass "The agent half's projection holds her, with both roles"
else
  log_fail "The projection does not hold her: $(projected_user "${ALICE_ID}")"
fi

# ===========================================================================
# 7. Disable and enable
# ===========================================================================

log_section "Disabled: Authelia refuses her first factor; enabled: takes it again"

if wait_for 30 first_factor_ok; then
  log_pass "Authelia's first factor takes ${USER_A}'s password"
else
  log_fail "Authelia's first factor refused ${USER_A} before she was disabled"
fi
RESP=$(users_call PUT "users/${USER_A}" '{"disabled":true}')
assert_eq "$(status_of "$RESP")" "200" "${USER_A} disabled" || true
assert_json_field "$(body_of "$RESP")" '"\(.user.status) \(.user.disabled) \(.user.userId)"' "disabled true ${ALICE_ID}" "…status disabled, her id unchanged" || true
assert_json_field "$(api_get "users")" "[.users[] | select(.username == \"${USER_A}\") | .status] | first" 'disabled' "GET /api/users: disabled" || true
assert_json_field "$(directory_row "${ALICE_ID}")" '.status' 'disabled' "The directory: disabled" || true
wait_for 30 first_factor_answered || true
assert_not_eq "$(first_factor "${USER_A}" "${USER_A_PASSWORD}")" "OK" "Authelia's first factor refuses her" || true
assert_json_field "$(audience_row "${ALICE_ID}")" '"\(.change.kind) \(.change.member.status)"' 'upsert disabled' "The audience keeps her as a member, disabled" || true
RESP=$(users_call PUT "users/${USER_A}" '{"disabled":false}')
assert_json_field "$(body_of "$RESP")" '.user.status' 'active' "${USER_A} enabled again" || true
if wait_for 30 first_factor_ok; then
  log_pass "Authelia's first factor takes her password again"
else
  log_fail "Authelia's first factor still refuses ${USER_A} once enabled"
fi
assert_json_field "$(audience_row "${ALICE_ID}")" '.change.member.status' 'active' "The audience: active again" || true

ADMINS=$(api_get "users" | jq -c '[.users[] | select(((.groups // []) | index("admins")) != null and .disabled != true) | .username]' 2>/dev/null || echo "[]")
if [ "$(json_get "$ADMINS" 'length')" = "1" ]; then
  LAST_ADMIN=$(json_get "$ADMINS" '.[0]')
  RESP=$(users_call PUT "users/${LAST_ADMIN}" '{"disabled":true}')
  assert_eq "$(status_of "$RESP")" "400" "The last enabled administrator (${LAST_ADMIN}) cannot be disabled: 400" || true
  assert_json_field "$(body_of "$RESP")" '.code' 'last_admin' "…last_admin" || true
  assert_json_field "$(api_get "users")" "[.users[] | select(.username == \"${LAST_ADMIN}\") | .status] | first" 'active' "…still active" || true
else
  log_skip "Last enabled administrator: ${ADMINS} — not exactly one enabled administrator on this VM"
fi

# ===========================================================================
# 8. Delete: a tombstone, Gatekeeper cleared
# ===========================================================================

log_section "Deleted: a tombstone, her grants and memberships gone"

RESP=$(call POST "gatekeeper/grants" "{\"principalType\":\"user\",\"principalId\":\"${USER_A}\",\"resourceType\":\"tunnel\",\"resourceId\":\"${TUNNEL_RESOURCE}\"}")
TUNNEL_GRANT_ID=$(json_get "$(body_of "$RESP")" '.grant.grantId // empty')
assert_json_field_not_empty "$(body_of "$RESP")" '.grant.grantId' "${USER_A} holds a tunnel grant too" || true
seed_access_log "${USER_A}"
assert_eq "$(gatekeeper_log_rows "${USER_A}")" "1" "…and a row in Gatekeeper's access-request log" || true
assert_json_field "$(api_get "gatekeeper/grants?principalType=user&principalId=${USER_A}")" '.grants | length' '3' "Gatekeeper holds three grants of hers: the tunnel, the roleless plugin grant, her role" || true

RESP=$(call DELETE "users/${USER_A}")
assert_eq "$(status_of "$RESP")" "200" "${USER_A} deleted" || true
assert_json_field "$(body_of "$RESP")" '"\(.userId) \(.principalCleared)"' "${ALICE_ID} true" "…her id named, Gatekeeper's principal cleared" || true
ROW=$(directory_row "${ALICE_ID}")
assert_json_field "$ROW" '"\(.status) \(.removedReason) \(.erasedAt)"' 'removed deleted null' "The directory keeps a tombstone: removed, deleted" || true
assert_json_field "$ROW" '"\(.username) \(.displayName) \(.email)"' "${USER_A} E2E Alice ${USER_A}@example.test" "…with her username, name and address" || true
assert_json_field_not_empty "$ROW" '.principalClearedAt' "…and when Gatekeeper dropped what it held of her" || true
assert_json_field "$(api_get "users")" "[.users[] | select(.username == \"${USER_A}\")] | length" '0' "GET /api/users no longer lists her" || true
assert_json_field "$(api_get "gatekeeper/grants?principalType=user&principalId=${USER_A}")" '.grants | length' '0' "No Gatekeeper grant names her username" || true
assert_eq "$(api_get_status "gatekeeper/grants/${ROLELESS_GRANT_ID}")" "404" "…the roleless plugin grant gone with the others" || true
assert_json_field "$(api_get "gatekeeper/groups/${GROUP}")" ".group.members | index(\"${USER_A}\")" 'null' "${GROUP} no longer has her" || true
ENTITLEMENTS=$(api_get "plugins/${PLUGIN}/entitlements")
assert_json_field "$ENTITLEMENTS" '[.entitlements[] | "\(.principalType):\(.principalId)"] | join(",")' "group:${GROUP}" "The plugin's entitlements: the group's alone" || true
ROW=$(audience_row "${ALICE_ID}")
assert_json_field "$ROW" '"\(.change.kind) \(.change.reason) \(.change.last.displayName) \(.change.last.username)"' "remove deleted E2E Alice ${USER_A}" "The audience: remove/deleted, with the last display name" || true
if wait_for 30 projection_has "[.users[] | select(.userId == \"${ALICE_ID}\" and .status == \"removed\" and .removedReason == \"deleted\" and .displayName == \"E2E Alice\" and .roles == [])] | length == 1"; then
  log_pass "The agent half's projection: removed, deleted, her name kept, no roles"
else
  log_fail "The projection: $(projected_user "${ALICE_ID}")"
fi

# Nothing is given to the username while nobody holds it: it would pass to
# whoever is given the username next.
RESP=$(call POST "gatekeeper/grants" "{\"principalType\":\"user\",\"principalId\":\"${USER_A}\",\"resourceType\":\"tunnel\",\"resourceId\":\"${TUNNEL_RESOURCE}\"}")
assert_eq "$(status_of "$RESP")" "409" "A grant to ${USER_A}, which nobody holds since her deletion: 409" || true
assert_json_field "$(body_of "$RESP")" '.code' 'username_deleted' "…username_deleted" || true
RESP=$(call POST "gatekeeper/groups/${GROUP}/members" "{\"usernames\":[\"${USER_A}\"]}")
assert_eq "$(status_of "$RESP")" "409" "Adding ${USER_A} to ${GROUP}: 409" || true
assert_json_field "$(body_of "$RESP")" '.code' 'username_deleted' "…username_deleted" || true
RESP=$(call PUT "plugins/${PLUGIN}/entitlements" "{\"principalType\":\"user\",\"principalId\":\"${USER_A}\",\"roles\":[\"viewer\"]}")
assert_eq "$(status_of "$RESP")" "409" "Entitling ${USER_A} in ${PLUGIN}: 409" || true
assert_json_field "$(body_of "$RESP")" '.code' 'username_deleted' "…username_deleted" || true
assert_json_field "$(api_get "gatekeeper/grants?principalType=user&principalId=${USER_A}")" '.grants | length' '0' "Nothing was given: no grant names ${USER_A}" || true
assert_json_field "$(api_get "gatekeeper/groups/${GROUP}")" ".group.members | index(\"${USER_A}\")" 'null' "…and ${GROUP} does not have her" || true

# ===========================================================================
# 9. The same username again: a new user
# ===========================================================================

log_section "The same username created again is a new user, with no roles"

RESP=$(users_call POST "users" "{\"username\":\"${USER_A}\",\"displayname\":\"E2E Alice Two\",\"email\":\"${USER_A}-two@example.test\",\"password\":\"${USER_A_PASSWORD}\",\"groups\":[]}")
assert_eq "$(status_of "$RESP")" "201" "${USER_A} created again" || true
NEW_ALICE_ID=$(json_get "$(body_of "$RESP")" '.user.userId // empty')
assert_eq "$(echo "$NEW_ALICE_ID" | grep -cE "${UUID_RE}" || true)" "1" "…with a directory id" || true
assert_not_eq "${NEW_ALICE_ID}" "${ALICE_ID}" "…a new one: not the deleted user's" || true
assert_json_field "$(directory_row "${ALICE_ID}")" '.status' 'removed' "The earlier user stays a tombstone" || true
assert_json_field "$(api_get "gatekeeper/grants?principalType=user&principalId=${USER_A}")" '.grants | length' '0' "She inherits no grant" || true
assert_json_field "$(api_get "gatekeeper/groups/${GROUP}")" ".group.members | index(\"${USER_A}\")" 'null' "…and no group" || true
assert_eq "$(audience_row "${NEW_ALICE_ID}")" "null" "…so no role in ${PLUGIN}: not in its audience" || true
seed_access_log "${USER_A}"

# ===========================================================================
# 10. A username a relying party knows is never given again
# ===========================================================================

log_section "A username Authelia holds an OpenID Connect identity for is never given to a new user"

assert_eq "$(oidc_identity_held "${USER_O}")" "no" "lamaste-priv: Authelia holds no OpenID Connect identity for ${USER_O}" || true
if OUT=$(add_opaque_identifier "${USER_O}"); then
  log_pass "Authelia's CLI stored an opaque identifier for ${USER_O}, as a first sign-in to a relying party would"
else
  log_fail "authelia storage user identifiers add failed: $(echo "$OUT" | tail -n 3)"
fi
assert_eq "$(oidc_identity_held "${USER_O}")" "yes" "lamaste-priv: now it holds one" || true
assert_eq "$(oidc_identity_held "${USER_A}")" "no" "…and none for ${USER_A}, who never signed in to a relying party" || true
RESP=$(users_call POST "users" "{\"username\":\"${USER_O}\",\"displayname\":\"E2E OIDC\",\"email\":\"${USER_O}@example.test\",\"password\":\"E2e-$(openssl rand -hex 12)\",\"groups\":[]}")
assert_eq "$(status_of "$RESP")" "409" "Creating a user named ${USER_O}: 409 — every relying party would take them for the earlier holder" || true
assert_json_field "$(body_of "$RESP")" '.code' 'username_has_oidc_identity' "…username_has_oidc_identity" || true
assert_json_field "$(api_get "users")" "[.users[] | select(.username == \"${USER_O}\")] | length" '0' "…GET /api/users has no such user" || true
assert_json_field "$(api_get "identity/directory")" "[.users[] | select(.username == \"${USER_O}\")] | length" '0' "…nor does the directory" || true

# ===========================================================================
# 11. Erase
# ===========================================================================

log_section "Erased: the tombstone scrubbed, the access-request log purged, the plugin told"

RESP=$(call POST "identity/directory/${NEW_ALICE_ID}/erase" '{}')
assert_eq "$(status_of "$RESP")" "409" "An active user is not erased: 409" || true
assert_json_field "$(body_of "$RESP")" '.code' 'user_not_removed' "…user_not_removed" || true
assert_eq "$(gatekeeper_log_rows "${USER_A}")" "2" "Gatekeeper's access-request log holds two rows of ${USER_A}: the deleted user's and the new one's" || true
LOG_TOTAL=$(api_get "gatekeeper/access-log?limit=1000" | jq '.entries | length' 2>/dev/null || echo "-1")
RESP=$(gatekeeper_direct DELETE "/api/access-log?username=${USER_A}")
assert_eq "$(status_of "$RESP")" "400" "Gatekeeper: DELETE /api/access-log narrowed by a query, as an older caller would purge one user: 400" || true
assert_contains "$(json_get "$(body_of "$RESP")" '.error')" "POST /api/access-log/purge" "…naming POST /api/access-log/purge, the username in the body" || true
assert_eq "$(api_get "gatekeeper/access-log?limit=1000" | jq '.entries | length' 2>/dev/null || echo "-2")" "${LOG_TOTAL}" "…and the log is as it was: nothing cleared, ${USER_A}'s rows or anyone's" || true

RESP=$(call POST "identity/directory/${ALICE_ID}/erase" '{}')
assert_eq "$(status_of "$RESP")" "200" "The deleted user erased by her id" || true
assert_json_field "$(body_of "$RESP")" '"\(.userId) \(.accessLogPurged)"' "${ALICE_ID} 1" "…her access-request log row purged" || true
ROW=$(directory_row "${ALICE_ID}")
assert_json_field "$ROW" '"\(.username) \(.displayName) \(.email)"' 'null null null' "The tombstone is scrubbed to the bare id" || true
assert_json_field_not_empty "$ROW" '.erasedAt' "…erased at $(json_get "$ROW" '.erasedAt')" || true
assert_eq "$(gatekeeper_log_rows "${USER_A}")" "1" "The new ${USER_A}'s row stays: the erasure is the deleted user's" || true
ROW=$(audience_row "${ALICE_ID}")
assert_json_field "$ROW" '"\(.change.kind) \(.change.reason) \(.change | has("last"))"' 'remove erased false' "The audience: remove/erased, nothing but the id" || true
if wait_for 30 projection_has "[.users[] | select(.userId == \"${ALICE_ID}\" and .username == null and .displayName == null and .email == null and .removedReason == \"erased\" and .erasedAt != null)] | length == 1"; then
  log_pass "The agent half's projection scrubbed her row to the bare id"
else
  log_fail "The projection: $(projected_user "${ALICE_ID}")"
fi
assert_json_field "$(projection)" ".erased | index(\"${ALICE_ID}\") != null" 'true' "…and the plugin's anonymiser (onErase) ran for her" || true
erasure_acknowledged() { [ "$(directory_row "${ALICE_ID}" | jq -r '.pendingErasures | length' 2>/dev/null)" = "0" ]; }
if wait_for 30 erasure_acknowledged; then
  log_pass "Its cursor passed the erasure: no plugin has it pending"
else
  log_fail "Still pending: $(directory_row "${ALICE_ID}" | jq -c '.pendingErasures')"
fi
assert_json_field "$(identity_view)" '.pendingErasures | length' '0' "GET /api/plugins/${PLUGIN}/identity: no pending erasure" || true
RESP=$(call POST "identity/directory/${ALICE_ID}/erase" '{}')
assert_eq "$(status_of "$RESP")" "409" "A second erasure: 409" || true
assert_json_field "$(body_of "$RESP")" '.code' 'already_erased' "…already_erased" || true

# ===========================================================================
# 12. The forwarder's reserved paths
# ===========================================================================

log_section "The admin forwarder never reaches /admin/identity* or /admin/app*"

assert_eq "$(_curl_mtls -o /dev/null -w '%{http_code}' "${BASE_URL}/api/${PLUGIN}/e2e/projection" 2>/dev/null || true)" "200" "(an admin reaches the agent half's /admin through the forwarder)" || true
for path in identity identity/notify identity/changes IDENTITY/changes %69dentity/notify identity.json identity-v2/notify; do
  assert_eq "$(_curl_mtls -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{}' "${BASE_URL}/api/${PLUGIN}/${path}?e2e=${MARK}" 2>/dev/null || true)" "404" "POST /api/${PLUGIN}/${path}: 404" || true
  assert_eq "$(_curl_mtls -o /dev/null -w '%{http_code}' "${BASE_URL}/api/${PLUGIN}/${path}?e2e=${MARK}" 2>/dev/null || true)" "404" "GET /api/${PLUGIN}/${path}: 404" || true
done
for path in app app/ app/echo app/me; do
  RESP=$(call GET "${PLUGIN}/${path}?e2e=${MARK}")
  assert_eq "$(status_of "$RESP")" "401" "GET /api/${PLUGIN}/${path} with the admin certificate: 401 — the user surface's, without a relay assertion" || true
  assert_json_field "$(body_of "$RESP")" '.error' 'unauthenticated' "…JSON, unauthenticated" || true
done
assert_eq "$(status_of "$(call POST "${PLUGIN}/app/echo?e2e=${MARK}" '{}')")" "401" "POST /api/${PLUGIN}/app/echo: 401" || true
assert_eq "$(grep -c "${MARK}" "${HALF_LOG}" 2>/dev/null || true)" "0" "The agent half saw none of them" || true

# ===========================================================================
# 13. A client's relay assertion never passes the panel vhost
# ===========================================================================

log_section "The panel vhost clears a client-sent X-Lamalibre-Relay-Assertion"

ASSERTION_A=$(relay_assertion GET "/api/${PLUGIN}/app/echo" "${USER_A}")
ASSERTION_B=$(relay_assertion GET "/api/${PLUGIN}/app/echo" "${USER_A}")
assert_eq "$(echo "${ASSERTION_A}" | grep -cE '^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$' || true)" "1" "Two relay assertions for the panel, signed with the relay's own key" || true
RESP=$(_curl_mtls -H "X-Lamalibre-Relay-Assertion: ${ASSERTION_A}" -w '\n%{http_code}' "${BASE_URL}/api/${PLUGIN}/app/echo" 2>/dev/null || true)
assert_eq "$(status_of "$RESP")" "401" "Sent through the panel vhost with the admin certificate: 401 — nginx cleared it" || true
RESP=$(panel_direct "/api/${PLUGIN}/app/echo" "${ASSERTION_B}")
assert_eq "$(status_of "$RESP")" "404" "The other, sent to the panel's loopback listener: accepted — 404, no host serves the route" || true
assert_eq "$(status_of "$(panel_direct "/api/${PLUGIN}/app/echo" "${ASSERTION_B}")")" "401" "…and refused when replayed (401)" || true
assert_eq "$(status_of "$(panel_direct "/api/${PLUGIN}/app/echo" "${ASSERTION_A}")")" "404" "The first one, sent there now, is accepted too: it never reached the panel before" || true

end_test

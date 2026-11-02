#!/usr/bin/env bash
# ============================================================================
# 38 — Delegated invitations: the store and the refusals (Single-VM)
# ============================================================================
# The relay's side of delegated invitations on one VM (design: packages/core/
# docs/delegated-invitations-design.md, "Proof"); three-VM 53–55 are the
# people. Fixtures served by a stand-in registry on the VM (helpers.sh,
# write_identity_fixture_plugins).
#
# 1. The manifest: a role inviting one the block lacks, or one twice, is
#    refused at install (400) and leaves nothing. An update that lets a role
#    invite waits for an administrator (identity.changed, said in words) with
#    auto-approve on; narrowing it only changes the digest: auto-approved.
# 2. The policy's validation: every bound, an e-mail domain that is not one,
#    a field it does not know; enabling without a web surface (409); off, it
#    is kept lower-cased, without repeats; audited; a plugin that is not
#    there 404; an agent certificate 403.
# 3. The store: an administrator's invitation holds only the token's SHA-256,
#    nothing in state.db or its log holds the token, it is listed without one,
#    by kind; its link names the token in the fragment. A pending one is
#    revoked and the row kept, an ended one deleted, an accepted one refused
#    (409 invitation_has_user): it is the record of who joined.
# 4. invitations.json: imported once (tokens hashed, a pending one accepted
#    by POST, the marker written) and deleted; a second file is deleted
#    unread, audited, and opens nothing.
# 5. Both pages: their CSP names the script and the style served, stock and
#    branded; a rendering from before the pages' digest (rendered.json without
#    it) is rendered again.
# 6. The vhosts: the auth vhost's inviter location, the panel vhost's and the
#    IP vhost's literal Host on /api/invite/, accepted by lamaste-priv as
#    written.
# 7. lamaste-server invitations and plugins invitations.
#
# Sweeps, caps and acceptance need a hosted web surface: three-VM 53–55.
# ============================================================================

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/helpers.sh"

require_commands curl jq node npm nginx openssl sqlite3 runuser systemd-run xxd sha256sum

begin_test "38 — Delegated invitations: the store and the refusals (Single-VM)"

RUN_ID="$(date +%s)"
STATE_DIR="/etc/lamalibre/lamaste"
WORK_DIR="/tmp/lamalibre-lamaste-e2e-invitations-38"
AGENT_CERT_DIR="${WORK_DIR}/agent-cert"
WEB_ROOT="/var/www/lamaste/auth"
AVAILABLE="/etc/nginx/sites-available"
STUB_PORT=4874
STUB_URL="http://127.0.0.1:${STUB_PORT}"
STUB_ADMIN_TOKEN="feria_e2eadmin_invitations_0000000000"
STUB_UNIT="lamalibre-lamaste-e2e-38-stub"
PLUGIN="e2e-invr"
PACKAGE="@lamalibre/e2e-invr-server"
AGENT_LABEL_38="invitation-e2e-${RUN_ID}"
USER_ONE="e2e38-one"
USER_TWO="e2e38-two"
USER_IMPORTED="e2e38-imported"
# Test credentials for this run only, never printed
PASSWORD="E2e-$(openssl rand -hex 12)"
BRAND="E2E Brand 38"
ACCENT="#0f766e"
AUDIT_BASE=0

cleanup() {
  log_info "Cleaning up test resources..."
  systemctl stop "${STUB_UNIT}" > /dev/null 2>&1 || true
  api_delete "domains/${DOMAIN}/branding" > /dev/null 2>&1 || true
  api_post "plugins/${PLUGIN}/disable" > /dev/null 2>&1 || true
  api_delete "plugins/${PLUGIN}?force=true" > /dev/null 2>&1 || true
  api_delete "plugins/e2e-ident-badinvite?force=true" > /dev/null 2>&1 || true
  api_delete "plugins/e2e-ident-badinviterepeat?force=true" > /dev/null 2>&1 || true
  local u
  for u in "${USER_ONE}" "${USER_TWO}" "${USER_IMPORTED}"; do
    api_delete "users/${u}?erase=true" > /dev/null 2>&1 || true
  done
  api_delete "certs/agent/${AGENT_LABEL_38}" > /dev/null 2>&1 || true
  sudo rm -f "${STATE_DIR}/.npmrc" "${STATE_DIR}/invitations.json"
  sudo rm -rf "${WORK_DIR}"
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
}

# restart_panel — the panel restarted, answering again
restart_panel() {
  sudo systemctl restart lamalibre-lamaste-serverd
  wait_for_http "${PANEL_DIRECT_URL}/api/health" 60 || log_fail "The panel does not answer after a restart"
}

# policy_status <json> [path] — the status of PUT …/invitation-policy
policy_status() { status_of "$(call PUT "plugins/${2:-${PLUGIN}}/invitation-policy" "$1")"; }

# invite_post <lookup|accept> <json> — POST /api/invite/<…> on the panel's
# loopback port (public): the body, then the status
invite_post() {
  curl -s --max-time 15 -X POST -H 'Content-Type: application/json' -d "$2" -w '\n%{http_code}' "${PANEL_DIRECT_URL}/api/invite/$1" 2>/dev/null || echo "000"
}

# clear_token_count <token> — how many bytes of state.db and its log hold the
# token, as text
clear_token_count() { sudo cat "${STATE_DIR}"/state.db* | grep -caF "$1" || true; }

# token_digest <token> — hex SHA-256 of the token's 32 bytes
token_digest() { printf '%s' "$1" | xxd -r -p | sha256sum | cut -d' ' -f1; }

# row <invitation id> — the invitation as listed ('null' when gone)
row() { api_get "invitations" | jq -c --arg id "$1" '[.invitations[]? | select(.id == $id)] | first // null' 2>/dev/null || echo "null"; }

# inline_hash <script|style> — the CSP source of a page's inline element, from stdin
inline_hash() {
  node -e 'const h=require("fs").readFileSync(0,"utf8");const t=process.argv[1];const m=h.match(new RegExp("<"+t+">([\\s\\S]*?)</"+t+">"));process.stdout.write(m?"sha256-"+require("crypto").createHash("sha256").update(m[1],"utf8").digest("base64"):"none")' "$1"
}

# assert_page_runs <path> <what> — the page on auth.<DOMAIN> answers 200 and
# its CSP names the served inline script and style
assert_page_runs() {
  local dir="${WORK_DIR}/page" csp
  mkdir -p "$dir"
  curl -sk --max-time 15 --resolve "auth.${DOMAIN}:443:127.0.0.1" -D "$dir/headers" -o "$dir/body" -w '%{http_code}' "https://auth.${DOMAIN}$1" > "$dir/status" 2>/dev/null || echo 000 > "$dir/status"
  assert_eq "$(cat "$dir/status")" "200" "$2: 200" || true
  csp=$(tr -d '\r' < "$dir/headers" | sed -n 's/^[Cc]ontent-[Ss]ecurity-[Pp]olicy: //p')
  assert_contains "${csp}" "script-src '$(inline_hash script < "$dir/body")'" "…its CSP names the script served" || true
  assert_contains "${csp}" "'$(inline_hash style < "$dir/body")'" "…and the style served" || true
  assert_contains "${csp}" "frame-ancestors 'none'" "…nothing frames it" || true
  assert_contains "$(tr '[:upper:]' '[:lower:]' < "$dir/headers")" "x-frame-options: deny" "…X-Frame-Options: DENY" || true
  assert_not_contains "$(cat "$dir/body")" "cdn.jsdelivr" "…no foreign script" || true
}

# cli_json <args...> — lamaste-server <args> --json: its last JSON line
cli_json() { sudo lamaste-server "$@" --json 2>/dev/null | grep -E '^\{' | tail -n 1 || echo '{}'; }

# ---------------------------------------------------------------------------
log_section "Pre-flight: onboarding complete"
# ---------------------------------------------------------------------------

ONBOARDING=$(api_get "onboarding/status" 2>/dev/null || echo '{}')
if [ "$(json_get "$ONBOARDING" '.status')" != "COMPLETED" ]; then
  log_fail "Onboarding is not complete (provision the 'provisioned' tier)"
  end_test
  exit $?
fi
DOMAIN=$(json_get "$ONBOARDING" '.domain')
log_pass "Onboarding is complete (${DOMAIN})"
# Leftovers of an interrupted run (rodeo ends a spec at ten minutes without its trap)
cleanup
mkdir -p "${WORK_DIR}" "${AGENT_CERT_DIR}"
chmod 700 "${AGENT_CERT_DIR}"
AUDIT_BASE=$(api_get "audit?limit=1" | jq '.entries[0].id // 0' 2>/dev/null || echo "0")

# ===========================================================================
# 1. The manifest
# ===========================================================================

log_section "Stand-in registry with the fixtures"

write_stub_registry "${WORK_DIR}/stub-registry.mjs"
write_identity_fixture_plugins "${WORK_DIR}/fixtures"
systemctl stop "${STUB_UNIT}" > /dev/null 2>&1 || true
systemd-run --quiet --collect --unit "${STUB_UNIT}" --setenv=PATH="${PATH}" --setenv=HOME=/root \
  "$(command -v node)" "${WORK_DIR}/stub-registry.mjs" --port "${STUB_PORT}" --admin-token "${STUB_ADMIN_TOKEN}" \
  --issuer "https://auth.${DOMAIN}" --audience "${STUB_URL}" --jwks-url http://127.0.0.1:9091/jwks.json \
  --package "${WORK_DIR}/fixtures/inv1" --package "${WORK_DIR}/fixtures/inv2" --package "${WORK_DIR}/fixtures/inv3" \
  --package "${WORK_DIR}/fixtures/badinvite" --package "${WORK_DIR}/fixtures/badinviterepeat"
if wait_for_http "${STUB_URL}/-/ping" 60; then
  log_pass "Stand-in registry is up on ${STUB_URL}"
else
  log_fail "Stand-in registry did not start: $(journalctl -u "${STUB_UNIT}" --no-pager -o cat 2>/dev/null | tail -n 5)"
  end_test
  exit $?
fi
printf '@lamalibre:registry=%s/\n//127.0.0.1:%s/:_authToken=%s\n' "${STUB_URL}" "${STUB_PORT}" "${STUB_ADMIN_TOKEN}" > "${WORK_DIR}/npmrc"
install -o lamaste -g lamaste -m 0600 "${WORK_DIR}/npmrc" "${STATE_DIR}/.npmrc"

log_section "A role's invites are checked at install"

RESP=$(call POST "plugins/install" '{"packageName":"@lamalibre/e2e-ident-badinvite-server@1.0.0"}')
assert_eq "$(status_of "$RESP")" "400" "A role inviting one the block lacks: 400" || true
assert_contains "$(body_of "$RESP")" "invites only roles the block declares" "…the issue named" || true
assert_eq "$(status_of "$(call GET "plugins/e2e-ident-badinvite")")" "404" "…nothing left" || true
RESP=$(call POST "plugins/install" '{"packageName":"@lamalibre/e2e-ident-badinviterepeat-server@1.0.0"}')
assert_eq "$(status_of "$RESP")" "400" "A role inviting one twice: 400" || true
assert_contains "$(body_of "$RESP")" "invites must not repeat" "…the issue named" || true

log_section "An update that lets a role invite waits for an administrator"

INSTALL=$(api_post "plugins/install" "{\"packageName\":\"${PACKAGE}@1.0.0\"}")
assert_json_field "$INSTALL" '.plugin.version' '1.0.0' "${PACKAGE}@1.0.0 installed: roles, no one invites" || true
DIGEST=$(json_get "$(api_get "plugins/${PLUGIN}/hooks")" '.hooks.approval.digest // empty')
APPROVED=$(api_post "plugins/${PLUGIN}/hooks/approve" "{\"digest\":\"${DIGEST}\"}")
assert_json_field "$APPROVED" '.hooks.approval.state' 'approved' "…approved" || true
api_post "plugins/${PLUGIN}/enable" > /dev/null
AUTO=$(call PUT "plugins/${PLUGIN}/hooks/auto-approve" '{"enabled":true}')
assert_json_field "$(body_of "$AUTO")" '.autoApprove' 'true' "Auto-approve is on" || true
assert_eq "$(api_get "plugins/${PLUGIN}/invitation-policy" | jq -c '.invitingRoles')" "[]" "No inviting role yet" || true

UPDATE=$(api_post "plugins/${PLUGIN}/update" '{"version":"2.0.0"}')
assert_json_field "$UPDATE" '.pendingUpdate.version' '2.0.0' "2.0.0 lets a role invite: it waits, auto-approve on" || true
assert_json_field "$UPDATE" '[.pendingUpdate.approvalRequired[]?.code] | index("identity.changed") != null' 'true' "…identity.changed" || true
assert_contains "$(json_get "$UPDATE" '[.pendingUpdate.approvalRequired[]?.reason] | join("; ")')" "lets coordinator invite people as coordinator, viewer" "…said in words" || true
assert_json_field "$UPDATE" '.pendingUpdate.identity.invitesAdded | map("\(.role):\(.roles | join("+"))") | join(",")' 'coordinator:coordinator+viewer' "The preview: what the role may now give" || true
assert_json_field "$UPDATE" '(.pendingUpdate.autoApproveWithheld // []) | length > 0' 'true' "Auto-approve withheld" || true
assert_json_field "$(api_get "plugins/${PLUGIN}")" '.plugin.version' '1.0.0' "1.0.0 stays until it is approved" || true
APPROVED=$(api_post "plugins/${PLUGIN}/hooks/approve" "{\"digest\":\"$(json_get "$UPDATE" '.pendingUpdate.digest')\"}")
OP=$(wait_operation "$(json_get "$APPROVED" '.operation.id // empty')" 120)
assert_json_field "$OP" '.status' 'succeeded' "Approved, 2.0.0 is installed ($(json_get "$OP" '.error // ""'))" || true
assert_json_field "$(api_get "plugins/${PLUGIN}/invitation-policy")" '.invitingRoles | map("\(.role):\(.invites | join("+"))") | join(",")' 'coordinator:coordinator+viewer' "The policy lists the inviting role" || true

UPDATE=$(api_post "plugins/${PLUGIN}/update" '{"version":"3.0.0"}')
assert_eq "$(json_get "$UPDATE" '.pendingUpdate.version // "none"')" "none" "3.0.0 narrows it: nothing waits" || true
OP=$(wait_operation "$(json_get "$UPDATE" '.operation.id // empty')" 120)
assert_json_field "$OP" '.status' 'succeeded' "…auto-approved, installed ($(json_get "$OP" '.error // ""'))" || true
assert_json_field "$(api_get "plugins/${PLUGIN}/invitation-policy")" '.invitingRoles | map("\(.role):\(.invites | join("+"))") | join(",")' 'coordinator:viewer' "The inviting role now gives one role" || true

# ===========================================================================
# 2. The policy
# ===========================================================================

log_section "The policy's validation"

VIEW=$(api_get "plugins/${PLUGIN}/invitation-policy")
assert_json_field "$VIEW" '"\(.enabled) \(.maxOpenPerInviter) \(.maxJoined) \(.lifetimeDays) \(.emailDomains | length)"' 'false 10 50 7 0' "Off, the defaults" || true
assert_json_field "$VIEW" '.available' 'false' "…not available" || true
assert_eq "$(policy_status '{"enabled":true,"emailDomains":[]}')" "400" "Enabled with no e-mail domain: 400" || true
assert_eq "$(policy_status '{"enabled":false}')" "400" "No emailDomains at all: 400" || true
for bad in '"maxOpenPerInviter":0' '"maxOpenPerInviter":101' '"maxJoined":0' '"maxJoined":501' '"lifetimeDays":0' '"lifetimeDays":31' '"maxJoined":2.5'; do
  assert_eq "$(policy_status "{\"enabled\":false,\"emailDomains\":[],${bad}}")" "400" "{${bad}}: 400" || true
done
assert_eq "$(policy_status '{"enabled":false,"emailDomains":["not a domain"]}')" "400" "An e-mail domain that is not one: 400" || true
assert_eq "$(policy_status '{"enabled":false,"emailDomains":[],"role":"admins"}')" "400" "A field it does not know: 400" || true
assert_eq "$(policy_status '{"enabled":false,"emailDomains":[]}' e2e-not-installed)" "404" "A plugin that is not there: 404" || true
RESP=$(call PUT "plugins/${PLUGIN}/invitation-policy" '{"enabled":true,"emailDomains":["example.test"]}')
assert_eq "$(status_of "$RESP")" "409" "Enabled with no web surface: 409" || true
assert_json_field "$(body_of "$RESP")" '.code' 'invitations_unavailable' "…invitations_unavailable" || true
assert_contains "$(json_get "$(body_of "$RESP")" '.error')" "no web surface of its own" "…it says why" || true
RESP=$(call PUT "plugins/${PLUGIN}/invitation-policy" '{"enabled":false,"emailDomains":["Example.TEST","example.test","client.example"],"maxOpenPerInviter":3,"maxJoined":20,"lifetimeDays":5}')
assert_eq "$(status_of "$RESP")" "200" "Saved off" || true
assert_json_field "$(body_of "$RESP")" '"\(.emailDomains | join(",")) \(.maxOpenPerInviter) \(.maxJoined) \(.lifetimeDays)"' 'client.example,example.test 3 20 5' "…lower-cased, no repeats, sorted" || true
assert_eq "$(api_get "audit?action=invitation.policy.updated&plugin=${PLUGIN}&limit=50" | jq --argjson b "${AUDIT_BASE}" '[.entries[]? | select(.id > $b)] | length')" "1" "Audited once: a refused change is not one" || true

CERT_RESPONSE=$(api_post "certs/agent" "{\"label\":\"${AGENT_LABEL_38}\",\"capabilities\":[\"tunnels:read\"]}")
assert_json_field "$CERT_RESPONSE" '.ok' 'true' "A throwaway agent enrolled" || true
P12_PASS=$(echo "$CERT_RESPONSE" | jq -r '.p12Password' 2>/dev/null || echo "")
sudo openssl pkcs12 -in "${STATE_DIR}/pki/agents/${AGENT_LABEL_38}/client.p12" -out "${AGENT_CERT_DIR}/client.crt" -clcerts -nokeys -passin pass:"${P12_PASS}" 2>/dev/null
sudo openssl pkcs12 -in "${STATE_DIR}/pki/agents/${AGENT_LABEL_38}/client.p12" -out "${AGENT_CERT_DIR}/client.key" -nocerts -nodes -passin pass:"${P12_PASS}" 2>/dev/null
sudo chmod 600 "${AGENT_CERT_DIR}/client.key"
unset P12_PASS
for path in "plugins/${PLUGIN}/invitation-policy" "invitations"; do
  AGENT_STATUS=$(sudo curl -sk --max-time 30 -o /dev/null -w '%{http_code}' --cert "${AGENT_CERT_DIR}/client.crt" --key "${AGENT_CERT_DIR}/client.key" --cacert "${STATE_DIR}/pki/ca.crt" "${BASE_URL}/api/${path}" 2>/dev/null || echo "000")
  assert_eq "${AGENT_STATUS}" "403" "An agent certificate on GET /api/${path}: 403" || true
done

# ===========================================================================
# 3. The store
# ===========================================================================

log_section "An administrator's invitation: the token shown once, its digest kept"

RESP=$(api_post "invitations" "{\"username\":\"${USER_ONE}\",\"email\":\"${USER_ONE}@example.test\"}")
assert_json_field "$RESP" '.ok' 'true' "Invitation for ${USER_ONE}" || true
TOKEN=$(json_get "$RESP" '.token // empty')
ID_ONE=$(json_get "$RESP" '.invitation.id // empty')
assert_eq "$(json_get "$RESP" '.inviteUrl')" "https://auth.${DOMAIN}/invite#${TOKEN}" "The link carries the token in its fragment" || true
assert_eq "$(clear_token_count "${TOKEN}")" "0" "Nothing in state.db or its log holds the token" || true
assert_eq "$(sudo sqlite3 "${STATE_DIR}/state.db" "SELECT token_sha256 FROM invitations WHERE id = '${ID_ONE}'")" "$(token_digest "${TOKEN}")" "It holds the token's SHA-256" || true
if sudo test -e "${STATE_DIR}/invitations.json"; then log_fail "invitations.json was written"; else log_pass "invitations.json is not written"; fi
LISTED=$(api_get "invitations?kind=admin")
assert_json_field "$LISTED" "[.invitations[] | select(.id == \"${ID_ONE}\") | \"\(.kind) \(.status) \(.token)\"] | first" 'admin pending null' "Listed: an administrator's, pending, no token" || true
assert_eq "$(api_get "invitations?kind=delegated" | jq --arg id "${ID_ONE}" '[.invitations[] | select(.id == $id)] | length')" "0" "…not among the delegated ones" || true
assert_eq "$(status_of "$(call GET "invitations?limit=2001")")" "400" "?limit past the most: 400" || true
assert_json_field "$(api_get "invitations?limit=1")" '.invitations | length' '1' "?limit=1: one" || true

log_section "Revoked, deleted, refused"

RESP=$(call DELETE "invitations/${ID_ONE}")
assert_json_field "$(body_of "$RESP")" '.action' 'revoked' "A pending one is revoked" || true
assert_json_field "$(row "${ID_ONE}")" '"\(.status) \(.revokedReason)"' 'revoked admin' "…the row kept, by the administrator" || true
assert_eq "$(status_of "$(invite_post lookup "{\"token\":\"${TOKEN}\"}")")" "410" "Its token: 410" || true
RESP=$(call DELETE "invitations/${ID_ONE}")
assert_json_field "$(body_of "$RESP")" '.action' 'deleted' "An ended one is deleted" || true
assert_eq "$(row "${ID_ONE}")" "null" "…gone" || true
assert_eq "$(status_of "$(invite_post lookup "{\"token\":\"${TOKEN}\"}")")" "404" "Its token: 404" || true

RESP=$(api_post "invitations" "{\"username\":\"${USER_TWO}\",\"email\":\"${USER_TWO}@example.test\"}")
TOKEN=$(json_get "$RESP" '.token // empty')
ID_TWO=$(json_get "$RESP" '.invitation.id // empty')
ACCEPT=$(invite_post accept "$(jq -c -n --arg t "${TOKEN}" --arg p "${PASSWORD}" '{token: $t, password: $p}')")
assert_eq "$(status_of "$ACCEPT")" "200" "Accepted by POST" || true
assert_contains "$(json_get "$(body_of "$ACCEPT")" '.totpQr')" "data:image/svg+xml;base64," "…the QR drawn by the panel" || true
assert_json_field "$(row "${ID_TWO}")" '"\(.status) \(.email)"' 'accepted null' "…accepted, the address's copy gone" || true
RESP=$(call DELETE "invitations/${ID_TWO}")
assert_eq "$(status_of "$RESP")" "409" "An accepted one is the record of who joined: 409" || true
assert_json_field "$(body_of "$RESP")" '.code' 'invitation_has_user' "…invitation_has_user" || true

log_section "A username an open invitation names is held"

RESP=$(api_post "invitations" "{\"username\":\"${USER_ONE}\",\"email\":\"${USER_ONE}@example.test\"}")
ID_ONE=$(json_get "$RESP" '.invitation.id // empty')
RESP=$(call POST "users" "{\"username\":\"${USER_ONE}\",\"displayname\":\"E2E One\",\"email\":\"${USER_ONE}@example.test\",\"password\":\"${PASSWORD}\",\"groups\":[]}")
assert_eq "$(status_of "$RESP")" "409" "Creating a user under it: 409" || true
assert_json_field "$(body_of "$RESP")" '.code' 'username_invited' "…username_invited" || true
call DELETE "invitations/${ID_ONE}" > /dev/null

# ===========================================================================
# 4. invitations.json
# ===========================================================================

log_section "invitations.json: imported once, then deleted"

# A relay that never imported: the marker of the first start taken away, the
# panel stopped (its tick would write the marker again before the file is there).
assert_eq "$(sudo sqlite3 "${STATE_DIR}/state.db" 'SELECT COUNT(*) FROM invitations_import')" "1" "The first start recorded that nothing is left to import" || true
sudo systemctl stop lamalibre-lamaste-serverd
sudo runuser -u lamaste -- sqlite3 "${STATE_DIR}/state.db" 'DELETE FROM invitations_import;'
LEGACY_TOKEN=$(openssl rand -hex 32)
LEGACY_ID=$(node -e 'console.log(crypto.randomUUID())')
NOW=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)
LATER=$(date -u -d '+3 days' +%Y-%m-%dT%H:%M:%S.000Z)
jq -c -n --arg id "${LEGACY_ID}" --arg t "${LEGACY_TOKEN}" --arg u "${USER_IMPORTED}" --arg n "${NOW}" --arg l "${LATER}" --arg d "${DOMAIN}" \
  '[{id: $id, token: $t, username: $u, email: ($u + "@example.test"), groups: [], domains: [{name: $d, kind: "member"}], createdAt: $n, expiresAt: $l, used: false, acceptedAt: null}]' > "${WORK_DIR}/invitations.json"
sudo install -o lamaste -g lamaste -m 0600 "${WORK_DIR}/invitations.json" "${STATE_DIR}/invitations.json"
sudo systemctl start lamalibre-lamaste-serverd
wait_for_http "${PANEL_DIRECT_URL}/api/health" 60 || log_fail "The panel does not answer after its start"
if wait_for 30 sudo test ! -e "${STATE_DIR}/invitations.json"; then
  log_pass "The file is gone after the start"
else
  log_fail "invitations.json is still there"
fi
assert_json_field "$(row "${LEGACY_ID}")" '"\(.kind) \(.username) \(.status)"' "admin ${USER_IMPORTED} pending" "Its invitation is in the store" || true
assert_eq "$(clear_token_count "${LEGACY_TOKEN}")" "0" "…no clear token" || true
assert_eq "$(sudo sqlite3 "${STATE_DIR}/state.db" "SELECT token_sha256 FROM invitations WHERE id = '${LEGACY_ID}'")" "$(token_digest "${LEGACY_TOKEN}")" "…its SHA-256" || true
assert_eq "$(sudo sqlite3 "${STATE_DIR}/state.db" 'SELECT COUNT(*) FROM invitations_import')" "1" "The marker is written" || true
assert_eq "$(status_of "$(invite_post lookup "{\"token\":\"${LEGACY_TOKEN}\"}")")" "200" "The old token opens it by POST" || true
ACCEPT=$(invite_post accept "$(jq -c -n --arg t "${LEGACY_TOKEN}" --arg p "${PASSWORD}" '{token: $t, password: $p}')")
assert_eq "$(status_of "$ACCEPT")" "200" "…and accepts" || true

log_section "A file that comes back is deleted unread"

SECOND_TOKEN=$(openssl rand -hex 32)
SECOND_ID=$(node -e 'console.log(crypto.randomUUID())')
jq -c -n --arg id "${SECOND_ID}" --arg t "${SECOND_TOKEN}" --arg n "${NOW}" --arg l "${LATER}" \
  '[{id: $id, token: $t, username: "e2e38-revived", email: "e2e38-revived@example.test", groups: ["admins"], domains: [], createdAt: $n, expiresAt: $l, used: false, acceptedAt: null}]' > "${WORK_DIR}/invitations.json"
sudo install -o lamaste -g lamaste -m 0600 "${WORK_DIR}/invitations.json" "${STATE_DIR}/invitations.json"
restart_panel
if wait_for 30 sudo test ! -e "${STATE_DIR}/invitations.json"; then
  log_pass "The second file is gone"
else
  log_fail "The second invitations.json is still there"
fi
assert_eq "$(row "${SECOND_ID}")" "null" "…nothing was imported from it" || true
assert_eq "$(status_of "$(invite_post lookup "{\"token\":\"${SECOND_TOKEN}\"}")")" "404" "…its token opens nothing" || true
assert_eq "$(api_get "audit?action=invitation.import.refused&limit=50" | jq --argjson b "${AUDIT_BASE}" '[.entries[]? | select(.id > $b)] | length')" "1" "Audited invitation.import.refused" || true

# ===========================================================================
# 5. Both pages
# ===========================================================================

log_section "Both pages, stock: the CSP names what is served"

assert_page_runs "/invite" "The invitation page"
assert_page_runs "/invite/$(printf 'a%.0s' {1..64})" "…at an old link's path"
assert_page_runs "/invitations/${PLUGIN}" "The inviter's page"

log_section "Branded: the same script and style, the colours in /brand.css"

STOCK_INVITE=$(curl -sk --max-time 15 --resolve "auth.${DOMAIN}:443:127.0.0.1" "https://auth.${DOMAIN}/invite")
RESP=$(call PUT "domains/${DOMAIN}/branding" "{\"name\":\"${BRAND}\",\"theme\":\"light\",\"accent\":\"${ACCENT}\"}")
assert_eq "$(status_of "$RESP")" "200" "A brand on ${DOMAIN}" || true
rendered_current() { [ "$(api_get "domains/${DOMAIN}/branding" | jq -r '.branding.renderedCurrent' 2>/dev/null)" = "true" ]; }
if wait_for 30 rendered_current; then log_pass "…rendered"; else log_fail "…not rendered"; fi
assert_page_runs "/invite" "The branded invitation page"
assert_page_runs "/invitations/${PLUGIN}" "The branded inviter's page"
BRANDED_INVITE=$(curl -sk --max-time 15 --resolve "auth.${DOMAIN}:443:127.0.0.1" "https://auth.${DOMAIN}/invite")
assert_contains "${BRANDED_INVITE}" "<title>${BRAND} — Accept Invitation</title>" "…the brand's title" || true
assert_eq "$(printf '%s' "${BRANDED_INVITE}" | inline_hash script)" "$(printf '%s' "${STOCK_INVITE}" | inline_hash script)" "…one script for every brand" || true
assert_eq "$(printf '%s' "${BRANDED_INVITE}" | inline_hash style)" "$(printf '%s' "${STOCK_INVITE}" | inline_hash style)" "…one style" || true
assert_contains "$(curl -sk --max-time 15 --resolve "auth.${DOMAIN}:443:127.0.0.1" "https://auth.${DOMAIN}/brand.css")" "--lamaste-page-accent: ${ACCENT};" "/brand.css carries the accent" || true

log_section "A rendering from before the pages' digest is rendered again"

DIGEST_NOW=$(sudo jq -r '.pagesDigest // "none"' "${WEB_ROOT}/${DOMAIN}/rendered.json")
assert_eq "$(printf '%s' "${DIGEST_NOW}" | grep -cE '^[0-9a-f]{64}$' || true)" "1" "rendered.json holds the pages' digest" || true
sudo bash -c "jq 'del(.pagesDigest)' ${WEB_ROOT}/${DOMAIN}/rendered.json > ${WORK_DIR}/rendered.json && cat ${WORK_DIR}/rendered.json > ${WEB_ROOT}/${DOMAIN}/rendered.json"
digest_back() { [ "$(sudo jq -r '.pagesDigest // "none"' "${WEB_ROOT}/${DOMAIN}/rendered.json" 2>/dev/null)" = "${DIGEST_NOW}" ]; }
if wait_for 90 digest_back; then
  log_pass "The minute reconcile rendered it again"
else
  log_fail "rendered.json still has no digest"
fi
assert_page_runs "/invite" "…and the page still runs"
RESP=$(call DELETE "domains/${DOMAIN}/branding")
assert_eq "$(status_of "$RESP")" "200" "The brand removed" || true

# ===========================================================================
# 6. The vhosts
# ===========================================================================

log_section "The vhosts, accepted by lamaste-priv as written"

AUTH_NAME=$(vhost_name auth "${DOMAIN}")
AUTH_VHOST=$(sudo cat "${AVAILABLE}/${AUTH_NAME}")
assert_contains "${AUTH_VHOST}" "location ^~ /api/delegated-invitations/" "The auth vhost has the inviter's API" || true
assert_contains "${AUTH_VHOST}" "/authz/delegated-invitations/${DOMAIN}" "…asking Gatekeeper, naming the domain" || true
assert_contains "${AUTH_VHOST}" "client_max_body_size 16k" "…a small body limit" || true
assert_contains "${AUTH_VHOST}" "proxy_set_header Host auth.${DOMAIN};" "…a literal Host" || true
assert_contains "${AUTH_VHOST}" 'proxy_set_header X-Forwarded-Host "";' "…a client's X-Forwarded-Host cleared" || true
if sudo cat "${AVAILABLE}/${AUTH_NAME}" | sudo /usr/local/sbin/lamaste-priv nginx-site write "${AUTH_NAME}" > /dev/null 2>&1; then
  log_pass "lamaste-priv nginx-site write accepts the auth vhost as installed"
else
  log_fail "lamaste-priv nginx-site write refused the auth vhost"
fi
for name in lamalibre-lamaste-panel-ip lamalibre-lamaste-panel-domain; do
  if ! sudo test -e "${AVAILABLE}/${name}"; then
    log_info "${name} is not installed here"
    continue
  fi
  VHOST=$(sudo cat "${AVAILABLE}/${name}")
  assert_contains "${VHOST}" "location /api/invite/ {" "${name}: /api/invite/" || true
  assert_contains "$(printf '%s\n' "${VHOST}" | sed -n '/location \/api\/invite\/ {/,/}/p')" "proxy_set_header Host 127.0.0.1;" "…a literal Host no portal is" || true
done
if sudo nginx -t > /dev/null 2>&1; then log_pass "nginx -t passes"; else log_fail "nginx -t fails"; fi

# ===========================================================================
# 7. The CLI
# ===========================================================================

log_section "lamaste-server invitations and plugins invitations"

assert_json_field "$(cli_json plugins invitations "${PLUGIN}")" '.policy.maxOpenPerInviter // .maxOpenPerInviter' '3' "plugins invitations ${PLUGIN}: the policy" || true
OUT=$(cli_json plugins invitations "${PLUGIN}" set --email-domains example.test --max-open 4 --max-joined 9 --lifetime-days 6)
assert_json_field "$OUT" '(.policy // .) | "\(.emailDomains | join(",")) \(.maxOpenPerInviter) \(.maxJoined) \(.lifetimeDays)"' 'example.test 4 9 6' "…set: the fields it names" || true
assert_json_field "$(api_get "plugins/${PLUGIN}/invitation-policy")" '"\(.enabled) \(.maxOpenPerInviter)"' 'false 4' "…through the panel; still off" || true
sudo lamaste-server plugins invitations "${PLUGIN}" set --enable --json > "${WORK_DIR}/enable.out" 2>&1 || true
assert_contains "$(cat "${WORK_DIR}/enable.out")" "no web surface of its own" "--enable says why it is refused" || true
RESP=$(api_post "invitations" "{\"username\":\"${USER_ONE}\",\"email\":\"${USER_ONE}@example.test\"}")
ID_ONE=$(json_get "$RESP" '.invitation.id // empty')
LIST=$(cli_json invitations list)
assert_json_field "$LIST" "[.invitations[] | select(.id == \"${ID_ONE}\") | .status] | first" 'pending' "invitations list: it is there" || true
OUT=$(cli_json invitations revoke "${ID_ONE}")
assert_json_field "$OUT" '.action' 'revoked' "invitations revoke: revoked" || true
OUT=$(cli_json invitations disable-invitees "$(sudo sqlite3 "${STATE_DIR}/state.db" "SELECT user_id FROM directory_users WHERE username = '${USER_TWO}'")")
assert_json_field "$OUT" '.disabled | length' '0' "invitations disable-invitees: someone who invited nobody disables nobody" || true

end_test

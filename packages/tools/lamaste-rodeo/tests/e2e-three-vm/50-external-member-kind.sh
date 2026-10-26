#!/usr/bin/env bash
# ============================================================================
# 50 — External members: changing the kind (Three-VM)
# ============================================================================
# The second acceptance case of external members (design: packages/core/
# docs/external-members-design.md, "Proof"). B is a second base domain
# (multi-domain-harness.sh); an authenticated tunnel on it whose backend
# answers with the identity headers it was sent.
#
# 1. A member reaches the tunnel. Turned external, the same session is
#    refused within the settle time (the access-request page), audited
#    (directory.membership.changed, by directory id); turned back, it is
#    let through again — Authelia never restarted.
# 2. Authelia groups and external members never meet: making a user who
#    holds one (`e2e50team`) external is refused (409
#    external_member_groups), so is giving one to an external member; a
#    group name Lamaste could own (a dot, a colon) is refused (400
#    reserved_group).
# 3. Lamaste's own groups stay Authelia's: users.yml holds them, but
#    GET /api/users never lists one, and the backend's Remote-Groups carries
#    the administrator's groups only.
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../e2e/helpers.sh"
# shellcheck source-path=SCRIPTDIR source=app-plugin-harness.sh
source "${SCRIPT_DIR}/app-plugin-harness.sh"
MD_SPEC=50
# shellcheck source-path=SCRIPTDIR source=multi-domain-harness.sh
source "${SCRIPT_DIR}/multi-domain-harness.sh"

require_commands multipass curl jq perl openssl

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

MEM="e2e50-member"
GRP="e2e50-grouped"
EXT="e2e50-ext"
TEAM="e2e50team"
# Test credentials for this run only, never printed
MEM_PASSWORD="E2e-$(openssl rand -hex 12)"
GRP_PASSWORD="E2e-$(openssl rand -hex 12)"
EXT_PASSWORD="E2e-$(openssl rand -hex 12)"
MEM_ID=""
GRP_ID=""
EXT_ID=""
JAR_MEM=$(md_jar member)
JAR_GRP=$(md_jar grouped)
SUB="e2e50a"
PORT=18501
TUNNEL=""
URL=""
MARKER="E2E_50_$(date +%s)"
REMOTE_DIR="/var/tmp/e2e-50-backend"
BACKEND_UNIT="e2e-50-backend"
LOCAL_TMP=""
AUTHELIA_PID=""
AUDIT_BASE=0

# write_headers_backend <file> — headers-backend.py: /index.html answers the
# marker, /e2e-headers the identity headers it was sent (Remote-User,
# Remote-Groups) as JSON
#
#   python3 headers-backend.py <port> <marker>
write_headers_backend() {
  cat > "$1" << 'BACKEND_EOF'
import json
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/e2e-headers":
            body = json.dumps({
                "user": self.headers.get("Remote-User"),
                "groups": self.headers.get("Remote-Groups"),
            }).encode()
            kind = "application/json"
        else:
            body = (MARKER + "\n").encode()
            kind = "text/html"
        self.send_response(200)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        pass


port, MARKER = int(sys.argv[1]), sys.argv[2]
ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
BACKEND_EOF
}

# changed_kind <userId> — the directory.membership.changed entries of a user since the spec began, "<from>-><to>", comma-separated
changed_kind() {
  host_api_get "audit?action=directory.membership.changed&limit=200" 2>/dev/null |
    jq -r --arg id "$1" --argjson base "${AUDIT_BASE}" '[.entries[]? | select(.id > $base and .details.userId == $id) | "\(.details.from)->\(.details.to)"] | reverse | join(",")' 2>/dev/null || echo ""
}

begin_test "50 — External members: changing the kind (Three-VM)"

cleanup() {
  log_info "Cleaning up test resources..."
  local id
  if [ -n "${TUNNEL}" ]; then host_api_delete "tunnels/${TUNNEL}" > /dev/null 2>&1 || true; fi
  timed_exec 30 multipass exec "${AGENT_VM}" -- sudo bash -c "systemctl stop ${BACKEND_UNIT} > /dev/null 2>&1; rm -rf ${REMOTE_DIR}; true" > /dev/null 2>&1
  for id in "${MEM}" "${GRP}" "${EXT}"; do
    host_api_delete "users/${id}?erase=true" > /dev/null 2>&1 || true
  done
  if [ -n "${LOCAL_TMP}" ]; then rm -rf "${LOCAL_TMP}"; fi
  md_cleanup
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
log_section "Pre-flight"
# ---------------------------------------------------------------------------

md_preflight
AUDIT_BASE=$(host_api_get "audit?limit=1" 2>/dev/null | jq -r '[.entries[]?.id] | max // 0' 2>/dev/null || echo 0)

# ===========================================================================
# 1. B, three users, the tunnel
# ===========================================================================

log_section "Domain B; a member, a member with an Authelia group, an external member"

md_domain_active "${DOMAIN_2}"
md_user MEM_ID "${MEM}" "${MEM_PASSWORD}" "[\"${DOMAIN_2}\"]"
host_api_delete "users/${GRP}?erase=true" > /dev/null 2>&1 || true
RESP=$(users_call POST "users" "{\"username\":\"${GRP}\",\"displayname\":\"E2E ${GRP}\",\"email\":\"${GRP}@example.test\",\"password\":\"${GRP_PASSWORD}\",\"groups\":[\"${TEAM}\"],\"domains\":[\"${DOMAIN_2}\"]}")
assert_eq "$(status_of "$RESP")" "201" "User ${GRP} created, member of B, in the Authelia group ${TEAM}" || true
GRP_ID=$(json_get "$(body_of "$RESP")" '.user.userId // empty')
md_user EXT_ID "${EXT}" "${EXT_PASSWORD}" "[{\"name\":\"${DOMAIN_2}\",\"kind\":\"external\"}]"
assert_eq "$(is_uuid "${MEM_ID}") $(is_uuid "${GRP_ID}") $(is_uuid "${EXT_ID}")" "true true true" "Each has a directory id" || true

log_section "An authenticated tunnel on B; its backend echoes the identity headers"

md_tunnel TUNNEL "${SUB}" "${DOMAIN_2}" "${PORT}" authenticated
URL="https://${SUB}.${DOMAIN_2}/index.html"
LOCAL_TMP=$(mktemp -d /tmp/e2e-50-XXXXXXXX)
write_headers_backend "${LOCAL_TMP}/headers-backend.py"
agent_exec "systemctl stop ${BACKEND_UNIT} > /dev/null 2>&1; rm -rf ${REMOTE_DIR} && mkdir -p ${REMOTE_DIR}" > /dev/null 2>&1 || true
multipass transfer "${LOCAL_TMP}/headers-backend.py" "${AGENT_VM}:/tmp/e2e-50-headers-backend.py"
agent_exec "install -m 0644 /tmp/e2e-50-headers-backend.py ${REMOTE_DIR}/headers-backend.py && rm -f /tmp/e2e-50-headers-backend.py && systemd-run --quiet --collect --unit ${BACKEND_UNIT} --uid=nobody --gid=nogroup python3 ${REMOTE_DIR}/headers-backend.py ${PORT} ${MARKER}" > /dev/null 2>&1 || true
nudge_sync
if wait_for 120 tunnel_reachable "${PORT}" "${MARKER}"; then
  log_pass "Port ${PORT}: the backend answers through chisel"
else
  log_fail "Port ${PORT}: the backend does not answer through chisel"
fi

KEY_B=$(domain_group_key "${DOMAIN_2}")
assert_eq "$(printf '%s\n' "${KEY_B}" | grep -cE '^[0-9a-f]{16}$' || true)" "1" "B's rules name its group key" || true
wait_group holds "${MEM}" "lamaste:m:${KEY_B}" "users.yml gives ${MEM} B's member group"

log_section "Signed in at auth.B; Authelia's MainPID from here on"

SECRET_MEM=$(reset_totp "${MEM}")
SECRET_GRP=$(reset_totp "${GRP}")
md_wait_authelia "${DOMAIN_2}"
md_sign_in "${MEM}" "${MEM_PASSWORD}" "${SECRET_MEM}" "${JAR_MEM}" "${SUB}.${DOMAIN_2}"
md_sign_in "${GRP}" "${GRP_PASSWORD}" "${SECRET_GRP}" "${JAR_GRP}" "${SUB}.${DOMAIN_2}"
AUTHELIA_PID=$(authelia_pid)
assert_not_eq "${AUTHELIA_PID:-0}" "0" "Authelia runs (MainPID ${AUTHELIA_PID})" || true
assert_served "${JAR_MEM}" "${URL}" "${MARKER}" "${MEM} on B's authenticated tunnel"

# ===========================================================================
# 2. Lamaste's groups never leave Authelia
# ===========================================================================

log_section "Lamaste's own groups: in users.yml, never shown, never passed on"

wait_group holds "${GRP}" "lamaste:m:${KEY_B}" "users.yml gives ${GRP} B's member group beside ${TEAM}"
assert_contains ",$(user_groups "${GRP}")," ",${TEAM}," "…and keeps ${TEAM}" || true
USERS=$(host_api_get "users" 2>/dev/null || echo '{}')
assert_eq "$(echo "$USERS" | jq -r --arg u "${GRP}" '[.users[]? | select(.username == $u) | .groups[]?] | join(",")')" "${TEAM}" "GET /api/users lists ${GRP}'s groups as ${TEAM} alone" || true
assert_eq "$(echo "$USERS" | jq '[.users[]?.groups[]? | select(startswith("lamaste:") or contains("."))] | length')" "0" "…and no user's list holds a group of Lamaste's (lamaste:… or a hostname)" || true

RESP=$(visit "${JAR_GRP}" "https://${SUB}.${DOMAIN_2}/e2e-headers")
assert_eq "$(visit_status "$RESP")" "200" "${GRP} on the tunnel's /e2e-headers: 200" || true
assert_json_field "$(visit_body "$RESP")" '.user' "${GRP}" "…the backend is told the user" || true
assert_json_field "$(visit_body "$RESP")" '.groups' "${TEAM}" "…and Remote-Groups: ${TEAM} alone" || true
assert_not_contains "$(visit_body "$RESP")" "lamaste:" "…no group of Lamaste's reaches a backend" || true

# ===========================================================================
# 3. Member → external → member
# ===========================================================================

log_section "${MEM} turned external: the same session is refused"

RESP=$(md_kind "${DOMAIN_2}" "${MEM}" external)
assert_eq "$(status_of "$RESP")" "200" "PUT /api/domains/B/members/${MEM} {kind: external}" || true
assert_eq "$(user_kinds "${MEM}")" "${DOMAIN_2}:external" "…GET /api/users: an external member of B" || true
wait_group holds "${MEM}" "lamaste:x:${KEY_B}" "users.yml gives ${MEM} B's external group"
assert_not_contains ",$(user_groups "${MEM}")," ",lamaste:m:${KEY_B}," "…in place of the member group" || true
wait_status "${JAR_MEM}" "${URL}" 403 "${MEM}'s session of before on the authenticated tunnel: 403 within ${AUTHZ_SETTLE_SECONDS} s"
assert_access_request "$(visit "${JAR_MEM}" "${URL}")" "${MEM}, external, on the authenticated tunnel"
assert_eq "$(changed_kind "${MEM_ID}")" "member->external" "Audited: directory.membership.changed member → external, by directory id" || true
assert_eq "$(authelia_pid)" "${AUTHELIA_PID}" "…Authelia not restarted" || true

log_section "Turned back: let through again"

RESP=$(md_kind "${DOMAIN_2}" "${MEM}" member)
assert_eq "$(status_of "$RESP")" "200" "PUT /api/domains/B/members/${MEM} {kind: member}" || true
wait_group holds "${MEM}" "lamaste:m:${KEY_B}" "users.yml gives ${MEM} B's member group again"
wait_status "${JAR_MEM}" "${URL}" 200 "${MEM}'s session of before: 200 again — no new sign-in"
assert_eq "$(changed_kind "${MEM_ID}")" "member->external,external->member" "Audited: and back, external → member" || true
assert_eq "$(authelia_pid)" "${AUTHELIA_PID}" "…Authelia not restarted" || true

# ===========================================================================
# 4. Authelia groups and external members never meet
# ===========================================================================

log_section "Refusals: an Authelia group and an external membership"

RESP=$(md_kind "${DOMAIN_2}" "${GRP}" external)
assert_eq "$(status_of "$RESP") $(json_get "$(body_of "$RESP")" '.code')" "409 external_member_groups" "${GRP}, in ${TEAM}, made external: 409 external_member_groups" || true
assert_eq "$(user_kinds "${GRP}")" "${DOMAIN_2}:member" "…still a member of B" || true

RESP=$(users_call PUT "users/${EXT}" "{\"groups\":[\"${TEAM}\"]}")
assert_eq "$(status_of "$RESP") $(json_get "$(body_of "$RESP")" '.code')" "409 external_member_groups" "${TEAM} given to ${EXT}, an external member: 409 external_member_groups" || true
assert_eq "$(user_groups "${EXT}")" "lamaste:x:${KEY_B}" "…users.yml gives ${EXT} B's external group alone" || true

RESP=$(users_call PUT "users/${GRP}" "{\"groups\":[\"${TEAM}\",\"team.${DOMAIN_2}\"]}")
assert_eq "$(status_of "$RESP") $(json_get "$(body_of "$RESP")" '.code')" "400 reserved_group" "A group named like a hostname: 400 reserved_group" || true
RESP=$(users_call PUT "users/${GRP}" "{\"groups\":[\"${TEAM}\",\"lamaste:m:${KEY_B}\"]}")
assert_eq "$(status_of "$RESP") $(json_get "$(body_of "$RESP")" '.code')" "400 reserved_group" "…or like Lamaste's own (lamaste:m:<key>): 400 reserved_group" || true
assert_eq "$(host_api_get "users" | jq -r --arg u "${GRP}" '[.users[]? | select(.username == $u) | .groups[]?] | join(",")')" "${TEAM}" "${GRP}'s groups are unchanged" || true

assert_eq "$(authelia_pid)" "${AUTHELIA_PID}" "Authelia's MainPID is the one of before the first change" || true
if signed_in "${JAR_MEM}" "${DOMAIN_2}" && signed_in "${JAR_GRP}" "${DOMAIN_2}"; then
  log_pass "Both sessions of before are still signed in at auth.${DOMAIN_2}"
else
  log_fail "A session of before ended"
fi

end_test

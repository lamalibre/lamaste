#!/usr/bin/env bash
# ============================================================================
# 33 — Site locks (Single-VM)
# ============================================================================
# 4.6 serializes every change of sites.json, and gives a site or a tunnel a
# hostname under the tunnel lock (slice 7, wave 2). Before, each handler read
# sites.json, decided, and wrote it back on its own:
#
# 1. An upload recorded the site's size into a copy of sites.json read
#    before the upload — overwriting a settings change made meanwhile. Here
#    a PATCH lands while a large upload is in flight, three times: the
#    setting each PATCH made stays, and the size counts the upload.
# 2. Two sites created under one name at the same moment: exactly one is
#    created, the other refused.
# 3. A tunnel and a site created on one hostname at the same moment — the
#    tunnel's check of the sites ran before its lock: exactly one of them
#    gets it.
# ============================================================================

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/helpers.sh"

require_commands curl jq

begin_test "33 — Site locks"

RUN_ID="$(date +%s)"
SITE_NAME="e2e33lock"
SITE_ID=""
TWIN_NAME="e2e33twin"
RACE_NAME="e2e33race"
AGENT_LABEL_33="site-lock-e2e-${RUN_ID}"
BIG_FILE=""
RACE_DIR=""

cleanup() {
  local id
  for id in $(api_get "sites?limit=500" 2>/dev/null | jq -r --arg a "${SITE_NAME}" --arg b "${TWIN_NAME}" --arg c "${RACE_NAME}" '.sites[]? | select(.name == $a or .name == $b or .name == $c) | .id' 2>/dev/null || true); do
    api_delete "sites/${id}" > /dev/null 2>&1 || true
  done
  for id in $(api_get "tunnels?limit=500" 2>/dev/null | jq -r --arg c "${RACE_NAME}" '.tunnels[]? | select(.subdomain == $c) | .id' 2>/dev/null || true); do
    api_delete "tunnels/${id}" > /dev/null 2>&1 || true
  done
  api_delete "certs/agent/${AGENT_LABEL_33}" > /dev/null 2>&1 || true
  if [ -n "${BIG_FILE}" ]; then rm -f "${BIG_FILE}"; fi
  if [ -n "${RACE_DIR}" ]; then rm -rf "${RACE_DIR}"; fi
}
trap cleanup EXIT

# site_field <jq> — of the lock site as GET /api/sites lists it
site_field() {
  api_get "sites?limit=500" | jq -r --arg id "${SITE_ID}" ".sites[] | select(.id == \$id) | $1" 2>/dev/null || echo ""
}

# upload_while_patching <spaMode> — a large upload, slowed to a few
# seconds (--limit-rate) so it is surely in flight, and a PATCH of spaMode
# meanwhile; prints "<upload status> <patch status> <in flight>", the last
# "yes" when the upload was still running once the PATCH had answered —
# else the round proved nothing
upload_while_patching() {
  local out="${RACE_DIR}/upload.status" patch inflight
  _curl_mtls -o /dev/null -w '%{http_code}' --limit-rate 6M -X POST -F "file=@${BIG_FILE}" \
    "${BASE_URL}/api/sites/${SITE_ID}/files" > "$out" 2> /dev/null &
  local pid=$!
  sleep 0.5
  patch=$(api_patch_status "sites/${SITE_ID}" "{\"spaMode\":$1}")
  if kill -0 "$pid" 2> /dev/null; then inflight=yes; else inflight=no; fi
  wait "$pid" || true
  echo "$(cat "$out" 2> /dev/null || echo 000) ${patch} ${inflight}"
}

# race <label> <api path> <json> <label> <api path> <json> — two POSTs at
# the same moment; prints "<label>:<status> <label>:<status>"
race() {
  _curl_mtls -o /dev/null -w '%{http_code}' -X POST -H "Content-Type: application/json" -d "$3" \
    "${BASE_URL}/api/$2" > "${RACE_DIR}/$1" 2> /dev/null &
  local a=$!
  _curl_mtls -o /dev/null -w '%{http_code}' -X POST -H "Content-Type: application/json" -d "$6" \
    "${BASE_URL}/api/$5" > "${RACE_DIR}/$4" 2> /dev/null &
  local b=$!
  wait "$a" || true
  wait "$b" || true
  echo "$1:$(cat "${RACE_DIR}/$1" 2> /dev/null || echo 000) $4:$(cat "${RACE_DIR}/$4" 2> /dev/null || echo 000)"
}

# ---------------------------------------------------------------------------
log_section "Pre-flight"
# ---------------------------------------------------------------------------

ONBOARDING_STATUS=$(api_get "onboarding/status" | jq -r '.status' 2>/dev/null || echo "unknown")
if [ "$ONBOARDING_STATUS" != "COMPLETED" ]; then
  log_skip "Onboarding not completed — skipping"
  end_test
  exit $?
fi
log_pass "Onboarding is complete"
cleanup
RACE_DIR=$(mktemp -d /tmp/e2e-33-XXXXXX)
BIG_FILE="${RACE_DIR}/big.bin"
head -c $((24 * 1024 * 1024)) /dev/urandom > "${BIG_FILE}"
BIG_SIZE=$(stat -c %s "${BIG_FILE}")
log_info "A ${BIG_SIZE}-byte file to upload"

# ---------------------------------------------------------------------------
log_section "An upload no longer undoes a change made while it ran"
# ---------------------------------------------------------------------------

CREATE=$(api_post "sites" "{\"name\":\"${SITE_NAME}\",\"type\":\"managed\",\"spaMode\":false}")
SITE_ID=$(echo "$CREATE" | jq -r '.site.id // empty' 2>/dev/null || echo "")
assert_json_field "$CREATE" '.ok' 'true' "Site ${SITE_NAME} created" || true

for round in 1 2 3; do
  if [ $((round % 2)) -eq 1 ]; then WANT=true; else WANT=false; fi
  STATUSES=$(upload_while_patching "${WANT}")
  assert_eq "${STATUSES}" "200 200 yes" "Round ${round}: the upload and the PATCH (spaMode ${WANT}) both answered 200, the PATCH while the upload ran" || true
  assert_eq "$(site_field '.spaMode')" "${WANT}" "Round ${round}: spaMode is ${WANT} — the upload did not write back the copy it read before" || true
done
SIZE=$(site_field '.totalSize')
if [ "${SIZE:-0}" -ge "${BIG_SIZE}" ]; then
  log_pass "The recorded size counts the upload (${SIZE} bytes)"
else
  log_fail "The recorded size is ${SIZE}, below the ${BIG_SIZE} bytes uploaded"
fi

# ---------------------------------------------------------------------------
log_section "Two sites under one name at once: one is created"
# ---------------------------------------------------------------------------

BODY="{\"name\":\"${TWIN_NAME}\",\"type\":\"managed\"}"
RESULT=$(race first sites "$BODY" second sites "$BODY")
log_info "Statuses: ${RESULT}"
CREATED=$(echo "$RESULT" | grep -o ':201' | wc -l | tr -d ' ')
REFUSED=$(echo "$RESULT" | grep -o ':400' | wc -l | tr -d ' ')
assert_eq "${CREATED} ${REFUSED}" "1 1" "Exactly one created (201), the other refused (400)" || true
TWINS=$(api_get "sites?limit=500" | jq --arg n "${TWIN_NAME}" '[.sites[] | select(.name == $n)] | length' 2>/dev/null || echo "?")
assert_eq "${TWINS}" "1" "sites.json holds one site of that name" || true

# ---------------------------------------------------------------------------
log_section "A tunnel and a site on one hostname at once: one gets it"
# ---------------------------------------------------------------------------

AGENT=$(api_post "certs/agent" "{\"label\":\"${AGENT_LABEL_33}\",\"capabilities\":[\"tunnels:read\"]}")
assert_json_field "$AGENT" '.ok' 'true' "Agent enrolled to own the tunnel" || true
TUNNEL_BODY="{\"subdomain\":\"${RACE_NAME}\",\"port\":19933,\"description\":\"site lock race\",\"agentLabel\":\"${AGENT_LABEL_33}\"}"
SITE_BODY="{\"name\":\"${RACE_NAME}\",\"type\":\"managed\"}"
RESULT=$(race tunnel tunnels "$TUNNEL_BODY" site sites "$SITE_BODY")
log_info "Statuses: ${RESULT}"
WON=$(echo "$RESULT" | grep -oE ':20[01]' | wc -l | tr -d ' ')
LOST=$(echo "$RESULT" | grep -o ':400' | wc -l | tr -d ' ')
assert_eq "${WON} ${LOST}" "1 1" "Exactly one of them got ${RACE_NAME}, the other was refused (400)" || true
TUNNELS_ON=$(api_get "tunnels?limit=500" | jq --arg n "${RACE_NAME}" '[.tunnels[] | select(.subdomain == $n)] | length' 2>/dev/null || echo "?")
SITES_ON=$(api_get "sites?limit=500" | jq --arg n "${RACE_NAME}" '[.sites[] | select(.name == $n)] | length' 2>/dev/null || echo "?")
assert_eq "$((TUNNELS_ON + SITES_ON))" "1" "One vhost answers on ${RACE_NAME} — a tunnel (${TUNNELS_ON}) or a site (${SITES_ON}), never both" || true

end_test

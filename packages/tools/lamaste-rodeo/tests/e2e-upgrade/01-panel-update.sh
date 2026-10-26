#!/usr/bin/env bash
# ============================================================================
# 01 — A relay on the previous release takes the Panel Update to the candidate
# ============================================================================
# The relay was installed from the registry at the release before the
# candidate (tier installed-previous), exactly as a live relay has it. The
# candidate is the registry's latest create-lamaste. Here, the path a live
# relay takes:
#
# 1. State written by the previous release: a user beside the admin, two
#    tunnels (one enabled, one disabled), their vhosts under that release's
#    names, how every host answers, the root helper as installed.
# 2. POST /api/system/update { version: <candidate> }: lamaste-priv starts
#    create-lamaste@<candidate> --yes in a transient unit; the panel comes
#    back on the candidate.
# 3. After: the unit succeeded; lamaste-priv is the candidate's (it refuses
#    what only the old one allowed); the panel's migrations ran on the old
#    state; the vhosts carry the candidate's names with their link state;
#    every host answers as before; one domain, every user its member;
#    Authelia denies by default and Gatekeeper has its member file; the
#    panel logged no error since the update.
# ============================================================================

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/helpers.sh"

require_commands curl jq nginx npm sha256sum

begin_test "01 — Panel Update from the previous release to the candidate"

RUN_ID="$(date +%s)"
AGENT_LABEL="upgrade-e2e-${RUN_ID}"
SUB_ON="e2eup1on"
SUB_OFF="e2eup1off"
PORT_ON=19941
PORT_OFF=19942
USERNAME="e2eupgrade"
TUNNEL_ON=""
TUNNEL_OFF=""
AVAILABLE="/etc/nginx/sites-available"
ENABLED="/etc/nginx/sites-enabled"
PRIV=/usr/local/sbin/lamaste-priv

cleanup() {
  log_info "Cleaning up test resources..."
  local id
  for id in ${TUNNEL_ON} ${TUNNEL_OFF}; do
    api_delete "tunnels/${id}" > /dev/null 2>&1 || true
  done
  api_delete "users/${USERNAME}" > /dev/null 2>&1 || true
  api_delete "certs/agent/${AGENT_LABEL}" > /dev/null 2>&1 || true
}
trap cleanup EXIT

# host_status <hostname> — how nginx answers https://<hostname>/ on this VM
host_status() {
  curl -sk -o /dev/null -w '%{http_code}' --max-time 10 --resolve "$1:443:127.0.0.1" "https://$1/" 2>/dev/null || echo "000"
}

# link_state <site name> — "available linked" / "available unlinked" / "gone …"
link_state() {
  local a=gone e=unlinked
  if sudo test -e "${AVAILABLE}/$1"; then a=available; fi
  if sudo test -L "${ENABLED}/$1"; then e=linked; fi
  echo "$a $e"
}

# panel_version — the version the panel reports, or "down"
panel_version() {
  api_get "health" 2>/dev/null | jq -r '.version // "down"' 2>/dev/null || echo "down"
}

# ---------------------------------------------------------------------------
log_section "Pre-flight: the previous release, onboarded; the candidate on the registry"
# ---------------------------------------------------------------------------

ONBOARDING=$(api_get "onboarding/status" 2>/dev/null || echo '{}')
if [ "$(echo "$ONBOARDING" | jq -r '.status' 2>/dev/null || echo unknown)" != "COMPLETED" ]; then
  log_fail "Onboarding is not complete (provision the 'provisioned' tier)"
  end_test
  exit $?
fi
DOMAIN=$(echo "$ONBOARDING" | jq -r '.domain // empty')
ON_FQDN="${SUB_ON}.${DOMAIN}"
OFF_FQDN="${SUB_OFF}.${DOMAIN}"
AUTH_FQDN="auth.${DOMAIN}"

BEFORE_VERSION=$(panel_version)
CANDIDATE=$(npm view @lamalibre/create-lamaste dist-tags.latest 2>/dev/null || echo "")
log_info "Panel on ${BEFORE_VERSION}; the registry's candidate is ${CANDIDATE}"
if [ -z "${CANDIDATE}" ] || [ "${BEFORE_VERSION}" = "${CANDIDATE}" ] || [ "${BEFORE_VERSION}" = "down" ]; then
  log_fail "The relay must run a release before the candidate (panel ${BEFORE_VERSION}, candidate ${CANDIDATE:-none})"
  end_test
  exit $?
fi
log_pass "The relay runs ${BEFORE_VERSION}, before the candidate ${CANDIDATE}"

# ===========================================================================
# 1. State written by the previous release
# ===========================================================================

log_section "State written by ${BEFORE_VERSION}"

RESP=$(api_post "users" "{\"username\":\"${USERNAME}\",\"displayname\":\"E2E Upgrade\",\"email\":\"${USERNAME}@example.test\",\"password\":\"Upgrade-${RUN_ID}-pass\"}")
assert_json_field "$RESP" '.ok' 'true' "User ${USERNAME} created beside the admin" || true

AGENT=$(api_post "certs/agent" "{\"label\":\"${AGENT_LABEL}\",\"capabilities\":[\"tunnels:read\"]}")
assert_json_field "$AGENT" '.ok' 'true' "Agent ${AGENT_LABEL} enrolled (it carries the tunnels)" || true
RESP=$(api_post "tunnels" "{\"subdomain\":\"${SUB_ON}\",\"port\":${PORT_ON},\"accessMode\":\"authenticated\",\"agentLabel\":\"${AGENT_LABEL}\"}")
TUNNEL_ON=$(echo "$RESP" | jq -r '.tunnel.id // empty')
assert_json_field "$RESP" '.tunnel.fqdn' "${ON_FQDN}" "Tunnel ${ON_FQDN}" || true
RESP=$(api_post "tunnels" "{\"subdomain\":\"${SUB_OFF}\",\"port\":${PORT_OFF},\"accessMode\":\"authenticated\",\"agentLabel\":\"${AGENT_LABEL}\"}")
TUNNEL_OFF=$(echo "$RESP" | jq -r '.tunnel.id // empty')
assert_json_field "$RESP" '.tunnel.fqdn' "${OFF_FQDN}" "Tunnel ${OFF_FQDN}" || true
RESP=$(api_patch "tunnels/${TUNNEL_OFF}" '{"enabled":false}')
assert_json_field "$RESP" '.tunnel.enabled' 'false' "…disabled" || true

LEGACY_ON="lamalibre-lamaste-app-${SUB_ON}"
LEGACY_OFF="lamalibre-lamaste-app-${SUB_OFF}"
LEGACY_AUTH="lamalibre-lamaste-auth"
assert_eq "$(link_state "${LEGACY_ON}") $(link_state "${LEGACY_OFF}") $(link_state "${LEGACY_AUTH}")" \
  "available linked available unlinked available linked" \
  "${BEFORE_VERSION} names the vhosts by subdomain (the enabled tunnel linked, the disabled one not, the auth portal linked)" || true

USERS_BEFORE=$(api_get "users" 2>/dev/null | jq '[.users[]? | .username] | sort' 2>/dev/null || echo '[]')
BEFORE="$(host_status "${ON_FQDN}") $(host_status "${OFF_FQDN}") $(host_status "${AUTH_FQDN}")"
log_info "Users ${USERS_BEFORE//[$'\n' ]/}; ${ON_FQDN} ${OFF_FQDN} ${AUTH_FQDN} answer ${BEFORE}"
PRIV_BEFORE=$(sudo sha256sum "${PRIV}" | cut -d' ' -f1)

# ===========================================================================
# 2. The Panel Update
# ===========================================================================

log_section "POST /api/system/update to ${CANDIDATE}"

UPDATE_STARTED="$(date '+%Y-%m-%d %H:%M:%S')"
RESP=$(api_post "system/update" "{\"version\":\"${CANDIDATE}\"}")
assert_json_field "$RESP" '.ok' 'true' "The update is accepted (202)" || true

AFTER_VERSION="down"
for _ in $(seq 1 120); do
  sleep 5
  AFTER_VERSION=$(panel_version)
  [ "${AFTER_VERSION}" = "${CANDIDATE}" ] && break
done
assert_eq "${AFTER_VERSION}" "${CANDIDATE}" "The panel is back on ${CANDIDATE}" || true

UNIT=$(systemctl list-units --all --no-legend --plain 'lamalibre-lamaste-update-*' 2>/dev/null | awk '{print $1}' | tail -1)
if [ -n "${UNIT}" ]; then
  RESULT=$(systemctl show -p Result --value "${UNIT}" 2>/dev/null || echo unknown)
  assert_eq "${RESULT}" "success" "The update unit ${UNIT} ended in success" || true
else
  # A oneshot unit that succeeded is unloaded once it stopped; its journal stays.
  if sudo journalctl --since "${UPDATE_STARTED}" --no-pager -o cat 2>/dev/null | grep -q "Finished.*Lamaste update to ${CANDIDATE}"; then
    log_pass "The update unit finished (journal)"
  else
    log_fail "No trace of the update unit finishing"
  fi
fi

# ===========================================================================
# 3. After the update
# ===========================================================================

log_section "The root helper is the candidate's"

PRIV_AFTER=$(sudo sha256sum "${PRIV}" | cut -d' ' -f1)
if [ "${PRIV_AFTER}" != "${PRIV_BEFORE}" ]; then
  log_pass "lamaste-priv was replaced by the update"
else
  log_fail "lamaste-priv is still the one ${BEFORE_VERSION} installed"
fi
OUT=$(printf 'server {\n listen 443 ssl;\n}\n' | sudo "${PRIV}" nginx-site write "lamalibre-lamaste-app-e2eup1legacy" 2>&1 > /dev/null || true)
assert_contains "$OUT" "site name not allowed for write" "It refuses a vhost under a ${BEFORE_VERSION} name" || true

log_section "The vhosts under the candidate's names, link state kept"

assert_eq "$(link_state "$(vhost_name app "${ON_FQDN}")")" "available linked" "${ON_FQDN}: renamed to its full hostname, still linked" || true
assert_eq "$(link_state "$(vhost_name app "${OFF_FQDN}")")" "available unlinked" "${OFF_FQDN}: renamed, still not linked" || true
assert_eq "$(link_state "$(vhost_name auth "${DOMAIN}")")" "available linked" "The auth portal: lamalibre-lamaste-auth-${DOMAIN}, linked" || true
assert_eq "$(link_state "${LEGACY_ON}") $(link_state "${LEGACY_OFF}") $(link_state "${LEGACY_AUTH}")" \
  "gone unlinked gone unlinked gone unlinked" "No ${BEFORE_VERSION} name is left, as a file or a link" || true
if sudo nginx -t > /dev/null 2>&1; then
  log_pass "nginx -t passes"
else
  log_fail "nginx -t fails after the update"
fi
assert_eq "$(host_status "${ON_FQDN}") $(host_status "${OFF_FQDN}") $(host_status "${AUTH_FQDN}")" "${BEFORE}" "Every host answers as before (${BEFORE})" || true

log_section "One domain; every user of ${BEFORE_VERSION} its member"

DOMAINS=$(api_get "domains" 2>/dev/null || echo '{}')
assert_json_field "$DOMAINS" '.domains | length' '1' "One domain" || true
assert_json_field "$DOMAINS" '.domains[0] | "\(.name) \(.primary) \(.status)"' "${DOMAIN} true active" "…the primary, ${DOMAIN}, active" || true
USERS=$(api_get "users" 2>/dev/null || echo '{}')
assert_eq "$(echo "$USERS" | jq -c '[.users[]? | .username] | sort')" "$(echo "${USERS_BEFORE}" | jq -c .)" "The same users as before the update" || true
assert_eq "$(echo "$USERS" | jq --arg d "${DOMAIN}" '[.users[]? | select((.domains // []) != [$d])] | length')" "0" "…each a member of ${DOMAIN}, and of nothing else" || true

log_section "Authelia and Gatekeeper enforce membership"

AUTHELIA_POLICY=$(sudo awk '/^access_control:/{f=1;next} f&&/^[^ ]/{f=0} f&&/default_policy:/{print $2; exit}' /etc/authelia/configuration.yml 2>/dev/null || echo "")
assert_eq "${AUTHELIA_POLICY}" "deny" "Authelia's access_control denies by default" || true
if sudo test -s /etc/lamalibre/lamaste/domains.json && sudo jq -e --arg d "${DOMAIN}" '.. | objects | select(.name? == $d)' /etc/lamalibre/lamaste/domains.json > /dev/null 2>&1; then
  log_pass "Gatekeeper's domains.json names ${DOMAIN}"
else
  log_fail "domains.json is missing or does not name ${DOMAIN}"
fi
assert_eq "$(systemctl is-active authelia) $(systemctl is-active lamalibre-lamaste-gatekeeper)" "active active" "Authelia and Gatekeeper are running" || true

log_section "The panel logged no error since the update"

ERRORS=$(sudo journalctl -u lamalibre-lamaste-serverd --since "${UPDATE_STARTED}" --no-pager -o cat 2>/dev/null | grep -cE '"level":(50|60)' || true)
assert_eq "${ERRORS}" "0" "No level ≥ 50 line in the panel's journal since ${UPDATE_STARTED}" || true

end_test

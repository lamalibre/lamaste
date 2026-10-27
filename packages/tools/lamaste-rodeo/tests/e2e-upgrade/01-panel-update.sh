#!/usr/bin/env bash
# ============================================================================
# 01 — A relay on the previous release takes the Panel Update to the candidate
# ============================================================================
# The relay was installed from the registry while the release before the
# candidate was the latest (tier installed-previous); the campaign then
# published the candidate, now the registry's latest create-lamaste. Here,
# the path a live relay takes:
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
#    every host answers as before; one domain, every user its member (kind
#    member); Authelia denies by default, watches its users file (refresh
#    always, its own password change and reset off — external-members-
#    design.md) and every user holds the domain's member group there;
#    Gatekeeper has its member file (v2); the branded sign-in's base is in
#    place with the page pixel-for-pixel stock (auth-branding-design.md,
#    "Upgrade and reconcile": the override locations in the auth vhost,
#    data-theme="light", data-logooverride="false", no stylesheet; theme
#    and server.asset_path in Authelia's configuration — one restart,
#    audited; no brand; nginx built with the sub module; the stock
#    invitation page rewritten); the user signed in before the update,
#    signed in again after it, reaches what they reached; the panel logged
#    no error since the update.
# ============================================================================

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/helpers.sh"

require_commands curl jq nginx npm sha256sum oathtool python3

begin_test "01 — Panel Update from the previous release to the candidate"

RUN_ID="$(date +%s)"
AGENT_LABEL="upgrade-e2e-${RUN_ID}"
SUB_ON="e2eup1on"
SUB_OFF="e2eup1off"
PORT_ON=19941
PORT_OFF=19942
USERNAME="e2eupgrade"
# Test credentials for this run only, never printed
USER_PASSWORD="Upgrade-${RUN_ID}-pass"
WORK_DIR="/tmp/lamalibre-lamaste-e2e-upgrade-01"
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
  rm -rf "${WORK_DIR}"
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

# signed_status <jar> <hostname> — how nginx answers https://<hostname>/ to the session in <jar>
signed_status() {
  curl -sk -o /dev/null -w '%{http_code}' --max-time 10 -b "$1" --resolve "$2:443:127.0.0.1" "https://$2/" 2>/dev/null || echo "000"
}

# panel_version — the version the panel reports, or "down"
panel_version() {
  api_get "health" 2>/dev/null | jq -r '.version // "down"' 2>/dev/null || echo "down"
}

# version_before <a> <b> — whether release <a> is older than <b> (x.y.z)
version_before() {
  [ "$1" != "$2" ] && [ "$(printf '%s\n%s\n' "$1" "$2" | sort -V | head -n 1)" = "$1" ]
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

RESP=$(api_post "users" "{\"username\":\"${USERNAME}\",\"displayname\":\"E2E Upgrade\",\"email\":\"${USERNAME}@example.test\",\"password\":\"${USER_PASSWORD}\"}")
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
# A release before 4.7 named its vhosts by subdomain (and the one auth
# portal `lamalibre-lamaste-auth`); from 4.7 they carry the full hostname.
if version_before "${BEFORE_VERSION}" "4.7.0"; then
  assert_eq "$(link_state "${LEGACY_ON}") $(link_state "${LEGACY_OFF}") $(link_state "${LEGACY_AUTH}")" \
    "available linked available unlinked available linked" \
    "${BEFORE_VERSION} names the vhosts by subdomain (the enabled tunnel linked, the disabled one not, the auth portal linked)" || true
else
  assert_eq "$(link_state "$(vhost_name app "${ON_FQDN}")") $(link_state "$(vhost_name app "${OFF_FQDN}")") $(link_state "$(vhost_name auth "${DOMAIN}")")" \
    "available linked available unlinked available linked" \
    "${BEFORE_VERSION} names the vhosts by full hostname (the enabled tunnel linked, the disabled one not, the auth portal linked)" || true
fi

# Signed in on the previous release: what the user reaches (an
# authenticated tunnel — admitted, so nginx answers for its backend, which
# does not run here: 502).
rm -rf "${WORK_DIR}"
mkdir -p "${WORK_DIR}"
SECRET=$(local_reset_totp "${USERNAME}")
local_wait_authelia "${DOMAIN}"
local_sign_in "${USERNAME}" "${USER_PASSWORD}" "${SECRET}" "${WORK_DIR}/user-before.jar" "${DOMAIN}"
assert_eq "${SIGN_IN_RESULT}" "OK OK" "${USERNAME} signed in at auth.${DOMAIN} on ${BEFORE_VERSION}" || true
REACH_BEFORE=$(signed_status "${WORK_DIR}/user-before.jar" "${ON_FQDN}")
case "${REACH_BEFORE}" in
  302 | 401 | 403 | 000) log_fail "${USERNAME} is not admitted to ${ON_FQDN} on ${BEFORE_VERSION} (${REACH_BEFORE})" ;;
  *) log_pass "${USERNAME} is admitted to ${ON_FQDN} on ${BEFORE_VERSION} (${REACH_BEFORE})" ;;
esac

USERS_BEFORE=$(api_get "users" 2>/dev/null | jq '[.users[]? | .username] | sort' 2>/dev/null || echo '[]')
BEFORE="$(host_status "${ON_FQDN}") $(host_status "${OFF_FQDN}") $(host_status "${AUTH_FQDN}")"
log_info "Users ${USERS_BEFORE//[$'\n' ]/}; ${ON_FQDN} ${OFF_FQDN} ${AUTH_FQDN} answer ${BEFORE}"
PRIV_BEFORE=$(sudo sha256sum "${PRIV}" | cut -d' ' -f1)
# The last audit entry of the previous release: what the update adds comes after it
AUDIT_BASE=$(api_get "audit?limit=1" 2>/dev/null | jq '.entries[0].id // 0' 2>/dev/null || echo "0")

# ===========================================================================
# 2. The Panel Update
# ===========================================================================

log_section "POST /api/system/update to ${CANDIDATE}"

UPDATE_STARTED="$(date '+%Y-%m-%d %H:%M:%S')"
RESP=$(api_post "system/update" "{\"version\":\"${CANDIDATE}\"}")
assert_json_field "$RESP" '.ok' 'true' "The update is accepted (202)" || true

# Six minutes: a redeploy takes about two, and rodeo stops a spec at ten.
AFTER_VERSION="down"
for _ in $(seq 1 72); do
  sleep 5
  AFTER_VERSION=$(panel_version)
  [ "${AFTER_VERSION}" = "${CANDIDATE}" ] && break
done
assert_eq "${AFTER_VERSION}" "${CANDIDATE}" "The panel is back on ${CANDIDATE}" || true

# The panel answers /api/health before its start-up has settled Authelia's
# configuration — the domains rendered into it (a relay from before 4.7) or
# the branded sign-in's base added (before 4.8) — which restarts Authelia
# once more; compare the hosts only after that and once Authelia serves
# again.
SETTLED="no"
for _ in $(seq 1 30); do
  if sudo journalctl -u lamalibre-lamaste-serverd --since "${UPDATE_STARTED}" --no-pager -o cat 2>/dev/null | grep -qE '"msg":"(Authelia domain access updated|Authelia restarted for the branded sign-in[^"]*)"'; then
    SETTLED="yes"
    break
  fi
  sleep 2
done
assert_eq "${SETTLED}" "yes" "The panel's start-up settled Authelia's configuration (domains rendered, or the branding base added)" || true
if wait_for_http "http://127.0.0.1:9091/api/health" 60; then
  log_pass "Authelia serves again"
else
  log_fail "Authelia does not answer its health check after the update"
fi

# The panel is back before the unit is done (it carries on with Gatekeeper,
# the wrappers and the rest of the redeploy): give it up to two minutes.
UNIT_DONE="no"
for _ in $(seq 1 60); do
  UNIT=$(systemctl list-units --all --no-legend --plain 'lamalibre-lamaste-update-*.service' 2>/dev/null | awk '{print $1}' | tail -1)
  if [ -n "${UNIT}" ]; then
    case "$(systemctl show -p ActiveState --value "${UNIT}" 2>/dev/null)" in
      inactive | failed) UNIT_DONE="unit" ;;
    esac
  elif sudo journalctl --since "${UPDATE_STARTED}" --no-pager -o cat 2>/dev/null | grep -q "Finished.*Lamaste update to ${CANDIDATE}"; then
    # A oneshot unit that succeeded is unloaded once it stopped; its journal stays.
    UNIT_DONE="journal"
  fi
  [ "${UNIT_DONE}" = "no" ] || break
  sleep 2
done
case "${UNIT_DONE}" in
  unit)
    RESULT=$(systemctl show -p Result --value "${UNIT}" 2>/dev/null || echo unknown)
    assert_eq "${RESULT}" "success" "The update unit ${UNIT} ended in success" || true
    ;;
  journal) log_pass "The update unit finished (journal)" ;;
  *) log_fail "No trace of the update unit finishing within two minutes" ;;
esac

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
assert_contains "$OUT" "site name not allowed for write" "It refuses a vhost under a pre-4.7 name" || true

log_section "The vhosts under the candidate's names, link state kept"

assert_eq "$(link_state "$(vhost_name app "${ON_FQDN}")")" "available linked" "${ON_FQDN}: under its full hostname, still linked" || true
assert_eq "$(link_state "$(vhost_name app "${OFF_FQDN}")")" "available unlinked" "${OFF_FQDN}: under its full hostname, still not linked" || true
assert_eq "$(link_state "$(vhost_name auth "${DOMAIN}")")" "available linked" "The auth portal: lamalibre-lamaste-auth-${DOMAIN}, linked" || true
assert_eq "$(link_state "${LEGACY_ON}") $(link_state "${LEGACY_OFF}") $(link_state "${LEGACY_AUTH}")" \
  "gone unlinked gone unlinked gone unlinked" "No pre-4.7 name is left, as a file or a link" || true
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
assert_eq "$(echo "$USERS" | jq --arg d "${DOMAIN}" '[.users[]? | select([(.domains // [])[] | "\(.name):\(.kind)"] != ["\($d):member"])] | length')" "0" "…each a member of ${DOMAIN} (kind member, never external), and of nothing else" || true

log_section "Authelia and Gatekeeper enforce membership"

AUTHELIA_POLICY=$(sudo awk '/^access_control:/{f=1;next} f&&/^[^ ]/{f=0} f&&/default_policy:/{print $2; exit}' /etc/authelia/configuration.yml 2>/dev/null || echo "")
assert_eq "${AUTHELIA_POLICY}" "deny" "Authelia's access_control denies by default" || true
if sudo test -s /etc/lamalibre/lamaste/domains.json && sudo jq -e --arg d "${DOMAIN}" '.. | objects | select(.name? == $d)' /etc/lamalibre/lamaste/domains.json > /dev/null 2>&1; then
  log_pass "Gatekeeper's domains.json names ${DOMAIN}"
else
  log_fail "domains.json is missing or does not name ${DOMAIN}"
fi
assert_eq "$(systemctl is-active authelia) $(systemctl is-active lamalibre-lamaste-gatekeeper)" "active active" "Authelia and Gatekeeper are running" || true
PROJECTION=$(sudo cat /etc/lamalibre/lamaste/domains.json 2>/dev/null || echo '{}')
assert_json_field "$PROJECTION" '"\(.v) \([.domains[].externals | length] | add)"' '2 0' "…the projection is version 2, no external member" || true

log_section "Authelia reads who may pass from its users file"

CONFIG=$(sudo bash -c "${AUTHELIA_CONFIG_JSON}" 2>/dev/null || echo '{}')
assert_json_field "$CONFIG" '"\(.authentication_backend.file.watch) \(.authentication_backend.refresh_interval)"' 'true always' "Authelia watches users.yml and reads a session's groups at every request" || true
assert_json_field "$CONFIG" '"\(.authentication_backend.password_change.disable) \(.authentication_backend.password_reset.disable)"' 'true true' "…its own password change and reset are off (the panel is the file's one writer)" || true
KEY=$(echo "$CONFIG" | jq -r --arg d "${DOMAIN}" "${AUTHELIA_MEMBER_KEY}" 2>/dev/null || echo "")
assert_eq "$(printf '%s\n' "${KEY}" | grep -cE '^[0-9a-f]{16}$' || true)" "1" "The primary domain's rules name its member group (lamaste:m:<key>)" || true
assert_not_contains "$(echo "$CONFIG" | jq -c '.access_control.rules')" '"user:' "…and name no user" || true
USERS_GROUPS=$(sudo bash -c "${AUTHELIA_USERS_GROUPS_JSON}" 2>/dev/null || echo '{}')
assert_eq "$(echo "$USERS_GROUPS" | jq --arg g "lamaste:m:${KEY}" '[to_entries[] | select(.value | index($g) | not)] | length')" "0" "Every user of users.yml holds the member group" || true

log_section "The branded sign-in's base is in place; the page is pixel-for-pixel stock"

AUTH_VHOST=$(sudo cat "${AVAILABLE}/$(vhost_name auth "${DOMAIN}")" 2>/dev/null || echo "")
assert_contains "${AUTH_VHOST}" "location = /brand.css {" "The auth vhost carries the brand-override locations (/brand.css)" || true
assert_contains "${AUTH_VHOST}" "location = /static/media/logo.png {" "…/static/media/logo.png" || true
assert_contains "${AUTH_VHOST}" "location /locales/ {" "…/locales/" || true
assert_contains "${AUTH_VHOST}" "location @authelia {" "…with @authelia as the fallback" || true
assert_contains "${AUTH_VHOST}" "sub_filter 'data-logooverride=\"true\"' 'data-logooverride=\"false\"';" "…and switches the logo off (data-logooverride=\"false\": no brand)" || true
assert_not_contains "${AUTH_VHOST}" "brand.css\"></head>" "…adds no stylesheet link" || true
AUTH_PAGE=$(curl -sk --max-time 15 --resolve "${AUTH_FQDN}:443:127.0.0.1" -w '\n%{http_code}' "https://${AUTH_FQDN}/" 2>/dev/null || echo "000")
assert_eq "$(printf '%s\n' "${AUTH_PAGE}" | tail -n 1)" "200" "https://${AUTH_FQDN}/ answers 200" || true
assert_contains "${AUTH_PAGE}" 'data-theme="light"' "…data-theme=\"light\"" || true
assert_contains "${AUTH_PAGE}" 'data-logooverride="false"' "…data-logooverride=\"false\" (the placeholder is never shown)" || true
assert_not_contains "${AUTH_PAGE}" 'brand.css' "…no stylesheet: the stock page until a brand is set" || true
assert_json_field "$CONFIG" '"\(.theme) \(.server.asset_path)"' "light /etc/authelia/assets" "Authelia's configuration gained theme light and server.asset_path /etc/authelia/assets" || true
assert_eq "$(sudo stat -c '%G' /etc/authelia/assets/logo.png 2>/dev/null || echo "missing")" "lamaste-authelia" "The placeholder logo is in the asset directory, group lamaste-authelia" || true
BASE_RESTARTS=$(api_get "audit?action=authelia.restarted&limit=200" 2>/dev/null | jq --argjson base "${AUDIT_BASE}" '[.entries[]? | select(.id > $base and .details.reason == "branding-base")] | length' 2>/dev/null || echo "?")
assert_eq "${BASE_RESTARTS}" "1" "Exactly one authelia.restarted audited with reason branding-base since the update" || true
assert_json_field "$(api_get "domains/${DOMAIN}/branding" 2>/dev/null || echo '{}')" '.branding' "null" "GET /api/domains/${DOMAIN}/branding: no brand" || true
assert_eq "$(nginx -V 2>&1 | grep '^configure arguments:' | tr ' ' '\n' | grep -cx -- '--with-http_sub_module' || true)" "1" "nginx -V lists --with-http_sub_module (compiled in)" || true
INVITE_PAGE=$(sudo cat /var/www/lamaste/invite/index.html 2>/dev/null || echo "")
assert_contains "${INVITE_PAGE}" "<title>Lamaste — Accept Invitation</title>" "The stock invitation page is in place" || true
assert_contains "${INVITE_PAGE}" "--accent-foreground:" "…rewritten by the candidate (its palette variables, which ${BEFORE_VERSION}'s page lacked)" || true

log_section "Signed in again: the user reaches what they reached"

# The update restarted Authelia, which keeps its sessions in memory.
local_sign_in "${USERNAME}" "${USER_PASSWORD}" "${SECRET}" "${WORK_DIR}/user-after.jar" "${DOMAIN}"
assert_eq "${SIGN_IN_RESULT}" "OK OK" "${USERNAME} signed in at auth.${DOMAIN} on ${CANDIDATE}" || true
assert_eq "$(signed_status "${WORK_DIR}/user-after.jar" "${ON_FQDN}")" "${REACH_BEFORE}" "…and is answered on ${ON_FQDN} as before (${REACH_BEFORE})" || true

log_section "The panel logged no error since the update"

ERRORS=$(sudo journalctl -u lamalibre-lamaste-serverd --since "${UPDATE_STARTED}" --no-pager -o cat 2>/dev/null | grep -cE '"level":(50|60)' || true)
assert_eq "${ERRORS}" "0" "No level ≥ 50 line in the panel's journal since ${UPDATE_STARTED}" || true

end_test

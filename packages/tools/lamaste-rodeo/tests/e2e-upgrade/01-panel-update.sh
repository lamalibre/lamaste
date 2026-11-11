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
#    data-theme="light", data-logooverride="false", the stock stylesheet; theme
#    and server.asset_path in Authelia's configuration — one restart,
#    audited; no brand; nginx built with the sub module; the stock
#    invitation page rewritten); the user signed in before the update,
#    signed in again after it, reaches what they reached; the panel logged
#    no error since the update.
# 4. The invitations of the release before (delegated-invitations-design.md
#    §11): a pending invitation made there, its link naming the token in its
#    path, and a domain with a brand. After the update the old link's page
#    opens and runs — on the stock page and the branded one the script served
#    is the one the served CSP names, because the rendering was rebuilt
#    (`pagesDigest` in rendered.json); the invitation was imported from
#    invitations.json, which is gone, with no clear token left in state.db;
#    it is looked up and accepted by POST. From 4.9 on the invitation is in
#    state.db already and its link names the token in its fragment.
# 5. The page language (page-language-design.md, "Upgrade in place"): the
#    panel's migration 0021 ran (domains.language), no domain has a
#    language, the pages are English — the stock pages and the branded
#    domain's rendering, written again by the candidate with its data block;
#    the auth vhosts force no locale; the running Authelia is the pin; the
#    stock "not available" page is in place; Gatekeeper's GET
#    /access-request is gone.
# ============================================================================

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/helpers.sh"

require_commands curl jq nginx npm sha256sum oathtool python3 node sqlite3

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
STATE_DIR="/etc/lamalibre/lamaste"
WEB_ROOT="/var/www/lamaste/auth"
INVITEE="e2eupinvited"
# Test credentials for this run only, never printed
INVITEE_PASSWORD="Upgrade-${RUN_ID}-invitee"
BRAND="E2E Upgrade Brand"
ACCENT="#0f766e"
DOMAIN_2=""
INVITE_TOKEN=""
INVITE_ID=""
BRANDED_TOKEN=""

cleanup() {
  log_info "Cleaning up test resources..."
  local id
  for id in ${TUNNEL_ON} ${TUNNEL_OFF}; do
    api_delete "tunnels/${id}" > /dev/null 2>&1 || true
  done
  api_delete "users/${USERNAME}" > /dev/null 2>&1 || true
  api_delete "users/${INVITEE}" > /dev/null 2>&1 || true
  api_delete "certs/agent/${AGENT_LABEL}" > /dev/null 2>&1 || true
  rm -rf "${WORK_DIR}"
}
trap cleanup EXIT

# inline_hash <script|style> — the CSP source of a page's inline element, from stdin
inline_hash() {
  node -e 'const h=require("fs").readFileSync(0,"utf8");const t=process.argv[1];const m=h.match(new RegExp("<"+t+">([\\s\\S]*?)</"+t+">"));process.stdout.write(m?"sha256-"+require("crypto").createHash("sha256").update(m[1],"utf8").digest("base64"):"none")' "$1"
}

# assert_page_runs <host> <path> <what> — the page answers 200 and its CSP names
# the served inline script and style: a browser runs it
assert_page_runs() {
  local dir="${WORK_DIR}/page" csp
  mkdir -p "$dir"
  curl -sk --max-time 15 --resolve "$1:443:127.0.0.1" -D "$dir/headers" -o "$dir/body" -w '%{http_code}' "https://$1$2" > "$dir/status" 2>/dev/null || echo 000 > "$dir/status"
  assert_eq "$(cat "$dir/status")" "200" "$3: 200" || true
  csp=$(tr -d '\r' < "$dir/headers" | sed -n 's/^[Cc]ontent-[Ss]ecurity-[Pp]olicy: //p')
  assert_contains "${csp}" "script-src '$(inline_hash script < "$dir/body")'" "…its CSP names the script served" || true
  assert_contains "${csp}" "'$(inline_hash style < "$dir/body")'" "…and the style served" || true
  assert_contains "${csp}" "frame-ancestors 'none'" "…nothing frames it" || true
}

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

# A second domain, with a brand: its pages are in a rendering the update must
# rebuild. (The primary stays without one: its stock pages are checked below.)
DOMAIN_2=$(test_domain_n "${DOMAIN}" second)
local_domain_dns "${DOMAIN_2}"
RESP=$(api_post "domains" "{\"name\":\"${DOMAIN_2}\"}")
assert_json_field "$RESP" '.domain.status' 'pending' "Domain ${DOMAIN_2} added" || true
RESP=$(CURL_TIMEOUT=150 api_post "domains/${DOMAIN_2}/activate")
assert_json_field "$RESP" '.domain.status' 'active' "…active" || true
local_wait_authelia "${DOMAIN_2}"
RESP=$(api_put "domains/${DOMAIN_2}/branding" "{\"name\":\"${BRAND}\",\"theme\":\"dark\",\"accent\":\"${ACCENT}\"}")
assert_json_field "$RESP" '.branding.name' "${BRAND}" "…branded ${BRAND}" || true
for _ in $(seq 1 30); do
  sudo test -f "${WEB_ROOT}/${DOMAIN_2}/rendered.json" && break
  sleep 2
done
if version_before "${BEFORE_VERSION}" "4.9.0"; then
  assert_eq "$(sudo jq -r '.pagesDigest // "none"' "${WEB_ROOT}/${DOMAIN_2}/rendered.json" 2>/dev/null || echo "missing")" "none" "${BEFORE_VERSION}'s rendering records no pages digest" || true
else
  assert_eq "$(sudo jq -r '.pagesDigest // "none" | test("^[0-9a-f]{64}$")' "${WEB_ROOT}/${DOMAIN_2}/rendered.json" 2>/dev/null || echo "false")" "true" "${BEFORE_VERSION}'s rendering records its pages digest" || true
fi
BRANDED_PAGE_BEFORE=$(sudo sha256sum "${WEB_ROOT}/${DOMAIN_2}/invite/index.html" | cut -d' ' -f1)
# The pages the release before rendered ("none" before 4.9): the candidate
# renders them again only when its own pages differ.
PAGES_BEFORE=$(sudo jq -r '.pagesDigest // "none"' "${WEB_ROOT}/${DOMAIN_2}/rendered.json" 2>/dev/null || echo "none")

# Pending invitations made on the release before: one on each domain.
RESP=$(api_post "invitations" "{\"username\":\"${INVITEE}\",\"email\":\"${INVITEE}@example.test\",\"domains\":[\"${DOMAIN}\"]}")
assert_json_field "$RESP" '.ok' 'true' "A pending invitation on ${BEFORE_VERSION}" || true
INVITE_TOKEN=$(echo "$RESP" | jq -r '.token // empty')
INVITE_ID=$(echo "$RESP" | jq -r '.invitation.id // empty')
if version_before "${BEFORE_VERSION}" "4.9.0"; then
  assert_eq "$(echo "$RESP" | jq -r '.inviteUrl // empty')" "https://auth.${DOMAIN}/invite/${INVITE_TOKEN}" "…its link names the token in the path" || true
else
  assert_eq "$(echo "$RESP" | jq -r '.inviteUrl // empty')" "https://auth.${DOMAIN}/invite#${INVITE_TOKEN}" "…its link names the token in the fragment" || true
fi
RESP=$(api_post "invitations" "{\"username\":\"e2eupbranded\",\"email\":\"e2eupbranded@example.test\",\"domains\":[\"${DOMAIN_2}\"]}")
assert_json_field "$RESP" '.ok' 'true' "…and one on ${DOMAIN_2}" || true
BRANDED_TOKEN=$(echo "$RESP" | jq -r '.token // empty')
if version_before "${BEFORE_VERSION}" "4.9.0"; then
  assert_eq "$(sudo jq -r --arg t "${INVITE_TOKEN}" '[.[] | select(.token == $t)] | length' "${STATE_DIR}/invitations.json" 2>/dev/null || echo 0)" "1" "invitations.json holds it, its token in clear" || true
else
  assert_eq "$(sudo sqlite3 "${STATE_DIR}/state.db" "SELECT status FROM invitations WHERE id = '${INVITE_ID}'")" "pending" "state.db holds it, pending" || true
fi

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
# again. A relay on 4.8 or later has both already.
if version_before "${BEFORE_VERSION}" "4.8.0"; then
  SETTLED="no"
  for _ in $(seq 1 30); do
    if sudo journalctl -u lamalibre-lamaste-serverd --since "${UPDATE_STARTED}" --no-pager -o cat 2>/dev/null | grep -qE '"msg":"(Authelia domain access updated|Authelia restarted for the branded sign-in[^"]*)"'; then
      SETTLED="yes"
      break
    fi
    sleep 2
  done
  assert_eq "${SETTLED}" "yes" "The panel's start-up settled Authelia's configuration (domains rendered, or the branding base added)" || true
fi
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
# Two releases may ship the same script: what counts is that the one in place
# is the candidate's own.
mkdir -p "${WORK_DIR}/pack"
(cd "${WORK_DIR}/pack" && npm pack "@lamalibre/create-lamaste@${CANDIDATE}" --silent > /dev/null 2>&1) || true
PRIV_CANDIDATE=$(tar -xzOf "${WORK_DIR}/pack/lamalibre-create-lamaste-${CANDIDATE}.tgz" package/scripts/lamaste-priv 2>/dev/null | sha256sum | cut -d' ' -f1)
assert_eq "${PRIV_AFTER}" "${PRIV_CANDIDATE}" "lamaste-priv in place is the one ${CANDIDATE} ships" || true
if [ "${PRIV_AFTER}" = "${PRIV_BEFORE}" ]; then
  log_info "${BEFORE_VERSION} and ${CANDIDATE} ship the same lamaste-priv"
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

log_section "The primary domain; every user of ${BEFORE_VERSION} its member"

DOMAINS=$(api_get "domains" 2>/dev/null || echo '{}')
assert_json_field "$DOMAINS" '[.domains[] | select(.primary)] | length' '1' "One primary domain" || true
assert_json_field "$DOMAINS" '[.domains[] | select(.primary)] | first | "\(.name) \(.status)"' "${DOMAIN} active" "…${DOMAIN}, active" || true
assert_json_field "$DOMAINS" "[.domains[] | select(.name == \"${DOMAIN_2}\")] | first | .status" 'active' "…and ${DOMAIN_2}, active" || true
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
assert_contains "${AUTH_VHOST}" "brand.css\"></head>" "…links the stylesheet (4.14: the stock one carries the change-password link's rules)" || true
AUTH_PAGE=$(curl -sk --max-time 15 --resolve "${AUTH_FQDN}:443:127.0.0.1" -w '\n%{http_code}' "https://${AUTH_FQDN}/" 2>/dev/null || echo "000")
assert_eq "$(printf '%s\n' "${AUTH_PAGE}" | tail -n 1)" "200" "https://${AUTH_FQDN}/ answers 200" || true
assert_contains "${AUTH_PAGE}" 'data-theme="light"' "…data-theme=\"light\"" || true
assert_contains "${AUTH_PAGE}" 'data-logooverride="false"' "…data-logooverride=\"false\" (the placeholder is never shown)" || true
assert_contains "${AUTH_PAGE}" 'brand.css' "…links /brand.css (the stock stylesheet until a brand is set)" || true
assert_json_field "$CONFIG" '"\(.theme) \(.server.asset_path)"' "light /etc/authelia/assets" "Authelia's configuration gained theme light and server.asset_path /etc/authelia/assets" || true
assert_eq "$(sudo stat -c '%G' /etc/authelia/assets/logo.png 2>/dev/null || echo "missing")" "lamaste-authelia" "The placeholder logo is in the asset directory, group lamaste-authelia" || true
BASE_RESTARTS=$(api_get "audit?action=authelia.restarted&limit=200" 2>/dev/null | jq --argjson base "${AUDIT_BASE}" '[.entries[]? | select(.id > $base and .details.reason == "branding-base")] | length' 2>/dev/null || echo "?")
if version_before "${BEFORE_VERSION}" "4.8.0"; then
  assert_eq "${BASE_RESTARTS}" "1" "Exactly one authelia.restarted audited with reason branding-base since the update" || true
else
  assert_eq "${BASE_RESTARTS}" "0" "No authelia.restarted for the base: ${BEFORE_VERSION} had it" || true
fi
assert_json_field "$(api_get "domains/${DOMAIN}/branding" 2>/dev/null || echo '{}')" '.branding' "null" "GET /api/domains/${DOMAIN}/branding: no brand" || true
assert_eq "$(nginx -V 2>&1 | grep '^configure arguments:' | tr ' ' '\n' | grep -cx -- '--with-http_sub_module' || true)" "1" "nginx -V lists --with-http_sub_module (compiled in)" || true
INVITE_PAGE=$(sudo cat /var/www/lamaste/invite/index.html 2>/dev/null || echo "")
assert_contains "${INVITE_PAGE}" "<title>Lamaste — Accept Invitation</title>" "The stock invitation page is in place" || true
assert_contains "${INVITE_PAGE}" "--lamaste-page-accent" "…rewritten by the candidate (its colours are custom properties a brand sets from /brand.css)" || true

log_section "Signed in again: the user reaches what they reached"

# The update restarted Authelia, which keeps its sessions in memory.
local_sign_in "${USERNAME}" "${USER_PASSWORD}" "${SECRET}" "${WORK_DIR}/user-after.jar" "${DOMAIN}"
assert_eq "${SIGN_IN_RESULT}" "OK OK" "${USERNAME} signed in at auth.${DOMAIN} on ${CANDIDATE}" || true
assert_eq "$(signed_status "${WORK_DIR}/user-after.jar" "${ON_FQDN}")" "${REACH_BEFORE}" "…and is answered on ${ON_FQDN} as before (${REACH_BEFORE})" || true

# ===========================================================================
# 4. The invitations of the release before
# ===========================================================================

log_section "The pages under the candidate's CSP: the script served is the one it names"

assert_page_runs "${AUTH_FQDN}" "/invite/${INVITE_TOKEN}" "The old link's page on ${DOMAIN}, stock"
assert_page_runs "auth.${DOMAIN_2}" "/invite/${BRANDED_TOKEN}" "The old link's page on ${DOMAIN_2}, branded"
BRANDED_BODY=$(curl -sk --max-time 15 --resolve "auth.${DOMAIN_2}:443:127.0.0.1" "https://auth.${DOMAIN_2}/invite")
assert_contains "${BRANDED_BODY}" "<title>${BRAND} — Accept Invitation</title>" "…still the brand's page" || true
assert_contains "${BRANDED_BODY}" 'href="/brand.css"' "…its colours from /brand.css" || true
assert_contains "$(curl -sk --max-time 15 --resolve "auth.${DOMAIN_2}:443:127.0.0.1" "https://auth.${DOMAIN_2}/brand.css")" "--lamaste-page-accent: ${ACCENT};" "…which carries the accent" || true
assert_page_runs "auth.${DOMAIN_2}" "/invitations/e2e" "The new inviter's page on ${DOMAIN_2}, branded"
# The candidate's own pages digest, from the core library its panel runs.
CANDIDATE_PAGES=$(sudo bash -c 'cd /opt/lamalibre/lamaste/serverd && node --input-type=module -e "const m = await import(\"@lamalibre/lamaste/server\"); process.stdout.write(m.authPagesDigest());"' 2>/dev/null || echo "unknown")
assert_eq "$(sudo jq -r '.pagesDigest // "none"' "${WEB_ROOT}/${DOMAIN_2}/rendered.json" 2>/dev/null || echo "missing")" "${CANDIDATE_PAGES}" "The branded rendering holds the candidate's pages (rendered.json's pagesDigest is ${CANDIDATE}'s)" || true
BRANDED_PAGE_AFTER=$(sudo sha256sum "${WEB_ROOT}/${DOMAIN_2}/invite/index.html" | cut -d' ' -f1)
if [ "${PAGES_BEFORE}" != "${CANDIDATE_PAGES}" ]; then
  assert_not_eq "${BRANDED_PAGE_AFTER}" "${BRANDED_PAGE_BEFORE}" "…rendered again: ${BEFORE_VERSION}'s pages are not the candidate's" || true
else
  assert_eq "${BRANDED_PAGE_AFTER}" "${BRANDED_PAGE_BEFORE}" "…the page as it was: ${BEFORE_VERSION}'s pages are the candidate's" || true
fi
assert_eq "$(sudo jq -r '.pagesDigest // "none" | test("^[0-9a-f]{64}$")' "${WEB_ROOT}/${DOMAIN_2}/rendered.json" 2>/dev/null || echo "false")" "true" "rendered.json holds the pages' digest" || true
assert_eq "$(sudo jq -r '.brandSha256 // "none"' "${WEB_ROOT}/${DOMAIN_2}/rendered.json" 2>/dev/null)" "$(sudo sha256sum "${WEB_ROOT}/${DOMAIN_2}/brand.json" | cut -d' ' -f1)" "…and names the brand it holds by brand.json's digest" || true

log_section "The invitations moved into state.db"

if sudo test -e "${STATE_DIR}/invitations.json"; then
  log_fail "invitations.json is still there"
else
  log_pass "invitations.json is gone"
fi
LISTED=$(api_get "invitations" 2>/dev/null || echo '{}')
assert_json_field "$LISTED" "[.invitations[] | select(.id == \"${INVITE_ID}\") | \"\(.kind) \(.username) \(.status)\"] | first" "admin ${INVITEE} pending" "The invitation is listed: an administrator's, pending" || true
assert_eq "$(sudo cat "${STATE_DIR}"/state.db* | grep -caF "${INVITE_TOKEN}" || true)" "0" "No clear token in state.db or its log" || true
assert_eq "$(sudo sqlite3 "${STATE_DIR}/state.db" "SELECT token_sha256 FROM invitations WHERE id = '${INVITE_ID}'")" "$(printf '%s' "${INVITE_TOKEN}" | xxd -r -p | sha256sum | cut -d' ' -f1)" "It holds the token's SHA-256" || true

log_section "The invitation of ${BEFORE_VERSION} accepts by POST"

invite_post() {
  curl -sk --max-time 15 --resolve "${AUTH_FQDN}:443:127.0.0.1" -X POST -H 'Content-Type: application/json' -d "$2" "https://${AUTH_FQDN}/api/invite/$1" 2>/dev/null || echo '{}'
}
assert_json_field "$(invite_post lookup "{\"token\":\"${INVITE_TOKEN}\"}")" '"\(.kind) \(.username)"' "admin ${INVITEE}" "POST /api/invite/lookup finds it" || true
ACCEPT=$(invite_post accept "$(jq -c -n --arg t "${INVITE_TOKEN}" --arg p "${INVITEE_PASSWORD}" '{token: $t, password: $p}')")
assert_json_field "$ACCEPT" '"\(.ok) \(.username)"' "true ${INVITEE}" "POST /api/invite/accept: the user is made" || true
assert_contains "$(echo "$ACCEPT" | jq -r '.totpQr // empty')" "data:image/svg+xml;base64," "…with the panel's QR" || true
assert_json_field "$(api_get "users" 2>/dev/null || echo '{}')" "[.users[] | select(.username == \"${INVITEE}\") | [.domains[] | \"\(.name):\(.kind)\"] | join(\",\")] | first" "${DOMAIN}:member" "…a member of ${DOMAIN}, as the invitation named" || true

# ===========================================================================
# 5. The page language
# ===========================================================================

log_section "The page language: migration 0021, no domain has one, every page English"

assert_eq "$(sudo sqlite3 "${STATE_DIR}/state.db" "SELECT COUNT(*) FROM pragma_table_info('domains') WHERE name = 'language'")" "1" "state.db's domains carry a language column (migration 0021)" || true
DOMAINS=$(api_get "domains" 2>/dev/null || echo '{}')
assert_json_field "$DOMAINS" '[.domains[] | select(.language != null)] | length' '0' "No domain has a language" || true
assert_json_field "$DOMAINS" '(.authelia.running != null) and (.authelia.running == .authelia.pinned)' 'true' "The running Authelia is the pin ($(echo "$DOMAINS" | jq -c '.authelia // {}' 2>/dev/null))" || true
assert_json_field "$DOMAINS" "[.domains[] | select(.name == \"${DOMAIN_2}\")] | first | \"\\(.rendering.current) \\(.rendering.rendered.language)\"" 'true null' "${DOMAIN_2}'s rendering is current, of its brand alone" || true
STOCK_INVITE=$(sudo cat /var/www/lamaste/invite/index.html 2>/dev/null || echo "")
assert_contains "${STOCK_INVITE}" '<html lang="en">' "The stock invitation page: lang=\"en\"" || true
assert_contains "${STOCK_INVITE}" '<script type="application/json" id="lamaste-messages">' "…its words in the data block the candidate writes" || true
assert_contains "$(sudo cat "${WEB_ROOT}/${DOMAIN_2}/invite/index.html" 2>/dev/null || echo "")" '<html lang="en">' "${DOMAIN_2}'s branded invitation page: lang=\"en\"" || true
assert_contains "$(sudo cat /var/www/lamaste/unavailable/index.html 2>/dev/null || echo "")" '<html lang="en">' "The stock \"not available\" page is in place, in English" || true
for D in "${DOMAIN}" "${DOMAIN_2}"; do
  AUTH_VHOST=$(sudo cat "${AVAILABLE}/$(vhost_name auth "${D}")" 2>/dev/null || echo "")
  assert_not_contains "${AUTH_VHOST}" "locales/forced" "The auth vhost of ${D} forces no locale" || true
  assert_not_contains "${AUTH_VHOST}" "data-authelia-lang" "…and leaves Authelia's lang alone" || true
done
assert_not_contains "$(curl -sk --max-time 15 --resolve "${AUTH_FQDN}:443:127.0.0.1" "https://${AUTH_FQDN}/")" "data-authelia-lang" "https://${AUTH_FQDN}/: Authelia's own <html lang>" || true
assert_eq "$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 http://127.0.0.1:9294/access-request 2>/dev/null || echo 000)" "404" "Gatekeeper's GET /access-request is gone (404)" || true

log_section "The panel logged no error since the update"

ERRORS=$(sudo journalctl -u lamalibre-lamaste-serverd --since "${UPDATE_STARTED}" --no-pager -o cat 2>/dev/null | grep -cE '"level":(50|60)' || true)
assert_eq "${ERRORS}" "0" "No level ≥ 50 line in the panel's journal since ${UPDATE_STARTED}" || true

end_test

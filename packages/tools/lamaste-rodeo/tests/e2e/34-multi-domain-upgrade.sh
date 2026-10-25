#!/usr/bin/env bash
# ============================================================================
# 34 — Multi-domain relay: a single-domain relay upgraded in place (Single-VM)
# ============================================================================
# A relay of 4.6 knows one domain and names its vhosts by subdomain
# (lamalibre-lamaste-app-<subdomain>, lamalibre-lamaste-auth). From 4.7 they
# are named by full hostname (lamalibre-lamaste-app-<fqdn>,
# lamalibre-lamaste-auth-<domain>) and the panel renames what it finds when
# it starts (design: packages/core/docs/multi-domain-relay-design.md,
# "Upgrade in place"). Here:
#
# 1. Two tunnels, one enabled and one disabled; how each host answers.
# 2. Their vhosts and the auth portal's put back under the 4.6 names, link
#    state as it was (the enabled one linked, the disabled one not).
# 3. The panel restarted: every vhost renamed to its full hostname, link
#    state kept, the legacy names gone, nginx -t passes, every host answers
#    as before.
# 4. One domain, the primary, active; every user its member; new users
#    need no domains.
# 5. lamaste-priv writes no vhost under a 4.6 name, nor under a dotted name
#    it does not know.
#
# This is the nginx side of the rename that has no unit test (the panel's
# nginx.js works on the real /etc/nginx).
# ============================================================================

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/helpers.sh"

require_commands curl jq nginx

begin_test "34 — Multi-domain relay: a single-domain relay upgraded in place"

RUN_ID="$(date +%s)"
AGENT_LABEL_34="md-upgrade-e2e-${RUN_ID}"
SUB_ON="e2e34on"
SUB_OFF="e2e34off"
PORT_ON=19934
PORT_OFF=19935
TUNNEL_ON=""
TUNNEL_OFF=""
AVAILABLE="/etc/nginx/sites-available"
ENABLED="/etc/nginx/sites-enabled"

cleanup() {
  log_info "Cleaning up test resources..."
  local id
  for id in ${TUNNEL_ON} ${TUNNEL_OFF}; do
    api_delete "tunnels/${id}" > /dev/null 2>&1 || true
  done
  api_delete "certs/agent/${AGENT_LABEL_34}" > /dev/null 2>&1 || true
  sudo rm -f "${AVAILABLE}/lamalibre-lamaste-app-e2e34legacy" "${AVAILABLE}/lamalibre-lamaste-x-e2e34.example.test"
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

# to_legacy <new name> <legacy name> — the vhost under its 4.6 name, linked
# under it if it was linked under the new one
to_legacy() {
  local linked=no
  if sudo test -L "${ENABLED}/$1"; then linked=yes; fi
  sudo mv "${AVAILABLE}/$1" "${AVAILABLE}/$2"
  sudo rm -f "${ENABLED}/$1"
  if [ "$linked" = "yes" ]; then sudo ln -s "${AVAILABLE}/$2" "${ENABLED}/$2"; fi
}

panel_up() { [ "$(api_get "health" 2>/dev/null | jq -r '.status' 2>/dev/null || echo "")" = "ok" ]; }

# ---------------------------------------------------------------------------
log_section "Pre-flight: check onboarding is complete"
# ---------------------------------------------------------------------------

ONBOARDING=$(api_get "onboarding/status" 2>/dev/null || echo '{}')
if [ "$(echo "$ONBOARDING" | jq -r '.status' 2>/dev/null || echo unknown)" != "COMPLETED" ]; then
  log_skip "Onboarding not completed — skipping"
  end_test
  exit $?
fi
DOMAIN=$(echo "$ONBOARDING" | jq -r '.domain // empty')
log_pass "Onboarding is complete (domain ${DOMAIN})"
ON_FQDN="${SUB_ON}.${DOMAIN}"
OFF_FQDN="${SUB_OFF}.${DOMAIN}"
AUTH_FQDN="auth.${DOMAIN}"

# ===========================================================================
# 1. Two tunnels: one enabled, one disabled
# ===========================================================================

log_section "Two tunnels, one disabled; how each host answers"

AGENT=$(api_post "certs/agent" "{\"label\":\"${AGENT_LABEL_34}\",\"capabilities\":[\"tunnels:read\"]}")
assert_json_field "$AGENT" '.ok' 'true' "Agent ${AGENT_LABEL_34} enrolled (it carries the tunnels)" || true
RESP=$(api_post "tunnels" "{\"subdomain\":\"${SUB_ON}\",\"port\":${PORT_ON},\"accessMode\":\"authenticated\",\"agentLabel\":\"${AGENT_LABEL_34}\"}")
TUNNEL_ON=$(echo "$RESP" | jq -r '.tunnel.id // empty')
assert_json_field "$RESP" '.tunnel.fqdn' "${ON_FQDN}" "Tunnel ${ON_FQDN}" || true
RESP=$(api_post "tunnels" "{\"subdomain\":\"${SUB_OFF}\",\"port\":${PORT_OFF},\"accessMode\":\"authenticated\",\"agentLabel\":\"${AGENT_LABEL_34}\"}")
TUNNEL_OFF=$(echo "$RESP" | jq -r '.tunnel.id // empty')
assert_json_field "$RESP" '.tunnel.fqdn' "${OFF_FQDN}" "Tunnel ${OFF_FQDN}" || true
RESP=$(api_patch "tunnels/${TUNNEL_OFF}" '{"enabled":false}')
assert_json_field "$RESP" '.tunnel.enabled' 'false' "…disabled" || true

assert_eq "$(link_state "lamalibre-lamaste-app-${ON_FQDN}")" "available linked" "4.7 names the enabled tunnel's vhost by its full hostname, linked" || true
assert_eq "$(link_state "lamalibre-lamaste-app-${OFF_FQDN}")" "available unlinked" "…the disabled one's too, not linked" || true
assert_eq "$(link_state "lamalibre-lamaste-auth-${DOMAIN}")" "available linked" "…and the auth portal's by its domain" || true

BEFORE="$(host_status "${ON_FQDN}") $(host_status "${OFF_FQDN}") $(host_status "${AUTH_FQDN}")"
log_info "Before: ${ON_FQDN} ${OFF_FQDN} ${AUTH_FQDN} answer ${BEFORE}"

# ===========================================================================
# 2. The vhosts as 4.6 left them
# ===========================================================================

log_section "The vhosts put back under their 4.6 names"

to_legacy "lamalibre-lamaste-app-${ON_FQDN}" "lamalibre-lamaste-app-${SUB_ON}"
to_legacy "lamalibre-lamaste-app-${OFF_FQDN}" "lamalibre-lamaste-app-${SUB_OFF}"
to_legacy "lamalibre-lamaste-auth-${DOMAIN}" "lamalibre-lamaste-auth"
if sudo nginx -t > /dev/null 2>&1 && sudo systemctl reload nginx; then
  log_pass "nginx serves the 4.6 names"
else
  log_fail "nginx -t refused the 4.6 names"
fi
assert_eq "$(link_state "lamalibre-lamaste-app-${SUB_ON}") $(link_state "lamalibre-lamaste-app-${SUB_OFF}") $(link_state lamalibre-lamaste-auth)" \
  "available linked available unlinked available linked" "4.6 names in place, link state as it was" || true
assert_eq "$(host_status "${ON_FQDN}") $(host_status "${OFF_FQDN}") $(host_status "${AUTH_FQDN}")" "${BEFORE}" "…every host answers as before" || true

# ===========================================================================
# 3. The panel starts: renamed
# ===========================================================================

log_section "The panel restarted: every vhost renamed to its full hostname"

sudo systemctl restart lamalibre-lamaste-serverd
PANEL_BACK=false
for _ in $(seq 1 30); do
  if panel_up; then
    PANEL_BACK=true
    break
  fi
  sleep 2
done
if [ "$PANEL_BACK" = "true" ]; then
  log_pass "The panel is back"
else
  log_fail "The panel did not come back after its restart"
fi
assert_eq "$(link_state "lamalibre-lamaste-app-${ON_FQDN}")" "available linked" "${ON_FQDN}: renamed, still linked" || true
assert_eq "$(link_state "lamalibre-lamaste-app-${OFF_FQDN}")" "available unlinked" "${OFF_FQDN}: renamed, still not linked" || true
assert_eq "$(link_state "lamalibre-lamaste-auth-${DOMAIN}")" "available linked" "The auth portal: renamed to lamalibre-lamaste-auth-${DOMAIN}, linked" || true
assert_eq "$(link_state "lamalibre-lamaste-app-${SUB_ON}") $(link_state "lamalibre-lamaste-app-${SUB_OFF}") $(link_state lamalibre-lamaste-auth)" \
  "gone unlinked gone unlinked gone unlinked" "No 4.6 name is left, as a file or a link" || true
if sudo nginx -t > /dev/null 2>&1; then
  log_pass "nginx -t passes"
else
  log_fail "nginx -t fails after the rename"
fi
assert_eq "$(host_status "${ON_FQDN}") $(host_status "${OFF_FQDN}") $(host_status "${AUTH_FQDN}")" "${BEFORE}" "Every host answers as before (${BEFORE})" || true
if sudo journalctl -u lamalibre-lamaste-serverd --since "-2min" --no-pager 2>/dev/null | grep -q "lamalibre-lamaste-app-${SUB_ON}"; then
  log_pass "The panel logged the rename"
else
  log_info "No rename line found in the panel's journal"
fi

# ===========================================================================
# 4. One domain, everyone its member
# ===========================================================================

log_section "One domain, the primary; every user its member"

DOMAINS=$(api_get "domains" 2>/dev/null || echo '{}')
assert_json_field "$DOMAINS" '.domains | length' '1' "One domain" || true
assert_json_field "$DOMAINS" '.domains[0] | "\(.name) \(.primary) \(.status)"' "${DOMAIN} true active" "…the primary, ${DOMAIN}, active" || true
assert_json_field "$DOMAINS" '.newUsersNeedDomains' 'false' "…new users need no domains while it is the only one" || true
USERS=$(api_get "users" 2>/dev/null || echo '{}')
assert_eq "$(echo "$DOMAINS" | jq -r '.domains[0].members')" "$(echo "$USERS" | jq '[.users[]? | select((.status // "active") != "removed")] | length')" "Every user is a member of it" || true
assert_eq "$(echo "$USERS" | jq --arg d "${DOMAIN}" '[.users[]? | select((.domains // []) != [$d])] | length')" "0" "…each user's domains are exactly the primary" || true

# ===========================================================================
# 5. lamaste-priv
# ===========================================================================

log_section "lamaste-priv writes no vhost under a 4.6 name or an unknown dotted one"

RC=$(printf 'server {\n listen 443 ssl;\n}\n' | sudo /usr/local/sbin/lamaste-priv nginx-site write lamalibre-lamaste-app-e2e34legacy > /dev/null 2>&1; echo $?)
assert_not_eq "$RC" "0" "write lamalibre-lamaste-app-e2e34legacy (a 4.6 name) is refused (exit ${RC})" || true
assert_eq "$(link_state lamalibre-lamaste-app-e2e34legacy)" "gone unlinked" "…and leaves no file" || true
RC=$(printf 'server {\n listen 443 ssl;\n}\n' | sudo /usr/local/sbin/lamaste-priv nginx-site write lamalibre-lamaste-x-e2e34.example.test > /dev/null 2>&1; echo $?)
assert_not_eq "$RC" "0" "write lamalibre-lamaste-x-e2e34.example.test (a dotted name it does not know) is refused (exit ${RC})" || true
assert_eq "$(link_state lamalibre-lamaste-x-e2e34.example.test)" "gone unlinked" "…and leaves no file" || true

end_test

#!/usr/bin/env bash
# shellcheck disable=SC2034 # variables are read by the specs that source this file
# ============================================================================
# The multi-domain relay's three-VM specs (45–48): shared helpers
# ============================================================================
# Sourced after ../e2e/helpers.sh and app-plugin-harness.sh (host_api_*,
# visit, sign_in, reset_totp, users_call, wait_for). A spec sets MD_SPEC (its
# number) first: its cookie jars are named after it.
#
# The relay's primary domain (DOMAIN, onboarding's) is base domain A; B and
# C are test_domain_n's second and third (../e2e/test-domains.sh) — what
# setup-host.sh's dnsmasq and setup-visitor.sh's /etc/hosts already resolve
# on a fresh provisioning. Specs make sure of them again (md_dns), because a
# VM restored from an older snapshot predates them.
#
# Every rendering of the relay's members changes Authelia's configuration
# and restarts it, and Authelia keeps its sessions in memory: adding or
# activating a domain, creating or deleting a user, adding or removing a
# member — each ends every session. The specs make all such changes before
# anyone signs in, or sign in again after one (md_wait_authelia).
# ============================================================================

MD_SPEC="${MD_SPEC:-md}"
DOMAIN_2=""
DOMAIN_3=""
# Domains a spec added (and removes again in its cleanup, when nothing uses them)
ADDED_DOMAINS=""
# The visitor's /etc/hosts lines a spec added, by this marker
MD_HOSTS_MARK="# lamaste-e2e-multi-domain"
# How long a change of who may pass takes to reach every request: nginx keeps
# an authorization's 200 for 10 s (Gatekeeper's Cache-Control), Gatekeeper's
# file watcher reads the projection on its next event.
AUTHZ_SETTLE_SECONDS=30
# Gatekeeper's projection of the panel's directory, and where a spec keeps
# the panel's own while it changes it
PROJECTION="/etc/lamalibre/lamaste/domains.json"
PROJECTION_SAVED="/var/tmp/e2e-md-domains.json"

# md_setup — B and C named; the visitor can make Authelia's second factor.
# After relay_preflight or app_plugin_preflight.
md_setup() {
  DOMAIN_2=$(test_domain_n "${DOMAIN}" second)
  DOMAIN_3=$(test_domain_n "${DOMAIN}" third)
  log_pass "Base domains: A = ${DOMAIN} (primary), B = ${DOMAIN_2}, C = ${DOMAIN_3}"
  if ! visitor_has_oathtool; then
    log_fail "The visitor VM has no oathtool: no one can sign in"
    end_test
    exit $?
  fi
}

# md_preflight — relay_preflight, then md_setup
md_preflight() {
  relay_preflight
  md_setup
}

# md_jar <name> — a visitor cookie jar of this spec
md_jar() { echo "/tmp/e2e-md-${MD_SPEC}-$1.cookies"; }

# md_api <method> <path> [json] — host_api_call with a long timeout:
# activation issues a certificate and restarts Authelia
md_api() { API_TIMEOUT=150 host_api_call "$@"; }

# md_dns <domain> — the host's dnsmasq answers <domain> and every name under
# it with the host's address; the visitor resolves its sign-in page
md_dns() {
  host_exec "grep -qxF 'address=/$1/${HOST_IP}' /etc/dnsmasq.d/lamaste-test.conf 2>/dev/null || { echo 'address=/$1/${HOST_IP}' >> /etc/dnsmasq.d/lamaste-test.conf && systemctl restart dnsmasq; }" > /dev/null 2>&1 || true
  md_hosts "auth.$1"
}

# md_hosts <hostname...> — the visitor reaches each name at the host
md_hosts() {
  local h
  for h in "$@"; do
    visitor_exec "grep -q ' $h ${MD_HOSTS_MARK}\$' /etc/hosts || echo '${HOST_IP} $h ${MD_HOSTS_MARK}' >> /etc/hosts" > /dev/null 2>&1 || true
  done
}

# domain_entry <name> — the domain as GET /api/domains lists it ('null' when none)
domain_entry() {
  host_api_get "domains" 2>/dev/null | jq -c --arg n "$1" '[.domains[]? | select(.name == $n)] | first // null' 2>/dev/null || echo "null"
}

# domain_members <domain> — its members' usernames as the panel lists them, sorted, comma-separated
domain_members() {
  host_api_get "domains/$1/members" 2>/dev/null | jq -r '[.members[]?.username] | sort | join(",")' 2>/dev/null || echo ""
}

# md_domain_active <name> — the domain exists and is active: added (and
# remembered in ADDED_DOMAINS) when it is not there, its DNS checked,
# activated when pending. Asserts each step.
md_domain_active() {
  local name="$1" status resp
  md_dns "$name"
  status=$(json_get "$(domain_entry "$name")" '.status // "none"')
  if [ "$status" = "none" ]; then
    resp=$(md_api POST "domains" "{\"name\":\"${name}\"}")
    assert_eq "$(status_of "$resp")" "201" "Domain ${name} added (201)" || true
    status=$(json_get "$(body_of "$resp")" '.domain.status')
    assert_eq "$status" "pending" "…pending until activated" || true
    ADDED_DOMAINS="${ADDED_DOMAINS} ${name}"
  fi
  resp=$(md_api POST "domains/${name}/verify-dns")
  assert_json_field "$(body_of "$resp")" '.ok' 'true' "DNS of ${name}: auth.${name} resolves to the relay" || true
  assert_json_field "$(body_of "$resp")" '[.records[] | select(.required)] | map(.name) | join(",")' "auth.${name}" "…the one required record is auth.${name}" || true
  if [ "$status" != "active" ]; then
    resp=$(md_api POST "domains/${name}/activate")
    status=$(json_get "$(body_of "$resp")" '.domain.status')
  fi
  assert_eq "$status" "active" "${name} is active" || true
  md_wait_authelia "$name"
}

# authelia_up <domain> — the sign-in page of <domain> answers the visitor
authelia_up() { [ "$(visit_status "$(visit - "https://auth.$1/api/health")")" = "200" ]; }

# md_wait_authelia [domain] — Authelia answers again after a restart
md_wait_authelia() {
  if ! wait_for 90 authelia_up "${1:-${DOMAIN}}"; then
    log_fail "Authelia does not answer at auth.${1:-${DOMAIN}}"
  fi
}

# md_user <variable> <username> <password> <domains, a JSON array> — a
# user, member of those domains (a leftover of an earlier run erased first);
# its directory id into <variable>. Not in a command substitution: it asserts.
md_user() {
  local resp id
  host_api_delete "users/$2?erase=true" > /dev/null 2>&1 || true
  resp=$(users_call POST "users" "{\"username\":\"$2\",\"displayname\":\"E2E $2\",\"email\":\"$2@example.test\",\"password\":\"$3\",\"groups\":[],\"domains\":$4}")
  assert_eq "$(status_of "$resp")" "201" "User $2 created, member of $(echo "$4" | jq -r 'join(" and ")')" || true
  id=$(json_get "$(body_of "$resp")" '.user.userId // empty')
  printf -v "$1" '%s' "$id"
}

# user_domains <username> — the user's domains as GET /api/users lists them, sorted, comma-separated
user_domains() {
  host_api_get "users" 2>/dev/null | jq -r --arg u "$1" '[.users[]? | select(.username == $u) | .domains[]?] | sort | join(",")' 2>/dev/null || echo ""
}

# md_backends <port:marker>... — a static server on the agent VM for each,
# answering /index.html with <marker> on 127.0.0.1:<port>; the agent's sync
# started once; then each asserted reachable through chisel
md_backends() {
  local pair port marker
  for pair in "$@"; do
    port="${pair%%:*}"
    marker="${pair#*:}"
    agent_exec "pkill -f '[p]ython3 -m http.server ${port} ' 2>/dev/null; mkdir -p /var/tmp/e2e-md-${port} && echo '${marker}' > /var/tmp/e2e-md-${port}/index.html" > /dev/null 2>&1 || true
    agent_exec "nohup python3 -m http.server ${port} --bind 127.0.0.1 -d /var/tmp/e2e-md-${port} &>/dev/null & exit" > /dev/null 2>&1 || true
  done
  nudge_sync
  for pair in "$@"; do
    if wait_for 120 tunnel_reachable "${pair%%:*}" "${pair#*:}"; then
      log_pass "Port ${pair%%:*}: the backend answers through chisel"
    else
      log_fail "Port ${pair%%:*}: the backend does not answer through chisel"
    fi
  done
}

# md_backend_stop <port...>
md_backend_stop() {
  local port
  for port in "$@"; do
    timed_exec 30 multipass exec "${AGENT_VM}" -- sudo bash -c "pkill -f '[p]ython3 -m http.server ${port} ' 2>/dev/null; rm -rf /var/tmp/e2e-md-${port}; true" > /dev/null 2>&1
  done
}

# tunnel_reachable <port> <marker> — the backend answers through chisel on the host VM
tunnel_reachable() {
  [ "$(host_exec "curl -s --max-time 3 http://127.0.0.1:$1/index.html || true" 2>/dev/null | tr -d '\r\n')" = "$2" ]
}

# md_tunnel <variable> <subdomain> <domain> <port> <access mode> — a tunnel
# the agent carries on <subdomain>.<domain> (a leftover on that hostname
# removed first), the visitor resolving it; its id into <variable>. Asserts.
md_tunnel() {
  local resp id
  for id in $(host_api_get "tunnels?limit=500" 2>/dev/null | jq -r --arg f "$2.$3" '.tunnels[]? | select(.fqdn == $f) | .id' 2>/dev/null || true); do
    host_api_delete "tunnels/${id}" > /dev/null 2>&1 || true
  done
  resp=$(host_api_call POST "tunnels" "{\"subdomain\":\"$2\",\"domain\":\"$3\",\"port\":$4,\"accessMode\":\"$5\",\"agentLabel\":\"${HOST_AGENT_LABEL}\"}")
  assert_json_field "$(body_of "$resp")" '"\(.tunnel.fqdn) \(.tunnel.accessMode)"' "$2.$3 $5" "Tunnel $2.$3 ($5), carried by ${HOST_AGENT_LABEL}" || true
  id=$(json_get "$(body_of "$resp")" '.tunnel.id // empty')
  md_hosts "$2.$3"
  printf -v "$1" '%s' "$id"
}

# md_sign_in <username> <password> <secret> <jar> <host> — sign_in at the
# sign-in page of <host>'s domain (a tunnel's hostname is one label under
# it), asserted. A TOTP code is used once: a user signing in again before the
# step of their last code has passed waits for the next one. The step is the
# one when the sign-in ended (the code is made during it, and a sign-in begun
# at a step's last second takes the next step's code); it is remembered per
# user — never call this in a command substitution.
md_sign_in() {
  local domain="${5#*.}" key
  key="MD_TOTP_STEP_${1//[^A-Za-z0-9]/_}"
  while [ -n "${!key:-}" ] && [ "$(($(date +%s) / 30))" -le "${!key}" ]; do
    wait_for_next_totp_window
  done
  assert_eq "$(sign_in "$1" "$2" "$3" "$4" "$5" "${domain}")" "OK OK" "$1 signed in at auth.${domain} (password, TOTP)" || true
  printf -v "$key" '%s' "$(($(date +%s) / 30))"
}

# outcome <jar | -> <url> — "<status> <redirect host | ->" of one request from the visitor
outcome() {
  local resp location
  resp=$(visit "$1" "$2")
  location=$(visit_headers "$resp" | awk 'tolower($1) == "location:" {print $2}' | tail -n 1)
  if [ -n "$location" ]; then
    printf '%s %s\n' "$(visit_status "$resp")" "$(printf '%s' "$location" | sed -E 's#^https?://([^/:?]+).*#\1#')"
  else
    printf '%s -\n' "$(visit_status "$resp")"
  fi
}

# assert_served <jar> <url> <marker> <what> — 200, from the backend
assert_served() {
  local resp
  resp=$(visit "$1" "$2")
  assert_eq "$(visit_status "$resp")" "200" "$4: 200" || true
  assert_contains "$(visit_body "$resp")" "$3" "…from its backend" || true
}

# assert_domain_refusal <response of visit> <domain> <what> — the refusal page
# of a signed-in non-member: 403, the page names <domain>, no redirect
assert_domain_refusal() {
  assert_eq "$(visit_status "$1")" "403" "$3: 403" || true
  assert_contains "$(visit_body "$1")" "Not a member" "…the domain refusal page" || true
  assert_contains "$(visit_body "$1")" "$2" "…naming $2" || true
  assert_not_contains "$(visit_headers "$1" | tr '[:upper:]' '[:lower:]')" "location:" "…never a redirect to a sign-in page (no login loop)" || true
}

# authelia_config — Authelia's configuration on the host VM, as JSON
authelia_config() { host_exec "${AUTHELIA_CONFIG_JSON}" 2>/dev/null | tail -n 1 || echo '{}'; }

# access_rules_of <domain> — Authelia's access_control rules for <domain> and the hosts under it, canonical JSON
access_rules_of() { authelia_config | jq -S -c --arg d "$1" "${AUTHELIA_RULES_UNDER}" 2>/dev/null || echo ""; }

# session_cookie_domains — the domains of Authelia's session cookies, sorted, comma-separated
session_cookie_domains() { authelia_config | jq -r '[.session.cookies[]?.domain] | sort | join(",")' 2>/dev/null || echo ""; }

# membership_removed <userId> — the directory.membership.removed audit entries
# of a user since the spec began, as a JSON array
membership_removed() {
  host_api_get "audit?action=directory.membership.removed&limit=200" 2>/dev/null |
    jq -c --arg id "$1" --argjson base "${AUDIT_BASE}" '[.entries[]? | select(.id > $base and .details.userId == $id)]' 2>/dev/null || echo "[]"
}

# --- Gatekeeper's projection (spec 46: Gatekeeper's own check) -------------
#
# The panel rewrites the projection whenever it renders — at least once a
# minute — and only when its content differs. To hold a change against it,
# the spec makes the file immutable, or puts a directory where the file was
# (the panel's rename fails on both; Gatekeeper reads a directory as no
# projection).

# projection_members <domain> — the members the projection holds for
# <domain>, sorted, comma-separated ('-' when the domain is not there)
projection_members() {
  host_exec "jq -r --arg d $(printf %q "$1") '[.domains[] | select(.name == \$d)] | if length == 0 then \"-\" else (.[0].members | sort | join(\",\")) end' ${PROJECTION}" 2>/dev/null | tail -n 1 || echo ""
}

# projection_hold <jq filter> — the panel's projection kept aside, then
# replaced by itself through <filter> (lamaste, 0600) and made immutable
projection_hold() {
  host_exec "test -f ${PROJECTION_SAVED} || cp -p ${PROJECTION} ${PROJECTION_SAVED}; jq -c $(printf %q "$1") ${PROJECTION_SAVED} > ${PROJECTION}.e2e && chown lamaste:lamaste ${PROJECTION}.e2e && chmod 0600 ${PROJECTION}.e2e && chattr -i ${PROJECTION} 2>/dev/null; mv ${PROJECTION}.e2e ${PROJECTION} && chattr +i ${PROJECTION}" > /dev/null 2>&1 || true
}

# projection_withdraw — no projection at all (a directory where it was)
projection_withdraw() {
  host_exec "test -f ${PROJECTION_SAVED} || cp -p ${PROJECTION} ${PROJECTION_SAVED}; chattr -i ${PROJECTION} 2>/dev/null; rm -f ${PROJECTION} && mkdir ${PROJECTION}" > /dev/null 2>&1 || true
}

# projection_restore — the panel's own projection back (nothing when none is kept aside)
projection_restore() {
  timed_exec 30 multipass exec "${HOST_VM}" -- sudo bash -c "if [ -f ${PROJECTION_SAVED} ]; then chattr -i ${PROJECTION} 2>/dev/null; if [ -d ${PROJECTION} ]; then rmdir ${PROJECTION}; fi; install -o lamaste -g lamaste -m 0600 ${PROJECTION_SAVED} ${PROJECTION} && rm -f ${PROJECTION_SAVED}; fi; true" > /dev/null 2>&1
}

# md_cleanup — what every spec's trap ends with: the projection back, the
# domains the spec added removed (refused while something still uses them:
# the spec's own cleanup removes those first), its jars and hosts lines gone
md_cleanup() {
  local d
  projection_restore
  for d in ${ADDED_DOMAINS}; do md_api DELETE "domains/${d}" > /dev/null 2>&1 || true; done
  timed_exec 30 multipass exec "${VISITOR_VM}" -- sudo bash -c "rm -f /tmp/e2e-md-${MD_SPEC}-*.cookies; sed -i '/${MD_HOSTS_MARK}\$/d' /etc/hosts; true" > /dev/null 2>&1
}

#!/usr/bin/env bash
# shellcheck disable=SC2034 # variables are read by the specs that source this file
# ============================================================================
# The multi-domain relay's three-VM specs (45–48): shared helpers
# ============================================================================
# Sourced after ../e2e/helpers.sh and app-plugin-harness.sh (host_api_*,
# visit, sign_in, reset_totp, users_call, wait_for, audit_count).
#
# The relay's primary domain (DOMAIN, onboarding's) is base domain A; B and
# C are the primary's first label replaced by `second` / `third`
# (test.lamaste.local → second.lamaste.local, third.lamaste.local) — what
# setup-host.sh's dnsmasq and setup-visitor.sh's /etc/hosts already resolve
# on a fresh provisioning, and rodeo.hooks.js passes as TEST_DOMAIN_2/3.
# Specs make sure of them again (md_dns), because a VM restored from an
# older snapshot predates them.
#
# Every rendering of the relay's members changes Authelia's configuration
# and restarts it, and Authelia keeps its sessions in memory: adding or
# activating a domain, creating or deleting a user, adding or removing a
# member — each ends every session. The specs make all such changes before
# anyone signs in, or sign in again after one (md_wait_authelia).
# ============================================================================

DOMAIN_2=""
DOMAIN_3=""
# Domains a spec added (and removes again in its cleanup, when nothing uses them)
ADDED_DOMAINS=""
# The visitor's /etc/hosts lines a spec added, by this marker
MD_HOSTS_MARK="# lamaste-e2e-multi-domain"
# A long call: activation issues a certificate and restarts Authelia.
CURL_MTLS_LONG="${CURL_MTLS} --max-time 150"

# md_preflight — onboarding complete; DOMAIN (A), DOMAIN_2 (B), DOMAIN_3
# (C); the agent enrolled; the visitor can make Authelia's second factor;
# AUDIT_BASE for audit_count
md_preflight() {
  local onboarding enrolled
  onboarding=$(host_api_get "onboarding/status" 2>/dev/null || echo '{}')
  if [ "$(json_get "$onboarding" '.status')" != "COMPLETED" ]; then
    log_skip "Onboarding not completed — skipping"
    end_test
    exit $?
  fi
  DOMAIN=$(json_get "$onboarding" '.domain // empty')
  if [ -z "$DOMAIN" ]; then
    log_skip "No domain configured — skipping"
    end_test
    exit $?
  fi
  DOMAIN_2="${TEST_DOMAIN_2:-second.${DOMAIN#*.}}"
  DOMAIN_3="${TEST_DOMAIN_3:-third.${DOMAIN#*.}}"
  log_pass "Onboarding is complete: A = ${DOMAIN} (primary), B = ${DOMAIN_2}, C = ${DOMAIN_3}"

  HOST_AGENT_LABEL=$(agent_config_field "agentLabel")
  HOST_AGENT_LABEL="${HOST_AGENT_LABEL:-test-agent}"
  enrolled=$(host_api_get "certs/agent" | jq -r "[.agents[]? | select(.label == \"${HOST_AGENT_LABEL}\" and (.revoked // false) == false)] | length" 2>/dev/null || echo "0")
  if [ "$enrolled" = "0" ]; then
    log_skip "Agent ${HOST_AGENT_LABEL} is not enrolled on the host — skipping"
    end_test
    exit $?
  fi
  log_pass "Agent ${HOST_AGENT_LABEL} is enrolled on the host"
  if ! visitor_has_oathtool; then
    log_fail "The visitor VM has no oathtool: no one can sign in"
    end_test
    exit $?
  fi
  AUDIT_BASE=$(host_api_get "audit?limit=1" | jq '.entries[0].id // 0' 2>/dev/null || echo "0")
}

# md_api <method> <path> [json] — host_api_call with a long timeout
md_api() {
  local data=""
  if [ -n "${3:-}" ]; then data="-H 'Content-Type: application/json' -d '$3'"; fi
  timed_exec 170 multipass exec "${HOST_VM}" -- sudo bash -c "${CURL_MTLS_LONG} -X $1 -H 'Accept: application/json' ${data} -w '\n%{http_code}' '${PANEL}/$2' || true" 2>/dev/null || echo "000"
}

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

# md_domain_active <name> — the domain exists and is active: added (and
# remembered in ADDED_DOMAINS) when it is not there, its DNS checked,
# activated when pending. Asserts each step.
md_domain_active() {
  local name="$1" entry resp
  md_dns "$name"
  entry=$(domain_entry "$name")
  if [ "$entry" = "null" ]; then
    resp=$(md_api POST "domains" "{\"name\":\"${name}\"}")
    assert_eq "$(status_of "$resp")" "201" "Domain ${name} added (201)" || true
    assert_json_field "$(body_of "$resp")" '.domain.status' 'pending' "…pending until activated" || true
    ADDED_DOMAINS="${ADDED_DOMAINS} ${name}"
  fi
  resp=$(md_api POST "domains/${name}/verify-dns")
  assert_json_field "$(body_of "$resp")" '.ok' 'true' "DNS of ${name}: auth.${name} resolves to the relay" || true
  assert_json_field "$(body_of "$resp")" '[.records[] | select(.required)] | map(.name) | join(",")' "auth.${name}" "…the one required record is auth.${name}" || true
  if [ "$(json_get "$(domain_entry "$name")" '.status')" != "active" ]; then
    resp=$(md_api POST "domains/${name}/activate")
    assert_eq "$(status_of "$resp")" "200" "Domain ${name} activated" || true
  fi
  assert_json_field "$(domain_entry "$name")" '.status' 'active' "${name} is active" || true
  md_wait_authelia "$name"
}

# authelia_up <domain> — the sign-in page of <domain> answers the visitor
authelia_up() {
  [ "$(visit_status "$(visit - "https://auth.$1/api/health")")" = "200" ]
}

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

# md_backend <port> <marker> — a static server on the agent VM answering
# /index.html with <marker> on 127.0.0.1:<port>
md_backend() {
  agent_exec "pkill -f '[p]ython3 -m http.server $1 ' 2>/dev/null; mkdir -p /var/tmp/e2e-md-$1 && echo '$2' > /var/tmp/e2e-md-$1/index.html" > /dev/null 2>&1 || true
  agent_exec "nohup python3 -m http.server $1 --bind 127.0.0.1 -d /var/tmp/e2e-md-$1 &>/dev/null & exit" > /dev/null 2>&1 || true
}

# md_backend_stop <port>
md_backend_stop() {
  timed_exec 30 multipass exec "${AGENT_VM}" -- sudo bash -c "pkill -f '[p]ython3 -m http.server $1 ' 2>/dev/null; rm -rf /var/tmp/e2e-md-$1; true" > /dev/null 2>&1
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

# tunnel_reachable <port> <marker> — the backend answers through chisel on the host VM
tunnel_reachable() {
  [ "$(host_exec "curl -s --max-time 3 http://127.0.0.1:$1/index.html || true" 2>/dev/null | tr -d '\r\n')" = "$2" ]
}

# md_sign_in <username> <password> <secret> <jar> <host> <domain> — sign_in at
# auth.<domain>, asserted
md_sign_in() {
  assert_eq "$(sign_in "$1" "$2" "$3" "$4" "$5" "$6")" "OK OK" "$1 signed in at auth.$6 (password, TOTP)" || true
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

# assert_domain_refusal <response of visit> <domain> <what> — the refusal page
# of a signed-in non-member: 403, the page names <domain>, no redirect
assert_domain_refusal() {
  assert_eq "$(visit_status "$1")" "403" "$3: 403" || true
  assert_contains "$(visit_body "$1")" "Not a member" "…the domain refusal page" || true
  assert_contains "$(visit_body "$1")" "$2" "…naming $2" || true
  assert_not_contains "$(visit_headers "$1" | tr '[:upper:]' '[:lower:]')" "location:" "…never a redirect to a sign-in page (no login loop)" || true
}

# access_rules_of <domain> — the access_control rules Authelia holds for
# <domain> and the hosts under it (python3's YAML on the host VM — the
# configuration is a Go template only in its issuer-key line), canonical JSON
access_rules_of() {
  host_exec "python3 -c 'import json,sys,yaml
d=sys.argv[1]
c=yaml.safe_load(\"\".join(l for l in open(\"/etc/authelia/configuration.yml\") if \"{{\" not in l))
under=lambda h: h==d or h.endswith(\".\"+d)
rules=[r for r in (c.get(\"access_control\") or {}).get(\"rules\") or [] if any(under(h.lstrip(\"*.\")) for h in ([r[\"domain\"]] if isinstance(r[\"domain\"],str) else r[\"domain\"]))]
print(json.dumps(rules,sort_keys=True,separators=(\",\",\":\")))' $(printf %q "$1")" 2>/dev/null | tail -n 1 || echo ""
}

# session_cookie_domains — the domains of Authelia's session.cookies, sorted, comma-separated
session_cookie_domains() {
  host_exec "python3 -c 'import yaml
c=yaml.safe_load(\"\".join(l for l in open(\"/etc/authelia/configuration.yml\") if \"{{\" not in l))
print(\",\".join(sorted(x[\"domain\"] for x in c[\"session\"][\"cookies\"])))'" 2>/dev/null | tail -n 1 || echo ""
}

# projection_members <domain> — the members Gatekeeper's domains.json holds
# for <domain>, sorted, comma-separated ('-' when the domain is not there)
projection_members() {
  host_exec "jq -r --arg d $(printf %q "$1") '[.domains[] | select(.name == \$d)] | if length == 0 then \"-\" else (.[0].members | sort | join(\",\")) end' /etc/lamalibre/lamaste/domains.json" 2>/dev/null | tail -n 1 || echo ""
}

# md_cleanup_domains — remove the domains this spec added (refused while
# something still uses them; the spec's own cleanup removes those first)
md_cleanup_domains() {
  local d
  for d in ${ADDED_DOMAINS}; do
    timed_exec 120 multipass exec "${HOST_VM}" -- sudo bash -c "${CURL_MTLS_LONG} -X DELETE '${PANEL}/domains/${d}' > /dev/null 2>&1; true" > /dev/null 2>&1
  done
  timed_exec 30 multipass exec "${VISITOR_VM}" -- sudo bash -c "sed -i '/${MD_HOSTS_MARK}\$/d' /etc/hosts; true" > /dev/null 2>&1
}

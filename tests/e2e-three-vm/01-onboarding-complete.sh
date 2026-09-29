#!/usr/bin/env bash
# ============================================================================
# 01 — Onboarding Complete Verification (Three-VM)
# ============================================================================
# Verifies that setup-host.sh completed successfully:
# - Onboarding status is COMPLETED
# - All core services are running (nginx, chisel, authelia, lamalibre-lamaste-serverd)
# - Self-signed certificates exist at expected paths
# - Panel is accessible via domain with mTLS
# - DNS resolves TEST_DOMAIN to HOST_IP
# - Chisel server hardening: pinned release 1.12.0; the authfile (every
#   agent's tunnel password) is 0640 lamaste:lamaste-chisel; chisel runs as
#   User=nobody Group=lamaste-chisel; the panel reaches the authfile through
#   SupplementaryGroups=lamaste-chisel; no fail-closed marker
# - Sudoers: certbot and Let's Encrypt openssl reads go only through the
#   root-owned wrappers lamaste-certbot and lamaste-cert-info, which refuse
#   extra arguments
# - Port 80: any Host is answered with a 301 to https://<same host><same URI>
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../e2e/helpers.sh"

require_commands multipass curl jq dig

# ---------------------------------------------------------------------------
# VM exec helpers — run commands on host/agent VMs via multipass
# ---------------------------------------------------------------------------

host_exec() { multipass exec lamaste-host -- sudo bash -c "$1"; }
agent_exec() { multipass exec lamaste-agent -- sudo bash -c "$1"; }
visitor_exec() { multipass exec lamaste-visitor -- sudo bash -c "$1"; }

# mTLS API helpers — execute curl on the host VM using its local certs
host_api_get() {
  host_exec "curl -skf --max-time 30 --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key --cacert /etc/lamalibre/lamaste/pki/ca.crt -H 'Accept: application/json' https://127.0.0.1:9292/api/$1"
}

begin_test "01 — Onboarding Complete Verification (Three-VM)"

# ---------------------------------------------------------------------------
log_section "Onboarding status"
# ---------------------------------------------------------------------------

STATUS_JSON=$(host_api_get "onboarding/status" || echo '{}')
ONBOARDING_STATUS=$(echo "$STATUS_JSON" | jq -r '.status' 2>/dev/null || echo "unknown")
assert_eq "$ONBOARDING_STATUS" "COMPLETED" "Onboarding status is COMPLETED" || true

DOMAIN_FROM_API=$(echo "$STATUS_JSON" | jq -r '.domain' 2>/dev/null || echo "")
if [ -n "$DOMAIN_FROM_API" ] && [ "$DOMAIN_FROM_API" != "null" ]; then
  log_pass "Domain is set in onboarding status: $DOMAIN_FROM_API"
else
  log_fail "Domain is not set in onboarding status"
fi

# ---------------------------------------------------------------------------
log_section "Core services running"
# ---------------------------------------------------------------------------

SERVICES=(nginx chisel authelia lamalibre-lamaste-serverd)

for svc in "${SERVICES[@]}"; do
  SVC_STATUS=$(host_exec "systemctl is-active $svc 2>/dev/null || echo inactive")
  assert_eq "$SVC_STATUS" "active" "Service $svc is active" || true
done

# ---------------------------------------------------------------------------
log_section "Self-signed certificates exist"
# ---------------------------------------------------------------------------

CERT_PATHS=(
  "/etc/lamalibre/lamaste/pki/ca.crt"
  "/etc/lamalibre/lamaste/pki/ca.key"
  "/etc/lamalibre/lamaste/pki/client.crt"
  "/etc/lamalibre/lamaste/pki/client.key"
  "/etc/lamalibre/lamaste/pki/self-signed.pem"
  "/etc/lamalibre/lamaste/pki/self-signed-key.pem"
)

for cert_path in "${CERT_PATHS[@]}"; do
  EXISTS=$(host_exec "test -f $cert_path && echo yes || echo no")
  assert_eq "$EXISTS" "yes" "Certificate exists: $cert_path" || true
done

# ---------------------------------------------------------------------------
log_section "Panel accessible via domain (mTLS)"
# ---------------------------------------------------------------------------

# curl from the host VM to the panel domain — nginx should serve it
PANEL_STATUS=$(host_exec "curl -sk -o /dev/null -w '%{http_code}' --max-time 15 --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key --cacert /etc/lamalibre/lamaste/pki/ca.crt https://panel.${TEST_DOMAIN}" || echo "000")
if [ "$PANEL_STATUS" = "200" ] || [ "$PANEL_STATUS" = "302" ]; then
  log_pass "Panel accessible via https://panel.${TEST_DOMAIN} (HTTP $PANEL_STATUS)"
else
  log_fail "Panel not accessible via https://panel.${TEST_DOMAIN} (HTTP $PANEL_STATUS)"
fi

# ---------------------------------------------------------------------------
log_section "DNS resolution"
# ---------------------------------------------------------------------------

# Use dig to resolve the domain — should return HOST_IP via dnsmasq on the host
RESOLVED_IP=$(dig +short "${TEST_DOMAIN}" "@${HOST_IP}" 2>/dev/null | head -1 || echo "")
if [ "$RESOLVED_IP" = "$HOST_IP" ]; then
  log_pass "DNS resolves ${TEST_DOMAIN} to ${HOST_IP}"
else
  # Also check from the host VM itself
  RESOLVED_IP_HOST=$(host_exec "dig +short ${TEST_DOMAIN} @127.0.0.1 2>/dev/null | head -1" || echo "")
  if [ "$RESOLVED_IP_HOST" = "$HOST_IP" ]; then
    log_pass "DNS resolves ${TEST_DOMAIN} to ${HOST_IP} (from host VM)"
  else
    log_fail "DNS does not resolve ${TEST_DOMAIN} to ${HOST_IP} (got: '${RESOLVED_IP}' externally, '${RESOLVED_IP_HOST}' from host)"
  fi
fi

# ---------------------------------------------------------------------------
log_section "Agent VM connectivity"
# ---------------------------------------------------------------------------

# Verify agent VM can reach the host VM
AGENT_PING=$(agent_exec "curl -sk -o /dev/null -w '%{http_code}' --max-time 10 https://${HOST_IP}:9292 2>/dev/null" || echo "000")
# Without mTLS cert, the agent should get a TLS error or 4xx — but the TCP connection should succeed
if [ "$AGENT_PING" != "000" ]; then
  log_pass "Agent VM can reach host VM at ${HOST_IP}:9292 (HTTP $AGENT_PING)"
else
  log_fail "Agent VM cannot reach host VM at ${HOST_IP}:9292"
fi

# ---------------------------------------------------------------------------
log_section "Visitor VM connectivity"
# ---------------------------------------------------------------------------

# Verify visitor VM can reach the host VM (no mTLS certs — should get rejected but reachable)
VISITOR_PING=$(visitor_exec "curl -sk -o /dev/null -w '%{http_code}' --max-time 10 https://${HOST_IP}:9292 2>/dev/null" || echo "000")
if [ "$VISITOR_PING" != "000" ]; then
  log_pass "Visitor VM can reach host VM at ${HOST_IP}:9292 (HTTP $VISITOR_PING)"
else
  log_fail "Visitor VM cannot reach host VM at ${HOST_IP}:9292"
fi

# Verify visitor can reach Authelia portal (no mTLS required for auth vhost)
VISITOR_AUTH=$(visitor_exec "curl -sk -o /dev/null -w '%{http_code}' --max-time 10 https://auth.${TEST_DOMAIN}/ 2>/dev/null" || echo "000")
if [ "$VISITOR_AUTH" != "000" ]; then
  log_pass "Visitor VM can reach Authelia at auth.${TEST_DOMAIN} (HTTP $VISITOR_AUTH)"
else
  log_fail "Visitor VM cannot reach Authelia at auth.${TEST_DOMAIN}"
fi

# ---------------------------------------------------------------------------
log_section "Chisel server hardening"
# ---------------------------------------------------------------------------

SERVER_CHISEL_VERSION=$(host_exec "/usr/local/bin/chisel --version 2>/dev/null" 2>/dev/null | sed 's/^v//' || echo "")
assert_eq "$SERVER_CHISEL_VERSION" "1.12.0" "Server chisel (/usr/local/bin/chisel) is the pinned release 1.12.0" || true

AUTHFILE_STAT=$(host_exec "stat -c '%a %U %G' /etc/lamalibre/lamaste/chisel-users 2>/dev/null" || echo "missing")
assert_eq "$AUTHFILE_STAT" "640 lamaste lamaste-chisel" "Chisel authfile is 0640 lamaste:lamaste-chisel" || true

CHISEL_UNIT_USER=$(host_exec "systemctl show -p User --value chisel 2>/dev/null" || echo "")
assert_eq "$CHISEL_UNIT_USER" "nobody" "chisel.service runs as User=nobody" || true
CHISEL_UNIT_GROUP=$(host_exec "systemctl show -p Group --value chisel 2>/dev/null" || echo "")
assert_eq "$CHISEL_UNIT_GROUP" "lamaste-chisel" "chisel.service runs as Group=lamaste-chisel" || true

LAMASTE_GROUPS=$(host_exec "id -nG lamaste 2>/dev/null" || echo "")
assert_contains " ${LAMASTE_GROUPS} " " lamaste-chisel " "The lamaste user is a member of lamaste-chisel" || true
SERVERD_SUPP=$(host_exec "systemctl show -p SupplementaryGroups --value lamalibre-lamaste-serverd 2>/dev/null" || echo "")
assert_contains "$SERVERD_SUPP" "lamaste-chisel" "lamalibre-lamaste-serverd has SupplementaryGroups=lamaste-chisel" || true

FAILED_CLOSED=$(host_exec "test -e /etc/lamalibre/lamaste/chisel-failed-closed && echo yes || echo no")
assert_eq "$FAILED_CLOSED" "no" "No chisel fail-closed marker (startup reconciliation succeeded)" || true
CHISEL_ENABLED=$(host_exec "systemctl is-enabled chisel 2>/dev/null || true")
assert_eq "$CHISEL_ENABLED" "enabled" "chisel.service is enabled" || true

# ---------------------------------------------------------------------------
log_section "Sudoers: certbot and certificate reads via root-owned wrappers"
# ---------------------------------------------------------------------------

SUDOERS_RULES=$(host_exec "grep -v '^[[:space:]]*#' /etc/sudoers.d/lamaste" 2>/dev/null || echo "")
assert_contains "$SUDOERS_RULES" "NOPASSWD: /usr/local/sbin/lamaste-certbot" "sudoers allows the lamaste-certbot wrapper" || true
assert_contains "$SUDOERS_RULES" "NOPASSWD: /usr/local/sbin/lamaste-cert-info" "sudoers allows the lamaste-cert-info wrapper" || true
assert_not_contains "$SUDOERS_RULES" "/usr/bin/certbot" "sudoers has no direct certbot rule" || true
assert_not_contains "$SUDOERS_RULES" "/etc/letsencrypt" "sudoers has no rule reaching into /etc/letsencrypt" || true

for wrapper in lamaste-certbot lamaste-cert-info; do
  WRAPPER_STAT=$(host_exec "stat -c '%U %G %a' /usr/local/sbin/${wrapper} 2>/dev/null" || echo "missing")
  assert_eq "$WRAPPER_STAT" "root root 755" "/usr/local/sbin/${wrapper} is root-owned 0755" || true
done

# The service user cannot reach certbot directly, and the wrappers refuse any
# argument beyond their fixed shapes (a trailing --deploy-hook would run code
# as root)
DIRECT_CERTBOT=$(host_exec "sudo -u lamaste sudo -n /usr/bin/certbot certificates >/dev/null 2>&1 && echo allowed || echo denied")
assert_eq "$DIRECT_CERTBOT" "denied" "lamaste cannot run /usr/bin/certbot through sudo" || true
EXTRA_ARG_RC=$(host_exec "sudo -u lamaste sudo -n /usr/local/sbin/lamaste-certbot renew tunnel.${TEST_DOMAIN} --deploy-hook /bin/true >/dev/null 2>&1; echo \$?")
assert_eq "$EXTRA_ARG_RC" "2" "lamaste-certbot rejects extra arguments (exit 2)" || true
TRAVERSAL_RC=$(host_exec "sudo -u lamaste sudo -n /usr/local/sbin/lamaste-cert-info ../../../etc/shadow enddate >/dev/null 2>&1; echo \$?")
assert_eq "$TRAVERSAL_RC" "2" "lamaste-cert-info rejects a traversing lineage name (exit 2)" || true
TUNNEL_ENDDATE=$(host_exec "sudo -u lamaste sudo -n /usr/local/sbin/lamaste-cert-info tunnel.${TEST_DOMAIN} enddate 2>/dev/null" || echo "")
assert_contains "$TUNNEL_ENDDATE" "notAfter=" "lamaste-cert-info reads the tunnel certificate's expiry" || true

# ---------------------------------------------------------------------------
log_section "Privilege boundary: the panel user cannot become root"
# ---------------------------------------------------------------------------

# Every sudoers rule is a fixed command line or a root-owned program that
# validates its own arguments — no wildcards (a sudoers * matches spaces)
WILDCARD_RULES=$(host_exec "grep -v '^[[:space:]]*#' /etc/sudoers.d/lamaste | grep -c '[*]' || true")
assert_eq "$WILDCARD_RULES" "0" "sudoers has no wildcard rule" || true
assert_contains "$SUDOERS_RULES" "NOPASSWD: /usr/local/sbin/lamaste-priv" "sudoers allows the lamaste-priv helper" || true
PRIV_STAT=$(host_exec "stat -c '%U %G %a' /usr/local/sbin/lamaste-priv 2>/dev/null" || echo "missing")
assert_eq "$PRIV_STAT" "root root 755" "/usr/local/sbin/lamaste-priv is root-owned 0755" || true
RETIRED=$(host_exec "ls /usr/local/sbin/lamaste-sign-csr /usr/local/sbin/lamaste-pki-rename 2>/dev/null | wc -l")
assert_eq "$RETIRED" "0" "Retired wrappers lamaste-sign-csr / lamaste-pki-rename are gone" || true

# Code root runs (and the panel runs) is not writable by the panel
NON_ROOT_CODE=$(host_exec "find /opt/lamalibre/lamaste ! -user root | wc -l")
assert_eq "$NON_ROOT_CODE" "0" "Everything under /opt/lamalibre/lamaste is root-owned" || true
CODE_WRITE=$(host_exec "sudo -u lamaste touch /opt/lamalibre/lamaste/serverd/src/e2e-probe 2>/dev/null && echo allowed || echo denied")
assert_eq "$CODE_WRITE" "denied" "lamaste cannot write into the install directory" || true

# What the panel writes without privileges
WEBROOT_STAT=$(host_exec "stat -c '%U %G %a' /var/www/lamaste")
assert_eq "$WEBROOT_STAT" "lamaste www-data 2750" "/var/www/lamaste is lamaste:www-data 2750" || true
AUTHELIA_DIR_STAT=$(host_exec "stat -c '%U %G %a' /etc/authelia")
assert_eq "$AUTHELIA_DIR_STAT" "lamaste lamaste-authelia 2770" "/etc/authelia is lamaste:lamaste-authelia 2770" || true
AUTHELIA_USER=$(host_exec "systemctl show -p User --value authelia")
assert_eq "$AUTHELIA_USER" "lamaste-authelia" "Authelia runs as lamaste-authelia, not root" || true
AUTHELIA_PROC_USER=$(host_exec "ps -o user= -C authelia | head -1")
assert_eq "$AUTHELIA_PROC_USER" "lamaste-authelia" "The running Authelia process belongs to lamaste-authelia" || true
KEY_STAT=$(host_exec "stat -c '%U %G %a' /etc/lamalibre/lamaste/chisel-server.key")
assert_eq "$KEY_STAT" "lamaste lamaste-chisel 640" "chisel-server.key is lamaste:lamaste-chisel 0640" || true
UNIT_OWNER=$(host_exec "stat -c '%U' /etc/systemd/system/chisel.service /etc/systemd/system/authelia.service | sort -u")
assert_eq "$UNIT_OWNER" "root" "chisel and Authelia units are root-owned" || true

# The helper refuses a vhost that would make nginx (root) open a file
EVIL_VHOST_RC=$(host_exec "printf 'server {\n listen 443 ssl;\n access_log /etc/cron.d/e2e;\n}\n' | sudo -u lamaste sudo -n /usr/local/sbin/lamaste-priv nginx-site write lamalibre-lamaste-app-e2e-evil >/dev/null 2>&1; echo \$?")
assert_eq "$EVIL_VHOST_RC" "2" "lamaste-priv refuses a vhost with access_log (exit 2)" || true
EVIL_VHOST_FILE=$(host_exec "test -e /etc/nginx/sites-available/lamalibre-lamaste-app-e2e-evil && echo yes || echo no")
assert_eq "$EVIL_VHOST_FILE" "no" "The refused vhost was not written" || true
OLD_MV_RULE=$(host_exec "sudo -u lamaste sudo -n /usr/bin/mv /tmp/site-index-x -t /etc/sudoers.d /var/www/lamaste/y >/dev/null 2>&1 && echo allowed || echo denied")
assert_eq "$OLD_MV_RULE" "denied" "The former mv wildcard rule is gone" || true

# ---------------------------------------------------------------------------
log_section "Port 80 redirects every host to HTTPS"
# ---------------------------------------------------------------------------

# From the visitor: plain HTTP for any Host (the catch-all
# lamalibre-lamaste-http-redirect site) answers 301 to the same host and URI
REDIRECT_HEAD=$(visitor_exec "curl -sI --max-time 10 -H 'Host: foo.example' 'http://${HOST_IP}/a?b=1' 2>/dev/null" || echo "")
REDIRECT_CODE=$(echo "$REDIRECT_HEAD" | head -1 | awk '{print $2}')
assert_eq "$REDIRECT_CODE" "301" "http://${HOST_IP}/a?b=1 with Host foo.example answers 301" || true
REDIRECT_LOCATION=$(echo "$REDIRECT_HEAD" | tr -d '\r' | awk 'tolower($1) == "location:" {print $2}')
assert_eq "$REDIRECT_LOCATION" "https://foo.example/a?b=1" "301 Location is https://foo.example/a?b=1" || true

PANEL_REDIRECT=$(visitor_exec "curl -s -o /dev/null -w '%{http_code} %{redirect_url}' --max-time 10 'http://panel.${TEST_DOMAIN}/x' 2>/dev/null" || echo "000")
assert_eq "$PANEL_REDIRECT" "301 https://panel.${TEST_DOMAIN}/x" "http://panel.${TEST_DOMAIN}/x answers 301 to HTTPS" || true

REDIRECT_SITE=$(host_exec "test -L /etc/nginx/sites-enabled/lamalibre-lamaste-http-redirect && echo yes || echo no")
assert_eq "$REDIRECT_SITE" "yes" "nginx site lamalibre-lamaste-http-redirect is enabled" || true

end_test

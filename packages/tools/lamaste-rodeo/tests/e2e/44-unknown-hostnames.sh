#!/usr/bin/env bash
# ============================================================================
# 44 — A hostname no site serves is refused at the TLS handshake (Single-VM)
# ============================================================================
# Since 4.14.1 create-lamaste installs a port-443 catch-all,
# lamalibre-lamaste-https-default (`listen 443 ssl default_server;`,
# `ssl_reject_handshake on;`, `return 444;`). Before it, nginx answered a
# name no server block names — a typo under a wildcard DNS record — with
# its first 443 server: that site's certificate and its sign-in redirect.
#
# 1. The site: enabled, the only default server on 443, nginx -t passes.
# 2. Unknown names fail the handshake: one under the relay's domain, one
#    under no domain of the relay, and no SNI at all — no certificate sent.
# 3. Known names still work: the auth portal (its own certificate, 200),
#    the panel (its handshake; mTLS refuses without a client certificate),
#    a managed static site made for the spec.
# 4. Port 80 is unchanged: any host gets a 301 to the same https:// URL.
# 5. certbot's nginx plugin (python3-certbot-nginx — the VM's
#    /usr/bin/certbot is the E2E shim, so no ACME server is asked) reads
#    the configuration and finds port 80's default server, which it uses
#    for HTTP-01 challenges, and port 443's catch-all.
# 6. Without it the relay says so: the link removed, the panel restarted —
#    GET /api/system/stats reports httpsCatchAll missing, the administrators
#    get a critical notification, the audit log relay.https-catch-all.missing;
#    put back, installed again and relay.https-catch-all.restored.
# ============================================================================

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/helpers.sh"

require_commands curl jq openssl python3

begin_test "44 — A hostname no site serves is refused at the TLS handshake (Single-VM)"

SITE_ID=""
CATCH_ALL_LINK=/etc/nginx/sites-enabled/lamalibre-lamaste-https-default
CATCH_ALL_SITE=/etc/nginx/sites-available/lamalibre-lamaste-https-default
LINK_REMOVED=no
cleanup() {
  if [ -n "$SITE_ID" ] && [ "$SITE_ID" != "null" ]; then
    api_delete "sites/${SITE_ID}" > /dev/null 2>&1 || true
  fi
  if [ "$LINK_REMOVED" = "yes" ]; then
    sudo ln -sf "$CATCH_ALL_SITE" "$CATCH_ALL_LINK" > /dev/null 2>&1 || true
    sudo systemctl reload nginx > /dev/null 2>&1 || true
    sudo systemctl restart lamalibre-lamaste-serverd > /dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

# certificates <servername|-> — how many certificates the relay's TLS
# handshake sends for that SNI (- : none sent), and the subject's CN.
certificates() {
  local sni=()
  [ "$1" != "-" ] && sni=(-servername "$1")
  local out
  out=$(openssl s_client -connect 127.0.0.1:443 "${sni[@]}" < /dev/null 2>&1 || true)
  printf '%s %s\n' \
    "$(printf '%s' "$out" | grep -c 'BEGIN CERTIFICATE' || true)" \
    "$(printf '%s' "$out" | sed -n 's/^subject=.*CN *= *\([^,]*\).*/\1/p' | head -1)"
}

# https_status <host> <path> — the status of https://<host><path> on this
# relay (curl -k; 000 when the handshake failed), retried for up to 10 s
# until it equals <expected> when one is given.
https_status() {
  local host="$1" path="$2" expected="${3:-}" got=""
  for _ in $(seq 1 20); do
    got=$(curl -sk -o /dev/null -w '%{http_code}' --max-time 10 \
      --resolve "${host}:443:127.0.0.1" "https://${host}${path}" 2>/dev/null || true)
    [ -z "$got" ] && got="000"
    [ -z "$expected" ] || [ "$got" = "$expected" ] && break
    sleep 0.5
  done
  echo "$got"
}

# ---------------------------------------------------------------------------
log_section "Pre-flight: onboarding complete"
# ---------------------------------------------------------------------------

DOMAIN=$(api_get "onboarding/status" | jq -r '.domain // empty' 2>/dev/null || echo "")
if [ -z "$DOMAIN" ]; then
  log_skip "Onboarding is not complete — no domain to test under"
  end_test
  exit $?
fi
log_info "The relay's domain: ${DOMAIN}"

# ---------------------------------------------------------------------------
log_section "The catch-all site"
# ---------------------------------------------------------------------------

CATCH_ALL=/etc/nginx/sites-enabled/lamalibre-lamaste-https-default
assert_eq "$(sudo test -L "$CATCH_ALL" && echo yes || echo no)" "yes" "lamalibre-lamaste-https-default is enabled" || true
CONTENT=$(sudo cat "$CATCH_ALL" 2>/dev/null || echo "")
assert_contains "$CONTENT" "listen 443 ssl default_server;" "…the default server on 443, as the relay's vhosts listen" || true
assert_contains "$CONTENT" "ssl_reject_handshake on;" "…refusing the handshake, holding no certificate" || true
assert_contains "$CONTENT" "ssl_protocols TLSv1.2 TLSv1.3;" "…with the relay's TLS protocols (the socket's default sets every name's floor)" || true
TLS12=$(openssl s_client -connect 127.0.0.1:443 -servername "auth.${DOMAIN}" -tls1_2 < /dev/null 2>&1 | grep -c 'BEGIN CERTIFICATE' || true)
assert_eq "$TLS12" "1" "TLS 1.2 to auth.${DOMAIN} still completes" || true
DEFAULTS=$( { sudo grep -RhE '^\s*listen\s+[^;]*443[^;]*default_server' /etc/nginx/sites-enabled/ /etc/nginx/conf.d/ 2>/dev/null || true; } | wc -l | tr -d ' ')
assert_eq "$DEFAULTS" "1" "No other site claims port 443's default server" || true
NGINX_T=$(sudo nginx -t 2>&1 && echo OK || echo FAILED)
assert_contains "$NGINX_T" "OK" "nginx -t passes" || true

# ---------------------------------------------------------------------------
log_section "Unknown names fail the handshake"
# ---------------------------------------------------------------------------

UNKNOWN="unknown-${RANDOM}${RANDOM}.${DOMAIN}"
read -r COUNT CN <<< "$(certificates "$UNKNOWN")"
assert_eq "${COUNT}" "0" "${UNKNOWN}: no certificate sent (${CN:-none})" || true
assert_eq "$(https_status "$UNKNOWN" /)" "000" "${UNKNOWN}: https fails the handshake" || true
CURL_RC=0
curl -s -o /dev/null --max-time 10 --resolve "${UNKNOWN}:443:127.0.0.1" "https://${UNKNOWN}/" 2>/dev/null || CURL_RC=$?
assert_eq "$CURL_RC" "35" "${UNKNOWN}: curl reports a TLS handshake failure (exit 35)" || true

read -r COUNT CN <<< "$(certificates "vinyard-${RANDOM}.example.net")"
assert_eq "${COUNT}" "0" "A name under no domain of the relay: no certificate" || true
read -r COUNT CN <<< "$(certificates -)"
assert_eq "${COUNT}" "0" "No SNI: no certificate" || true

# ---------------------------------------------------------------------------
log_section "Known names still work"
# ---------------------------------------------------------------------------

AUTH="auth.${DOMAIN}"
read -r COUNT CN <<< "$(certificates "$AUTH")"
assert_not_eq "${COUNT}" "0" "${AUTH}: a certificate is sent (CN ${CN:-?})" || true
assert_eq "$(https_status "$AUTH" /api/health 200)" "200" "${AUTH}/api/health answers 200" || true

PANEL="panel.${DOMAIN}"
read -r COUNT CN <<< "$(certificates "$PANEL")"
assert_not_eq "${COUNT}" "0" "${PANEL}: a certificate is sent (CN ${CN:-?})" || true
PANEL_STATUS=$(https_status "$PANEL" /api/health)
assert_not_eq "$PANEL_STATUS" "000" "${PANEL}: the handshake completes (${PANEL_STATUS} without a client certificate)" || true

SITE_NAME="e2edefault$(date +%s)"
CREATE=$(api_post "sites" "{\"name\":\"${SITE_NAME}\",\"type\":\"managed\",\"spaMode\":false,\"autheliaProtected\":false}")
SITE_ID=$(echo "$CREATE" | jq -r '.site.id // empty' 2>/dev/null || echo "")
SITE_FQDN=$(echo "$CREATE" | jq -r '.site.fqdn // empty' 2>/dev/null || echo "")
assert_not_eq "$SITE_FQDN" "" "A managed static site is created (${SITE_FQDN})" || true
if [ -n "$SITE_FQDN" ]; then
  SITE_STATUS=$(https_status "$SITE_FQDN" / 200)
  assert_eq "$SITE_STATUS" "200" "${SITE_FQDN}: served over HTTPS" || true
  read -r COUNT CN <<< "$(certificates "$SITE_FQDN")"
  assert_not_eq "${COUNT}" "0" "${SITE_FQDN}: its certificate is sent" || true
  api_delete "sites/${SITE_ID}" > /dev/null 2>&1 || true
  SITE_ID=""
  assert_eq "$(https_status "$SITE_FQDN" / 000)" "000" "Deleted, ${SITE_FQDN} fails the handshake like any unknown name" || true
fi

# ---------------------------------------------------------------------------
log_section "Port 80 is unchanged"
# ---------------------------------------------------------------------------

REDIRECT=$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' --max-time 10 -H "Host: ${UNKNOWN}" 'http://127.0.0.1/a?b=1' 2>/dev/null || echo "000")
assert_eq "$REDIRECT" "301 https://${UNKNOWN}/a?b=1" "Plain HTTP for any name: 301 to the same https:// URL" || true

# ---------------------------------------------------------------------------
log_section "certbot's nginx plugin reads the configuration"
# ---------------------------------------------------------------------------

CERTBOT_VIEW=$(sudo python3 - <<'PY' 2>&1 || true
try:
    from certbot_nginx._internal import parser
except Exception as err:  # noqa: BLE001
    print(f"unavailable {type(err).__name__}")
    raise SystemExit(0)
p = parser.NginxParser("/etc/nginx/")
vhosts = p.get_vhosts()
def defaults(port):
    return sum(1 for v in vhosts for a in v.addrs if a.get_port() == port and a.default)
print(f"vhosts={len(vhosts)} default80={defaults('80')} default443={defaults('443')}")
PY
)
log_info "certbot's parser: ${CERTBOT_VIEW}"
if [[ "$CERTBOT_VIEW" == unavailable* ]]; then
  log_skip "python3-certbot-nginx is not importable here (${CERTBOT_VIEW})"
else
  assert_contains "$CERTBOT_VIEW" "default80=1" "certbot finds port 80's default server (the one it clones for HTTP-01)" || true
  assert_contains "$CERTBOT_VIEW" "default443=1" "…and parses port 443's catch-all" || true
fi

# ---------------------------------------------------------------------------
log_section "Without the catch-all, the relay says so"
# ---------------------------------------------------------------------------

# catch_all_status — httpsCatchAll.status on GET /api/system/stats, once the
# panel restarted and checked (it checks at start)
catch_all_status() {
  local status=""
  for _ in $(seq 1 40); do
    status=$(api_get "system/stats" | jq -r '.httpsCatchAll.status // empty' 2>/dev/null || echo "")
    [ -n "$status" ] && break
    sleep 0.5
  done
  echo "$status"
}
restart_panel() {
  sudo systemctl restart lamalibre-lamaste-serverd
  wait_for_http "${PANEL_DIRECT_URL}/api/health" 60 || log_fail "The panel does not answer after a restart"
}

assert_eq "$(catch_all_status)" "installed" "GET /api/system/stats: httpsCatchAll installed" || true
NOTIFICATION_BASE=$(api_get "notifications?limit=1" | jq '.notifications[0].id // 0' 2>/dev/null || echo "0")

sudo rm -f "$CATCH_ALL_LINK"
LINK_REMOVED=yes
sudo systemctl reload nginx
restart_panel
assert_eq "$(catch_all_status)" "missing" "The link removed: httpsCatchAll missing" || true
RAISED=$(api_get "notifications?unread=true&limit=50" | jq -c "[.notifications[] | select(.id > ${NOTIFICATION_BASE} and (.message | contains(\"lamalibre-lamaste-https-default\")))]" 2>/dev/null || echo "[]")
assert_eq "$(echo "$RAISED" | jq 'length')" "1" "The administrators are told, once" || true
assert_eq "$(echo "$RAISED" | jq -r '.[0].level')" "critical" "…as critical" || true
assert_contains "$(echo "$RAISED" | jq -r '.[0].message')" "default_server" "…naming how to find the site that owns the default" || true
assert_eq "$(api_get "audit?limit=20" | jq -r '[.entries[]? | select(.action == "relay.https-catch-all.missing")][0].details.status // empty' 2>/dev/null)" "missing" "Audited: relay.https-catch-all.missing" || true

sudo ln -sf "$CATCH_ALL_SITE" "$CATCH_ALL_LINK"
LINK_REMOVED=no
sudo systemctl reload nginx
restart_panel
assert_eq "$(catch_all_status)" "installed" "Put back: installed again" || true
assert_eq "$(api_get "audit?limit=20" | jq -r '[.entries[]? | select(.action | startswith("relay.https-catch-all."))][0].action // empty' 2>/dev/null)" "relay.https-catch-all.restored" "Audited: relay.https-catch-all.restored (after the restart)" || true
assert_eq "$(certificates "unknown-${RANDOM}.${DOMAIN}" | awk '{print $1}')" "0" "…and unknown names refused again" || true

end_test

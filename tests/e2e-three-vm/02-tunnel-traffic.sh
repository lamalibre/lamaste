#!/usr/bin/env bash
# ============================================================================
# 02 — Tunnel Traffic (Three-VM)
# ============================================================================
# The crown jewel — tests actual traffic flowing through a tunnel:
#
# 1. Create a tunnel via API on the host VM, owned by the enrolled agent
#    (test-agent) whose VM runs the Chisel client; verify the owner's chisel
#    config and the host's chisel authfile grant for the tunnel's port
# 2. Add /etc/hosts entry on the agent VM for the tunnel subdomain
# 3. Start a simple HTTP server on the agent VM
# 4. Start the Chisel client on the agent VM to establish the tunnel
# 5. Authenticate with Authelia to get a session cookie
# 6. Curl the tunnel URL from the host VM with the auth cookie
# 7. Verify the response contains the expected content
# 8. Verify the agent's chisel client verifies TLS and keeps its credential
#    out of argv: the systemd unit uses EnvironmentFile= (0600 chisel.env),
#    and neither the unit nor the running process carries --auth, the
#    password or --tls-skip-verify — traffic flowing proves both work
# 9. Verify the tunnel vhost enforces the request body limit (413 above it)
# 10. Verify both chisel binaries are the pinned release (1.12.0) and the
#     client argv is `client --max-retry-interval 30s https://tunnel.<domain>:443 R:...`
# 11. Public tunnel to a header-echo app, created with no `lamaste-agent
#     update` (the sync timer picks it up): from the visitor, spoofed
#     X-SSL-Client-* and Remote-* headers never reach the app, and the app
#     sees Host = the tunnel FQDN and X-Forwarded-Proto = https
# 12. Clean up: stop the HTTP servers, remove the tunnels
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../e2e/helpers.sh"

require_commands multipass curl jq

# ---------------------------------------------------------------------------
# VM exec helpers
# ---------------------------------------------------------------------------

host_exec() { multipass exec lamaste-host -- sudo bash -c "$1"; }
agent_exec() { multipass exec lamaste-agent -- sudo bash -c "$1"; }

visitor_exec() { multipass exec lamaste-visitor -- sudo bash -c "$1"; }

host_api_get() {
  host_exec "curl -skf --max-time 30 --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key --cacert /etc/lamalibre/lamaste/pki/ca.crt -H 'Accept: application/json' https://127.0.0.1:9292/api/$1"
}

host_api_post() {
  host_exec "curl -skf --max-time 30 --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key --cacert /etc/lamalibre/lamaste/pki/ca.crt -X POST -H 'Content-Type: application/json' -H 'Accept: application/json' -d '$2' https://127.0.0.1:9292/api/$1"
}

host_api_delete() {
  host_exec "curl -skf --max-time 30 --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key --cacert /etc/lamalibre/lamaste/pki/ca.crt -X DELETE -H 'Accept: application/json' https://127.0.0.1:9292/api/$1"
}

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

TUNNEL_SUBDOMAIN="e2etraffic"
TUNNEL_PORT=18080
# The agent enrolled by setup-host.sh. Its VM runs the Chisel client, so it
# must own every tunnel whose traffic this test drives.
TUNNEL_AGENT="test-agent"
# The agent VM's local label (setup-agent.sh) names its unit and data dir
AGENT_LOCAL_LABEL="e2e-agent"
CHISEL_UNIT_PATH="/root/.config/systemd/user/lamalibre-lamaste-chisel-${AGENT_LOCAL_LABEL}.service"
CHISEL_ENV_PATH="/root/.lamalibre/lamaste/agents/${AGENT_LOCAL_LABEL}/chisel.env"
# The anchored reverse remote the host's chisel authfile must grant the owner
GRANT_PATTERN="^R:127\\.0\\.0\\.1:${TUNNEL_PORT}\$"
TUNNEL_FQDN="${TUNNEL_SUBDOMAIN}.${TEST_DOMAIN}"
TUNNEL_ID=""
MARKER="LAMALIBRE_LAMASTE_TUNNEL_OK_$(date +%s)"
AGENT_CHISEL_BIN="/root/.lamalibre/lamaste/bin/chisel"
# Public tunnel whose app echoes the request headers it receives as JSON
HEADERS_SUBDOMAIN="e2eheaders"
HEADERS_PORT=18090
HEADERS_FQDN="${HEADERS_SUBDOMAIN}.${TEST_DOMAIN}"
HEADERS_TUNNEL_ID=""

begin_test "02 — Tunnel Traffic (Three-VM)"

# ---------------------------------------------------------------------------
# Cleanup function — always runs on exit
# ---------------------------------------------------------------------------

cleanup() {
  log_info "Cleaning up test resources..."

  # Stop HTTP server on agent
  agent_exec "pkill -f 'python3 -m http.server ${TUNNEL_PORT}' 2>/dev/null || true" 2>/dev/null || true

  # Remove /etc/hosts entry on agent
  agent_exec "sed -i '/${TUNNEL_FQDN}/d' /etc/hosts 2>/dev/null || true" 2>/dev/null || true

  # Remove test HTML file on agent
  agent_exec "rm -f /tmp/e2e-tunnel-index.html 2>/dev/null || true" 2>/dev/null || true

  # Stop the header-echo app on agent
  agent_exec "pkill -f 'e2e-echo-headers.py' 2>/dev/null || true; rm -f /tmp/e2e-echo-headers.py" 2>/dev/null || true

  # Remove request body files on host
  host_exec "rm -f /tmp/e2e-body-small.bin /tmp/e2e-body-large.bin 2>/dev/null || true" 2>/dev/null || true

  if [ -n "$HEADERS_TUNNEL_ID" ] && [ "$HEADERS_TUNNEL_ID" != "null" ]; then
    host_api_delete "tunnels/${HEADERS_TUNNEL_ID}" 2>/dev/null || true
  fi

  # Delete tunnel via API (if we have an ID), then refresh agent
  if [ -n "$TUNNEL_ID" ] && [ "$TUNNEL_ID" != "null" ]; then
    host_api_delete "tunnels/${TUNNEL_ID}" 2>/dev/null || true
  fi
  agent_exec "lamaste-agent update 2>/dev/null || true" 2>/dev/null || true
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
log_section "Pre-flight: verify onboarding is complete"
# ---------------------------------------------------------------------------

ONBOARDING_STATUS=$(host_api_get "onboarding/status" | jq -r '.status' 2>/dev/null || echo "unknown")
if [ "$ONBOARDING_STATUS" != "COMPLETED" ]; then
  log_skip "Onboarding not completed (status: $ONBOARDING_STATUS). Skipping tunnel traffic tests."
  end_test
  exit $?
fi

# ---------------------------------------------------------------------------
log_section "Create tunnel via API"
# ---------------------------------------------------------------------------

# accessMode: "authenticated" — this test exercises the 1FA+2FA happy path,
# where any signed-in Authelia user can reach the tunnel. The server-side
# default ("restricted") intentionally requires per-user grants that nobody
# creates here, so we opt in explicitly rather than weakening the default.
CREATE_RESPONSE=$(host_api_post "tunnels" "{\"subdomain\":\"${TUNNEL_SUBDOMAIN}\",\"port\":${TUNNEL_PORT},\"accessMode\":\"authenticated\",\"agentLabel\":\"${TUNNEL_AGENT}\"}")
assert_json_field "$CREATE_RESPONSE" '.ok' 'true' "Tunnel creation returned ok: true" || true

TUNNEL_ID=$(echo "$CREATE_RESPONSE" | jq -r '.tunnel.id' 2>/dev/null || echo "")
assert_json_field_not_empty "$CREATE_RESPONSE" '.tunnel.id' "Tunnel has an ID" || true
assert_json_field "$CREATE_RESPONSE" '.tunnel.agentLabel' "$TUNNEL_AGENT" "Tunnel is owned by ${TUNNEL_AGENT}" || true
log_info "Created tunnel ID: $TUNNEL_ID (${TUNNEL_FQDN})"

# ---------------------------------------------------------------------------
log_section "Verify the owner's chisel config and grant"
# ---------------------------------------------------------------------------

# The owner's config is what 'lamaste-agent update' renders into its client
OWNER_CONFIG=$(host_api_get "tunnels/agent-config?agent=${TUNNEL_AGENT}" 2>/dev/null || echo '{}')
OWNER_CONFIG_PORT=$(echo "$OWNER_CONFIG" | jq -r --arg sd "$TUNNEL_SUBDOMAIN" '.tunnels[]? | select(.subdomain == $sd) | .port' 2>/dev/null || echo "")
assert_eq "$OWNER_CONFIG_PORT" "$TUNNEL_PORT" "agent-config?agent=${TUNNEL_AGENT} lists the tunnel" || true

# Only the user half of each "<user>:<password>" key is matched and only the
# grants are kept, so no chisel password reaches the test output
OWNER_GRANTS=$(host_exec "cat /etc/lamalibre/lamaste/chisel-users" 2>/dev/null \
  | jq -r --arg u "agent-${TUNNEL_AGENT}:" 'to_entries[] | select(.key | startswith($u)) | .value[]' 2>/dev/null || echo "")
assert_contains "$OWNER_GRANTS" "$GRANT_PATTERN" "Host chisel authfile grants ${TUNNEL_AGENT} ${GRANT_PATTERN}" || true

# ---------------------------------------------------------------------------
log_section "Configure agent VM for tunnel"
# ---------------------------------------------------------------------------

# Add /etc/hosts entry on agent so chisel client can resolve tunnel.TEST_DOMAIN
agent_exec "grep -q 'tunnel.${TEST_DOMAIN}' /etc/hosts || echo '${HOST_IP} tunnel.${TEST_DOMAIN}' >> /etc/hosts"
log_pass "Added tunnel.${TEST_DOMAIN} to agent /etc/hosts"

# Also add the tunnel subdomain FQDN (needed if traffic verification goes through the agent)
agent_exec "grep -q '${TUNNEL_FQDN}' /etc/hosts || echo '${HOST_IP} ${TUNNEL_FQDN}' >> /etc/hosts"
log_pass "Added ${TUNNEL_FQDN} to agent /etc/hosts"

# ---------------------------------------------------------------------------
log_section "Start HTTP server on agent VM"
# ---------------------------------------------------------------------------

# Write a test HTML file
agent_exec "echo '${MARKER}' > /tmp/e2e-tunnel-index.html"

# Start a simple HTTP server in the background on the tunnel port
agent_exec "nohup python3 -m http.server ${TUNNEL_PORT} --bind 127.0.0.1 -d /tmp &>/dev/null & exit"

# Wait for the HTTP server to be ready
sleep 2
AGENT_HTTP_STATUS=$(agent_exec "curl -sf -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:${TUNNEL_PORT}/e2e-tunnel-index.html 2>/dev/null" || echo "000")
assert_eq "$AGENT_HTTP_STATUS" "200" "HTTP server running on agent at port ${TUNNEL_PORT}" || true

# ---------------------------------------------------------------------------
log_section "Refresh agent config to pick up new tunnel"
# ---------------------------------------------------------------------------

# The lamaste-agent manages the Chisel client as a systemd service.
# Running 'update' fetches the latest tunnel config and restarts the service.
agent_exec "lamaste-agent update"

# Wait for the tunnel to establish
log_info "Waiting for Chisel tunnel to establish..."
CHISEL_READY=false
for i in $(seq 1 15); do
  HOST_TUNNEL_CHECK=$(host_exec "curl -sf -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:${TUNNEL_PORT}/e2e-tunnel-index.html 2>/dev/null" || echo "000")
  if [ "$HOST_TUNNEL_CHECK" = "200" ]; then
    CHISEL_READY=true
    break
  fi
  sleep 1
done

if [ "$CHISEL_READY" = "true" ]; then
  log_pass "Chisel tunnel established (port ${TUNNEL_PORT} accessible on host)"
else
  log_fail "Chisel tunnel failed to establish within 15 seconds"
  AGENT_LOG=$(agent_exec "tail -20 ~/.lamalibre/lamaste/agents/e2e-agent/logs/chisel.log 2>/dev/null || echo 'no log'")
  log_info "Chisel agent log: $AGENT_LOG"
fi

# ---------------------------------------------------------------------------
log_section "Verify traffic through tunnel (direct, bypassing Authelia)"
# ---------------------------------------------------------------------------

# Verify the content is correct by fetching through the chisel tunnel from the host
DIRECT_CONTENT=$(host_exec "curl -sf --max-time 10 http://127.0.0.1:${TUNNEL_PORT}/e2e-tunnel-index.html 2>/dev/null" || echo "")
assert_contains "$DIRECT_CONTENT" "$MARKER" "Direct tunnel traffic returns expected content" || true

# ---------------------------------------------------------------------------
log_section "Verify the agent's chisel client: verified TLS, credential off argv"
# ---------------------------------------------------------------------------

# The traffic above crossed a chisel session that verified tunnel.<domain>
# against the agent's system trust store and authenticated from the
# environment file. The checks below pin down how.
CHISEL_UNIT=$(agent_exec "cat '${CHISEL_UNIT_PATH}' 2>/dev/null" || echo "")
assert_contains "$CHISEL_UNIT" "EnvironmentFile=${CHISEL_ENV_PATH}" "Chisel unit reads its credential from EnvironmentFile=" || true
assert_contains "$CHISEL_UNIT" "https://tunnel.${TEST_DOMAIN}:443" "Chisel unit connects to https://tunnel.${TEST_DOMAIN}:443" || true
assert_not_contains "$CHISEL_UNIT" "--auth" "Chisel unit carries no --auth argument" || true
assert_not_contains "$CHISEL_UNIT" "tls-skip-verify" "Chisel unit does not skip TLS verification" || true

CHISEL_ENV_MODE=$(agent_exec "stat -c '%a' '${CHISEL_ENV_PATH}' 2>/dev/null" || echo "missing")
assert_eq "$CHISEL_ENV_MODE" "600" "chisel.env is mode 600" || true

# Count the well-formed AUTH line without printing the password
CHISEL_ENV_AUTH=$(agent_exec "grep -c '^AUTH=agent-${TUNNEL_AGENT}:[0-9a-f]\\{32,\\}\$' '${CHISEL_ENV_PATH}' 2>/dev/null" || echo "0")
assert_eq "$CHISEL_ENV_AUTH" "1" "chisel.env holds AUTH=agent-${TUNNEL_AGENT}:<password>" || true

# Inspect the running chisel client's argv on the agent itself, so the
# password is compared there and never reaches this test's output. Prints
# "running" alone when the process exists and its argv is clean.
CHISEL_PROC_CHECK=$(agent_exec "pw=\$(sed -n 's/^AUTH=[^:]*://p' '${CHISEL_ENV_PATH}'); args=\$(ps -eo args | grep '[c]hisel client' || true); if [ -z \"\$args\" ]; then echo no-process; exit 0; fi; out=running; case \"\$args\" in *\"\$pw\"*) out=\"\$out password-in-argv\";; esac; case \"\$args\" in *--auth*) out=\"\$out auth-flag\";; esac; case \"\$args\" in *tls-skip-verify*) out=\"\$out skip-verify\";; esac; echo \"\$out\"" 2>/dev/null || echo "error")
assert_eq "$CHISEL_PROC_CHECK" "running" "Running chisel client argv has no password, --auth or --tls-skip-verify" || true

# ---------------------------------------------------------------------------
log_section "Pinned chisel release on both ends; client argv shape"
# ---------------------------------------------------------------------------

# Both binaries are the pinned, SHA-256-verified release
AGENT_CHISEL_VERSION=$(agent_exec "'${AGENT_CHISEL_BIN}' --version 2>/dev/null" 2>/dev/null | sed 's/^v//' || echo "")
assert_eq "$AGENT_CHISEL_VERSION" "1.12.0" "Agent chisel (${AGENT_CHISEL_BIN}) reports version 1.12.0" || true
SERVER_CHISEL_VERSION=$(host_exec "/usr/local/bin/chisel --version 2>/dev/null" 2>/dev/null | sed 's/^v//' || echo "")
assert_eq "$SERVER_CHISEL_VERSION" "1.12.0" "Server chisel (/usr/local/bin/chisel) reports version 1.12.0" || true

# The client reconnects with a bounded backoff and names only the enrolled relay
CHISEL_ARGV=$(agent_exec "ps -eo args | grep '[c]hisel client' | head -1" 2>/dev/null || echo "")
assert_contains "$CHISEL_ARGV" "client --max-retry-interval 30s https://tunnel.${TEST_DOMAIN}:443 R:127.0.0.1:" "Chisel client argv is 'client --max-retry-interval 30s https://tunnel.${TEST_DOMAIN}:443 R:...'" || true
assert_contains "$CHISEL_ARGV" "R:127.0.0.1:${TUNNEL_PORT}:127.0.0.1:${TUNNEL_PORT}" "Chisel client argv carries the tunnel's reverse remote" || true

# ---------------------------------------------------------------------------
log_section "Reset TOTP before authentication"
# ---------------------------------------------------------------------------

# Ensure oathtool is available on the host VM
OATHTOOL_CHECK=$(host_exec "command -v oathtool >/dev/null 2>&1 && echo yes || echo no")
if [ "$OATHTOOL_CHECK" != "yes" ]; then
  log_skip "oathtool not available on host VM. Skipping TOTP-dependent tests."
  end_test
  exit $?
fi

# IMPORTANT: TOTP must be reset BEFORE firstfactor auth, not after.
# If reset after firstfactor, Authelia rejects the secondfactor because
# the TOTP configuration changed mid-session.
TOTP_RESPONSE=$(host_api_post "users/${TEST_USER}/reset-totp" "{}")
assert_json_field_not_empty "$TOTP_RESPONSE" '.totpUri' "TOTP reset returned otpauth URI" || true

# Extract the TOTP secret from the otpauth URI (the secret= parameter)
OTPAUTH_URI=$(echo "$TOTP_RESPONSE" | jq -r '.totpUri' 2>/dev/null || echo "")
TOTP_SECRET=$(echo "$OTPAUTH_URI" | sed -n 's/.*secret=\([A-Z2-7]*\).*/\1/p')

if [ -z "$TOTP_SECRET" ]; then
  log_fail "Failed to extract TOTP secret from otpauth URI: $OTPAUTH_URI"
  end_test
  exit $?
fi
log_pass "Extracted TOTP secret from otpauth URI"

# Allow Authelia to pick up the new TOTP configuration
sleep 2

# ---------------------------------------------------------------------------
log_section "Authenticate with Authelia (first factor)"
# ---------------------------------------------------------------------------

AUTH_RESPONSE=$(host_exec "curl -sk --max-time 15 -c /tmp/authelia-cookies.txt -X POST -H 'Content-Type: application/json' -d '{\"username\":\"${TEST_USER}\",\"password\":\"${TEST_USER_PASSWORD}\",\"keepMeLoggedIn\":false,\"targetURL\":\"https://${TUNNEL_FQDN}/\"}' https://auth.${TEST_DOMAIN}/api/firstfactor 2>/dev/null" || echo '{}')

AUTH_STATUS=$(echo "$AUTH_RESPONSE" | jq -r '.status' 2>/dev/null || echo "unknown")
if [ "$AUTH_STATUS" = "OK" ]; then
  log_pass "Authelia first factor authentication succeeded"
else
  log_fail "Authelia first factor authentication failed (status: $AUTH_STATUS, response: $AUTH_RESPONSE)"
fi

# ---------------------------------------------------------------------------
log_section "Second factor authentication (TOTP)"
# ---------------------------------------------------------------------------

# Generate a TOTP code on host VM
TOTP_CODE=$(host_exec "oathtool --totp --base32 ${TOTP_SECRET}" 2>/dev/null || echo "")
if [ -z "$TOTP_CODE" ] || [ ${#TOTP_CODE} -ne 6 ]; then
  log_fail "oathtool failed to generate a valid 6-digit TOTP code (got: '${TOTP_CODE}')"
  end_test
  exit $?
fi
log_info "Generated TOTP code: ${TOTP_CODE}"

# POST second factor to Authelia
TOTP_AUTH_RESPONSE=$(host_exec "curl -sk --max-time 15 -b /tmp/authelia-cookies.txt -c /tmp/authelia-cookies.txt -X POST -H 'Content-Type: application/json' -d '{\"token\":\"${TOTP_CODE}\",\"targetURL\":\"https://${TUNNEL_FQDN}/\"}' https://auth.${TEST_DOMAIN}/api/secondfactor/totp 2>/dev/null" || echo '{}')

TOTP_AUTH_STATUS=$(echo "$TOTP_AUTH_RESPONSE" | jq -r '.status' 2>/dev/null || echo "unknown")
if [ "$TOTP_AUTH_STATUS" = "OK" ]; then
  log_pass "Second factor authentication succeeded (TOTP accepted)"
else
  log_fail "Second factor authentication failed (status: $TOTP_AUTH_STATUS, response: $TOTP_AUTH_RESPONSE)"
fi

# ---------------------------------------------------------------------------
log_section "Verify traffic through nginx with Authelia (full path)"
# ---------------------------------------------------------------------------

# Fetch the tunnel URL through nginx with Authelia session cookie
FULL_PATH_CONTENT=$(host_exec "curl -sk --max-time 15 -b /tmp/authelia-cookies.txt https://${TUNNEL_FQDN}/e2e-tunnel-index.html 2>/dev/null" || echo "")
assert_contains "$FULL_PATH_CONTENT" "$MARKER" "Full-path tunnel traffic (nginx + Authelia) returns expected content" || true

# ---------------------------------------------------------------------------
log_section "Verify the request body limit at the tunnel vhost"
# ---------------------------------------------------------------------------

# A new tunnel allows 10 MB request bodies (client_max_body_size 10m). nginx
# rejects a larger body with 413 before proxying. A 2 MB body — over nginx's
# built-in 1 MB default, under the tunnel's limit — is proxied to the agent
# (python's http.server answers POST with 501).
host_exec "head -c 2097152 /dev/zero > /tmp/e2e-body-small.bin && head -c 11534336 /dev/zero > /tmp/e2e-body-large.bin"

SMALL_POST_STATUS=$(host_exec "curl -sk -o /dev/null -w '%{http_code}' --max-time 30 -b /tmp/authelia-cookies.txt -X POST -H 'Content-Type: application/octet-stream' --data-binary @/tmp/e2e-body-small.bin https://${TUNNEL_FQDN}/e2e-tunnel-index.html 2>/dev/null" || echo "000")
assert_not_eq "$SMALL_POST_STATUS" "413" "2 MB POST through the tunnel passes the body limit (above nginx's 1 MB default; HTTP ${SMALL_POST_STATUS})" || true

LARGE_POST_STATUS=$(host_exec "curl -sk -o /dev/null -w '%{http_code}' --max-time 30 -b /tmp/authelia-cookies.txt -X POST -H 'Content-Type: application/octet-stream' --data-binary @/tmp/e2e-body-large.bin https://${TUNNEL_FQDN}/e2e-tunnel-index.html 2>/dev/null" || echo "000")
assert_eq "$LARGE_POST_STATUS" "413" "11 MB POST through the tunnel rejected with 413 (limit 10 MB)" || true

host_exec "rm -f /tmp/e2e-body-small.bin /tmp/e2e-body-large.bin 2>/dev/null || true" 2>/dev/null || true

# Clean up the cookie jar
host_exec "rm -f /tmp/authelia-cookies.txt 2>/dev/null || true" 2>/dev/null || true

# ---------------------------------------------------------------------------
log_section "Public tunnel: spoofed identity headers never reach the app"
# ---------------------------------------------------------------------------

# A tiny app that answers every GET with the request headers it received, as
# JSON with lower-cased names (python3 http.server; base64 keeps the quoting
# simple)
ECHO_APP_B64="aW1wb3J0IGh0dHAuc2VydmVyCmltcG9ydCBqc29uCmltcG9ydCBzeXMKCgpjbGFzcyBFY2hvKGh0dHAuc2VydmVyLkJhc2VIVFRQUmVxdWVzdEhhbmRsZXIpOgogICAgZGVmIGRvX0dFVChzZWxmKToKICAgICAgICBib2R5ID0ganNvbi5kdW1wcyh7ay5sb3dlcigpOiB2IGZvciBrLCB2IGluIHNlbGYuaGVhZGVycy5pdGVtcygpfSkuZW5jb2RlKCkKICAgICAgICBzZWxmLnNlbmRfcmVzcG9uc2UoMjAwKQogICAgICAgIHNlbGYuc2VuZF9oZWFkZXIoIkNvbnRlbnQtVHlwZSIsICJhcHBsaWNhdGlvbi9qc29uIikKICAgICAgICBzZWxmLnNlbmRfaGVhZGVyKCJDb250ZW50LUxlbmd0aCIsIHN0cihsZW4oYm9keSkpKQogICAgICAgIHNlbGYuZW5kX2hlYWRlcnMoKQogICAgICAgIHNlbGYud2ZpbGUud3JpdGUoYm9keSkKCiAgICBkZWYgbG9nX21lc3NhZ2Uoc2VsZiwgKmFyZ3MpOgogICAgICAgIHBhc3MKCgpodHRwLnNlcnZlci5UaHJlYWRpbmdIVFRQU2VydmVyKCgiMTI3LjAuMC4xIiwgaW50KHN5cy5hcmd2WzFdKSksIEVjaG8pLnNlcnZlX2ZvcmV2ZXIoKQo="
agent_exec "echo '${ECHO_APP_B64}' | base64 -d > /tmp/e2e-echo-headers.py"
agent_exec "nohup python3 /tmp/e2e-echo-headers.py ${HEADERS_PORT} &>/dev/null & exit"
sleep 2
ECHO_LOCAL=$(agent_exec "curl -sf --max-time 5 -H 'Host: probe.local' http://127.0.0.1:${HEADERS_PORT}/ 2>/dev/null" || echo "{}")
assert_json_field "$ECHO_LOCAL" '.host' "probe.local" "Header-echo app running on agent at port ${HEADERS_PORT}" || true

HEADERS_CREATE=$(host_api_post "tunnels" "{\"subdomain\":\"${HEADERS_SUBDOMAIN}\",\"port\":${HEADERS_PORT},\"accessMode\":\"public\",\"agentLabel\":\"${TUNNEL_AGENT}\"}")
assert_json_field "$HEADERS_CREATE" '.ok' 'true' "Public tunnel ${HEADERS_FQDN} created" || true
HEADERS_TUNNEL_ID=$(echo "$HEADERS_CREATE" | jq -r '.tunnel.id' 2>/dev/null || echo "")

# No `lamaste-agent update`: the agent's sync timer adds the new remote
HEADERS_READY=false
for _ in $(seq 1 30); do
  if [ "$(host_exec "curl -sf -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:${HEADERS_PORT}/ 2>/dev/null" || echo "000")" = "200" ]; then
    HEADERS_READY=true
    break
  fi
  sleep 2
done
if [ "$HEADERS_READY" = "true" ]; then
  log_pass "Public tunnel serves within 60 seconds with no lamaste-agent update"
else
  log_fail "Public tunnel did not serve within 60 seconds"
fi

# From the visitor, over verified TLS (it trusts the E2E test CA): forge every
# header the panel or an Authelia-protected app would trust
SEEN_HEADERS=$(visitor_exec "curl -sS --max-time 15 --resolve '${HEADERS_FQDN}:443:${HOST_IP}' \
  -H 'X-SSL-Client-Verify: SUCCESS' -H 'X-SSL-Client-DN: CN=admin' -H 'X-SSL-Client-Serial: 01' \
  -H 'Remote-User: admin' -H 'Remote-Groups: admins' -H 'Remote-Name: Admin' -H 'Remote-Email: admin@example.com' \
  -H 'X-Forwarded-Proto: http' \
  https://${HEADERS_FQDN}/probe 2>/dev/null" || echo "{}")
assert_json_field "$SEEN_HEADERS" '.host' "$HEADERS_FQDN" "App sees Host = ${HEADERS_FQDN} (not 127.0.0.1:${HEADERS_PORT})" || true
assert_json_field "$SEEN_HEADERS" '."x-forwarded-proto"' "https" "App sees X-Forwarded-Proto: https (the client's value is replaced)" || true
assert_json_field_not_empty "$SEEN_HEADERS" '."x-forwarded-for"' "App sees X-Forwarded-For" || true
for forged in x-ssl-client-verify x-ssl-client-dn x-ssl-client-serial remote-user remote-groups remote-name remote-email; do
  FORGED_PRESENT=$(echo "$SEEN_HEADERS" | jq -r --arg h "$forged" 'has($h)' 2>/dev/null || echo "unknown")
  assert_eq "$FORGED_PRESENT" "false" "Client-supplied ${forged} header does not reach the app" || true
done

end_test

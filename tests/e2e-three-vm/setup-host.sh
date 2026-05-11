#!/usr/bin/env bash
# ============================================================================
# Lamaste E2E Three-VM Test — Host VM Setup
# ============================================================================
# Provisions the host VM with dnsmasq, certbot shim, runs the Lamaste
# installer, completes onboarding via API, and saves credentials for the
# orchestrator to pass to the agent VM.
#
# Usage:
#   sudo bash setup-host.sh <HOST_IP> <TEST_DOMAIN>
#
# Arguments:
#   HOST_IP      — The IP address of this VM (e.g., 192.168.64.5)
#   TEST_DOMAIN  — Test domain name (e.g., test.lamaste.local)
#
# Output:
#   /tmp/lamalibre-lamaste-test-credentials.json — credentials for the agent VM
# ============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Arguments
# ---------------------------------------------------------------------------
if [ $# -lt 2 ]; then
  echo "Usage: $0 <HOST_IP> <TEST_DOMAIN>"
  echo "  HOST_IP      IP address of this VM"
  echo "  TEST_DOMAIN  Test domain (e.g., test.lamaste.local)"
  exit 1
fi

HOST_IP="$1"
TEST_DOMAIN="$2"

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CERT_ARGS="--cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key --cacert /etc/lamalibre/lamaste/pki/ca.crt"
# Use the domain vhost (panel.<domain>) rather than the IP vhost (:9292). The
# IP vhost is auto-disabled whenever panel 2FA is on, which can linger across
# runs if a prior test 13 didn't get to its cleanup step. The domain vhost
# requires mTLS only, which we already have.
BASE_URL="https://panel.${TEST_DOMAIN}"

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
source "${LOGGING_LIB:-${SCRIPT_DIR}/logging.sh}"
init_log "setup-host"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# curl_mtls — curl with mTLS client certs and TLS verification disabled
curl_mtls() {
  curl -sk \
    --cert /etc/lamalibre/lamaste/pki/client.crt \
    --key /etc/lamalibre/lamaste/pki/client.key \
    --cacert /etc/lamalibre/lamaste/pki/ca.crt \
    "$@"
}

# ---------------------------------------------------------------------------
# Preflight
# ---------------------------------------------------------------------------
if [ "$(id -u)" -ne 0 ]; then
  log_fatal "This script must be run as root."
fi

if ! echo "${HOST_IP}" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$'; then
  log_fatal "Invalid HOST_IP: ${HOST_IP}"
fi

if [ -z "${TEST_DOMAIN}" ]; then
  log_fatal "TEST_DOMAIN must not be empty."
fi

log_header "Lamaste E2E — Host VM Setup"
log_kv "Host IP" "${HOST_IP}"
log_kv "Test Domain" "${TEST_DOMAIN}"
log_kv "Scripts" "${SCRIPT_DIR}"

# ---------------------------------------------------------------------------
# Step 0: Reset panel 2FA if a prior run enabled it.
#
# Panel 2FA disables the IP:9292 vhost (domain-only access enforced). Test
# 13 enables 2FA as part of its coverage, and if a run is interrupted or
# terminated before cleanup, 2FA stays on across runs — then every test that
# hits 127.0.0.1:9292 (which is most of them) fails the handshake. We
# proactively reset here since this is a test environment, not production.
# ---------------------------------------------------------------------------
PANEL_JSON=/etc/lamalibre/lamaste/panel.json
if [ -f "${PANEL_JSON}" ] && [ "$(jq -r '.panel2fa.enabled // false' "${PANEL_JSON}")" = "true" ]; then
  log_step "[0/10] Panel 2FA is enabled from a prior run — resetting..."
  SECRET=$(jq -r '.panel2fa.secret // ""' "${PANEL_JSON}")
  jq --arg secret "${SECRET}" '.panel2fa = {enabled: false, secret: $secret, setupComplete: false}' "${PANEL_JSON}" > "${PANEL_JSON}.tmp"
  chown lamaste:lamaste "${PANEL_JSON}.tmp"
  chmod 0600 "${PANEL_JSON}.tmp"
  mv "${PANEL_JSON}.tmp" "${PANEL_JSON}"
  ln -sf /etc/nginx/sites-available/lamalibre-lamaste-serverd-ip /etc/nginx/sites-enabled/lamalibre-lamaste-serverd-ip
  nginx -t && systemctl reload nginx
  systemctl restart lamalibre-lamaste-serverd
  # Give panel a moment to come back before curl_mtls probes start below.
  for i in $(seq 1 10); do
    if curl -sk --cert /etc/lamalibre/lamaste/pki/client.crt --key /etc/lamalibre/lamaste/pki/client.key --cacert /etc/lamalibre/lamaste/pki/ca.crt --max-time 2 https://127.0.0.1:9292/api/health 2>/dev/null | grep -q '"ok"'; then
      break
    fi
    sleep 1
  done
  log_ok "Panel 2FA disabled, IP vhost re-enabled"
fi

# ---------------------------------------------------------------------------
# Step 1: Configure system DNS — stop systemd-resolved first (frees port 53)
# ---------------------------------------------------------------------------
log_step "[1/10] Configuring system DNS..."

if systemctl is-active systemd-resolved &>/dev/null; then
  run_cmd "Stop systemd-resolved" systemctl stop systemd-resolved
  run_cmd "Disable systemd-resolved" systemctl disable systemd-resolved
  log_ok "Disabled systemd-resolved"
fi

# Write resolv.conf with public DNS (dnsmasq will take over once started)
cat > /etc/resolv.conf <<RESOLV
nameserver 8.8.8.8
nameserver 8.8.4.4
RESOLV

# Prevent resolv.conf from being overwritten by DHCP
if [ -f /etc/NetworkManager/NetworkManager.conf ]; then
  if ! grep -q 'dns=none' /etc/NetworkManager/NetworkManager.conf; then
    sed -i '/^\[main\]/a dns=none' /etc/NetworkManager/NetworkManager.conf 2>/dev/null || true
  fi
fi

log_ok "System DNS configured"

# ---------------------------------------------------------------------------
# Step 2: Install dnsmasq for local wildcard DNS
# ---------------------------------------------------------------------------
log_step "[2/10] Installing dnsmasq..."

run_cmd "apt-get update" apt-get update -qq
run_cmd "Install dnsmasq, jq, oathtool, and sqlite3" apt-get install -y -qq dnsmasq jq oathtool sqlite3

# Configure wildcard resolution: *.TEST_DOMAIN -> HOST_IP
mkdir -p /etc/dnsmasq.d
echo "address=/${TEST_DOMAIN}/${HOST_IP}" > /etc/dnsmasq.d/lamaste-test.conf

run_cmd "Restart dnsmasq" systemctl restart dnsmasq
run_cmd "Enable dnsmasq" systemctl enable dnsmasq

# Point resolv.conf to dnsmasq now that it's running
cat > /etc/resolv.conf <<RESOLV
nameserver 127.0.0.1
nameserver 8.8.8.8
nameserver 8.8.4.4
RESOLV

# Verify dnsmasq resolves the test domain
if host "${TEST_DOMAIN}" 127.0.0.1 &>/dev/null || dig +short "${TEST_DOMAIN}" @127.0.0.1 2>/dev/null | grep -q "${HOST_IP}"; then
  log_ok "DNS verified: ${TEST_DOMAIN} -> ${HOST_IP}"
else
  log_ok "dnsmasq configured: *.${TEST_DOMAIN} -> ${HOST_IP}"
fi

# ---------------------------------------------------------------------------
# Step 3: Install certbot shim
# ---------------------------------------------------------------------------
log_step "[3/10] Installing certbot shim..."

SHIM_SRC="${SCRIPT_DIR}/certbot-shim.sh"
if [ ! -f "${SHIM_SRC}" ]; then
  log_fatal "Certbot shim not found at ${SHIM_SRC}"
fi

# Install at /usr/bin/certbot to match the sudoers rules that serverd expects
cp "${SHIM_SRC}" /usr/bin/certbot
chmod +x /usr/bin/certbot

log_ok "certbot shim installed at /usr/bin/certbot"

# ---------------------------------------------------------------------------
# Step 4: Create dummy certbot.timer systemd unit
# ---------------------------------------------------------------------------
log_step "[4/10] Creating dummy certbot.timer..."

cat > /etc/systemd/system/certbot.timer <<'UNIT'
[Unit]
Description=Dummy certbot timer for E2E testing

[Timer]
OnCalendar=daily
Persistent=true

[Install]
WantedBy=timers.target
UNIT

cat > /etc/systemd/system/certbot.service <<'UNIT'
[Unit]
Description=Dummy certbot service for E2E testing

[Service]
Type=oneshot
ExecStart=/bin/true
UNIT

run_cmd "Reload systemd daemon" systemctl daemon-reload
run_cmd "Enable certbot.timer" systemctl enable certbot.timer
run_cmd "Start certbot.timer" systemctl start certbot.timer

log_ok "certbot.timer created and started"

# ---------------------------------------------------------------------------
# Step 5: Wait for panel to be ready
# (The installer was already run by the orchestrator before this script)
# ---------------------------------------------------------------------------
log_step "[5/10] Waiting for panel server to be ready..."

PANEL_READY=0
for i in $(seq 1 30); do
  if curl_mtls "${BASE_URL}/api/health" 2>/dev/null | grep -q '"ok"'; then
    PANEL_READY=1
    break
  fi
  sleep 1
done

if [ "${PANEL_READY}" -ne 1 ]; then
  log_fail "Panel server did not become ready within 30 seconds"
  journalctl -u lamalibre-lamaste-serverd --no-pager -n 20 || true
  log_fatal "Panel server not ready"
fi

log_ok "Panel server is ready"

# ---------------------------------------------------------------------------
# Step 7: Run onboarding via API (idempotent — skip entirely if already COMPLETED)
# ---------------------------------------------------------------------------
INITIAL_STATUS=$(curl_mtls "${BASE_URL}/api/onboarding/status" 2>/dev/null | jq -r '.onboarding.status // .status // empty' 2>/dev/null)

if [ "${INITIAL_STATUS}" = "COMPLETED" ]; then
  log_step "[6/10] Onboarding already COMPLETED — skipping domain/DNS/provision"
  log_ok "Onboarding state preserved from prior provisioning"
else
  log_step "[6/10] Running onboarding — setting domain..."

  DOMAIN_RESULT=$(curl_mtls -X POST -H "Content-Type: application/json" \
    -d "{\"domain\":\"${TEST_DOMAIN}\",\"email\":\"admin@${TEST_DOMAIN}\"}" \
    "${BASE_URL}/api/onboarding/domain" 2>/dev/null)

  if echo "${DOMAIN_RESULT}" | jq -e '.error' &>/dev/null; then
    ERROR_MSG=$(echo "${DOMAIN_RESULT}" | jq -r '.error')
    log_fatal "Failed to set domain: ${ERROR_MSG}"
  fi

  log_ok "Domain set to ${TEST_DOMAIN}"

  log_info "Verifying DNS..."

  DNS_RESULT=$(curl_mtls -X POST \
    "${BASE_URL}/api/onboarding/verify-dns" 2>/dev/null)

  DNS_OK=$(echo "${DNS_RESULT}" | jq -r '.ok' 2>/dev/null)
  if [ "${DNS_OK}" != "true" ]; then
    log_fail "DNS verification result: ${DNS_RESULT}"
    log_fatal "DNS verification failed. Check dnsmasq configuration."
  fi

  log_ok "DNS verified"

  log_info "Starting provisioning..."

  PROVISION_RESULT=$(curl_mtls -X POST \
    "${BASE_URL}/api/onboarding/provision" 2>/dev/null)

  if ! echo "${PROVISION_RESULT}" | grep -q '"ok"'; then
    log_fail "Provision start result: ${PROVISION_RESULT}"
    log_fatal "Failed to start provisioning"
  fi

  log_info "Provisioning started, polling for completion..."

  # Poll until onboarding status is COMPLETED (up to 120 seconds)
  PROVISION_DONE=0
  for i in $(seq 1 120); do
    STATUS_RESULT=$(curl_mtls "${BASE_URL}/api/onboarding/status" 2>/dev/null)
    ONBOARDING_STATUS=$(echo "${STATUS_RESULT}" | jq -r '.onboarding.status // .status // empty' 2>/dev/null)

    if [ "${ONBOARDING_STATUS}" = "COMPLETED" ]; then
      PROVISION_DONE=1
      break
    fi

    # Check for error
    PROVISION_ERROR=$(echo "${STATUS_RESULT}" | jq -r '.error // empty' 2>/dev/null)
    if [ -n "${PROVISION_ERROR}" ] && [ "${PROVISION_ERROR}" != "null" ]; then
      log_fail "Provisioning error: ${PROVISION_ERROR}"
      log_fatal "Provisioning failed"
    fi

    sleep 1
  done

  if [ "${PROVISION_DONE}" -ne 1 ]; then
    log_fail "Last status response: ${STATUS_RESULT}"
    log_fatal "Provisioning did not complete within 120 seconds"
  fi

  log_ok "Provisioning completed"
fi

# ---------------------------------------------------------------------------
# Step 8: Create test user via API
# ---------------------------------------------------------------------------
log_step "[7/10] Creating test user..."

# The admin password was generated during provisioning and is cleared after 5s.
# Instead of trying to capture it, we create a test user via the mTLS API.
USER_RESULT=$(curl_mtls -X POST -H "Content-Type: application/json" \
  -d '{"username":"testuser","displayname":"Test User","email":"test@test.local","password":"TestPassword-E2E-123"}' \
  "${BASE_URL}/api/users" 2>/dev/null)

if echo "${USER_RESULT}" | jq -e '.error' &>/dev/null; then
  ERROR_MSG=$(echo "${USER_RESULT}" | jq -r '.error')
  # If user already exists, that is acceptable
  if echo "${ERROR_MSG}" | grep -qi "already exists"; then
    log_ok "Test user already exists"
  else
    log_fatal "Failed to create test user: ${ERROR_MSG}"
  fi
else
  log_ok "Test user created (testuser / TestPassword-E2E-123)"
fi

# ---------------------------------------------------------------------------
# Step 9: Generate agent enrollment token
#
# If a prior run already enrolled "test-agent", the server rejects new token
# creation because the label is taken. For idempotent re-provisioning we
# revoke the existing cert first so we can hand the agent a fresh token —
# important since the chisel server key may have rotated and the agent needs
# to re-pin the new fingerprint.
# ---------------------------------------------------------------------------
log_step "[8/10] Generating agent enrollment token..."

EXISTING_AGENT=$(curl_mtls "${BASE_URL}/api/certs/agent" 2>/dev/null | jq -r '[.agents[]? | select(.label=="test-agent" and .revoked==false)] | length' 2>/dev/null)
if [ "${EXISTING_AGENT:-0}" != "0" ]; then
  log_info "Revoking stale test-agent cert so re-enrollment can proceed..."
  REVOKE_RESULT=$(curl_mtls -X DELETE "${BASE_URL}/api/certs/agent/test-agent" 2>/dev/null)
  log_info "Revoke response: ${REVOKE_RESULT}"
fi

ENROLL_RESULT=$(curl_mtls -X POST -H "Content-Type: application/json" \
  -d '{"label":"test-agent","capabilities":["tunnels:read","tunnels:write","services:read","services:write","system:read","identity:read","identity:query"]}' \
  "${BASE_URL}/api/certs/agent/enroll" 2>/dev/null)

if echo "${ENROLL_RESULT}" | jq -e '.error' &>/dev/null; then
  ERROR_MSG=$(echo "${ENROLL_RESULT}" | jq -r '.error')
  log_fatal "Failed to generate enrollment token: ${ERROR_MSG}"
fi

ENROLLMENT_TOKEN=$(echo "${ENROLL_RESULT}" | jq -r '.token // empty')
if [ -z "${ENROLLMENT_TOKEN}" ]; then
  log_fail "Enrollment response: ${ENROLL_RESULT}"
  log_fatal "Enrollment response did not include token"
fi

log_ok "Enrollment token generated (label: test-agent)"

# ---------------------------------------------------------------------------
# Step 10: Save credentials
# ---------------------------------------------------------------------------
log_step "[9/10] Saving credentials..."

cat > /tmp/lamalibre-lamaste-test-credentials.json <<CREDS
{
  "hostIp": "${HOST_IP}",
  "testDomain": "${TEST_DOMAIN}",
  "enrollmentToken": "${ENROLLMENT_TOKEN}",
  "testUser": "testuser",
  "testUserPassword": "TestPassword-E2E-123",
  "agentLabel": "test-agent"
}
CREDS

chmod 600 /tmp/lamalibre-lamaste-test-credentials.json

log_ok "Credentials saved to /tmp/lamalibre-lamaste-test-credentials.json"

# ---------------------------------------------------------------------------
# Step 11: Summary
# ---------------------------------------------------------------------------
log_step "[10/10] Setup complete!"

log_header "Host VM Setup Summary"
log_kv "Host IP" "${HOST_IP}"
log_kv "Test Domain" "${TEST_DOMAIN}"
log_kv "Panel URL (IP)" "https://${HOST_IP}:9292"
log_kv "Panel URL (DNS)" "https://panel.${TEST_DOMAIN}"
log_kv "Auth URL" "https://auth.${TEST_DOMAIN}"
log_kv "Tunnel URL" "https://tunnel.${TEST_DOMAIN}"
log_kv "Test User" "testuser / TestPassword-E2E-123"
log_kv "Agent Label" "test-agent"
log_kv "Enrollment Token" "(generated, one-time use)"
log_kv "Credentials file" "/tmp/lamalibre-lamaste-test-credentials.json"
log_kv "Log file" "$(log_file_path)"
log_info "Next: transfer credentials to the agent VM, then run setup-agent.sh on the agent VM."

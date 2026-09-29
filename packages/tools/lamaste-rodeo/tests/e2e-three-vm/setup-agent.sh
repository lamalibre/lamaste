#!/usr/bin/env bash
# ============================================================================
# Lamaste E2E Three-VM Test — Agent VM Setup
# ============================================================================
# Installs lamaste-agent from a tarball and enrolls using a one-time token.
#
# Prerequisites:
#   - The orchestrator must have transferred the agent tarball to
#     /tmp/lamalibre-lamaste-agent.tgz before running this script.
#
# Usage:
#   sudo bash setup-agent.sh <HOST_IP> <TEST_DOMAIN> <ENROLLMENT_TOKEN> <E2E_CA_CERT_B64>
#
# Arguments:
#   HOST_IP          — IP address of the host VM
#   TEST_DOMAIN      — Test domain name (e.g., test.lamaste.local)
#   ENROLLMENT_TOKEN — One-time enrollment token from the panel
#   E2E_CA_CERT_B64  — Base64 PEM of the host's E2E test CA (credentials
#                      e2eCaCertB64). The chisel client verifies
#                      tunnel.<domain> against the system trust store, so the
#                      CA that signs the host's test certificates is installed
#                      there.
# ============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Arguments
# ---------------------------------------------------------------------------
if [ $# -lt 4 ]; then
  echo "Usage: $0 <HOST_IP> <TEST_DOMAIN> <ENROLLMENT_TOKEN> <E2E_CA_CERT_B64>"
  echo "  HOST_IP          IP address of the host VM"
  echo "  TEST_DOMAIN      Test domain (e.g., test.lamaste.local)"
  echo "  ENROLLMENT_TOKEN One-time enrollment token from the panel"
  echo "  E2E_CA_CERT_B64  Base64 PEM of the host's E2E test CA"
  exit 1
fi

HOST_IP="$1"
TEST_DOMAIN="$2"
ENROLLMENT_TOKEN="$3"
E2E_CA_CERT_B64="$4"

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${LOGGING_LIB:-${SCRIPT_DIR}/logging.sh}"
init_log "setup-agent"

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

if [ -z "${ENROLLMENT_TOKEN}" ]; then
  log_fatal "ENROLLMENT_TOKEN must not be empty."
fi

if [ -z "${E2E_CA_CERT_B64}" ]; then
  log_fatal "E2E_CA_CERT_B64 must not be empty."
fi

if [ ! -f /tmp/lamalibre-lamaste-agent.tgz ]; then
  log_fatal "Agent tarball not found at /tmp/lamalibre-lamaste-agent.tgz. The orchestrator must transfer it before running this script."
fi

log_header "Lamaste E2E — Agent VM Setup"
log_kv "Host IP" "${HOST_IP}"
log_kv "Test Domain" "${TEST_DOMAIN}"

# ---------------------------------------------------------------------------
# Step 1: Configure /etc/hosts
# ---------------------------------------------------------------------------
log_step "[1/6] Configuring /etc/hosts..."

# Add entries to /etc/hosts for immediate use
sed -i '/# lamaste-e2e-test$/d' /etc/hosts
{
  echo "${HOST_IP}  ${TEST_DOMAIN}  # lamaste-e2e-test"
  echo "${HOST_IP}  panel.${TEST_DOMAIN}  # lamaste-e2e-test"
  echo "${HOST_IP}  auth.${TEST_DOMAIN}  # lamaste-e2e-test"
  echo "${HOST_IP}  tunnel.${TEST_DOMAIN}  # lamaste-e2e-test"
} >> /etc/hosts

# Also inject into the cloud-init hosts template so entries survive snapshot
# restores. Multipass cloud-init regenerates /etc/hosts from this template
# on every boot — entries here are preserved automatically.
TMPL="/etc/cloud/templates/hosts.debian.tmpl"
if [ -f "${TMPL}" ]; then
  sed -i '/# lamaste-e2e-test$/d' "${TMPL}"
  {
    echo "${HOST_IP}  ${TEST_DOMAIN}  # lamaste-e2e-test"
    echo "${HOST_IP}  panel.${TEST_DOMAIN}  # lamaste-e2e-test"
    echo "${HOST_IP}  auth.${TEST_DOMAIN}  # lamaste-e2e-test"
    echo "${HOST_IP}  tunnel.${TEST_DOMAIN}  # lamaste-e2e-test"
  } >> "${TMPL}"
fi

log_ok "/etc/hosts configured with ${TEST_DOMAIN} entries (persists across reboots)"

# ---------------------------------------------------------------------------
# Step 2: Trust the host's E2E test CA
# ---------------------------------------------------------------------------
log_step "[2/6] Installing the E2E test CA into the system trust store..."

# The host's certbot shim signs every certificate with this CA. The agent's
# chisel client verifies tunnel.<domain> against the system roots (it never
# skips verification), exactly as it would a Let's Encrypt chain in production.
E2E_CA_DEST="/usr/local/share/ca-certificates/lamaste-e2e-ca.crt"
E2E_CA_TMP="$(mktemp)"
if ! echo "${E2E_CA_CERT_B64}" | base64 -d > "${E2E_CA_TMP}" 2>/dev/null \
  || ! openssl x509 -noout -in "${E2E_CA_TMP}" 2>/dev/null; then
  rm -f "${E2E_CA_TMP}"
  log_fatal "E2E_CA_CERT_B64 is not a base64-encoded PEM certificate"
fi
if ! openssl x509 -noout -text -in "${E2E_CA_TMP}" | grep -q "CA:TRUE"; then
  rm -f "${E2E_CA_TMP}"
  log_fatal "E2E test CA certificate is not a CA (basicConstraints CA:TRUE missing)"
fi
install -m 644 "${E2E_CA_TMP}" "${E2E_CA_DEST}"
rm -f "${E2E_CA_TMP}"
run_cmd "Update system trust store" update-ca-certificates

# Prove the trust store now verifies the host: no -k, so a certificate the
# system does not trust (or one that does not name tunnel.<domain>) fails here.
TUNNEL_TLS_RC=0
curl -sS -o /dev/null --max-time 15 "https://tunnel.${TEST_DOMAIN}/" 2>/dev/null || TUNNEL_TLS_RC=$?
case "${TUNNEL_TLS_RC}" in
  0|22) log_ok "tunnel.${TEST_DOMAIN} certificate verified against the system trust store" ;;
  35|51|58|60|77|83|90|91)
    log_fatal "TLS verification of tunnel.${TEST_DOMAIN} failed (curl exit ${TUNNEL_TLS_RC})" ;;
  *) log_fatal "Could not reach https://tunnel.${TEST_DOMAIN}/ (curl exit ${TUNNEL_TLS_RC})" ;;
esac

# ---------------------------------------------------------------------------
# Step 3: Install Node.js 20
# ---------------------------------------------------------------------------
log_step "[3/6] Installing Node.js 20..."

if command -v node &>/dev/null; then
  NODE_VERSION=$(node --version 2>/dev/null)
  log_ok "Node.js already installed: ${NODE_VERSION}"
else
  run_cmd "Install Node.js 20 via NodeSource" bash -c "curl -fsSL https://deb.nodesource.com/setup_20.x | bash -"
  run_cmd "Install nodejs package" apt-get install -y nodejs
  NODE_VERSION=$(node --version 2>/dev/null)
  log_ok "Node.js installed: ${NODE_VERSION}"
fi

# ---------------------------------------------------------------------------
# Step 4: Install lamaste-agent from tarball
# ---------------------------------------------------------------------------
log_step "[4/6] Installing lamaste-agent from tarball..."

# A global install is required: `lamaste-agent setup` installs a sync timer
# that runs the installed program every 30 seconds, and it refuses to run
# (before spending the enrollment token) from anywhere but npm's global
# node_modules — an npx copy can vanish from the npm cache at any time.
run_cmd "Install lamaste-agent globally" npm install -g /tmp/lamalibre-lamaste-agent.tgz
AGENT_VERSION=$(lamaste-agent --help 2>/dev/null | head -1 || echo "installed")
log_ok "lamaste-agent installed: ${AGENT_VERSION}"

# Prove the binary on PATH resolves into `npm root -g`, the exact check setup
# makes (resolveInstalledAgentCli) — no LAMALIBRE_LAMASTE_AGENT_CLI_PATH needed
NPM_GLOBAL_ROOT=$(realpath "$(npm root -g)")
AGENT_SCRIPT=$(realpath "$(command -v lamaste-agent)")
case "${AGENT_SCRIPT}" in
  "${NPM_GLOBAL_ROOT}"/*) log_ok "lamaste-agent resolves into npm's global root (${AGENT_SCRIPT})" ;;
  *) log_fatal "lamaste-agent resolves to ${AGENT_SCRIPT}, outside npm's global root ${NPM_GLOBAL_ROOT} — setup would refuse" ;;
esac

# ---------------------------------------------------------------------------
# Step 5: Run token-based enrollment
# ---------------------------------------------------------------------------
log_step "[5/6] Running lamaste-agent setup with enrollment token..."

# The agent CLI installs a user-level systemd unit and runs `systemctl --user
# daemon-reload`. multipass exec doesn't go through PAM, so root has no
# /run/user/0 by default — enable lingering and export XDG_RUNTIME_DIR so the
# user systemd instance is reachable from this non-PAM shell. Lingering is
# also what makes the agent's user-level chisel unit start at boot without a
# login; `lamaste-agent setup` reports it as bootPersistence (asserted
# 'enabled' by test 16).
loginctl enable-linger root
if [ "$(loginctl show-user root --property=Linger --value 2>/dev/null)" != "yes" ]; then
  log_fatal "Lingering could not be enabled for root — the agent's tunnel would not survive a reboot"
fi
log_ok "Lingering enabled for root (agent services start at boot)"
# Wait for /run/user/0 to materialise (linger spawns user@0.service async)
for _ in 1 2 3 4 5 6 7 8 9 10; do
  [ -S /run/user/0/systemd/private ] && break
  sleep 1
done
export XDG_RUNTIME_DIR=/run/user/0
export DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/0/bus"

# Run the token-based setup — this will:
# - Generate keypair and CSR
# - Enroll with the panel using the one-time token
# - Store the certificate (P12 on Linux)
# - Download and install Chisel
# - Fetch tunnel config and create systemd unit
# - Start the agent service
# Pass token via env var to keep it out of process listings
AGENT_LABEL="e2e-agent"
LAMALIBRE_LAMASTE_ENROLLMENT_TOKEN="${ENROLLMENT_TOKEN}" lamaste-agent setup --label "${AGENT_LABEL}" --panel-url "https://${HOST_IP}:9292"

log_ok "lamaste-agent setup completed (label: ${AGENT_LABEL})"

# Setup installs the sync timer (user units, multi-agent: names carry the
# label) that converges the tunnel client with the panel every 30 seconds.
SYNC_TIMER="lamalibre-lamaste-sync-${AGENT_LABEL}.timer"
SYNC_TIMER_STATE=$(systemctl --user is-active "${SYNC_TIMER}" 2>/dev/null || echo "inactive")
if [ "$SYNC_TIMER_STATE" = "active" ]; then
  log_ok "systemd --user timer ${SYNC_TIMER} is active"
else
  log_fatal "systemd --user timer ${SYNC_TIMER} is ${SYNC_TIMER_STATE} — tunnel changes would never reach this agent"
fi

# No tunnel is assigned to this agent yet, so its chisel client must be
# stopped (chisel exits at once without a remote and would crash-loop); the
# sync timer starts it once the panel assigns a tunnel. Tests create tunnels.
SERVICE_NAME="lamalibre-lamaste-chisel-${AGENT_LABEL}"
AGENT_STATUS=$(systemctl --user is-active "${SERVICE_NAME}" 2>/dev/null || echo "inactive")
if [ "$AGENT_STATUS" = "active" ] || [ "$AGENT_STATUS" = "activating" ]; then
  log_fail "systemd --user service ${SERVICE_NAME} is ${AGENT_STATUS} with no tunnel assigned (expected inactive)"
else
  log_ok "systemd --user service ${SERVICE_NAME} is ${AGENT_STATUS} (no tunnel assigned yet)"
fi

# ---------------------------------------------------------------------------
# Step 6: Install Python 3 for test HTTP server
# ---------------------------------------------------------------------------
log_step "[6/6] Installing Python 3..."

if command -v python3 &>/dev/null; then
  PYTHON_VERSION=$(python3 --version 2>/dev/null)
  log_ok "Python 3 already installed: ${PYTHON_VERSION}"
else
  run_cmd "Update apt package index" apt-get update -qq
  run_cmd "Install Python 3" apt-get install -y -qq python3
  PYTHON_VERSION=$(python3 --version 2>/dev/null)
  log_ok "${PYTHON_VERSION} installed"
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
log_header "Agent VM Setup Summary"
log_kv "Host IP" "${HOST_IP}"
log_kv "Test Domain" "${TEST_DOMAIN}"
log_kv "Node.js" "$(node --version 2>/dev/null)"
log_kv "lamaste-agent" "installed"
log_kv "chisel service" "$(systemctl --user is-active lamalibre-lamaste-chisel-e2e-agent 2>/dev/null || echo 'unknown') (inactive until a tunnel is assigned)"
log_kv "sync timer" "$(systemctl --user is-active lamalibre-lamaste-sync-e2e-agent.timer 2>/dev/null || echo 'unknown')"
log_kv "Python" "$(python3 --version 2>/dev/null)"
log_kv "Panel reachable" "yes (enrolled via token)"
log_ok "The agent VM is ready for E2E tests."

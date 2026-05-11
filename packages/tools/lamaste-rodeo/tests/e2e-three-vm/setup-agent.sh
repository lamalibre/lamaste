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
#   sudo bash setup-agent.sh <HOST_IP> <TEST_DOMAIN> <ENROLLMENT_TOKEN>
#
# Arguments:
#   HOST_IP          — IP address of the host VM
#   TEST_DOMAIN      — Test domain name (e.g., test.lamaste.local)
#   ENROLLMENT_TOKEN — One-time enrollment token from the panel
# ============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Arguments
# ---------------------------------------------------------------------------
if [ $# -lt 3 ]; then
  echo "Usage: $0 <HOST_IP> <TEST_DOMAIN> <ENROLLMENT_TOKEN>"
  echo "  HOST_IP          IP address of the host VM"
  echo "  TEST_DOMAIN      Test domain (e.g., test.lamaste.local)"
  echo "  ENROLLMENT_TOKEN One-time enrollment token from the panel"
  exit 1
fi

HOST_IP="$1"
TEST_DOMAIN="$2"
ENROLLMENT_TOKEN="$3"

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

if [ ! -f /tmp/lamalibre-lamaste-agent.tgz ]; then
  log_fatal "Agent tarball not found at /tmp/lamalibre-lamaste-agent.tgz. The orchestrator must transfer it before running this script."
fi

log_header "Lamaste E2E — Agent VM Setup"
log_kv "Host IP" "${HOST_IP}"
log_kv "Test Domain" "${TEST_DOMAIN}"

# ---------------------------------------------------------------------------
# Step 1: Configure /etc/hosts
# ---------------------------------------------------------------------------
log_step "[1/5] Configuring /etc/hosts..."

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
# Step 2: Install Node.js 20
# ---------------------------------------------------------------------------
log_step "[2/5] Installing Node.js 20..."

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
# Step 3: Install lamaste-agent from tarball
# ---------------------------------------------------------------------------
log_step "[3/5] Installing lamaste-agent from tarball..."

run_cmd "Install lamaste-agent globally" npm install -g /tmp/lamalibre-lamaste-agent.tgz
AGENT_VERSION=$(lamaste-agent --help 2>/dev/null | head -1 || echo "installed")
log_ok "lamaste-agent installed: ${AGENT_VERSION}"

# ---------------------------------------------------------------------------
# Step 4: Run token-based enrollment
# ---------------------------------------------------------------------------
log_step "[4/5] Running lamaste-agent setup with enrollment token..."

# The agent CLI installs a user-level systemd unit and runs `systemctl --user
# daemon-reload`. multipass exec doesn't go through PAM, so root has no
# /run/user/0 by default — enable lingering and export XDG_RUNTIME_DIR so the
# user systemd instance is reachable from this non-PAM shell.
loginctl enable-linger root
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

# Verify agent is running (multi-agent: service name includes the label).
# The unit is user-level, so query via --user.
SERVICE_NAME="lamalibre-lamaste-chisel-${AGENT_LABEL}"
AGENT_STATUS=$(systemctl --user is-active "${SERVICE_NAME}" 2>/dev/null || echo "inactive")
if [ "$AGENT_STATUS" = "active" ]; then
  log_ok "systemd --user service ${SERVICE_NAME} is active"
else
  log_fail "systemd --user service ${SERVICE_NAME} is ${AGENT_STATUS}"
fi

# ---------------------------------------------------------------------------
# Step 5: Install Python 3 for test HTTP server
# ---------------------------------------------------------------------------
log_step "[5/5] Installing Python 3..."

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
log_kv "systemd service" "$(systemctl --user is-active lamalibre-lamaste-chisel-e2e-agent 2>/dev/null || echo 'unknown')"
log_kv "Python" "$(python3 --version 2>/dev/null)"
log_kv "Panel reachable" "yes (enrolled via token)"
log_ok "The agent VM is ready for E2E tests."

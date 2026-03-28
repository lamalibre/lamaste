#!/usr/bin/env bash
# ============================================================================
# Portlama E2E Three-VM Test — Agent VM Setup
# ============================================================================
# Installs portlama-agent from a tarball and enrolls using a one-time token.
#
# Prerequisites:
#   - The orchestrator must have transferred the agent tarball to
#     /tmp/portlama-agent.tgz before running this script.
#
# Usage:
#   sudo bash setup-agent.sh <HOST_IP> <TEST_DOMAIN> <ENROLLMENT_TOKEN>
#
# Arguments:
#   HOST_IP          — IP address of the host VM
#   TEST_DOMAIN      — Test domain name (e.g., test.portlama.local)
#   ENROLLMENT_TOKEN — One-time enrollment token from the panel
# ============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Arguments
# ---------------------------------------------------------------------------
if [ $# -lt 3 ]; then
  echo "Usage: $0 <HOST_IP> <TEST_DOMAIN> <ENROLLMENT_TOKEN>"
  echo "  HOST_IP          IP address of the host VM"
  echo "  TEST_DOMAIN      Test domain (e.g., test.portlama.local)"
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

if [ ! -f /tmp/portlama-agent.tgz ]; then
  log_fatal "Agent tarball not found at /tmp/portlama-agent.tgz. The orchestrator must transfer it before running this script."
fi

log_header "Portlama E2E — Agent VM Setup"
log_kv "Host IP" "${HOST_IP}"
log_kv "Test Domain" "${TEST_DOMAIN}"

# ---------------------------------------------------------------------------
# Step 1: Configure /etc/hosts
# ---------------------------------------------------------------------------
log_step "[1/5] Configuring /etc/hosts..."

# Remove any previous portlama test entries to ensure idempotency
sed -i '/# portlama-e2e-test$/d' /etc/hosts

# Add entries for the host VM's domain and subdomains
{
  echo "${HOST_IP}  ${TEST_DOMAIN}  # portlama-e2e-test"
  echo "${HOST_IP}  panel.${TEST_DOMAIN}  # portlama-e2e-test"
  echo "${HOST_IP}  auth.${TEST_DOMAIN}  # portlama-e2e-test"
  echo "${HOST_IP}  tunnel.${TEST_DOMAIN}  # portlama-e2e-test"
} >> /etc/hosts

log_ok "/etc/hosts configured with ${TEST_DOMAIN} entries"

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
# Step 3: Install portlama-agent from tarball
# ---------------------------------------------------------------------------
log_step "[3/5] Installing portlama-agent from tarball..."

run_cmd "Install portlama-agent globally" npm install -g /tmp/portlama-agent.tgz
AGENT_VERSION=$(portlama-agent --help 2>/dev/null | head -1 || echo "installed")
log_ok "portlama-agent installed: ${AGENT_VERSION}"

# ---------------------------------------------------------------------------
# Step 4: Run token-based enrollment
# ---------------------------------------------------------------------------
log_step "[4/5] Running portlama-agent setup with enrollment token..."

# Run the token-based setup — this will:
# - Generate keypair and CSR
# - Enroll with the panel using the one-time token
# - Store the certificate (P12 on Linux)
# - Download and install Chisel
# - Fetch tunnel config and create systemd unit
# - Start the agent service
# Pass token via env var to keep it out of process listings
AGENT_LABEL="e2e-agent"
PORTLAMA_ENROLLMENT_TOKEN="${ENROLLMENT_TOKEN}" portlama-agent setup --label "${AGENT_LABEL}" --panel-url "https://${HOST_IP}:9292"

log_ok "portlama-agent setup completed (label: ${AGENT_LABEL})"

# Verify agent is running (multi-agent: service name includes the label)
SERVICE_NAME="portlama-chisel-${AGENT_LABEL}"
AGENT_STATUS=$(systemctl is-active "${SERVICE_NAME}" 2>/dev/null || echo "inactive")
if [ "$AGENT_STATUS" = "active" ]; then
  log_ok "systemd service ${SERVICE_NAME} is active"
else
  log_fail "systemd service ${SERVICE_NAME} is ${AGENT_STATUS}"
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
log_kv "portlama-agent" "installed"
log_kv "systemd service" "$(systemctl is-active portlama-chisel-e2e-agent 2>/dev/null || echo 'unknown')"
log_kv "Python" "$(python3 --version 2>/dev/null)"
log_kv "Panel reachable" "yes (enrolled via token)"
log_ok "The agent VM is ready for E2E tests."

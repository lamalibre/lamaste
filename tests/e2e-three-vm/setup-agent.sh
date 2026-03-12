#!/usr/bin/env bash
# ============================================================================
# Portlama E2E Three-VM Test — Agent VM Setup
# ============================================================================
# Prepares the agent VM with /etc/hosts entries, Chisel binary, the agent
# P12 certificate, and Python 3 for running test HTTP servers.
#
# Prerequisites:
#   - The orchestrator must have transferred the agent P12 to /tmp/agent.p12
#     before running this script.
#
# Usage:
#   sudo bash setup-agent.sh <HOST_IP> <TEST_DOMAIN> <AGENT_P12_PASSWORD>
#
# Arguments:
#   HOST_IP            — IP address of the host VM
#   TEST_DOMAIN        — Test domain name (e.g., test.portlama.local)
#   AGENT_P12_PASSWORD — Password for the agent P12 file
# ============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Arguments
# ---------------------------------------------------------------------------
if [ $# -lt 3 ]; then
  echo "Usage: $0 <HOST_IP> <TEST_DOMAIN> <AGENT_P12_PASSWORD>"
  echo "  HOST_IP            IP address of the host VM"
  echo "  TEST_DOMAIN        Test domain (e.g., test.portlama.local)"
  echo "  AGENT_P12_PASSWORD Password for the agent P12 certificate"
  exit 1
fi

HOST_IP="$1"
TEST_DOMAIN="$2"
AGENT_P12_PASSWORD="$3"

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

if [ -z "${AGENT_P12_PASSWORD}" ]; then
  log_fatal "AGENT_P12_PASSWORD must not be empty."
fi

if [ ! -f /tmp/agent.p12 ]; then
  log_fatal "Agent P12 file not found at /tmp/agent.p12. The orchestrator must transfer it before running this script."
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
# Step 2: Install Chisel
# ---------------------------------------------------------------------------
log_step "[2/5] Installing Chisel..."

CHISEL_BIN="/usr/local/bin/chisel"

if [ -x "${CHISEL_BIN}" ]; then
  EXISTING_VERSION=$("${CHISEL_BIN}" --version 2>/dev/null || echo "unknown")
  log_ok "Chisel already installed: ${EXISTING_VERSION}"
else
  # Detect architecture (aarch64 on Apple Silicon VMs, x86_64 on Intel)
  UNAME_ARCH=$(uname -m)
  case "${UNAME_ARCH}" in
    aarch64|arm64) CHISEL_ARCH="linux_arm64" ;;
    x86_64)        CHISEL_ARCH="linux_amd64" ;;
    *)             CHISEL_ARCH="linux_amd64" ;;
  esac

  # Fetch the latest release version from GitHub (same approach as the server)
  RELEASE_INFO=$(curl -sL \
    -H "Accept: application/vnd.github+json" \
    "https://api.github.com/repos/jpillora/chisel/releases/latest")

  DOWNLOAD_URL=$(echo "${RELEASE_INFO}" | grep -o "\"browser_download_url\": *\"[^\"]*${CHISEL_ARCH}[^\"]*\\.gz\"" \
    | head -1 | cut -d'"' -f4)

  if [ -z "${DOWNLOAD_URL}" ]; then
    log_fatal "Could not find Chisel ${CHISEL_ARCH} download URL from GitHub releases"
  fi

  CHISEL_VERSION=$(echo "${RELEASE_INFO}" | grep -o '"tag_name": *"[^"]*"' | head -1 | cut -d'"' -f4)

  log_info "Downloading Chisel ${CHISEL_VERSION}..."
  TMP_GZ=$(mktemp /tmp/chisel-XXXXXX.gz)
  run_cmd "Download Chisel ${CHISEL_VERSION}" curl -sL -o "${TMP_GZ}" "${DOWNLOAD_URL}"

  run_cmd "Extract Chisel archive" gunzip -f "${TMP_GZ}"
  TMP_BIN="${TMP_GZ%.gz}"

  mv "${TMP_BIN}" "${CHISEL_BIN}"
  chmod +x "${CHISEL_BIN}"

  # Verify installation
  INSTALLED_VERSION=$("${CHISEL_BIN}" --version 2>/dev/null || echo "unknown")
  log_ok "Chisel installed: ${INSTALLED_VERSION}"
fi

# ---------------------------------------------------------------------------
# Step 3: Set up agent P12 certificate
# ---------------------------------------------------------------------------
log_step "[3/5] Setting up agent P12 certificate..."

mkdir -p /root/.portlama
mv /tmp/agent.p12 /root/.portlama/client.p12
chmod 600 /root/.portlama/client.p12

# Also extract PEM cert and key for tools that prefer separate files
# (e.g., curl on some systems handles PEM better than P12)
AGENT_DIR="/root/.portlama"
openssl pkcs12 -in "${AGENT_DIR}/client.p12" \
  -clcerts -nokeys -out "${AGENT_DIR}/client.crt" \
  -passin "pass:${AGENT_P12_PASSWORD}" 2>/dev/null || true
openssl pkcs12 -in "${AGENT_DIR}/client.p12" \
  -nocerts -nodes -out "${AGENT_DIR}/client.key" \
  -passin "pass:${AGENT_P12_PASSWORD}" 2>/dev/null || true
openssl pkcs12 -in "${AGENT_DIR}/client.p12" \
  -cacerts -nokeys -out "${AGENT_DIR}/ca.crt" \
  -passin "pass:${AGENT_P12_PASSWORD}" 2>/dev/null || true

chmod 600 "${AGENT_DIR}/client.key" 2>/dev/null || true
chmod 644 "${AGENT_DIR}/client.crt" "${AGENT_DIR}/ca.crt" 2>/dev/null || true

log_ok "Agent P12 installed at ${AGENT_DIR}/client.p12"
log_ok "PEM files extracted to ${AGENT_DIR}/"

# ---------------------------------------------------------------------------
# Step 4: Verify panel connectivity
# ---------------------------------------------------------------------------
log_step "[4/5] Verifying panel connectivity..."

CONNECT_OK=0
for i in $(seq 1 15); do
  HEALTH_RESULT=$(curl -sk \
    --cert-type P12 --cert "/root/.portlama/client.p12:${AGENT_P12_PASSWORD}" \
    "https://${HOST_IP}:9292/api/health" 2>/dev/null || true)

  if echo "${HEALTH_RESULT}" | grep -q '"ok"'; then
    CONNECT_OK=1
    break
  fi
  sleep 1
done

if [ "${CONNECT_OK}" -ne 1 ]; then
  log_fail "Could not reach panel at https://${HOST_IP}:9292/api/health"
  log_fail "Last response: ${HEALTH_RESULT}"
  log_fatal "Panel connectivity check failed"
fi

log_ok "Panel is reachable via agent P12 certificate"

# Also verify domain-based access via /etc/hosts
DOMAIN_HEALTH=$(curl -sk \
  --cert-type P12 --cert "/root/.portlama/client.p12:${AGENT_P12_PASSWORD}" \
  "https://panel.${TEST_DOMAIN}:9292/api/health" 2>/dev/null || true)

if echo "${DOMAIN_HEALTH}" | grep -q '"ok"'; then
  log_ok "Panel is reachable via domain: panel.${TEST_DOMAIN}"
else
  log_info "Domain-based access not available on IP:9292 (expected if panel vhost uses port 443)"
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
log_kv "Chisel" "$(${CHISEL_BIN} --version 2>/dev/null || echo 'installed')"
log_kv "Python" "$(python3 --version 2>/dev/null)"
log_kv "Agent P12" "/root/.portlama/client.p12"
log_kv "Agent PEM Cert" "/root/.portlama/client.crt"
log_kv "Agent PEM Key" "/root/.portlama/client.key"
log_kv "Panel reachable" "yes"
log_ok "The agent VM is ready for E2E tests."

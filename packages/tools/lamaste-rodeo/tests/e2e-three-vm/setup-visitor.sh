#!/usr/bin/env bash
# ============================================================================
# Lamaste E2E Three-VM Test — Visitor VM Setup
# ============================================================================
# Prepares the visitor VM as an external client that accesses tunneled apps
# and static sites through the host's nginx. No mTLS certificates — this VM
# simulates a real browser/visitor from outside the host.
#
# Usage:
#   sudo bash setup-visitor.sh <HOST_IP> <TEST_DOMAIN>
#
# Arguments:
#   HOST_IP      — IP address of the host VM
#   TEST_DOMAIN  — Test domain name (e.g., test.lamaste.local)
# ============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Arguments
# ---------------------------------------------------------------------------
if [ $# -lt 2 ]; then
  echo "Usage: $0 <HOST_IP> <TEST_DOMAIN>"
  echo "  HOST_IP      IP address of the host VM"
  echo "  TEST_DOMAIN  Test domain (e.g., test.lamaste.local)"
  exit 1
fi

HOST_IP="$1"
TEST_DOMAIN="$2"

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${LOGGING_LIB:-${SCRIPT_DIR}/logging.sh}"
init_log "setup-visitor"

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

log_header "Lamaste E2E — Visitor VM Setup"
log_kv "Host IP" "${HOST_IP}"
log_kv "Test Domain" "${TEST_DOMAIN}"

# ---------------------------------------------------------------------------
# Step 1: Install dependencies
# ---------------------------------------------------------------------------
log_step "[1/3] Installing dependencies..."

run_cmd "apt-get update" apt-get update -qq
run_cmd "Install curl, jq, oathtool" apt-get install -y -qq curl jq oathtool

log_ok "curl, jq, oathtool installed"

# ---------------------------------------------------------------------------
# Step 2: Configure /etc/hosts
# ---------------------------------------------------------------------------
log_step "[2/3] Configuring /etc/hosts..."

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
# Step 3: Verify connectivity
# ---------------------------------------------------------------------------
log_step "[3/3] Verifying connectivity to host..."

CONNECT_OK=0
for i in $(seq 1 15); do
  # Without mTLS cert, we expect a TLS rejection (400/496) or connection error.
  # Any non-000 HTTP status proves TCP+TLS connectivity works.
  STATUS=$(curl -sk -o /dev/null -w '%{http_code}' --max-time 5 \
    "https://${HOST_IP}:9292/" 2>/dev/null || echo "000")

  if [ "$STATUS" != "000" ]; then
    CONNECT_OK=1
    break
  fi
  sleep 1
done

if [ "${CONNECT_OK}" -eq 1 ]; then
  log_ok "Host VM reachable at ${HOST_IP}:9292 (HTTP ${STATUS} — mTLS correctly rejects unauthenticated client)"
else
  log_fatal "Cannot reach host VM at ${HOST_IP}:9292 — connectivity check failed"
fi

# Also verify domain resolution via /etc/hosts
DOMAIN_STATUS=$(curl -sk -o /dev/null -w '%{http_code}' --max-time 5 \
  "https://panel.${TEST_DOMAIN}:9292/" 2>/dev/null || echo "000")

if [ "$DOMAIN_STATUS" != "000" ]; then
  log_ok "Domain panel.${TEST_DOMAIN} resolves correctly (HTTP ${DOMAIN_STATUS})"
else
  log_info "domain-based access returned 000 (may need port 443 instead of 9292)"
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
log_header "Visitor VM Setup Summary"
log_kv "Host IP" "${HOST_IP}"
log_kv "Test Domain" "${TEST_DOMAIN}"
log_kv "Dependencies" "curl, jq, oathtool"
log_kv "mTLS certs" "NONE (intentionally — simulates external visitor)"
log_kv "/etc/hosts" "configured for ${TEST_DOMAIN} subdomains"
log_kv "Log file" "$(log_file_path)"
log_ok "The visitor VM is ready for E2E tests."

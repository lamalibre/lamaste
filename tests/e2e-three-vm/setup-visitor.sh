#!/usr/bin/env bash
# ============================================================================
# Lamaste E2E Three-VM Test — Visitor VM Setup
# ============================================================================
# Prepares the visitor VM as an external client that accesses tunneled apps
# and static sites through the host's nginx. No mTLS certificates — this VM
# simulates a real browser/visitor from outside the host. Like a real
# browser it trusts the CA that issued the host's public certificates — here
# the host's E2E test CA, installed into the system trust store — so visits to
# https://<name>.<domain> verify the certificate and hostname without -k.
#
# Usage:
#   sudo bash setup-visitor.sh <HOST_IP> <TEST_DOMAIN> <E2E_CA_CERT_B64>
#
# Arguments:
#   HOST_IP          — IP address of the host VM
#   TEST_DOMAIN      — Test domain name (e.g., test.lamaste.local)
#   E2E_CA_CERT_B64  — Base64 PEM of the host's E2E test CA (credentials
#                      e2eCaCertB64)
# ============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Arguments
# ---------------------------------------------------------------------------
if [ $# -lt 3 ]; then
  echo "Usage: $0 <HOST_IP> <TEST_DOMAIN> <E2E_CA_CERT_B64>"
  echo "  HOST_IP          IP address of the host VM"
  echo "  TEST_DOMAIN      Test domain (e.g., test.lamaste.local)"
  echo "  E2E_CA_CERT_B64  Base64 PEM of the host's E2E test CA"
  exit 1
fi

HOST_IP="$1"
TEST_DOMAIN="$2"
E2E_CA_CERT_B64="$3"

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

if [ -z "${E2E_CA_CERT_B64}" ]; then
  log_fatal "E2E_CA_CERT_B64 must not be empty."
fi

log_header "Lamaste E2E — Visitor VM Setup"
log_kv "Host IP" "${HOST_IP}"
log_kv "Test Domain" "${TEST_DOMAIN}"

# ---------------------------------------------------------------------------
# Step 1: Install dependencies
# ---------------------------------------------------------------------------
log_step "[1/4] Installing dependencies..."

run_cmd "apt-get update" apt-get update -qq
run_cmd "Install curl, jq, oathtool, ca-certificates, openssl" apt-get install -y -qq curl jq oathtool ca-certificates openssl

log_ok "curl, jq, oathtool installed"

# ---------------------------------------------------------------------------
# Step 2: Configure /etc/hosts
# ---------------------------------------------------------------------------
log_step "[2/4] Configuring /etc/hosts..."

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
# Step 3: Trust the host's E2E test CA
# ---------------------------------------------------------------------------
log_step "[3/4] Installing the E2E test CA into the system trust store..."

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

log_ok "E2E test CA trusted (${E2E_CA_DEST})"

# ---------------------------------------------------------------------------
# Step 4: Verify connectivity
# ---------------------------------------------------------------------------
log_step "[4/4] Verifying connectivity to host..."

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

# The public hostnames on :443 carry certificates from the E2E test CA, so they
# verify without -k (the :9292 panel uses the separate mTLS CA and keeps -k).
AUTH_TLS_RC=0
curl -sS -o /dev/null --max-time 15 "https://auth.${TEST_DOMAIN}/" 2>/dev/null || AUTH_TLS_RC=$?
case "${AUTH_TLS_RC}" in
  0) log_ok "auth.${TEST_DOMAIN} certificate verified against the system trust store" ;;
  35|51|58|60|77|83|90|91)
    log_fatal "TLS verification of auth.${TEST_DOMAIN} failed (curl exit ${AUTH_TLS_RC})" ;;
  *) log_fatal "Could not reach https://auth.${TEST_DOMAIN}/ (curl exit ${AUTH_TLS_RC})" ;;
esac

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
log_header "Visitor VM Setup Summary"
log_kv "Host IP" "${HOST_IP}"
log_kv "Test Domain" "${TEST_DOMAIN}"
log_kv "Dependencies" "curl, jq, oathtool"
log_kv "mTLS certs" "NONE (intentionally — simulates external visitor)"
log_kv "Trusted CA" "E2E test CA (verifies :443 hostnames without -k)"
log_kv "/etc/hosts" "configured for ${TEST_DOMAIN} subdomains"
log_kv "Log file" "$(log_file_path)"
log_ok "The visitor VM is ready for E2E tests."

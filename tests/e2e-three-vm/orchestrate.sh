#!/usr/bin/env bash
# ============================================================================
# Portlama Three-VM E2E Test Orchestrator
# ============================================================================
# End-to-end orchestration script that manages the full lifecycle:
#
#   1. Create three Multipass VMs (host, agent, visitor)
#   2. Pack the installer, transfer to host VM, run it
#   3. Transfer test scripts and run setup on each VM
#   4. Run single-VM E2E tests on the host VM
#   5. Run three-VM E2E tests from macOS
#   6. Print summary and optionally tear down VMs (--cleanup)
#
# VM specs match $4 DigitalOcean droplet: 1 vCPU, 512MB RAM, 10GB disk.
#
# Usage:
#   bash tests/e2e-three-vm/orchestrate.sh [options]
#
# Options:
#   --cleanup        Delete VMs after tests (default: keep for debugging)
#   --skip-create    Skip VM creation (reuse existing VMs)
#   --skip-setup     Skip setup scripts (VMs already provisioned)
#   --skip-single    Skip single-VM E2E tests
#   --skip-multi     Skip multi-VM E2E tests
#   --only-single    Only run single-VM E2E tests
#   --only-multi     Only run multi-VM E2E tests
#   --domain DOMAIN  Test domain (default: test.portlama.local)
#   --vm-cpus N      Override VM CPU count (default: 1)
#   --vm-memory SIZE Override VM memory (default: 512M)
#   --vm-disk SIZE   Override VM disk (default: 10G)
#   --verbose        Enable verbose logging (LOG_LEVEL=2)
#   --quiet          Suppress non-error output (LOG_LEVEL=0)
#   --help           Show this help
# ============================================================================

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------
TEST_DOMAIN="test.portlama.local"
DO_CLEANUP=false
SKIP_CREATE=false
SKIP_SETUP=false
SKIP_SINGLE=false
SKIP_MULTI=false
: "${LOG_LEVEL:=1}"

VM_HOST="portlama-host"
VM_AGENT="portlama-agent"
VM_VISITOR="portlama-visitor"

# VM specs — matching $4 DigitalOcean droplet
VM_CPUS=1
VM_MEMORY="512M"
VM_DISK="10G"

# ---------------------------------------------------------------------------
# Parse arguments
# ---------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --cleanup)      DO_CLEANUP=true; shift ;;
    --skip-create)  SKIP_CREATE=true; shift ;;
    --skip-setup)   SKIP_SETUP=true; shift ;;
    --skip-single)  SKIP_SINGLE=true; shift ;;
    --skip-multi)   SKIP_MULTI=true; shift ;;
    --only-single)  SKIP_MULTI=true; shift ;;
    --only-multi)   SKIP_SINGLE=true; shift ;;
    --domain)       TEST_DOMAIN="$2"; shift 2 ;;
    --vm-cpus)      VM_CPUS="$2"; shift 2 ;;
    --vm-memory)    VM_MEMORY="$2"; shift 2 ;;
    --vm-disk)      VM_DISK="$2"; shift 2 ;;
    --verbose)      LOG_LEVEL=2; shift ;;
    --quiet)        LOG_LEVEL=0; shift ;;
    --help|-h)
      sed -n '2,/^# =====/p' "$0" | head -n -1 | sed 's/^# \?//'
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

# ---------------------------------------------------------------------------
# Source logging library and initialise
# ---------------------------------------------------------------------------
export LOG_LEVEL
LOG_DIR="${REPO_ROOT}/e2e-logs"
export LOG_DIR
rm -rf "${LOG_DIR}"
source "${SCRIPT_DIR}/logging.sh"
init_log "orchestrate"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# Get VM IP address
vm_ip() {
  multipass info "$1" --format json 2>/dev/null | \
    python3 -c "import sys,json; print(json.load(sys.stdin)['info']['$1']['ipv4'][0])" 2>/dev/null || \
    multipass info "$1" 2>/dev/null | grep -oE 'IPv4:\s+[0-9.]+' | awk '{print $2}'
}

# ---------------------------------------------------------------------------
# Cleanup handler
# ---------------------------------------------------------------------------
cleanup_vms() {
  if [ "$DO_CLEANUP" = "true" ]; then
    log_section "Cleaning up VMs"
    for vm in "${VM_HOST}" "${VM_AGENT}" "${VM_VISITOR}"; do
      if multipass info "$vm" &>/dev/null; then
        log_info "Deleting ${vm}..."
        multipass delete "$vm" 2>/dev/null || true
      fi
    done
    multipass purge 2>/dev/null || true
    log_ok "All VMs deleted"
  else
    log_info "VMs kept for debugging. Delete manually with:"
    log_info "  multipass delete ${VM_HOST} ${VM_AGENT} ${VM_VISITOR} && multipass purge"
  fi
}

# ---------------------------------------------------------------------------
# Phase 0: Preflight
# ---------------------------------------------------------------------------
log_section "Preflight checks"

command -v multipass >/dev/null 2>&1 || log_fatal "multipass is not installed"
command -v curl >/dev/null 2>&1 || log_fatal "curl is not installed"
command -v jq >/dev/null 2>&1 || log_fatal "jq is not installed"

log_ok "Required tools available"

log_header "Portlama Three-VM E2E Test Orchestrator"
log_kv "Test Domain" "${TEST_DOMAIN}"
log_kv "VM Specs" "${VM_CPUS} vCPU, ${VM_MEMORY} RAM, ${VM_DISK} disk"
log_kv "Cleanup" "${DO_CLEANUP}"
log_kv "Skip Create" "${SKIP_CREATE}"
log_kv "Skip Setup" "${SKIP_SETUP}"
log_kv "Skip Single" "${SKIP_SINGLE}"
log_kv "Skip Multi" "${SKIP_MULTI}"
log_kv "Log Level" "${LOG_LEVEL}"
log_kv "Log Dir" "${LOG_DIR}"
log_kv "Date" "$(date -u '+%Y-%m-%d %H:%M:%S UTC')"

# ============================================================================
# Phase 1: Create VMs
# ============================================================================
if [ "$SKIP_CREATE" = "false" ]; then
  log_section "Phase 1: Creating VMs"

  # Check for existing VMs and delete them
  for vm in "${VM_HOST}" "${VM_AGENT}" "${VM_VISITOR}"; do
    if multipass info "$vm" &>/dev/null; then
      log_warn "${vm} already exists — deleting"
      multipass delete "$vm" 2>/dev/null || true
      multipass purge 2>/dev/null || true
    fi
  done

  log_info "Launching ${VM_HOST}..."
  multipass launch 24.04 --name "${VM_HOST}" \
    --cpus "${VM_CPUS}" --memory "${VM_MEMORY}" --disk "${VM_DISK}" || \
    log_fatal "Failed to create ${VM_HOST}"
  log_ok "${VM_HOST} created"

  log_info "Launching ${VM_AGENT}..."
  multipass launch 24.04 --name "${VM_AGENT}" \
    --cpus "${VM_CPUS}" --memory "${VM_MEMORY}" --disk "${VM_DISK}" || \
    log_fatal "Failed to create ${VM_AGENT}"
  log_ok "${VM_AGENT} created"

  log_info "Launching ${VM_VISITOR}..."
  multipass launch 24.04 --name "${VM_VISITOR}" \
    --cpus "${VM_CPUS}" --memory "${VM_MEMORY}" --disk "${VM_DISK}" || \
    log_fatal "Failed to create ${VM_VISITOR}"
  log_ok "${VM_VISITOR} created"
else
  log_section "Phase 1: Skipping VM creation (--skip-create)"
fi

# Get IPs
HOST_IP=$(vm_ip "${VM_HOST}")
AGENT_IP=$(vm_ip "${VM_AGENT}")
VISITOR_IP=$(vm_ip "${VM_VISITOR}")

[ -n "$HOST_IP" ] || log_fatal "Could not determine ${VM_HOST} IP"
[ -n "$AGENT_IP" ] || log_fatal "Could not determine ${VM_AGENT} IP"
[ -n "$VISITOR_IP" ] || log_fatal "Could not determine ${VM_VISITOR} IP"

log_info "Host IP:    ${HOST_IP}"
log_info "Agent IP:   ${AGENT_IP}"
log_info "Visitor IP: ${VISITOR_IP}"

# ============================================================================
# Phase 2: Install Portlama and set up VMs
# ============================================================================
if [ "$SKIP_SETUP" = "false" ]; then
  log_section "Phase 2: Setting up VMs"

  # -----------------------------------------------------------------------
  # 2a: Build installer tarball locally
  # -----------------------------------------------------------------------
  log_step "Packing create-portlama tarball..."
  TARBALL=$(cd "${REPO_ROOT}/packages/create-portlama" && npm pack --pack-destination /tmp 2>/dev/null | tail -1)
  TARBALL="/tmp/${TARBALL}"
  [ -f "$TARBALL" ] || log_fatal "npm pack failed — tarball not found"
  log_ok "Tarball ready: ${TARBALL}"

  # -----------------------------------------------------------------------
  # 2b: Install npm on host VM and run the installer
  # -----------------------------------------------------------------------
  log_step "Installing npm on ${VM_HOST}..."
  run_cmd "apt install npm on ${VM_HOST}" \
    multipass exec "${VM_HOST}" -- sudo apt-get install -y npm || \
    log_fatal "npm installation failed on ${VM_HOST}"

  log_step "Transferring installer tarball to ${VM_HOST}..."
  multipass transfer "${TARBALL}" "${VM_HOST}:/tmp/create-portlama.tgz"
  log_ok "Tarball transferred"

  log_step "Installing create-portlama from tarball on ${VM_HOST}..."
  run_cmd "npm install -g tarball on ${VM_HOST}" \
    multipass exec "${VM_HOST}" -- sudo npm install -g /tmp/create-portlama.tgz || \
    log_fatal "npm install -g failed on ${VM_HOST}"

  log_step "Running create-portlama on ${VM_HOST}..."
  set +e
  multipass exec "${VM_HOST}" -- sudo \
    create-portlama --dev --skip-harden --yes
  INSTALLER_RC=$?
  set -e
  if [ "${INSTALLER_RC}" -ne 0 ]; then
    log_fatal "create-portlama failed with exit code ${INSTALLER_RC}"
  fi
  log_ok "Portlama installed on ${VM_HOST}"

  # -----------------------------------------------------------------------
  # 2c: Transfer test scripts to VMs and run setup scripts
  # -----------------------------------------------------------------------
  log_step "Transferring test scripts to VMs..."
  for vm in "${VM_HOST}" "${VM_AGENT}" "${VM_VISITOR}"; do
    multipass exec "$vm" -- mkdir -p /tmp/e2e
    for f in "${SCRIPT_DIR}"/*.sh; do
      multipass transfer "$f" "${vm}:/tmp/e2e/$(basename "$f")"
    done
  done
  # Transfer VM-side API helper scripts used by three-VM tests
  for f in "${REPO_ROOT}"/tests/e2e-three-vm/vm-api-helper.sh "${REPO_ROOT}"/tests/e2e-three-vm/vm-api-status-helper.sh; do
    if [ -f "$f" ]; then
      multipass transfer "$f" "${VM_HOST}:/tmp/$(basename "$f")"
      multipass exec "${VM_HOST}" -- sudo chmod +x "/tmp/$(basename "$f")"
    fi
  done
  log_ok "Test scripts transferred to all VMs"

  log_step "Running setup-host.sh on ${VM_HOST}..."
  set +e
  multipass exec "${VM_HOST}" -- sudo \
    env "LOG_LEVEL=${LOG_LEVEL}" \
    bash /tmp/e2e/setup-host.sh "${HOST_IP}" "${TEST_DOMAIN}"
  SETUP_HOST_RC=$?
  set -e
  multipass exec "${VM_HOST}" -- sudo chmod 644 /tmp/setup-host.md 2>/dev/null || true
  multipass transfer "${VM_HOST}:/tmp/setup-host.md" "${LOG_DIR}/setup-host.md" 2>/dev/null || true
  if [ "${SETUP_HOST_RC}" -ne 0 ]; then
    log_fatal "setup-host.sh failed with exit code ${SETUP_HOST_RC} (log: ${LOG_DIR}/setup-host.md)"
  fi
  log_ok "Host VM setup complete"

  # -----------------------------------------------------------------------
  # 2d: Extract credentials from host
  # -----------------------------------------------------------------------
  log_info "Extracting credentials from ${VM_HOST}..."
  CREDS_JSON=$(multipass exec "${VM_HOST}" -- sudo cat /tmp/portlama-test-credentials.json 2>/dev/null || echo "{}")
  AGENT_P12_PASSWORD=$(echo "$CREDS_JSON" | jq -r '.agentP12Password // empty')
  [ -n "$AGENT_P12_PASSWORD" ] || log_fatal "Could not extract agentP12Password from credentials"
  log_ok "Credentials extracted (agent P12 password obtained)"

  # -----------------------------------------------------------------------
  # 2e: Transfer agent P12 to agent VM and run setup-agent.sh
  # -----------------------------------------------------------------------
  log_info "Transferring agent P12 to ${VM_AGENT}..."
  # Copy P12 to a readable location — multipass transfer runs as the ubuntu user
  multipass exec "${VM_HOST}" -- sudo cp /etc/portlama/pki/agents/test-agent/client.p12 /tmp/agent-export.p12
  multipass exec "${VM_HOST}" -- sudo chmod 644 /tmp/agent-export.p12
  LOCAL_TMP_P12=$(mktemp /tmp/portlama-agent-XXXXXX)
  multipass transfer "${VM_HOST}:/tmp/agent-export.p12" "${LOCAL_TMP_P12}" || \
    log_fatal "Failed to transfer P12 from host"
  multipass transfer "${LOCAL_TMP_P12}" "${VM_AGENT}:/tmp/agent.p12" || \
    log_fatal "Failed to transfer P12 to agent"
  rm -f "${LOCAL_TMP_P12}"
  log_ok "Agent P12 transferred"

  log_step "Running setup-agent.sh on ${VM_AGENT}..."
  set +e
  multipass exec "${VM_AGENT}" -- sudo \
    env "LOG_LEVEL=${LOG_LEVEL}" \
    bash /tmp/e2e/setup-agent.sh "${HOST_IP}" "${TEST_DOMAIN}" "${AGENT_P12_PASSWORD}"
  SETUP_AGENT_RC=$?
  set -e
  multipass exec "${VM_AGENT}" -- sudo chmod 644 /tmp/setup-agent.md 2>/dev/null || true
  multipass transfer "${VM_AGENT}:/tmp/setup-agent.md" "${LOG_DIR}/setup-agent.md" 2>/dev/null || true
  if [ "${SETUP_AGENT_RC}" -ne 0 ]; then
    log_fatal "setup-agent.sh failed with exit code ${SETUP_AGENT_RC} (log: ${LOG_DIR}/setup-agent.md)"
  fi
  log_ok "Agent VM setup complete"

  # -----------------------------------------------------------------------
  # 2f: Run setup-visitor.sh on visitor VM
  # -----------------------------------------------------------------------
  log_step "Running setup-visitor.sh on ${VM_VISITOR}..."
  set +e
  multipass exec "${VM_VISITOR}" -- sudo \
    env "LOG_LEVEL=${LOG_LEVEL}" \
    bash /tmp/e2e/setup-visitor.sh "${HOST_IP}" "${TEST_DOMAIN}"
  SETUP_VISITOR_RC=$?
  set -e
  multipass exec "${VM_VISITOR}" -- sudo chmod 644 /tmp/setup-visitor.md 2>/dev/null || true
  multipass transfer "${VM_VISITOR}:/tmp/setup-visitor.md" "${LOG_DIR}/setup-visitor.md" 2>/dev/null || true
  if [ "${SETUP_VISITOR_RC}" -ne 0 ]; then
    log_fatal "setup-visitor.sh failed with exit code ${SETUP_VISITOR_RC} (log: ${LOG_DIR}/setup-visitor.md)"
  fi
  log_ok "Visitor VM setup complete"

else
  log_section "Phase 2: Skipping setup (--skip-setup)"

  # Still need credentials for the test runner
  CREDS_JSON=$(multipass exec "${VM_HOST}" -- sudo cat /tmp/portlama-test-credentials.json 2>/dev/null || echo "{}")
  AGENT_P12_PASSWORD=$(echo "$CREDS_JSON" | jq -r '.agentP12Password // empty')
  [ -n "$AGENT_P12_PASSWORD" ] || log_fatal "Could not extract agentP12Password — was setup run?"
fi

# ============================================================================
# Phase 3: Run single-VM E2E tests (on host VM)
# ============================================================================
SINGLE_VM_RESULT=0
if [ "$SKIP_SINGLE" = "false" ]; then
  log_section "Phase 3: Running single-VM E2E tests on ${VM_HOST}"

  # Transfer single-VM E2E test files to host VM
  log_info "Transferring single-VM E2E test scripts to ${VM_HOST}..."
  multipass exec "${VM_HOST}" -- mkdir -p /tmp/e2e-single
  for f in "${REPO_ROOT}"/tests/e2e/*.sh; do
    multipass transfer "$f" "${VM_HOST}:/tmp/e2e-single/$(basename "$f")"
  done
  log_ok "Single-VM test scripts transferred"

  log_info "Running tests/e2e/run-all.sh on ${VM_HOST}..."
  set +e
  multipass exec "${VM_HOST}" -- sudo \
    env "LOG_LEVEL=${LOG_LEVEL}" "LOG_DIR=/tmp" "SKIP_DNS_TESTS=1" \
    bash /tmp/e2e-single/run-all.sh 2>&1 | \
    sed 's/\x1b\[[0-9;]*[a-zA-Z]//g' | \
    tee >(
      {
        echo "# Single-VM E2E Test Results"
        echo ""
        echo "> Run at \`$(date -u '+%Y-%m-%d %H:%M:%S UTC')\`"
        echo ""
        cat
      } > "${LOG_DIR}/single-vm-e2e.md"
    )
  SINGLE_VM_RC=${PIPESTATUS[0]}
  set -e

  # Collect per-test Markdown logs from host VM
  log_info "Collecting per-test log files from ${VM_HOST}..."
  REMOTE_LOGS=$(multipass exec "${VM_HOST}" -- sudo bash -c 'ls /tmp/test-*.md 2>/dev/null || true')
  for remote_log in ${REMOTE_LOGS}; do
    local_name="$(basename "${remote_log}")"
    multipass exec "${VM_HOST}" -- sudo chmod 644 "${remote_log}" 2>/dev/null || true
    multipass transfer "${VM_HOST}:${remote_log}" "${LOG_DIR}/single-${local_name}" 2>/dev/null || true
  done

  if [ "${SINGLE_VM_RC}" -eq 0 ]; then
    SINGLE_VM_RESULT=0
    log_ok "Single-VM E2E tests passed"
  else
    SINGLE_VM_RESULT=1
    log_fail "Single-VM E2E tests had failures"
  fi
else
  log_section "Phase 3: Skipping single-VM E2E tests (--skip-single)"
fi

# ============================================================================
# Phase 4: Run three-VM E2E tests (from macOS)
# ============================================================================
MULTI_VM_RESULT=0
if [ "$SKIP_MULTI" = "false" ]; then
  log_section "Phase 4: Running three-VM E2E tests from macOS"

  # The test user was created by setup-host.sh
  TEST_USER="testuser"
  TEST_USER_PASSWORD="TestPassword-E2E-123"
  # Admin password is not persisted by setup-host.sh (cleared after provisioning).
  # Use a placeholder — admin operations use mTLS, not password auth.
  ADMIN_PASSWORD="not-used-mTLS-only"

  log_info "Environment:"
  log_info "  HOST_IP=${HOST_IP}"
  log_info "  AGENT_IP=${AGENT_IP}"
  log_info "  VISITOR_IP=${VISITOR_IP}"
  log_info "  TEST_DOMAIN=${TEST_DOMAIN}"
  log_info "  TEST_USER=${TEST_USER}"

  set +e
  HOST_IP="${HOST_IP}" \
     AGENT_IP="${AGENT_IP}" \
     VISITOR_IP="${VISITOR_IP}" \
     TEST_DOMAIN="${TEST_DOMAIN}" \
     ADMIN_PASSWORD="${ADMIN_PASSWORD}" \
     AGENT_P12_PASSWORD="${AGENT_P12_PASSWORD}" \
     TEST_USER="${TEST_USER}" \
     TEST_USER_PASSWORD="${TEST_USER_PASSWORD}" \
     LOG_LEVEL="${LOG_LEVEL}" \
     LOG_DIR="${LOG_DIR}" \
     bash "${SCRIPT_DIR}/run-all.sh" 2>&1 | \
     sed 's/\x1b\[[0-9;]*[a-zA-Z]//g'
  MULTI_VM_RC=${PIPESTATUS[0]}
  set -e

  # The logging library in run-all.sh produces a proper Markdown log at $LOG_DIR/run-all.md
  if [ -f "${LOG_DIR}/run-all.md" ]; then
    mv "${LOG_DIR}/run-all.md" "${LOG_DIR}/three-vm-e2e.md"
  fi

  if [ "${MULTI_VM_RC}" -eq 0 ]; then
    MULTI_VM_RESULT=0
    log_ok "Three-VM E2E tests passed"
  else
    MULTI_VM_RESULT=1
    log_fail "Three-VM E2E tests had failures"
  fi
else
  log_section "Phase 4: Skipping three-VM E2E tests (--skip-multi)"
fi

# ============================================================================
# Phase 5: Summary and cleanup
# ============================================================================

log_header "Test Orchestration Summary"
log_kv "VMs" "${VM_HOST} (${HOST_IP}), ${VM_AGENT} (${AGENT_IP}), ${VM_VISITOR} (${VISITOR_IP})"
log_kv "Test Domain" "${TEST_DOMAIN}"

if [ "$SKIP_SINGLE" = "false" ]; then
  if [ "$SINGLE_VM_RESULT" -eq 0 ]; then
    log_ok "Single-VM E2E: PASSED"
  else
    log_fail "Single-VM E2E: FAILED"
  fi
else
  log_skip "Single-VM E2E: SKIPPED"
fi

if [ "$SKIP_MULTI" = "false" ]; then
  if [ "$MULTI_VM_RESULT" -eq 0 ]; then
    log_ok "Three-VM E2E: PASSED"
  else
    log_fail "Three-VM E2E: FAILED"
  fi
else
  log_skip "Three-VM E2E: SKIPPED"
fi

# Print paths to all collected log files
log_section "Log files"
log_kv "Orchestrator" "$(log_file_path)"
for logfile in "${LOG_DIR}"/*.md; do
  [ -f "${logfile}" ] || continue
  [ "${logfile}" = "$(log_file_path)" ] && continue
  local_base="$(basename "${logfile}")"
  log_kv "${local_base%.*}" "${logfile}"
done

# Cleanup
cleanup_vms

# Exit with failure if any suite failed
TOTAL_RESULT=$((SINGLE_VM_RESULT + MULTI_VM_RESULT))
if [ "$TOTAL_RESULT" -gt 0 ]; then
  log_fail "OVERALL: FAILED"
  exit 1
else
  log_ok "OVERALL: PASSED"
  exit 0
fi

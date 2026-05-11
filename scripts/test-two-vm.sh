#!/usr/bin/env bash
set -euo pipefail

HOST_VM="lamaste-host"
AGENT_VM="lamaste-agent"
VM_MEMORY="512M"
VM_DISK="5G"
VM_IMAGE="24.04"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MOUNT_TARGET="/mnt/lamaste"
TEST_DOMAIN="test.lamaste.local"
CREDENTIALS_FILE="/tmp/lamalibre-lamaste-test-credentials.json"

red()    { printf '\033[0;31m%s\033[0m\n' "$*"; }
green()  { printf '\033[0;32m%s\033[0m\n' "$*"; }
cyan()   { printf '\033[0;36m%s\033[0m\n' "$*"; }
yellow() { printf '\033[0;33m%s\033[0m\n' "$*"; }

usage() {
  cat <<EOF
Usage: $(basename "$0") <command>

Commands:
  create        Create both VMs (host + agent), install Node.js, mount repo
  destroy       Destroy both VMs
  reset         Destroy and recreate both VMs (clean slate)
  setup         Run setup-host.sh then setup-agent.sh, transfer P12 cert
  test          Run the two-VM E2E test suite
  shell-host    SSH into the host VM
  shell-agent   SSH into the agent VM
  ip            Print both VM IPs
  status        Show both VM states
  full          Shortcut: create + setup + test

Examples:
  $(basename "$0") create       # first time setup
  $(basename "$0") setup        # provision host and agent
  $(basename "$0") test         # run E2E tests
  $(basename "$0") full         # do everything from scratch
  $(basename "$0") shell-host   # get into the host VM
EOF
}

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

check_multipass() {
  if ! command -v multipass &>/dev/null; then
    red "Multipass not found. Install it with:"
    echo "  brew install multipass"
    exit 1
  fi
}

vm_exists() {
  multipass list --format csv 2>/dev/null | grep -q "^${1},"
}

vm_running() {
  multipass list --format csv 2>/dev/null | grep -q "^${1},Running"
}

get_vm_ip() {
  multipass info "$1" --format csv 2>/dev/null | tail -1 | cut -d',' -f3
}

require_vm_running() {
  local name="$1"
  if ! vm_running "$name"; then
    red "VM '${name}' is not running. Use 'create' first."
    exit 1
  fi
}

require_both_running() {
  require_vm_running "$HOST_VM"
  require_vm_running "$AGENT_VM"
}

create_single_vm() {
  local name="$1"

  if vm_exists "$name"; then
    red "VM '${name}' already exists. Use 'reset' to recreate or 'destroy' first."
    exit 1
  fi

  green "Creating VM '${name}' (Ubuntu ${VM_IMAGE}, ${VM_MEMORY} RAM, ${VM_DISK} disk)..."
  multipass launch "$VM_IMAGE" \
    --name "$name" \
    --memory "$VM_MEMORY" \
    --disk "$VM_DISK"

  green "Installing Node.js 20 LTS on '${name}'..."
  multipass exec "$name" -- bash -c '
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash - &&
    sudo apt-get install -y nodejs
  '

  green "Mounting repo into '${name}' at ${MOUNT_TARGET}..."
  multipass mount "$REPO_ROOT" "${name}:${MOUNT_TARGET}"
}

destroy_single_vm() {
  local name="$1"
  if vm_exists "$name"; then
    green "Destroying VM '${name}'..."
    multipass delete "$name" --purge
  else
    echo "VM '${name}' does not exist."
  fi
}

read_credentials() {
  local json
  json=$(multipass exec "$HOST_VM" -- sudo cat "$CREDENTIALS_FILE" 2>/dev/null) || {
    red "Could not read credentials from host VM at ${CREDENTIALS_FILE}."
    red "Has setup been run? (./scripts/test-two-vm.sh setup)"
    exit 1
  }

  ADMIN_PASSWORD=$(echo "$json" | grep -o '"admin_password"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*: *"//;s/"$//')
  AGENT_P12_PASSWORD=$(echo "$json" | grep -o '"agent_p12_password"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*: *"//;s/"$//')

  if [[ -z "${ADMIN_PASSWORD:-}" || -z "${AGENT_P12_PASSWORD:-}" ]]; then
    red "Credentials file is missing required fields (admin_password, agent_p12_password)."
    exit 1
  fi
}

# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------

cmd_create() {
  check_multipass

  create_single_vm "$HOST_VM"
  create_single_vm "$AGENT_VM"

  local host_ip agent_ip
  host_ip=$(get_vm_ip "$HOST_VM")
  agent_ip=$(get_vm_ip "$AGENT_VM")

  green "Both VMs ready!"
  echo ""
  cyan "  Host VM  (${HOST_VM}):  ${host_ip}"
  cyan "  Agent VM (${AGENT_VM}): ${agent_ip}"
  cyan "  Repo at: ${MOUNT_TARGET} (inside both VMs)"
  echo ""
  echo "Next step:"
  echo "  ./scripts/test-two-vm.sh setup"
}

cmd_destroy() {
  check_multipass
  destroy_single_vm "$HOST_VM"
  destroy_single_vm "$AGENT_VM"
  green "Done."
}

cmd_reset() {
  check_multipass
  green "Resetting both VMs..."
  destroy_single_vm "$HOST_VM"
  destroy_single_vm "$AGENT_VM"
  cmd_create
}

cmd_setup() {
  check_multipass
  require_both_running

  local host_ip
  host_ip=$(get_vm_ip "$HOST_VM")

  # --- Step 1: Run setup-host.sh on host VM ---
  green "Running setup-host.sh on '${HOST_VM}' (IP: ${host_ip})..."
  multipass exec "$HOST_VM" -- sudo bash \
    "${MOUNT_TARGET}/tests/e2e-two-vm/setup-host.sh" "$host_ip" "$TEST_DOMAIN"

  # --- Step 2: Read credentials written by setup-host.sh ---
  green "Reading credentials from host VM..."
  read_credentials
  cyan "  Admin password:     ${ADMIN_PASSWORD}"
  cyan "  Agent P12 password: ${AGENT_P12_PASSWORD}"

  # --- Step 3: Transfer agent P12 from host to agent ---
  green "Transferring agent P12 certificate to '${AGENT_VM}'..."
  multipass transfer \
    "${HOST_VM}:/etc/lamalibre/lamaste/pki/agents/test-agent/client.p12" \
    /tmp/lamalibre-lamaste-agent.p12
  multipass transfer \
    /tmp/lamalibre-lamaste-agent.p12 \
    "${AGENT_VM}:/tmp/agent.p12"
  rm -f /tmp/lamalibre-lamaste-agent.p12

  # --- Step 4: Run setup-agent.sh on agent VM ---
  green "Running setup-agent.sh on '${AGENT_VM}'..."
  multipass exec "$AGENT_VM" -- sudo bash \
    "${MOUNT_TARGET}/tests/e2e-two-vm/setup-agent.sh" \
    "$host_ip" "$TEST_DOMAIN" "$AGENT_P12_PASSWORD"

  green "Setup complete!"
  echo ""
  echo "Next step:"
  echo "  ./scripts/test-two-vm.sh test"
}

cmd_test() {
  check_multipass
  require_both_running

  local host_ip agent_ip
  host_ip=$(get_vm_ip "$HOST_VM")
  agent_ip=$(get_vm_ip "$AGENT_VM")

  green "Reading credentials from host VM..."
  read_credentials

  green "Running two-VM E2E test suite on '${HOST_VM}'..."
  multipass exec "$HOST_VM" -- sudo bash -c \
    "HOST_IP=${host_ip} AGENT_IP=${agent_ip} ADMIN_PASSWORD=${ADMIN_PASSWORD} AGENT_P12_PASSWORD=${AGENT_P12_PASSWORD} TEST_DOMAIN=${TEST_DOMAIN} bash ${MOUNT_TARGET}/tests/e2e-two-vm/run-all.sh"
}

cmd_shell_host() {
  check_multipass
  require_vm_running "$HOST_VM"
  multipass shell "$HOST_VM"
}

cmd_shell_agent() {
  check_multipass
  require_vm_running "$AGENT_VM"
  multipass shell "$AGENT_VM"
}

cmd_ip() {
  check_multipass
  require_both_running

  local host_ip agent_ip
  host_ip=$(get_vm_ip "$HOST_VM")
  agent_ip=$(get_vm_ip "$AGENT_VM")

  cyan "Host  (${HOST_VM}):  ${host_ip}"
  cyan "Agent (${AGENT_VM}): ${agent_ip}"
}

cmd_status() {
  check_multipass

  for vm in "$HOST_VM" "$AGENT_VM"; do
    if vm_exists "$vm"; then
      multipass info "$vm"
      echo ""
    else
      echo "VM '${vm}' does not exist."
    fi
  done
}

cmd_full() {
  green "=== Full two-VM E2E run ==="
  echo ""
  cmd_create
  echo ""
  cmd_setup
  echo ""
  cmd_test
  echo ""
  green "=== Full run complete ==="
}

# ---------------------------------------------------------------------------
# Dispatch
# ---------------------------------------------------------------------------

case "${1:-}" in
  create)      cmd_create      ;;
  destroy)     cmd_destroy     ;;
  reset)       cmd_reset       ;;
  setup)       cmd_setup       ;;
  test)        cmd_test        ;;
  shell-host)  cmd_shell_host  ;;
  shell-agent) cmd_shell_agent ;;
  ip)          cmd_ip          ;;
  status)      cmd_status      ;;
  full)        cmd_full        ;;
  *)           usage           ;;
esac

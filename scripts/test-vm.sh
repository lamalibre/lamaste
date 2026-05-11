#!/usr/bin/env bash
set -euo pipefail

VM_NAME="lamaste-test"
VM_MEMORY="512M"
VM_DISK="5G"
VM_IMAGE="24.04"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MOUNT_TARGET="/mnt/lamaste"

red()    { printf '\033[0;31m%s\033[0m\n' "$*"; }
green()  { printf '\033[0;32m%s\033[0m\n' "$*"; }
cyan()   { printf '\033[0;36m%s\033[0m\n' "$*"; }

usage() {
  cat <<EOF
Usage: $(basename "$0") <command>

Commands:
  create    Create a fresh Ubuntu ${VM_IMAGE} VM and mount the repo
  shell     SSH into the VM
  ip        Print the VM's IP address
  reset     Destroy and recreate the VM (clean slate)
  destroy   Remove the VM entirely
  status    Show VM state
  install   Run the Lamaste installer inside the VM
  test      Run the E2E test suite inside the VM
  cert      Copy client.p12 from VM to ~/Downloads/
  logs      Show panel service logs from inside the VM

Examples:
  $(basename "$0") create     # first time setup
  $(basename "$0") shell      # get into the VM
  $(basename "$0") reset      # start fresh
EOF
}

check_multipass() {
  if ! command -v multipass &>/dev/null; then
    red "Multipass not found. Install it with:"
    echo "  brew install multipass"
    exit 1
  fi
}

vm_exists() {
  multipass list --format csv 2>/dev/null | grep -q "^${VM_NAME},"
}

vm_running() {
  multipass list --format csv 2>/dev/null | grep -q "^${VM_NAME},Running"
}

get_ip() {
  multipass info "$VM_NAME" --format csv 2>/dev/null | tail -1 | cut -d',' -f3
}

cmd_create() {
  check_multipass

  if vm_exists; then
    red "VM '${VM_NAME}' already exists. Use 'reset' to recreate or 'destroy' first."
    exit 1
  fi

  green "Creating Ubuntu ${VM_IMAGE} VM (${VM_MEMORY} RAM, ${VM_DISK} disk)..."
  multipass launch "$VM_IMAGE" \
    --name "$VM_NAME" \
    --memory "$VM_MEMORY" \
    --disk "$VM_DISK"

  green "Installing Node.js 20 LTS..."
  multipass exec "$VM_NAME" -- bash -c '
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash - &&
    sudo apt-get install -y nodejs
  '

  green "Mounting repo into VM at ${MOUNT_TARGET}..."
  multipass mount "$REPO_ROOT" "${VM_NAME}:${MOUNT_TARGET}"

  local ip
  ip=$(get_ip)

  green "VM ready!"
  echo ""
  cyan "  VM IP:    ${ip}"
  cyan "  Shell:    ./scripts/test-vm.sh shell"
  cyan "  Repo at:  ${MOUNT_TARGET} (inside VM)"
  echo ""
  echo "To run the installer:"
  echo "  ./scripts/test-vm.sh shell"
  echo "  cd ${MOUNT_TARGET}/packages/provisioners/server"
  echo "  sudo node bin/create-lamaste.js --dev --skip-harden"
  echo ""
  echo "Flags:"
  echo "  --dev           Accept private IPs (required for Multipass VMs)"
  echo "  --skip-harden   Skip UFW/fail2ban/SSH hardening (avoids blocking VM access)"
}

cmd_shell() {
  check_multipass
  if ! vm_running; then
    red "VM '${VM_NAME}' is not running. Use 'create' first."
    exit 1
  fi
  multipass shell "$VM_NAME"
}

cmd_ip() {
  check_multipass
  if ! vm_running; then
    red "VM '${VM_NAME}' is not running."
    exit 1
  fi
  get_ip
}

cmd_reset() {
  check_multipass
  green "Destroying VM '${VM_NAME}'..."
  if vm_exists; then
    multipass delete "$VM_NAME" --purge
  fi
  cmd_create
}

cmd_destroy() {
  check_multipass
  if vm_exists; then
    green "Destroying VM '${VM_NAME}'..."
    multipass delete "$VM_NAME" --purge
    green "Done."
  else
    echo "VM '${VM_NAME}' does not exist."
  fi
}

cmd_status() {
  check_multipass
  if vm_exists; then
    multipass info "$VM_NAME"
  else
    echo "VM '${VM_NAME}' does not exist."
  fi
}

cmd_cert() {
  check_multipass
  if ! vm_running; then
    red "VM '${VM_NAME}' is not running."
    exit 1
  fi

  local dest="$HOME/Downloads/lamaste-client.p12"
  green "Copying client.p12 to ${dest}..."
  multipass exec "$VM_NAME" -- sudo cat /etc/lamalibre/lamaste/pki/client.p12 > "$dest"

  local password
  password=$(multipass exec "$VM_NAME" -- sudo cat /etc/lamalibre/lamaste/pki/.p12-password 2>/dev/null || echo "(not found)")

  green "Certificate saved to: ${dest}"
  cyan "P12 password: ${password}"
  echo ""
  echo "Import into macOS Keychain:"
  echo "  open ${dest}"
  echo "  (enter the password above, then set to Always Trust)"
}

cmd_install() {
  check_multipass
  if ! vm_running; then
    red "VM '${VM_NAME}' is not running."
    exit 1
  fi

  green "Running Lamaste installer inside VM..."
  multipass exec "$VM_NAME" -- sudo bash -c \
    "cd ${MOUNT_TARGET}/packages/provisioners/server && node bin/create-lamaste.js --dev --skip-harden"
}

cmd_test() {
  check_multipass
  if ! vm_running; then
    red "VM '${VM_NAME}' is not running."
    exit 1
  fi

  local skip_dns="${SKIP_DNS_TESTS:-1}"
  green "Running E2E test suite inside VM..."
  multipass exec "$VM_NAME" -- sudo bash -c \
    "SKIP_DNS_TESTS=${skip_dns} bash ${MOUNT_TARGET}/tests/e2e/run-all.sh"
}

cmd_logs() {
  check_multipass
  if ! vm_running; then
    red "VM '${VM_NAME}' is not running."
    exit 1
  fi
  multipass exec "$VM_NAME" -- sudo journalctl -u lamalibre-lamaste-serverd -f --no-pager
}

case "${1:-}" in
  create)  cmd_create  ;;
  shell)   cmd_shell   ;;
  ip)      cmd_ip      ;;
  reset)   cmd_reset   ;;
  destroy) cmd_destroy ;;
  status)  cmd_status  ;;
  install) cmd_install ;;
  test)    cmd_test    ;;
  cert)    cmd_cert    ;;
  logs)    cmd_logs    ;;
  *)       usage       ;;
esac

#!/usr/bin/env bash
# ============================================================================
# Portlama Three-VM E2E — Master Test Runner
# ============================================================================
# Runs all three-VM E2E test scripts in sequence and reports a summary.
# These tests run on the developer machine (macOS) and use `multipass exec`
# to interact with the host and agent VMs.
#
# Usage:
#   bash tests/e2e-three-vm/run-all.sh
#
# Required environment variables:
#   HOST_IP            — IP address of the host VM
#   AGENT_IP           — IP address of the agent VM
#   TEST_DOMAIN        — Domain configured for testing (e.g., test.portlama.local)
#   ADMIN_PASSWORD     — Admin password for Authelia
#   AGENT_P12_PASSWORD — Password for the agent .p12 certificate
#   TEST_USER          — Authelia test user username
#   TEST_USER_PASSWORD — Authelia test user password
# ============================================================================

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/logging.sh"

: "${LOG_DIR:=/tmp}"
init_log "run-all"

# ---------------------------------------------------------------------------
# Validate required environment variables
# ---------------------------------------------------------------------------

REQUIRED_VARS=(
  HOST_IP
  AGENT_IP
  VISITOR_IP
  TEST_DOMAIN
  ADMIN_PASSWORD
  AGENT_P12_PASSWORD
  TEST_USER
  TEST_USER_PASSWORD
)

MISSING=()
for var in "${REQUIRED_VARS[@]}"; do
  if [ -z "${!var:-}" ]; then
    MISSING+=("$var")
  fi
done

if [ "${#MISSING[@]}" -gt 0 ]; then
  echo "Error: missing required environment variables: ${MISSING[*]}"
  echo ""
  echo "Example:"
  echo "  HOST_IP=10.0.0.10 AGENT_IP=10.0.0.11 VISITOR_IP=10.0.0.12 TEST_DOMAIN=test.portlama.local \\"
  echo "  ADMIN_PASSWORD=secret AGENT_P12_PASSWORD=certsecret \\"
  echo "  TEST_USER=testuser TEST_USER_PASSWORD=TestPassword123!! \\"
  echo "  bash tests/e2e-three-vm/run-all.sh"
  exit 2
fi

log_header "Portlama Three-VM End-to-End Test Suite"
log_kv "HOST_IP" "${HOST_IP}"
log_kv "AGENT_IP" "${AGENT_IP}"
log_kv "VISITOR_IP" "${VISITOR_IP}"
log_kv "TEST_DOMAIN" "${TEST_DOMAIN}"
log_kv "TEST_USER" "${TEST_USER}"
log_kv "Date" "$(date -u '+%Y-%m-%d %H:%M:%S UTC')"
log_kv "Log file" "$(log_file_path)"
echo ""

# ---------------------------------------------------------------------------
# Pre-test: Clear Authelia authentication logs to prevent cross-run bans
# ---------------------------------------------------------------------------
# Authelia's regulation (rate limiting) bans users after repeated failed attempts.
# Failed attempts from previous test runs accumulate in the SQLite database and
# can cause spurious "Authentication failed, please retry later" errors.
log_step "Clearing Authelia regulation state..."
multipass exec portlama-host -- sudo bash -c 'systemctl stop authelia; sqlite3 /etc/authelia/db.sqlite3 "DELETE FROM authentication_logs; DELETE FROM totp_history;" 2>/dev/null; systemctl start authelia' 2>/dev/null || true
sleep 3
log_ok "Authelia regulation state cleared"

# ---------------------------------------------------------------------------
# Test scripts in execution order
# ---------------------------------------------------------------------------

TEST_SCRIPTS=(
  "01-onboarding-complete.sh"
  "02-tunnel-traffic.sh"
  "03-tunnel-toggle-traffic.sh"
  "04-authelia-auth.sh"
  "05-admin-journey.sh"
  "06-tunnel-user-journey.sh"
  "07-site-visitor-journey.sh"
  "08-invitation-journey.sh"
  "09-agent-site-deploy.sh"
  "11-plugin-lifecycle.sh"
  "12-enrollment-lifecycle.sh"
  "13-panel-2fa.sh"
)

PASSED=0
FAILED=0
SKIPPED=0
RESULTS=()

for script in "${TEST_SCRIPTS[@]}"; do
  SCRIPT_PATH="${SCRIPT_DIR}/${script}"

  if [ ! -f "$SCRIPT_PATH" ]; then
    log_skip "${script} — file not found"
    RESULTS+=("SKIP:${script}")
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  log_step "Running: ${script}"

  # Clear Authelia regulation state between tests:
  # 1. Stop Authelia to release the SQLite database lock
  # 2. Delete authentication_logs from SQLite (persistent storage)
  # 3. Start Authelia fresh with clean regulation state
  # Both steps are necessary: the DB must be cleared while Authelia is stopped
  # to avoid lock conflicts, and Authelia must be restarted to clear its
  # in-memory regulation cache.
  # Combined into a single multipass exec to avoid race conditions between steps.
  multipass exec portlama-host -- sudo bash -c 'systemctl stop authelia; sqlite3 /etc/authelia/db.sqlite3 "DELETE FROM authentication_logs; DELETE FROM totp_history;" 2>/dev/null; systemctl start authelia' 2>/dev/null || true
  sleep 3

  export _LOG_FILE="${LOG_DIR}/test-${script%.sh}.md"
  : > "${_LOG_FILE}"

  bash "$SCRIPT_PATH"
  rc=$?

  if [ "$rc" -eq 0 ]; then
    RESULTS+=("PASS:${script}")
    PASSED=$((PASSED + 1))
  else
    RESULTS+=("FAIL:${script}")
    FAILED=$((FAILED + 1))
  fi
done

_LOG_FILE=""

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

TOTAL=$((PASSED + FAILED + SKIPPED))

log_header "Test Suite Summary"

for result in "${RESULTS[@]}"; do
  STATUS="${result%%:*}"
  NAME="${result#*:}"

  case "$STATUS" in
    PASS) log_ok "${NAME}" ;;
    FAIL) log_fail "${NAME}" ;;
    SKIP) log_skip "${NAME}" ;;
  esac
done

echo ""
log_kv "Total" "${TOTAL} tests"
log_kv "Passed" "${PASSED}"
log_kv "Failed" "${FAILED}"
log_kv "Skipped" "${SKIPPED}"
echo ""

if [ "$FAILED" -gt 0 ]; then
  log_fail "SUITE FAILED"
  exit 1
else
  log_ok "SUITE PASSED"
  exit 0
fi

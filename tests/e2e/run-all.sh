#!/usr/bin/env bash
# ============================================================================
# Portlama E2E — Master Test Runner
# ============================================================================
# Runs all E2E test scripts in sequence and reports a summary.
#
# Usage:
#   bash tests/e2e/run-all.sh                    # run all tests
#   SKIP_DNS_TESTS=1 bash tests/e2e/run-all.sh   # skip DNS-dependent tests
#
# Environment variables:
#   BASE_URL       — panel URL (default: https://127.0.0.1:9292)
#   CERT_PATH      — path to client cert
#   KEY_PATH       — path to client key
#   CA_PATH        — path to CA cert
#   SKIP_DNS_TESTS — set to 1 to skip DNS/certbot tests
# ============================================================================

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Log directory for per-test Markdown logs (set by orchestrator or default to /tmp)
: "${LOG_DIR:=/tmp}"

# Colours
if [ -t 1 ]; then
  GREEN='\033[0;32m'
  RED='\033[0;31m'
  YELLOW='\033[0;33m'
  CYAN='\033[0;36m'
  BOLD='\033[1m'
  RESET='\033[0m'
else
  GREEN=''
  RED=''
  YELLOW=''
  CYAN=''
  BOLD=''
  RESET=''
fi

echo ""
echo -e "${BOLD}============================================================================${RESET}"
echo -e "${BOLD}  Portlama End-to-End Test Suite${RESET}"
echo -e "${BOLD}============================================================================${RESET}"
echo ""
echo -e "  BASE_URL:       ${BASE_URL:-https://127.0.0.1:9292}"
echo -e "  SKIP_DNS_TESTS: ${SKIP_DNS_TESTS:-0}"
echo -e "  Date:           $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo ""

# Collect test scripts in order
TEST_SCRIPTS=(
  "01-fresh-install.sh"
  "02-mtls-enforcement.sh"
  "03-onboarding-flow.sh"
  "04-tunnel-lifecycle.sh"
  "05-user-lifecycle.sh"
  "06-service-control.sh"
  "07-cert-renewal.sh"
  "08-mtls-rotation.sh"
  "09-ip-fallback.sh"
  "10-resilience.sh"
  "11-input-validation.sh"
  "12-user-invitations.sh"
  "13-site-lifecycle.sh"
  "15-plugin-lifecycle.sh"
  "16-enrollment-tokens.sh"
)

PASSED=0
FAILED=0
RESULTS=()

for script in "${TEST_SCRIPTS[@]}"; do
  SCRIPT_PATH="${SCRIPT_DIR}/${script}"

  if [ ! -f "$SCRIPT_PATH" ]; then
    echo -e "${YELLOW}  [SKIP]${RESET} ${script} — file not found"
    RESULTS+=("SKIP:${script}")
    continue
  fi

  echo -e "${CYAN}  Running: ${script}${RESET}"

  # Set per-test Markdown log file so helpers.sh writes clean Markdown there
  export _LOG_FILE="${LOG_DIR}/test-${script%.sh}.md"
  : > "${_LOG_FILE}"

  if bash "$SCRIPT_PATH"; then
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

TOTAL=$((PASSED + FAILED))

echo ""
echo -e "${BOLD}============================================================================${RESET}"
echo -e "${BOLD}  Test Suite Summary${RESET}"
echo -e "${BOLD}============================================================================${RESET}"
echo ""

for result in "${RESULTS[@]}"; do
  STATUS="${result%%:*}"
  NAME="${result#*:}"

  case "$STATUS" in
    PASS)
      echo -e "  ${GREEN}[PASS]${RESET} ${NAME}"
      ;;
    FAIL)
      echo -e "  ${RED}[FAIL]${RESET} ${NAME}"
      ;;
    SKIP)
      echo -e "  ${YELLOW}[SKIP]${RESET} ${NAME}"
      ;;
  esac
done

echo ""
echo -e "  Total: ${TOTAL} tests — ${GREEN}${PASSED} passed${RESET}, ${RED}${FAILED} failed${RESET}"
echo ""

if [ "$FAILED" -gt 0 ]; then
  echo -e "  ${RED}${BOLD}SUITE FAILED${RESET}"
  exit 1
else
  echo -e "  ${GREEN}${BOLD}SUITE PASSED${RESET}"
  exit 0
fi

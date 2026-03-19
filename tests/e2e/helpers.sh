#!/usr/bin/env bash
# ============================================================================
# Portlama E2E Test Helpers
# ============================================================================
# Shared functions for all E2E test scripts. Source this file at the top of
# every test:
#
#   SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
#   source "${SCRIPT_DIR}/helpers.sh"
# ============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration — override via environment variables before sourcing
# ---------------------------------------------------------------------------
: "${BASE_URL:=https://127.0.0.1:9292}"
: "${CERT_PATH:=/etc/portlama/pki/client.crt}"
: "${KEY_PATH:=/etc/portlama/pki/client.key}"
: "${CA_PATH:=/etc/portlama/pki/ca.crt}"
: "${CURL_TIMEOUT:=30}"
: "${SKIP_DNS_TESTS:=0}"
# Direct URL to Fastify (port 3100, HTTP, no nginx/mTLS) for public endpoints
: "${PANEL_DIRECT_URL:=http://127.0.0.1:3100}"

# ---------------------------------------------------------------------------
# Counters
# ---------------------------------------------------------------------------
_PASS_COUNT=0
_FAIL_COUNT=0
_SKIP_COUNT=0

# If _LOG_FILE is set, all log functions also write to the log file

# ---------------------------------------------------------------------------
# Colours (disabled when stdout is not a terminal)
# ---------------------------------------------------------------------------
if [ -t 1 ]; then
  _GREEN='\033[0;32m'
  _RED='\033[0;31m'
  _YELLOW='\033[0;33m'
  _CYAN='\033[0;36m'
  _RESET='\033[0m'
else
  _GREEN=''
  _RED=''
  _YELLOW=''
  _CYAN=''
  _RESET=''
fi

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

log_pass() {
  local msg="$1"
  _PASS_COUNT=$((_PASS_COUNT + 1))
  echo -e "${_GREEN}  [PASS]${_RESET} ${msg}"
  [ -n "${_LOG_FILE:-}" ] && echo "✅ \`$(date -u '+%H:%M:%S')\` ${msg}  " >> "${_LOG_FILE}" 2>/dev/null || true
}

log_fail() {
  local msg="$1"
  _FAIL_COUNT=$((_FAIL_COUNT + 1))
  echo -e "${_RED}  [FAIL]${_RESET} ${msg}"
  [ -n "${_LOG_FILE:-}" ] && echo "❌ \`$(date -u '+%H:%M:%S')\` **${msg}**  " >> "${_LOG_FILE}" 2>/dev/null || true
}

log_skip() {
  local msg="$1"
  _SKIP_COUNT=$((_SKIP_COUNT + 1))
  echo -e "${_YELLOW}  [SKIP]${_RESET} ${msg}"
  [ -n "${_LOG_FILE:-}" ] && echo "⏭️ \`$(date -u '+%H:%M:%S')\` ${msg}  " >> "${_LOG_FILE}" 2>/dev/null || true
}

log_info() {
  local msg="$1"
  echo -e "${_CYAN}  [INFO]${_RESET} ${msg}"
  [ -n "${_LOG_FILE:-}" ] && echo "ℹ️ \`$(date -u '+%H:%M:%S')\` ${msg}  " >> "${_LOG_FILE}" 2>/dev/null || true
}

log_section() {
  local msg="$1"
  echo ""
  echo -e "${_CYAN}--- ${msg} ---${_RESET}"
  if [ -n "${_LOG_FILE:-}" ]; then
    echo "" >> "${_LOG_FILE}" 2>/dev/null || true
    echo "## ${msg}" >> "${_LOG_FILE}" 2>/dev/null || true
    echo "" >> "${_LOG_FILE}" 2>/dev/null || true
  fi
}

# ---------------------------------------------------------------------------
# Assertion helpers
# ---------------------------------------------------------------------------

# assert_eq actual expected message
# Compare two values; log_fail and return 1 on mismatch.
assert_eq() {
  local actual="$1"
  local expected="$2"
  local message="$3"

  if [ "$actual" = "$expected" ]; then
    log_pass "$message"
    return 0
  else
    log_fail "$message (expected: '$expected', got: '$actual')"
    return 1
  fi
}

# assert_not_eq actual unexpected message
assert_not_eq() {
  local actual="$1"
  local unexpected="$2"
  local message="$3"

  if [ "$actual" != "$unexpected" ]; then
    log_pass "$message"
    return 0
  else
    log_fail "$message (got unexpected value: '$actual')"
    return 1
  fi
}

# assert_contains output substring message
# Check that output contains substring.
assert_contains() {
  local output="$1"
  local substring="$2"
  local message="$3"

  if echo "$output" | grep -qF "$substring"; then
    log_pass "$message"
    return 0
  else
    log_fail "$message (output does not contain: '$substring')"
    return 1
  fi
}

# assert_not_contains output substring message
assert_not_contains() {
  local output="$1"
  local substring="$2"
  local message="$3"

  if ! echo "$output" | grep -qF "$substring"; then
    log_pass "$message"
    return 0
  else
    log_fail "$message (output unexpectedly contains: '$substring')"
    return 1
  fi
}

# assert_http_status url expected_status [extra_curl_args...]
# Make a curl request and verify the HTTP status code.
assert_http_status() {
  local url="$1"
  local expected_status="$2"
  shift 2
  local extra_args=("$@")

  local actual_status
  actual_status=$(curl -s -o /dev/null -w '%{http_code}' \
    --max-time "$CURL_TIMEOUT" \
    --insecure \
    "${extra_args[@]}" \
    "$url" 2>/dev/null || echo "000")

  if [ "$actual_status" = "$expected_status" ]; then
    log_pass "HTTP $expected_status from $url"
    return 0
  else
    log_fail "Expected HTTP $expected_status from $url, got $actual_status"
    return 1
  fi
}

# assert_json_field json jq_expression expected_value message
# Use jq to extract a field and compare it.
assert_json_field() {
  local json="$1"
  local field="$2"
  local expected="$3"
  local message="$4"

  local actual
  actual=$(echo "$json" | jq -r "$field" 2>/dev/null || echo "__JQ_ERROR__")

  if [ "$actual" = "__JQ_ERROR__" ]; then
    log_fail "$message (jq failed to parse JSON or extract field '$field')"
    return 1
  fi

  if [ "$actual" = "$expected" ]; then
    log_pass "$message"
    return 0
  else
    log_fail "$message (expected: '$expected', got: '$actual')"
    return 1
  fi
}

# assert_json_field_not_empty json jq_expression message
assert_json_field_not_empty() {
  local json="$1"
  local field="$2"
  local message="$3"

  local actual
  actual=$(echo "$json" | jq -r "$field" 2>/dev/null || echo "")

  if [ -n "$actual" ] && [ "$actual" != "null" ] && [ "$actual" != "" ]; then
    log_pass "$message"
    return 0
  else
    log_fail "$message (field '$field' is empty or null)"
    return 1
  fi
}

# ---------------------------------------------------------------------------
# API request helpers (use mTLS certs)
# ---------------------------------------------------------------------------

# _curl_mtls [curl_args...]
# Base curl with mTLS certs, JSON accept header, and --insecure for self-signed.
_curl_mtls() {
  curl -s \
    --max-time "$CURL_TIMEOUT" \
    --insecure \
    --cert "$CERT_PATH" \
    --key "$KEY_PATH" \
    --cacert "$CA_PATH" \
    -H "Accept: application/json" \
    "$@"
}

# api_get path
# GET request to BASE_URL/api/<path> with mTLS certs. Returns body on stdout.
api_get() {
  local api_path="$1"
  _curl_mtls "${BASE_URL}/api/${api_path}"
}

# api_post path [json_body]
# POST request with JSON body. Returns body on stdout.
api_post() {
  local api_path="$1"
  local _default='{}'; local body="${2:-$_default}"
  _curl_mtls \
    -X POST \
    -H "Content-Type: application/json" \
    -d "$body" \
    "${BASE_URL}/api/${api_path}"
}

# api_put path json_body
# PUT request with JSON body. Returns body on stdout.
api_put() {
  local api_path="$1"
  local body="$2"
  _curl_mtls \
    -X PUT \
    -H "Content-Type: application/json" \
    -d "$body" \
    "${BASE_URL}/api/${api_path}"
}

# api_delete path
# DELETE request. Returns body on stdout.
api_delete() {
  local api_path="$1"
  _curl_mtls -X DELETE "${BASE_URL}/api/${api_path}"
}

# api_patch path json_body
# PATCH request with JSON body. Returns body on stdout.
api_patch() {
  local api_path="$1"
  local body="$2"
  _curl_mtls \
    -X PATCH \
    -H "Content-Type: application/json" \
    -d "$body" \
    "${BASE_URL}/api/${api_path}"
}

# api_get_status path
# GET request returning only the HTTP status code.
api_get_status() {
  local api_path="$1"
  _curl_mtls -o /dev/null -w '%{http_code}' "${BASE_URL}/api/${api_path}" 2>/dev/null || echo "000"
}

# api_post_status path [json_body]
# POST request returning only the HTTP status code.
api_post_status() {
  local api_path="$1"
  local _default='{}'; local body="${2:-$_default}"
  _curl_mtls -o /dev/null -w '%{http_code}' \
    -X POST \
    -H "Content-Type: application/json" \
    -d "$body" \
    "${BASE_URL}/api/${api_path}" 2>/dev/null || echo "000"
}

# api_patch_status path [json_body]
# PATCH request returning only the HTTP status code.
api_patch_status() {
  local api_path="$1"
  local _default='{}'; local body="${2:-$_default}"
  _curl_mtls -o /dev/null -w '%{http_code}' \
    -X PATCH \
    -H "Content-Type: application/json" \
    -d "$body" \
    "${BASE_URL}/api/${api_path}" 2>/dev/null || echo "000"
}

# api_upload_file path file_path
# Multipart file upload to API. Returns body on stdout.
api_upload_file() {
  local api_path="$1"
  local file_path="$2"
  _curl_mtls \
    -X POST \
    -F "file=@${file_path}" \
    "${BASE_URL}/api/${api_path}"
}

# api_upload_file_status path file_path
# Multipart file upload returning only the HTTP status code.
api_upload_file_status() {
  local api_path="$1"
  local file_path="$2"
  _curl_mtls -o /dev/null -w '%{http_code}' \
    -X POST \
    -F "file=@${file_path}" \
    "${BASE_URL}/api/${api_path}" 2>/dev/null || echo "000"
}

# api_delete_status path
# DELETE request returning only the HTTP status code.
api_delete_status() {
  local api_path="$1"
  _curl_mtls -o /dev/null -w '%{http_code}' \
    -X DELETE \
    "${BASE_URL}/api/${api_path}" 2>/dev/null || echo "000"
}

# ---------------------------------------------------------------------------
# Service helpers
# ---------------------------------------------------------------------------

# wait_for_service name [timeout_seconds]
# Poll systemctl until service is active. Returns 0 on success, 1 on timeout.
wait_for_service() {
  local name="$1"
  local timeout="${2:-30}"
  local elapsed=0

  while [ "$elapsed" -lt "$timeout" ]; do
    local status
    status=$(systemctl is-active "$name" 2>/dev/null || true)
    if [ "$status" = "active" ]; then
      return 0
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done

  return 1
}

# wait_for_http url [timeout_seconds] [extra_curl_args...]
# Poll an HTTP endpoint until it returns 200. Returns 0 on success, 1 on timeout.
wait_for_http() {
  local url="$1"
  local timeout="${2:-30}"
  shift 2
  local extra_args=("$@")
  local elapsed=0

  while [ "$elapsed" -lt "$timeout" ]; do
    local status
    status=$(curl -s -o /dev/null -w '%{http_code}' \
      --max-time 5 \
      --insecure \
      "${extra_args[@]}" \
      "$url" 2>/dev/null || echo "000")
    if [ "$status" = "200" ]; then
      return 0
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done

  return 1
}

# ---------------------------------------------------------------------------
# DNS skip guard
# ---------------------------------------------------------------------------

# skip_if_no_dns message
# If SKIP_DNS_TESTS=1, log a skip and return 1 (caller should check and return).
skip_if_no_dns() {
  local message="${1:-Test requires real DNS}"
  if [ "$SKIP_DNS_TESTS" = "1" ]; then
    log_skip "$message"
    return 1
  fi
  return 0
}

# ---------------------------------------------------------------------------
# Test lifecycle
# ---------------------------------------------------------------------------

# begin_test test_name
# Print a header for the test suite.
begin_test() {
  local name="$1"
  echo ""
  echo "============================================================================"
  echo -e "${_CYAN} Portlama E2E: ${name}${_RESET}"
  echo "============================================================================"
  echo ""
  if [ -n "${_LOG_FILE:-}" ]; then
    {
      echo "# Portlama E2E: ${name}"
      echo ""
      echo "> Started at \`$(date -u '+%Y-%m-%d %H:%M:%S UTC')\`"
      echo ""
    } >> "${_LOG_FILE}" 2>/dev/null || true
  fi
  _PASS_COUNT=0
  _FAIL_COUNT=0
  _SKIP_COUNT=0
}

# end_test
# Print summary and exit with appropriate code.
end_test() {
  local total=$((_PASS_COUNT + _FAIL_COUNT + _SKIP_COUNT))
  echo ""
  echo "============================================================================"
  echo -e "  Results: ${_GREEN}${_PASS_COUNT} passed${_RESET}, ${_RED}${_FAIL_COUNT} failed${_RESET}, ${_YELLOW}${_SKIP_COUNT} skipped${_RESET} (${total} total)"
  echo "============================================================================"
  echo ""
  if [ -n "${_LOG_FILE:-}" ]; then
    {
      echo ""
      echo "---"
      echo ""
      echo "## Results"
      echo ""
      echo "| Metric | Count |"
      echo "|--------|-------|"
      echo "| **Passed** | \`${_PASS_COUNT}\` |"
      echo "| **Failed** | \`${_FAIL_COUNT}\` |"
      echo "| **Skipped** | \`${_SKIP_COUNT}\` |"
      echo "| **Total** | \`${total}\` |"
      echo ""
    } >> "${_LOG_FILE}" 2>/dev/null || true
  fi

  if [ "$_FAIL_COUNT" -gt 0 ]; then
    return 1
  fi
  return 0
}

# ---------------------------------------------------------------------------
# Dependency checks
# ---------------------------------------------------------------------------

require_commands() {
  local missing=()
  for cmd in "$@"; do
    if ! command -v "$cmd" &>/dev/null; then
      missing+=("$cmd")
    fi
  done

  if [ "${#missing[@]}" -gt 0 ]; then
    echo "Error: required commands not found: ${missing[*]}"
    echo "Install them before running this test."
    exit 2
  fi
}

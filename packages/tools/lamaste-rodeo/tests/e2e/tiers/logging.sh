#!/usr/bin/env bash
# ============================================================================
# Lamaste E2E — Shared Logging Library
# ============================================================================
# Source this file at the top of every E2E script to get unified, structured
# logging with log-level filtering and dual-write to a log file.
#
# Usage:
#   source "$(dirname "${BASH_SOURCE[0]}")/logging.sh"
#   init_log "my-script"          # sets up log file
#   log_step "Installing nginx"   # [STEP] Installing nginx
#   run_cmd "Install nginx" apt-get install -y nginx  # captures output to log
#   log_ok "nginx installed"      # [OK] nginx installed
#
# Environment:
#   LOG_LEVEL  — 0=QUIET, 1=NORMAL (default), 2=VERBOSE
#   LOG_DIR    — directory for log files (default: /tmp for VMs, ./e2e-logs for macOS)
# ============================================================================

# Guard against double-sourcing
if [ -n "${_LOGGING_SH_LOADED:-}" ]; then
  return 0 2>/dev/null || true
fi
_LOGGING_SH_LOADED=1

# ---------------------------------------------------------------------------
# Log level (0=QUIET, 1=NORMAL, 2=VERBOSE)
# ---------------------------------------------------------------------------
: "${LOG_LEVEL:=1}"
: "${LOG_DIR:=/tmp}"

_LOG_FILE=""

# ---------------------------------------------------------------------------
# Path redaction — strip local filesystem paths from log output
# ---------------------------------------------------------------------------
# Detect the repo root so we can replace it with a generic placeholder.
# This prevents developer home directories and local paths from leaking
# into committed log files.
_REPO_ROOT_CANDIDATE="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# Only use repo root for redaction if it's a real repo checkout (not "/" inside VMs)
if [ -d "${_REPO_ROOT_CANDIDATE}/.git" ]; then
  _REPO_ROOT="${_REPO_ROOT_CANDIDATE}"
else
  _REPO_ROOT=""
fi
_REDACT_HOME="${HOME:-/home/unknown}"

_redact() {
  local text="$*"
  # Replace the full repo root first (most specific)
  if [ -n "${_REPO_ROOT}" ]; then
    text="${text//${_REPO_ROOT}/<repo>}"
  fi
  # Replace the home directory (catches paths outside the repo)
  text="${text//${_REDACT_HOME}/\~}"
  echo "${text}"
}

# ---------------------------------------------------------------------------
# Colours (disabled when stdout is not a terminal)
# ---------------------------------------------------------------------------
if [ -t 1 ]; then
  _C_GREEN='\033[0;32m'
  _C_RED='\033[0;31m'
  _C_YELLOW='\033[0;33m'
  _C_CYAN='\033[0;36m'
  _C_BOLD='\033[1m'
  _C_RESET='\033[0m'
else
  _C_GREEN='' _C_RED='' _C_YELLOW='' _C_CYAN='' _C_BOLD='' _C_RESET=''
fi

# ---------------------------------------------------------------------------
# init_log <name>
# Set up the Markdown log file. Call once at script start.
# ---------------------------------------------------------------------------
init_log() {
  local name="$1"
  mkdir -p "${LOG_DIR}"
  _LOG_FILE="${LOG_DIR}/${name}.md"
  : > "${_LOG_FILE}"  # truncate
  _md_raw "# ${name}"
  _md_raw ""
  _md_raw "> Started at \`$(date -u '+%Y-%m-%d %H:%M:%S UTC')\` — log level **${LOG_LEVEL}**"
  _md_raw ""
}

# ---------------------------------------------------------------------------
# Internal: write raw line to Markdown log file
# ---------------------------------------------------------------------------
_md_raw() {
  if [ -n "${_LOG_FILE:-}" ]; then
    echo "$(_redact "$*")" >> "${_LOG_FILE}" 2>/dev/null || true
  fi
}

# Timestamped entry (used by most log functions)
_md_entry() {
  local icon="$1" msg="$2"
  _md_raw "${icon} \`$(date -u '+%H:%M:%S')\` ${msg}  "
}

# ---------------------------------------------------------------------------
# Log functions
#
# Each writes to the log file unconditionally and to stdout based on level.
# QUIET  (0): only FAIL and FATAL
# NORMAL (1): STEP, OK, FAIL, WARN, SKIP, SECTION, HEADER
# VERBOSE(2): everything including INFO
# ---------------------------------------------------------------------------

log_step() {
  local msg="$1"
  _kv_table_end
  _md_entry "🔵" "**${msg}**"
  if [ "${LOG_LEVEL}" -ge 1 ]; then
    echo -e "${_C_BOLD}${_C_CYAN}  [STEP]${_C_RESET} ${msg}"
  fi
}

log_ok() {
  local msg="$1"
  _kv_table_end
  _md_entry "✅" "${msg}"
  if [ "${LOG_LEVEL}" -ge 1 ]; then
    echo -e "${_C_GREEN}  [OK]${_C_RESET}   ${msg}"
  fi
}

log_fail() {
  local msg="$1"
  _kv_table_end
  _md_entry "❌" "**${msg}**"
  # Always print failures, even in QUIET mode
  echo -e "${_C_RED}  [FAIL]${_C_RESET} ${msg}"
}

log_warn() {
  local msg="$1"
  _kv_table_end
  _md_entry "⚠️" "${msg}"
  if [ "${LOG_LEVEL}" -ge 1 ]; then
    echo -e "${_C_YELLOW}  [WARN]${_C_RESET} ${msg}"
  fi
}

log_skip() {
  local msg="$1"
  _kv_table_end
  _md_entry "⏭️" "${msg}"
  if [ "${LOG_LEVEL}" -ge 1 ]; then
    echo -e "${_C_YELLOW}  [SKIP]${_C_RESET} ${msg}"
  fi
}

log_info() {
  local msg="$1"
  _kv_table_end
  _md_entry "ℹ️" "${msg}"
  if [ "${LOG_LEVEL}" -ge 2 ]; then
    echo -e "${_C_CYAN}  [INFO]${_C_RESET} ${msg}"
  fi
}

log_section() {
  local msg="$1"
  _kv_table_end
  _md_raw ""
  _md_raw "## ${msg}"
  _md_raw ""
  if [ "${LOG_LEVEL}" -ge 1 ]; then
    echo ""
    echo -e "${_C_BOLD}${_C_CYAN}--- ${msg} ---${_C_RESET}"
  fi
}

log_header() {
  local msg="$1"
  _kv_table_end
  _md_raw ""
  _md_raw "---"
  _md_raw ""
  _md_raw "# ${msg}"
  _md_raw ""
  if [ "${LOG_LEVEL}" -ge 1 ]; then
    echo ""
    echo -e "${_C_BOLD}============================================================================${_C_RESET}"
    echo -e "${_C_BOLD}  ${msg}${_C_RESET}"
    echo -e "${_C_BOLD}============================================================================${_C_RESET}"
    echo ""
  fi
}

log_fatal() {
  local msg="$1"
  _kv_table_end
  _md_entry "💀" "**FATAL: ${msg}**"
  echo -e "${_C_RED}${_C_BOLD}  [FATAL] ${msg}${_C_RESET}" >&2
  if [ -n "${_LOG_FILE:-}" ]; then
    echo -e "  ${_C_CYAN}Log: ${_LOG_FILE}${_C_RESET}" >&2
  fi
  exit 1
}

# ---------------------------------------------------------------------------
# log_kv key value
# Print a key-value pair (for summary blocks). Appears at NORMAL level.
# ---------------------------------------------------------------------------
_KV_TABLE_OPEN=0

log_kv() {
  local key="$1" val="$2"
  # Auto-emit table header on first kv in a sequence
  if [ "${_KV_TABLE_OPEN}" -eq 0 ]; then
    _md_raw ""
    _md_raw "| Key | Value |"
    _md_raw "|-----|-------|"
    _KV_TABLE_OPEN=1
  fi
  _md_raw "| **${key}** | \`${val}\` |"
  if [ "${LOG_LEVEL}" -ge 1 ]; then
    printf "  %-16s %s\n" "${key}:" "${val}"
  fi
}

# Close the current kv table (called automatically by non-kv log functions)
_kv_table_end() {
  if [ "${_KV_TABLE_OPEN}" -eq 1 ]; then
    _md_raw ""
    _KV_TABLE_OPEN=0
  fi
}

# ---------------------------------------------------------------------------
# run_cmd <description> <command> [args...]
#
# Runs a command, capturing all output to the log file.
# - On success: prints [OK] description
# - On failure: prints [FAIL] description + last 10 lines of output
# Returns the command's exit code.
# ---------------------------------------------------------------------------
run_cmd() {
  local desc="$1"
  shift
  _kv_table_end

  if [ "${LOG_LEVEL}" -ge 1 ]; then
    echo -ne "${_C_CYAN}  [RUN]${_C_RESET}  ${desc}..."
  fi

  local tmp_out
  tmp_out=$(mktemp /tmp/run_cmd_XXXXXX)

  local rc=0
  "$@" > "${tmp_out}" 2>&1 || rc=$?

  # Write to Markdown log as a collapsible details block
  if [ -n "${_LOG_FILE:-}" ]; then
    if [ "${rc}" -eq 0 ]; then
      {
        echo "<details>"
        echo "<summary>✅ <code>$(date -u '+%H:%M:%S')</code> ${desc}</summary>"
        echo ""
        echo "\`\`\`"
        echo "\$ $(_redact "$*")"
        _redact "$(cat "${tmp_out}" 2>/dev/null || true)"
        echo "\`\`\`"
        echo "</details>"
        echo ""
      } >> "${_LOG_FILE}" 2>/dev/null || true
    else
      {
        echo "<details open>"
        echo "<summary>❌ <code>$(date -u '+%H:%M:%S')</code> <strong>${desc}</strong> (exit code: ${rc})</summary>"
        echo ""
        echo "\`\`\`"
        echo "\$ $(_redact "$*")"
        _redact "$(cat "${tmp_out}" 2>/dev/null || true)"
        echo "\`\`\`"
        echo "</details>"
        echo ""
      } >> "${_LOG_FILE}" 2>/dev/null || true
    fi
  fi

  if [ "${rc}" -eq 0 ]; then
    if [ "${LOG_LEVEL}" -ge 1 ]; then
      echo -e " ${_C_GREEN}done${_C_RESET}"
    fi
  else
    if [ "${LOG_LEVEL}" -ge 1 ]; then
      echo -e " ${_C_RED}failed (exit ${rc})${_C_RESET}"
    fi
    # Show last 10 lines on failure for immediate context
    echo -e "${_C_RED}  --- last 10 lines ---${_C_RESET}"
    tail -10 "${tmp_out}" | sed 's/^/    /'
    echo -e "${_C_RED}  --- end ---${_C_RESET}"
  fi

  rm -f "${tmp_out}"
  return "${rc}"
}

# ---------------------------------------------------------------------------
# log_file_path
# Returns the current log file path (for printing in summaries).
# ---------------------------------------------------------------------------
log_file_path() {
  echo "${_LOG_FILE:-}"
}

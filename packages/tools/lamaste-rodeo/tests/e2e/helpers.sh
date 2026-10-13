#!/usr/bin/env bash
# ============================================================================
# Lamaste E2E Test Helpers
# ============================================================================
# Shared functions for all E2E test scripts. Source this file at the top of
# every test:
#
#   SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
#   source "${SCRIPT_DIR}/helpers.sh"
# ============================================================================

set -euo pipefail

# `multipass exec` (1.16 on macOS) never exits when its stdout or stderr is
# /dev/null and the remote command writes after a delay — e.g.
# `multipass exec vm -- bash -c "sleep 1; echo x" >/dev/null` hangs forever,
# the same command into a pipe returns. Tests routinely discard output that
# way (cleanup calls), so every multipass client gets pipes: its output goes
# through `cat`, which writes to /dev/null without trouble. `$(...)` still
# captures stdout (it waits for cat), and the exit status is multipass's.
multipass() {
  command multipass "$@" > >(cat) 2> >(cat >&2)
}

# ---------------------------------------------------------------------------
# Configuration — override via environment variables before sourcing
# ---------------------------------------------------------------------------
: "${BASE_URL:=https://127.0.0.1:9292}"
: "${CERT_PATH:=/etc/lamalibre/lamaste/pki/client.crt}"
: "${KEY_PATH:=/etc/lamalibre/lamaste/pki/client.key}"
: "${CA_PATH:=/etc/lamalibre/lamaste/pki/ca.crt}"
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

  if printf '%s\n' "$output" | grep -qF -e "$substring"; then
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

  if ! printf '%s\n' "$output" | grep -qF -e "$substring"; then
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
  echo -e "${_CYAN} Lamaste E2E: ${name}${_RESET}"
  echo "============================================================================"
  echo ""
  if [ -n "${_LOG_FILE:-}" ]; then
    {
      echo "# Lamaste E2E: ${name}"
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
# TOTP helpers
# ---------------------------------------------------------------------------

# wait_for_next_totp_window — sleep until we're at least 1 second into a
# fresh 30-second TOTP window. Authelia rejects a TOTP code that was already
# used in the same time step, even when the user's secret has just been
# rotated. When tests run back-to-back (the second test resets the secret
# and 2FAs within seconds of the first), the newly-derived code can land in
# the same time step as the prior test's code and Authelia returns
# "the user has already used this code recently". Waiting into a fresh
# window sidesteps the cache without weakening Authelia's anti-replay.
wait_for_next_totp_window() {
  local now sleep_time
  now=$(date +%s)
  sleep_time=$(( 31 - (now % 30) ))
  sleep "$sleep_time"
}

# ---------------------------------------------------------------------------
# Multipass exec timeout wrapper
#
# `multipass exec` can CPU-spin at 99% if the remote command leaves a pipe
# open (known rodeo bug — child reparents to launchd on SIGKILL and keeps
# stdout held). curl's --max-time bounds curl, not multipass. macOS lacks
# GNU `timeout`, so we use perl's alarm to kill the multipass client.
#
# Usage:
#   timed_exec 35 multipass exec lamaste-host -- sudo bash -c "curl ..."
#   timed_exec 60 multipass exec lamaste-agent -- sudo bash -c "lamaste-agent update"
#
# The trailing `|| true` keeps `set -e` happy — callers that need to assert
# success must verify the resulting VM state, not rely on the exit code.
# ---------------------------------------------------------------------------
timed_exec() {
  local secs="$1"
  shift
  # Pipes, not the caller's streams: see multipass() at the top of this file.
  perl -e 'alarm shift; exec @ARGV or die "exec failed: $!"' "$secs" "$@" \
    > >(cat) 2> >(cat >&2) || true
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

# ---------------------------------------------------------------------------
# Stand-in registry (Feria) and fixture plugin — specs 26 and 27
#
# The VM runner uploads only the .sh files, so the fixtures live here as
# functions that write them out. `write_stub_registry <file>` writes a Node
# script that speaks the parts of Feria's contract the panel and the agents
# use (login, whoami, broker, tokens) and enough of the npm registry
# protocol to serve `@lamalibre/e2e-oidc-server`, recording every request
# with its Authorization header. `write_oidc_fixture_plugin <dir>` writes
# that package: a plugin whose manifest declares a public device-code client
# with access-token claims and a confidential client-credentials client.
# ---------------------------------------------------------------------------

# write_stub_registry file
write_stub_registry() {
  local dest="$1"
  cat > "$dest" <<'STUB_REGISTRY_EOF'
// Stand-in for a networked Feria, for the Lamaste e2e suite.
//
// Speaks the parts of Feria's contract the panel and the agents use
// (`/-/whoami`, `/-/feria/login`, `/-/feria/broker/agent-token`,
// `/-/feria/tokens?owner=`) and enough of the npm registry protocol to
// serve the fixture packages it is started with (packument + tarball,
// bearer token required). Every request is recorded, Authorization header
// included, so a test can prove which credential an install used.
//
//   node stub-registry.mjs --port 4874 --admin-token feria_… \
//     --issuer https://auth.<domain> --audience http://127.0.0.1:4874 \
//     --jwks-url http://127.0.0.1:9091/jwks.json --package <dir> [--package <dir>…] \
//     [--host 0.0.0.0] [--base-url http://<reachable-address>:4874]
//
// `--host` is the bind address (default 127.0.0.1); `--base-url` is the URL
// clients reach the registry at (default http://127.0.0.1:<port>), used in
// the tarball URLs of the packuments.
//
// Admin-only e2e endpoints: GET /-/e2e/requests (what was recorded),
// POST /-/e2e/config {"agentTokenTtlSeconds": n} (lifetime of brokered tokens).
import { createServer, request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import crypto from 'node:crypto';
import path from 'node:path';

const execFileP = promisify(execFile);

const opts = { packages: [] };
for (let i = 2; i < process.argv.length; i += 1) {
  const key = process.argv[i];
  const value = process.argv[i + 1];
  if (key === '--package') opts.packages.push(value);
  else if (key.startsWith('--')) opts[key.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
  else continue;
  i += 1;
}
for (const required of ['port', 'adminToken', 'issuer', 'audience', 'jwksUrl']) {
  if (!opts[required]) {
    process.stderr.write(`stub-registry: --${required} is required\n`);
    process.exit(2);
  }
}
const PORT = Number(opts.port);
const HOST = opts.host ?? '127.0.0.1';
const BASE = (opts.baseUrl ?? `http://127.0.0.1:${PORT}`).replace(/\/$/, '');
const ISSUER_HOST = new URL(opts.issuer).host;

const tokens = new Map(); // secret → record
const requests = [];
let agentTokenTtlSeconds = 3600;

const json = (res, status, payload) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(payload));
};
const readBody = (req) =>
  new Promise((resolve) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => resolve(body));
  });

function issue({ owner, kind, scopes, label, ttlSeconds, createdBy }) {
  const secret = `feria_${crypto.randomBytes(24).toString('base64url')}`;
  const now = new Date();
  const record = {
    id: crypto.randomUUID(),
    owner,
    kind,
    scopes,
    label,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlSeconds * 1000).toISOString(),
    createdBy,
  };
  tokens.set(secret, record);
  return { ...record, token: secret };
}

function principalOf(req) {
  const auth = req.headers.authorization ?? '';
  const m = /^Bearer\s+(\S+)$/i.exec(auth);
  if (!m) return null;
  if (m[1] === opts.adminToken) {
    return { owner: 'machine:e2e-admin', kind: 'token', tokenKind: 'machine', scopes: ['read', 'publish', 'admin'], tokenId: null, label: 'e2e admin', expiresAt: null };
  }
  const record = tokens.get(m[1]);
  if (!record || Date.parse(record.expiresAt) < Date.now()) return null;
  return { owner: record.owner, kind: 'token', tokenKind: record.kind, scopes: record.scopes, tokenId: record.id, label: record.label, expiresAt: record.expiresAt };
}

function fetchJson(url, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const fn = u.protocol === 'https:' ? httpsRequest : httpRequest;
    const req = fn(u, { method: 'GET', headers, rejectUnauthorized: false }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(body) });
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

/** Verify an RS256 JWT against the issuer's JWKS; return its claims or throw. */
async function verifyAssertion(assertion) {
  const parts = assertion.split('.');
  if (parts.length !== 3) throw new Error('assertion is not a JWT');
  const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
  const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
  if (header.alg !== 'RS256') throw new Error(`unsupported alg ${header.alg}`);
  const { body: jwks } = await fetchJson(opts.jwksUrl, {
    'x-forwarded-proto': 'https',
    'x-forwarded-host': ISSUER_HOST,
  });
  const jwk = (jwks.keys ?? []).find((k) => k.kid === header.kid) ?? (jwks.keys ?? [])[0];
  if (!jwk) throw new Error('no key in JWKS');
  const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  const ok = crypto.verify('sha256', Buffer.from(`${parts[0]}.${parts[1]}`), { key, padding: crypto.constants.RSA_PKCS1_PADDING }, Buffer.from(parts[2], 'base64url'));
  if (!ok) throw new Error('bad signature');
  if (claims.iss !== opts.issuer) throw new Error(`assertion issuer is not trusted: ${claims.iss}`);
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(opts.audience)) throw new Error(`audience mismatch: ${aud.join(',')}`);
  if (typeof claims.exp !== 'number' || claims.exp * 1000 < Date.now() - 60_000) throw new Error('expired');
  return claims;
}

// --- fixture packages ---
const packages = new Map(); // name → { packument, tarballs: Map<file, Buffer> }
async function loadPackages() {
  for (const dir of opts.packages) {
    const dest = await mkdtemp(path.join(tmpdir(), 'stub-registry-pack-'));
    const { stdout } = await execFileP(
      'npm',
      ['pack', '--json', '--pack-destination', dest, path.resolve(dir)],
      { env: { ...process.env, npm_config_loglevel: 'error', npm_config_cache: path.join(dest, 'cache') } },
    );
    const [info] = JSON.parse(stdout);
    const pkg = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8'));
    const tarball = await readFile(path.join(dest, info.filename));
    const unscoped = pkg.name.replace(/^@[^/]+\//, '');
    const file = `${unscoped}-${pkg.version}.tgz`;
    const entry = packages.get(pkg.name) ?? { tarballs: new Map(), versions: {} };
    entry.versions[pkg.version] = {
      ...pkg,
      dist: { tarball: `${BASE}/${pkg.name}/-/${file}`, integrity: info.integrity, shasum: info.shasum },
    };
    entry.tarballs.set(file, tarball);
    packages.set(pkg.name, entry);
  }
}

function packumentOf(name) {
  const entry = packages.get(name);
  if (!entry) return null;
  const versions = Object.keys(entry.versions).sort();
  return {
    name,
    'dist-tags': { latest: versions[versions.length - 1] },
    versions: entry.versions,
    time: { modified: new Date().toISOString() },
  };
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, BASE);
  const principal = principalOf(req);
  const body = await readBody(req);
  requests.push({
    at: new Date().toISOString(),
    method: req.method,
    path: decodeURIComponent(url.pathname) + url.search,
    authorization: req.headers.authorization ?? null,
    owner: principal?.owner ?? null,
  });
  const requireAuth = () => {
    if (!principal) {
      json(res, 401, { error: 'authentication required' });
      return false;
    }
    return true;
  };
  const requireAdmin = () => {
    if (!requireAuth()) return false;
    if (!principal.scopes.includes('admin')) {
      json(res, 403, { error: 'requires the admin scope' });
      return false;
    }
    return true;
  };

  try {
    if (req.method === 'GET' && url.pathname === '/-/ping') return json(res, 200, {});
    if (req.method === 'GET' && url.pathname === '/-/whoami') {
      if (!requireAuth()) return;
      return json(res, 200, { username: principal.owner, ...principal });
    }
    if (req.method === 'POST' && url.pathname === '/-/feria/login') {
      let claims;
      try {
        claims = await verifyAssertion(JSON.parse(body || '{}').assertion ?? '');
      } catch (err) {
        return json(res, 401, { error: `login refused: ${err.message}` });
      }
      // The rule a real Feria carries in auth.json: client_id lamaste-server → admin.
      const clientId = claims.client_id ?? claims.sub;
      if (clientId !== 'lamaste-server') {
        return json(res, 403, { error: 'login refused: this identity is granted no Feria access by the issuer policy' });
      }
      return json(res, 201, issue({ owner: `ci:${ISSUER_HOST}/${claims.sub}`, kind: 'ci', scopes: ['read', 'publish', 'admin'], label: 'lamaste-server', ttlSeconds: 3600, createdBy: 'login' }));
    }
    if (req.method === 'POST' && url.pathname === '/-/feria/broker/agent-token') {
      if (!requireAdmin()) return;
      const { agentLabel } = JSON.parse(body || '{}');
      if (!/^[a-z0-9][a-z0-9-]*$/.test(agentLabel ?? '')) return json(res, 400, { error: 'invalid agentLabel' });
      return json(res, 201, issue({ owner: `agent:${agentLabel}`, kind: 'agent', scopes: ['read'], label: `agent ${agentLabel}`, ttlSeconds: agentTokenTtlSeconds, createdBy: principal.owner }));
    }
    if (url.pathname === '/-/feria/tokens' && (req.method === 'GET' || req.method === 'DELETE')) {
      if (!requireAdmin()) return;
      const owner = url.searchParams.get('owner');
      const matching = [...tokens.entries()].filter(([, r]) => r.owner === owner);
      if (req.method === 'DELETE') {
        for (const [secret] of matching) tokens.delete(secret);
        return json(res, 200, { revoked: matching.map(([, r]) => r) });
      }
      return json(res, 200, { tokens: matching.map(([, r]) => r) });
    }
    if (req.method === 'GET' && url.pathname === '/-/e2e/requests') {
      if (!requireAdmin()) return;
      return json(res, 200, { requests });
    }
    if (req.method === 'POST' && url.pathname === '/-/e2e/config') {
      if (!requireAdmin()) return;
      const cfg = JSON.parse(body || '{}');
      if (Number.isInteger(cfg.agentTokenTtlSeconds) && cfg.agentTokenTtlSeconds > 0) agentTokenTtlSeconds = cfg.agentTokenTtlSeconds;
      return json(res, 200, { agentTokenTtlSeconds });
    }

    // npm registry: packument and tarballs of the fixture packages. Scoped
    // names arrive as @scope%2fname or @scope/name.
    const pathname = decodeURIComponent(url.pathname);
    const tarball = /^\/(@[^/]+\/[^/]+)\/-\/([^/]+\.tgz)$/.exec(pathname);
    if (req.method === 'GET' && tarball) {
      if (!requireAuth()) return;
      const data = packages.get(tarball[1])?.tarballs.get(tarball[2]);
      if (!data) return json(res, 404, { error: 'not found' });
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': data.length });
      return res.end(data);
    }
    const packument = /^\/(@[^/]+\/[^/]+)$/.exec(pathname);
    if (req.method === 'GET' && packument) {
      if (!requireAuth()) return;
      const doc = packumentOf(packument[1]);
      if (!doc) return json(res, 404, { error: 'not found' });
      return json(res, 200, doc);
    }
    json(res, 404, { error: 'not found' });
  } catch (err) {
    json(res, 500, { error: err.message });
  }
});

await loadPackages();
server.listen(PORT, HOST, () => {
  process.stdout.write(`stub-registry listening on ${HOST}:${PORT} as ${BASE} with ${[...packages.keys()].join(', ') || 'no packages'}\n`);
});
STUB_REGISTRY_EOF
}

# write_oidc_fixture_plugin dir
write_oidc_fixture_plugin() {
  local dir="$1"
  mkdir -p "$dir"
  cat > "${dir}/package.json" <<'FIXTURE_EOF'
{
  "name": "@lamalibre/e2e-oidc-server",
  "version": "0.1.0",
  "description": "Lamaste e2e fixture: a plugin declaring OIDC clients",
  "type": "module",
  "main": "index.js",
  "files": ["index.js", "lamaste-plugin.json"],
  "license": "PolyForm-Noncommercial-1.0.0"
}
FIXTURE_EOF
  cat > "${dir}/index.js" <<'FIXTURE_EOF'
export default async function e2eOidcPlugin(fastify) {
  fastify.get('/ping', async () => ({ ok: true, plugin: 'e2e-oidc' }));
}
FIXTURE_EOF
  cat > "${dir}/lamaste-plugin.json" <<'FIXTURE_EOF'
{
  "name": "e2e-oidc",
  "displayName": "E2E OIDC Fixture",
  "version": "0.1.0",
  "description": "Declares a public device-code client and a confidential client-credentials client",
  "modes": ["server", "agent"],
  "packages": { "server": "@lamalibre/e2e-oidc-server", "agent": "@lamalibre/e2e-oidc-server" },
  "capabilities": [],
  "panel": {},
  "config": {},
  "oidcClients": [
    {
      "id": "e2e-oidc-cli",
      "name": "E2E OIDC CLI",
      "grantTypes": ["urn:ietf:params:oauth:grant-type:device_code"],
      "scopes": ["openid", "profile", "groups"],
      "audience": ["https://e2e-oidc.{domain}"],
      "accessTokenClaims": ["groups", "preferred_username"]
    },
    {
      "id": "e2e-oidc-service",
      "name": "E2E OIDC service",
      "confidential": true,
      "grantTypes": ["client_credentials"],
      "scopes": ["registry_read"],
      "audience": ["https://e2e-oidc.{domain}"]
    }
  ]
}
FIXTURE_EOF
}

# decode_jwt_payload token
# Print the JSON payload of a JWT (needs node, which every VM has).
decode_jwt_payload() {
  node -e 'const p = process.argv[1].split(".")[1]; process.stdout.write(Buffer.from(p, "base64url").toString())' "$1"
}

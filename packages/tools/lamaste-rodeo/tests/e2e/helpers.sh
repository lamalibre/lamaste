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
// Every request is recorded with the owner of the token it carried and the
// status it was answered with — what Feria's audit log says about who pulled
// what. Packuments are answered `cache-control: no-cache`, so a client sees a
// republished version at once.
//
// Admin-only e2e endpoints: GET /-/e2e/requests (what was recorded),
// POST /-/e2e/config {"agentTokenTtlSeconds": n} (lifetime of brokered tokens),
// PUT /-/e2e/packages with a package .tgz as the body (publish that version, or
// replace its tarball: the packument then advertises the new integrity, as a
// registry that serves other bytes under a published version would).
import { createServer, request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { gunzipSync } from 'node:zlib';
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
// The workload rule a real Feria carries in auth.json for the panel's
// client: read (the panel's own installs) and admin (brokering). A spec
// narrows it through /-/e2e/config to prove the panel refuses the result.
let workloadScopes = ['read', 'admin'];

const json = (res, status, payload) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(payload));
};
const readBody = (req) =>
  new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
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
const packages = new Map(); // name → { versions: { [version]: manifest }, tarballs: Map<file, Buffer> }

/** Serve `tarball` as version `pkg.version` of `pkg.name`, replacing what was there. */
function publish(pkg, tarball) {
  const unscoped = pkg.name.replace(/^@[^/]+\//, '');
  const file = `${unscoped}-${pkg.version}.tgz`;
  const dist = {
    tarball: `${BASE}/${pkg.name}/-/${file}`,
    integrity: `sha512-${crypto.createHash('sha512').update(tarball).digest('base64')}`,
    shasum: crypto.createHash('sha1').update(tarball).digest('hex'),
  };
  const entry = packages.get(pkg.name) ?? { tarballs: new Map(), versions: {} };
  entry.versions[pkg.version] = { ...pkg, dist };
  entry.tarballs.set(file, tarball);
  packages.set(pkg.name, entry);
  return dist;
}

/** The package/package.json of a package tarball (.tgz). */
function packageJsonOf(tgz) {
  const tar = gunzipSync(tgz);
  let paxPath = null;
  for (let at = 0; at + 512 <= tar.length; ) {
    const header = tar.subarray(at, at + 512);
    if (header.every((b) => b === 0)) break;
    const field = (start, length) => {
      const raw = header.subarray(start, start + length);
      const nul = raw.indexOf(0);
      return raw.subarray(0, nul === -1 ? length : nul).toString('utf8');
    };
    const size = Number.parseInt(field(124, 12).trim() || '0', 8);
    const type = String.fromCharCode(header[156]);
    const data = tar.subarray(at + 512, at + 512 + size);
    if (type === 'x') {
      paxPath = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(data.toString('utf8'))?.[1] ?? null;
    } else {
      const name = paxPath ?? (field(345, 155) ? `${field(345, 155)}/${field(0, 100)}` : field(0, 100));
      if ((type === '0' || type === '\0') && name === 'package/package.json') {
        return JSON.parse(data.toString('utf8'));
      }
      paxPath = null;
    }
    at += 512 + Math.ceil(size / 512) * 512;
  }
  throw new Error('the tarball holds no package/package.json');
}

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
    const dist = publish(pkg, await readFile(path.join(dest, info.filename)));
    if (dist.integrity !== info.integrity) {
      throw new Error(`${pkg.name}@${pkg.version}: the integrity npm reported is not the tarball's`);
    }
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
  const raw = await readBody(req);
  const body = raw.toString('utf8');
  const record = {
    at: new Date().toISOString(),
    method: req.method,
    path: decodeURIComponent(url.pathname) + url.search,
    authorization: req.headers.authorization ?? null,
    owner: principal?.owner ?? null,
    status: null,
  };
  requests.push(record);
  res.on('finish', () => {
    record.status = res.statusCode;
  });
  const requireAuth = () => {
    if (!principal) {
      json(res, 401, { error: 'authentication required' });
      return false;
    }
    return true;
  };
  const requireScope = (scope) => {
    if (!requireAuth()) return false;
    if (!principal.scopes.includes(scope)) {
      json(res, 403, { error: `requires the ${scope} scope` });
      return false;
    }
    return true;
  };
  const requireAdmin = () => requireScope('admin');

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
      // The rule a real Feria carries in auth.json: client_id lamaste-server → workloadScopes.
      const clientId = claims.client_id ?? claims.sub;
      if (clientId !== 'lamaste-server') {
        return json(res, 403, { error: 'login refused: this identity is granted no Feria access by the issuer policy' });
      }
      return json(res, 201, issue({ owner: `ci:${ISSUER_HOST}/${claims.sub}`, kind: 'ci', scopes: [...workloadScopes], label: 'lamaste-server', ttlSeconds: 3600, createdBy: 'login' }));
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
      if (Array.isArray(cfg.workloadScopes) && cfg.workloadScopes.every((s) => ['read', 'publish', 'admin'].includes(s))) {
        workloadScopes = [...cfg.workloadScopes];
      }
      return json(res, 200, { agentTokenTtlSeconds, workloadScopes });
    }
    if (req.method === 'PUT' && url.pathname === '/-/e2e/packages') {
      if (!requireAdmin()) return;
      let pkg;
      try {
        pkg = packageJsonOf(raw);
      } catch (err) {
        return json(res, 400, { error: `not a package tarball: ${err.message}` });
      }
      if (!/^@[a-z0-9-]+\/[a-z0-9][a-z0-9.-]*$/.test(pkg.name ?? '') || typeof pkg.version !== 'string') {
        return json(res, 400, { error: 'the tarball names no scoped package and version' });
      }
      const replaced = packages.get(pkg.name)?.versions[pkg.version] !== undefined;
      const dist = publish(pkg, raw);
      return json(res, 200, { name: pkg.name, version: pkg.version, replaced, ...dist });
    }

    // npm registry: packument and tarballs of the fixture packages. Scoped
    // names arrive as @scope%2fname or @scope/name.
    const pathname = decodeURIComponent(url.pathname);
    const tarball = /^\/(@[^/]+\/[^/]+)\/-\/([^/]+\.tgz)$/.exec(pathname);
    if (req.method === 'GET' && tarball) {
      if (!requireScope('read')) return;
      const data = packages.get(tarball[1])?.tarballs.get(tarball[2]);
      if (!data) return json(res, 404, { error: 'not found' });
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': data.length });
      return res.end(data);
    }
    const packument = /^\/(@[^/]+\/[^/]+)$/.exec(pathname);
    if (req.method === 'GET' && packument) {
      if (!requireScope('read')) return;
      const doc = packumentOf(packument[1]);
      if (!doc) return json(res, 404, { error: 'not found' });
      res.setHeader('cache-control', 'no-cache');
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

# write_agent_hosted_fixture_plugins dir
# Writes two agent-hosted ("hosting": "agent") plugin packages for spec 28:
#   <dir>/agent-hosted        @lamalibre/e2e-agent-hosted-server — declares a
#                             public device-code client and a capability; its
#                             main module throws the moment anything imports it
#   <dir>/agent-hosted-paged  @lamalibre/e2e-agent-hosted-paged-server — the
#                             same, plus panel pages, which the manifest schema
#                             refuses for an agent-hosted plugin
write_agent_hosted_fixture_plugins() {
  local dir="$1"
  local variant pkg name panel
  for variant in agent-hosted agent-hosted-paged; do
    pkg="@lamalibre/e2e-${variant}-server"
    name="e2e-${variant}"
    panel='{}'
    if [ "$variant" = "agent-hosted-paged" ]; then
      panel='{ "pages": [{ "path": "/builds", "title": "Builds" }] }'
    fi
    mkdir -p "${dir}/${variant}"
    cat > "${dir}/${variant}/package.json" <<FIXTURE_EOF
{
  "name": "${pkg}",
  "version": "0.1.0",
  "description": "Lamaste e2e fixture: an agent-hosted plugin the panel must never import",
  "type": "module",
  "main": "index.js",
  "files": ["index.js", "lamaste-plugin.json"],
  "license": "PolyForm-Noncommercial-1.0.0"
}
FIXTURE_EOF
    cat > "${dir}/${variant}/index.js" <<FIXTURE_EOF
// The application this stands for runs on its own agent. Lamaste must read
// lamaste-plugin.json and never load this module.
throw new Error('${name}: agent-hosted plugin code was imported');
FIXTURE_EOF
    cat > "${dir}/${variant}/lamaste-plugin.json" <<FIXTURE_EOF
{
  "name": "${name}",
  "displayName": "E2E Agent-Hosted Fixture",
  "version": "0.1.0",
  "description": "Identity only: an OIDC client and a capability, no code on the relay",
  "hosting": "agent",
  "modes": ["server"],
  "packages": { "server": "${pkg}" },
  "capabilities": ["plugin:${name}:publish"],
  "panel": ${panel},
  "oidcClients": [
    {
      "id": "${name}-cli",
      "name": "E2E agent-hosted CLI",
      "grantTypes": ["urn:ietf:params:oauth:grant-type:device_code"],
      "scopes": ["openid", "profile", "groups"],
      "audience": ["https://${name}.{domain}"],
      "accessTokenClaims": ["groups", "preferred_username"]
    }
  ]
}
FIXTURE_EOF
  done
}

# write_app_plugin_fixture dir
# Writes `@lamalibre/e2e-app-plugin-server`: an agent-hosted plugin *with an
# agent half* (manifest `agent` block) and panel pages, for specs 29 and 31.
# Its main module throws if the panel ever imports it; the admin bundle and
# every admin route come from the agent half (write_app_plugin_half).
write_app_plugin_fixture() {
  local dir="$1"
  local pkg="@lamalibre/e2e-app-plugin-server"
  local name="e2e-app-plugin"
  mkdir -p "${dir}"
  cat > "${dir}/package.json" <<FIXTURE_EOF
{
  "name": "${pkg}",
  "version": "0.1.0",
  "description": "Lamaste e2e fixture: an agent-hosted plugin with an agent half",
  "type": "module",
  "main": "index.js",
  "files": ["index.js", "lamaste-plugin.json"],
  "license": "PolyForm-Noncommercial-1.0.0"
}
FIXTURE_EOF
  cat > "${dir}/index.js" <<FIXTURE_EOF
// The application runs on its hosting agent; the panel forwards to it and
// never loads this module.
throw new Error('${name}: agent-hosted plugin code was imported');
FIXTURE_EOF
  cat > "${dir}/lamaste-plugin.json" <<FIXTURE_EOF
{
  "name": "${name}",
  "displayName": "E2E App Plugin",
  "version": "0.1.0",
  "description": "An agent half on the hosting agent, admin pages in the panel",
  "hosting": "agent",
  "agent": { "requires": { "node": ">=22", "os": ["linux"] } },
  "modes": ["server"],
  "packages": { "server": "${pkg}" },
  "capabilities": ["plugin:${name}:use"],
  "panel": {
    "pages": [{ "path": "/status", "title": "Status", "icon": "activity" }],
    "apiPrefix": "/api/${name}"
  }
}
FIXTURE_EOF
}

# write_app_plugin_half file
# Writes the fixture's agent half, installed by hand (the slice 2a way): a
# Node HTTP server on 127.0.0.1:<port> (the port from the plugin config the
# agent fetched; agentHalfListenTarget, which a half without a socket unit
# binds itself) whose /admin/* routes accept only requests with a valid
# caller assertion, verified with @lamalibre/lamaste/agent's
# createCallerAssertionVerifier.
#
#   node app-plugin-half.mjs --config <plugin config json> --plugin <route> \
#     --lamaste <dir of the @lamalibre/lamaste package> [--log <file>] \
#     [--flags <dir>] [--wait-config] [--manifest <file> --data <dir>]
#
# Every answer to a verified request authenticates itself with
# X-Lamalibre-Responder, as the relay requires of an agent half: core's
# handlers return it (their `headers`, sent with exactly their `bodyText`);
# the half's own routes add responderHeaderFor (the `-` form a forwarded
# caller expects) — or, answering Lamaste's own call (caller `lamaste`, a
# buffered answer), the form over the exact body. Answers before or instead
# of a verification (401, a path outside /admin) carry none.
#
# Lifecycle hooks (4.3): /admin/hooks/<stage> answered by
# createAgentHookHandler (Lamaste's calls only); each stage logs a line
# `hook <stage> phase=… reason=… state=…`, and <flags>/fail-<stage> makes it
# refuse. --wait-config waits for the agent's sync to deliver the config.
#
# Settings (slice 4), with --manifest: the manifest's settings block is the
# schema of a settings store (createSettingsStore) over --data, which must
# exist; /admin/settings* is answered by createSettingsHandler (Lamaste's
# calls only, a line `<method> <url> <status> settings-call` each) and
# /admin/probe/settings shows what the store holds — the effective values
# and the SHA-256 of each secret, never a secret's value. Without
# --manifest, Lamaste's /admin/settings calls get the verified 404 below —
# authenticated, so the relay knows the half has no settings.
#
# Routes: /admin/health (createHealthHandler, a line `GET /admin/health
# <status> health-call` each), /admin/ping (echoes caller, path, what
# headers arrived), /admin/panel.js (a mount(ctx) bundle), /admin/echo
# (POST, counts bytes), /admin/events (3 server-sent events),
# /admin/unsafe-headers (sets Service-Worker-Allowed, Clear-Site-Data and
# X-E2E-Kept: what the forwarder must strip, and a header it passes),
# anything else under /admin is 404. /app/* is the user surface and answers
# without an assertion — the forwarder must never reach it. One log line per
# request.
write_app_plugin_half() {
  local dest="$1"
  cat > "$dest" <<'HALF_EOF'
import crypto from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};
const configPath = opt('--config');
const plugin = opt('--plugin');
const lamasteDir = opt('--lamaste');
const logFile = opt('--log');
const flagsDir = opt('--flags');
const manifestPath = opt('--manifest');
const dataDir = opt('--data');
if (!configPath || !plugin || !lamasteDir || (manifestPath && !dataDir)) {
  console.error('usage: app-plugin-half.mjs --config <file> --plugin <route> --lamaste <dir> [--log <file>] [--flags <dir>] [--wait-config] [--manifest <file> --data <dir>]');
  process.exit(2);
}
// --wait-config: the agent's sync delivers the config after the half starts.
if (args.includes('--wait-config')) {
  while (!existsSync(configPath)) await new Promise((r) => setTimeout(r, 500));
}
const agentLib = await import(pathToFileURL(path.join(lamasteDir, 'dist', 'agent', 'index.js')).href);
// The relay believes no answer of an agent half that does not authenticate
// itself: a @lamalibre/lamaste without these cannot serve it at all.
const needed = ['createCallerAssertionVerifier', 'createAgentHookHandler', 'createHealthHandler', 'responderHeaderFor', 'agentHalfListenTarget'];
const missing = needed.filter((name) => typeof agentLib[name] !== 'function');
if (missing.length > 0) {
  console.error(`${lamasteDir}: this @lamalibre/lamaste has no ${missing.join(', ')} — it predates authenticated agent-half answers`);
  process.exit(2);
}
const verifier = agentLib.createCallerAssertionVerifier({ configPath, plugin, reloadIntervalMs: 500 });
const port = await verifier.port();
const callerName = (c) => (c.type === 'agent' ? `agent:${c.label}` : c.type);
const healthHandler = agentLib.createHealthHandler({ verifier });

// Lifecycle hooks (4.3): each stage logs what it was called with; a file
// <flags>/fail-<stage> makes that stage refuse.
const failing = (stage) => Boolean(flagsDir) && existsSync(path.join(flagsDir, `fail-${stage}`));
const hookFor = (stage) => (input) => {
  log(`hook ${stage} phase=${input.phase ?? '-'} reason=${input.reason ?? '-'} state=${input.state ?? '-'}`);
  return failing(stage) ? { ok: false, reason: `e2e: ${stage} refused by flag` } : { ok: true, output: { stage } };
};
const hookHandler = agentLib.createAgentHookHandler({
  verifier,
  hooks: Object.fromEntries(
    ['install:pre-tunnel', 'install:post-tunnel', 'uninstall:pre-teardown', 'uninstall:post-teardown', 'tunnel:down', 'tunnel:up'].map((s) => [s, hookFor(s)]),
  ),
});

// Settings (slice 4): the manifest's settings block is the store's schema;
// Lamaste alone reads and changes them through /admin/settings.
let settings = null;
let settingsHandler = null;
if (manifestPath) {
  if (!agentLib.createSettingsStore) {
    console.error('--manifest: this @lamalibre/lamaste has no plugin settings');
    process.exit(2);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  settings = agentLib.createSettingsStore({ dataDir, settings: agentLib.settingsFromManifest(manifest) });
  await settings.load();
  settingsHandler = agentLib.createSettingsHandler({ verifier, store: settings });
}
// What the store holds: the effective values and, for each secret that is
// set, the SHA-256 of its value — never the value.
function settingsProbe() {
  const state = settings.state();
  const secretDigests = {};
  for (const key of Object.keys(state.secrets)) {
    const value = settings.secret(key);
    if (value !== undefined) secretDigests[key] = crypto.createHash('sha256').update(value, 'utf8').digest('hex');
  }
  return {
    schemaVersion: state.schemaVersion,
    revision: state.revision,
    configured: state.configured,
    missing: state.missing,
    values: settings.values(),
    stored: state.values,
    secretsSetAt: state.secrets,
    secretDigests,
  };
}

function log(line) {
  const text = `${new Date().toISOString()} ${line}\n`;
  process.stdout.write(text);
  if (logFile) appendFileSync(logFile, text);
}

// The responder header core's handlers set (RESPONDER_HEADER of
// @lamalibre/lamaste), for the answers this half gives Lamaste's own calls.
const RESPONDER_HEADER = 'x-lamalibre-responder';

// The X-Lamalibre-Responder header of an answer to a verified request: over
// the exact body for Lamaste's own calls (caller `lamaste`: buffered by the
// relay), the `-` form (responderHeaderFor) for a forwarded caller.
function responderOf(verified, status, text) {
  return verified.payload.caller.type === 'lamaste'
    ? { [RESPONDER_HEADER]: verified.responder(status, text) }
    : agentLib.responderHeaderFor(verified, status);
}

// send(res, status, headers, text, verified) — a buffered answer;
// authenticated when it answers a verified request
function send(res, status, headers, text, verified = null) {
  res.writeHead(status, { ...headers, ...(verified ? responderOf(verified, status, text) : {}) });
  res.end(text);
}

function json(res, status, body, extraHeaders = {}, verified = null) {
  send(res, status, { 'content-type': 'application/json', ...extraHeaders }, JSON.stringify(body), verified);
}

// What core's handlers answer: exactly their bytes, with their headers
// (the responder header among them when the request verified).
function answer(res, out) {
  res.writeHead(out.status, out.headers);
  res.end(out.bodyText);
}

async function bodyOf(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const p = url.pathname;
  if (p.startsWith('/app/')) {
    log(`${req.method} ${req.url} 200 user-surface`);
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('USER SURFACE — reachable only through a user-surface tunnel');
    return;
  }
  if (p !== '/admin' && !p.startsWith('/admin/')) {
    log(`${req.method} ${req.url} 404 outside`);
    json(res, 404, { error: 'not found' });
    return;
  }
  if (p.startsWith('/admin/hooks/')) {
    const out = await hookHandler.handle({ method: req.method, url: req.url, headers: req.headers, body: await bodyOf(req) });
    log(`${req.method} ${req.url} ${out.status} hook-call`);
    answer(res, out);
    return;
  }
  if (settingsHandler && (p === '/admin/settings' || p.startsWith('/admin/settings/'))) {
    const out = await settingsHandler.handle({ method: req.method, url: req.url, headers: req.headers, body: await bodyOf(req) });
    log(`${req.method} ${req.url} ${out.status} settings-call`);
    answer(res, out);
    return;
  }
  if (p === '/admin/health') {
    const out = await healthHandler.handle({ method: req.method, url: req.url, headers: req.headers, body: await bodyOf(req) });
    log(`${req.method} ${req.url} ${out.status} health-call`);
    answer(res, out);
    return;
  }
  const result = await verifier.verify(req.headers, req.method, req.url);
  if (!result.ok) {
    log(`${req.method} ${req.url} 401 refused=${result.reason}`);
    json(res, 401, { error: 'caller assertion refused', reason: result.reason });
    return;
  }
  const caller = callerName(result.payload.caller);
  if (p === '/admin/ping' || p === '/admin') {
    log(`${req.method} ${req.url} 200 caller=${caller}`);
    json(res, 200, {
      pong: true,
      caller: result.payload.caller,
      path: req.url,
      cookie: req.headers.cookie ?? null,
      authorization: req.headers.authorization ?? null,
      sslClientDn: req.headers['x-ssl-client-dn'] ?? null,
    }, {}, result);
    return;
  }
  if (p === '/admin/panel.js') {
    log(`${req.method} ${req.url} 200 caller=${caller}`);
    send(
      res,
      200,
      { 'content-type': 'application/javascript' },
      `window.__lamalibrePlugins = window.__lamalibrePlugins || {};\n` +
        `window.__lamalibrePlugins[${JSON.stringify(plugin)}] = { mount(ctx) { ctx.mountPoint.textContent = 'E2E app plugin — served by the agent half'; return () => {}; } };\n`,
      result,
    );
    return;
  }
  if (p === '/admin/probe/settings' && settings) {
    log(`${req.method} ${req.url} 200 caller=${caller}`);
    json(res, 200, settingsProbe(), {}, result);
    return;
  }
  if (p === '/admin/echo' && req.method === 'POST') {
    let bytes = 0;
    req.on('data', (c) => (bytes += c.length));
    req.on('end', () => {
      log(`POST ${req.url} 200 caller=${caller} bytes=${bytes}`);
      json(res, 200, { bytes }, { 'set-cookie': 'app-session=should-not-pass' }, result);
    });
    return;
  }
  if (p === '/admin/unsafe-headers') {
    // Headers that would let a plugin's page take over the panel's origin
    // (a service worker's scope, wiping the panel's storage): the forwarder
    // strips them. X-E2E-Kept is an ordinary header it passes.
    log(`${req.method} ${req.url} 200 caller=${caller}`);
    json(
      res,
      200,
      { served: true },
      { 'service-worker-allowed': '/', 'clear-site-data': '"cache", "cookies", "storage"', 'x-e2e-kept': 'kept' },
      result,
    );
    return;
  }
  if (p === '/admin/events') {
    log(`${req.method} ${req.url} 200 caller=${caller} sse`);
    // A stream: the `-` form, over the status alone.
    res.writeHead(200, { 'content-type': 'text/event-stream', ...agentLib.responderHeaderFor(result, 200) });
    let n = 0;
    const timer = setInterval(() => {
      n += 1;
      res.write(`data: tick ${n}\n\n`);
      if (n === 3) {
        clearInterval(timer);
        res.end();
      }
    }, 200);
    return;
  }
  // Routes the request-hook specs use (4.3).
  if (p.startsWith('/admin/import/') && req.method === 'POST') {
    let bytes = 0;
    req.on('data', (c) => (bytes += c.length));
    req.on('end', () => {
      log(`POST ${req.url} 200 caller=${caller} bytes=${bytes} validated=${req.headers['x-validated'] ?? '-'}`);
      json(res, 200, { imported: true, bytes, validated: req.headers['x-validated'] ?? null }, {}, result);
    });
    return;
  }
  if (p.startsWith('/admin/export/')) {
    log(`${req.method} ${req.url} 200 caller=${caller} encoding=${req.headers['accept-encoding'] ?? '-'}`);
    // A planted credential the relay's secret scanner must redact.
    json(res, 200, { rows: 2, token: 'ghp_' + 'E2eToken0'.repeat(4), total: '12345678901234567890' }, { etag: '"e2e"' }, result);
    return;
  }
  if (p === '/admin/report') {
    log(`${req.method} ${req.url} 200 caller=${caller}`);
    send(res, 200, { 'content-type': 'text/plain' }, 'quarterly report — BLOCKME', result);
    return;
  }
  if (p === '/admin/stuck') {
    log(`${req.method} ${req.url} 200 caller=${caller}`);
    json(res, 200, { reached: true }, {}, result);
    return;
  }
  // Authenticated like any answer to a verified request: for Lamaste's
  // /admin/settings calls to a half without settings, the relay's proof
  // that the half itself has none (settings_unsupported).
  log(`${req.method} ${req.url} 404 caller=${caller}`);
  json(res, 404, { error: 'no such admin route' }, {}, result);
});

// Installed by hand, without a socket unit: the half binds the plugin
// config's port itself (agentHalfListenTarget gives the systemd socket only
// under the unit lamaste-apphost writes).
server.listen(agentLib.agentHalfListenTarget({ port }), () => log(`listening on 127.0.0.1:${port} for plugin ${plugin}`));
HALF_EOF
}

# write_hooks_fixture_plugin dir name version mode agent-hooks-json
# An agent-hosted plugin with lifecycle hooks (4.3): package
# @lamalibre/<name>-server at <version>. Its relay module (hooks/relay.mjs,
# self-contained) runs in Lamaste's hook runner and reports what the
# sandbox let it do as an audit effect (`hook.sandbox.probe`). <mode>:
#   main      — every relay stage succeeds; request hooks on
#               POST /admin/import/* (rejects {"valid":false}),
#               GET /admin/stuck (never answers: a busy loop),
#               GET /admin/export/* (lamaste:secret-scan) and
#               GET /admin/report (blocks a body containing BLOCKME);
#               tunnel:down returns a 503 maintenance fallback
#   failpre   — relay install:pre-tunnel refuses
#   failpost  — relay install:post-tunnel refuses
# Every relay lifecycle stage records `hook.<stage-with-dots>` with its phase.
# <agent-hooks-json> is the manifest's `hooks.agent` block ('{}' for none).
# [revision] (default 1) changes the relay module's bytes — and so the hook
# set's digest — without changing what it does; the version alone does not.
write_hooks_fixture_plugin() {
  local dir="$1" name="$2" version="$3" mode="$4" agent_hooks="$5" revision="${6:-1}"
  local pkg="@lamalibre/${name}-server"
  mkdir -p "${dir}/hooks"
  cat > "${dir}/package.json" <<FIXTURE_EOF
{
  "name": "${pkg}",
  "version": "${version}",
  "description": "Lamaste e2e fixture: an agent-hosted plugin with lifecycle hooks (${mode})",
  "type": "module",
  "main": "index.js",
  "files": ["index.js", "lamaste-plugin.json", "hooks"],
  "license": "PolyForm-Noncommercial-1.0.0"
}
FIXTURE_EOF
  cat > "${dir}/index.js" <<FIXTURE_EOF
throw new Error('${name}: agent-hosted plugin code was imported by the panel');
FIXTURE_EOF
  local request_hooks='[]'
  if [ "${mode}" = "main" ]; then
    request_hooks='[
      { "stage": "pre-forward", "routes": ["POST /admin/import/*", "GET /admin/stuck"], "body": { "maxBytes": 4096 }, "timeoutMs": 1000 },
      { "stage": "post-forward", "use": "lamaste:secret-scan", "routes": ["GET /admin/export/*"], "body": { "maxBytes": 65536 } },
      { "stage": "post-forward", "routes": ["GET /admin/report"], "body": { "maxBytes": 65536 } }
    ]'
  fi
  cat > "${dir}/lamaste-plugin.json" <<FIXTURE_EOF
{
  "name": "${name}",
  "displayName": "E2E Hooks ${mode}",
  "version": "${version}",
  "description": "Lifecycle hooks fixture (${mode})",
  "hosting": "agent",
  "agent": { "requires": { "node": ">=22", "os": ["linux"] } },
  "modes": ["server"],
  "packages": { "server": "${pkg}" },
  "capabilities": ["plugin:${name}:use"],
  "hooks": {
    "relay": {
      "entry": "hooks/relay.mjs",
      "effects": ["audit", "notify-admins"],
      "install": { "pre-tunnel": {}, "post-tunnel": {} },
      "uninstall": { "pre-teardown": {}, "post-teardown": {} },
      "request": ${request_hooks},
      "tunnel": { "down": {}, "up": {} }
    },
    "agent": ${agent_hooks}
  }
}
FIXTURE_EOF
  cat > "${dir}/hooks/relay.mjs" <<FIXTURE_EOF
// e2e relay hooks — mode ${mode}, revision ${revision}. Self-contained: the
// runner may read nothing but this file.
const MODE = '${mode}';
export const REVISION = '${revision}';
import fs from 'node:fs';
import net from 'node:net';

const attempt = async (fn) => {
  try {
    await fn();
    return 'ALLOWED';
  } catch (err) {
    return String(err && (err.code || err.name) || 'error');
  }
};
const connect = (opts) =>
  new Promise((resolve) => {
    let s;
    try {
      s = net.connect(opts);
    } catch (err) {
      resolve(String(err.code || err.name));
      return;
    }
    const timer = setTimeout(() => {
      s.destroy();
      resolve('TIMEOUT');
    }, 3000);
    s.once('connect', () => {
      clearTimeout(timer);
      s.destroy();
      resolve('CONNECTED');
    });
    s.once('error', (err) => {
      clearTimeout(timer);
      resolve(String(err.code || err.name));
    });
  });

async function probe() {
  return {
    readLamaste: await attempt(() => fs.readFileSync('/etc/lamalibre/lamaste/panel.json')),
    readPasswd: await attempt(() => fs.readFileSync('/etc/passwd')),
    write: await attempt(() => fs.writeFileSync('/tmp/e2e-hook-escape', 'x')),
    spawn: await attempt(async () => (await import('node:child_process')).execFileSync('/bin/true')),
    worker: await attempt(async () => new (await import('node:worker_threads')).Worker('1', { eval: true })),
    tcpOut: await connect({ host: '1.1.1.1', port: 443 }),
    tcpPanel: await connect({ host: '127.0.0.1', port: 3100 }),
    journal: await connect({ path: '/run/systemd/journal/stdout' }),
    dbus: await connect({ path: '/run/dbus/system_bus_socket' }),
    uid: typeof process.getuid === 'function' ? process.getuid() : -1,
    envKeys: Object.keys(process.env).length,
  };
}

const lifecycle = (stage) => async (input) => {
  const effects = [{ type: 'audit', event: stage.replace(':', '.'), data: { phase: input.phase, version: input.version } }];
  if (stage === 'install:pre-tunnel') {
    effects.push({ type: 'audit', event: 'sandbox.probe', data: await probe() });
    if (MODE === 'failpre') return { ok: false, reason: 'e2e: refused before the tunnel', effects };
  }
  if (stage === 'install:post-tunnel' && MODE === 'failpost') {
    return { ok: false, reason: 'e2e: refused after the tunnel', effects };
  }
  return { ok: true, output: { stage }, effects };
};

export default {
  'install:pre-tunnel': lifecycle('install:pre-tunnel'),
  'install:post-tunnel': lifecycle('install:post-tunnel'),
  'uninstall:pre-teardown': lifecycle('uninstall:pre-teardown'),
  'uninstall:post-teardown': lifecycle('uninstall:post-teardown'),
  'request:pre-forward': (req) => {
    if (req.path === '/admin/stuck') {
      for (;;) {
        // never decides: the runner must be replaced
      }
    }
    let data = null;
    try {
      data = req.body ? req.body.json() : null;
    } catch {
      return { action: 'reject', status: 400, body: { error: 'not JSON' } };
    }
    if (!data || data.valid !== true) {
      return { action: 'reject', status: 422, body: { error: 'invalid import' }, effects: [{ type: 'audit', event: 'import.rejected' }] };
    }
    return { action: 'continue', setHeaders: { 'x-validated': 'yes' } };
  },
  'request:post-forward': (res) =>
    res.body && res.body.text().includes('BLOCKME')
      ? { action: 'block', reasonId: 'e2e.blocked' }
      : { action: 'pass' },
  'tunnel:down': (state) => ({
    fallback: { status: 503, retryAfter: 30, body: { error: 'maintenance', reason: state.reason } },
    effects: [
      { type: 'notify-admins', level: 'warning', message: 'e2e hooks plugin down (' + state.reason + ')' },
      { type: 'audit', event: 'tunnel.down', data: { reason: state.reason } },
    ],
  }),
  'tunnel:up': () => ({ effects: [{ type: 'audit', event: 'tunnel.up' }] }),
};
FIXTURE_EOF
}

# settings_block_json v1|v2
# The settings block of the settings fixtures (slice 4), as it sits in a
# manifest:
#   v1 (schemaVersion 1)  apiKey    secret, required
#                         schedule  string, pattern ^HH:MM$, default "06:00"
#                         retries   integer 0..10, default 3
#                         region    enum eu | us, optional, no default
#                         verbose   boolean, default false
#   v2 (schemaVersion 2)  as v1, except: retries is a string (default "3") —
#                         a retyped field, whose stored value is dropped,
#                         never converted — and endpoint, a new required
#                         string without a default
#   v3 (schemaVersion 3)  as v2, except: apiKey is a plain required string —
#                         a secret turned into a plain field (secretToPlain),
#                         which auto-approve never covers and whose stored
#                         secret is dropped
settings_block_json() {
  case "$1" in
    v1)
      cat <<'SETTINGS_EOF'
{
    "schemaVersion": 1,
    "fields": [
      { "key": "apiKey", "label": "API key", "type": "secret", "required": true, "description": "Held by the agent half alone" },
      { "key": "schedule", "label": "Schedule", "type": "string", "pattern": "^([01][0-9]|2[0-3]):[0-5][0-9]$", "default": "06:00", "description": "When to sync, HH:MM" },
      { "key": "retries", "label": "Retries", "type": "integer", "min": 0, "max": 10, "default": 3 },
      { "key": "region", "label": "Region", "type": "enum", "options": [{ "value": "eu", "label": "Europe" }, { "value": "us", "label": "United States" }] },
      { "key": "verbose", "label": "Verbose logging", "type": "boolean", "default": false }
    ]
  }
SETTINGS_EOF
      ;;
    v2)
      cat <<'SETTINGS_EOF'
{
    "schemaVersion": 2,
    "fields": [
      { "key": "apiKey", "label": "API key", "type": "secret", "required": true, "description": "Held by the agent half alone" },
      { "key": "schedule", "label": "Schedule", "type": "string", "pattern": "^([01][0-9]|2[0-3]):[0-5][0-9]$", "default": "06:00", "description": "When to sync, HH:MM" },
      { "key": "retries", "label": "Retries", "type": "string", "default": "3", "description": "A count or a policy name" },
      { "key": "region", "label": "Region", "type": "enum", "options": [{ "value": "eu", "label": "Europe" }, { "value": "us", "label": "United States" }] },
      { "key": "verbose", "label": "Verbose logging", "type": "boolean", "default": false },
      { "key": "endpoint", "label": "Endpoint", "type": "string", "required": true, "maxLength": 200, "description": "The upstream service's base URL" }
    ]
  }
SETTINGS_EOF
      ;;
    v3)
      cat <<'SETTINGS_EOF'
{
    "schemaVersion": 3,
    "fields": [
      { "key": "apiKey", "label": "API key", "type": "string", "required": true, "maxLength": 200, "description": "No longer a secret: kept on the relay, shown in clear" },
      { "key": "schedule", "label": "Schedule", "type": "string", "pattern": "^([01][0-9]|2[0-3]):[0-5][0-9]$", "default": "06:00", "description": "When to sync, HH:MM" },
      { "key": "retries", "label": "Retries", "type": "string", "default": "3", "description": "A count or a policy name" },
      { "key": "region", "label": "Region", "type": "enum", "options": [{ "value": "eu", "label": "Europe" }, { "value": "us", "label": "United States" }] },
      { "key": "verbose", "label": "Verbose logging", "type": "boolean", "default": false },
      { "key": "endpoint", "label": "Endpoint", "type": "string", "required": true, "maxLength": 200, "description": "The upstream service's base URL" }
    ]
  }
SETTINGS_EOF
      ;;
    *)
      echo "settings_block_json: unknown schema $1" >&2
      return 2
      ;;
  esac
}

# write_settings_fixture_plugins dir
# Agent-hosted plugins declaring settings (slice 4), for single-VM spec 31;
# each in <dir>/<variant>, package @lamalibre/<name>-server:
#   ok             e2e-settings — an agent block and the v1 settings block
#                  (settings_block_json); its agent half is
#                  write_app_plugin_half --manifest <dir>/ok/lamaste-plugin.json
#   noagent        e2e-settings-noagent — settings without an agent block
#   secretdefault  e2e-settings-secretdefault — a secret with a default
#   badpattern     e2e-settings-badpattern — a pattern that does not compile
#   toomany        e2e-settings-toomany — 51 fields
# Every variant but ok is refused at install. Their main modules throw if
# the panel ever imports them.
write_settings_fixture_plugins() {
  local dir="$1"
  local variant name pkg agent settings fields i
  for variant in ok noagent secretdefault badpattern toomany; do
    name="e2e-settings-${variant}"
    agent='
  "agent": { "requires": { "node": ">=22", "os": ["linux"] } },'
    case "$variant" in
      ok)
        name="e2e-settings"
        settings="$(settings_block_json v1)"
        ;;
      noagent)
        agent=''
        settings="$(settings_block_json v1)"
        ;;
      secretdefault)
        settings='{
    "schemaVersion": 1,
    "fields": [{ "key": "apiKey", "label": "API key", "type": "secret", "required": true, "default": "e2e-default-secret" }]
  }'
        ;;
      badpattern)
        settings='{
    "schemaVersion": 1,
    "fields": [{ "key": "schedule", "label": "Schedule", "type": "string", "pattern": "([0-9]{2}" }]
  }'
        ;;
      toomany)
        fields=""
        for i in $(seq 1 51); do
          fields="${fields}${fields:+,
}      { \"key\": \"f${i}\", \"label\": \"Field ${i}\", \"type\": \"boolean\" }"
        done
        settings="{
    \"schemaVersion\": 1,
    \"fields\": [
${fields}
    ]
  }"
        ;;
    esac
    pkg="@lamalibre/${name}-server"
    mkdir -p "${dir}/${variant}"
    cat > "${dir}/${variant}/package.json" <<FIXTURE_EOF
{
  "name": "${pkg}",
  "version": "1.0.0",
  "description": "Lamaste e2e fixture: an agent-hosted plugin declaring settings (${variant})",
  "type": "module",
  "main": "index.js",
  "files": ["index.js", "lamaste-plugin.json"],
  "license": "PolyForm-Noncommercial-1.0.0"
}
FIXTURE_EOF
    cat > "${dir}/${variant}/index.js" <<FIXTURE_EOF
// The application runs on its hosting agent; the panel never loads this module.
throw new Error('${name}: agent-hosted plugin code was imported');
FIXTURE_EOF
    cat > "${dir}/${variant}/lamaste-plugin.json" <<FIXTURE_EOF
{
  "name": "${name}",
  "displayName": "E2E Settings (${variant})",
  "version": "1.0.0",
  "description": "Settings an admin configures; the agent half holds them",
  "hosting": "agent",${agent}
  "modes": ["server"],
  "packages": { "server": "${pkg}" },
  "capabilities": ["plugin:${name}:use"],
  "settings": ${settings}
}
FIXTURE_EOF
  done
}

# write_app_install_fixture dir name version mode build-id [system-packages-json] [settings]
# An agent-hosted plugin whose agent half Lamaste installs onto the hosting
# agent itself (slice 3) — two packages at <version>:
#   <dir>/server  @lamalibre/<name>-server: the manifest — hosting "agent";
#                 agent.requires Node.js >=22, Linux and <system-packages-json>
#                 (default ["sqlite3"]); agent.package @lamalibre/<name>-agent;
#                 agent.service dist/agentd.mjs with MemoryMax 256M; admin
#                 pages; agent hooks for the install and uninstall stages.
#                 Its main module throws if the panel ever imports it.
#   <dir>/agent   @lamalibre/<name>-agent: ONE bundled ES module,
#                 dist/agentd.mjs, built with esbuild (build-app-agent-half.js,
#                 next to this file) from <dir>/agent-src against this
#                 workspace's @lamalibre/lamaste/agent — no runtime
#                 dependencies, as real app plugins ship.
# The agent half reads LAMASTE_APP_CONFIG with createCallerAssertionVerifier
# (re-read on a signature it cannot verify), listens where
# agentHalfListenTarget says — under the unit lamaste-apphost writes, the
# socket systemd holds on 127.0.0.1:<the config's port> and passes it as
# descriptor 3 — and answers /admin/health (createHealthHandler), /admin/ping
# (caller, its package version, its account, its data, how it listens),
# /admin/panel.js, /admin/sandbox (what its unit lets it write, read and
# send) and /admin/hooks/* (createAgentHookHandler: Lamaste's calls only;
# each stage logs `hook <stage> phase=… version=…` to the journal). Every
# answer to a verified request carries X-Lamalibre-Responder (core's
# handlers' headers; responderHeaderFor on its own routes, over the exact
# body for a `lamaste` caller). LAMASTE_APP_DATA_DIR/state.json counts its
# starts under one random instance id: data that is kept keeps the id.
# <mode>:
#   main      — every hook stage succeeds
#   failpost  — install:post-tunnel refuses: a bad release
#   deps      — the agent package declares `dependencies`, which the agent's
#               root helper refuses (an agent half ships bundled)
#   tampered  — as main, other bytes: what a registry serving something else
#               under a published version hands out
# <settings> (slice 4; default none): v1, v2 or v3 puts that settings block
# (settings_block_json) in the manifest. The agent half is built with a copy
# of the manifest (agent-src/lamaste-plugin.json) and keeps the settings its
# block declares: createSettingsStore over LAMASTE_APP_DATA_DIR
# (settings.json, secrets.json), /admin/settings* answered by
# createSettingsHandler (Lamaste's calls only; each logs
# `settings <method> <path> <status>`, each change
# `settings revision=… configured=… missing=…`), and /admin/probe/settings —
# its schema version, revision, configured, missing, effective values,
# stored values and the SHA-256 of each secret that is set, never a value.
# Without a settings block none of this exists.
# <build-id> goes into the agent package, so each run's tarballs — and their
# integrity — are new: an agent's npm cache never answers for the registry.
# Needs node, this workspace's node_modules (esbuild) and its core library
# build (packages/core/lib/dist).
write_app_install_fixture() {
  local dir="$1" name="$2" version="$3" mode="$4" build_id="$5"
  local system_packages="${6:-[\"sqlite3\"]}"
  local settings_schema="${7:-none}"
  local server_pkg="@lamalibre/${name}-server"
  local agent_pkg="@lamalibre/${name}-agent"
  local here deps='' settings_entry=''
  here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  case "$mode" in
    main | failpost | deps | tampered) ;;
    *)
      echo "write_app_install_fixture: unknown mode ${mode}" >&2
      return 2
      ;;
  esac
  if ! [[ "$name" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?$ ]] || ! [[ "$build_id" =~ ^[A-Za-z0-9._-]+$ ]]; then
    echo "write_app_install_fixture: invalid name or build id" >&2
    return 2
  fi
  case "$settings_schema" in
    none) ;;
    v1 | v2 | v3)
      settings_entry=",
  \"settings\": $(settings_block_json "$settings_schema")"
      ;;
    *)
      echo "write_app_install_fixture: unknown settings schema ${settings_schema}" >&2
      return 2
      ;;
  esac
  if [ "$mode" = "deps" ]; then
    deps=',
  "dependencies": { "left-pad": "1.3.0" }'
  fi
  mkdir -p "${dir}/server" "${dir}/agent/dist" "${dir}/agent-src"

  cat > "${dir}/server/package.json" <<FIXTURE_EOF
{
  "name": "${server_pkg}",
  "version": "${version}",
  "description": "Lamaste e2e fixture: an app plugin whose agent half Lamaste installs (${mode})",
  "type": "module",
  "main": "index.js",
  "files": ["index.js", "lamaste-plugin.json"],
  "license": "PolyForm-Noncommercial-1.0.0"
}
FIXTURE_EOF
  cat > "${dir}/server/index.js" <<FIXTURE_EOF
// The application runs on its hosting agent; the panel forwards to it and
// never loads this module.
throw new Error('${name}: agent-hosted plugin code was imported');
FIXTURE_EOF
  cat > "${dir}/server/lamaste-plugin.json" <<FIXTURE_EOF
{
  "name": "${name}",
  "displayName": "E2E App Host (${mode})",
  "version": "${version}",
  "description": "An agent half Lamaste installs onto its hosting agent, admin pages in the panel",
  "hosting": "agent",
  "agent": {
    "requires": { "node": ">=22", "os": ["linux"], "systemPackages": ${system_packages} },
    "package": "${agent_pkg}",
    "service": { "entry": "dist/agentd.mjs", "memoryMax": "256M" }
  },
  "modes": ["server"],
  "packages": { "server": "${server_pkg}" },
  "capabilities": ["plugin:${name}:use"],
  "panel": {
    "pages": [{ "path": "/status", "title": "Status", "icon": "activity" }],
    "apiPrefix": "/api/${name}"
  },
  "hooks": {
    "agent": {
      "install": { "pre-tunnel": {}, "post-tunnel": {} },
      "uninstall": { "pre-teardown": {}, "post-teardown": {} }
    }
  }${settings_entry}
}
FIXTURE_EOF
  # The agent half's own copy of the manifest: its settings block is the
  # schema of the settings the agent half keeps.
  cp "${dir}/server/lamaste-plugin.json" "${dir}/agent-src/lamaste-plugin.json"

  cat > "${dir}/agent/package.json" <<FIXTURE_EOF
{
  "name": "${agent_pkg}",
  "version": "${version}",
  "description": "Lamaste e2e fixture: the bundled agent half of ${name} (${mode}, build ${build_id})",
  "type": "module",
  "files": ["dist"],
  "license": "PolyForm-Noncommercial-1.0.0"${deps}
}
FIXTURE_EOF
  cat > "${dir}/agent-src/agentd.mjs" <<'AGENTD_EOF'
// E2E app plugin — the agent half Lamaste installs onto its hosting agent.
// Bundled into one ES module (build-app-agent-half.js defines __E2E_ROUTE__
// and __E2E_MODE__, and inlines the manifest copy next to this file); runs
// under the unit lamaste-apphost writes, as the plugin's own account, with
// its config and data paths in the environment and its listening socket —
// systemd's, from the socket unit beside it — as descriptor 3.
import crypto from 'node:crypto';
import dgram from 'node:dgram';
import {
  closeSync,
  fsyncSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  agentHalfListenTarget,
  createAgentHookHandler,
  createCallerAssertionVerifier,
  createHealthHandler,
  createSettingsHandler,
  createSettingsStore,
  responderHeaderFor,
  settingsFromManifest,
} from '@lamalibre/lamaste/agent';
import MANIFEST from './lamaste-plugin.json';

const ROUTE = __E2E_ROUTE__;
const MODE = __E2E_MODE__;
const HOOK_STAGES = ['install:pre-tunnel', 'install:post-tunnel', 'uninstall:pre-teardown', 'uninstall:post-teardown'];

const configPath = process.env.LAMASTE_APP_CONFIG;
const dataDir = process.env.LAMASTE_APP_DATA_DIR;
if (!configPath || !dataDir) {
  process.stderr.write('LAMASTE_APP_CONFIG and LAMASTE_APP_DATA_DIR are not set: run as the unit lamaste-apphost writes\n');
  process.exit(2);
}
const log = (line) => process.stdout.write(`${line}\n`);

// This file is <package>/dist/agentd.mjs: the version that runs is its package's.
const packageDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const VERSION = JSON.parse(readFileSync(path.join(packageDir, 'package.json'), 'utf8')).version;
const USER = os.userInfo().username;

// The data directory outlives versions, reboots and an unhosting that keeps
// it: state.json counts the starts of this installation.
function writeFileAtomic(file, text) {
  const tmp = `${file}.${process.pid}.tmp`;
  const fd = openSync(tmp, 'w', 0o600);
  try {
    writeSync(fd, text);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, file);
}
const statePath = path.join(dataDir, 'state.json');
let previous = null;
try {
  previous = JSON.parse(readFileSync(statePath, 'utf8'));
} catch {
  previous = null;
}
const state = {
  instance: typeof previous?.instance === 'string' ? previous.instance : crypto.randomBytes(8).toString('hex'),
  createdAt: previous?.createdAt ?? new Date().toISOString(),
  starts: (Number.isInteger(previous?.starts) ? previous.starts : 0) + 1,
  versions: [...(Array.isArray(previous?.versions) ? previous.versions : []), VERSION].slice(-20),
  startedAt: new Date().toISOString(),
};
writeFileAtomic(statePath, `${JSON.stringify(state)}\n`);

const verifier = createCallerAssertionVerifier({ configPath, plugin: ROUTE, reloadIntervalMs: 1000 });
const PORT = await verifier.port();
// Where to listen, read once at start-up (it clears systemd's LISTEN_*
// variables): the socket systemd passed, else — installed by hand — the port.
const LISTEN = agentHalfListenTarget({ port: PORT });
const health = createHealthHandler({ verifier });
const hookFor = (stage) => (input) => {
  log(`hook ${stage} phase=${input?.phase ?? '-'} version=${VERSION}`);
  if (stage === 'install:post-tunnel' && MODE === 'failpost') {
    return { ok: false, reason: `e2e: release ${VERSION} refuses install:post-tunnel` };
  }
  return { ok: true, output: { stage, version: VERSION } };
};
const hooks = createAgentHookHandler({
  verifier,
  hooks: Object.fromEntries(HOOK_STAGES.map((stage) => [stage, hookFor(stage)])),
});

// Settings, when the manifest declares them: settings.json and secrets.json
// in the data directory — so they stay with data an unhosting keeps — which
// Lamaste alone reads and changes, through /admin/settings. A change is
// logged without its values.
const settings = MANIFEST.settings === undefined
  ? null
  : createSettingsStore({ dataDir, settings: settingsFromManifest(MANIFEST) });
let settingsHandler = null;
if (settings) {
  await settings.load();
  settings.onChange((s) =>
    log(`settings revision=${s.revision} configured=${s.configured} missing=${s.missing.join(',') || '-'}`),
  );
  settingsHandler = createSettingsHandler({ verifier, store: settings });
}
// What the store holds, for the specs: the effective and the stored values
// and, for each secret that is set, the SHA-256 of its value — never a value.
function settingsProbe() {
  const current = settings.state();
  const secretDigests = {};
  for (const key of Object.keys(current.secrets)) {
    const value = settings.secret(key);
    if (value !== undefined) secretDigests[key] = crypto.createHash('sha256').update(value, 'utf8').digest('hex');
  }
  return {
    schemaVersion: current.schemaVersion,
    revision: current.revision,
    configured: current.configured,
    missing: current.missing,
    values: settings.values(),
    stored: current.values,
    secretsSetAt: current.secrets,
    secretDigests,
  };
}

// What the unit's sandbox lets this process do. Each write is attempted and
// undone when it succeeds; all but the data directory and the private /tmp
// must fail.
const errorCode = (err) => String(err?.code ?? err?.name ?? 'error');
function tryWrite(file, keep = false) {
  try {
    writeFileSync(file, `e2e probe ${process.pid}\n`);
  } catch (err) {
    return errorCode(err);
  }
  if (!keep) rmSync(file, { force: true });
  return 'ALLOWED';
}
function tryRead(read) {
  try {
    read();
    return 'ALLOWED';
  } catch (err) {
    return errorCode(err);
  }
}
function procStatus(field) {
  try {
    return new RegExp(`^${field}:\\s*(\\S+)`, 'm').exec(readFileSync('/proc/self/status', 'utf8'))?.[1] ?? null;
  } catch {
    return null;
  }
}
// A UDP datagram to the loopback's discard port. Node's dgram binds a port
// of its own before it sends — what a unit allowed to bind nothing but its
// TCP port would refuse; systemd holding that port leaves UDP alone.
function udpSendProbe() {
  return new Promise((resolve) => {
    let socket = null;
    let settled = false;
    const done = (outcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket?.close();
      } catch {
        // already closed
      }
      resolve(outcome);
    };
    const timer = setTimeout(() => done('TIMEOUT'), 3000);
    try {
      socket = dgram.createSocket('udp4');
      socket.once('error', (err) => done(errorCode(err)));
      socket.send(Buffer.from(`e2e udp probe ${process.pid}`), 9, '127.0.0.1', (err) => done(err ? errorCode(err) : 'ALLOWED'));
    } catch (err) {
      done(errorCode(err));
    }
  });
}
async function sandboxProbe() {
  const probe = `e2e-${ROUTE}-probe`;
  return {
    uid: process.getuid(),
    gid: process.getgid(),
    user: USER,
    noNewPrivs: procStatus('NoNewPrivs'),
    capEff: procStatus('CapEff'),
    capBnd: procStatus('CapBnd'),
    writes: {
      dataDir: tryWrite(path.join(dataDir, probe)),
      privateTmp: tryWrite(`/tmp/e2e-${ROUTE}-private-tmp`, true),
      privateVarTmp: tryWrite(`/var/tmp/e2e-${ROUTE}-private-var-tmp`, true),
      privateShm: tryWrite(`/dev/shm/e2e-${ROUTE}-private-shm`, true),
      etc: tryWrite(`/etc/${probe}`),
      code: tryWrite(`/opt/lamalibre/apps/${ROUTE}/current/package/${probe}`),
      appsDir: tryWrite(`/opt/lamalibre/apps/${ROUTE}/${probe}`),
      configDir: tryWrite(`/etc/lamalibre/apps/${ROUTE}/${probe}`),
      usrLocal: tryWrite(`/usr/local/${probe}`),
      root: tryWrite(`/root/${probe}`),
      home: tryWrite(`/home/${probe}`),
      runLock: tryWrite(`/run/lock/${probe}`),
      run: tryWrite(`/run/${probe}`),
      varCrash: tryWrite(`/var/crash/${probe}`),
    },
    reads: {
      agentState: tryRead(() => readdirSync('/root/.lamalibre')),
      shadow: tryRead(() => readFileSync('/etc/shadow')),
    },
    network: {
      udpSend: await udpSendProbe(),
    },
  };
}

// The X-Lamalibre-Responder header of an answer to a verified request:
// responderHeaderFor (the `-` form) for a forwarded caller; over the exact
// body for Lamaste's own call, which the relay buffers.
function responderOf(verified, status, text) {
  return verified.payload.caller.type === 'lamaste'
    ? { 'x-lamalibre-responder': verified.responder(status, text) }
    : responderHeaderFor(verified, status);
}
// send(res, status, contentType, text, verified) — authenticated when it
// answers a verified request; an answer before verification carries nothing
function send(res, status, contentType, text, verified = null) {
  res.writeHead(status, { 'content-type': contentType, ...(verified ? responderOf(verified, status, text) : {}) });
  res.end(text);
}
function json(res, status, body, verified = null) {
  send(res, status, 'application/json', JSON.stringify(body), verified);
}
// What core's handlers answer: exactly their bytes, with their headers.
function answer(res, out) {
  res.writeHead(out.status, out.headers);
  res.end(out.bodyText);
}
async function bodyOf(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}
const PANEL_JS =
  'window.__lamalibrePlugins = window.__lamalibrePlugins || {};\n' +
  `window.__lamalibrePlugins[${JSON.stringify(ROUTE)}] = { mount(ctx) { ctx.mountPoint.textContent = ${JSON.stringify(`E2E app plugin ${VERSION}, installed by Lamaste on its agent`)}; return () => {}; } };\n`;

const server = http.createServer(async (req, res) => {
  try {
    const target = req.url ?? '/';
    const method = req.method ?? 'GET';
    const p = new URL(target, 'http://127.0.0.1').pathname;
    if (p.startsWith('/admin/hooks/')) {
      return answer(res, await hooks.handle({ method, url: target, headers: req.headers, body: await bodyOf(req) }));
    }
    if (settingsHandler && (p === '/admin/settings' || p.startsWith('/admin/settings/'))) {
      const out = await settingsHandler.handle({ method, url: target, headers: req.headers, body: await bodyOf(req) });
      log(`settings ${method} ${p} ${out.status}`);
      return answer(res, out);
    }
    if (p === '/admin/health') {
      return answer(res, await health.handle({ method, url: target, headers: req.headers, body: await bodyOf(req) }));
    }
    if (p !== '/admin' && !p.startsWith('/admin/')) return json(res, 404, { error: 'not found' });
    const verified = await verifier.verify(req.headers, method, target);
    if (!verified.ok) return json(res, 401, { error: 'caller assertion refused', reason: verified.reason });
    const caller = verified.payload.caller;
    log(`${method} ${p} caller=${caller.type === 'agent' ? `agent:${caller.label}` : caller.type}`);
    if (p === '/admin/ping') {
      return json(res, 200, {
        pong: true,
        plugin: ROUTE,
        version: VERSION,
        mode: MODE,
        caller,
        user: USER,
        pid: process.pid,
        data: { instance: state.instance, starts: state.starts, versions: state.versions },
        // How it listens: systemd's socket (descriptor 3) under the unit
        // lamaste-apphost writes; systemd's variables gone from its
        // environment once read, so nothing it starts takes the socket.
        listen: {
          mode: 'fd' in LISTEN ? 'systemd-socket' : 'port',
          fd: 'fd' in LISTEN ? LISTEN.fd : null,
          port: PORT,
          listenFdsCleared: process.env.LISTEN_FDS === undefined && process.env.LISTEN_PID === undefined,
        },
      }, verified);
    }
    if (p === '/admin/panel.js') return send(res, 200, 'application/javascript', PANEL_JS, verified);
    if (p === '/admin/sandbox') return json(res, 200, await sandboxProbe(), verified);
    if (p === '/admin/probe/settings' && settings) return json(res, 200, settingsProbe(), verified);
    return json(res, 404, { error: 'no such admin route' }, verified);
  } catch (err) {
    log(`error: ${err?.message ?? err}`);
    return json(res, 500, { error: 'internal error' });
  }
});

server.listen(LISTEN, () =>
  log(`${ROUTE} agent half ${VERSION} (${MODE}) on 127.0.0.1:${PORT} (${'fd' in LISTEN ? `systemd's socket, descriptor ${LISTEN.fd}` : 'its own bind'}) as ${USER}, start ${state.starts} of ${state.instance}`),
);
AGENTD_EOF
  node "${here}/build-app-agent-half.js" --entry "${dir}/agent-src/agentd.mjs" \
    --outfile "${dir}/agent/dist/agentd.mjs" --route "${name}" --mode "${mode}" > /dev/null
}

# decode_jwt_payload token
# Print the JSON payload of a JWT (needs node, which every VM has).
decode_jwt_payload() {
  node -e 'const p = process.argv[1].split(".")[1]; process.stdout.write(Buffer.from(p, "base64url").toString())' "$1"
}

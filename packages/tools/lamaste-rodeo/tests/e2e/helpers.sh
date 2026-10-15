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
# Writes the fixture's agent half: a Node HTTP server on 127.0.0.1:<port>
# (the port from the plugin config the agent fetched) whose /admin/* routes
# accept only requests with a valid caller assertion, verified with
# @lamalibre/lamaste/agent's createCallerAssertionVerifier.
#
#   node app-plugin-half.mjs --config <plugin config json> --plugin <route> \
#     --lamaste <dir of the @lamalibre/lamaste package> [--log <file>] \
#     [--flags <dir>] [--wait-config]
#
# Lifecycle hooks (4.3): /admin/hooks/<stage> answered by
# createAgentHookHandler (Lamaste's calls only); each stage logs a line
# `hook <stage> phase=… reason=… state=…`, and <flags>/fail-<stage> makes it
# refuse. --wait-config waits for the agent's sync to deliver the config.
#
# Routes: /admin/health, /admin/ping (echoes caller, path, what headers
# arrived), /admin/panel.js (a mount(ctx) bundle), /admin/echo (POST, counts
# bytes), /admin/events (3 server-sent events), anything else under /admin
# is 404. /app/* is the user surface and answers without an assertion — the
# forwarder must never reach it. One log line per request.
write_app_plugin_half() {
  local dest="$1"
  cat > "$dest" <<'HALF_EOF'
import http from 'node:http';
import path from 'node:path';
import { appendFileSync, existsSync } from 'node:fs';
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
if (!configPath || !plugin || !lamasteDir) {
  console.error('usage: app-plugin-half.mjs --config <file> --plugin <route> --lamaste <dir> [--log <file>] [--flags <dir>] [--wait-config]');
  process.exit(2);
}
// --wait-config: the agent's sync delivers the config after the half starts.
if (args.includes('--wait-config')) {
  while (!existsSync(configPath)) await new Promise((r) => setTimeout(r, 500));
}
const agentLib = await import(pathToFileURL(path.join(lamasteDir, 'dist', 'agent', 'index.js')).href);
const verifier = agentLib.createCallerAssertionVerifier({ configPath, plugin, reloadIntervalMs: 500 });
const port = await verifier.port();
const callerName = (c) => (c.type === 'agent' ? `agent:${c.label}` : c.type);

// Lifecycle hooks (4.3): each stage logs what it was called with; a file
// <flags>/fail-<stage> makes that stage refuse.
const failing = (stage) => Boolean(flagsDir) && existsSync(path.join(flagsDir, `fail-${stage}`));
const hookFor = (stage) => (input) => {
  log(`hook ${stage} phase=${input.phase ?? '-'} reason=${input.reason ?? '-'} state=${input.state ?? '-'}`);
  return failing(stage) ? { ok: false, reason: `e2e: ${stage} refused by flag` } : { ok: true, output: { stage } };
};
const hookHandler = agentLib.createAgentHookHandler
  ? agentLib.createAgentHookHandler({
      verifier,
      hooks: Object.fromEntries(
        ['install:pre-tunnel', 'install:post-tunnel', 'uninstall:pre-teardown', 'uninstall:post-teardown', 'tunnel:down', 'tunnel:up'].map((s) => [s, hookFor(s)]),
      ),
    })
  : null;

function log(line) {
  const text = `${new Date().toISOString()} ${line}\n`;
  process.stdout.write(text);
  if (logFile) appendFileSync(logFile, text);
}

function json(res, status, body, extraHeaders = {}) {
  res.writeHead(status, { 'content-type': 'application/json', ...extraHeaders });
  res.end(JSON.stringify(body));
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
  if (p.startsWith('/admin/hooks/') && hookHandler) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const out = await hookHandler.handle({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks) });
    log(`${req.method} ${req.url} ${out.status} hook-call`);
    json(res, out.status, out.body);
    return;
  }
  const result = await verifier.verify(req.headers, req.method, req.url);
  if (!result.ok) {
    log(`${req.method} ${req.url} 401 refused=${result.reason}`);
    json(res, 401, { error: 'caller assertion refused', reason: result.reason });
    return;
  }
  const caller = callerName(result.payload.caller);
  if (p === '/admin/health') {
    log(`${req.method} ${req.url} 200 caller=${caller}`);
    json(res, 200, { ok: true, plugin, port });
    return;
  }
  if (p === '/admin/ping' || p === '/admin') {
    log(`${req.method} ${req.url} 200 caller=${caller}`);
    json(res, 200, {
      pong: true,
      caller: result.payload.caller,
      path: req.url,
      cookie: req.headers.cookie ?? null,
      authorization: req.headers.authorization ?? null,
      sslClientDn: req.headers['x-ssl-client-dn'] ?? null,
    });
    return;
  }
  if (p === '/admin/panel.js') {
    log(`${req.method} ${req.url} 200 caller=${caller}`);
    res.writeHead(200, { 'content-type': 'application/javascript' });
    res.end(
      `window.__lamalibrePlugins = window.__lamalibrePlugins || {};\n` +
        `window.__lamalibrePlugins[${JSON.stringify(plugin)}] = { mount(ctx) { ctx.mountPoint.textContent = 'E2E app plugin — served by the agent half'; return () => {}; } };\n`,
    );
    return;
  }
  if (p === '/admin/echo' && req.method === 'POST') {
    let bytes = 0;
    req.on('data', (c) => (bytes += c.length));
    req.on('end', () => {
      log(`POST ${req.url} 200 caller=${caller} bytes=${bytes}`);
      json(res, 200, { bytes }, { 'set-cookie': 'app-session=should-not-pass' });
    });
    return;
  }
  if (p === '/admin/events') {
    log(`${req.method} ${req.url} 200 caller=${caller} sse`);
    res.writeHead(200, { 'content-type': 'text/event-stream' });
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
      json(res, 200, { imported: true, bytes, validated: req.headers['x-validated'] ?? null });
    });
    return;
  }
  if (p.startsWith('/admin/export/')) {
    log(`${req.method} ${req.url} 200 caller=${caller} encoding=${req.headers['accept-encoding'] ?? '-'}`);
    // A planted credential the relay's secret scanner must redact.
    json(res, 200, { rows: 2, token: 'ghp_' + 'E2eToken0'.repeat(4), total: '12345678901234567890' }, { etag: '"e2e"' });
    return;
  }
  if (p === '/admin/report') {
    log(`${req.method} ${req.url} 200 caller=${caller}`);
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('quarterly report — BLOCKME');
    return;
  }
  if (p === '/admin/stuck') {
    log(`${req.method} ${req.url} 200 caller=${caller}`);
    json(res, 200, { reached: true });
    return;
  }
  log(`${req.method} ${req.url} 404 caller=${caller}`);
  json(res, 404, { error: 'no such admin route' });
});

server.listen(port, '127.0.0.1', () => log(`listening on 127.0.0.1:${port} for plugin ${plugin}`));
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

# write_app_install_fixture dir name version mode build-id [system-packages-json]
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
# (re-read on a signature it cannot verify), listens on 127.0.0.1:<the
# config's port> and answers /admin/health, /admin/ping (caller, its package
# version, its account, its data), /admin/panel.js, /admin/sandbox (what its
# unit lets it write and read) and /admin/hooks/* (createAgentHookHandler:
# Lamaste's calls only; each stage logs `hook <stage> phase=… version=…` to
# the journal). LAMASTE_APP_DATA_DIR/state.json counts its starts under one
# random instance id: data that is kept keeps the id. <mode>:
#   main      — every hook stage succeeds
#   failpost  — install:post-tunnel refuses: a bad release
#   deps      — the agent package declares `dependencies`, which the agent's
#               root helper refuses (an agent half ships bundled)
#   tampered  — as main, other bytes: what a registry serving something else
#               under a published version hands out
# <build-id> goes into the agent package, so each run's tarballs — and their
# integrity — are new: an agent's npm cache never answers for the registry.
# Needs node, this workspace's node_modules (esbuild) and its core library
# build (packages/core/lib/dist).
write_app_install_fixture() {
  local dir="$1" name="$2" version="$3" mode="$4" build_id="$5"
  local system_packages="${6:-[\"sqlite3\"]}"
  local server_pkg="@lamalibre/${name}-server"
  local agent_pkg="@lamalibre/${name}-agent"
  local here deps=''
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
  }
}
FIXTURE_EOF

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
// and __E2E_MODE__); runs under the unit lamaste-apphost writes, as the
// plugin's own account, with its config and data paths in the environment.
import crypto from 'node:crypto';
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
import { createAgentHookHandler, createCallerAssertionVerifier } from '@lamalibre/lamaste/agent';

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
function sandboxProbe() {
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
      etc: tryWrite(`/etc/${probe}`),
      code: tryWrite(`/opt/lamalibre/apps/${ROUTE}/current/package/${probe}`),
      appsDir: tryWrite(`/opt/lamalibre/apps/${ROUTE}/${probe}`),
      configDir: tryWrite(`/etc/lamalibre/apps/${ROUTE}/${probe}`),
      usrLocal: tryWrite(`/usr/local/${probe}`),
      root: tryWrite(`/root/${probe}`),
      home: tryWrite(`/home/${probe}`),
      runLock: tryWrite(`/run/lock/${probe}`),
    },
    reads: {
      agentState: tryRead(() => readdirSync('/root/.lamalibre')),
      shadow: tryRead(() => readFileSync('/etc/shadow')),
    },
  };
}

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
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
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const out = await hooks.handle({ method, url: target, headers: req.headers, body: Buffer.concat(chunks) });
      return json(res, out.status, out.body);
    }
    if (p !== '/admin' && !p.startsWith('/admin/')) return json(res, 404, { error: 'not found' });
    const verified = await verifier.verify(req.headers, method, target);
    if (!verified.ok) return json(res, 401, { error: 'caller assertion refused', reason: verified.reason });
    const caller = verified.payload.caller;
    if (p === '/admin/health') return json(res, 200, { ok: true, plugin: ROUTE, version: VERSION });
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
      });
    }
    if (p === '/admin/panel.js') {
      res.writeHead(200, { 'content-type': 'application/javascript' });
      return res.end(PANEL_JS);
    }
    if (p === '/admin/sandbox') return json(res, 200, sandboxProbe());
    return json(res, 404, { error: 'no such admin route' });
  } catch (err) {
    log(`error: ${err?.message ?? err}`);
    return json(res, 500, { error: 'internal error' });
  }
});

const port = await verifier.port();
server.listen(port, '127.0.0.1', () =>
  log(`${ROUTE} agent half ${VERSION} (${MODE}) on 127.0.0.1:${port} as ${USER}, start ${state.starts} of ${state.instance}`),
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

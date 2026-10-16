/**
 * Panel REST API client for localhost calls.
 *
 * Used by tunnel/site commands that need the full dependency stack
 * (nginx, certbot, chisel) which lives in the running panel server.
 * Authenticates via the admin mTLS client certificate.
 *
 * The panel is verified before anything is sent: the CLI talks to nginx's IP
 * vhost on loopback only when it should be listening, and checks it presents
 * the panel's own certificate, read from disk (see `panel-identity.js`) —
 * port 9292 is one any local user could listen on when nginx does not.
 *
 * Nothing secret is ever an argument of curl: other local users can read a
 * process's command line (`ps`, `/proc/<pid>/cmdline`). The P12 password is
 * in a private `-K` config file, and a request body — which can carry a
 * credential, such as the token of `registry-credential set --token-stdin`
 * — reaches curl on stdin.
 */

import { rmSync } from 'node:fs';
import { mkdtemp, open, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';
import { SETTINGS_KEY_RE } from '@lamalibre/lamaste';
import { PKI_DIR, readConfig } from './config.js';
import { PANEL_LOOPBACK, assertPanelListener, readPanelIdentity } from './panel-identity.js';

/**
 * TLS 1.2 cipher suites the CLI offers: forward-secret ones only. With RSA
 * key exchange a client sends its certificate before the server has proved
 * it holds the key of the certificate it presented — and the panel's
 * certificate is public — so a listener on the panel's port could collect
 * the admin client certificate from the handshake. With ECDHE (and with
 * TLS 1.3) the server signs first, and an impostor fails before the client
 * presents anything. nginx's `HIGH` list offers these suites.
 */
const FORWARD_SECRET_CIPHERS = 'ECDHE+AESGCM:ECDHE+CHACHA20';

/** The signals that remove a request's private curl config before the CLI dies. */
const CLEANUP_SIGNALS = ['SIGINT', 'SIGTERM'];

/**
 * One curl config directive, `name = "value"`, with backslashes and double
 * quotes escaped for curl's quoted values. A value holding a line break or
 * NUL is refused: curl reads its config line by line, so a line break would
 * start a directive of the value's choosing. The error never repeats the
 * value. Pure, exported for tests.
 *
 * @param {string} name
 * @param {string} value
 * @returns {string}
 */
export function curlConfigLine(name, value) {
  if (/[\r\n\0]/.test(value)) {
    throw new Error(`The curl config value of "${name}" contains a line break or NUL`);
  }
  return `${name} = "${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"\n`;
}

/**
 * Run `fn` with the path of a curl config file holding `content`. The file
 * is created exclusively (`wx`, 0600) in a fresh private directory
 * (`mkdtemp`, 0700): the CLI runs as root and the shared temporary
 * directory belongs to every local user, none of whom may read the file or
 * put a file or a link at its path first. The directory is removed on every
 * path — also when the CLI is interrupted (Ctrl-C) or terminated while the
 * request runs: SIGINT and SIGTERM handlers, installed for exactly that long,
 * remove it and then let the signal end the process as it would have
 * (status 130 / 143 to the shell). The CLI has no other use for them.
 *
 * @template T
 * @param {string} content
 * @param {(configPath: string) => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withCurlConfig(content, fn) {
  /** @type {string | undefined} */
  let dir;
  const onSignal = (signal) => {
    if (dir !== undefined) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // Nothing more can be done on the way out.
      }
    }
    for (const sig of CLEANUP_SIGNALS) process.off(sig, onSignal);
    // Without listeners the signal's default action applies again: re-raised,
    // it ends the process. (A listener still installed — execa's, killing
    // curl — re-raises it in turn once it is the last one.)
    process.kill(process.pid, signal);
  };
  for (const sig of CLEANUP_SIGNALS) process.on(sig, onSignal);
  try {
    dir = await mkdtemp(join(tmpdir(), 'lamalibre-lamaste-curl-'));
    const configPath = join(dir, 'curl.conf');
    const fh = await open(configPath, 'wx', 0o600);
    try {
      await fh.writeFile(content, 'utf-8');
    } finally {
      await fh.close();
    }
    return await fn(configPath);
  } finally {
    for (const sig of CLEANUP_SIGNALS) process.off(sig, onSignal);
    if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  }
}

/**
 * The curl invocation for one panel request: its argument vector, and the
 * JSON body curl reads on stdin (`--data-binary @-`; `undefined` without a
 * body). The body is never an argument. Pure, exported for tests.
 *
 * The panel is verified as `identity` says (`readPanelIdentity`): curl
 * trusts nothing but its certificate (`--cacert`), checks it is issued for
 * the address in the request's URL, and connects to that address on
 * loopback (`--connect-to`) — the certificate names the server's public
 * address, and the CLI never leaves the machine. curl reads no `.curlrc`
 * (`-q`, which must come first), which could switch verification off, and
 * uses no proxy. Never `-k`.
 *
 * The JSON content type and the body travel together: a `Content-Type:
 * application/json` header on a body-less DELETE made Fastify answer 400
 * ("Body cannot be empty when content-type is set"), so `registry-credential
 * clear`, `tunnels delete` and `sites delete` never reached their routes.
 *
 * @param {{ identity: { certPath: string, address: string, port: number }, method: string, path: string, body?: Record<string, unknown> | null, p12Path: string, configPath: string }} request
 * @returns {{ args: string[], input: string | undefined }}
 */
export function buildPanelCurlRequest({
  identity,
  method,
  path,
  body = null,
  p12Path,
  configPath,
}) {
  const { certPath, address, port } = identity;
  const args = [
    '-q', // No .curlrc — it must be the first argument
    '-K',
    configPath,
    '--cert-type',
    'P12',
    '--cert',
    p12Path,
    '--cacert',
    certPath,
    '--connect-to',
    `${address}:${port}:${PANEL_LOOPBACK}:${port}`,
    '--ciphers',
    FORWARD_SECRET_CIPHERS,
    '--proto',
    '=https',
    '--noproxy',
    '*',
    '-s', // Silent
    '-S', // Show errors
    '-X',
    method,
    '-H',
    'Accept: application/json',
  ];
  let input;
  if (body !== null && body !== undefined) {
    args.push('-H', 'Content-Type: application/json', '--data-binary', '@-');
    input = JSON.stringify(body);
  }
  // Append the HTTP status on its own line so an error response is not
  // mistaken for a result — the panel answers errors with a JSON body.
  args.push('-w', '\n%{http_code}', `https://${address}:${port}${path}`);
  return { args, input };
}

/**
 * The error for a curl run that did not complete, saying what went wrong in
 * the panel's terms: curl's own last line, never its command line. Pure,
 * exported for tests.
 *
 * @param {{ exitCode?: number, stderr?: string, timedOut?: boolean, code?: string }} failure
 * @param {{ certPath: string, port: number }} identity
 * @param {{ p12Path: string, timeoutMs: number }} request
 * @returns {Error}
 */
export function curlFailure(failure, identity, { p12Path, timeoutMs }) {
  const reason =
    String(failure.stderr ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .pop() ?? '';
  const listener = `${PANEL_LOOPBACK}:${identity.port}`;
  let message;
  if (failure.timedOut) {
    message = `The panel did not answer within ${Math.round(timeoutMs / 1000)} s`;
  } else if (failure.code === 'ENOENT') {
    message = 'curl is not installed';
  } else {
    switch (failure.exitCode) {
      case 7:
        message = `Nothing listens on ${listener} — is nginx running? (systemctl status nginx)`;
        break;
      // The TLS handshake failed: certificate not trusted, issued for another
      // address, another key — or no suite in common with an impostor.
      case 35:
      case 51:
      case 60:
      case 90:
        message =
          `The listener on ${listener} did not prove it is the panel: it must present ` +
          `${identity.certPath}. Nothing was sent to it. If the certificate was regenerated, ` +
          `reload nginx (systemctl reload nginx).`;
        break;
      case 58:
        message = `curl could not use the admin client certificate ${p12Path}`;
        break;
      default:
        message = `curl failed${failure.exitCode === undefined ? '' : ` (exit ${failure.exitCode})`}`;
    }
  }
  const err = new Error(reason ? `${message} (${reason})` : message);
  if (typeof failure.exitCode === 'number') err.curlExitCode = failure.exitCode;
  return err;
}

/**
 * The `details` of a panel error as text: a string as it is, a failed
 * validation's `issues` as `field: message; …`; anything else is left out.
 *
 * @param {unknown} details
 * @returns {string}
 */
function detailsText(details) {
  if (typeof details === 'string') return details;
  if (details === null || typeof details !== 'object' || !Array.isArray(details.issues)) return '';
  const found = details.issues
    .filter((issue) => typeof issue?.message === 'string')
    .map((issue) =>
      Array.isArray(issue.path) && issue.path.length > 0
        ? `${issue.path.join('.')}: ${issue.message}`
        : issue.message,
    );
  return [...new Set(found)].join('; ');
}

/**
 * The per-field messages of a refused settings change (`errors`: a setting
 * key, or `_` for the change as a whole, to a message), or null when the
 * panel sent none. Only string messages under a key a setting can have are
 * kept — the panel's and the agent half's messages never contain a value.
 *
 * @param {unknown} errors
 * @returns {Record<string, string> | null}
 */
function settingsErrors(errors) {
  if (errors === null || typeof errors !== 'object' || Array.isArray(errors)) return null;
  const kept = Object.entries(errors).filter(
    ([key, message]) => (key === '_' || SETTINGS_KEY_RE.test(key)) && typeof message === 'string',
  );
  return kept.length > 0 ? Object.fromEntries(kept) : null;
}

/**
 * Split curl's output (`<payload>\n<status>`) and turn a non-2xx status
 * into an error carrying the panel's `error` (and `details`) in its message,
 * the status as `statusCode`, and what a caller acts on beyond the message
 * when the panel sent it: `code` (e.g. `agent_not_eligible`), `reasons`, a
 * running operation's `operationId`, and for a refused settings change its
 * per-field `errors`, the current `revision` (`revision_mismatch`) and the
 * `hosting` (`hosting_offline`). Pure, exported for tests.
 *
 * @param {string} stdout
 * @param {string} method
 * @param {string} path
 * @returns {Record<string, unknown>}
 */
export function parsePanelResponse(stdout, method, path) {
  const split = stdout.lastIndexOf('\n');
  const payload = stdout.slice(0, split).trim();
  const status = Number(stdout.slice(split + 1).trim());
  let parsed = {};
  if (payload) {
    try {
      parsed = JSON.parse(payload);
    } catch {
      parsed = { error: payload };
    }
  }

  // Anything but a 2xx is an error: 4xx/5xx from the panel, a 3xx curl did
  // not follow, or 0 when curl reported no status at all.
  if (!Number.isInteger(status) || status < 200 || status >= 300) {
    const reason = [parsed.error, detailsText(parsed.details)].filter(Boolean).join(': ');
    const err = new Error(
      `${method} ${path} failed (HTTP ${status})${reason ? `: ${reason}` : ''}`,
    );
    err.statusCode = status;
    if (typeof parsed.code === 'string') err.code = parsed.code;
    if (Array.isArray(parsed.reasons)) {
      err.reasons = parsed.reasons.filter((r) => typeof r === 'string');
    }
    if (typeof parsed.operationId === 'string') err.operationId = parsed.operationId;
    const errors = settingsErrors(parsed.errors);
    if (errors) err.errors = errors;
    if (Number.isSafeInteger(parsed.revision) && parsed.revision >= 0) {
      err.revision = parsed.revision;
    }
    if (
      parsed.hosting === null ||
      (typeof parsed.hosting === 'object' && !Array.isArray(parsed.hosting))
    ) {
      err.hosting = parsed.hosting;
    }
    throw err;
  }

  return parsed;
}

/**
 * Send one request to the panel with curl: the panel verified as
 * `identity` says, the client certificate, its password in a private `-K`
 * config file, and the body on stdin. Resolves and rejects as
 * `panelRequest` does. `identity` is `readPanelIdentity()`'s (tests
 * describe a local server).
 *
 * @param {{ identity: { certPath: string, address: string, port: number }, method: string, path: string, body?: Record<string, unknown> | null, p12Path: string, p12Password: string, timeoutMs?: number }} request
 * @returns {Promise<Record<string, unknown>>}
 */
export async function curlPanelRequest({
  identity,
  method,
  path,
  body = null,
  p12Path,
  p12Password,
  timeoutMs = 30000,
}) {
  return withCurlConfig(curlConfigLine('pass', p12Password), async (configPath) => {
    const { args, input } = buildPanelCurlRequest({
      identity,
      method,
      path,
      body,
      p12Path,
      configPath,
    });
    const result = await execa('curl', args, {
      timeout: timeoutMs,
      reject: false,
      ...(input === undefined ? {} : { input }),
    });
    if (result.failed) {
      throw curlFailure(result, identity, { p12Path, timeoutMs });
    }
    return parsePanelResponse(result.stdout, method, path);
  });
}

/**
 * Make an authenticated API request to the local panel server.
 *
 * Refuses before connecting when nginx does not listen on the panel's port
 * (panel 2FA on, IP vhost off), and verifies the listener against the
 * panel's certificate (see the top of this file). Uses curl with the admin
 * client certificate (mTLS); neither the P12 password nor the body is ever
 * in curl's arguments. Resolves with the JSON body; rejects with an Error
 * (`statusCode`, the panel's `error` in the message, a refusal's `code`,
 * `reasons` and `operationId`, a refused settings change's `errors`,
 * `revision` and `hosting`) for any non-2xx answer, and with one that says
 * why when the request could not be made.
 *
 * @param {string} method
 * @param {string} path  e.g. '/api/tunnels'
 * @param {Record<string, unknown> | null} [body]  sent as JSON when given
 * @param {{ timeoutMs?: number }} [options]  `timeoutMs` for calls the panel
 *   needs longer to answer (a plugin install runs npm); default 30 s
 * @returns {Promise<Record<string, unknown>>}
 */
export async function panelRequest(method, path, body = null, { timeoutMs = 30000 } = {}) {
  let config;
  try {
    config = await readConfig();
  } catch {
    throw new Error(
      'Cannot read panel.json. Ensure the server is properly installed and /etc/lamalibre/lamaste/panel.json exists.',
    );
  }
  await assertPanelListener(config);
  const identity = await readPanelIdentity();

  const p12Path = `${PKI_DIR}/client.p12`;

  // Read p12 password from the stored file
  let p12Password;
  try {
    p12Password = (await readFile(`${PKI_DIR}/.p12-password`, 'utf-8')).trim();
  } catch {
    throw new Error(
      'Cannot read P12 password. Ensure the server is properly installed and /etc/lamalibre/lamaste/pki/.p12-password exists.',
    );
  }

  return curlPanelRequest({ identity, method, path, body, p12Path, p12Password, timeoutMs });
}

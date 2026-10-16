/**
 * Panel REST API client for localhost calls.
 *
 * Used by tunnel/site commands that need the full dependency stack
 * (nginx, certbot, chisel) which lives in the running panel server.
 * Authenticates via the admin mTLS client certificate.
 *
 * Nothing secret is ever an argument of curl: other local users can read a
 * process's command line (`ps`, `/proc/<pid>/cmdline`). The P12 password is
 * in a private `-K` config file, and a request body — which can carry a
 * credential, such as the token of `registry-credential set --token-stdin`
 * — reaches curl on stdin.
 */

import { mkdtemp, open, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';
import { PKI_DIR } from './config.js';

const PANEL_URL = 'https://127.0.0.1:9292';

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
 * path.
 *
 * @template T
 * @param {string} content
 * @param {(configPath: string) => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withCurlConfig(content, fn) {
  const dir = await mkdtemp(join(tmpdir(), 'lamalibre-lamaste-curl-'));
  try {
    const configPath = join(dir, 'curl.conf');
    const fh = await open(configPath, 'wx', 0o600);
    try {
      await fh.writeFile(content, 'utf-8');
    } finally {
      await fh.close();
    }
    return await fn(configPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * The curl invocation for one panel request: its argument vector, and the
 * JSON body curl reads on stdin (`--data-binary @-`; `undefined` without a
 * body). The body is never an argument. Pure, exported for tests.
 *
 * The JSON content type and the body travel together: a `Content-Type:
 * application/json` header on a body-less DELETE made Fastify answer 400
 * ("Body cannot be empty when content-type is set"), so `registry-credential
 * clear`, `tunnels delete` and `sites delete` never reached their routes.
 *
 * @param {{ panelUrl?: string, method: string, path: string, body?: Record<string, unknown> | null, p12Path: string, configPath: string }} request
 * @returns {{ args: string[], input: string | undefined }}
 */
export function buildPanelCurlRequest({
  panelUrl = PANEL_URL,
  method,
  path,
  body = null,
  p12Path,
  configPath,
}) {
  const args = [
    '-K',
    configPath,
    '--cert-type',
    'P12',
    '--cert',
    p12Path,
    '-k', // Server uses self-signed cert on localhost
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
  args.push('-w', '\n%{http_code}', `${panelUrl}${path}`);
  return { args, input };
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
 * Split curl's output (`<payload>\n<status>`) and turn a non-2xx status
 * into an error carrying the panel's `error` (and `details`) in its message,
 * the status as `statusCode`, and what a caller acts on beyond the message
 * when the panel sent it: `code` (e.g. `agent_not_eligible`), `reasons` and
 * a running operation's `operationId`. Pure, exported for tests.
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
    throw err;
  }

  return parsed;
}

/**
 * Send one request to the panel with curl: the client certificate, its
 * password in a private `-K` config file, and the body on stdin. Resolves
 * and rejects as `panelRequest` does. `panelUrl` is the panel's address
 * (tests point it at a local server).
 *
 * @param {{ panelUrl?: string, method: string, path: string, body?: Record<string, unknown> | null, p12Path: string, p12Password: string, timeoutMs?: number }} request
 * @returns {Promise<Record<string, unknown>>}
 */
export async function curlPanelRequest({
  panelUrl = PANEL_URL,
  method,
  path,
  body = null,
  p12Path,
  p12Password,
  timeoutMs = 30000,
}) {
  return withCurlConfig(curlConfigLine('pass', p12Password), async (configPath) => {
    const { args, input } = buildPanelCurlRequest({
      panelUrl,
      method,
      path,
      body,
      p12Path,
      configPath,
    });
    const { stdout } = await execa('curl', args, {
      timeout: timeoutMs,
      ...(input === undefined ? {} : { input }),
    });
    return parsePanelResponse(stdout, method, path);
  });
}

/**
 * Make an authenticated API request to the local panel server.
 *
 * Uses curl with the admin client certificate (mTLS); neither the P12
 * password nor the body is ever in curl's arguments (see the top of this
 * file). Resolves with the JSON body; rejects with an Error (`statusCode`,
 * the panel's `error` in the message, a refusal's `code`, `reasons` and
 * `operationId`) for any non-2xx answer.
 *
 * @param {string} method
 * @param {string} path  e.g. '/api/tunnels'
 * @param {Record<string, unknown> | null} [body]  sent as JSON when given
 * @param {{ timeoutMs?: number }} [options]  `timeoutMs` for calls the panel
 *   needs longer to answer (a plugin install runs npm); default 30 s
 * @returns {Promise<Record<string, unknown>>}
 */
export async function panelRequest(method, path, body = null, { timeoutMs = 30000 } = {}) {
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

  return curlPanelRequest({ method, path, body, p12Path, p12Password, timeoutMs });
}

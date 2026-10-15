/**
 * Panel REST API client for localhost calls.
 *
 * Used by tunnel/site commands that need the full dependency stack
 * (nginx, certbot, chisel) which lives in the running panel server.
 * Authenticates via the admin mTLS client certificate.
 */

import { readFile, writeFile, unlink } from 'node:fs/promises';
import crypto from 'node:crypto';
import { execa } from 'execa';
import { PKI_DIR } from './config.js';

const PANEL_URL = 'https://127.0.0.1:9292';

/**
 * The curl argument vector for one panel request. Pure, exported for tests.
 *
 * The JSON content type and the body travel together: a `Content-Type:
 * application/json` header on a body-less DELETE made Fastify answer 400
 * ("Body cannot be empty when content-type is set"), so `registry-credential
 * clear`, `tunnels delete` and `sites delete` never reached their routes.
 *
 * @param {{ method: string, path: string, body?: Record<string, unknown> | null, p12Path: string, configPath: string }} request
 * @returns {string[]}
 */
export function buildPanelCurlArgs({ method, path, body = null, p12Path, configPath }) {
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
  if (body !== null && body !== undefined) {
    args.push('-H', 'Content-Type: application/json', '-d', JSON.stringify(body));
  }
  // Append the HTTP status on its own line so an error response is not
  // mistaken for a result — the panel answers errors with a JSON body.
  args.push('-w', '\n%{http_code}', `${PANEL_URL}${path}`);
  return args;
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
 * Make an authenticated API request to the local panel server.
 *
 * Uses curl with the admin client certificate (mTLS) and a temporary
 * config file for the P12 password (never in process args). Resolves with
 * the JSON body; rejects with an Error (`statusCode`, the panel's `error`
 * in the message, a refusal's `code`, `reasons` and `operationId`) for any
 * non-2xx answer.
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

  // Write password to a temporary config file (never in process args)
  const tmpConfigPath = `/tmp/lamalibre-lamaste-curl-${crypto.randomBytes(8).toString('hex')}`;
  try {
    await writeFile(tmpConfigPath, `--pass "${p12Password}"\n`, { mode: 0o600 });

    const { stdout } = await execa(
      'curl',
      buildPanelCurlArgs({ method, path, body, p12Path, configPath: tmpConfigPath }),
      { timeout: timeoutMs },
    );

    return parsePanelResponse(stdout, method, path);
  } finally {
    await unlink(tmpConfigPath).catch(() => {});
  }
}

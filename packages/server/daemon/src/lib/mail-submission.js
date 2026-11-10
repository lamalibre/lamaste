/**
 * Authelia's mail: the panel's loopback submission listener
 * (packages/core/docs/mail-design.md §5).
 *
 * Authelia's notifier speaks SMTP only, and Authelia never talks to a mail
 * provider (decision D5): it submits to `submissions://127.0.0.1:9295`,
 * this listener, which delivers through the relay's transport under the
 * sending budget (class `essential`). What it takes:
 *
 * - **implicit TLS** with a certificate from a local CA the panel makes
 *   here (`<stateDir>/mail-submission/`, keys 0600, directory 0700), for
 *   `lamaste-mail.localhost`; the CA certificate is written to
 *   `/etc/authelia/certs/` (0640, group `lamaste-authelia` from the setgid
 *   directory) — Authelia adds it to the system's roots
 *   (`certificates_directory`), changing no other trust. The leaf is
 *   renewed 30 days before it expires, the CA (and a new leaf) 30 days
 *   before its own end — which Authelia only reads when it starts;
 * - **AUTH PLAIN** as `authelia` with a 32-byte random password kept in
 *   `/etc/authelia/mail-submission-password` (0640, same group), which
 *   Authelia's configuration pulls in with `{{ secret … }}`; compared in
 *   constant time;
 * - exactly one message shape: `MAIL FROM` the relay's sender (the one
 *   Authelia was given), one `RCPT`, headers that name that recipient alone
 *   in `To` (no `Cc`, `Bcc` or `Resent-*` — the Gmail API takes its
 *   recipients from the headers) and that sender in `From`, at most
 *   256 KiB. Anything else is a 5xx. At most 30 messages in 10 minutes and
 *   5 an hour to one recipient — over either, and for a delivery the
 *   transport could not make, a 4xx (Authelia shows the user an error and
 *   they try again later). Its mail is `essential`: a share of the budget
 *   of its own (§3.7);
 * - **a connection must authenticate within 5 seconds** of its TLS
 *   handshake, with few commands before: one local process cannot hold
 *   the listener's connections for long.
 *
 * The local CA is name-constrained to the listener's name (critical
 * `nameConstraints`, permitted `DNS:lamaste-mail.localhost`): Authelia
 * trusts it, and it can vouch for nothing else. A CA made before 4.13 had
 * that constraint is made again (and Authelia restarted with it).
 *
 * It runs only while the relay has a transport (lib/mail-sync.js starts and
 * stops it) and never while a tunnel holds its port (Q5): a tunnel's port
 * on the relay's loopback belongs to an agent's application.
 *
 * No message, address or secret is logged; refusals log their reason alone.
 */

import crypto, { X509Certificate } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, mkdtemp, open, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';

import { execa } from 'execa';
import addressparser from 'nodemailer/lib/addressparser';
import { SMTPServer } from 'smtp-server';

import { MAIL_SUBMISSION_PORT, parseMailAddress } from '@lamalibre/lamaste';
import {
  AUTHELIA_CERTS_DIR,
  AUTHELIA_MAIL_PASSWORD_FILE,
  MAIL_SUBMISSION_SERVER_NAME,
  MAIL_SUBMISSION_USERNAME,
} from '@lamalibre/lamaste/server';

import { randomCertSerial } from './pki-sign.js';

const STATE_DIR = process.env.LAMALIBRE_LAMASTE_STATE_DIR || '/etc/lamalibre/lamaste';

/** The largest message Authelia may submit. */
export const SUBMISSION_MAX_BYTES = 256 * 1024;
/** At most this many messages … */
export const SUBMISSION_RATE_MAX = 30;
/** … in this window. */
export const SUBMISSION_RATE_WINDOW_MS = 10 * 60_000;
/** At most this many messages to one recipient … */
export const SUBMISSION_RECIPIENT_MAX = 5;
/** … in this window. */
export const SUBMISSION_RECIPIENT_WINDOW_MS = 60 * 60_000;
/** A connection that has not authenticated this long after its TLS handshake is closed. */
let authDeadlineMs = 5_000;
/** Commands a connection may send before it authenticates. */
const UNAUTHENTICATED_COMMANDS_MAX = 5;

/** The CA certificate's name under `/etc/authelia/certs`. */
export const SUBMISSION_CA_FILENAME = 'lamaste-mail-ca.pem';

/** A certificate is renewed this long before it expires. */
const RENEW_BEFORE_MS = 30 * 24 * 3_600_000;
const CA_DAYS = 3650;
const LEAF_DAYS = 397;

const FILES = Object.freeze({
  caKey: 'ca-key.pem',
  caCert: 'ca.pem',
  key: 'key.pem',
  cert: 'cert.pem',
});

/** Where things live — another place in tests ({@link setMailSubmissionForTests}). */
const realPaths = Object.freeze({
  dir: path.join(STATE_DIR, 'mail-submission'),
  certsDir: AUTHELIA_CERTS_DIR,
  passwordFile: AUTHELIA_MAIL_PASSWORD_FILE,
  host: '127.0.0.1',
  port: MAIL_SUBMISSION_PORT,
});
let paths = realPaths;

/**
 * Point the listener's files and port elsewhere (tests); `null` restores
 * the relay's. Stops a running listener first.
 *
 * @param {{ dir?: string, certsDir?: string, passwordFile?: string, port?: number } | null} overrides
 */
export async function setMailSubmissionForTests(overrides) {
  await stopSubmissionListener();
  const { authDeadlineMs: deadline, ...rest } = overrides ?? {};
  authDeadlineMs = deadline ?? 5_000;
  paths = overrides ? { ...realPaths, ...rest } : realPaths;
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

/** A file's text, or null when it is missing (or not a regular file: a link is never followed). */
async function readIfFile(file) {
  let fh;
  try {
    fh = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    return null;
  }
  try {
    if (!(await fh.stat()).isFile()) return null;
    return await fh.readFile('utf-8');
  } finally {
    await fh.close();
  }
}

/**
 * Write `text` to `file` atomically: a temporary file beside it created
 * exclusively with `mode`, fsynced, renamed over the target, the directory
 * fsynced. The group comes from the directory (setgid under /etc/authelia).
 */
async function writeAtomic(file, text, mode) {
  const dir = path.dirname(file);
  const tmp = path.join(dir, `.${path.basename(file)}.${crypto.randomBytes(8).toString('hex')}`);
  const fh = await open(tmp, 'wx', mode);
  try {
    await fh.writeFile(text, 'utf-8');
    await fh.chmod(mode);
    await fh.sync();
  } catch (err) {
    await fh.close();
    await rm(tmp, { force: true });
    throw err;
  }
  await fh.close();
  try {
    await rename(tmp, file);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
  const dh = await open(dir, constants.O_RDONLY);
  try {
    await dh.sync().catch(() => {});
  } finally {
    await dh.close();
  }
}

/** Whether `pem` is a certificate valid for longer than the renewal margin. */
function certificateFresh(pem, now) {
  if (pem === null) return false;
  try {
    const cert = new X509Certificate(pem);
    return Date.parse(cert.validTo) - now > RENEW_BEFORE_MS && Date.parse(cert.validFrom) <= now;
  } catch {
    return false;
  }
}

/** DER of the `nameConstraints` extension's OID (2.5.29.30). */
const NAME_CONSTRAINTS_OID = Buffer.from([0x06, 0x03, 0x55, 0x1d, 0x1e]);

/**
 * Whether the CA certificate `pem` carries the name constraint to the
 * listener's name — the `nameConstraints` extension and the permitted name
 * in its DER (the CA is the panel's own, made with exactly that one
 * extension of the kind).
 */
export function caNameConstrained(pem) {
  try {
    const der = new X509Certificate(pem).raw;
    return (
      der.includes(NAME_CONSTRAINTS_OID) && der.includes(Buffer.from(MAIL_SUBMISSION_SERVER_NAME))
    );
  } catch {
    return false;
  }
}

/** Whether `leafPem` was issued by `caPem` for the listener's name. */
function leafOf(caPem, leafPem) {
  try {
    const ca = new X509Certificate(caPem);
    const leaf = new X509Certificate(leafPem);
    return (
      leaf.checkIssued(ca) &&
      leaf.verify(ca.publicKey) &&
      leaf.checkHost(MAIL_SUBMISSION_SERVER_NAME) === MAIL_SUBMISSION_SERVER_NAME
    );
  } catch {
    return false;
  }
}

/** `openssl` with array arguments — never a shell. */
function openssl(args, cwd) {
  return execa('openssl', args, { cwd, env: { PATH: process.env.PATH ?? '/usr/bin:/bin' } });
}

/** A new P-256 key (PKCS#8 PEM) — node's, not openssl's. */
function newKey() {
  const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return privateKey.export({ type: 'pkcs8', format: 'pem' });
}

/**
 * Make the local CA and a leaf for {@link MAIL_SUBMISSION_SERVER_NAME} in a
 * private working directory: `{ caKey, caCert }` when `ca` is null (a new
 * CA), and always `{ key, cert }`.
 */
async function issue(ca) {
  const work = await mkdtemp(path.join(paths.dir, '.issue-'));
  try {
    const write = (name, text) => writeAtomic(path.join(work, name), text, 0o600);
    let caKey = ca?.caKey;
    let caCert = ca?.caCert;
    if (!ca) {
      caKey = newKey();
      await write('ca-key.pem', caKey);
      await openssl(
        [
          'req',
          '-x509',
          '-new',
          '-key',
          'ca-key.pem',
          '-subj',
          '/CN=Lamaste mail submission CA',
          '-days',
          String(CA_DAYS),
          '-sha256',
          '-addext',
          'basicConstraints=critical,CA:TRUE,pathlen:0',
          '-addext',
          'keyUsage=critical,keyCertSign,cRLSign',
          '-addext',
          `nameConstraints=critical,permitted;DNS:${MAIL_SUBMISSION_SERVER_NAME}`,
          '-out',
          'ca.pem',
        ],
        work,
      );
      caCert = await readFile(path.join(work, 'ca.pem'), 'utf-8');
    } else {
      await write('ca-key.pem', caKey);
      await write('ca.pem', caCert);
    }
    const key = newKey();
    await write('key.pem', key);
    await write(
      'leaf.ext',
      [
        'basicConstraints=critical,CA:FALSE',
        'keyUsage=critical,digitalSignature',
        'extendedKeyUsage=serverAuth',
        `subjectAltName=DNS:${MAIL_SUBMISSION_SERVER_NAME}`,
        '',
      ].join('\n'),
    );
    await openssl(
      [
        'req',
        '-new',
        '-key',
        'key.pem',
        '-subj',
        `/CN=${MAIL_SUBMISSION_SERVER_NAME}`,
        '-out',
        'leaf.csr',
      ],
      work,
    );
    await openssl(
      [
        'x509',
        '-req',
        '-in',
        'leaf.csr',
        '-CA',
        'ca.pem',
        '-CAkey',
        'ca-key.pem',
        '-set_serial',
        `0x${randomCertSerial()}`,
        '-days',
        String(LEAF_DAYS),
        '-sha256',
        '-extfile',
        'leaf.ext',
        '-out',
        'cert.pem',
      ],
      work,
    );
    const cert = await readFile(path.join(work, 'cert.pem'), 'utf-8');
    return { caKey, caCert, key, cert };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

/**
 * The listener's key material and Authelia's two files, made or renewed as
 * needed: the CA and leaf (§5), the CA certificate in `/etc/authelia/certs`
 * and the submission password. `authelia` says whether a file Authelia
 * reads only when it starts changed — the CA certificate or the password —
 * so a running Authelia that submits here must restart.
 *
 * @returns {Promise<{ key: string, cert: string, password: string, authelia: boolean }>}
 */
export async function ensureSubmissionMaterial({ logger } = {}) {
  const now = Date.now();
  await mkdir(paths.dir, { recursive: true, mode: 0o700 });
  const read = (name) => readIfFile(path.join(paths.dir, name));
  let caKey = await read(FILES.caKey);
  let caCert = await read(FILES.caCert);
  let key = await read(FILES.key);
  let cert = await read(FILES.cert);

  const caUsable = caKey !== null && certificateFresh(caCert, now) && caNameConstrained(caCert);
  const leafUsable =
    caUsable && key !== null && certificateFresh(cert, now) && leafOf(caCert, cert);
  if (!leafUsable) {
    const issued = await issue(caUsable ? { caKey, caCert } : null);
    if (!caUsable) {
      await writeAtomic(path.join(paths.dir, FILES.caKey), issued.caKey, 0o600);
      await writeAtomic(path.join(paths.dir, FILES.caCert), issued.caCert, 0o600);
      logger?.info('Mail submission CA made');
    }
    await writeAtomic(path.join(paths.dir, FILES.key), issued.key, 0o600);
    await writeAtomic(path.join(paths.dir, FILES.cert), issued.cert, 0o600);
    logger?.info('Mail submission certificate issued');
    ({ caKey, caCert, key, cert } = issued);
  }

  let authelia = false;
  // create-lamaste makes the directory (2750, Authelia's group); a relay
  // whose installer has not run since gets it from the panel, which owns
  // /etc/authelia — the group comes from that setgid directory.
  await mkdir(paths.certsDir, { mode: 0o2750 }).catch((err) => {
    if (err.code !== 'EEXIST') throw err;
  });
  const caFile = path.join(paths.certsDir, SUBMISSION_CA_FILENAME);
  if ((await readIfFile(caFile)) !== caCert) {
    await writeAtomic(caFile, caCert, 0o640);
    authelia = true;
  }

  let password = (await readIfFile(paths.passwordFile)) ?? '';
  if (!/^[A-Za-z0-9_-]{43}$/.test(password)) {
    password = crypto.randomBytes(32).toString('base64url');
    await writeAtomic(paths.passwordFile, password, 0o640);
    authelia = true;
  }
  return { key, cert, password, authelia };
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

/** An SMTP refusal: `responseCode` is what the client is answered. */
function refusal(code, message) {
  return Object.assign(new Error(message), { responseCode: code });
}

/** Constant-time equality of two strings (by their SHA-256, so lengths never leak). */
function sameSecret(a, b) {
  const digest = (s) => crypto.createHash('sha256').update(String(s)).digest();
  return crypto.timingSafeEqual(digest(a), digest(b));
}

/**
 * The header block of a message (up to the first empty line), unfolded:
 * `[name (lower-cased), value]` pairs, or null when there is no header end
 * within the message.
 */
function headerFields(raw) {
  const text = raw.toString('latin1');
  const end = text.search(/\r?\n\r?\n/);
  if (end < 0) return null;
  const fields = [];
  for (const line of text.slice(0, end).split(/\r?\n/)) {
    if (/^[ \t]/.test(line) && fields.length > 0) {
      fields[fields.length - 1][1] += ` ${line.trim()}`;
      continue;
    }
    const colon = line.indexOf(':');
    if (colon <= 0) return null;
    fields.push([line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim()]);
  }
  return fields;
}

/** The addresses a header value names, lower-cased (groups flattened). */
function headerAddresses(value) {
  const out = [];
  const walk = (list) => {
    for (const entry of list) {
      if (Array.isArray(entry.group)) walk(entry.group);
      else if (entry.address) out.push(entry.address.toLowerCase());
    }
  };
  walk(addressparser(value));
  return out;
}

/**
 * Why a message is not one Authelia sends `rcpt` as `sender`, or null: its
 * `From` names the sender alone, its `To` the recipient alone, and nothing
 * else names a recipient (`Cc`, `Bcc`, `Resent-*`) — Gmail's API sends to
 * the headers, not the envelope.
 */
export function messageRefusal(raw, { sender, rcpt }) {
  const fields = headerFields(raw);
  if (fields === null) return 'no header block';
  const named = (name) => fields.filter(([n]) => n === name);
  if (fields.some(([n]) => n === 'cc' || n === 'bcc' || n.startsWith('resent-'))) {
    return 'extra recipients';
  }
  const from = named('from');
  if (from.length !== 1) return 'not one From';
  const fromAddresses = headerAddresses(from[0][1]);
  if (fromAddresses.length !== 1 || fromAddresses[0] !== sender) return 'From is not the sender';
  const senderField = named('sender');
  if (senderField.length > 0) {
    const addresses = headerAddresses(senderField[0][1]);
    if (senderField.length !== 1 || addresses.length !== 1 || addresses[0] !== sender) {
      return 'Sender is not the sender';
    }
  }
  const to = named('to');
  if (to.length !== 1) return 'not one To';
  const toAddresses = headerAddresses(to[0][1]);
  if (toAddresses.length !== 1 || toAddresses[0] !== rcpt) return 'To is not the recipient';
  return null;
}

// ---------------------------------------------------------------------------
// The listener
// ---------------------------------------------------------------------------

/** The running listener: `{ server, state }` (`state`: sender, password, key, cert — read by its handlers), or null. */
let running = null;
/** Accepted messages' times, for the rate limit. */
let accepted = [];
/** Accepted messages' times by recipient (lower case; in memory only, never written). */
const acceptedByRecipient = new Map();

/**
 * Whether another message to `rcpt` fits the rate limits now — 30 in ten
 * minutes, 5 an hour to one recipient — and counts it when it does: why
 * not (`rate` / `recipient`), or null.
 */
function takeRateSlot(rcpt, now) {
  accepted = accepted.filter((t) => now - t < SUBMISSION_RATE_WINDOW_MS);
  for (const [address, times] of acceptedByRecipient) {
    const recent = times.filter((t) => now - t < SUBMISSION_RECIPIENT_WINDOW_MS);
    if (recent.length === 0) acceptedByRecipient.delete(address);
    else acceptedByRecipient.set(address, recent);
  }
  if (accepted.length >= SUBMISSION_RATE_MAX) return 'rate';
  const toRecipient = acceptedByRecipient.get(rcpt) ?? [];
  if (toRecipient.length >= SUBMISSION_RECIPIENT_MAX) return 'recipient';
  accepted.push(now);
  acceptedByRecipient.set(rcpt, [...toRecipient, now]);
  return null;
}

function createServer(state, { deliver, logger }) {
  const refuse = (reason, err) => {
    logger?.warn({ reason }, 'Mail submission refused');
    return err;
  };
  return new SMTPServer({
    secure: true,
    key: state.key,
    cert: state.cert,
    name: MAIL_SUBMISSION_SERVER_NAME,
    banner: 'Lamaste mail submission',
    authMethods: ['PLAIN'],
    disabledCommands: ['STARTTLS'],
    size: SUBMISSION_MAX_BYTES,
    maxClients: 16,
    maxAllowedUnauthenticatedCommands: UNAUTHENTICATED_COMMANDS_MAX,
    socketTimeout: 60_000,
    closeTimeout: 5_000,
    disableReverseLookup: true,
    logger: false,
    onConnect(session, callback) {
      const address = String(session.remoteAddress ?? '');
      if (address !== '127.0.0.1' && address !== '::ffff:127.0.0.1' && address !== '::1') {
        return callback(refuse('not loopback', refusal(554, 'Not accepted')));
      }
      return callback();
    },
    // After the TLS handshake: the connection authenticates within the
    // deadline or is closed — a local process cannot sit on a slot.
    onSecure(socket, session, callback) {
      const timer = setTimeout(() => {
        if (session.user !== MAIL_SUBMISSION_USERNAME) {
          logger?.warn({ reason: 'auth_deadline' }, 'Mail submission refused');
          socket.destroy();
        }
      }, authDeadlineMs);
      timer.unref();
      socket.once('close', () => clearTimeout(timer));
      return callback();
    },
    onAuth(auth, _session, callback) {
      const ok =
        auth.method === 'PLAIN' &&
        auth.username === MAIL_SUBMISSION_USERNAME &&
        sameSecret(auth.password ?? '', state.password);
      if (!ok) return callback(refuse('auth', refusal(535, 'Authentication failed')));
      return callback(null, { user: MAIL_SUBMISSION_USERNAME });
    },
    onMailFrom(address, session, callback) {
      if (session.user !== MAIL_SUBMISSION_USERNAME) {
        return callback(refusal(530, 'Authentication required'));
      }
      if (String(address.address).toLowerCase() !== state.sender) {
        return callback(refuse('sender', refusal(553, 'Sender not accepted')));
      }
      return callback();
    },
    onRcptTo(address, session, callback) {
      if (session.envelope.rcptTo.length >= 1) {
        return callback(refuse('recipients', refusal(554, 'One recipient only')));
      }
      if (parseMailAddress(address.address) === null) {
        return callback(refuse('recipient', refusal(553, 'Recipient not accepted')));
      }
      return callback();
    },
    onData(stream, session, callback) {
      const chunks = [];
      stream.on('data', (chunk) => chunks.push(chunk));
      stream.on('error', () => {});
      stream.on('end', () => {
        if (stream.sizeExceeded) {
          return callback(refuse('size', refusal(552, 'Message too large')));
        }
        const rcpt = String(session.envelope.rcptTo[0]?.address ?? '').toLowerCase();
        const raw = Buffer.concat(chunks);
        const why = messageRefusal(raw, { sender: state.sender, rcpt });
        if (why !== null) return callback(refuse(why, refusal(554, 'Message not accepted')));
        const limited = takeRateSlot(rcpt, Date.now());
        if (limited !== null) {
          // A 4xx: Authelia tells its user the mail failed; they try later.
          return callback(
            refuse(limited, refusal(451, '4.7.1 Too many messages; try again later')),
          );
        }
        deliver({ to: rcpt, raw, kind: 'authelia', sendClass: 'essential', logger }).then(
          (result) =>
            result.status === 'sent'
              ? callback(null, 'Delivered')
              : callback(refusal(451, 'Not delivered; try again later')),
          (err) => {
            logger?.error({ err: err?.message }, 'Mail submission delivery failed');
            callback(refusal(451, 'Not delivered; try again later'));
          },
        );
      });
    },
  });
}

/** Listen on the listener's address, or reject (`EADDRINUSE` when the port is held). */
function listen(server) {
  return new Promise((resolve, reject) => {
    const onError = (err) => {
      server.server.off('listening', onListening);
      reject(err);
    };
    const onListening = () => {
      server.server.off('error', onError);
      resolve();
    };
    server.server.once('error', onError);
    server.server.once('listening', onListening);
    server.listen(paths.port, paths.host);
  });
}

/**
 * Run the listener for `sender` with `material` (from
 * {@link ensureSubmissionMaterial}): started when it is not running,
 * restarted when its certificate changed, the sender and password updated
 * in place otherwise. Rejects when the port cannot be taken.
 *
 * @param {{ sender: { address: string }, material: { key: string, cert: string, password: string },
 *   deliver: (input: object) => Promise<{ status: string }>, logger?: import('pino').Logger }} input
 */
export async function ensureSubmissionListener({ sender, material, deliver, logger }) {
  const address = sender.address.toLowerCase();
  if (running && running.state.key === material.key && running.state.cert === material.cert) {
    running.state.sender = address;
    running.state.password = material.password;
    return;
  }
  await stopSubmissionListener();
  const state = {
    sender: address,
    password: material.password,
    key: material.key,
    cert: material.cert,
  };
  const server = createServer(state, { deliver, logger });
  server.on('error', (err) =>
    logger?.warn({ err: err?.message }, 'Mail submission listener error'),
  );
  await listen(server);
  running = { server, state };
  logger?.info({ port: paths.port }, 'Mail submission listener started');
}

/** Stop the listener when it runs. */
export async function stopSubmissionListener() {
  if (!running) return;
  const { server } = running;
  running = null;
  accepted = [];
  acceptedByRecipient.clear();
  await new Promise((resolve) => server.close(() => resolve()));
}

/** Whether the listener runs. */
export function submissionListenerRunning() {
  return running !== null;
}

/** The address the listener is bound to, or null (tests listen on a free port). */
export function submissionListenerAddressForTests() {
  return running?.server.server.address() ?? null;
}

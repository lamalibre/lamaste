/**
 * Authelia's mail (packages/core/docs/mail-design.md §5): the panel's
 * loopback submission listener — its local CA, Authelia's two files, what
 * it accepts and refuses — and the synchronisation that runs it, writes
 * Authelia's notifier and reset link, and points every portal's "Reset
 * password?" at its own page or nowhere.
 *
 * The listener runs for real on a free loopback port with its files under
 * a test directory; Authelia's configuration, its restart and the
 * delivery behind the listener are stand-ins.
 */

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { X509Certificate } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import nodemailer from 'nodemailer';

import { MAIL_SUBMISSION_PORT } from '@lamalibre/lamaste';

const PRIMARY = 'relay.example';
const OTHER = 'other.example';
const SENDER = 'no-reply@notify.relay.example';
const RCPT = 'ayse@customer.example';

let dir;
let lib;
let paths;
/** What the listener delivered, and what the next delivery answers. */
const delivered = [];
let deliverAnswer = { status: 'sent' };
const deliver = async (input) => {
  delivered.push(input);
  return deliverAnswer;
};
/** Authelia stand-ins: the mail settings written, what the write answers, restarts. */
const autheliaMail = [];
let autheliaChanged = false;
let restarts = 0;

async function db() {
  return lib.getStateDb();
}

/** Port the listener got (the tests listen on a free one). */
function listenerPort() {
  return lib.submissionListenerAddressForTests().port;
}

/** A client of the listener, trusting its local CA. */
async function client({ password } = {}) {
  const ca = await readFile(path.join(paths.certsDir, 'lamaste-mail-ca.pem'), 'utf-8');
  return nodemailer.createTransport({
    host: '127.0.0.1',
    port: listenerPort(),
    secure: true,
    tls: { ca, servername: 'lamaste-mail.localhost' },
    auth: {
      user: 'authelia',
      pass: password ?? (await readFile(paths.passwordFile, 'utf-8')),
      method: 'PLAIN',
    },
  });
}

/** A message as Authelia composes one, `headers` replacing its defaults. */
function message({
  from = `Code Lama <${SENDER}>`,
  to = RCPT,
  extra = '',
  body = 'Code 123456',
} = {}) {
  return [
    `From: ${from}`,
    `To: ${to}`,
    extra,
    'Subject: Confirm your identity',
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    '',
    body,
    '',
  ]
    .filter((line, i) => !(i === 2 && line === ''))
    .join('\r\n');
}

async function submit({ envelope = { from: SENDER, to: [RCPT] }, raw = message(), password } = {}) {
  const transport = await client({ password });
  try {
    return await transport.sendMail({ envelope, raw });
  } finally {
    transport.close();
  }
}

async function setRelayTransport() {
  return lib.writeTransportRow(await db(), {
    domain: null,
    kind: 'smtp',
    settings: { host: 'smtp.example', port: 465, security: 'tls', username: 'relay' },
    secret: 'never-shown',
    senderAddress: SENDER,
    senderName: 'Code Lama',
    dailyLimit: 500,
    now: new Date(),
  });
}

async function notifications(fragment) {
  const { notifications: rows } = await lib.listNotifications({ limit: 200 });
  return rows.filter((n) => n.message.includes(fragment));
}

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'lamaste-mail-submission-'));
  const stateDir = path.join(dir, 'state');
  await mkdir(stateDir);
  process.env.LAMALIBRE_LAMASTE_STATE_DIR = stateDir;
  process.env.LAMALIBRE_LAMASTE_DATA_DIR = stateDir;
  process.env.LAMALIBRE_LAMASTE_PKI_DIR = path.join(stateDir, 'pki');
  process.env.LAMALIBRE_LAMASTE_CONFIG = path.join(stateDir, 'panel.json');
  await writeFile(
    process.env.LAMALIBRE_LAMASTE_CONFIG,
    JSON.stringify({
      ip: '203.0.113.10',
      domain: PRIMARY,
      email: `ops@${PRIMARY}`,
      dataDir: stateDir,
      onboarding: { status: 'COMPLETED' },
    }),
  );
  lib = {
    ...(await import('../src/lib/state-db.js')),
    ...(await import('../src/lib/config.js')),
    ...(await import('../src/lib/state.js')),
    ...(await import('../src/lib/notifications.js')),
    ...(await import('../src/lib/audit.js')),
    ...(await import('../src/lib/mail-store.js')),
    ...(await import('../src/lib/mail-submission.js')),
    ...(await import('../src/lib/mail-sync.js')),
    ...(await import('../src/lib/auth-branding.js')),
    ...(await import('../src/lib/authelia.js')),
  };
  await lib.loadConfig();
  const d = await db();
  const at = new Date().toISOString();
  for (const [name, primary] of [
    [PRIMARY, 1],
    [OTHER, 0],
  ]) {
    d.prepare(
      "INSERT INTO domains (name, is_primary, status, created_at, activated_at) VALUES (?, ?, 'active', ?, ?)",
    ).run(name, primary, at, at);
  }
  paths = {
    dir: path.join(stateDir, 'mail-submission'),
    certsDir: path.join(dir, 'authelia', 'certs'),
    passwordFile: path.join(dir, 'authelia', 'mail-submission-password'),
    port: 0,
  };
  await mkdir(paths.certsDir, { recursive: true });
  await lib.setMailSubmissionForTests(paths);
  lib.setAutheliaForTests({
    restart: async () => {
      restarts += 1;
    },
    mail: async (settings) => {
      autheliaMail.push(settings);
      return { changed: autheliaChanged };
    },
  });
});

after(async () => {
  await lib.setMailSubmissionForTests(null);
  lib.setAutheliaForTests(null);
  await rm(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  // Each test starts without the listener's files, as a relay before its first transport.
  await rm(paths.dir, { recursive: true, force: true });
  await rm(path.join(paths.certsDir, 'lamaste-mail-ca.pem'), { force: true });
  await rm(paths.passwordFile, { force: true });
  const d = await db();
  d.exec('DELETE FROM mail_transports; DELETE FROM mail_accounts; DELETE FROM notifications;');
  await lib.writeTunnels([]);
  await lib.stopSubmissionListener();
  lib.resetMailSyncForTests();
  delivered.length = 0;
  deliverAnswer = { status: 'sent' };
  autheliaMail.length = 0;
  autheliaChanged = false;
  restarts = 0;
});

// ---------------------------------------------------------------------------
// The key material and Authelia's files
// ---------------------------------------------------------------------------

test('the local CA, the leaf and Authelia’s two files: made once, private, kept', async () => {
  const first = await lib.ensureSubmissionMaterial();
  assert.equal(first.authelia, true, 'a new CA certificate and password for Authelia');
  for (const name of ['ca-key.pem', 'ca.pem', 'key.pem', 'cert.pem']) {
    assert.equal((await stat(path.join(paths.dir, name))).mode & 0o777, 0o600, name);
  }
  assert.equal((await stat(paths.dir)).mode & 0o777, 0o700);
  const caFile = path.join(paths.certsDir, 'lamaste-mail-ca.pem');
  assert.equal((await stat(caFile)).mode & 0o777, 0o640);
  assert.equal((await stat(paths.passwordFile)).mode & 0o777, 0o640);
  assert.match(first.password, /^[A-Za-z0-9_-]{43}$/);

  const ca = new X509Certificate(await readFile(caFile, 'utf-8'));
  const leaf = new X509Certificate(first.cert);
  assert.equal(ca.ca, true);
  assert.equal(leaf.ca, false);
  assert.ok(leaf.checkIssued(ca) && leaf.verify(ca.publicKey));
  assert.equal(leaf.checkHost('lamaste-mail.localhost'), 'lamaste-mail.localhost');
  assert.equal(leaf.checkHost('localhost'), undefined);
  // Only the CA certificate reaches Authelia's directory — never a key.
  assert.doesNotMatch(await readFile(caFile, 'utf-8'), /PRIVATE KEY/);

  const again = await lib.ensureSubmissionMaterial();
  assert.equal(again.authelia, false, 'nothing Authelia reads changed');
  assert.equal(again.cert, first.cert);
  assert.equal(again.password, first.password);

  // A leaf another CA issued is replaced under the same CA: Authelia's trust unchanged.
  await writeFile(path.join(paths.dir, 'cert.pem'), await readFile(caFile, 'utf-8'));
  const reissued = await lib.ensureSubmissionMaterial();
  assert.notEqual(reissued.cert, first.cert);
  assert.equal(reissued.authelia, false);
  // A password gone is a new one, which Authelia must read anew.
  await rm(paths.passwordFile);
  const repassed = await lib.ensureSubmissionMaterial();
  assert.equal(repassed.authelia, true);
  assert.notEqual(repassed.password, first.password);
});

// ---------------------------------------------------------------------------
// What the listener accepts
// ---------------------------------------------------------------------------

/** Run the listener for the relay's sender. */
async function startListener() {
  const material = await lib.ensureSubmissionMaterial();
  await lib.ensureSubmissionListener({ sender: { address: SENDER }, material, deliver });
  return material;
}

test('Authelia’s message: delivered through the relay’s transport, essential', async () => {
  await startListener();
  const info = await submit();
  assert.match(info.response, /^250/);
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].to, RCPT);
  assert.equal(delivered[0].kind, 'authelia');
  assert.equal(delivered[0].sendClass, 'essential');
  assert.match(delivered[0].raw.toString('utf-8'), /Code 123456/);
});

test('a delivery the transport could not make is a 4xx — Authelia shows an error, the user tries again', async () => {
  await startListener();
  deliverAnswer = { status: 'failed', error: 'connection' };
  await assert.rejects(submit(), (err) => err.responseCode === 451);
  deliverAnswer = { status: 'deferred-budget', error: 'ceiling' };
  await assert.rejects(submit(), (err) => err.responseCode === 451);
});

test('only Authelia with its password, as the relay’s sender, to one recipient the headers name alone', async () => {
  await startListener();
  await assert.rejects(submit({ password: 'x'.repeat(43) }), (err) => err.responseCode === 535);
  await assert.rejects(
    submit({ envelope: { from: 'someone@else.example', to: [RCPT] } }),
    (err) => err.responseCode === 553,
  );
  for (const raw of [
    message({ extra: 'Cc: mehmet@customer.example' }),
    message({ extra: 'Bcc: mehmet@customer.example' }),
    message({ extra: 'Resent-To: mehmet@customer.example' }),
    message({ to: `${RCPT}, mehmet@customer.example` }),
    message({ to: 'mehmet@customer.example' }),
    message({ from: 'Someone <someone@else.example>' }),
  ]) {
    await assert.rejects(submit({ raw }), (err) => err.responseCode === 554, raw);
  }
  await assert.rejects(
    submit({ raw: message({ body: 'x'.repeat(300 * 1024) }) }),
    (err) => err.responseCode === 552,
  );
  assert.equal(delivered.length, 0);
  // A second RCPT is refused; the message reaches the one recipient its headers name.
  const partial = await submit({
    envelope: { from: SENDER, to: [RCPT, 'mehmet@customer.example'] },
  });
  assert.deepEqual(partial.accepted, [RCPT]);
  assert.deepEqual(partial.rejected, ['mehmet@customer.example']);
  assert.deepEqual(
    delivered.map((d) => d.to),
    [RCPT],
  );
});

test('the rate: 30 messages in 10 minutes, then refused', async () => {
  await startListener();
  for (let i = 0; i < lib.SUBMISSION_RATE_MAX; i++) await submit();
  await assert.rejects(submit(), (err) => err.responseCode === 554);
  assert.equal(delivered.length, lib.SUBMISSION_RATE_MAX);
});

test('the headers a message must carry, read as Gmail reads them', () => {
  const ok = { sender: SENDER, rcpt: RCPT };
  assert.equal(lib.messageRefusal(Buffer.from(message()), ok), null);
  // Folded headers and a group are read whole.
  assert.equal(
    lib.messageRefusal(Buffer.from(message({ to: `Customers:\r\n ${RCPT};` })), ok),
    null,
  );
  assert.equal(lib.messageRefusal(Buffer.from('From: x\r\nno end'), ok), 'no header block');
  assert.equal(
    lib.messageRefusal(Buffer.from(message({ extra: `Sender: other@else.example` })), ok),
    'Sender is not the sender',
  );
  assert.equal(
    lib.messageRefusal(Buffer.from(`${message()}`.replace(`To: ${RCPT}\r\n`, '')), ok),
    'not one To',
  );
});

// ---------------------------------------------------------------------------
// The synchronisation
// ---------------------------------------------------------------------------

test('no transport: no listener, Authelia keeps its file and no reset link anywhere', async () => {
  const outcome = await lib.syncMailConfiguration({ deliver });
  assert.deepEqual(outcome, { submitting: false, warnings: [] });
  assert.equal(lib.submissionListenerRunning(), false);
  assert.deepEqual(autheliaMail, [{ sender: null, resetUrl: null }]);
  for (const domain of [PRIMARY, OTHER]) {
    assert.deepEqual((await lib.authVhostInputs(domain)).mail, {
      primaryResetUrl: null,
      domainResetUrl: null,
    });
  }
});

test('the relay’s transport: the listener runs, Authelia submits to it, every portal links its own /reset', async () => {
  await setRelayTransport();
  const outcome = await lib.syncMailConfiguration({ deliver });
  assert.deepEqual(outcome, { submitting: true, warnings: [] });
  assert.equal(lib.submissionListenerRunning(), true);
  assert.deepEqual(autheliaMail, [
    {
      sender: { address: SENDER, name: 'Code Lama' },
      resetUrl: `https://auth.${PRIMARY}/reset`,
    },
  ]);
  // The configuration was already so, but the CA certificate and the
  // password are new: Authelia reads them only when it starts.
  assert.equal(restarts, 1);
  for (const domain of [PRIMARY, OTHER]) {
    assert.deepEqual((await lib.authVhostInputs(domain)).mail, {
      primaryResetUrl: `https://auth.${PRIMARY}/reset`,
      domainResetUrl: `https://auth.${domain}/reset`,
    });
  }
  // Again: nothing new, no restart; a delivery reaches the stand-in.
  await lib.syncMailConfiguration({ deliver });
  assert.equal(restarts, 1);
  await submit();
  assert.equal(delivered.length, 1);

  // The transport cleared: the listener stops, Authelia back to its file.
  (await db()).exec('DELETE FROM mail_transports');
  await lib.syncMailConfiguration({ deliver });
  assert.equal(lib.submissionListenerRunning(), false);
  assert.deepEqual(autheliaMail.at(-1), { sender: null, resetUrl: null });
});

test('a domain’s own transport alone: no listener, Authelia’s reset link on, only that portal links a page', async () => {
  lib.writeTransportRow(await db(), {
    domain: OTHER,
    kind: 'smtp',
    settings: { host: 'smtp.other.example', port: 465, security: 'tls' },
    secret: null,
    senderAddress: 'no-reply@mail.other.example',
    senderName: null,
    dailyLimit: 500,
    now: new Date(),
  });
  const outcome = await lib.syncMailConfiguration({ deliver });
  assert.deepEqual(outcome, { submitting: false, warnings: [] });
  assert.equal(lib.submissionListenerRunning(), false);
  assert.deepEqual(autheliaMail, [{ sender: null, resetUrl: `https://auth.${PRIMARY}/reset` }]);
  assert.deepEqual((await lib.authVhostInputs(PRIMARY)).mail, {
    primaryResetUrl: `https://auth.${PRIMARY}/reset`,
    domainResetUrl: null,
  });
  assert.deepEqual((await lib.authVhostInputs(OTHER)).mail, {
    primaryResetUrl: `https://auth.${PRIMARY}/reset`,
    domainResetUrl: `https://auth.${OTHER}/reset`,
  });
});

test('a tunnel on the listener’s port: never moved, reported once, Authelia’s mail stays in its file', async () => {
  await setRelayTransport();
  await lib.writeTunnels([
    {
      id: 't1',
      subdomain: 'cam',
      fqdn: `cam.${PRIMARY}`,
      port: MAIL_SUBMISSION_PORT,
      enabled: true,
    },
  ]);
  const outcome = await lib.syncMailConfiguration({ deliver });
  assert.equal(outcome.submitting, false);
  assert.deepEqual(
    outcome.warnings.map((w) => w.step),
    ['listener'],
  );
  assert.equal(lib.submissionListenerRunning(), false);
  assert.deepEqual(autheliaMail, [{ sender: null, resetUrl: `https://auth.${PRIMARY}/reset` }]);
  assert.equal((await notifications(`port ${MAIL_SUBMISSION_PORT}`)).length, 1);
  await lib.syncMailConfiguration({ deliver });
  assert.equal((await notifications(`port ${MAIL_SUBMISSION_PORT}`)).length, 1, 'once per streak');
  assert.equal((await lib.readTunnels())[0].port, MAIL_SUBMISSION_PORT, 'the tunnel is untouched');

  // The tunnel moved: the listener runs, the end of the streak audited.
  await lib.writeTunnels([]);
  assert.equal((await lib.syncMailConfiguration({ deliver })).submitting, true);
  const entries = await lib.listAudit({ limit: 200 });
  assert.ok(entries.some((e) => e.action === 'mail.submission.refused'));
  assert.ok(entries.some((e) => e.action === 'mail.submission.recovered'));
});

test('Authelia restarted by the configuration write is not restarted again for its files', async () => {
  await setRelayTransport();
  autheliaChanged = true;
  await lib.syncMailConfiguration({ deliver });
  assert.equal(
    restarts,
    0,
    'the write restarted it (the stand-in counts only the panel’s own restart)',
  );
  const entries = await lib.listAudit({ limit: 200 });
  assert.ok(entries.some((e) => e.action === 'authelia.restarted' && e.details.reason === 'mail'));
});

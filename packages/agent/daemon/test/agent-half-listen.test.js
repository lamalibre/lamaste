/**
 * Where an agent half listens (`agentHalfListenTarget`, core's
 * `agent/listen.ts`). Under the unit `lamaste-apphost` writes, systemd holds
 * the port in a socket unit and passes the listening socket as descriptor 3,
 * announced in `LISTEN_PID` and `LISTEN_FDS`; the agent half listens on it
 * and never binds the port itself. Without a socket — an agent half
 * installed by hand — it binds the plugin config's port. Systemd's
 * variables count only for the process they name, are cleared on reading so
 * no child takes them for its own, and any number of sockets but one is
 * refused.
 *
 * End to end: a listening socket passed as descriptor 3 to a child Node.js
 * process the way systemd passes it — `LISTEN_PID` set to the child's own
 * PID before it starts (a shell that sets it to `$$` and `exec`s Node) — and
 * an HTTP answer through it, from `node:http` and from Fastify.
 */

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { agentHalfListenTarget } from '@lamalibre/lamaste/agent';

const VARIABLES = ['LISTEN_PID', 'LISTEN_FDS', 'LISTEN_FDNAMES'];
/** Where the child processes resolve `@lamalibre/lamaste` and `fastify` from. */
const DAEMON_DIR = fileURLToPath(new URL('..', import.meta.url));

let saved;
beforeEach(() => {
  saved = Object.fromEntries(VARIABLES.map((k) => [k, process.env[k]]));
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

function setVariables(values) {
  for (const k of VARIABLES) delete process.env[k];
  for (const [k, v] of Object.entries(values)) if (v !== undefined) process.env[k] = v;
}

const cleared = () => VARIABLES.filter((k) => process.env[k] !== undefined);

test('no socket from systemd: the port, on loopback', () => {
  setVariables({});
  assert.deepEqual(agentHalfListenTarget({ port: 21000 }), { host: '127.0.0.1', port: 21000 });
});

test("variables naming another process are not this one's: the port — and they are cleared", () => {
  for (const pid of [String(process.ppid), String(process.pid + 1), '0', '-1', `${process.pid}x`]) {
    setVariables({ LISTEN_PID: pid, LISTEN_FDS: '1', LISTEN_FDNAMES: 'lamalibre-app-fx.socket' });
    assert.deepEqual(
      agentHalfListenTarget({ port: 21000 }),
      { host: '127.0.0.1', port: 21000 },
      pid,
    );
    assert.deepEqual(cleared(), [], `cleared (${pid})`);
  }
  // LISTEN_FDS alone names no process.
  setVariables({ LISTEN_FDS: '1' });
  assert.deepEqual(agentHalfListenTarget({ port: 21000 }), { host: '127.0.0.1', port: 21000 });
  assert.deepEqual(cleared(), []);
});

test('refused: any number of sockets for this process but one — cleared all the same, the value never echoed', () => {
  for (const [fds, said] of [
    ['0', /passed this process 0 sockets/],
    ['2', /passed this process 2 sockets/],
    ['', /an unreadable LISTEN_FDS/],
    ['1; rm -rf /', /an unreadable LISTEN_FDS/],
    [undefined, /no LISTEN_FDS/],
  ]) {
    setVariables({ LISTEN_PID: String(process.pid), LISTEN_FDS: fds, LISTEN_FDNAMES: 'a:b' });
    assert.throws(
      () => agentHalfListenTarget({ port: 21000 }),
      (err) =>
        said.test(err.message) &&
        /takes exactly one socket/.test(err.message) &&
        !err.message.includes('rm -rf'),
      String(fds),
    );
    assert.deepEqual(cleared(), [], `cleared (${fds})`);
  }
});

test('no socket and no port, or a port that is none: refused', () => {
  setVariables({});
  assert.throws(() => agentHalfListenTarget(), /no socket to this agent half and no port/);
  assert.throws(() => agentHalfListenTarget({}), /no port was given/);
  for (const port of [0, 65536, -1, 1.5, NaN, '21000']) {
    assert.throws(() => agentHalfListenTarget({ port }), /not a TCP port/, String(port));
  }
});

// ---------------------------------------------------------------------------
// End to end: a socket passed as descriptor 3, as systemd passes it
// ---------------------------------------------------------------------------

/** A listening socket on a free loopback port, as the socket unit holds one. */
async function listeningSocket() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port: 0 }, resolve);
  });
  // The descriptor to hand on (libuv's own, Unix only): the child gets a
  // duplicate of it as descriptor 3, as systemd's service gets its socket's.
  const fd = server._handle?.fd;
  assert.ok(Number.isInteger(fd) && fd >= 0, 'the listening socket has a descriptor');
  return { server, fd, port: server.address().port };
}

/**
 * Run `code` (an ES module) in a child Node.js process that receives
 * descriptor `fd` as its descriptor 3, with `LISTEN_PID` set to its own PID
 * (the shell's `$$`, kept across `exec`) and `LISTEN_FDS=1`. Resolves once it
 * prints a line, with that line.
 */
function runChild(code, fd) {
  const child = spawn(
    '/bin/sh',
    [
      '-c',
      'LISTEN_PID=$$; LISTEN_FDS=1; LISTEN_FDNAMES=lamalibre-app-fx.socket; ' +
        'export LISTEN_PID LISTEN_FDS LISTEN_FDNAMES; exec "$0" --input-type=module -e "$1"',
      process.execPath,
      code,
    ],
    { cwd: DAEMON_DIR, env: { PATH: process.env.PATH }, stdio: ['ignore', 'pipe', 'pipe', fd] },
  );
  let stdout = '';
  let stderr = '';
  child.stderr.on('data', (d) => (stderr += d));
  const exited = new Promise((resolve) => child.once('exit', (status) => resolve(status)));
  const line = new Promise((resolve, reject) => {
    child.stdout.on('data', (d) => {
      stdout += d;
      const nl = stdout.indexOf('\n');
      if (nl !== -1) resolve(stdout.slice(0, nl));
    });
    exited.then((status) => reject(new Error(`the child exited (${status}): ${stderr.trim()}`)));
  });
  return { child, line, exited, stderr: () => stderr };
}

async function answer(port) {
  const res = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(res.status, 200);
  return res.json();
}

/** What the child reports: its PID, the target, and systemd's variables after the call. */
const REPORT = `({
  pid: process.pid,
  target,
  left: ['LISTEN_PID', 'LISTEN_FDS', 'LISTEN_FDNAMES'].filter((k) => process.env[k] !== undefined),
})`;

test(
  'end to end, node:http: the socket systemd passed as descriptor 3 answers; the port given is not bound',
  {
    timeout: 30_000,
  },
  async () => {
    const socket = await listeningSocket();
    // A port the child must not bind: with a socket passed, the port is ignored.
    const code = `
    import http from 'node:http';
    import { agentHalfListenTarget } from '@lamalibre/lamaste/agent';
    const target = agentHalfListenTarget({ port: 1 });
    const report = ${REPORT};
    http
      .createServer((req, res) => res.end(JSON.stringify(report)))
      .listen(target, () => process.stdout.write('ready\\n'));
  `;
    const run = runChild(code, socket.fd);
    // The child holds its own duplicate: the parent lets go of its descriptor,
    // so every connection is the child's to accept.
    socket.server.close();
    try {
      assert.equal(await run.line, 'ready');
      const report = await answer(socket.port);
      assert.equal(report.pid, run.child.pid, 'LISTEN_PID named the process that answered');
      assert.deepEqual(report.target, { fd: 3, host: '127.0.0.1' });
      assert.deepEqual(report.left, [], 'cleared before anything else could inherit them');
    } finally {
      run.child.kill();
      await run.exited;
    }
  },
);

test(
  'end to end, Fastify 5: app.listen(target) listens on the passed socket, one server only',
  {
    timeout: 30_000,
  },
  async () => {
    const socket = await listeningSocket();
    const code = `
    import Fastify from 'fastify';
    import { agentHalfListenTarget } from '@lamalibre/lamaste/agent';
    const target = agentHalfListenTarget({ port: 1 });
    const report = ${REPORT};
    const app = Fastify();
    app.get('/', async () => ({ ...report, addresses: app.addresses() }));
    await app.listen(target);
    process.stdout.write('ready\\n');
  `;
    const run = runChild(code, socket.fd);
    socket.server.close();
    try {
      assert.equal(await run.line, 'ready');
      const report = await answer(socket.port);
      assert.equal(report.pid, run.child.pid);
      assert.deepEqual(report.target, { fd: 3, host: '127.0.0.1' });
      assert.deepEqual(report.left, []);
      // `host` kept Fastify from opening a second server on the descriptor for ::1.
      assert.deepEqual(report.addresses, [
        { address: '127.0.0.1', family: 'IPv4', port: socket.port },
      ]);
    } finally {
      run.child.kill();
      await run.exited;
    }
  },
);

test(
  'end to end: a descriptor 3 that is not a socket is refused before anything listens',
  {
    timeout: 30_000,
  },
  async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-half-listen-'));
    const fd = fs.openSync(path.join(dir, 'not-a-socket'), 'w');
    try {
      const code = `
      import { agentHalfListenTarget } from '@lamalibre/lamaste/agent';
      try {
        agentHalfListenTarget({ port: 1 });
        process.stdout.write('listened\\n');
      } catch (err) {
        process.stdout.write(err.message + '\\n');
      }
    `;
      const run = runChild(code, fd);
      assert.match(await run.line, /descriptor 3, which systemd passed, is not a socket/);
      await run.exited;
    } finally {
      fs.closeSync(fd);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);

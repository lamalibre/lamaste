#!/usr/bin/env node
/**
 * The read-only bridge between rodeo's VMs and a development Feria on this
 * machine's loopback.
 *
 * The E2E specs install `@lamalibre/*` packages from a registry; for a run
 * of the working tree that registry is a Feria in development mode
 * (`feria-serverd --no-npmrc --host 127.0.0.1 --public-url
 * http://<bridge address>:<port>`), which trusts every loopback request and
 * accepts the static `feria-dev` publish token — so it must never listen
 * where the VMs can reach it. This bridge is what they reach: it listens on
 * the VM-facing address and forwards **reads only** (GET and HEAD) to the
 * loopback Feria, dropping every credential header, so nothing on a VM can
 * publish, delete or authenticate. The client's `Host` is kept, because
 * Feria builds tarball URLs from it.
 *
 *   node scripts/dev-feria-bridge.mjs --listen 192.168.2.1:4873 --to 127.0.0.1:4873
 *
 * Built-ins only; logs one line per request (method, path, status) to stdout.
 */

import http from 'node:http';
import net from 'node:net';

const READ_METHODS = new Set(['GET', 'HEAD']);

/** Headers a VM never passes on: credentials, and hop-by-hop ones. */
const DROPPED_REQUEST_HEADERS = new Set([
  'authorization',
  'cookie',
  'proxy-authorization',
  'npm-auth-type',
  'npm-otp',
  'connection',
  'keep-alive',
  'transfer-encoding',
  'upgrade',
]);

function parseHostPort(value, flag) {
  const at = typeof value === 'string' ? value.lastIndexOf(':') : -1;
  const host = at > 0 ? value.slice(0, at) : '';
  const port = at > 0 ? Number(value.slice(at + 1)) : NaN;
  if (!net.isIP(host) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${flag} takes <ip>:<port>`);
  }
  return { host, port };
}

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--listen') opts.listen = parseHostPort(argv[++i], '--listen');
    else if (arg === '--to') opts.to = parseHostPort(argv[++i], '--to');
    else throw new Error(`Unknown argument ${arg}`);
  }
  if (!opts.listen || !opts.to) {
    throw new Error('Usage: dev-feria-bridge.mjs --listen <ip>:<port> --to 127.0.0.1:<port>');
  }
  if (opts.to.host !== '127.0.0.1' && opts.to.host !== '::1') {
    throw new Error('--to must be the loopback Feria (127.0.0.1 or ::1)');
  }
  if (opts.listen.host === '0.0.0.0' || opts.listen.host === '::') {
    throw new Error('--listen must name one address, not every interface');
  }
  return opts;
}

function main() {
  const { listen, to } = parseArgs(process.argv.slice(2));
  const server = http.createServer((req, res) => {
    const method = req.method ?? '';
    const path = req.url ?? '/';
    const log = (status) => console.log(`${method} ${path.split('?')[0]} ${status}`);
    if (!READ_METHODS.has(method)) {
      res.writeHead(405, { allow: 'GET, HEAD', 'content-type': 'text/plain' });
      res.end('The development registry bridge forwards reads only\n');
      log(405);
      req.resume();
      return;
    }
    const headers = {};
    for (const [name, value] of Object.entries(req.headers)) {
      if (!DROPPED_REQUEST_HEADERS.has(name) && value !== undefined) headers[name] = value;
    }
    const upstream = http.request(
      { host: to.host, port: to.port, method, path, headers },
      (answer) => {
        res.writeHead(answer.statusCode ?? 502, answer.headers);
        answer.pipe(res);
        log(answer.statusCode ?? 502);
      },
    );
    upstream.on('error', (err) => {
      if (!res.headersSent) {
        res.writeHead(502, { 'content-type': 'text/plain' });
        res.end(`The development registry is not reachable: ${err.code ?? err.message}\n`);
      } else {
        res.destroy();
      }
      log(502);
    });
    req.on('aborted', () => upstream.destroy());
    upstream.end();
  });
  server.on('error', (err) => {
    console.error(`Cannot listen on ${listen.host}:${listen.port}: ${err.code ?? err.message}`);
    process.exit(1);
  });
  server.listen(listen.port, listen.host, () => {
    console.log(
      `Forwarding reads from ${listen.host}:${listen.port} to ${to.host}:${to.port} (GET and HEAD only)`,
    );
  });
  const stop = () => server.close(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

try {
  main();
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(2);
}

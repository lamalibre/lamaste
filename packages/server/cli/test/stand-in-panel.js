/**
 * A stand-in for the panel in the CLI's tests: HTTPS on loopback with the
 * certificate it is given (the CLI verifies the panel and never runs curl
 * with `-k`), asking for the client certificate as nginx does. It records
 * each request, the client certificate each handshake presented, and the
 * command lines `ps` shows while curl is still waiting — what other local
 * users could read of a request. Not a test file itself.
 */

import { once } from 'node:events';
import https from 'node:https';
import { execa } from 'execa';
import { PANEL_ADDRESS } from './tls-fixtures.js';

/**
 * @param {{ cert: Buffer, key: Buffer, certPath: string }} tlsIdentity  the certificate it presents
 * @param {(req: { method: string, url: string, headers: import('node:http').IncomingHttpHeaders, body: string }) => { status: number, body: string }} [answer]
 * @param {import('node:tls').TlsOptions} [tlsOptions]  e.g. the protocol and suites it offers
 * @param {string} [expectedCertPath]  the panel certificate the CLI is to verify it against
 *   (default: the one it presents; an impostor's test passes the real panel's)
 */
export async function standInPanel(
  tlsIdentity,
  answer = () => ({ status: 200, body: '{}' }),
  tlsOptions = {},
  expectedCertPath = tlsIdentity.certPath,
) {
  const seen = [];
  const handshakes = [];
  const server = https.createServer(
    {
      cert: tlsIdentity.cert,
      key: tlsIdentity.key,
      requestCert: true,
      rejectUnauthorized: false,
      ...tlsOptions,
    },
    (req, res) => {
      let body = '';
      req.setEncoding('utf-8');
      req.on('data', (chunk) => (body += chunk));
      req.on('end', async () => {
        const { port } = server.address();
        const ps = await execa('ps', ['axww', '-o', 'args='], { reject: false });
        const commandLines =
          ps.exitCode === 0
            ? ps.stdout.split('\n').filter((line) => line.includes(`127.0.0.1:${port}`))
            : null;
        const request = { method: req.method, url: req.url, headers: req.headers, body };
        seen.push({ ...request, commandLines });
        const { status, body: reply } = answer(request);
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(reply);
      });
    },
  );
  server.on('secureConnection', (socket) => {
    handshakes.push({ clientCertificate: socket.getPeerCertificate()?.subject?.CN ?? null });
  });
  server.on('tlsClientError', () => {});
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  return {
    identity: { certPath: expectedCertPath, address: PANEL_ADDRESS, port },
    seen,
    handshakes,
    server,
  };
}

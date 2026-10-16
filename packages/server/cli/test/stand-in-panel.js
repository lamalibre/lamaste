/**
 * A stand-in for the panel in the CLI's tests: plain HTTP on loopback
 * (curl uses the client certificate only for TLS) that records each request
 * and the command lines `ps` shows while curl is still waiting — what other
 * local users could read of a request. Not a test file itself.
 */

import { once } from 'node:events';
import http from 'node:http';
import { execa } from 'execa';

/**
 * A stand-in panel on loopback (plain HTTP — curl uses the client
 * certificate only for TLS). It records each request and, while curl is
 * still waiting for the answer, the command lines `ps` shows for the
 * process requesting its port.
 *
 * @param {(req: { method: string, url: string, headers: http.IncomingHttpHeaders, body: string }) => { status: number, body: string }} answer
 */
export async function standInPanel(answer) {
  const seen = [];
  const server = http.createServer((req, res) => {
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
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { panelUrl: `http://127.0.0.1:${server.address().port}`, seen, server };
}

/**
 * Where an agent half listens.
 *
 * An agent half Lamaste installs (`lamaste-apphost`) never binds its port
 * itself: systemd does. The helper writes a socket unit beside the agent
 * half's service, `lamalibre-app-<route>.socket`, listening on
 * `127.0.0.1:<port>` from the plugin config, and the service requires it.
 * Whenever the service starts — at boot, on `systemctl start` or `restart`,
 * after a crash (`Restart=`), or on a connection while it is stopped —
 * systemd hands it that listening socket as descriptor 3 and says so in
 * `LISTEN_PID` (the process it is for) and `LISTEN_FDS` (how many it passed;
 * `sd_listen_fds(3)`). The port stays bound by systemd while the agent half
 * restarts, is updated or is stopped, so no other local process can take it
 * in between.
 *
 * An agent half installed by hand (the slice 2a way, a unit of the
 * operator's) gets no socket and binds the plugin config's port itself.
 * {@link agentHalfListenTarget} answers both: the same code runs either way.
 */

import { fstatSync } from 'node:fs';

/** The only address an agent half listens on (the socket unit's `ListenStream=`). */
const AGENT_HALF_LISTEN_HOST = '127.0.0.1' as const;
/** The first descriptor systemd passes (`SD_LISTEN_FDS_START`). */
const LISTEN_FDS_START = 3;
const PID_RE = /^[1-9][0-9]{0,9}$/;

/**
 * What to listen on, as `server.listen()` of `node:net`, `node:http` and
 * Fastify 5 take it: the socket systemd passed (`fd`), or the port to bind.
 * `host` is where the socket listens either way. With `fd` Node.js ignores
 * it (the socket is bound already) — Fastify needs it: given its default,
 * `localhost`, Fastify binds a second server for every other address
 * `localhost` resolves to (`::1`), on the same descriptor.
 */
export type AgentHalfListenTarget =
  | { readonly fd: number; readonly host: '127.0.0.1' }
  | { readonly host: '127.0.0.1'; readonly port: number };

export interface AgentHalfListenOptions {
  /**
   * The port to bind when systemd passed no socket — an agent half installed
   * by hand: the plugin config's port (`await verifier.port()` of
   * `createCallerAssertionVerifier`). Ignored when systemd passed one.
   */
  readonly port?: number | undefined;
}

/**
 * Where this agent half listens: `{ fd: 3, host: '127.0.0.1' }` when
 * systemd passed this process exactly one socket (`LISTEN_PID` is this
 * process and `LISTEN_FDS` is 1), else `{ host: '127.0.0.1', port }` from
 * `opts.port`. Under the unit `lamaste-apphost` writes the socket is always
 * there; never bind a port yourself — systemd holds it, and the agent half
 * would fail with `EADDRINUSE`.
 *
 * Systemd's variables (`LISTEN_PID`, `LISTEN_FDS`, `LISTEN_FDNAMES`) are
 * removed from `process.env` on the first call, whatever they said, so a
 * process the agent half starts never takes the socket for its own. Call
 * it once, at start-up: a second call no longer sees the socket.
 *
 * Throws when systemd passed this process another number of sockets than
 * one, when descriptor 3 is not a socket, or when it passed none and no
 * valid port is given.
 *
 * ```js
 * import http from 'node:http';
 * import Fastify from 'fastify';
 * import {
 *   agentHalfListenTarget,
 *   createCallerAssertionVerifier,
 * } from '@lamalibre/lamaste/agent'; // bundled
 *
 * const verifier = createCallerAssertionVerifier({
 *   configPath: process.env.LAMASTE_APP_CONFIG,
 *   plugin: 'market-indicators',
 * });
 * const target = agentHalfListenTarget({ port: await verifier.port() });
 *
 * // node:http (or node:net, Express's app.listen):
 * http.createServer(handler).listen(target);
 *
 * // Fastify 5 — pass the target as it is (with `fd`, `host` keeps Fastify
 * // from binding a second server); it tracks the listener, logs its address
 * // and closes it on `app.close()`:
 * const app = Fastify();
 * await app.listen(target);
 * ```
 */
export function agentHalfListenTarget(opts: AgentHalfListenOptions = {}): AgentHalfListenTarget {
  const env = process.env;
  const listenPid = env['LISTEN_PID'];
  const listenFds = env['LISTEN_FDS'];
  delete env['LISTEN_PID'];
  delete env['LISTEN_FDS'];
  delete env['LISTEN_FDNAMES'];

  // Only variables naming this very process are systemd's word to it; any
  // others were inherited from a parent and describe no descriptor here.
  if (listenPid !== undefined && PID_RE.test(listenPid) && Number(listenPid) === process.pid) {
    if (listenFds !== '1') {
      // The value is systemd's, a count; anything else is described, never echoed.
      const passed =
        listenFds === undefined
          ? 'no LISTEN_FDS'
          : /^[0-9]{1,6}$/.test(listenFds)
            ? `${listenFds} sockets (LISTEN_FDS)`
            : 'an unreadable LISTEN_FDS';
      throw new Error(
        `systemd passed this process ${passed}; an agent half takes exactly one socket — ` +
          'its unit’s, lamalibre-app-<route>.socket',
      );
    }
    let isSocket: boolean;
    try {
      isSocket = fstatSync(LISTEN_FDS_START).isSocket();
    } catch (err: unknown) {
      throw new Error(
        `systemd's socket, descriptor ${LISTEN_FDS_START}, is not open ` +
          `(${(err as NodeJS.ErrnoException).code ?? String(err)})`,
      );
    }
    if (!isSocket) {
      throw new Error(`descriptor ${LISTEN_FDS_START}, which systemd passed, is not a socket`);
    }
    return { fd: LISTEN_FDS_START, host: AGENT_HALF_LISTEN_HOST };
  }

  const port = opts.port;
  if (port === undefined) {
    throw new Error(
      'systemd passed no socket to this agent half and no port was given to listen on ' +
        "(the plugin config's port, for an agent half installed by hand)",
    );
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('the port to listen on is not a TCP port (1–65535)');
  }
  return { host: AGENT_HALF_LISTEN_HOST, port };
}

/**
 * The consumer's side of peers (design: slice 8) — what an agent half uses
 * to call other plugins and to receive their events:
 *
 * - **the peer channel**: the relay attaches to the half
 *   (`GET /admin/peers/attach`, `Upgrade: lamaste-peers/1`, a `lamaste`
 *   caller assertion); the half answers `101` with its responder signature
 *   and runs HTTP/2 *as the client* over that socket
 *   ({@link Peers.attach}, {@link Peers.handleUpgrade}). A new attach
 *   replaces the old channel: new calls take the new one, calls in flight
 *   finish on the old.
 * - **calls** ({@link Peers.call}, {@link Peers.json}): a stream on the
 *   channel per call. The relay decides and forwards; its own answers carry
 *   `x-lamalibre-peer-relay` and become a {@link PeerCallError} with its
 *   code, so a consumer never mistakes a refusal for the provider's answer.
 *   `onBehalfOf: request` passes on the delegation the relay gave with the
 *   request being served (and its hop count); `from: request` only the hop
 *   count. A call made while no channel is up waits up to `attachWaitMs`.
 * - **the inbox** ({@link Peers.on}): one pull loop per subscribed scope
 *   over the channel (`POST /.lamaste/events`). Each batch is applied in one
 *   `BEGIN IMMEDIATE` transaction with the cursor: the handlers run
 *   synchronously inside it, so an event applied is an event remembered.
 *   A **gap** (first contact, a renewed grant or subscription, another
 *   stream, a cursor behind retention) is handled in order: recorded as
 *   pending in one transaction (no pull while it is pending); `onGap` — the
 *   consumer's reconcile through the provider's endpoints — retried until it
 *   resolves; then, in one transaction, the cursor set to the gap's
 *   `resumeFrom` (captured before the reconcile read anything) with the new
 *   epoch and stream, and the gap cleared. A crash leaves the gap pending,
 *   and the next start runs `onGap` again. Handlers must be idempotent (an
 *   event may come again after a reconcile that already reflected it).
 *
 * Do not hold a transaction of your own across an `await` on the database
 * the inbox uses: its `BEGIN IMMEDIATE` would fail (and retry) meanwhile.
 */

import http2 from 'node:http2';
import type { ClientHttp2Session, ClientHttp2Stream, IncomingHttpHeaders } from 'node:http2';
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex, Readable } from 'node:stream';

import { RESPONDER_HEADER, isOriginFormPath } from '../caller-assertion.js';
import type { PeerCallerIdentity } from '../caller-assertion.js';
import { parsePeerEventsChannelAnswer } from '../peer-events.js';
import type { PeerEvent, PeerEventsGap } from '../peer-events.js';
import {
  AGENT_HALF_PEERS_ATTACH_PATH,
  PEER_ATTACH_WAIT_MS,
  PEER_CALL_TIMEOUT_DEFAULT_MS,
  PEER_CALL_TIMEOUT_MAX_MS,
  PEER_CHANNEL_EVENTS_PATH,
  PEER_CHANNEL_UPGRADE,
  PEER_DELEGATION_HEADER,
  PEER_EVENTS_WAIT_MAX_MS,
  PEER_HOPS_HEADER,
  PEER_RELAY_HEADER,
  PEER_REATTACH_MAX_MS,
  PEER_REATTACH_MIN_MS,
  PEER_SCOPE_HEADER,
  PEER_TIMEOUT_HEADER,
  isPeerEventType,
  isPeerScope,
  peerScopeProvider,
} from '../peers.js';
import type { PeerGapReason } from '../peers.js';
import { createCallerAssertionVerifier } from './app-plugins.js';
import type { CallerAssertionVerifier } from './app-plugins.js';
import type { PeerSqlDatabase } from './peer-outbox.js';
import { peerContextOf } from './peer-context.js';

/** A failed call: the relay's code (`not_granted`, `peer_unavailable`, …) or the client's own. */
export class PeerCallError extends Error {
  /** The relay's code, `relay_unavailable` (no channel), `timeout`, or `provider_status` (json()). */
  readonly code: string;
  /** The HTTP status, when there was an answer. */
  readonly status: number | null;
  /** Seconds the relay asked to wait (`peer_unavailable`). */
  readonly retryAfter: number | null;
  /** The provider's unavailability reason (`down_tunnel`, …), when the relay gave one. */
  readonly reason: string | null;
  /** The answer's parsed body, when `json()` refused a provider's status. */
  readonly body: unknown;

  constructor(
    code: string,
    message: string,
    extra: {
      status?: number | null;
      retryAfter?: number | null;
      reason?: string | null;
      body?: unknown;
    } = {},
  ) {
    super(message);
    this.name = 'PeerCallError';
    this.code = code;
    this.status = extra.status ?? null;
    this.retryAfter = extra.retryAfter ?? null;
    this.reason = extra.reason ?? null;
    this.body = extra.body;
  }
}

/** A request being served, as `onBehalfOf` / `from` read it (Fastify's or Node's). */
export interface PeerRequestLike {
  readonly headers: IncomingHttpHeaders | Record<string, string | string[] | undefined>;
}

export interface PeerCallOptions {
  /** Appended as a query string. */
  readonly query?: Record<string, string | number | boolean> | URLSearchParams | undefined;
  readonly headers?: Record<string, string> | undefined;
  /** A body as bytes, text or a stream; or `json` instead. */
  readonly body?: Buffer | Uint8Array | string | Readable | undefined;
  /** A JSON body (sets `content-type`). */
  readonly json?: unknown;
  /**
   * The request this call serves, made on behalf of its person: the
   * delegation the relay gave with it is passed on, and its hop count.
   */
  readonly onBehalfOf?: PeerRequestLike | undefined;
  /** The request this call serves, as the plugin itself: only its hop count. */
  readonly from?: PeerRequestLike | undefined;
  /** How long to wait for the provider's headers (default 30 s, at most 120 s). */
  readonly timeoutMs?: number | undefined;
  readonly signal?: AbortSignal | undefined;
}

/** The provider's answer. */
export interface PeerResponse {
  readonly status: number;
  readonly headers: Record<string, string | string[]>;
  /** The body as it streams. Read it, or call one of the helpers once. */
  readonly body: Readable;
  buffer(maxBytes?: number): Promise<Buffer>;
  text(maxBytes?: number): Promise<string>;
  json<T = unknown>(maxBytes?: number): Promise<T>;
}

/** An event handler: runs inside the transaction that moves the cursor; synchronous. */
export type PeerEventHandler = (event: PeerEvent, db: PeerSqlDatabase) => void;

/** What `onGap` is told. */
export interface PeerGapNotice {
  readonly provider: string;
  readonly scope: string;
  readonly reason: PeerGapReason;
}

export interface PeersLogger {
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
}

export interface PeersOptions {
  /** The config file the agent wrote for this plugin (`LAMASTE_APP_CONFIG`). */
  readonly configPath?: string | undefined;
  /** The plugin's route. */
  readonly plugin: string;
  /** The half's verifier, when it already has one (one nonce store per process). */
  readonly verifier?: CallerAssertionVerifier | undefined;
  /** The database the inbox keeps its cursors in (needed once `on` is used). */
  readonly db?: PeerSqlDatabase | undefined;
  /** Reconcile after a gap; retried until it resolves. */
  readonly onGap?: ((notice: PeerGapNotice) => void | Promise<void>) | undefined;
  /** How long a call waits for a channel (default `PEER_ATTACH_WAIT_MS`). */
  readonly attachWaitMs?: number | undefined;
  /** How long an events pull waits at the head (default `PEER_EVENTS_WAIT_MAX_MS`). */
  readonly eventsWaitMs?: number | undefined;
  readonly logger?: PeersLogger | undefined;
}

export interface Peers {
  /** Take the relay's attaches on `server` — every other upgrade request is refused. */
  attach(server: Server): void;
  /**
   * Take one upgrade request if it is the relay's attach: true when it was
   * (answered here), false to leave it to the half's other upgrade handlers.
   */
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean;
  call(scope: string, method: string, path: string, opts?: PeerCallOptions): Promise<PeerResponse>;
  /** A call whose answer must be 2xx JSON (`provider_status` otherwise); resolves its body. */
  json<T = unknown>(
    scope: string,
    method: string,
    path: string,
    opts?: PeerCallOptions,
  ): Promise<T>;
  /** Subscribe: `handler` gets the events of `type` in `scope` (declared in the manifest's consumes). */
  on(scope: string, type: string, handler: PeerEventHandler): void;
  /** Whether a channel is up. */
  connected(): boolean;
  /** What `GET /admin/peers` reports of the consumer side. */
  readiness(): { readonly consumer: true; readonly inbox: boolean };
  close(): Promise<void>;
}

const CURSOR_TABLE = `
CREATE TABLE IF NOT EXISTS lamaste_peer_cursors (
  scope TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  stream_id TEXT,
  epoch TEXT,
  cursor INTEGER,
  gap_reason TEXT,
  gap_resume_from INTEGER,
  gap_epoch TEXT,
  gap_stream_id TEXT,
  updated_at TEXT NOT NULL
);
`;

interface CursorRow {
  scope: string;
  provider: string;
  stream_id: string | null;
  epoch: string | null;
  cursor: number | null;
  gap_reason: string | null;
  gap_resume_from: number | null;
  gap_epoch: string | null;
  gap_stream_id: string | null;
}

const RELAY_ANSWER_MAX_BYTES = 64 * 1024;
const DEFAULT_MAX_BYTES = 16 * 1024 * 1024;

function headerValue(headers: PeerRequestLike['headers'], name: string): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

async function readAll(stream: Readable, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > maxBytes) {
      stream.destroy();
      throw new PeerCallError('too_large', `The answer is larger than ${maxBytes} bytes`);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref();
  });
}

export function createPeers(opts: PeersOptions): Peers {
  const verifier =
    opts.verifier ??
    (opts.configPath
      ? createCallerAssertionVerifier({ configPath: opts.configPath, plugin: opts.plugin })
      : null);
  if (!verifier) throw new Error('createPeers needs a verifier or a configPath');
  const attachWaitMs = opts.attachWaitMs ?? PEER_ATTACH_WAIT_MS;
  const eventsWaitMs = Math.min(
    opts.eventsWaitMs ?? PEER_EVENTS_WAIT_MAX_MS,
    PEER_EVENTS_WAIT_MAX_MS,
  );
  const logger = opts.logger;

  let session: ClientHttp2Session | null = null;
  let closed = false;
  let waiters: ((s: ClientHttp2Session | null) => void)[] = [];
  const handlers = new Map<string, Map<string, PeerEventHandler>>();
  const loops = new Set<string>();
  let tableReady = false;

  function setSession(next: ClientHttp2Session): void {
    const previous = session;
    session = next;
    next.on('error', () => {
      // 'close' follows.
    });
    next.once('close', () => {
      if (session === next) session = null;
    });
    // The relay drains a channel it replaces; new calls go to the newest.
    next.once('goaway', () => {
      if (session === next) session = null;
    });
    const waiting = waiters;
    waiters = [];
    for (const fn of waiting) fn(next);
    // Calls in flight on the previous one finish there.
    if (previous && !previous.closed) previous.close();
  }

  function sessionReady(): Promise<ClientHttp2Session | null> {
    if (session && !session.closed && !session.destroyed) return Promise.resolve(session);
    if (closed) return Promise.resolve(null);
    return new Promise((resolve) => {
      const done = (s: ClientHttp2Session | null): void => {
        clearTimeout(timer);
        resolve(s);
      };
      const timer = setTimeout(() => {
        waiters = waiters.filter((fn) => fn !== done);
        resolve(null);
      }, attachWaitMs);
      timer.unref();
      waiters.push(done);
    });
  }

  function refuseUpgrade(socket: Duplex, status: number, reason: string): void {
    socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  }

  function handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean {
    const url = req.url ?? '';
    if ((url.split('?')[0] ?? '') !== AGENT_HALF_PEERS_ATTACH_PATH) return false;
    socket.on('error', () => socket.destroy());
    const upgrade = String(req.headers.upgrade ?? '').toLowerCase();
    if (upgrade !== PEER_CHANNEL_UPGRADE || (req.method ?? '').toUpperCase() !== 'GET' || closed) {
      refuseUpgrade(socket, 400, 'Bad Request');
      return true;
    }
    void (async () => {
      const verified = await verifier!.verify(req.headers, 'GET', url, { body: null });
      if (!verified.ok) return refuseUpgrade(socket, 401, 'Unauthorized');
      if (verified.payload.caller.type !== 'lamaste') {
        return refuseUpgrade(socket, 403, 'Forbidden');
      }
      socket.write(
        'HTTP/1.1 101 Switching Protocols\r\n' +
          'Connection: Upgrade\r\n' +
          `Upgrade: ${PEER_CHANNEL_UPGRADE}\r\n` +
          `${RESPONDER_HEADER}: ${verified.responder(101, '')}\r\n\r\n`,
      );
      if (head.length > 0) socket.unshift(head);
      const next = http2.connect('http://lamaste-relay.invalid', {
        createConnection: () => socket,
        settings: { enablePush: false },
      });
      setSession(next);
      logger?.info({ plugin: opts.plugin }, 'Peer channel attached');
      startLoops();
    })().catch(() => socket.destroy());
    return true;
  }

  function hopsOf(request: PeerRequestLike | undefined): number {
    if (!request) return 0;
    return peerContextOf(request)?.hops ?? 0;
  }

  async function call(
    scope: string,
    method: string,
    path: string,
    callOpts: PeerCallOptions = {},
  ): Promise<PeerResponse> {
    if (!isPeerScope(scope)) throw new PeerCallError('bad_request', `Not a scope: "${scope}"`);
    if (!isOriginFormPath(path) || path.includes('?')) {
      throw new PeerCallError('bad_request', 'A path starts with one "/" and carries no query');
    }
    const upper = method.toUpperCase();
    let target = path;
    if (callOpts.query) {
      const qs =
        callOpts.query instanceof URLSearchParams
          ? callOpts.query.toString()
          : new URLSearchParams(
              Object.entries(callOpts.query).map(([k, v]) => [k, String(v)]),
            ).toString();
      if (qs.length > 0) target = `${path}?${qs}`;
    }
    const timeoutMs = Math.min(
      Math.max(callOpts.timeoutMs ?? PEER_CALL_TIMEOUT_DEFAULT_MS, 1_000),
      PEER_CALL_TIMEOUT_MAX_MS,
    );
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(callOpts.headers ?? {})) {
      const lower = name.toLowerCase();
      if (lower.startsWith(':') || lower.startsWith('x-lamalibre-')) continue;
      headers[lower] = value;
    }
    headers[':method'] = upper;
    headers[':path'] = target;
    headers[PEER_SCOPE_HEADER] = scope;
    headers[PEER_HOPS_HEADER] = String(hopsOf(callOpts.onBehalfOf ?? callOpts.from));
    headers[PEER_TIMEOUT_HEADER] = String(timeoutMs);
    if (callOpts.onBehalfOf) {
      const delegation = headerValue(callOpts.onBehalfOf.headers, PEER_DELEGATION_HEADER);
      if (!delegation) {
        throw new PeerCallError(
          'delegation_invalid',
          'The request carries no delegation: it is not a request of a person through the relay',
        );
      }
      headers[PEER_DELEGATION_HEADER] = delegation;
    }
    let body = callOpts.body;
    if (callOpts.json !== undefined) {
      body = JSON.stringify(callOpts.json);
      headers['content-type'] = 'application/json';
    }

    const s = await sessionReady();
    if (!s) throw new PeerCallError('relay_unavailable', 'No peer channel to the relay');
    let stream: ClientHttp2Stream;
    try {
      stream = s.request(headers, { endStream: body === undefined });
    } catch (err: unknown) {
      throw new PeerCallError(
        'relay_unavailable',
        `The peer channel refused the call: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (callOpts.signal) {
      const signal = callOpts.signal;
      if (signal.aborted) stream.close(http2.constants.NGHTTP2_CANCEL);
      else
        signal.addEventListener('abort', () => stream.close(http2.constants.NGHTTP2_CANCEL), {
          once: true,
        });
    }
    if (body !== undefined) {
      if (typeof body === 'string' || body instanceof Uint8Array) stream.end(body);
      else body.pipe(stream);
    }

    const responseHeaders = await new Promise<IncomingHttpHeaders>((resolve, reject) => {
      const timer = setTimeout(() => {
        stream.close(http2.constants.NGHTTP2_CANCEL);
        reject(new PeerCallError('timeout', `No answer within ${timeoutMs} ms`));
      }, timeoutMs + 5_000);
      stream.once('response', (h) => {
        clearTimeout(timer);
        resolve(h);
      });
      stream.once('error', (err) => {
        clearTimeout(timer);
        reject(new PeerCallError('relay_unavailable', `The call failed: ${err.message}`));
      });
      stream.once('close', () => {
        clearTimeout(timer);
        reject(new PeerCallError('relay_unavailable', 'The channel closed before an answer'));
      });
    });
    const status = Number(responseHeaders[':status'] ?? 0);
    const relayCode = responseHeaders[PEER_RELAY_HEADER];
    if (relayCode !== undefined) {
      let parsed: unknown = null;
      try {
        parsed = JSON.parse((await readAll(stream, RELAY_ANSWER_MAX_BYTES)).toString('utf-8'));
      } catch {
        parsed = null;
      }
      const record = (parsed ?? {}) as Record<string, unknown>;
      const retry = Number(responseHeaders['retry-after']);
      throw new PeerCallError(
        String(relayCode),
        typeof record['error'] === 'string'
          ? record['error']
          : `The relay refused the call (${status})`,
        {
          status,
          retryAfter: Number.isFinite(retry) && retry > 0 ? retry : null,
          reason: typeof record['reason'] === 'string' ? record['reason'] : null,
        },
      );
    }
    const out: Record<string, string | string[]> = {};
    for (const [name, value] of Object.entries(responseHeaders)) {
      if (name.startsWith(':') || value === undefined) continue;
      out[name] = Array.isArray(value) ? value : String(value);
    }
    let consumed = false;
    const once = (): Readable => {
      if (consumed) throw new Error('The body was read already');
      consumed = true;
      return stream;
    };
    return {
      status,
      headers: out,
      body: stream,
      buffer: (maxBytes = DEFAULT_MAX_BYTES) => readAll(once(), maxBytes),
      text: async (maxBytes = DEFAULT_MAX_BYTES) =>
        (await readAll(once(), maxBytes)).toString('utf-8'),
      json: async <T>(maxBytes = DEFAULT_MAX_BYTES) => {
        const raw = (await readAll(once(), maxBytes)).toString('utf-8');
        return (raw.length === 0 ? null : JSON.parse(raw)) as T;
      },
    };
  }

  // --- the inbox --------------------------------------------------------------

  function db(): PeerSqlDatabase {
    if (!opts.db) throw new Error('The peers inbox needs a db (createPeers({ db }))');
    if (!tableReady) {
      opts.db.exec(CURSOR_TABLE);
      tableReady = true;
    }
    return opts.db;
  }

  function cursorRow(scope: string): CursorRow | null {
    const row = db().prepare('SELECT * FROM lamaste_peer_cursors WHERE scope = ?').get(scope);
    return (row as CursorRow | undefined) ?? null;
  }

  function inTransaction<T>(fn: (d: PeerSqlDatabase) => T): T {
    const d = db();
    d.exec('BEGIN IMMEDIATE');
    try {
      const result = fn(d);
      d.exec('COMMIT');
      return result;
    } catch (err: unknown) {
      try {
        d.exec('ROLLBACK');
      } catch {
        // Already rolled back.
      }
      throw err;
    }
  }

  function recordGap(scope: string, gap: PeerEventsGap): void {
    inTransaction((d) => {
      d.prepare(
        `INSERT INTO lamaste_peer_cursors (scope, provider, gap_reason, gap_resume_from, gap_epoch, gap_stream_id, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (scope) DO UPDATE SET gap_reason = excluded.gap_reason,
           gap_resume_from = excluded.gap_resume_from, gap_epoch = excluded.gap_epoch,
           gap_stream_id = excluded.gap_stream_id, updated_at = excluded.updated_at`,
      ).run(
        scope,
        peerScopeProvider(scope),
        gap.reason,
        gap.resumeFrom,
        gap.epoch,
        gap.streamId,
        new Date().toISOString(),
      );
    });
  }

  async function resolveGap(scope: string, row: CursorRow): Promise<void> {
    let delay = PEER_REATTACH_MIN_MS;
    for (;;) {
      if (closed) return;
      try {
        await opts.onGap?.({
          provider: row.provider,
          scope,
          reason: row.gap_reason as PeerGapReason,
        });
        break;
      } catch (err: unknown) {
        logger?.warn(
          { scope, error: err instanceof Error ? err.name : typeof err },
          'Reconciling after a gap failed; retrying',
        );
        await sleep(delay);
        delay = Math.min(delay * 2, PEER_REATTACH_MAX_MS);
      }
    }
    inTransaction((d) => {
      d.prepare(
        `UPDATE lamaste_peer_cursors SET cursor = gap_resume_from, epoch = gap_epoch,
           stream_id = gap_stream_id, gap_reason = NULL, gap_resume_from = NULL,
           gap_epoch = NULL, gap_stream_id = NULL, updated_at = ?
         WHERE scope = ? AND gap_reason IS NOT NULL`,
      ).run(new Date().toISOString(), scope);
    });
    logger?.info({ scope, reason: row.gap_reason }, 'Reconciled after a gap');
  }

  function applyEvents(
    scope: string,
    expect: CursorRow,
    answer: { to: number; events: readonly PeerEvent[] },
  ): void {
    const byType = handlers.get(scope) ?? new Map<string, PeerEventHandler>();
    inTransaction((d) => {
      const now = d.prepare('SELECT * FROM lamaste_peer_cursors WHERE scope = ?').get(scope) as
        | CursorRow
        | undefined;
      // Something else moved the cursor (a gap recorded meanwhile): start over.
      if (
        !now ||
        now.cursor !== expect.cursor ||
        now.epoch !== expect.epoch ||
        now.stream_id !== expect.stream_id ||
        now.gap_reason !== null
      ) {
        return;
      }
      for (const event of answer.events) byType.get(event.type)?.(event, d);
      d.prepare('UPDATE lamaste_peer_cursors SET cursor = ?, updated_at = ? WHERE scope = ?').run(
        answer.to,
        new Date().toISOString(),
        scope,
      );
    });
  }

  async function pullOnce(scope: string): Promise<number> {
    const row = cursorRow(scope);
    if (row && row.gap_reason !== null) {
      await resolveGap(scope, row);
      return 0;
    }
    const response = await call(scope, 'POST', PEER_CHANNEL_EVENTS_PATH, {
      json: {
        scope,
        after: row?.cursor ?? null,
        epoch: row?.epoch ?? null,
        streamId: row?.stream_id ?? null,
        waitMs: eventsWaitMs,
      },
      timeoutMs: eventsWaitMs + 15_000,
    });
    if (response.status !== 200) {
      response.body.resume();
      throw new PeerCallError('relay_error', `The events pull answered ${response.status}`, {
        status: response.status,
      });
    }
    const answer = parsePeerEventsChannelAnswer(await response.json(RELAY_ANSWER_MAX_BYTES * 32), {
      scope,
      after: row?.cursor ?? null,
    });
    if (!answer) throw new PeerCallError('relay_error', 'The relay answered a malformed pull');
    if ('gap' in answer) {
      recordGap(scope, answer.gap);
      logger?.info({ scope, reason: answer.gap.reason }, 'An events gap: reconciling');
      return 0;
    }
    if (!row) return 0;
    applyEvents(scope, row, answer);
    return answer.events.length;
  }

  async function loop(scope: string): Promise<void> {
    let delay = PEER_REATTACH_MIN_MS;
    while (!closed) {
      if (!session) {
        const s = await sessionReady();
        if (!s) continue;
      }
      try {
        await pullOnce(scope);
        delay = PEER_REATTACH_MIN_MS;
      } catch (err: unknown) {
        const wait =
          err instanceof PeerCallError && err.retryAfter !== null ? err.retryAfter * 1000 : delay;
        if (!(err instanceof PeerCallError && err.code === 'relay_unavailable')) {
          logger?.warn(
            {
              scope,
              code:
                err instanceof PeerCallError ? err.code : err instanceof Error ? err.name : 'error',
            },
            'An events pull failed',
          );
        }
        await sleep(wait);
        delay = Math.min(delay * 2, PEER_REATTACH_MAX_MS);
      }
    }
    loops.delete(scope);
  }

  function startLoops(): void {
    for (const scope of handlers.keys()) {
      if (loops.has(scope) || closed) continue;
      loops.add(scope);
      void loop(scope);
    }
  }

  const peers: Peers = {
    attach(server) {
      server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
        if (!handleUpgrade(req, socket, head)) socket.destroy();
      });
    },
    handleUpgrade,
    call,
    async json<T>(scope: string, method: string, path: string, callOpts: PeerCallOptions = {}) {
      const response = await call(scope, method, path, callOpts);
      if (response.status < 200 || response.status >= 300) {
        let body: unknown = null;
        try {
          body = await response.json();
        } catch {
          body = null;
        }
        throw new PeerCallError('provider_status', `The provider answered ${response.status}`, {
          status: response.status,
          body,
        });
      }
      return response.json<T>();
    },
    on(scope, type, handler) {
      if (!isPeerScope(scope) || !isPeerEventType(type)) {
        throw new Error(`Not a scope and event type: "${scope}" "${type}"`);
      }
      db();
      let byType = handlers.get(scope);
      if (!byType) {
        byType = new Map();
        handlers.set(scope, byType);
      }
      byType.set(type, handler);
      if (session) startLoops();
    },
    connected() {
      return session !== null && !session.closed && !session.destroyed;
    },
    readiness() {
      return { consumer: true, inbox: handlers.size > 0 };
    },
    async close() {
      closed = true;
      const waiting = waiters;
      waiters = [];
      for (const fn of waiting) fn(null);
      const s = session;
      session = null;
      if (s && !s.closed) {
        await new Promise<void>((resolve) => {
          s.close(() => resolve());
          setTimeout(() => {
            s.destroy();
            resolve();
          }, 1_000).unref();
        });
      }
    },
  };
  return peers;
}

/** The `peer` caller of a verified request, without its user — for logs. */
export type PeerCaller = PeerCallerIdentity;

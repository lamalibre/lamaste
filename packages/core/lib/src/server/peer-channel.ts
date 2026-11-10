/**
 * The peer channel, relay side — how a consumer's agent half, which can
 * reach nothing, gets a way to call other plugins.
 *
 * The relay dials the consumer as it dials it for anything else: the
 * relay-loopback end of the plugin's internal tunnel. It asks
 *
 *     GET /admin/peers/attach
 *     Connection: Upgrade
 *     Upgrade: lamaste-peers/1
 *     X-Lamalibre-Caller: <assertion, caller lamaste, signed with the installation secret>
 *
 * and the half answers `101 Switching Protocols` with
 * `X-Lamalibre-Responder` over the request's nonce, the status and an empty
 * body — so whatever squats the port without the secret gets no channel.
 * The connection then carries **HTTP/2 with the roles reversed**: the half
 * is the HTTP/2 client, the relay the server. Every stream the half opens is
 * a call (or an events pull) of that consumer: the channel is its only
 * credential, bound when the relay adopted the socket
 * ({@link PeerChannelServer.adopt}). Nothing listens anywhere for it — no
 * port, no chisel grant, no public location.
 *
 * Bounds: `PEER_CHANNEL_MAX_STREAMS` concurrent streams, a header list of
 * `PEER_CHANNEL_MAX_HEADER_LIST_BYTES`, the session's memory capped, a PING
 * every `PEER_CHANNEL_PING_INTERVAL_MS` and the channel closed after
 * `PEER_CHANNEL_PING_TIMEOUT_MS` without its answer (a tunnel that died
 * without a FIN).
 *
 * The manager ({@link createPeerChannelManager}) keeps one channel per
 * consumer the panel wants attached ({@link PeerChannelManager.ensure}):
 * it reattaches on close with backoff (`PEER_REATTACH_MIN_MS` →
 * `PEER_REATTACH_MAX_MS`) while the panel's resolver still answers a
 * target, and *replaces* a channel ({@link PeerChannelManager.replace} — a
 * rotated secret) by attaching anew and only then sending `GOAWAY` on the
 * old one, so calls in flight finish there and new ones go to the new one.
 */

import http from 'node:http';
import http2 from 'node:http2';
import type {
  Http2ServerRequest,
  Http2ServerResponse,
  Http2Session,
  ServerHttp2Session,
} from 'node:http2';
import type { Socket } from 'node:net';
import type { Duplex } from 'node:stream';

import {
  CALLER_ASSERTION_HEADER,
  RESPONDER_HEADER,
  generateCallerAssertionNonce,
  signCallerAssertion,
  verifyResponder,
} from '../caller-assertion.js';
import {
  AGENT_HALF_PEERS_ATTACH_PATH,
  PEER_CHANNEL_MAX_HEADER_LIST_BYTES,
  PEER_CHANNEL_MAX_STREAMS,
  PEER_CHANNEL_PING_INTERVAL_MS,
  PEER_CHANNEL_PING_TIMEOUT_MS,
  PEER_CHANNEL_UPGRADE,
  PEER_REATTACH_MAX_MS,
  PEER_REATTACH_MIN_MS,
} from '../peers.js';
import type { AgentForwarderLogger } from './forward-core.js';

/** How much memory (MB) one channel's HTTP/2 session may hold before it refuses new streams. */
export const PEER_CHANNEL_MAX_SESSION_MEMORY_MB = 32;

/** How long an attach may take, connect to `101`. */
export const PEER_ATTACH_TIMEOUT_MS = 10_000;

/** Where and as whom the relay attaches to one consumer. */
export interface PeerChannelTarget {
  /** The consumer's route. */
  readonly consumer: string;
  /** The relay-loopback port of its internal tunnel. */
  readonly port: number;
  /** The installation secret to sign the attach with (`signingSecretFor`). */
  readonly secret: string;
}

export type PeerAttachFailure =
  | 'refused'
  | 'timeout'
  | 'not_upgraded'
  | 'unauthenticated'
  | 'other';

export type PeerAttachResult =
  | { readonly ok: true; readonly socket: Duplex; readonly head: Buffer }
  | { readonly ok: false; readonly code: PeerAttachFailure; readonly error: string };

/**
 * Ask the consumer's half for its channel; resolves with the upgraded socket
 * once the `101` authenticated itself, or why not. Never throws for an
 * answer; throws for a malformed secret (a mistake in Lamaste).
 */
export function attachPeerChannel(
  target: PeerChannelTarget,
  opts: { readonly host?: string | undefined; readonly timeoutMs?: number | undefined } = {},
): Promise<PeerAttachResult> {
  const nonce = generateCallerAssertionNonce();
  const assertion = signCallerAssertion(
    {
      plugin: target.consumer,
      caller: { type: 'lamaste' },
      method: 'GET',
      path: AGENT_HALF_PEERS_ATTACH_PATH,
      nonce,
    },
    target.secret,
  );
  const timeoutMs = opts.timeoutMs ?? PEER_ATTACH_TIMEOUT_MS;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: PeerAttachResult): void => {
      if (settled) {
        if (result.ok) result.socket.destroy();
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const req = http.request({
      host: opts.host ?? '127.0.0.1',
      port: target.port,
      method: 'GET',
      path: AGENT_HALF_PEERS_ATTACH_PATH,
      headers: {
        connection: 'Upgrade',
        upgrade: PEER_CHANNEL_UPGRADE,
        [CALLER_ASSERTION_HEADER]: assertion,
      },
    });
    const timer = setTimeout(() => {
      req.destroy();
      finish({ ok: false, code: 'timeout', error: `No 101 within ${timeoutMs} ms` });
    }, timeoutMs);
    req.on('upgrade', (res, socket, head) => {
      const authentic = verifyResponder(res.headers[RESPONDER_HEADER], {
        secret: target.secret,
        nonce,
        status: res.statusCode ?? 0,
        body: '',
      });
      if (!authentic || res.statusCode !== 101) {
        socket.destroy();
        finish({
          ok: false,
          code: 'unauthenticated',
          error: 'The agent half did not authenticate its 101',
        });
        return;
      }
      finish({ ok: true, socket, head });
    });
    req.on('response', (res) => {
      res.resume();
      finish({
        ok: false,
        code: 'not_upgraded',
        error: `The agent half answered ${res.statusCode ?? 0} instead of 101`,
      });
    });
    req.on('error', (err: NodeJS.ErrnoException) =>
      finish({
        ok: false,
        code: err.code === 'ECONNREFUSED' ? 'refused' : 'other',
        error: err.code === 'ECONNREFUSED' ? 'Nothing answers on the port' : err.message,
      }),
    );
    req.end();
  });
}

/** One adopted channel. */
export interface PeerChannel {
  readonly consumer: string;
  readonly session: ServerHttp2Session;
  /** Resolves once the session is gone. */
  readonly closed: Promise<void>;
  /** No new streams; those in flight finish. */
  drain(): void;
  /** Gone now, streams and all. */
  destroy(): void;
}

export interface PeerChannelServer {
  /** Speak HTTP/2 (as the server) on an attached socket; every stream on it is `consumer`'s. */
  adopt(socket: Duplex, head: Buffer, consumer: string): PeerChannel;
  close(): void;
}

/**
 * The relay's HTTP/2 server for peer channels — it never listens; sockets
 * are handed to it ({@link PeerChannelServer.adopt}), each bound to the
 * consumer that was attached. `handle` answers every stream.
 */
export function createPeerChannelServer(opts: {
  readonly handle: (
    req: Http2ServerRequest,
    res: Http2ServerResponse,
    consumer: string,
  ) => Promise<void>;
  readonly logger?: AgentForwarderLogger | undefined;
}): PeerChannelServer {
  const server = http2.createServer({
    maxSessionMemory: PEER_CHANNEL_MAX_SESSION_MEMORY_MB,
    settings: {
      maxConcurrentStreams: PEER_CHANNEL_MAX_STREAMS,
      maxHeaderListSize: PEER_CHANNEL_MAX_HEADER_LIST_BYTES,
      enablePush: false,
    },
  });
  const bindings = new WeakMap<Http2Session, string>();
  let adopting: string | null = null;
  // The server emits 'session' synchronously while it takes a connection,
  // so the binding being adopted is the one of this session.
  server.on('session', (session) => {
    if (adopting !== null) bindings.set(session, adopting);
  });
  server.on('request', (req, res) => {
    const consumer = bindings.get(req.stream.session as Http2Session);
    if (consumer === undefined) {
      res.stream.close(http2.constants.NGHTTP2_REFUSED_STREAM);
      return;
    }
    void opts.handle(req, res, consumer);
  });
  server.on('sessionError', (err) => {
    opts.logger?.warn({ error: err.name }, 'A peer channel session failed');
  });

  return {
    adopt(socket, head, consumer) {
      if (head.length > 0) socket.unshift(head);
      let session: ServerHttp2Session | null = null;
      const onSession = (s: ServerHttp2Session): void => {
        session = s;
      };
      server.once('session', onSession);
      adopting = consumer;
      try {
        server.emit('connection', socket as Socket);
      } finally {
        adopting = null;
        server.off('session', onSession);
      }
      if (!session) {
        socket.destroy();
        throw new Error('The HTTP/2 server did not take the peer channel');
      }
      const s: ServerHttp2Session = session;
      const closed = new Promise<void>((resolve) => {
        if (s.closed || s.destroyed) resolve();
        else s.once('close', () => resolve());
      });
      s.on('error', () => {
        // 'close' follows; the manager reattaches.
      });
      // Keepalive: a tunnel can die without a FIN. A PING unanswered for
      // PEER_CHANNEL_PING_TIMEOUT_MS ends the channel.
      const pinger = setInterval(() => {
        if (s.closed || s.destroyed) return;
        const deadline = setTimeout(() => s.destroy(), PEER_CHANNEL_PING_TIMEOUT_MS);
        deadline.unref();
        const sent = s.ping((err) => {
          clearTimeout(deadline);
          if (err) s.destroy();
        });
        if (!sent) {
          clearTimeout(deadline);
        }
      }, PEER_CHANNEL_PING_INTERVAL_MS);
      pinger.unref();
      void closed.then(() => clearInterval(pinger));
      return {
        consumer,
        session: s,
        closed,
        drain() {
          if (!s.closed && !s.destroyed) s.close();
        },
        destroy() {
          if (!s.destroyed) s.destroy();
        },
      };
    },
    close() {
      server.close();
    },
  };
}

/** What the manager reports of one consumer's channel. */
export interface PeerChannelStatus {
  readonly state: 'attached' | 'attaching' | 'backoff' | 'detached';
  /** When it entered that state (ms since the epoch). */
  readonly since: number;
  /** The last attach failure, when the channel is not attached. */
  readonly lastError: string | null;
}

export interface PeerChannelManager {
  /** Keep a channel to `consumer` (idempotent); attaches now if there is none. */
  ensure(consumer: string): void;
  /** Attach anew (a rotated secret), then let the old channel drain. */
  replace(consumer: string): void;
  /** Close the channel and stop keeping one. */
  drop(consumer: string): void;
  status(consumer: string): PeerChannelStatus;
  /** Every consumer kept. */
  consumers(): string[];
  close(): void;
}

export interface PeerChannelManagerOptions {
  /**
   * The target to attach `consumer` with now, or null when it should have no
   * channel (not installed or approved, consuming nothing, hosting not
   * active, down, not peer-ready): the manager then stops keeping one.
   */
  resolve(consumer: string): Promise<PeerChannelTarget | null>;
  /** The server adopted channels are handed to. */
  readonly server: PeerChannelServer;
  readonly logger?: AgentForwarderLogger | undefined;
  readonly host?: string | undefined;
  readonly attachTimeoutMs?: number | undefined;
  readonly minBackoffMs?: number | undefined;
  readonly maxBackoffMs?: number | undefined;
  /** Called after every change of a consumer's state. */
  onChange?: ((consumer: string, status: PeerChannelStatus) => void) | undefined;
}

interface Kept {
  wanted: boolean;
  channel: PeerChannel | null;
  attaching: boolean;
  backoffMs: number;
  timer: NodeJS.Timeout | null;
  status: PeerChannelStatus;
  /** Set by replace(): attach again even though a channel is up. */
  replacing: boolean;
}

export function createPeerChannelManager(opts: PeerChannelManagerOptions): PeerChannelManager {
  const minBackoff = opts.minBackoffMs ?? PEER_REATTACH_MIN_MS;
  const maxBackoff = opts.maxBackoffMs ?? PEER_REATTACH_MAX_MS;
  const kept = new Map<string, Kept>();
  let closed = false;

  function setStatus(
    consumer: string,
    k: Kept,
    state: PeerChannelStatus['state'],
    error: string | null,
  ): void {
    k.status = { state, since: Date.now(), lastError: error };
    opts.onChange?.(consumer, k.status);
  }

  function schedule(consumer: string, k: Kept, error: string | null): void {
    if (!k.wanted || closed) return;
    if (k.timer) clearTimeout(k.timer);
    setStatus(consumer, k, 'backoff', error);
    const delay = k.backoffMs;
    k.backoffMs = Math.min(k.backoffMs * 2, maxBackoff);
    k.timer = setTimeout(() => {
      k.timer = null;
      void attach(consumer);
    }, delay);
    k.timer.unref();
  }

  async function attach(consumer: string): Promise<void> {
    const k = kept.get(consumer);
    if (!k || !k.wanted || k.attaching || closed) return;
    if (k.channel && !k.replacing) return;
    k.attaching = true;
    setStatus(consumer, k, 'attaching', k.status.lastError);
    let target: PeerChannelTarget | null = null;
    try {
      target = await opts.resolve(consumer);
    } catch (err: unknown) {
      k.attaching = false;
      schedule(consumer, k, err instanceof Error ? err.message : String(err));
      return;
    }
    if (!target || !k.wanted || closed) {
      k.attaching = false;
      k.replacing = false;
      if (!target) {
        k.wanted = false;
        k.channel?.drain();
        if (!k.channel) setStatus(consumer, k, 'detached', null);
      }
      return;
    }
    const result = await attachPeerChannel(target, {
      host: opts.host,
      timeoutMs: opts.attachTimeoutMs,
    });
    k.attaching = false;
    if (!result.ok) {
      k.replacing = false;
      opts.logger?.warn({ consumer, code: result.code }, 'Attaching a peer channel failed');
      if (!k.channel) schedule(consumer, k, result.error);
      return;
    }
    if (!k.wanted || closed) {
      result.socket.destroy();
      return;
    }
    let channel: PeerChannel;
    try {
      channel = opts.server.adopt(result.socket, result.head, consumer);
    } catch (err: unknown) {
      schedule(consumer, k, err instanceof Error ? err.message : String(err));
      return;
    }
    const previous = k.channel;
    k.channel = channel;
    k.replacing = false;
    k.backoffMs = minBackoff;
    setStatus(consumer, k, 'attached', null);
    opts.logger?.info({ consumer, replaced: previous !== null }, 'Peer channel attached');
    // The old one finishes what it carries; new calls take the new one.
    previous?.drain();
    void channel.closed.then(() => {
      if (k.channel !== channel) return;
      k.channel = null;
      if (k.wanted && !closed) schedule(consumer, k, 'The channel closed');
      else setStatus(consumer, k, 'detached', null);
    });
  }

  return {
    ensure(consumer) {
      let k = kept.get(consumer);
      if (!k) {
        k = {
          wanted: true,
          channel: null,
          attaching: false,
          backoffMs: minBackoff,
          timer: null,
          status: { state: 'detached', since: Date.now(), lastError: null },
          replacing: false,
        };
        kept.set(consumer, k);
      }
      k.wanted = true;
      if (!k.channel && !k.attaching && !k.timer) void attach(consumer);
    },
    replace(consumer) {
      const k = kept.get(consumer);
      if (!k || !k.wanted) return;
      if (!k.channel) {
        if (!k.attaching) void attach(consumer);
        return;
      }
      k.replacing = true;
      if (k.timer) {
        clearTimeout(k.timer);
        k.timer = null;
      }
      void attach(consumer);
    },
    drop(consumer) {
      const k = kept.get(consumer);
      if (!k) return;
      k.wanted = false;
      if (k.timer) clearTimeout(k.timer);
      k.timer = null;
      k.channel?.drain();
      kept.delete(consumer);
    },
    status(consumer) {
      return kept.get(consumer)?.status ?? { state: 'detached', since: 0, lastError: null };
    },
    consumers() {
      return [...kept.keys()];
    },
    close() {
      closed = true;
      for (const k of kept.values()) {
        if (k.timer) clearTimeout(k.timer);
        k.channel?.destroy();
      }
      kept.clear();
      opts.server.close();
    },
  };
}

/**
 * The provider's side of peers (design: slice 8): its **peer surface**
 * (`/peer/*`), which only the relay's `peer` caller reaches, and Lamaste's
 * routes under `/admin/peers` (readiness, the events pull).
 *
 * ```ts
 * await fastify.register(peerSurface({ verifier, outbox, peers }));
 * fastify.get('/peer/people/:userId/manager', peerRoute(async (request, caller) => {
 *   // caller: { peer, scope, major, endpoint, hops, user?: { userId, username, roles } }
 * }));
 * ```
 *
 * - **The endpoint binds the handler.** The relay matched the call against
 *   the provider's declared endpoints and names the pattern in the
 *   assertion (`GET /people/:userId/manager`); {@link peerRoute} refuses
 *   (403) a request whose own route — its method and the pattern it was
 *   registered with — is not that one (`peerEndpointAdmitsRoute`). So an
 *   allowlisted `/units/:unitId` never runs the provider's `/units/export`,
 *   which the same path matches as a parameter.
 * - **Fails closed.** {@link peerSurface} adds an `onRequest` hook for
 *   everything under `/peer`: a request that reaches a route `peerRoute`
 *   does not wrap (or none) is answered 404 before any handler runs.
 *   Register `peerSurface` before the `/peer` routes.
 * - **Every answer is signed** (`X-Lamalibre-Responder`, the `-` form — the
 *   relay streams it): `peerRoute` gives its route an `onSend` hook, so a
 *   handler's own error answers carry it too. Only an answer to a request
 *   that did not verify goes unsigned (401), which the relay passes on to
 *   nobody.
 *
 * Fastify is used for its types only: nothing of it is imported at run time,
 * so an agent half bundles this with its own Fastify.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { RESPONDER_HEADER } from '../caller-assertion.js';
import type { PeerCallerIdentity, VerifiedCallerAssertion } from '../caller-assertion.js';
import {
  AGENT_HALF_PEERS_EVENTS_PULL_PATH,
  AGENT_HALF_PEERS_PATH,
  PEER_PROTOCOL_VERSION,
  peerEndpointAdmitsRoute,
} from '../peers.js';
import { isUnderAgentHalfPeer } from '../user-surface.js';
import { adminAnswer } from './admin-handlers.js';
import type { AgentHookRequest, AgentHookResponse } from './admin-handlers.js';
import type { CallerAssertionVerifier } from './app-plugins.js';
import { setPeerContext } from './peer-context.js';
import type { Peers } from './peer-client.js';
import { createPeerOutboxHandler } from './peer-outbox.js';
import type { PeerOutbox } from './peer-outbox.js';

export interface PeerSurfaceOptions {
  /** The half's verifier (`createCallerAssertionVerifier`). */
  readonly verifier: CallerAssertionVerifier;
  /** The provider's outbox, when it publishes events. */
  readonly outbox?: PeerOutbox | null | undefined;
  /** The consumer side, when the plugin also consumes (`createPeers`). */
  readonly peers?: Peers | null | undefined;
}

/** A peer route's handler: the request, its verified `peer` caller, the reply. */
export type PeerRouteHandler = (
  request: FastifyRequest,
  caller: PeerCallerIdentity,
  reply: FastifyReply,
) => unknown;

/** What {@link peerRoute} returns: route options for `fastify.get(path, …)` and the like. */
export interface PeerRouteOptions {
  readonly config: Readonly<Record<string, unknown>>;
  handler(this: unknown, request: FastifyRequest, reply: FastifyReply): Promise<unknown>;
  onSend(
    this: unknown,
    request: FastifyRequest,
    reply: FastifyReply,
    payload: unknown,
  ): Promise<unknown>;
}

const surfaces = new WeakMap<object, PeerSurfaceOptions>();
/**
 * How a route says {@link peerRoute} made it: its config holds this
 * module's own object under this key — an identity nothing else has.
 */
const PEER_ROUTE_CONFIG_KEY = 'lamastePeerRoute';
const PEER_ROUTE_MARK: object = Object.freeze({});
const verifiedRequests = new WeakMap<object, VerifiedCallerAssertion>();

/** What Fastify's `printRoutes()` answers for an instance with no route. */
const EMPTY_ROUTE_TREE = '(empty tree)';

const TREE_LINE_RE = /^((?:│ {3}| {4})*)(?:├── |└── )(.*)$/u;
const TREE_METHODS_RE = / \(([A-Z]+(?:, [A-Z]+)*)\)$/;

/**
 * The full paths of the routes in Fastify's `printRoutes()` tree (each line
 * a node: its depth in the indentation, its part of the path, and the
 * methods of a route ending there), or null for a line it cannot read —
 * the caller then refuses rather than guess. Exported for tests.
 */
export function routedPaths(tree: string): string[] | null {
  if (tree.trim() === EMPTY_ROUTE_TREE) return [];
  const stack: string[] = [];
  const out: string[] = [];
  for (const line of tree.split('\n')) {
    if (line.trim() === '') continue;
    const match = TREE_LINE_RE.exec(line);
    if (!match) return null;
    const depth = (match[1] ?? '').length / 4;
    if (depth > stack.length) return null;
    let text = match[2] ?? '';
    const methods = TREE_METHODS_RE.exec(text);
    if (methods) text = text.slice(0, methods.index);
    stack.length = depth;
    const fullPath = (depth > 0 ? (stack[depth - 1] ?? '') : '') + text;
    stack.push(fullPath);
    if (methods) out.push(fullPath);
  }
  return out;
}

/**
 * Answer Lamaste's `/admin/peers` calls — `GET /admin/peers` (readiness:
 * `{ protocol, consumer, outbox, inbox }`) and the events pull —
 * framework-agnostic: pass the request, send `status`, `headers` and
 * `bodyText` exactly. Caller `lamaste` only; answers signed over the body.
 */
export function createPeerAdminHandler(opts: PeerSurfaceOptions): {
  handle(request: AgentHookRequest): Promise<AgentHookResponse>;
} {
  const pull = opts.outbox
    ? createPeerOutboxHandler({ verifier: opts.verifier, outbox: opts.outbox })
    : null;
  return {
    async handle(request) {
      const pathOnly = request.url.split('?')[0] ?? '';
      if (pathOnly === AGENT_HALF_PEERS_EVENTS_PULL_PATH) {
        return pull ? pull.handle(request) : adminAnswer(404, { error: 'Not found' });
      }
      if (pathOnly !== AGENT_HALF_PEERS_PATH) return adminAnswer(404, { error: 'Not found' });
      const method = request.method.toUpperCase();
      if (method !== 'GET') return adminAnswer(405, { error: 'Readiness is read with GET' });
      const verified = await opts.verifier.verify(request.headers, method, request.url, {
        body: null,
      });
      if (!verified.ok) return adminAnswer(401, { error: verified.reason });
      if (verified.payload.caller.type !== 'lamaste') {
        return adminAnswer(403, { error: 'Only Lamaste asks' }, verified);
      }
      let outbox: Record<string, unknown> | null = null;
      if (opts.outbox) {
        try {
          outbox = { ...opts.outbox.state() };
        } catch {
          return adminAnswer(500, { error: 'The outbox failed' }, verified);
        }
      }
      return adminAnswer(
        200,
        {
          protocol: PEER_PROTOCOL_VERSION,
          consumer: opts.peers ? true : false,
          outbox,
          inbox: opts.peers?.readiness().inbox ?? false,
        },
        verified,
      );
    },
  };
}

/**
 * Register the peer surface on a Fastify instance — not encapsulated, so its
 * guard covers every `/peer` route of the instance: `fastify.register(peerSurface(opts))`.
 *
 * **Register it before any `/peer` route.** Fastify gives a hook only to
 * the contexts created after it, so a `/peer` route registered earlier would
 * be out of the guard's reach: registering it after one fails (and when the
 * instance's routes cannot be read, it fails too). Every `/peer` route
 * registered after it must be a {@link peerRoute} — another fails its
 * registration, and so the instance's start: an unchecked route on the peer
 * surface would answer anything that reaches the agent half's loopback
 * port.
 */
export function peerSurface(opts: PeerSurfaceOptions): (fastify: FastifyInstance) => Promise<void> {
  const admin = createPeerAdminHandler(opts);
  const plugin = async (fastify: FastifyInstance): Promise<void> => {
    const existing = routedPaths(fastify.printRoutes());
    if (existing === null) {
      throw new Error("peerSurface could not read the instance's routes; register it first");
    }
    const early = existing.filter((routePath) => isUnderAgentHalfPeer(routePath));
    if (early.length > 0) {
      throw new Error(
        `peerSurface must be registered before any /peer route (${early.join(', ')} is out of its guard)`,
      );
    }
    surfaces.set(fastify.server, opts);

    fastify.addHook('onRoute', (route) => {
      if (!isUnderAgentHalfPeer(route.url ?? '')) return;
      const config = route.config as Record<string, unknown> | undefined;
      if (config?.[PEER_ROUTE_CONFIG_KEY] !== PEER_ROUTE_MARK) {
        throw new Error(
          `${String(route.method)} ${route.url ?? ''}: a route on the peer surface must be made with peerRoute()`,
        );
      }
    });

    fastify.addHook('onRequest', async (request, reply) => {
      if (!isUnderAgentHalfPeer(request.url)) return;
      const config = request.routeOptions.config as unknown as Record<string, unknown> | undefined;
      if (config?.[PEER_ROUTE_CONFIG_KEY] !== PEER_ROUTE_MARK) {
        await reply.code(404).send({ error: 'Not found' });
      }
    });

    // Lamaste's routes take their bodies as received: the body hash is signed.
    await fastify.register(async (child: FastifyInstance) => {
      child.removeAllContentTypeParsers();
      child.addContentTypeParser('*', { parseAs: 'buffer' }, (_request, body, done) => {
        done(null, body);
      });
      const route = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
        const answer = await admin.handle({
          method: request.method,
          url: request.url,
          headers: request.headers,
          body: request.body,
        });
        await reply.code(answer.status).headers(answer.headers).send(answer.bodyText);
      };
      child.get(AGENT_HALF_PEERS_PATH, route);
      child.post(AGENT_HALF_PEERS_EVENTS_PULL_PATH, route);
    });
  };
  // Fastify's own marker (what fastify-plugin sets): register without a new
  // encapsulation context, so the guard reaches the instance's routes.
  Object.defineProperty(plugin, Symbol.for('skip-override'), { value: true });
  return plugin;
}

/**
 * A `/peer` route: verify the `peer` caller, check that this route is the
 * endpoint the relay matched, remember the call for onward calls, and sign
 * every answer. Use as the route's options:
 * `fastify.post('/peer/people/lookup', peerRoute(handler))`.
 */
export function peerRoute(handler: PeerRouteHandler): PeerRouteOptions {
  const options: PeerRouteOptions = {
    config: { [PEER_ROUTE_CONFIG_KEY]: PEER_ROUTE_MARK },
    async handler(request, reply) {
      const surface = surfaces.get(request.server.server);
      if (!surface) {
        await reply.code(500).send({ error: 'peerSurface is not registered on this instance' });
        return reply;
      }
      const verified = await surface.verifier.verify(request.headers, request.method, request.url, {
        body: null,
      });
      if (!verified.ok) {
        await reply.code(401).send({ error: verified.reason });
        return reply;
      }
      verifiedRequests.set(request, verified);
      const caller = verified.payload.caller;
      if (caller.type !== 'peer') {
        await reply.code(403).send({ error: 'Only a peer caller reaches the peer surface' });
        return reply;
      }
      const registered = request.routeOptions.url ?? '';
      if (!peerEndpointAdmitsRoute(caller.endpoint, request.method, registered)) {
        await reply
          .code(403)
          .send({ error: 'This route is not the endpoint the relay matched the call to' });
        return reply;
      }
      setPeerContext(request, { caller, hops: caller.hops });
      return handler(request, caller, reply);
    },
    async onSend(request, reply, payload) {
      const verified = verifiedRequests.get(request);
      if (verified) void reply.header(RESPONDER_HEADER, verified.responder(reply.statusCode));
      return payload;
    },
  };
  return options;
}

/**
 * Calls and events between app plugins (slice 8): the shelves applied to
 * this relay and what they make effective. Admin certificate only — never a
 * plugin capability: Shelf applies a shelf from the administrator's
 * browser, never from its server code. Business logic lives in
 * `lib/peers.js` (grants, effective edges) and `lib/peer-runtime.js`
 * (readiness, channels).
 *
 *   GET    /peers                     applied shelves with their edges and
 *                                     state, plugins' declarations, effective
 *                                     edges, channels, readiness
 *   PUT    /peers/shelves/:shelfId    { scopes } — apply (replace) a shelf
 *   DELETE /peers/shelves/:shelfId    remove an applied shelf and its edges
 */

import { z } from 'zod';
import { PEER_SCOPE_RE } from '@lamalibre/lamaste';
import { actorFromRequest } from '../../lib/actor.js';
import {
  PEER_SHELF_ID_RE,
  PEER_SHELF_MAX_CONSUMERS,
  PEER_SHELF_MAX_SCOPES,
  applyPeerShelf,
  peersView,
  removePeerShelf,
} from '../../lib/peers.js';
import { peerChannelStatuses, peerReadinessView } from '../../lib/peer-runtime.js';

const RouteSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/, 'a plugin route');

const ShelfParamSchema = z.object({
  shelfId: z.string().regex(PEER_SHELF_ID_RE, 'A shelf id is a DNS label of 1–32 characters'),
});

/** The shelf manifest's own `scopes` block. */
const ApplyBodySchema = z
  .object({
    scopes: z
      .record(
        z.string().regex(PEER_SCOPE_RE, 'a scope is "<route>:<name>"'),
        z
          .object({
            provider: RouteSchema,
            consumers: z.array(RouteSchema).max(PEER_SHELF_MAX_CONSUMERS),
          })
          .strict(),
      )
      .refine((scopes) => Object.keys(scopes).length <= PEER_SHELF_MAX_SCOPES, {
        message: `A shelf grants at most ${PEER_SHELF_MAX_SCOPES} scopes`,
      }),
  })
  .strict();

/**
 * A refusal the library threw — its message, `code` and what the client
 * acts on (`cycle`, `scope`, `plugin`, `consumer`) — or a 500.
 */
function sendFailure(request, reply, err, fallback) {
  if (Number.isInteger(err.statusCode)) {
    if (err.statusCode >= 500) request.log.error(err, err.message);
    return reply.code(err.statusCode).send({
      error: err.message,
      ...(err.code ? { code: err.code } : {}),
      ...(Array.isArray(err.cycle) ? { cycle: err.cycle } : {}),
      ...(typeof err.scope === 'string' ? { scope: err.scope } : {}),
      ...(typeof err.plugin === 'string' ? { plugin: err.plugin } : {}),
      ...(typeof err.consumer === 'string' ? { consumer: err.consumer } : {}),
    });
  }
  request.log.error(err, fallback);
  return reply.code(500).send({ error: fallback });
}

export default async function peersRoutes(fastify) {
  const adminOnly = { preHandler: fastify.requireRole(['admin']) };

  fastify.get('/peers', adminOnly, async (request, reply) => {
    try {
      return {
        ...(await peersView()),
        channels: peerChannelStatuses(),
        readiness: peerReadinessView(),
      };
    } catch (err) {
      return sendFailure(request, reply, err, 'Failed to read the peers state');
    }
  });

  fastify.put('/peers/shelves/:shelfId', adminOnly, async (request, reply) => {
    const { shelfId } = ShelfParamSchema.parse(request.params);
    const parsed = ApplyBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'Invalid shelf scopes',
        details: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    try {
      const shelf = await applyPeerShelf(shelfId, parsed.data.scopes, {
        actor: actorFromRequest(request),
        logger: request.log,
      });
      return { ok: true, shelf };
    } catch (err) {
      return sendFailure(request, reply, err, 'Failed to apply the shelf');
    }
  });

  fastify.delete('/peers/shelves/:shelfId', adminOnly, async (request, reply) => {
    const { shelfId } = ShelfParamSchema.parse(request.params);
    try {
      const removed = await removePeerShelf(shelfId, {
        actor: actorFromRequest(request),
        logger: request.log,
      });
      return { ok: true, ...removed };
    } catch (err) {
      return sendFailure(request, reply, err, 'Failed to remove the shelf');
    }
  });
}

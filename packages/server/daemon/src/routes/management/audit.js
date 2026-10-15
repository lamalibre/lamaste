import { z } from 'zod';
import { listAudit } from '../../lib/audit.js';
import { listNotifications, markNotificationsRead } from '../../lib/notifications.js';

const AuditQuerySchema = z.object({
  plugin: z
    .string()
    .regex(/^[a-z0-9-]{1,100}$/)
    .optional(),
  action: z
    .string()
    .regex(/^[a-z][a-z0-9.-]{0,99}$/)
    .optional(),
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

const NotificationsQuerySchema = z.object({
  unread: z.enum(['true', 'false']).optional(),
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

const MarkReadBodySchema = z.union([
  z.object({ all: z.literal(true) }).strict(),
  z.object({ ids: z.array(z.number().int().positive()).min(1).max(200) }).strict(),
]);

export default async function auditRoutes(fastify, _opts) {
  // ------------------------------------------------------------------
  // GET /audit — the audit log, newest first (?plugin, ?action — exact or
  // a prefix ending in ".", ?before=<id>, ?limit)
  // ------------------------------------------------------------------
  fastify.get(
    '/audit',
    {
      preHandler: fastify.requireRole(['admin']),
    },
    async (request) => {
      const query = AuditQuerySchema.parse(request.query);
      const entries = await listAudit(query);
      return { entries };
    },
  );

  // ------------------------------------------------------------------
  // GET /notifications — panel notifications, newest first, and the
  // unread count
  // ------------------------------------------------------------------
  fastify.get(
    '/notifications',
    {
      preHandler: fastify.requireRole(['admin']),
    },
    async (request) => {
      const query = NotificationsQuerySchema.parse(request.query);
      return listNotifications({
        unreadOnly: query.unread === 'true',
        before: query.before,
        limit: query.limit,
      });
    },
  );

  // ------------------------------------------------------------------
  // POST /notifications/read — { ids: [...] } or { all: true }
  // ------------------------------------------------------------------
  fastify.post(
    '/notifications/read',
    {
      preHandler: fastify.requireRole(['admin']),
    },
    async (request) => {
      const body = MarkReadBodySchema.parse(request.body);
      const changed = await markNotificationsRead(
        'all' in body ? { all: true } : { ids: body.ids },
      );
      return { ok: true, changed };
    },
  );
}

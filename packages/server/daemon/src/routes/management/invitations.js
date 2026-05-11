import crypto from 'node:crypto';
import { z } from 'zod';
import { readInvitations, writeInvitations } from '../../lib/state.js';
import { readUsersRaw } from '../../lib/authelia.js';
import { getConfig } from '../../lib/config.js';

const IdParamSchema = z.object({ id: z.string().uuid() });

const CreateInvitationSchema = z.object({
  username: z
    .string()
    .min(2)
    .max(32)
    .regex(
      /^[a-z0-9_-]+$/,
      'Username must contain only lowercase alphanumeric characters, underscores, and hyphens',
    ),
  email: z.string().email(),
  groups: z.array(z.string()).optional().default([]),
  expiresInDays: z.number().int().min(1).max(30).optional().default(7),
});

export default async function invitationRoutes(fastify, _opts) {
  // GET /api/invitations — list all invitations
  fastify.get(
    '/invitations',
    {
      preHandler: fastify.requireRole(['admin']),
    },
    async (request, reply) => {
      try {
        const invitations = await readInvitations();
        const now = new Date();
        const enriched = invitations.map((inv) => ({
          ...inv,
          token: undefined,
          status: inv.used ? 'accepted' : new Date(inv.expiresAt) < now ? 'expired' : 'pending',
        }));
        return { invitations: enriched };
      } catch (err) {
        request.log.error(err, 'Failed to read invitations');
        return reply.code(500).send({ error: 'Failed to read invitations' });
      }
    },
  );

  // POST /api/invitations — create a new invitation
  fastify.post(
    '/invitations',
    {
      preHandler: fastify.requireRole(['admin']),
    },
    async (request, reply) => {
      const body = CreateInvitationSchema.parse(request.body);

      // Check username doesn't already exist in Authelia
      let usersData;
      try {
        usersData = await readUsersRaw();
      } catch {
        usersData = { users: {} };
      }

      if (usersData.users[body.username]) {
        return reply.code(409).send({ error: 'Username already exists as an Authelia user' });
      }

      // Check username doesn't already have a pending invitation
      let invitations;
      try {
        invitations = await readInvitations();
      } catch (err) {
        request.log.error(err, 'Failed to read invitations');
        return reply.code(500).send({ error: 'Failed to read invitations' });
      }

      const now = new Date();
      const existingPending = invitations.find(
        (inv) => inv.username === body.username && !inv.used && new Date(inv.expiresAt) > now,
      );
      if (existingPending) {
        return reply
          .code(409)
          .send({ error: 'A pending invitation already exists for this username' });
      }

      const config = getConfig();
      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(now.getTime() + body.expiresInDays * 24 * 60 * 60 * 1000);

      const invitation = {
        id: crypto.randomUUID(),
        token,
        username: body.username,
        email: body.email,
        groups: body.groups,
        createdAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
        used: false,
        acceptedAt: null,
      };

      invitations.push(invitation);

      try {
        await writeInvitations(invitations);
      } catch (err) {
        request.log.error(err, 'Failed to write invitations');
        return reply.code(500).send({ error: 'Failed to save invitation' });
      }

      const inviteUrl = config.domain ? `https://auth.${config.domain}/invite/${token}` : null;

      return reply.code(201).send({
        ok: true,
        invitation: {
          id: invitation.id,
          username: invitation.username,
          email: invitation.email,
          groups: invitation.groups,
          createdAt: invitation.createdAt,
          expiresAt: invitation.expiresAt,
        },
        inviteUrl,
        token,
      });
    },
  );

  // DELETE /api/invitations/:id — revoke an invitation
  fastify.delete(
    '/invitations/:id',
    {
      preHandler: fastify.requireRole(['admin']),
    },
    async (request, reply) => {
      const { id } = IdParamSchema.parse(request.params);

      let invitations;
      try {
        invitations = await readInvitations();
      } catch (err) {
        request.log.error(err, 'Failed to read invitations');
        return reply.code(500).send({ error: 'Failed to read invitations' });
      }

      const index = invitations.findIndex((inv) => inv.id === id);
      if (index === -1) {
        return reply.code(404).send({ error: 'Invitation not found' });
      }

      invitations.splice(index, 1);

      try {
        await writeInvitations(invitations);
      } catch (err) {
        request.log.error(err, 'Failed to write invitations');
        return reply.code(500).send({ error: 'Failed to revoke invitation' });
      }

      return { ok: true };
    },
  );
}

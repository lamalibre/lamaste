import crypto from 'node:crypto';
import { z } from 'zod';
import { USERNAME_MAX_LENGTH, USERNAME_MIN_LENGTH, USERNAME_REGEX } from '@lamalibre/lamaste';
import { readInvitations, withInvitationsLock, writeInvitations } from '../../lib/state.js';
import { readUsersRaw } from '../../lib/authelia.js';
import { getConfig } from '../../lib/config.js';
import { domainsForNewUser, newUsersNeedDomains } from '../../lib/domains.js';

const IdParamSchema = z.object({ id: z.string().uuid() });

const CreateInvitationSchema = z.object({
  // Same rule as the users API (core's USERNAME_REGEX). A leading "-" would
  // read as a flag to Authelia's CLI when a TOTP secret is stored for the user.
  username: z
    .string()
    .min(USERNAME_MIN_LENGTH)
    .max(USERNAME_MAX_LENGTH)
    .regex(
      USERNAME_REGEX,
      'Username must start with a lowercase letter or digit and may contain underscores or hyphens',
    ),
  email: z.string().email(),
  groups: z.array(z.string()).optional().default([]),
  expiresInDays: z.number().int().min(1).max(30).optional().default(7),
  // The domains the user becomes a member of on accepting. Required while
  // the relay has two or more; with one, the user becomes its member.
  domains: z.array(z.string().min(1).max(253)).max(50).optional(),
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
      let domains;
      try {
        if (body.domains === undefined && (await newUsersNeedDomains())) {
          return reply.code(400).send({
            error: 'Name the domains the user is invited to: this relay has more than one',
            code: 'domains_required',
          });
        }
        domains = await domainsForNewUser(body.domains);
      } catch (err) {
        if (!err.statusCode) throw err;
        return reply.code(err.statusCode).send({ error: err.message, code: err.code });
      }

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

      // The pending-invitation check and the write hold the invitations
      // lock: nothing else may rewrite the file between them.
      const outcome = await withInvitationsLock(async () => {
        let invitations;
        try {
          invitations = await readInvitations();
        } catch (err) {
          request.log.error(err, 'Failed to read invitations');
          return { status: 500, body: { error: 'Failed to read invitations' } };
        }

        const now = new Date();
        const existingPending = invitations.find(
          (inv) => inv.username === body.username && !inv.used && new Date(inv.expiresAt) > now,
        );
        if (existingPending) {
          return {
            status: 409,
            body: { error: 'A pending invitation already exists for this username' },
          };
        }

        const expiresAt = new Date(now.getTime() + body.expiresInDays * 24 * 60 * 60 * 1000);
        const invitation = {
          id: crypto.randomUUID(),
          token: crypto.randomBytes(32).toString('hex'),
          username: body.username,
          email: body.email,
          groups: body.groups,
          domains,
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
          return { status: 500, body: { error: 'Failed to save invitation' } };
        }
        return { status: 201, invitation };
      });
      if (outcome.status !== 201) return reply.code(outcome.status).send(outcome.body);

      const { invitation } = outcome;
      const { token } = invitation;
      // On the sign-in page of the first domain it names (the invitation
      // page is served on every domain's auth portal).
      const inviteDomain = invitation.domains[0] ?? getConfig().domain;
      const inviteUrl = inviteDomain ? `https://auth.${inviteDomain}/invite/${token}` : null;

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

      const outcome = await withInvitationsLock(async () => {
        let invitations;
        try {
          invitations = await readInvitations();
        } catch (err) {
          request.log.error(err, 'Failed to read invitations');
          return { status: 500, body: { error: 'Failed to read invitations' } };
        }

        const index = invitations.findIndex((inv) => inv.id === id);
        if (index === -1) {
          return { status: 404, body: { error: 'Invitation not found' } };
        }

        invitations.splice(index, 1);

        try {
          await writeInvitations(invitations);
        } catch (err) {
          request.log.error(err, 'Failed to write invitations');
          return { status: 500, body: { error: 'Failed to revoke invitation' } };
        }
        return { status: 200 };
      });
      if (outcome.status !== 200) return reply.code(outcome.status).send(outcome.body);

      return { ok: true };
    },
  );
}

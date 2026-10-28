import { z } from 'zod';
import { USERNAME_MAX_LENGTH, USERNAME_MIN_LENGTH, USERNAME_REGEX } from '@lamalibre/lamaste';
import { readUsersRaw } from '../../lib/authelia.js';
import { listDirectoryUsers } from '../../lib/directory.js';
import {
  createAdminInvitation,
  isFulfilled,
  listInvitations,
  revokeOrDeleteInvitation,
} from '../../lib/invitations.js';
import {
  MembershipInputSchema,
  assertAssignableGroups,
  domainsForNewUser,
  externalMemberGroupsError,
  invitationMemberships,
  invitationSignInDomain,
} from '../../lib/domains.js';
import { sendFailure } from '../../lib/app-error.js';
import { recordAuditBestEffort } from '../../lib/audit.js';
import { actorFromRequest } from '../../lib/actor.js';

// Ids imported from invitations.json are whatever 4.8 wrote (UUIDs in practice).
const IdParamSchema = z.object({ id: z.string().min(1).max(64) });

const ListQuerySchema = z
  .object({
    plugin: z.string().min(1).max(214).optional(),
    inviter: z.string().uuid().optional(),
    kind: z.enum(['admin', 'delegated']).optional(),
  })
  .strict();

/**
 * An invitation as the administrator sees it: never its token; the inviter
 * of a delegated one by id and current username.
 */
function adminView(invitation, usernames) {
  return {
    id: invitation.id,
    kind: invitation.kind,
    username: invitation.username,
    email: invitation.email,
    displayName: invitation.displayName,
    emailDomain: invitation.emailDomain,
    groups: invitation.groups,
    domains: invitationMemberships(invitation),
    plugin: invitation.plugin,
    role: invitation.role,
    inviter: invitation.inviterUserId
      ? {
          userId: invitation.inviterUserId,
          username: usernames.get(invitation.inviterUserId) ?? null,
        }
      : null,
    createdAt: invitation.createdAt,
    expiresAt: invitation.expiresAt,
    status: invitation.shownStatus,
    revokedReason: invitation.revokedReason,
    acceptedAt: invitation.acceptedAt,
    acceptedUserId: invitation.acceptedUserId,
    fulfilled: isFulfilled(invitation),
    // 4.8's field, kept for its clients
    used: invitation.status === 'accepted',
  };
}

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
  // Authelia groups (`admins`, `feria-*`): letters, digits, "-" and "_" —
  // never for an external member.
  groups: z.array(z.string()).max(100).optional().default([]),
  expiresInDays: z.number().int().min(1).max(30).optional().default(7),
  // The domains the user becomes a member of on accepting — a name (a
  // member) or `{ name, kind }` (an external member reaches only what names
  // them). Required while the relay has two or more; with one, the user
  // becomes its member.
  domains: z.array(MembershipInputSchema).max(50).optional(),
});

export default async function invitationRoutes(fastify, _opts) {
  // GET /api/invitations — every invitation, both kinds, optionally of one
  // plugin, one inviter or one kind; tokens are never stored, so never shown
  fastify.get(
    '/invitations',
    {
      preHandler: fastify.requireRole(['admin']),
    },
    async (request, reply) => {
      const filter = ListQuerySchema.parse(request.query ?? {});
      try {
        const [invitations, users] = await Promise.all([
          listInvitations({
            ...(filter.plugin ? { plugin: filter.plugin } : {}),
            ...(filter.inviter ? { inviterUserId: filter.inviter } : {}),
            ...(filter.kind ? { kind: filter.kind } : {}),
          }),
          listDirectoryUsers(),
        ]);
        const usernames = new Map(users.map((u) => [u.userId, u.username]));
        return { invitations: invitations.map((inv) => adminView(inv, usernames)) };
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
        assertAssignableGroups(body.groups);
        domains = await domainsForNewUser(body.domains, { required: true });
        if (body.groups.length > 0 && domains.some((m) => m.kind === 'external')) {
          throw externalMemberGroupsError(400);
        }
      } catch (err) {
        return sendFailure(request, reply, err, 'Failed to read the domains');
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

      let created;
      try {
        created = await createAdminInvitation({
          username: body.username,
          email: body.email,
          groups: body.groups,
          domains,
          expiresInDays: body.expiresInDays,
        });
      } catch (err) {
        return sendFailure(request, reply, err, 'Failed to save invitation');
      }
      const { invitation, token } = created;
      await recordAuditBestEffort(
        {
          actor: actorFromRequest(request),
          action: 'invitation.created',
          details: {
            invitationId: invitation.id,
            kind: 'admin',
            emailDomain: invitation.emailDomain,
            expiresAt: invitation.expiresAt,
          },
        },
        request.log,
      );
      // On the sign-in page of the first domain it names (the invitation
      // page is served on every domain's auth portal).
      const inviteDomain = await invitationSignInDomain(invitation);
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

  // DELETE /api/invitations/:id — revoke a pending invitation; delete one
  // that ended (accepted, revoked, expired)
  fastify.delete(
    '/invitations/:id',
    {
      preHandler: fastify.requireRole(['admin']),
    },
    async (request, reply) => {
      const { id } = IdParamSchema.parse(request.params);
      let outcome;
      try {
        outcome = await revokeOrDeleteInvitation(id);
      } catch (err) {
        return sendFailure(request, reply, err, 'Failed to revoke invitation');
      }
      if (outcome.action === 'revoked') {
        await recordAuditBestEffort(
          {
            actor: actorFromRequest(request),
            action: 'invitation.revoked',
            plugin: outcome.invitation.plugin,
            details: { invitationId: id, kind: outcome.invitation.kind, reason: 'admin' },
          },
          request.log,
        );
      }
      return { ok: true, action: outcome.action };
    },
  );
}

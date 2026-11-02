import { z } from 'zod';
import { USERNAME_MAX_LENGTH, USERNAME_MIN_LENGTH, USERNAME_REGEX } from '@lamalibre/lamaste';
import { readUsersRaw } from '../../lib/authelia.js';
import { listDirectoryUsers } from '../../lib/directory.js';
import {
  disableInvitees,
  invitationPolicyView,
  scheduleInvitationSweep,
  setInvitationPolicy,
} from '../../lib/delegated-invitations.js';
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

const PluginNameParamSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9-]+$/, 'Plugin name must contain only lowercase letters, numbers, and hyphens'),
});

const DisableInviteesSchema = z
  .object({ inviterUserId: z.string().uuid(), transitive: z.boolean().optional().default(false) })
  .strict();

/** The list's default and largest length. */
const INVITATIONS_LIST_DEFAULT = 500;
const INVITATIONS_LIST_MAX = 2000;

const ListQuerySchema = z
  .object({
    plugin: z
      .string()
      .regex(/^[a-z0-9-]{1,100}$/)
      .optional(),
    inviter: z.string().uuid().optional(),
    kind: z.enum(['admin', 'delegated']).optional(),
    limit: z.coerce.number().int().min(1).max(INVITATIONS_LIST_MAX).optional(),
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
  // GET /api/invitations — the newest invitations, both kinds, optionally of
  // one plugin, one inviter or one kind, at most `limit` (`truncated` says
  // there are more); tokens are never stored, so never shown
  fastify.get(
    '/invitations',
    {
      preHandler: fastify.requireRole(['admin']),
    },
    async (request, reply) => {
      const filter = ListQuerySchema.parse(request.query ?? {});
      const limit = filter.limit ?? INVITATIONS_LIST_DEFAULT;
      try {
        const [invitations, users] = await Promise.all([
          listInvitations({
            ...(filter.plugin ? { plugin: filter.plugin } : {}),
            ...(filter.inviter ? { inviterUserId: filter.inviter } : {}),
            ...(filter.kind ? { kind: filter.kind } : {}),
            limit: limit + 1,
          }),
          listDirectoryUsers(),
        ]);
        const usernames = new Map(users.map((u) => [u.userId, u.username]));
        return {
          invitations: invitations.slice(0, limit).map((inv) => adminView(inv, usernames)),
          truncated: invitations.length > limit,
        };
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
      // The token in the fragment: no server log keeps it (the page posts it).
      const inviteUrl = inviteDomain ? `https://auth.${inviteDomain}/invite#${token}` : null;

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
  // that ended without making an account (revoked, expired): one that made
  // an account stays on record (409 `invitation_has_user`)
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
      const { action, invitation } = outcome;
      // Being accepted, it ends revoked; an account made by then is disabled.
      const firstMark = action === 'marked' && invitation.revokePendingReason === null;
      if (action !== 'marked' || firstMark) {
        await recordAuditBestEffort(
          {
            actor: actorFromRequest(request),
            action: {
              marked: 'invitation.revoke.marked',
              revoked: 'invitation.revoked',
              deleted: 'invitation.deleted',
            }[action],
            plugin: invitation.plugin,
            details: {
              invitationId: id,
              kind: invitation.kind,
              ...(action === 'deleted' ? {} : { reason: 'admin' }),
            },
          },
          request.log,
        );
      }
      if (action === 'marked') return reply.code(202).send({ ok: true, action });
      return { ok: true, action };
    },
  );

  // POST /api/invitations/disable-invitees { inviterUserId, transitive } —
  // disable everyone a person invited (with `transitive`, everyone those
  // invited too), through the usual offboarding
  fastify.post(
    '/invitations/disable-invitees',
    {
      preHandler: fastify.requireRole(['admin']),
    },
    async (request, reply) => {
      const body = DisableInviteesSchema.parse(request.body);
      try {
        const outcome = await disableInvitees(body.inviterUserId, {
          transitive: body.transitive,
          actor: actorFromRequest(request),
          logger: request.log,
        });
        scheduleInvitationSweep(request.log);
        return {
          ok: true,
          disabled: outcome.disabled,
          ...(outcome.warnings.length > 0 ? { warnings: outcome.warnings } : {}),
        };
      } catch (err) {
        return sendFailure(request, reply, err, 'Failed to disable the invitees');
      }
    },
  );

  // GET /api/plugins/:name/invitation-policy — the policy of a plugin's
  // delegated invitations, whether it can be invited into now, its inviting roles
  fastify.get(
    '/plugins/:name/invitation-policy',
    {
      preHandler: fastify.requireRole(['admin']),
    },
    async (request, reply) => {
      const { name } = PluginNameParamSchema.parse(request.params);
      try {
        return await invitationPolicyView(name);
      } catch (err) {
        return sendFailure(request, reply, err, 'Failed to read the invitation policy');
      }
    },
  );

  // PUT /api/plugins/:name/invitation-policy { enabled, emailDomains,
  // maxOpenPerInviter?, maxJoined?, lifetimeDays? } — the whole policy; its
  // open invitations are swept against it
  fastify.put(
    '/plugins/:name/invitation-policy',
    {
      preHandler: fastify.requireRole(['admin']),
    },
    async (request, reply) => {
      const { name } = PluginNameParamSchema.parse(request.params);
      try {
        const { warnings } = await setInvitationPolicy(name, request.body, {
          actor: actorFromRequest(request),
          logger: request.log,
        });
        return {
          ...(await invitationPolicyView(name)),
          ...(warnings.length > 0 ? { warnings } : {}),
        };
      } catch (err) {
        return sendFailure(request, reply, err, 'Failed to save the invitation policy');
      }
    },
  );
}

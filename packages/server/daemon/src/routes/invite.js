import crypto from 'node:crypto';
import { z } from 'zod';
import { readInvitations, withInvitationsLock, writeInvitations } from '../lib/state.js';
import {
  createUserFromInvitation,
  hashPassword,
  readUsersRaw,
  generateTotpSecret,
  writeTotpToDatabase,
} from '../lib/authelia.js';
import { httpError } from '../lib/app-error.js';
import { changeUsers, usersFileError } from '../lib/directory.js';
import { invitationDomainsNow, invitationSignInDomain } from '../lib/domains.js';

/**
 * Find an invitation by token using a constant-time comparison.
 * Both the candidate and stored token are validated as 64-hex strings, so
 * we can compare the raw byte buffers via timingSafeEqual without HMAC equalization.
 * Iterating the full list (no early exit on match) keeps the lookup time
 * proportional to inventory size, not which entry matched.
 */
function findInvitationByToken(invitations, token) {
  const candidate = Buffer.from(token, 'hex');
  if (candidate.length !== 32) return undefined;
  let match;
  for (const inv of invitations) {
    if (typeof inv.token !== 'string' || !/^[a-f0-9]{64}$/.test(inv.token)) continue;
    const stored = Buffer.from(inv.token, 'hex');
    if (stored.length === candidate.length && crypto.timingSafeEqual(stored, candidate)) {
      match = inv;
    }
  }
  return match;
}

const AcceptInvitationSchema = z.object({
  password: z.string().min(8).max(128),
});

const TokenParamSchema = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/) });

export default async function inviteRoutes(fastify, _opts) {
  // GET /api/invite/:token — get invitation details (public)
  fastify.get('/:token', async (request, reply) => {
    const { token } = TokenParamSchema.parse(request.params);

    let invitations;
    try {
      invitations = await readInvitations();
    } catch (err) {
      request.log.error(err, 'Failed to read invitations');
      return reply.code(500).send({ error: 'Internal server error' });
    }

    const invitation = findInvitationByToken(invitations, token);
    if (!invitation) {
      return reply.code(404).send({ error: 'Invitation not found' });
    }

    if (invitation.used) {
      return reply.code(410).send({ error: 'This invitation has already been used' });
    }

    if (new Date(invitation.expiresAt) < new Date()) {
      return reply.code(410).send({ error: 'This invitation has expired' });
    }

    return {
      username: invitation.username,
      email: invitation.email,
      expiresAt: invitation.expiresAt,
    };
  });

  // POST /api/invite/:token/accept — accept invitation and set password (public)
  fastify.post('/:token/accept', async (request, reply) => {
    const { token } = TokenParamSchema.parse(request.params);
    const body = AcceptInvitationSchema.parse(request.body);

    let invitations;
    try {
      invitations = await readInvitations();
    } catch (err) {
      request.log.error(err, 'Failed to read invitations');
      return reply.code(500).send({ error: 'Internal server error' });
    }

    const invitation = findInvitationByToken(invitations, token);
    if (!invitation) {
      return reply.code(404).send({ error: 'Invitation not found' });
    }

    if (invitation.used) {
      return reply.code(410).send({ error: 'This invitation has already been used' });
    }

    if (new Date(invitation.expiresAt) < new Date()) {
      return reply.code(410).send({ error: 'This invitation has expired' });
    }

    // Race condition guard: check user doesn't already exist
    let usersData;
    try {
      usersData = await readUsersRaw();
    } catch {
      usersData = { users: {} };
    }

    if (usersData.users[invitation.username]) {
      return reply.code(409).send({ error: 'This username already exists' });
    }

    // Hash password and create user
    let hashedPassword;
    try {
      hashedPassword = await hashPassword(body.password);
    } catch (err) {
      request.log.error(err, 'Failed to hash password');
      return reply.code(500).send({ error: 'Failed to process password' });
    }

    const grantedDomains = await invitationDomainsNow(invitation);

    // Through the users lock: the directory gives the user their id, and
    // the domains are rendered (their memberships, with the kinds the
    // invitation named), before they can sign in.
    try {
      await changeUsers(
        async () => {
          // An unreadable users file is refused, never written over.
          let current = { users: {} };
          try {
            current = await readUsersRaw();
          } catch (err) {
            if (err.code !== 'ENOENT') {
              throw httpError('Failed to read user database', 500, { cause: usersFileError(err) });
            }
          }
          if (current.users[invitation.username]) {
            throw httpError('This username already exists', 409);
          }
          await createUserFromInvitation(
            invitation.username,
            invitation.email,
            invitation.groups,
            hashedPassword,
          );
        },
        {
          actor: 'invitation',
          logger: request.log,
          // A removed user's grants, groups and second factors under the
          // username go first; a username with an OIDC identity is refused.
          creates: [invitation.username],
          // The domains the invitation names that still are the ones it
          // named (an invitation from before the multi-domain relay names
          // none: the relay's one domain).
          ...(Array.isArray(invitation.domains)
            ? { domains: { [invitation.username]: grantedDomains } }
            : {}),
          expect: (users) => users[invitation.username]?.password === hashedPassword,
        },
      );
    } catch (err) {
      if (err.statusCode === 409) {
        return reply
          .code(409)
          .send({ error: err.message, ...(err.code ? { code: err.code } : {}) });
      }
      if (err.statusCode === 503) {
        return reply.code(503).send({ error: err.message, code: err.code });
      }
      request.log.error(err.cause ?? err, 'Failed to create user from invitation');
      return reply.code(500).send({ error: 'Failed to create user account' });
    }

    // Generate TOTP so the user can scan the QR code immediately
    let totpUri = null;
    try {
      const { secret, uri } = generateTotpSecret(invitation.username);
      await writeTotpToDatabase(invitation.username, secret);
      totpUri = uri;
    } catch (err) {
      request.log.error(err, 'Failed to generate TOTP for invited user');
      // Non-fatal: user was created, they can have admin reset TOTP later
    }

    // Mark invitation as used — on the file as it is now, under its lock.
    try {
      await withInvitationsLock(async () => {
        const current = await readInvitations();
        // The token found it (checked above); it names this invitation alone.
        const accepted = current.find((inv) => inv.token === invitation.token);
        if (!accepted) return;
        accepted.used = true;
        accepted.acceptedAt = new Date().toISOString();
        await writeInvitations(current);
      });
    } catch (err) {
      request.log.warn(err, 'Failed to update invitation status (user was created)');
    }

    // The sign-in of the first domain the user is a member of.
    const loginDomain = await invitationSignInDomain(invitation);
    const loginUrl = loginDomain ? `https://auth.${loginDomain}/` : null;

    return {
      ok: true,
      username: invitation.username,
      loginUrl,
      totpUri,
    };
  });
}

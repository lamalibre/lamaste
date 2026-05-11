import crypto from 'node:crypto';
import { z } from 'zod';
import { readInvitations, writeInvitations } from '../lib/state.js';
import {
  createUserFromInvitation,
  hashPassword,
  readUsersRaw,
  generateTotpSecret,
  writeTotpToDatabase,
} from '../lib/authelia.js';
import { getConfig } from '../lib/config.js';

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

    try {
      await createUserFromInvitation(
        invitation.username,
        invitation.email,
        invitation.groups,
        hashedPassword,
      );
    } catch (err) {
      request.log.error(err, 'Failed to create user from invitation');
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

    // Mark invitation as used
    invitation.used = true;
    invitation.acceptedAt = new Date().toISOString();

    try {
      await writeInvitations(invitations);
    } catch (err) {
      request.log.warn(err, 'Failed to update invitation status (user was created)');
    }

    const config = getConfig();
    const loginUrl = config.domain ? `https://auth.${config.domain}/` : null;

    return {
      ok: true,
      username: invitation.username,
      loginUrl,
      totpUri,
    };
  });
}

import { z } from 'zod';
import {
  readUsers,
  readUsersRaw,
  writeUsers,
  reloadAuthelia,
  hashPassword,
  generateTotpSecret,
  writeTotpToDatabase,
} from '../../lib/authelia.js';
import { removeGrantsForUser } from '../../lib/user-access.js';
import { bumpUserEpoch } from '../../lib/config.js';
import { gatekeeperRequest } from '../../lib/gatekeeper-client.js';

const CreateUserSchema = z.object({
  username: z
    .string()
    .min(2)
    .max(32)
    .regex(
      /^[a-z0-9][a-z0-9_-]*$/,
      'Username must start with a lowercase letter or digit and may contain underscores or hyphens',
    ),
  displayname: z.string().min(1).max(100),
  email: z.string().email(),
  password: z.string().min(8).max(128),
  groups: z.array(z.string()).optional().default([]),
});

const UsernameParamSchema = z.object({
  username: z
    .string()
    .min(2)
    .max(32)
    .regex(/^[a-z0-9][a-z0-9_-]*$/, 'Invalid username format'),
});

const UpdateUserSchema = z
  .object({
    displayname: z.string().min(1).max(100).optional(),
    email: z.string().email().optional(),
    password: z.string().min(8).max(128).optional(),
    groups: z.array(z.string()).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided',
  });

export default async function usersRoutes(fastify, _opts) {
  // GET /api/users — list all users (no sensitive fields)
  fastify.get(
    '/users',
    {
      preHandler: fastify.requireRole(['admin']),
    },
    async (request, reply) => {
      try {
        const users = await readUsers();
        const sorted = users.sort((a, b) => a.username.localeCompare(b.username));
        return { users: sorted };
      } catch (err) {
        request.log.error(err, 'Failed to read user database');
        return reply.code(500).send({ error: 'Failed to read user database' });
      }
    },
  );

  // POST /api/users — create a new user
  fastify.post(
    '/users',
    {
      preHandler: fastify.requireRole(['admin']),
    },
    async (request, reply) => {
      const body = CreateUserSchema.parse(request.body);

      let usersData;
      try {
        usersData = await readUsersRaw();
      } catch (err) {
        request.log.error(err, 'Failed to read user database');
        return reply.code(500).send({ error: 'Failed to read user database' });
      }

      if (usersData.users[body.username]) {
        return reply.code(409).send({ error: 'Username already exists' });
      }

      let hash;
      try {
        hash = await hashPassword(body.password);
      } catch (err) {
        request.log.error(err, 'Failed to hash password');
        return reply.code(500).send({ error: 'Failed to hash password' });
      }

      usersData.users[body.username] = {
        displayname: body.displayname,
        email: body.email,
        password: hash,
        groups: body.groups,
      };

      try {
        await writeUsers(usersData);
      } catch (err) {
        request.log.error(err, 'Failed to update user database');
        return reply.code(500).send({ error: 'Failed to update user database' });
      }

      try {
        await reloadAuthelia();
      } catch (err) {
        request.log.warn(err, 'Failed to reload Authelia after user creation');
      }

      return reply.code(201).send({
        ok: true,
        user: {
          username: body.username,
          displayname: body.displayname,
          email: body.email,
          groups: body.groups,
        },
      });
    },
  );

  // PUT /api/users/:username — update a user
  fastify.put(
    '/users/:username',
    {
      preHandler: fastify.requireRole(['admin']),
    },
    async (request, reply) => {
      const { username } = UsernameParamSchema.parse(request.params);
      const body = UpdateUserSchema.parse(request.body);

      let usersData;
      try {
        usersData = await readUsersRaw();
      } catch (err) {
        request.log.error(err, 'Failed to read user database');
        return reply.code(500).send({ error: 'Failed to read user database' });
      }

      if (!usersData.users[username]) {
        return reply.code(404).send({ error: 'User not found' });
      }

      const user = usersData.users[username];

      if (body.displayname !== undefined) {
        user.displayname = body.displayname;
      }
      if (body.email !== undefined) {
        user.email = body.email;
      }
      if (body.groups !== undefined) {
        user.groups = body.groups;
      }
      if (body.password !== undefined) {
        try {
          user.password = await hashPassword(body.password);
        } catch (err) {
          request.log.error(err, 'Failed to hash password');
          return reply.code(500).send({ error: 'Failed to hash password' });
        }
      }

      try {
        await writeUsers(usersData);
      } catch (err) {
        request.log.error(err, 'Failed to update user database');
        return reply.code(500).send({ error: 'Failed to update user database' });
      }

      try {
        await reloadAuthelia();
      } catch (err) {
        request.log.warn(err, 'Failed to reload Authelia after user update');
      }

      return {
        ok: true,
        user: {
          username,
          displayname: user.displayname,
          email: user.email,
          groups: user.groups || [],
        },
      };
    },
  );

  // DELETE /api/users/:username — delete a user
  fastify.delete(
    '/users/:username',
    {
      preHandler: fastify.requireRole(['admin']),
    },
    async (request, reply) => {
      const { username } = UsernameParamSchema.parse(request.params);

      let usersData;
      try {
        usersData = await readUsersRaw();
      } catch (err) {
        request.log.error(err, 'Failed to read user database');
        return reply.code(500).send({ error: 'Failed to read user database' });
      }

      if (!usersData.users[username]) {
        return reply.code(404).send({ error: 'User not found' });
      }

      const userCount = Object.keys(usersData.users).length;
      if (userCount <= 1) {
        return reply.code(400).send({ error: 'Cannot delete the last user' });
      }

      delete usersData.users[username];

      try {
        await writeUsers(usersData);
      } catch (err) {
        request.log.error(err, 'Failed to update user database');
        return reply.code(500).send({ error: 'Failed to update user database' });
      }

      try {
        await reloadAuthelia();
      } catch (err) {
        request.log.warn(err, 'Failed to reload Authelia after user deletion');
      }

      // ---------------------------------------------------------------
      // Cascade cleanup. The user is already gone from users.yml; from
      // here on we never roll back. Failures collect into `warnings` so
      // the admin sees a partial-success response and can investigate.
      // ---------------------------------------------------------------
      const warnings = [];

      // 1. Legacy user-plugin-access.json grants (pre-gatekeeper migration)
      try {
        const removed = await removeGrantsForUser(username, request.log);
        if (removed > 0) {
          request.log.info(
            { username, removed },
            'Cascade: removed legacy user-plugin-access grants',
          );
        }
      } catch (err) {
        request.log.warn(
          { err, username },
          'Cascade: failed to remove legacy user-plugin-access grants',
        );
        warnings.push({
          step: 'user-plugin-access',
          message: `Failed to remove legacy grants: ${err.message}`,
        });
      }

      // 2. Gatekeeper grants — single bulk-delete keyed by principal
      try {
        const result = await gatekeeperRequest(
          'DELETE',
          `/api/grants?principalType=user&principalId=${encodeURIComponent(username)}`,
        );
        if (result.ok) {
          const removed = (result.data && typeof result.data === 'object' && 'removed' in result.data)
            ? result.data.removed
            : 0;
          if (removed > 0) {
            request.log.info(
              { username, removed },
              'Cascade: removed gatekeeper grants for deleted user',
            );
          }
        } else if (result.reason === 'unreachable' || result.reason === 'no-secret') {
          request.log.warn(
            { username, reason: result.reason },
            'Cascade: gatekeeper unreachable — grants for deleted user remain in access-grants.json',
          );
          warnings.push({
            step: 'gatekeeper',
            message:
              'Gatekeeper service was unreachable. Re-run grant cleanup once it is back online — grants for this user may still exist in access-grants.json.',
          });
        } else {
          request.log.warn(
            { username, statusCode: result.statusCode, error: result.error },
            'Cascade: gatekeeper returned an error',
          );
          warnings.push({
            step: 'gatekeeper',
            message: `Gatekeeper returned HTTP ${result.statusCode}: ${result.error}`,
          });
        }
      } catch (err) {
        request.log.warn(
          { err, username },
          'Cascade: unexpected failure calling gatekeeper',
        );
        warnings.push({
          step: 'gatekeeper',
          message: `Unexpected failure: ${err.message}`,
        });
      }

      // 3. Live user-access sessions — bump per-user epoch in panel.json so
      //    middleware rejects every session token with iat < epoch.
      try {
        const epoch = await bumpUserEpoch(username);
        request.log.info(
          { username, epoch },
          'Cascade: bumped user-access session epoch',
        );
      } catch (err) {
        request.log.warn(
          { err, username },
          'Cascade: failed to bump user-access session epoch — old session tokens may still validate',
        );
        warnings.push({
          step: 'session-epoch',
          message: `Failed to invalidate live sessions: ${err.message}. Old session tokens for this username may still validate until their natural expiry.`,
        });
      }

      const response = { ok: true };
      if (warnings.length > 0) {
        response.warnings = warnings;
      }
      return response;
    },
  );

  // POST /api/users/:username/reset-totp — generate a new TOTP secret
  fastify.post(
    '/users/:username/reset-totp',
    {
      preHandler: fastify.requireRole(['admin']),
    },
    async (request, reply) => {
      const { username } = UsernameParamSchema.parse(request.params);

      let usersData;
      try {
        usersData = await readUsersRaw();
      } catch (err) {
        request.log.error(err, 'Failed to read user database');
        return reply.code(500).send({ error: 'Failed to read user database' });
      }

      if (!usersData.users[username]) {
        return reply.code(404).send({ error: 'User not found' });
      }

      const { secret, uri } = generateTotpSecret(username);

      try {
        await writeTotpToDatabase(username, secret);
      } catch (err) {
        request.log.error(err, 'Failed to write TOTP to Authelia database');
        return reply.code(500).send({ error: 'Failed to write TOTP configuration' });
      }

      return { ok: true, totpUri: uri };
    },
  );
}

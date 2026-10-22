import { z } from 'zod';
import { USERNAME_MAX_LENGTH, USERNAME_MIN_LENGTH, USERNAME_REGEX } from '@lamalibre/lamaste';
import {
  readUsers,
  readUsersRaw,
  writeUsers,
  hashPassword,
  generateTotpSecret,
  writeTotpToDatabase,
} from '../../lib/authelia.js';
import { removeGrantsForUser } from '../../lib/user-access.js';
import { revokeUserRegistryTokens } from '../../lib/registry-credential.js';
import { bumpUserEpoch } from '../../lib/config.js';
import { httpError } from '../../lib/app-error.js';
import { actorFromRequest } from '../../lib/actor.js';
import {
  ADMIN_GROUP,
  changeUsers,
  directoryUsersByUsername,
  eraseDirectoryUser,
  findDirectoryUser,
  getDirectoryUser,
  usersFileError,
} from '../../lib/directory.js';

const CreateUserSchema = z.object({
  username: z
    .string()
    .min(USERNAME_MIN_LENGTH)
    .max(USERNAME_MAX_LENGTH)
    .regex(
      USERNAME_REGEX,
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
    .min(USERNAME_MIN_LENGTH)
    .max(USERNAME_MAX_LENGTH)
    .regex(USERNAME_REGEX, 'Invalid username format'),
});

const UpdateUserSchema = z
  .object({
    displayname: z.string().min(1).max(100).optional(),
    email: z.string().email().optional(),
    password: z.string().min(8).max(128).optional(),
    groups: z.array(z.string()).optional(),
    // Authelia's `disabled: true`: the user cannot sign in, every plugin
    // audience shows them disabled, and the user surface refuses them.
    disabled: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided',
  });

const DeleteQuerySchema = z
  .object({
    // Erase the tombstone at once: what the directory, invitations and
    // Gatekeeper's access-request log keep of the user goes too.
    erase: z.enum(['true', 'false']).optional(),
  })
  .strict();

/** users.yml, or a 500 the route answers with (its cause logged without the file's content). */
async function readUsersOrFail() {
  try {
    return await readUsersRaw();
  } catch (err) {
    throw httpError('Failed to read user database', 500, { cause: usersFileError(err) });
  }
}

async function writeUsersOrFail(usersData) {
  try {
    await writeUsers(usersData);
  } catch (err) {
    throw httpError('Failed to update user database', 500, { cause: err });
  }
}

/** An enabled member of the administrators' group. */
function isEnabledAdmin(entry) {
  return (
    Array.isArray(entry?.groups) && entry.groups.includes(ADMIN_GROUP) && entry.disabled !== true
  );
}

/**
 * Answer a refusal a users change threw (an error with `statusCode`: its
 * message and `code`), or a 500 for anything else — logged either way when
 * it is the panel's own failure.
 */
function sendFailure(request, reply, err, fallback) {
  if (Number.isInteger(err.statusCode)) {
    if (err.statusCode >= 500) request.log.error(err.cause ?? err, err.message);
    return reply
      .code(err.statusCode)
      .send({ error: err.message, ...(err.code ? { code: err.code } : {}) });
  }
  request.log.error(err, fallback);
  return reply.code(500).send({ error: fallback });
}

export default async function usersRoutes(fastify, _opts) {
  // GET /api/users — list all users (no sensitive fields): users.yml's, with
  // each one's directory id (null until the directory has seen them, within
  // a minute) and status (`active` or `disabled`)
  fastify.get(
    '/users',
    {
      preHandler: fastify.requireRole(['admin']),
    },
    async (request, reply) => {
      try {
        const users = await readUsers();
        const directory = await directoryUsersByUsername();
        const listed = users
          .map((user) => {
            const known = directory.get(user.username);
            return {
              ...user,
              userId: known?.userId ?? null,
              status: known?.status ?? (user.disabled ? 'disabled' : 'active'),
            };
          })
          .sort((a, b) => a.username.localeCompare(b.username));
        return { users: listed };
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
      // Strict tier — user creation hashes a fresh password and provisions
      // an identity. Brute-forcing this surface is cheap if uncapped.
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const body = CreateUserSchema.parse(request.body);

      try {
        // Refused before a password is hashed; checked again under the lock.
        if ((await readUsersOrFail()).users[body.username]) {
          return reply.code(409).send({ error: 'Username already exists' });
        }
      } catch (err) {
        return sendFailure(request, reply, err, 'Failed to read user database');
      }

      let hash;
      try {
        hash = await hashPassword(body.password);
      } catch (err) {
        request.log.error(err, 'Failed to hash password');
        return reply.code(500).send({ error: 'Failed to hash password' });
      }

      let warnings;
      try {
        ({ warnings } = await changeUsers(
          async () => {
            const usersData = await readUsersOrFail();
            if (usersData.users[body.username]) throw httpError('Username already exists', 409);
            usersData.users[body.username] = {
              displayname: body.displayname,
              email: body.email,
              password: hash,
              groups: body.groups,
            };
            await writeUsersOrFail(usersData);
          },
          // A removed user's grants and groups under the username go first.
          { actor: actorFromRequest(request), logger: request.log, creates: [body.username] },
        ));
      } catch (err) {
        return sendFailure(request, reply, err, 'Failed to update user database');
      }

      const created = await findDirectoryUser(body.username);
      return reply.code(201).send({
        ok: true,
        user: {
          username: body.username,
          displayname: body.displayname,
          email: body.email,
          groups: body.groups,
          disabled: false,
          userId: created?.userId ?? null,
          status: 'active',
        },
        ...(warnings.length > 0 ? { warnings } : {}),
      });
    },
  );

  // PUT /api/users/:username — update a user; `disabled: true` disables
  // them (the last enabled administrator cannot be), `false` enables them
  fastify.put(
    '/users/:username',
    {
      preHandler: fastify.requireRole(['admin']),
      // Strict tier — body may include a fresh password that we re-hash;
      // treat as auth-adjacent and bound to the same 5/min ceiling as
      // creation.
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const { username } = UsernameParamSchema.parse(request.params);
      const body = UpdateUserSchema.parse(request.body);

      let passwordHash;
      if (body.password !== undefined) {
        try {
          passwordHash = await hashPassword(body.password);
        } catch (err) {
          request.log.error(err, 'Failed to hash password');
          return reply.code(500).send({ error: 'Failed to hash password' });
        }
      }

      let outcome;
      try {
        outcome = await changeUsers(
          async () => {
            const usersData = await readUsersOrFail();
            const user = usersData.users[username];
            if (!user) throw httpError('User not found', 404);
            const groupsBefore = Array.isArray(user.groups) ? [...user.groups] : [];
            const wasDisabled = user.disabled === true;
            if (body.disabled === true && isEnabledAdmin(user)) {
              const enabledAdmins = Object.values(usersData.users).filter(isEnabledAdmin).length;
              if (enabledAdmins <= 1) {
                throw httpError('Cannot disable the last enabled administrator', 400, {
                  code: 'last_admin',
                });
              }
            }

            if (body.displayname !== undefined) user.displayname = body.displayname;
            if (body.email !== undefined) user.email = body.email;
            if (body.groups !== undefined) user.groups = body.groups;
            if (passwordHash !== undefined) user.password = passwordHash;
            if (body.disabled === true) user.disabled = true;
            if (body.disabled === false) delete user.disabled;

            await writeUsersOrFail(usersData);
            return { user, groupsBefore, wasDisabled };
          },
          { actor: actorFromRequest(request), logger: request.log },
        );
      } catch (err) {
        return sendFailure(request, reply, err, 'Failed to update user database');
      }

      const { user, groupsBefore, wasDisabled } = outcome.result;
      const disabled = user.disabled === true;
      const justDisabled = disabled && !wasDisabled;
      const warnings = [...outcome.warnings];

      // Disabling is offboarding: the user's desktop sessions and registry
      // tokens end with it. Registry scopes are granted at login from
      // feria-* groups; losing a group must not leave a valid token behind
      // either. Best effort — the user update itself is already done.
      if (justDisabled) {
        try {
          await bumpUserEpoch(username);
        } catch (err) {
          request.log.warn({ err: err.message }, 'Failed to end the sessions of a disabled user');
          warnings.push({
            step: 'session-epoch',
            message: `Live desktop sessions were not ended: ${err.message}`,
          });
        }
      }
      const tokenChange = justDisabled
        ? { deleted: true }
        : body.groups !== undefined
          ? { before: groupsBefore, after: user.groups || [] }
          : null;
      if (tokenChange) {
        try {
          await revokeUserRegistryTokens(username, tokenChange, request.log);
        } catch (err) {
          request.log.warn({ username, err: err.message }, 'Failed to revoke registry tokens');
          warnings.push(`registry tokens were not revoked: ${err.message}`);
        }
      }

      const known = await findDirectoryUser(username);
      return {
        ok: true,
        user: {
          username,
          displayname: user.displayname,
          email: user.email,
          groups: user.groups || [],
          disabled,
          userId: known?.userId ?? null,
          status: disabled ? 'disabled' : 'active',
        },
        ...(warnings.length > 0 ? { warnings } : {}),
      };
    },
  );

  // DELETE /api/users/:username?erase= — delete a user. The directory keeps
  // a tombstone (the id and the last known name and address, `removed`);
  // `erase=true` scrubs it at once (see POST /api/identity/directory/:userId/erase)
  fastify.delete(
    '/users/:username',
    {
      preHandler: fastify.requireRole(['admin']),
      // Moderate tier — destructive management write; the cascade also
      // fires off gatekeeper/cleanup work, so we cap concurrency to avoid
      // hammering downstream services.
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const { username } = UsernameParamSchema.parse(request.params);
      const { erase } = DeleteQuerySchema.parse(request.query ?? {});
      const actor = actorFromRequest(request);

      let outcome;
      try {
        outcome = await changeUsers(
          async () => {
            const usersData = await readUsersOrFail();
            if (!usersData.users[username]) throw httpError('User not found', 404);
            if (Object.keys(usersData.users).length <= 1) {
              throw httpError('Cannot delete the last user', 400);
            }
            delete usersData.users[username];
            await writeUsersOrFail(usersData);
          },
          { actor, logger: request.log, deleted: [username] },
        );
      } catch (err) {
        return sendFailure(request, reply, err, 'Failed to update user database');
      }
      const userId =
        outcome.directory?.removed.find((removed) => removed.username === username)?.userId ?? null;

      // ---------------------------------------------------------------
      // Cascade cleanup. The user is already gone from users.yml; from
      // here on we never roll back. Failures collect into `warnings` so
      // the admin sees a partial-success response and can investigate.
      // ---------------------------------------------------------------
      const warnings = [...outcome.warnings];

      // 0. Registry (Feria) tokens the user holds — their groups are gone.
      try {
        await revokeUserRegistryTokens(username, { deleted: true }, request.log);
      } catch (err) {
        request.log.warn(
          { username, err: err.message },
          'Cascade: registry token revocation failed',
        );
        warnings.push(`registry tokens were not revoked: ${err.message}`);
      }

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

      // 2. Gatekeeper grants and group memberships went with the deletion
      //    (`changeUsers`): a failure there is among the warnings, and the
      //    tombstone keeps the cleanup pending until it succeeds.

      // 3. Live user-access sessions — bump per-user epoch in panel.json so
      //    middleware rejects every session token with iat < epoch.
      try {
        const epoch = await bumpUserEpoch(username);
        request.log.info({ username, epoch }, 'Cascade: bumped user-access session epoch');
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

      // 4. Erase the tombstone, when asked to. Its failure leaves the
      //    tombstone in place, to be erased later by its id.
      let erased = false;
      if (erase === 'true') {
        if (userId === null) {
          warnings.push({
            step: 'erase',
            message:
              'The user directory holds no tombstone for this user — nothing was erased; erase it from the directory once it appears there',
          });
        } else {
          try {
            await eraseDirectoryUser(userId, { actor, logger: request.log });
            erased = true;
          } catch (err) {
            request.log.warn({ userId, err: err.message }, 'Cascade: erasing the user failed');
            warnings.push({ step: 'erase', message: err.message });
          }
        }
      }

      const tombstone = userId ? await getDirectoryUser(userId) : null;
      const response = {
        ok: true,
        userId,
        // Gatekeeper dropped the grants and group memberships under the username.
        principalCleared: tombstone?.principalClearedAt != null,
        ...(erase === 'true' ? { erased } : {}),
      };
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
        usersData = await readUsersOrFail();
      } catch (err) {
        return sendFailure(request, reply, err, 'Failed to read user database');
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

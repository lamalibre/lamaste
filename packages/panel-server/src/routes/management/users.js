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

const CreateUserSchema = z.object({
  username: z
    .string()
    .min(2)
    .max(32)
    .regex(/^[a-z0-9_-]+$/, 'Username must contain only lowercase alphanumeric characters, underscores, and hyphens'),
  displayname: z.string().min(1).max(100),
  email: z.string().email(),
  password: z.string().min(8).max(128),
  groups: z.array(z.string()).optional().default([]),
});

const UsernameParamSchema = z.object({
  username: z.string().min(2).max(32).regex(/^[a-z0-9_-]+$/, 'Invalid username format'),
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
  fastify.get('/users', {
    preHandler: fastify.requireRole(['admin']),
  }, async (request, reply) => {
    try {
      const users = await readUsers();
      const sorted = users.sort((a, b) => a.username.localeCompare(b.username));
      return { users: sorted };
    } catch (err) {
      request.log.error(err, 'Failed to read user database');
      return reply.code(500).send({ error: 'Failed to read user database' });
    }
  });

  // POST /api/users — create a new user
  fastify.post('/users', {
    preHandler: fastify.requireRole(['admin']),
  }, async (request, reply) => {
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
  });

  // PUT /api/users/:username — update a user
  fastify.put('/users/:username', {
    preHandler: fastify.requireRole(['admin']),
  }, async (request, reply) => {
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
  });

  // DELETE /api/users/:username — delete a user
  fastify.delete('/users/:username', {
    preHandler: fastify.requireRole(['admin']),
  }, async (request, reply) => {
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

    return { ok: true };
  });

  // POST /api/users/:username/reset-totp — generate a new TOTP secret
  fastify.post('/users/:username/reset-totp', {
    preHandler: fastify.requireRole(['admin']),
  }, async (request, reply) => {
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
  });
}

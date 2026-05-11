import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  createGroup,
  listGroups,
  getGroup,
  updateGroup,
  deleteGroup,
  addMembers,
  removeMembers,
} from '../../lib/groups.js';

const CreateGroupSchema = z.object({
  name: z.string().min(2).max(63).regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/),
  description: z.string().max(500).optional().default(''),
  createdBy: z.string().max(100).optional(),
});

const UpdateGroupSchema = z.object({
  name: z.string().min(2).max(63).regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/).optional(),
  description: z.string().max(500).optional(),
});

const AddMembersSchema = z.object({
  usernames: z.array(z.string().min(1).max(100)).min(1).max(50),
});

export async function groupRoutes(fastify: FastifyInstance): Promise<void> {
  // POST /api/groups — create group
  fastify.post('/groups', async (request: FastifyRequest, reply: FastifyReply) => {
    let body: z.infer<typeof CreateGroupSchema>;
    try {
      body = CreateGroupSchema.parse(request.body);
    } catch (err) {
      return reply.code(400).send({ error: 'Invalid request body', details: (err as z.ZodError).errors });
    }

    try {
      const group = await createGroup(body.name, {
        description: body.description,
        createdBy: body.createdBy,
      });
      return reply.code(201).send({ ok: true, group });
    } catch (err) {
      const e = err as Error & { statusCode?: number };
      return reply.code(e.statusCode ?? 500).send({ error: e.message });
    }
  });

  // GET /api/groups — list all groups
  fastify.get('/groups', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const groups = await listGroups();
      return { groups };
    } catch (err) {
      return reply.code(500).send({ error: (err as Error).message });
    }
  });

  // GET /api/groups/:name — get group
  fastify.get('/groups/:name', async (request: FastifyRequest, reply: FastifyReply) => {
    const { name } = request.params as { name: string };
    try {
      const group = await getGroup(name);
      if (!group) {
        return reply.code(404).send({ error: `Group "${name}" not found` });
      }
      return { group };
    } catch (err) {
      return reply.code(500).send({ error: (err as Error).message });
    }
  });

  // PATCH /api/groups/:name — update group
  fastify.patch('/groups/:name', async (request: FastifyRequest, reply: FastifyReply) => {
    const { name } = request.params as { name: string };
    let body: z.infer<typeof UpdateGroupSchema>;
    try {
      body = UpdateGroupSchema.parse(request.body);
    } catch (err) {
      return reply.code(400).send({ error: 'Invalid request body', details: (err as z.ZodError).errors });
    }

    try {
      const group = await updateGroup(name, body);
      return { ok: true, group };
    } catch (err) {
      const e = err as Error & { statusCode?: number };
      return reply.code(e.statusCode ?? 500).send({ error: e.message });
    }
  });

  // DELETE /api/groups/:name — delete group + auto-revoke grants
  fastify.delete('/groups/:name', async (request: FastifyRequest, reply: FastifyReply) => {
    const { name } = request.params as { name: string };
    try {
      const result = await deleteGroup(name);
      return { ok: true, deletedGrants: result.deletedGrants };
    } catch (err) {
      const e = err as Error & { statusCode?: number };
      return reply.code(e.statusCode ?? 500).send({ error: e.message });
    }
  });

  // POST /api/groups/:name/members — add members
  fastify.post('/groups/:name/members', async (request: FastifyRequest, reply: FastifyReply) => {
    const { name } = request.params as { name: string };
    let body: z.infer<typeof AddMembersSchema>;
    try {
      body = AddMembersSchema.parse(request.body);
    } catch (err) {
      return reply.code(400).send({ error: 'Invalid request body', details: (err as z.ZodError).errors });
    }

    try {
      const group = await addMembers(name, body.usernames);
      return { ok: true, group };
    } catch (err) {
      const e = err as Error & { statusCode?: number };
      return reply.code(e.statusCode ?? 500).send({ error: e.message });
    }
  });

  // DELETE /api/groups/:name/members/:username — remove member
  fastify.delete('/groups/:name/members/:username', async (request: FastifyRequest, reply: FastifyReply) => {
    const { name, username } = request.params as { name: string; username: string };
    try {
      const group = await removeMembers(name, [username]);
      return { ok: true, group };
    } catch (err) {
      const e = err as Error & { statusCode?: number };
      return reply.code(e.statusCode ?? 500).send({ error: e.message });
    }
  });
}

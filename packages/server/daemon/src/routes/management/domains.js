/**
 * The relay's base domains and their members (the multi-domain relay,
 * lib/domains.js). Admin only (mTLS).
 *
 *   GET    /api/domains                          domains, member counts, what uses each
 *   POST   /api/domains                          add one (`pending`)
 *   POST   /api/domains/:name/verify-dns         does auth.<domain> resolve here?
 *   POST   /api/domains/:name/activate           issue auth.<domain>, serve its sign-in
 *   DELETE /api/domains/:name                    remove an unused, non-primary domain
 *   GET    /api/domains/:name/members            its members
 *   PUT    /api/domains/:name/members/:user      make a user (id or username) a member
 *   DELETE /api/domains/:name/members/:user      end a membership
 *   PUT    /api/plugins/:name/domain             move a plugin to another domain
 *
 * Routes validate and answer; the work is in lib/domains.js and
 * lib/plugin-domain.js. Refusals answer `{ error, code }`.
 */

import { z } from 'zod';
import { DomainNameSchema } from '@lamalibre/lamaste';
import { actorFromRequest } from '../../lib/actor.js';
import { sendFailure } from '../../lib/app-error.js';
import {
  activateDomain,
  addDomain,
  addDomainMember,
  domainsOverview,
  getDomain,
  listDomainMembers,
  newUsersNeedDomains,
  removeDomain,
  removeDomainMember,
  verifyDomainDns,
} from '../../lib/domains.js';
import { setPluginDomain } from '../../lib/plugin-domain.js';

const NameParamSchema = z.object({ name: DomainNameSchema });
// `user`: a directory id or a username (lib/domains.js decides which).
const MemberParamsSchema = z.object({ name: DomainNameSchema, user: z.string().min(1).max(64) });
const AddDomainSchema = z.object({ name: DomainNameSchema }).strict();
const PluginParamSchema = z.object({ name: z.string().min(1).max(200) });
const PluginDomainSchema = z.object({ domain: DomainNameSchema }).strict();

export default async function domainRoutes(fastify) {
  const admin = { preHandler: fastify.requireRole(['admin']) };

  fastify.get('/domains', admin, async () => {
    const domains = await domainsOverview();
    // Whether users and invitations must name their domains (`domains_required`).
    return { domains, newUsersNeedDomains: newUsersNeedDomains(domains) };
  });

  fastify.post('/domains', admin, async (request, reply) => {
    const { name } = AddDomainSchema.parse(request.body);
    try {
      const domain = await addDomain(name, {
        actor: actorFromRequest(request),
        logger: request.log,
      });
      return reply.code(201).send({ domain });
    } catch (err) {
      return sendFailure(request, reply, err, 'The domain change failed');
    }
  });

  fastify.post(
    '/domains/:name/verify-dns',
    { ...admin, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { name } = NameParamSchema.parse(request.params);
      try {
        return await verifyDomainDns(name);
      } catch (err) {
        return sendFailure(request, reply, err, 'The domain change failed');
      }
    },
  );

  fastify.post(
    '/domains/:name/activate',
    { ...admin, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { name } = NameParamSchema.parse(request.params);
      try {
        const domain = await activateDomain(name, {
          actor: actorFromRequest(request),
          logger: request.log,
        });
        return { domain };
      } catch (err) {
        return sendFailure(request, reply, err, 'The domain change failed');
      }
    },
  );

  fastify.delete('/domains/:name', admin, async (request, reply) => {
    const { name } = NameParamSchema.parse(request.params);
    try {
      return await removeDomain(name, { actor: actorFromRequest(request), logger: request.log });
    } catch (err) {
      return sendFailure(request, reply, err, 'The domain change failed');
    }
  });

  fastify.get('/domains/:name/members', admin, async (request, reply) => {
    const { name } = NameParamSchema.parse(request.params);
    if (!(await getDomain(name))) {
      return reply.code(404).send({ error: 'Domain not found', code: 'domain_not_found' });
    }
    return { members: await listDomainMembers(name) };
  });

  fastify.put('/domains/:name/members/:user', admin, async (request, reply) => {
    const { name, user } = MemberParamsSchema.parse(request.params);
    try {
      return await addDomainMember(name, user, {
        actor: actorFromRequest(request),
        logger: request.log,
      });
    } catch (err) {
      return sendFailure(request, reply, err, 'The domain change failed');
    }
  });

  fastify.delete('/domains/:name/members/:user', admin, async (request, reply) => {
    const { name, user } = MemberParamsSchema.parse(request.params);
    try {
      return await removeDomainMember(name, user, {
        actor: actorFromRequest(request),
        logger: request.log,
      });
    } catch (err) {
      return sendFailure(request, reply, err, 'The domain change failed');
    }
  });

  fastify.put('/plugins/:name/domain', admin, async (request, reply) => {
    const { name } = PluginParamSchema.parse(request.params);
    const { domain } = PluginDomainSchema.parse(request.body);
    try {
      return await setPluginDomain(name, domain, {
        actor: actorFromRequest(request),
        logger: request.log,
      });
    } catch (err) {
      return sendFailure(request, reply, err, 'The domain change failed');
    }
  });
}

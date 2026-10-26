/**
 * The relay's base domains and their members (the multi-domain relay,
 * lib/domains.js). Admin only (mTLS).
 *
 *   GET    /api/domains                          domains, member counts (members, external), what uses each
 *   POST   /api/domains                          add one (`pending`)
 *   POST   /api/domains/:name/verify-dns         does auth.<domain> resolve here?
 *   POST   /api/domains/:name/activate           issue auth.<domain>, serve its sign-in
 *   DELETE /api/domains/:name                    remove an unused, non-primary domain
 *   GET    /api/domains/:name/members            its members, each with the membership's kind
 *   PUT    /api/domains/:name/members/:user      make a user (id or username) a member —
 *                                                `{ kind: 'member' | 'external' }`, member
 *                                                unless named; another kind changes it
 *   DELETE /api/domains/:name/members/:user      end a membership
 *   PUT    /api/plugins/:name/domain             move a plugin to another domain
 *
 * A domain's brand on its auth pages (lib/auth-branding.js):
 *
 *   GET    /api/domains/:name/branding           the record without the blobs (`branding: null` for none)
 *   PUT    /api/domains/:name/branding           the fields, `ifRevision` optional (409 `revision_mismatch`)
 *   DELETE /api/domains/:name/branding           back to the stock page
 *   PUT    /api/domains/:name/branding/logo      `{ data: <base64 PNG> }` — 400 `invalid_image`, 413
 *   PUT    /api/domains/:name/branding/favicon   `{ data: <base64 ICO or PNG> }`
 *   DELETE /api/domains/:name/branding/logo|favicon
 *   GET    /api/domains/:name/branding/preview   the rendered brand.css and the `en` title and footer
 *
 * Routes validate and answer; the work is in lib/domains.js,
 * lib/plugin-domain.js and lib/auth-branding.js. Refusals answer
 * `{ error, code }` — a brand refusal adds `errors` (by field name, never
 * a value), `reason` (an image's) or `revision`.
 */

import { z } from 'zod';
import { DomainNameSchema, MEMBERSHIP_KINDS } from '@lamalibre/lamaste';
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
import { AUTH_BRANDING_FAVICON_MAX_BYTES, AUTH_BRANDING_LOGO_MAX_BYTES } from '@lamalibre/lamaste';
import {
  base64LengthFor,
  getDomainBranding,
  getDomainBrandingPreview,
  removeDomainBranding,
  removeDomainBrandingAsset,
  setDomainBrandingAsset,
  updateDomainBranding,
} from '../../lib/auth-branding.js';

const NameParamSchema = z.object({ name: DomainNameSchema });
// `user`: a directory id or a username (lib/domains.js decides which).
const MemberParamsSchema = z.object({ name: DomainNameSchema, user: z.string().min(1).max(64) });
const AddDomainSchema = z.object({ name: DomainNameSchema }).strict();
const MemberBodySchema = z.object({ kind: z.enum(MEMBERSHIP_KINDS).optional() }).strict();
const PluginParamSchema = z.object({ name: z.string().min(1).max(200) });
const PluginDomainSchema = z.object({ domain: DomainNameSchema }).strict();
/** A brand change: `ifRevision` beside the fields (which lib/auth-branding.js validates by hand, never echoing a value). */
const IfRevisionSchema = z.number().int().positive().optional();
const AssetParamsSchema = z.object({ name: DomainNameSchema, kind: z.enum(['logo', 'favicon']) });
/** An asset upload: base64 text; its length is checked against the kind's limit before decoding. */
const AssetBodySchema = z
  .object({ data: z.string().min(1), ifRevision: IfRevisionSchema })
  .strict();
/** What a route accepts for an asset: the base64 of the largest asset plus the JSON around it. */
const ASSET_BODY_LIMIT =
  base64LengthFor(Math.max(AUTH_BRANDING_LOGO_MAX_BYTES, AUTH_BRANDING_FAVICON_MAX_BYTES)) + 1024;

/**
 * Answer a brand refusal: as `sendFailure`, with the field errors, an
 * image's reason or the current revision when the error carries them.
 */
function sendBrandingFailure(request, reply, err) {
  if (Number.isInteger(err.statusCode) && err.statusCode < 500) {
    return reply.code(err.statusCode).send({
      error: err.message,
      ...(err.code ? { code: err.code } : {}),
      ...(Array.isArray(err.errors) ? { errors: err.errors } : {}),
      ...(typeof err.reason === 'string' ? { reason: err.reason } : {}),
      ...(Number.isInteger(err.revision) ? { revision: err.revision } : {}),
    });
  }
  return sendFailure(request, reply, err, 'The brand change failed');
}

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
    const { kind } = MemberBodySchema.parse(request.body ?? {});
    try {
      return await addDomainMember(name, user, {
        ...(kind ? { kind } : {}),
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

  // --- Branding ---

  fastify.get('/domains/:name/branding', admin, async (request, reply) => {
    const { name } = NameParamSchema.parse(request.params);
    try {
      return { branding: await getDomainBranding(name) };
    } catch (err) {
      return sendBrandingFailure(request, reply, err);
    }
  });

  fastify.put('/domains/:name/branding', admin, async (request, reply) => {
    const { name } = NameParamSchema.parse(request.params);
    const body = request.body;
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      return reply
        .code(400)
        .send({ error: 'The brand is a JSON object', code: 'invalid_branding' });
    }
    const { ifRevision, ...fields } = body;
    const revision = IfRevisionSchema.parse(ifRevision);
    try {
      return await updateDomainBranding(name, fields, {
        ...(revision !== undefined ? { ifRevision: revision } : {}),
        actor: actorFromRequest(request),
        logger: request.log,
      });
    } catch (err) {
      return sendBrandingFailure(request, reply, err);
    }
  });

  fastify.delete('/domains/:name/branding', admin, async (request, reply) => {
    const { name } = NameParamSchema.parse(request.params);
    try {
      return await removeDomainBranding(name, {
        actor: actorFromRequest(request),
        logger: request.log,
      });
    } catch (err) {
      return sendBrandingFailure(request, reply, err);
    }
  });

  fastify.put(
    '/domains/:name/branding/:kind',
    { ...admin, bodyLimit: ASSET_BODY_LIMIT },
    async (request, reply) => {
      const { name, kind } = AssetParamsSchema.parse(request.params);
      const { data, ifRevision } = AssetBodySchema.parse(request.body);
      try {
        return await setDomainBrandingAsset(name, kind, data, {
          ...(ifRevision !== undefined ? { ifRevision } : {}),
          actor: actorFromRequest(request),
          logger: request.log,
        });
      } catch (err) {
        return sendBrandingFailure(request, reply, err);
      }
    },
  );

  fastify.delete('/domains/:name/branding/:kind', admin, async (request, reply) => {
    const { name, kind } = AssetParamsSchema.parse(request.params);
    try {
      return await removeDomainBrandingAsset(name, kind, {
        actor: actorFromRequest(request),
        logger: request.log,
      });
    } catch (err) {
      return sendBrandingFailure(request, reply, err);
    }
  });

  fastify.get('/domains/:name/branding/preview', admin, async (request, reply) => {
    const { name } = NameParamSchema.parse(request.params);
    try {
      return await getDomainBrandingPreview(name);
    } catch (err) {
      return sendBrandingFailure(request, reply, err);
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

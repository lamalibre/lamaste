/**
 * Administrators' mail settings (packages/core/docs/mail-design.md §3.5):
 * the relay-wide transport and each domain's override.
 *
 *   GET    /api/settings/mail                 the relay's row — never a secret — or null
 *   PUT    /api/settings/mail                 an smtp transport, checked first
 *   PATCH  /api/settings/mail                 sender, its name, daily limit
 *   DELETE /api/settings/mail                 remove it (a Google grant revoked)
 *   POST   /api/settings/mail/google/start    Google's consent: the URL to open
 *   POST   /api/settings/mail/test            a test mail { to }
 *   POST   /api/settings/mail/resume          end a provider's limit refusal early
 *
 *   GET|PUT|PATCH|DELETE /api/domains/:name/mail, PUT …/mail/sender (a
 *   sender over the relay's transport), POST …/mail/google/start,
 *   …/mail/test, …/mail/resume — the same for a domain's override.
 *
 * Bodies are checked with safeParse: a refusal names the fields, never
 * what was sent (a password may be in it), and nothing is logged of it.
 */

import { z } from 'zod';
import {
  DomainNameSchema,
  MailGoogleStartInputSchema,
  MailSenderInputSchema,
  MailTestInputSchema,
  MailTransportPatchSchema,
  SmtpTransportInputSchema,
} from '@lamalibre/lamaste';
import { renderTestMail } from '@lamalibre/lamaste/server';

import { actorFromRequest } from '../../lib/actor.js';
import { httpError, sendFailure } from '../../lib/app-error.js';
import {
  clearMailTransport,
  getMailTransport,
  mailScope,
  patchMailTransport,
  resumeMailTransport,
  sendMail,
  setDomainMailSender,
  setSmtpTransport,
  startGoogleConsent,
} from '../../lib/mail.js';

const NameParamSchema = z.object({ name: DomainNameSchema });

/** The `:name` of a domain route — 400 `invalid_domain` for anything but a domain name. */
function domainParam(request) {
  const parsed = NameParamSchema.safeParse(request.params);
  if (!parsed.success) throw httpError('Not a domain name', 400, { code: 'invalid_domain' });
  return parsed.data.name;
}

/** The body by `schema`, or a 400 naming the fields that are wrong (no values). */
function parseBody(schema, request, reply) {
  const parsed = schema.safeParse(request.body ?? {});
  if (parsed.success) return parsed.data;
  reply.code(400).send({
    error: 'Validation failed',
    details: {
      issues: parsed.error.issues.map((issue) => ({ path: issue.path, message: issue.message })),
    },
  });
  return null;
}

/** A refusal with its code and, for a failed check, its reason class. */
function sendMailFailure(request, reply, err, fallback) {
  if (Number.isInteger(err?.statusCode) && err.statusCode < 500 && err.reason) {
    return reply
      .code(err.statusCode)
      .send({ error: err.message, code: err.code, reason: err.reason });
  }
  return sendFailure(request, reply, err, fallback);
}

/**
 * The routes of one scope: the relay's (`domainOf` answers null) or a
 * domain's (`domainOf` reads `:name`).
 */
function mailScopeRoutes(fastify, base, domainOf, { senderOnlyPut }) {
  const admin = { preHandler: fastify.requireRole(['admin']) };
  const context = (request) => ({ actor: actorFromRequest(request), logger: request.log });

  fastify.get(base, admin, async (request, reply) => {
    try {
      return await getMailTransport(domainOf(request));
    } catch (err) {
      return sendMailFailure(request, reply, err, 'Failed to read the mail settings');
    }
  });

  fastify.put(base, admin, async (request, reply) => {
    const body = parseBody(SmtpTransportInputSchema, request, reply);
    if (body === null) return reply;
    try {
      return await setSmtpTransport(domainOf(request), body, context(request));
    } catch (err) {
      return sendMailFailure(request, reply, err, 'Failed to set the mail transport');
    }
  });

  if (senderOnlyPut) {
    fastify.put(`${base}/sender`, admin, async (request, reply) => {
      const body = parseBody(MailSenderInputSchema, request, reply);
      if (body === null) return reply;
      try {
        return await setDomainMailSender(domainOf(request), body, context(request));
      } catch (err) {
        return sendMailFailure(request, reply, err, "Failed to set the domain's sender");
      }
    });
  }

  fastify.patch(base, admin, async (request, reply) => {
    const body = parseBody(MailTransportPatchSchema, request, reply);
    if (body === null) return reply;
    try {
      return await patchMailTransport(domainOf(request), body, context(request));
    } catch (err) {
      return sendMailFailure(request, reply, err, 'Failed to change the mail settings');
    }
  });

  fastify.delete(base, admin, async (request, reply) => {
    try {
      return await clearMailTransport(domainOf(request), context(request));
    } catch (err) {
      return sendMailFailure(request, reply, err, 'Failed to remove the mail transport');
    }
  });

  fastify.post(`${base}/google/start`, admin, async (request, reply) => {
    const body = parseBody(MailGoogleStartInputSchema, request, reply);
    if (body === null) return reply;
    reply.header('Cache-Control', 'no-store');
    try {
      return await startGoogleConsent(domainOf(request), body, context(request));
    } catch (err) {
      return sendMailFailure(request, reply, err, "Failed to start Google's consent");
    }
  });

  fastify.post(`${base}/test`, admin, async (request, reply) => {
    const body = parseBody(MailTestInputSchema, request, reply);
    if (body === null) return reply;
    try {
      const mail = await sendMail({
        domain: await mailScope(domainOf(request)),
        to: body.to,
        kind: 'test',
        sendClass: 'essential',
        render: ({ language, brand, sender }) => renderTestMail({ language, brand, sender }),
        logger: request.log,
      });
      return { mail };
    } catch (err) {
      return sendMailFailure(request, reply, err, 'Failed to send the test mail');
    }
  });

  fastify.post(`${base}/resume`, admin, async (request, reply) => {
    try {
      return await resumeMailTransport(domainOf(request), context(request));
    } catch (err) {
      return sendMailFailure(request, reply, err, 'Failed to resume the mail transport');
    }
  });
}

export default async function mailRoutes(fastify) {
  mailScopeRoutes(fastify, '/settings/mail', () => null, { senderOnlyPut: false });
  mailScopeRoutes(fastify, '/domains/:name/mail', domainParam, { senderOnlyPut: true });
}

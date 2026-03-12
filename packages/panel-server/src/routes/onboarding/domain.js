import { z } from 'zod';
import { getConfig, updateConfig } from '../../lib/config.js';

const DomainSchema = z.object({
  domain: z
    .string()
    .min(1)
    .regex(/^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/)
    .describe('Fully qualified domain name'),
  email: z.string().email().describe('Email for Let\'s Encrypt registration'),
});

export default async function domainRoute(fastify, _opts) {
  fastify.post('/domain', async (request, reply) => {
    const body = DomainSchema.parse(request.body);

    const config = getConfig();
    const { status } = config.onboarding;

    if (status !== 'FRESH' && status !== 'DOMAIN_SET') {
      return reply.code(409).send({
        error: 'Cannot change domain in current state',
        onboardingStatus: status,
      });
    }

    await updateConfig({
      domain: body.domain,
      email: body.email,
      onboarding: { status: 'DOMAIN_SET' },
    });

    return { ok: true, domain: body.domain, email: body.email };
  });
}

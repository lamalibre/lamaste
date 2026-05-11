import { getConfig } from '../lib/config.js';

/**
 * Fastify onRequest hook that blocks access when onboarding is already completed.
 * Used to protect onboarding routes.
 */
export function onboardingOnly() {
  return async function onboardingOnlyHook(_request, reply) {
    const config = getConfig();
    if (config.onboarding.status === 'COMPLETED') {
      return reply.code(410).send({ error: 'Onboarding already completed' });
    }
  };
}

/**
 * Fastify onRequest hook that blocks access when onboarding is not yet completed.
 * Used to protect management routes.
 */
export function managementOnly() {
  return async function managementOnlyHook(_request, reply) {
    const config = getConfig();
    if (config.onboarding.status !== 'COMPLETED') {
      return reply.code(503).send({
        error: 'Onboarding not complete',
        onboardingStatus: config.onboarding.status,
      });
    }
  };
}

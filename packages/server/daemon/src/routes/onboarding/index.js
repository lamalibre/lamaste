import { onboardingOnly } from '../../middleware/onboarding-guard.js';
import statusRoute from './status.js';
import domainRoute from './domain.js';
import dnsRoute from './dns.js';
import provisionRoute from './provision.js';

export default async function onboardingRoutes(fastify, _opts) {
  // Status endpoint is always accessible — no guard
  await fastify.register(statusRoute);

  // All other onboarding routes are guarded: return 410 after onboarding completes
  await fastify.register(async function guarded(app) {
    app.addHook('onRequest', onboardingOnly());
    await app.register(domainRoute);
    await app.register(dnsRoute);
    await app.register(provisionRoute);
  });
}

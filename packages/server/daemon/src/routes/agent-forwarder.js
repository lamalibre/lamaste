/**
 * `/api/<route>/*` for agent-hosted plugins with an agent half — forwarded
 * by the panel to the plugin's agent half over its internal tunnel, through
 * the plugin's approved request hooks (`request:pre-forward` /
 * `request:post-forward`). While its hosting is down nothing is forwarded:
 * its `tunnel:down` fallback answers, or `502` with the reason
 * (`resolveForwardTarget`). See `createHookedForwarder` in
 * `@lamalibre/lamaste/server`.
 *
 * Registered after every other `/api` route: static routes win over its
 * `/:route/*`, so only what nothing else answers arrives here, and a route
 * that is no hosted plugin gets the panel's usual 404.
 */
import { createHookedForwarder } from '@lamalibre/lamaste/server';
import { getConfig } from '../lib/config.js';
import { resolveForwardTarget, authorizeForwardedCaller } from '../lib/plugin-hosting.js';
import { requestHookRuntime } from '../lib/request-hooks.js';

export default async function agentForwarderRoutes(fastify) {
  const forwarder = createHookedForwarder({
    resolveTarget: resolveForwardTarget,
    authorize: authorizeForwardedCaller,
    // Management routes answer 503 before onboarding completes; so does a
    // hosted plugin's route (but a non-route stays a 404, as before).
    guard: () => {
      const config = getConfig();
      if (config.onboarding.status !== 'COMPLETED') {
        return {
          status: 503,
          body: { error: 'Onboarding not complete', onboardingStatus: config.onboarding.status },
        };
      }
      return null;
    },
    logger: fastify.log,
    hooks: requestHookRuntime,
  });
  await fastify.register(forwarder);
}

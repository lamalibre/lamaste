/**
 * `/api/<route>/*` for agent-hosted plugins with an agent half — forwarded
 * by the panel to the plugin's agent half over its internal tunnel. See
 * `agentForwarderPlugin` in `@lamalibre/lamaste/server`.
 *
 * Registered after every other `/api` route: static routes win over its
 * `/:route/*`, so only what nothing else answers arrives here, and a route
 * that is no hosted plugin gets the panel's usual 404.
 */
import { agentForwarderPlugin } from '@lamalibre/lamaste/server';
import { getConfig } from '../lib/config.js';
import { resolveForwardTarget, authorizeForwardedCaller } from '../lib/plugin-hosting.js';

export default async function agentForwarderRoutes(fastify) {
  await fastify.register(agentForwarderPlugin, {
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
  });
}

import dns from 'node:dns/promises';
import { getConfig, updateConfig } from '../../lib/config.js';

/**
 * Resolve A records for a hostname, returning an empty array on expected DNS errors.
 */
async function resolveA(hostname) {
  try {
    return await dns.resolve4(hostname);
  } catch (err) {
    if (err.code === 'ENOTFOUND' || err.code === 'ENODATA' || err.code === 'ETIMEOUT') {
      return [];
    }
    throw err;
  }
}

/**
 * Build a human-readable diagnostic message for the DNS verification result.
 */
function buildMessage({ domain, expectedIp, baseOk, wildcardOk, resolvedIps }) {
  if (baseOk && wildcardOk) {
    return 'DNS is correctly configured. Both base domain and wildcard resolve to your server.';
  }
  if (baseOk && !wildcardOk) {
    return 'Base domain resolves correctly. Wildcard DNS is not configured — you will need to add individual subdomain records for each tunnel.';
  }
  if (!baseOk && resolvedIps.length > 0) {
    return `Domain resolves to ${resolvedIps.join(', ')} but your server IP is ${expectedIp}. Please update your A record.`;
  }
  return `Domain does not resolve yet. Please add an A record pointing ${domain} to ${expectedIp}. DNS propagation can take up to 48 hours, but usually completes within minutes.`;
}

export default async function dnsRoute(fastify, _opts) {
  fastify.post('/verify-dns', async (request, reply) => {
    const config = getConfig();
    const { status } = config.onboarding;

    if (status !== 'DOMAIN_SET' && status !== 'DNS_READY') {
      return reply.code(409).send({
        error: 'Domain must be set before DNS verification',
        onboardingStatus: status,
      });
    }

    const { domain, ip: expectedIp } = config;

    const [resolvedIps, wildcardResolvedIps] = await Promise.all([
      resolveA(domain),
      resolveA(`test-lamaste-check.${domain}`),
    ]);

    const baseOk = resolvedIps.includes(expectedIp);
    const wildcardOk = wildcardResolvedIps.includes(expectedIp);
    const ok = baseOk;

    if (ok) {
      await updateConfig({ onboarding: { status: 'DNS_READY' } });
    }

    const message = buildMessage({ domain, expectedIp, baseOk, wildcardOk, resolvedIps });

    return {
      ok,
      domain,
      resolvedIps,
      expectedIp,
      wildcardOk,
      wildcardResolvedIps,
      message,
    };
  });
}

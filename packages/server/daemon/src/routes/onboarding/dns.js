import dns from 'node:dns/promises';
import { CORE_SUBDOMAINS } from '@lamalibre/lamaste';
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
function buildMessage({ domain, expectedIp, records, wildcardOk, apexOk }) {
  const failing = records.filter((r) => !r.ok);
  if (failing.length > 0) {
    const details = failing
      .map((r) =>
        r.resolvedIps.length > 0
          ? `${r.name} resolves to ${r.resolvedIps.join(', ')}`
          : `${r.name} does not resolve`,
      )
      .join('; ');
    return `${details}. Point ${failing.map((r) => r.name).join(', ')} (or a wildcard *.${domain}) at ${expectedIp}. DNS propagation can take up to 48 hours, but usually completes within minutes.`;
  }

  const notes = [];
  if (!wildcardOk) {
    notes.push(
      'Wildcard DNS is not configured — you will need to add individual subdomain records for each tunnel.',
    );
  }
  if (!apexOk) {
    notes.push(
      `${domain} itself does not point to this server — that is only needed to serve a site on it.`,
    );
  }
  return ['DNS is correctly configured. panel, auth and tunnel resolve to your server.', ...notes]
    .join(' ')
    .trim();
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

    // Onboarding issues certificates for the core subdomains only, so those
    // are the names that must resolve here. The apex is reported but not
    // required: it may still belong to another host until a site is put on it.
    const coreNames = CORE_SUBDOMAINS.map((sub) => `${sub}.${domain}`);
    const [coreResolved, apexResolvedIps, wildcardResolvedIps] = await Promise.all([
      Promise.all(coreNames.map((name) => resolveA(name))),
      resolveA(domain),
      resolveA(`test-lamaste-check.${domain}`),
    ]);

    const records = coreNames.map((name, i) => {
      const resolvedIps = coreResolved[i] ?? [];
      return { name, resolvedIps, ok: resolvedIps.includes(expectedIp) };
    });
    const ok = records.every((r) => r.ok);
    const apexOk = apexResolvedIps.includes(expectedIp);
    const wildcardOk = wildcardResolvedIps.includes(expectedIp);

    if (ok) {
      await updateConfig({ onboarding: { status: 'DNS_READY' } });
    }

    const message = buildMessage({ domain, expectedIp, records, wildcardOk, apexOk });

    return {
      ok,
      domain,
      expectedIp,
      records,
      apexOk,
      apexResolvedIps,
      wildcardOk,
      wildcardResolvedIps,
      message,
    };
  });
}

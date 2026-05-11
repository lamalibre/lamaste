import fp from 'fastify-plugin';
import { isRevoked } from '../lib/revocation.js';
import { getAgentCapabilities, getAgentAllowedSites, PLUGIN_AGENT_CN_PREFIX } from '../lib/mtls.js';

let devWarningLogged = false;

async function mtlsPlugin(fastify, _opts) {
  fastify.addHook('onRequest', async (request, reply) => {
    // Health check endpoint is always accessible without mTLS
    // (used by systemd, load balancers, and internal provisioning checks)
    if (request.url === '/api/health') {
      request.certRole = 'admin';
      request.certLabel = null;
      request.certCapabilities = null;
      request.certAllowedSites = null;
      return;
    }

    const isDev = process.env.NODE_ENV === 'development';

    if (isDev) {
      if (!devWarningLogged) {
        request.log.warn('mTLS verification bypassed — running in development mode');
        devWarningLogged = true;
      }
      request.certRole = 'admin';
      request.certLabel = null;
      request.certCapabilities = null;
      request.certAllowedSites = null;
      return;
    }

    const clientVerify = request.headers['x-ssl-client-verify'];

    if (clientVerify !== 'SUCCESS') {
      return reply.code(403).send({
        error: 'mTLS certificate required',
        details: {
          hint: 'Access to the Lamaste panel requires a valid client certificate.',
        },
      });
    }

    // Check certificate serial against revocation list
    const serial = request.headers['x-ssl-client-serial'];
    if (serial && (await isRevoked(serial))) {
      return reply.code(403).send({
        error: 'Certificate has been revoked',
      });
    }

    // Parse the certificate DN to extract role
    const dn = request.headers['x-ssl-client-dn'] || '';
    const cnMatch = dn.match(/CN=([^,]+)/);
    const cn = cnMatch ? cnMatch[1] : '';

    if (cn.startsWith(PLUGIN_AGENT_CN_PREFIX)) {
      // Plugin-agent: CN = plugin-agent:<delegatingLabel>:<pluginAgentLabel>
      // certLabel includes the full CN so it matches the registry label
      request.certRole = 'plugin-agent';
      request.certLabel = cn;
      // Extract the delegating agent label
      const afterPrefix = cn.slice(PLUGIN_AGENT_CN_PREFIX.length);
      const colonIndex = afterPrefix.indexOf(':');
      request.certDelegatedBy = colonIndex !== -1 ? afterPrefix.slice(0, colonIndex) : afterPrefix;
      try {
        request.certCapabilities = await getAgentCapabilities(cn);
      } catch (err) {
        request.log.warn(
          { err, label: cn },
          'Failed to load plugin-agent capabilities, using defaults',
        );
        request.certCapabilities = [];
      }
      try {
        request.certAllowedSites = await getAgentAllowedSites(cn);
      } catch (err) {
        request.log.warn(
          { err, label: cn },
          'Failed to load plugin-agent allowed sites, using defaults',
        );
        request.certAllowedSites = [];
      }
    } else if (cn.startsWith('agent:')) {
      request.certRole = 'agent';
      request.certLabel = cn.slice('agent:'.length);
      try {
        request.certCapabilities = await getAgentCapabilities(request.certLabel);
      } catch (err) {
        request.log.warn(
          { err, label: request.certLabel },
          'Failed to load agent capabilities, using defaults',
        );
        request.certCapabilities = ['tunnels:read'];
      }
      try {
        request.certAllowedSites = await getAgentAllowedSites(request.certLabel);
      } catch (err) {
        request.log.warn(
          { err, label: request.certLabel },
          'Failed to load agent allowed sites, using defaults',
        );
        request.certAllowedSites = [];
      }
    } else if (cn === 'admin') {
      request.certRole = 'admin';
      request.certLabel = null;
      request.certCapabilities = null;
      request.certAllowedSites = null;
    } else {
      // Defense-in-depth: nginx is the primary gate, but never grant any role
      // for an unrecognized CN (formerly defaulted to admin — privilege-escalation
      // hazard if nginx config drifts).
      request.log.warn({ cn, dn }, 'Rejecting unrecognized CN');
      return reply.code(403).send({ error: 'Unrecognized client certificate' });
    }
  });
}

export default fp(mtlsPlugin);

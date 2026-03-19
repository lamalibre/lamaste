import fp from 'fastify-plugin';
import { isRevoked } from '../lib/revocation.js';
import { getAgentCapabilities, getAgentAllowedSites } from '../lib/mtls.js';

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
          hint: 'Access to the Portlama panel requires a valid client certificate.',
        },
      });
    }

    // Check certificate serial against revocation list
    const serial = request.headers['x-ssl-client-serial'];
    if (serial && await isRevoked(serial)) {
      return reply.code(403).send({
        error: 'Certificate has been revoked',
      });
    }

    // Parse the certificate DN to extract role
    const dn = request.headers['x-ssl-client-dn'] || '';
    const cnMatch = dn.match(/CN=([^,]+)/);
    const cn = cnMatch ? cnMatch[1] : '';

    if (cn.startsWith('agent:')) {
      request.certRole = 'agent';
      request.certLabel = cn.slice('agent:'.length);
      try {
        request.certCapabilities = await getAgentCapabilities(request.certLabel);
      } catch (err) {
        request.log.warn({ err, label: request.certLabel }, 'Failed to load agent capabilities, using defaults');
        request.certCapabilities = ['tunnels:read'];
      }
      try {
        request.certAllowedSites = await getAgentAllowedSites(request.certLabel);
      } catch (err) {
        request.log.warn({ err, label: request.certLabel }, 'Failed to load agent allowed sites, using defaults');
        request.certAllowedSites = [];
      }
    } else {
      request.certRole = 'admin';
      request.certLabel = null;
      request.certCapabilities = null;
      request.certAllowedSites = null;
    }
  });
}

export default fp(mtlsPlugin);

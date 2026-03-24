import { managementOnly } from '../middleware/onboarding-guard.js';
import systemRoutes from './management/system.js';
import servicesRoutes from './management/services.js';
import logsRoutes from './management/logs.js';
import usersRoutes from './management/users.js';
import certsRoutes from './management/certs.js';
import tunnelRoutes from './management/tunnels.js';
import sitesRoutes from './management/sites.js';
import invitationRoutes from './management/invitations.js';
import pluginRoutes from './management/plugins.js';

export default async function managementRoutes(fastify, _opts) {
  fastify.addHook('onRequest', managementOnly());

  await fastify.register(tunnelRoutes);
  await fastify.register(sitesRoutes);
  await fastify.register(systemRoutes);
  await fastify.register(servicesRoutes);
  await fastify.register(logsRoutes);
  await fastify.register(usersRoutes);
  await fastify.register(certsRoutes);
  await fastify.register(invitationRoutes);
  await fastify.register(pluginRoutes);
}

import fp from 'fastify-plugin';

/**
 * Role guard plugin — decorates fastify with `requireRole(allowedRoles, opts)`.
 *
 * Returns a preHandler function that checks `request.certRole` against
 * the provided allowedRoles array. For agent roles, optionally checks
 * `request.certCapabilities` for a required capability.
 *
 * Usage:
 *   fastify.requireRole(['admin'])                                    — admin only
 *   fastify.requireRole(['admin', 'agent'])                           — admin + any agent
 *   fastify.requireRole(['admin', 'agent'], { capability: 'tunnels:write' }) — admin + agents with capability
 */
function roleGuard(fastify, _opts, done) {
  fastify.decorate('requireRole', function (allowedRoles, opts) {
    const { capability } = opts || {};

    return async function (request, reply) {
      const role = request.certRole || 'unknown';

      // Admin always passes — no capability check needed
      if (role === 'admin') return;

      // Check if the role is in the allowed list
      if (!allowedRoles.includes(role)) {
        return reply.code(403).send({
          error: 'Insufficient certificate scope',
          details: {
            required: allowedRoles,
            current: role,
          },
        });
      }

      // If a capability is required, check the agent has it
      if (capability && role === 'agent') {
        const caps = request.certCapabilities || [];
        if (!caps.includes(capability)) {
          return reply.code(403).send({
            error: 'Insufficient certificate capability',
            details: {
              required: capability,
              granted: caps,
            },
          });
        }
      }
    };
  });
  done();
}

export default fp(roleGuard, { name: 'role-guard' });

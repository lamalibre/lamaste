import fp from 'fastify-plugin';

/**
 * Global error handler plugin for Fastify.
 *
 * Every error response follows this contract:
 *
 *   {
 *     error: string;          // Always present. Human-readable error summary.
 *     details?: object;       // Optional. Additional structured information.
 *   }
 *
 * Wrapped with fastify-plugin to break encapsulation — the handler applies
 * to all routes, not just those registered in the same plugin context.
 */
async function errorHandlerPlugin(fastify, _opts) {
  fastify.setErrorHandler((error, request, reply) => {
    request.log.error(error);

    const isDev = !process.env.NODE_ENV || process.env.NODE_ENV === 'development';

    // Zod validation errors
    if (error.name === 'ZodError' || Array.isArray(error.issues)) {
      const issues = error.issues.map((issue) => ({
        path: issue.path,
        message: issue.message,
      }));

      return reply.code(400).send({
        error: 'Validation failed',
        details: { issues },
      });
    }

    // Operational errors (AppError)
    if (error.isOperational === true) {
      const body = { error: error.message };
      if (error.details !== null && error.details !== undefined) {
        body.details = error.details;
      }
      return reply.code(error.statusCode).send(body);
    }

    // Fastify built-in errors (malformed JSON, missing content-type, etc.)
    if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
      return reply.code(error.statusCode).send({
        error: error.message,
      });
    }

    // Unexpected errors — never leak internals in production
    const body = { error: 'Internal server error' };
    if (isDev) {
      body.details = {
        message: error.message,
        stack: error.stack,
      };
    }
    return reply.code(500).send(body);
  });
}

export default fp(errorHandlerPlugin);

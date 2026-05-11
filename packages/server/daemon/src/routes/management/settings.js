import { z } from 'zod';
import { getConfig, updateConfig } from '../../lib/config.js';
import { generateAdminTotpSecret, verifyTotp } from '../../lib/totp.js';
import {
  createSessionCookie,
  ensureSessionSecret,
  COOKIE_NAME,
  COOKIE_OPTIONS,
} from '../../lib/session.js';
import { disableIpVhost, enableIpVhost } from '../../lib/nginx.js';

// ---------------------------------------------------------------------------
// Rate limiting — in-memory, keyed by IP
// ---------------------------------------------------------------------------

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 2 * 60 * 1000; // 2 minutes
const BAN_MS = 5 * 60 * 1000; // 5 minutes
const MAX_ENTRIES = 1000;

/** @type {Map<string, { attempts: number[], bannedUntil: number | null }>} */
const rateLimitMap = new Map();

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry) {
    // Don't allocate until a failed attempt is recorded
    return { allowed: true };
  }

  // Check ban
  if (entry.bannedUntil && now < entry.bannedUntil) {
    const retryAfter = Math.ceil((entry.bannedUntil - now) / 1000);
    return { allowed: false, retryAfter };
  }

  // Clear expired ban
  if (entry.bannedUntil && now >= entry.bannedUntil) {
    rateLimitMap.delete(ip);
    return { allowed: true };
  }

  // Prune old attempts outside window
  entry.attempts = entry.attempts.filter((t) => now - t < WINDOW_MS);

  if (entry.attempts.length === 0) {
    rateLimitMap.delete(ip);
    return { allowed: true };
  }

  if (entry.attempts.length >= MAX_ATTEMPTS) {
    entry.bannedUntil = now + BAN_MS;
    const retryAfter = Math.ceil(BAN_MS / 1000);
    return { allowed: false, retryAfter };
  }

  return { allowed: true };
}

function recordAttempt(ip) {
  let entry = rateLimitMap.get(ip);
  if (!entry) {
    // Sweep stale entries if map grows too large
    if (rateLimitMap.size >= MAX_ENTRIES) {
      const now = Date.now();
      for (const [key, val] of rateLimitMap) {
        val.attempts = val.attempts.filter((t) => now - t < WINDOW_MS);
        if (val.attempts.length === 0 && (!val.bannedUntil || now >= val.bannedUntil)) {
          rateLimitMap.delete(key);
        }
      }
      // If still at capacity after sweep, evict the oldest entry
      if (rateLimitMap.size >= MAX_ENTRIES) {
        const oldest = rateLimitMap.keys().next().value;
        rateLimitMap.delete(oldest);
      }
    }
    entry = { attempts: [], bannedUntil: null };
    rateLimitMap.set(ip, entry);
  }
  entry.attempts.push(Date.now());
}

// ---------------------------------------------------------------------------
// Helper to set the session cookie on a reply
// ---------------------------------------------------------------------------

function setSessionCookie(request, reply, sessionSecret) {
  const certSerial = request.headers['x-ssl-client-serial'] || undefined;
  const session = createSessionCookie(sessionSecret, certSerial);
  reply.setCookie(COOKIE_NAME, session.value, {
    ...COOKIE_OPTIONS,
    maxAge: session.maxAge,
  });
}

// ---------------------------------------------------------------------------
// Shared TOTP validation: rate limit + parse + verify
// ---------------------------------------------------------------------------

const CodeSchema = z.object({
  code: z.string().regex(/^\d{6}$/, 'Code must be exactly 6 digits'),
});

/**
 * Common rate-limit + code-parse + TOTP-verify sequence.
 * Returns the parsed code on success, or sends an error reply and returns null.
 */
async function validateTotpCode(request, reply) {
  const ip = request.ip;
  const limit = checkRateLimit(ip);
  if (!limit.allowed) {
    reply.code(429).send({
      error: 'Too many attempts. Try again later.',
      retryAfter: limit.retryAfter,
    });
    return null;
  }

  let body;
  try {
    body = CodeSchema.parse(request.body);
  } catch {
    reply.code(400).send({ error: 'Code must be exactly 6 digits' });
    return null;
  }
  const config = getConfig();

  if (!config.panel2fa?.secret) {
    reply.code(400).send({ error: '2FA secret not configured' });
    return null;
  }

  if (!verifyTotp(config.panel2fa.secret, body.code)) {
    recordAttempt(ip);
    reply.code(401).send({ error: 'Invalid TOTP code' });
    return null;
  }

  return body.code;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export default async function settingsRoutes(fastify, _opts) {
  // GET /settings/2fa — return current 2FA status (exempt from 2FA session)
  fastify.get(
    '/settings/2fa',
    { preHandler: fastify.requireRole(['admin']) },
    async (_request, _reply) => {
      const config = getConfig();
      const panel2fa = config.panel2fa || { enabled: false, setupComplete: false };
      return {
        enabled: panel2fa.enabled,
        setupComplete: panel2fa.setupComplete,
      };
    },
  );

  // POST /settings/2fa/setup — generate TOTP secret
  fastify.post(
    '/settings/2fa/setup',
    { preHandler: fastify.requireRole(['admin']) },
    async (_request, reply) => {
      const config = getConfig();

      if (!config.domain) {
        return reply.code(400).send({
          error: 'Domain must be configured before enabling 2FA',
          details: {
            hint: 'Enabling 2FA disables IP:9292 access. A domain is required.',
          },
        });
      }

      if (config.panel2fa?.enabled && config.panel2fa?.setupComplete) {
        return reply.code(409).send({
          error: '2FA is already enabled',
        });
      }

      const { secret, uri } = generateAdminTotpSecret();

      await updateConfig({
        panel2fa: {
          enabled: false,
          secret,
          setupComplete: false,
        },
      });

      return { uri, manualKey: secret };
    },
  );

  // POST /settings/2fa/confirm — verify initial code and enable 2FA
  fastify.post(
    '/settings/2fa/confirm',
    {
      preHandler: fastify.requireRole(['admin']),
      // Strict tier — TOTP confirmation is auth-adjacent. The in-file
      // checkRateLimit/recordAttempt path also throttles per-IP failed
      // attempts, but the global Fastify limiter caps total request
      // volume regardless of TOTP outcome.
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const config = getConfig();

      if (!config.panel2fa?.secret) {
        return reply.code(400).send({
          error: 'No 2FA setup in progress. Call POST /settings/2fa/setup first.',
        });
      }

      if (config.panel2fa.enabled && config.panel2fa.setupComplete) {
        return reply.code(409).send({ error: '2FA is already enabled' });
      }

      const code = await validateTotpCode(request, reply);
      if (code === null) return;

      // Enable 2FA
      const sessionSecret = await ensureSessionSecret();

      await updateConfig({
        panel2fa: {
          enabled: true,
          secret: config.panel2fa.secret,
          setupComplete: true,
        },
      });

      // Disable IP vhost
      try {
        await disableIpVhost();
      } catch (err) {
        // Rollback 2FA on nginx failure
        await updateConfig({
          panel2fa: { enabled: false, secret: null, setupComplete: false },
        });
        request.log.error({ err }, 'Failed to disable IP vhost during 2FA enable');
        return reply.code(500).send({
          error: 'Failed to disable IP vhost. 2FA was not enabled.',
        });
      }

      // Issue session cookie
      setSessionCookie(request, reply, sessionSecret);

      return { enabled: true };
    },
  );

  // POST /settings/2fa/verify — verify code and issue session (exempt from 2FA session)
  fastify.post(
    '/settings/2fa/verify',
    {
      preHandler: fastify.requireRole(['admin']),
      // Strict tier — direct TOTP brute-force surface. The TOTP-specific
      // ban after 5 invalid codes still applies; this cap bounds the
      // total request volume per IP.
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const config = getConfig();

      if (!config.panel2fa?.enabled || !config.panel2fa?.secret) {
        return reply.code(400).send({ error: '2FA is not enabled' });
      }

      const code = await validateTotpCode(request, reply);
      if (code === null) return;

      const sessionSecret = await ensureSessionSecret();
      setSessionCookie(request, reply, sessionSecret);

      return { verified: true };
    },
  );

  // POST /settings/2fa/disable — disable 2FA (requires valid session + code)
  fastify.post(
    '/settings/2fa/disable',
    {
      preHandler: fastify.requireRole(['admin']),
      // Strict tier — disabling 2FA weakens auth posture; treat with the
      // same ceiling as the other 2FA endpoints.
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const config = getConfig();

      if (!config.panel2fa?.enabled || !config.panel2fa?.secret) {
        return reply.code(400).send({ error: '2FA is not enabled' });
      }

      const code = await validateTotpCode(request, reply);
      if (code === null) return;

      // Disable 2FA
      await updateConfig({
        panel2fa: { enabled: false, secret: null, setupComplete: false },
        sessionSecret: null,
      });

      // Re-enable IP vhost
      try {
        await enableIpVhost();
      } catch (err) {
        request.log.error({ err }, 'Failed to re-enable IP vhost during 2FA disable');
        // 2FA is already disabled in config — warn but don't fail
      }

      // Clear session cookie
      reply.clearCookie(COOKIE_NAME, COOKIE_OPTIONS);

      return { enabled: false };
    },
  );
}

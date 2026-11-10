/**
 * The inviter's API — `/api/delegated-invitations/<route>` and
 * `…/<route>/<invitation id>` on the sign-in host of the plugin's domain
 * (`auth.<domain>`), which nginx sends here once Gatekeeper has vouched for
 * the session's user (delegated-invitations-design.md §5). The inviter's
 * page is Lamaste's (core `renderInvitationsPage`), on another origin than
 * the plugin's site: nothing the plugin serves can script it, read these
 * answers or ask for an invitation.
 *
 * A context of its own on the panel's root instance, like the user
 * surfaces': no mTLS, no 2FA session, no role guard — a relay assertion of
 * the inviter's kind, bound to the method, the raw request target and the
 * domain, and nothing else of the request is trusted. Then, in order:
 * `Sec-Fetch-Site` (absent, `same-origin`, or `none` for a `GET`); the
 * assertion; the plugin on the route and its domain the assertion's;
 * `Origin` exactly `https://auth.<domain>` for a change (`auth.<d>` and the
 * plugin's site are same-site — only the origin tells them apart); the
 * directory's user for the plugin (`resolveUserCaller`: active, entitled,
 * identity ready). Its own JSON parser limit, its own rate limit, no CORS,
 * no caching; logs metadata only, never an address.
 */

import {
  DELEGATED_INVITATIONS_API_PREFIX,
  DELEGATED_INVITATIONS_BODY_LIMIT,
  DelegatedInvitationRequestSchema,
  refusedField,
} from '@lamalibre/lamaste';

import errorHandler from '../middleware/errors.js';
import { managementOnly } from '../middleware/onboarding-guard.js';
import { sendFailure } from '../lib/app-error.js';
import {
  createDelegatedInvitation,
  getInvitationPolicy,
  invitationSurface,
  inviterItem,
  inviterView,
  reissueOwnInvitation,
  revokeOwnInvitation,
} from '../lib/delegated-invitations.js';
import { mailInvitation } from '../lib/invitation-mail.js';
import { getInvitation } from '../lib/invitations.js';
import { pluginDomainName } from '../lib/domains.js';
import { findPluginByRoute } from '../lib/plugins.js';
import { resolveUserCaller } from '../lib/user-caller.js';
import { verifyInvitationsRelay } from '../lib/user-surface.js';

/** One inviter makes a few invitations a minute; the page reads its list after each. */
const INVITER_RATE_LIMIT = { max: 60, timeWindow: '1 minute' };

const RESPONSE_HEADERS = Object.freeze({
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Cross-Origin-Resource-Policy': 'same-origin',
});

const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A route, plugin or invitation that is not the caller's to see: one answer. */
const NOT_FOUND = Object.freeze({ error: 'Not found', code: 'not_found' });

/** Whether a request's `Sec-Fetch-Site` lets it in: its own page, or (a read) typed in. */
function fetchSiteAllowed(request) {
  const site = request.headers['sec-fetch-site'];
  if (site === undefined || site === 'same-origin') return true;
  return site === 'none' && request.method === 'GET';
}

/**
 * Who is asking and for which plugin, or the refusal already sent.
 *
 * @returns {Promise<{ plugin: object, caller: { userId: string, username: string, roles: string[] }, domain: string } | null>}
 */
async function inviterOf(request, reply, deps) {
  const { route } = request.params;
  if (!fetchSiteAllowed(request)) {
    reply.code(403).send({ error: 'cross-site request refused' });
    return null;
  }
  const relay = await deps.verifyRelay(request);
  if (!relay.ok || relay.route !== route) {
    reply.code(401).send({ error: 'unauthenticated' });
    return null;
  }
  const plugin = await findPluginByRoute(route);
  if (!plugin?.identity) {
    reply.code(404).send(NOT_FOUND);
    return null;
  }
  const domain = await pluginDomainName(plugin);
  if (relay.domain !== domain) {
    reply.code(404).send(NOT_FOUND);
    return null;
  }
  if (request.method !== 'GET' && request.headers.origin !== `https://auth.${domain}`) {
    reply.code(403).send({ error: 'cross-origin request refused' });
    return null;
  }
  const resolution = await deps.resolveUserCaller(route, relay.username);
  if (!resolution.ok) {
    reply.code(resolution.status).send({ error: resolution.error });
    return null;
  }
  return { plugin, caller: resolution.caller, domain };
}

/** Whether the plugin can be invited into now; the reason goes to the log only. */
async function available(request, plugin) {
  const [policy, surface] = await Promise.all([
    getInvitationPolicy(plugin.name),
    invitationSurface(plugin),
  ]);
  if (policy.enabled && surface.ok) return surface;
  request.log.info(
    { plugin: plugin.name, reason: policy.enabled ? surface.reason : 'policy_disabled' },
    'Delegated invitations unavailable',
  );
  return null;
}

/**
 * Mail a made or reissued invitation's link, then answer it: the
 * invitation as its inviter sees it (with its mail's outcome), the link
 * once, and what became of the mail.
 */
async function mailedAnswer(plugin, made, logger) {
  const mail = await mailInvitation(made.invitation, made.token, {
    sendClass: 'public',
    plugin,
    logger,
  });
  const labels = new Map(plugin.identity.roles.map((r) => [r.id, r.label]));
  // As it is now: with its mail's outcome recorded.
  const invitation = (await getInvitation(made.invitation.id)) ?? made.invitation;
  return { invitation: inviterItem(invitation, labels), inviteUrl: made.inviteUrl, mail };
}

/** A refusal; a cap's names the cap (`inviter` or `plugin`) for the page's words. */
function capsAwareFailure(request, reply, err, message) {
  if (err.code === 'invitation_cap') {
    return reply.code(409).send({ error: err.message, code: err.code, cap: err.cap });
  }
  return sendFailure(request, reply, err, message);
}

async function inviterRoutes(fastify, { deps }) {
  const routeOptions = {
    bodyLimit: DELEGATED_INVITATIONS_BODY_LIMIT,
    config: { rateLimit: INVITER_RATE_LIMIT, cors: false },
  };
  const unavailable = (reply) =>
    reply
      .code(403)
      .send({ error: 'Invitations are not available here', code: 'invitations_unavailable' });

  // GET /<route> — the roles the inviter may give, the bounds, their own invitations
  fastify.get('/:route', routeOptions, async (request, reply) => {
    const who = await inviterOf(request, reply, deps);
    if (!who) return reply;
    const surface = await available(request, who.plugin);
    if (!surface) return unavailable(reply);
    const view = await inviterView(who.plugin, who.caller);
    return {
      plugin: {
        displayName: who.plugin.displayName ?? who.plugin.route,
        siteUrl: `https://${surface.site.fqdn}/`,
      },
      ...view,
    };
  });

  // POST /<route> { email, displayName?, role } — a new invitation; its link once
  fastify.post('/:route', routeOptions, async (request, reply) => {
    const who = await inviterOf(request, reply, deps);
    if (!who) return reply;
    if (!(await available(request, who.plugin))) return unavailable(reply);
    const parsed = DelegatedInvitationRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      const field = refusedField(parsed.error);
      return reply.code(400).send({
        error: field ? `Invalid ${field}` : 'Invalid request',
        code: 'invalid_request',
        ...(field ? { field } : {}),
      });
    }
    try {
      const made = await createDelegatedInvitation(who.plugin, who.caller, parsed.data, {
        logger: request.log,
      });
      request.log.info(
        { plugin: who.plugin.name, inviter: `user:${who.caller.userId}` },
        'Delegated invitation made',
      );
      return reply.code(201).send(await mailedAnswer(who.plugin, made, request.log));
    } catch (err) {
      return capsAwareFailure(request, reply, err, 'Failed to make the invitation');
    }
  });

  // POST /<route>/<id>/reissue — a new link for the caller's own pending
  // invitation (an expired one too): the old link stops working
  fastify.post('/:route/:id/reissue', routeOptions, async (request, reply) => {
    const who = await inviterOf(request, reply, deps);
    if (!who) return reply;
    if (!ID_RE.test(request.params.id)) return reply.code(404).send(NOT_FOUND);
    try {
      const made = await reissueOwnInvitation(who.plugin, who.caller, request.params.id, {
        logger: request.log,
      });
      return await mailedAnswer(who.plugin, made, request.log);
    } catch (err) {
      return capsAwareFailure(request, reply, err, 'Failed to give the invitation a new link');
    }
  });

  // DELETE /<route>/<id> — the caller's own pending invitation
  fastify.delete('/:route/:id', routeOptions, async (request, reply) => {
    const who = await inviterOf(request, reply, deps);
    if (!who) return reply;
    if (!ID_RE.test(request.params.id)) return reply.code(404).send(NOT_FOUND);
    try {
      await revokeOwnInvitation(who.plugin, who.caller, request.params.id, {
        logger: request.log,
      });
      return { ok: true };
    } catch (err) {
      return sendFailure(request, reply, err, 'Failed to revoke the invitation');
    }
  });
}

/**
 * The inviter's context. Register it on the panel's root instance (not
 * inside another context): it must not inherit the protected context's
 * hooks.
 *
 * @param {import('fastify').FastifyInstance} app
 */
export default async function delegatedInvitationsContext(app, opts = {}) {
  // Tests replace the relay check and the caller's resolution.
  const deps = {
    verifyRelay: opts.verifyRelay ?? verifyInvitationsRelay,
    resolveUserCaller: opts.resolveUserCaller ?? resolveUserCaller,
  };
  app.addHook('onRequest', async (_request, reply) => {
    reply.headers(RESPONSE_HEADERS);
  });
  app.addHook('onRequest', managementOnly());
  await app.register(errorHandler);
  await app.register(inviterRoutes, { prefix: DELEGATED_INVITATIONS_API_PREFIX, deps });
}

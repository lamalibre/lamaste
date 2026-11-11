/**
 * Mailing an invitation's link (packages/core/docs/mail-design.md §6.1):
 * the administrator's and delegated ones, when made and when given a new
 * link. The link is answered to whoever made it either way (they may share
 * it another way); the mail is extra, and what became of it is recorded on
 * the invitation while that link is still its link.
 *
 * Called after the invitations lock is released — sending takes up to 30 s
 * and the lock is a leaf (CLAUDE.md, delegated invitations): never held
 * across a mail.
 */

import { renderInvitationMail } from '@lamalibre/lamaste/server';
import { parseMailAddress } from '@lamalibre/lamaste';

import { getDirectoryUser } from './directory.js';
import { invitationMemberships, invitationSignInDomain } from './domains.js';
import { hashInvitationToken, recordInvitationMail } from './invitations.js';
import { sendMail } from './mail.js';

/**
 * The domain whose sign-in host opens the invitation: a delegated one's only
 * on its own domain's (the panel answers it nowhere else), an
 * administrator's on the first of its domains that serves.
 */
async function invitationDomain(invitation) {
  if (invitation.kind === 'delegated') {
    return invitationMemberships(invitation)[0]?.name ?? null;
  }
  return invitationSignInDomain(invitation);
}

/**
 * `https://auth.<domain>/invite#<token>` — the token in the fragment, so no
 * server's log keeps it (the page posts it) — or null when no domain serves.
 *
 * @param {object} invitation
 * @param {string} token
 */
export async function invitationLink(invitation, token) {
  const domain = await invitationDomain(invitation);
  return domain ? linkOn(domain, token) : null;
}

function linkOn(domain, token) {
  return `https://auth.${domain}/invite#${token}`;
}

/** What a delegated invitation's mail says of it: who invited, into what, as what. */
async function delegatedContext(invitation, plugin) {
  const inviter = invitation.inviterUserId
    ? await getDirectoryUser(invitation.inviterUserId)
    : null;
  const role = plugin?.identity?.roles?.find((r) => r.id === invitation.role);
  return {
    inviter: inviter?.displayName || null,
    plugin: plugin?.displayName ?? plugin?.route ?? invitation.plugin,
    role: role?.label ?? invitation.role,
  };
}

/**
 * Mail `invitation`'s link (`token`, shown once) to its address in its
 * domain's language and brand, and record the outcome on the invitation.
 * Never throws: the answer is core's `MailSendResult`.
 *
 * @param {object} invitation lib/invitations.js's invitation
 * @param {string} token
 * @param {{ sendClass: import('@lamalibre/lamaste').MailSendClass, plugin?: object | null,
 *   logger?: import('pino').Logger }} opts
 * @returns {Promise<import('@lamalibre/lamaste').MailSendResult>}
 */
export async function mailInvitation(invitation, token, { sendClass, plugin = null, logger }) {
  let result;
  try {
    result = await deliverInvitation(invitation, token, { sendClass, plugin, logger });
  } catch (err) {
    logger?.error({ err: err?.message, invitationId: invitation.id }, 'Invitation mail failed');
    result = { status: 'failed', error: 'unexpected' };
  }
  const tokenSha256 = hashInvitationToken(token);
  if (tokenSha256) {
    try {
      await recordInvitationMail(invitation.id, invitation.plugin ?? null, tokenSha256, result);
    } catch (err) {
      logger?.warn(
        { err: err?.message, invitationId: invitation.id },
        "Recording an invitation mail's outcome failed",
      );
    }
  }
  return result;
}

async function deliverInvitation(invitation, token, { sendClass, plugin, logger }) {
  if (parseMailAddress(invitation.email) === null) return { status: 'failed', error: 'address' };
  const domain = await invitationDomain(invitation);
  if (!domain) return { status: 'not-configured' };
  const link = linkOn(domain, token);
  const delegated =
    invitation.kind === 'delegated' ? await delegatedContext(invitation, plugin) : undefined;
  const expiresAt = new Date(invitation.expiresAt);
  return sendMail({
    domain,
    to: invitation.email,
    kind: 'invitation',
    sendClass,
    logger,
    render: ({ language, brand }) =>
      renderInvitationMail({
        language,
        brand,
        link,
        expiresAt,
        ...(delegated ? { delegated } : {}),
      }),
  });
}

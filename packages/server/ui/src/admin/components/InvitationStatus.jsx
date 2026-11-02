import { revokeReasonText, statusClasses } from '../lib/invitations.js';

/** An invitation's status; a revoked one says why when it is hovered and on small rows. */
export default function InvitationStatus({ invitation }) {
  const reason = revokeReasonText(invitation.revokedReason);
  return (
    <span
      title={reason ?? undefined}
      className={`whitespace-nowrap text-xs px-2 py-0.5 rounded-full border ${statusClasses(invitation.status)}`}
    >
      {invitation.status}
      {invitation.status === 'accepted' && invitation.fulfilled === false && ' · access pending'}
    </span>
  );
}

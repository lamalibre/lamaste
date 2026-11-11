import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, MailPlus, UserX, XCircle } from 'lucide-react';
import { useAdminClient } from '../context/AdminClientContext.jsx';
import { ConfirmDialog, DialogButtons, Modal } from './Dialog.jsx';
import InvitationStatus from './InvitationStatus.jsx';
import { mailStatusText } from '../lib/mail.js';
import { useToast } from './Toast.jsx';
import { errorMessage } from '../lib/errorMessage.js';
import { invalidateUsers, warningText } from '../lib/identity.js';
import {
  inviteeText,
  inviteesByInviter,
  invitedByText,
  invitingRoleLines,
  isRevocable,
  policyFieldLimits,
  policyForm,
  policyInput,
  revokeReasonText,
  revokeResultText,
} from '../lib/invitations.js';

const INPUT_CLASS =
  'w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-white focus:border-cyan-500 focus:outline-none';

const NUMBER_FIELDS = ['maxOpenPerInviter', 'maxJoined', 'lifetimeDays'];

/** The administrator's policy; keyed by the policy read, so a saved one starts over. */
function PolicyForm({ plugin, policy }) {
  const client = useAdminClient();
  const queryClient = useQueryClient();
  const addToast = useToast();
  const [form, setForm] = useState(() => policyForm(policy));
  const [error, setError] = useState('');
  const save = useMutation({
    mutationFn: (input) => client.setPluginInvitationPolicy(plugin.name, input),
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: ['plugin-invitation-policy', plugin.name] });
      queryClient.invalidateQueries({ queryKey: ['invitations'] });
      addToast('Invitation policy saved');
      for (const warning of saved?.warnings ?? []) addToast(warningText(warning), 'warning');
    },
    onError: (err) => setError(errorMessage(err)),
  });
  const change = (field, value) => {
    setForm((previous) => ({ ...previous, [field]: value }));
    setError('');
  };
  const submit = (event) => {
    event.preventDefault();
    const checked = policyInput(form);
    if (checked.error) setError(checked.error);
    else save.mutate(checked.policy);
  };

  return (
    <form onSubmit={submit} className="space-y-2">
      <label className="flex items-center gap-2 text-zinc-300">
        <input
          type="checkbox"
          checked={form.enabled}
          onChange={(e) => change('enabled', e.target.checked)}
        />
        People with an inviting role may invite colleagues
      </label>
      <label className="block">
        <span className="mb-1 block">
          E-mail domains invitees&apos; addresses must be under (required to enable)
        </span>
        <textarea
          rows={2}
          value={form.emailDomains}
          onChange={(e) => change('emailDomains', e.target.value)}
          placeholder="client.example"
          className={`${INPUT_CLASS} font-mono`}
        />
      </label>
      <div className="grid gap-2 sm:grid-cols-3">
        {NUMBER_FIELDS.map((field) => {
          const { label, min, max } = policyFieldLimits(field);
          return (
            <label key={field} className="block">
              <span className="mb-1 block">{label}</span>
              <input
                type="number"
                min={min}
                max={max}
                value={form[field]}
                onChange={(e) => change(field, e.target.value)}
                className={INPUT_CLASS}
              />
            </label>
          );
        })}
      </div>
      {error && <p className="text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={save.isPending}
        className="rounded border border-zinc-700 px-2 py-1 text-zinc-300 hover:border-cyan-600 hover:text-white disabled:opacity-50"
      >
        {save.isPending ? 'Saving…' : 'Save'}
      </button>
    </form>
  );
}

/** Confirm disabling everyone `inviter` invited, and whether those they invited go too. */
function DisableInviteesDialog({ inviter, onClose }) {
  const client = useAdminClient();
  const queryClient = useQueryClient();
  const addToast = useToast();
  const [transitive, setTransitive] = useState(false);
  const disable = useMutation({
    mutationFn: () => client.disableInvitees(inviter.userId, { transitive }),
    onSuccess: (result) => {
      invalidateUsers(queryClient);
      queryClient.invalidateQueries({ queryKey: ['invitations'] });
      addToast(
        `${result.disabled.length} ${result.disabled.length === 1 ? 'user' : 'users'} disabled`,
      );
      for (const warning of result.warnings ?? []) addToast(warningText(warning), 'error');
      onClose();
    },
    onError: (err) => {
      addToast(errorMessage(err), 'error');
      onClose();
    },
  });
  return (
    <Modal onClose={onClose}>
      <h2 className="mb-2 text-lg font-bold text-white">Disable invitees</h2>
      <p className="mb-4 text-sm text-zinc-400">
        Disable everyone <span className="font-mono text-zinc-200">{inviter.label}</span> invited,
        on every plugin. Their sessions end. An administrator is never disabled this way, and each
        person can be enabled again on Users.
      </p>
      <label className="mb-6 flex items-center gap-2 text-sm text-zinc-300">
        <input
          type="checkbox"
          checked={transitive}
          onChange={(e) => setTransitive(e.target.checked)}
        />
        Also everyone those people invited
      </label>
      <DialogButtons
        confirmLabel="Disable"
        destructive
        isPending={disable.isPending}
        onConfirm={() => disable.mutate()}
        onCancel={onClose}
      />
    </Modal>
  );
}

/**
 * Delegated invitations on a plugin's card: whether people holding one of
 * its inviting roles may invite colleagues (the administrator's policy),
 * its invitations, and the people who joined by invitation, by inviter.
 * For a plugin with an inviting role only (`declaresInvitingRole`).
 */
export default function PluginInvitations({ plugin }) {
  const client = useAdminClient();
  const queryClient = useQueryClient();
  const addToast = useToast();
  const [revokeTarget, setRevokeTarget] = useState(null);
  const [disableTarget, setDisableTarget] = useState(null);
  const policyQuery = useQuery({
    queryKey: ['plugin-invitation-policy', plugin.name],
    queryFn: () => client.getPluginInvitationPolicy(plugin.name),
    staleTime: 30_000,
  });
  const invitationsQuery = useQuery({
    queryKey: ['invitations', { plugin: plugin.name }],
    queryFn: () => client.getInvitations({ plugin: plugin.name }),
  });
  const revoke = useMutation({
    mutationFn: (id) => client.revokeInvitation(id),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['invitations'] });
      addToast(revokeResultText(result?.action));
    },
    onError: (err) => addToast(errorMessage(err), 'error'),
    onSettled: () => setRevokeTarget(null),
  });

  const policy = policyQuery.data;
  const invitations = invitationsQuery.data?.invitations ?? [];
  const open = invitations.filter(isRevocable);
  const ended = invitations.filter((inv) => !isRevocable(inv) && inv.status !== 'accepted');
  const joined = inviteesByInviter(invitations);

  return (
    <div className="mt-3 space-y-3 rounded-lg border border-zinc-800 p-3 text-xs text-zinc-400">
      <p className="flex items-center gap-2 text-zinc-300">
        <MailPlus size={14} className="text-cyan-400" /> Invitations
        {(policyQuery.isFetching || invitationsQuery.isFetching) && (
          <Loader2 size={12} className="animate-spin" />
        )}
      </p>
      {invitingRoleLines(plugin.identity).map((line) => (
        <p key={line}>{line}</p>
      ))}
      {policyQuery.isError && <p className="text-red-400">{errorMessage(policyQuery.error)}</p>}
      {policy && !policy.available && (
        <p className="text-amber-300">
          Invitations cannot work now: {policy.unavailableReason}.
          {policy.enabled ? ' Nobody can be invited until that is fixed.' : ''}
        </p>
      )}
      {policy && <PolicyForm key={policy.updatedAt ?? 'unset'} plugin={plugin} policy={policy} />}

      {invitationsQuery.data?.truncated && (
        <p className="text-amber-300">Only the newest invitations are shown here.</p>
      )}
      {open.length > 0 && (
        <div>
          <p className="mb-1 text-zinc-300">Open</p>
          <ul className="space-y-1">
            {open.map((inv) => (
              <li key={inv.id} className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-zinc-200">{inviteeText(inv)}</span>
                <span>
                  {inv.role} · {invitedByText(inv)}
                </span>
                <InvitationStatus invitation={inv} />
                <span>until {new Date(inv.expiresAt).toLocaleDateString()}</span>
                {mailStatusText(inv.mail) && <span>{mailStatusText(inv.mail)}</span>}
                <button
                  type="button"
                  onClick={() => setRevokeTarget(inv.id)}
                  title="Revoke invitation"
                  aria-label={`Revoke the invitation of ${inviteeText(inv)}`}
                  className="text-zinc-500 hover:text-red-400"
                >
                  <XCircle size={14} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {joined.length > 0 && (
        <div>
          <p className="mb-1 text-zinc-300">People who joined by invitation</p>
          <ul className="space-y-2">
            {joined.map((group) => (
              <li key={group.userId}>
                <p className="flex flex-wrap items-center gap-2">
                  <span>
                    Invited by <span className="font-mono text-zinc-200">{group.label}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setDisableTarget(group)}
                    className="inline-flex items-center gap-1 rounded border border-zinc-700 px-2 py-0.5 text-zinc-300 hover:border-red-500 hover:text-red-400"
                  >
                    <UserX size={12} /> Disable invitees
                  </button>
                </p>
                <ul className="mt-1 flex flex-wrap gap-1">
                  {group.invitees.map((person) => (
                    <li
                      key={person.userId ?? person.username}
                      className="rounded border border-zinc-700 px-2 py-0.5 font-mono text-zinc-300"
                    >
                      {person.username}
                      {person.role ? (
                        <span className="ml-1 text-zinc-500">{person.role}</span>
                      ) : null}
                      {!person.fulfilled && (
                        <span className="ml-1 text-amber-300">access pending</span>
                      )}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      )}

      {ended.length > 0 && (
        <details>
          <summary className="cursor-pointer">Ended ({ended.length})</summary>
          <ul className="mt-1 space-y-1">
            {ended.map((inv) => (
              <li key={inv.id} className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-zinc-300">{inviteeText(inv)}</span>
                <InvitationStatus invitation={inv} />
                {inv.revokedReason && <span>{revokeReasonText(inv.revokedReason)}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}

      {revokeTarget && (
        <ConfirmDialog
          title="Revoke Invitation"
          message="Are you sure you want to revoke this invitation? The link will no longer work."
          confirmLabel="Revoke"
          destructive
          onConfirm={() => revoke.mutate(revokeTarget)}
          onCancel={() => setRevokeTarget(null)}
          isPending={revoke.isPending}
        />
      )}
      {disableTarget && (
        <DisableInviteesDialog inviter={disableTarget} onClose={() => setDisableTarget(null)} />
      )}
    </div>
  );
}

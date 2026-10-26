import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { QRCodeSVG } from 'qrcode.react';
import { errorMessage } from '../lib/errorMessage.js';
import {
  UserPlus,
  Pencil,
  KeyRound,
  Trash2,
  Eye,
  EyeOff,
  Copy,
  Check,
  Mail,
  XCircle,
  ChevronDown,
  ChevronUp,
  Fingerprint,
  UserX,
  UserCheck,
  Eraser,
  AlertTriangle,
  Archive,
} from 'lucide-react';
import { useToast } from '../components/Toast.jsx';
import CopyableId from '../components/CopyableId.jsx';
import { useAdminClient } from '../context/AdminClientContext.jsx';
import { relativeTime } from '../lib/formatters.js';
import { isLastEnabledAdmin, warningText } from '../lib/identity.js';
import { ConfirmDialog, DialogButtons, Modal } from '../components/Dialog.jsx';
import {
  DomainChips,
  DomainMembershipChoice,
  ExternalBadge,
  useDomains,
  useMembershipChoice,
} from '../components/DomainChoice.jsx';
import { isExternalAnywhere } from '../lib/domains.js';

/**
 * Refetch what a users change touches: the users, the directory (ids,
 * tombstones), and the plugins' people (audiences follow users).
 */
function invalidateUsers(queryClient) {
  queryClient.invalidateQueries({ queryKey: ['users'] });
  queryClient.invalidateQueries({ queryKey: ['user-directory'] });
  queryClient.invalidateQueries({ queryKey: ['plugin-identity'] });
  queryClient.invalidateQueries({ queryKey: ['plugin-audience'] });
  queryClient.invalidateQueries({ queryKey: ['domains'] });
  queryClient.invalidateQueries({ queryKey: ['domain-members'] });
}

/** Toast each warning a users change came back with: what the panel could not complete beside it. */
function toastWarnings(toast, result) {
  for (const warning of result?.warnings ?? []) toast(warningText(warning), 'error');
}

// --- TOTP Enrollment Modal ---

function TotpModal({ totpUri, onClose }) {
  const [copied, setCopied] = useState(false);

  const secretMatch = totpUri.match(/secret=([A-Z2-7]+)/);
  const secret = secretMatch ? secretMatch[1] : '';
  const formattedSecret = secret.replace(/(.{4})/g, '$1 ').trim();

  function handleCopy() {
    navigator.clipboard
      .writeText(secret)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {});
  }

  return (
    <Modal onClose={onClose}>
      <h2 className="mb-4 text-lg font-bold text-white">Two-Factor Authentication Setup</h2>
      <p className="mb-4 text-sm text-zinc-400">
        Scan this QR code with your authenticator app (Google Authenticator, Authy, etc.)
      </p>
      <div className="mb-4 flex justify-center">
        <div className="rounded-lg bg-zinc-900 p-4">
          <QRCodeSVG value={totpUri} size={200} bgColor="transparent" fgColor="#ffffff" />
        </div>
      </div>
      <p className="mb-2 text-sm text-zinc-400">Or enter this code manually:</p>
      <div className="mb-4 flex items-center gap-2 rounded-lg bg-zinc-900 px-4 py-3">
        <code className="flex-1 font-mono text-sm text-cyan-400 tracking-wider">
          {formattedSecret}
        </code>
        <button
          type="button"
          onClick={handleCopy}
          className="text-zinc-500 hover:text-zinc-300"
          title="Copy secret"
        >
          {copied ? <Check size={16} className="text-green-400" /> : <Copy size={16} />}
        </button>
      </div>
      <p className="mb-6 text-xs text-yellow-400">
        This code will only be shown once. Make sure the user scans it before closing.
      </p>
      <button
        type="button"
        onClick={onClose}
        className="w-full rounded-lg bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-500"
      >
        Done
      </button>
    </Modal>
  );
}

/** The groups a form's text names, trimmed, empty ones dropped. */
function groupList(text) {
  return text
    .split(',')
    .map((g) => g.trim())
    .filter(Boolean);
}

/**
 * Authelia groups (`admins`, `feria-admins`) — never for an external member:
 * groups grant by membership, everywhere. While the form makes the user
 * external the field is closed, or — when groups are still named — says to
 * remove them.
 */
function GroupsField({ label, value, onChange, placeholder, external }) {
  const blocked = external && groupList(value).length > 0;
  return (
    <div>
      <label className="mb-1 block text-sm text-zinc-400">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={external && !blocked}
        placeholder={external ? 'External members hold no groups' : placeholder}
        className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder-zinc-600 focus:border-cyan-500 focus:outline-none disabled:text-zinc-500"
      />
      {blocked && (
        <p className="mt-1 text-xs text-amber-300">
          An external member holds no Authelia groups — remove them to make the user external.
        </p>
      )}
    </div>
  );
}

/** The refusal a form shows before asking the panel: groups for an external member. */
const EXTERNAL_GROUPS_ERROR =
  'An external member holds no Authelia groups — remove the groups first';

// --- Add/Edit User Modal ---

function UserFormModal({ user, onClose, onSuccess }) {
  const isEdit = !!user;
  const toast = useToast();
  const queryClient = useQueryClient();
  const client = useAdminClient();

  const [form, setForm] = useState({
    username: user?.username || '',
    displayname: user?.displayname || '',
    email: user?.email || '',
    password: '',
    groups: user?.groups?.join(', ') || '',
  });
  const membership = useMembershipChoice(user);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');

  const createMutation = useMutation({
    mutationFn: (data) => client.createUser(data),
    onSuccess: (data) => {
      invalidateUsers(queryClient);
      toastWarnings(toast, data);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ username, ...data }) => client.updateUser(username, data),
    onSuccess: (data) => {
      invalidateUsers(queryClient);
      toastWarnings(toast, data);
    },
  });

  const mutation = isEdit ? updateMutation : createMutation;

  function handleChange(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
    setError('');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (!isEdit) {
      if (!form.username || !form.displayname || !form.email || !form.password) {
        setError('All required fields must be filled');
        return;
      }
      if (!/^[a-z0-9_-]+$/.test(form.username)) {
        setError(
          'Username must contain only lowercase alphanumeric characters, underscores, and hyphens',
        );
        return;
      }
      if (form.username.length < 2) {
        setError('Username must be at least 2 characters');
        return;
      }
      if (form.password.length < 8) {
        setError('Password must be at least 8 characters');
        return;
      }
    }

    if (isEdit && form.password && form.password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    const groups = groupList(form.groups);
    if (membership.external && groups.length > 0) {
      setError(EXTERNAL_GROUPS_ERROR);
      return;
    }

    try {
      if (isEdit) {
        const body = { username: user.username };
        if (form.displayname !== user.displayname) body.displayname = form.displayname;
        if (form.email !== user.email) body.email = form.email;
        if (form.password) body.password = form.password;
        const currentGroups = (user.groups || []).join(', ');
        if (form.groups !== currentGroups) body.groups = groups;
        Object.assign(body, membership.editFields);

        // Check if anything changed
        if (Object.keys(body).length <= 1) {
          setError('No changes detected');
          return;
        }

        await mutation.mutateAsync(body);
        toast('User updated successfully');
        onClose();
      } else {
        const result = await mutation.mutateAsync({
          username: form.username,
          displayname: form.displayname,
          email: form.email,
          password: form.password,
          groups,
          ...membership.createFields,
        });
        toast('User created successfully');
        onSuccess(result.user.username);
      }
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const isSubmitting = mutation.isPending;

  return (
    <Modal onClose={onClose}>
      <h2 className="mb-4 text-lg font-bold text-white">{isEdit ? 'Edit User' : 'Add User'}</h2>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="mb-1 block text-sm text-zinc-400">Username</label>
          <input
            type="text"
            value={form.username}
            onChange={(e) => handleChange('username', e.target.value)}
            disabled={isEdit}
            placeholder="johndoe"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder-zinc-600 focus:border-cyan-500 focus:outline-none disabled:text-zinc-500"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm text-zinc-400">Display Name</label>
          <input
            type="text"
            value={form.displayname}
            onChange={(e) => handleChange('displayname', e.target.value)}
            placeholder="John Doe"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm text-zinc-400">Email</label>
          <input
            type="email"
            value={form.email}
            onChange={(e) => handleChange('email', e.target.value)}
            placeholder="john@example.com"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm text-zinc-400">
            Password{isEdit ? ' (leave blank to keep current)' : ''}
          </label>
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              value={form.password}
              onChange={(e) => handleChange('password', e.target.value)}
              placeholder={isEdit ? 'Leave blank to keep current password' : 'Minimum 8 characters'}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 pr-10 text-sm text-white placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>
        <GroupsField
          label="Groups (comma-separated)"
          value={form.groups}
          onChange={(v) => handleChange('groups', v)}
          placeholder="admins, users"
          external={membership.external}
        />
        <DomainMembershipChoice choice={membership} />

        {error && <p className="text-sm text-red-400">{error}</p>}

        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-400 hover:text-white"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="flex-1 rounded-lg bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-500 disabled:opacity-50"
          >
            {isSubmitting ? 'Saving...' : isEdit ? 'Save Changes' : 'Create User'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// --- Invite User Modal ---

function InviteUserModal({ onClose, onSuccess }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const client = useAdminClient();

  const [form, setForm] = useState({
    username: '',
    email: '',
    groups: '',
  });
  const membership = useMembershipChoice(null);
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: (data) => client.createInvitation(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['invitations'] }),
  });

  function handleChange(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
    setError('');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (!form.username || !form.email) {
      setError('Username and email are required');
      return;
    }
    if (!/^[a-z0-9_-]+$/.test(form.username)) {
      setError(
        'Username must contain only lowercase alphanumeric characters, underscores, and hyphens',
      );
      return;
    }
    if (form.username.length < 2) {
      setError('Username must be at least 2 characters');
      return;
    }

    const groups = groupList(form.groups);
    if (membership.external && groups.length > 0) {
      setError(EXTERNAL_GROUPS_ERROR);
      return;
    }

    try {
      const result = await mutation.mutateAsync({
        username: form.username,
        email: form.email,
        groups,
        ...membership.createFields,
      });
      toast('Invitation created');
      onSuccess(result);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <Modal onClose={onClose}>
      <h2 className="mb-4 text-lg font-bold text-white">Invite User</h2>
      <p className="mb-4 text-sm text-zinc-400">
        Generate an invitation link. The invited user will set their own password and TOTP.
      </p>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="mb-1 block text-sm text-zinc-400">Username</label>
          <input
            type="text"
            value={form.username}
            onChange={(e) => handleChange('username', e.target.value)}
            placeholder="johndoe"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm text-zinc-400">Email</label>
          <input
            type="email"
            value={form.email}
            onChange={(e) => handleChange('email', e.target.value)}
            placeholder="john@example.com"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
          />
        </div>
        <GroupsField
          label="Groups (comma-separated, optional)"
          value={form.groups}
          onChange={(v) => handleChange('groups', v)}
          placeholder="users"
          external={membership.external}
        />
        <DomainMembershipChoice choice={membership} />

        {error && <p className="text-sm text-red-400">{error}</p>}

        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-400 hover:text-white"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={mutation.isPending}
            className="flex-1 rounded-lg bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-500 disabled:opacity-50"
          >
            {mutation.isPending ? 'Creating...' : 'Create Invitation'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// --- Invite Link Modal (shown after creating invitation) ---

function InviteLinkModal({ inviteUrl, token, onClose }) {
  const [copied, setCopied] = useState(false);

  const displayUrl = inviteUrl || `(Domain not configured — token: ${token})`;

  function handleCopy() {
    const textToCopy = inviteUrl || token;
    navigator.clipboard
      .writeText(textToCopy)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {});
  }

  return (
    <Modal onClose={onClose}>
      <h2 className="mb-4 text-lg font-bold text-white">Invitation Created</h2>
      <p className="mb-4 text-sm text-zinc-400">
        Share this link with the invited user. It expires in 7 days.
      </p>
      <div className="mb-4 flex items-center gap-2 rounded-lg bg-zinc-900 px-4 py-3">
        <code className="flex-1 text-sm text-cyan-400 break-all">{displayUrl}</code>
        <button
          type="button"
          onClick={handleCopy}
          className="flex-shrink-0 text-zinc-500 hover:text-zinc-300"
          title="Copy link"
        >
          {copied ? <Check size={16} className="text-green-400" /> : <Copy size={16} />}
        </button>
      </div>
      {!inviteUrl && (
        <p className="mb-4 text-xs text-yellow-400">
          Domain is not configured. The invitation token has been created but cannot generate a full
          URL.
        </p>
      )}
      <button
        type="button"
        onClick={onClose}
        className="w-full rounded-lg bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-500"
      >
        Done
      </button>
    </Modal>
  );
}

// --- Confirm Dialog ---

/** A dialog's Cancel and confirm buttons; the confirm button waits while `isPending`. */
// --- Erasure confirmation (typed) ---

/**
 * What erasing a user does, said before it is done, and the field it is
 * confirmed in: the administrator types the username — erasing cannot be
 * undone, and nothing of the user is left to tell who it was afterwards.
 */
function ErasureConfirmation({ username, typed, onType }) {
  return (
    <div className="mb-4 space-y-3 rounded-lg border border-red-500/30 bg-red-500/5 p-3">
      <ul className="list-disc space-y-1 pl-5 text-xs text-zinc-400">
        <li>
          The directory keeps the bare user id; the username, name and address it last had are
          scrubbed.
        </li>
        <li>Their invitations and Gatekeeper&apos;s access-request log entries are deleted.</li>
        <li>
          Every plugin that had them is sent the erasure: its agent half scrubs its record to the id
          and runs the plugin&apos;s anonymiser. The panel shows it pending until each acknowledges.
        </li>
        <li>
          Authelia&apos;s own authentication log is outside Lamaste&apos;s reach and is not erased.
        </li>
        <li className="text-red-400">This cannot be undone.</li>
      </ul>
      <div>
        <label className="mb-1 block text-xs text-zinc-400">
          Type <span className="font-mono text-zinc-200">{username}</span> to confirm
        </label>
        <input
          type="text"
          value={typed}
          onChange={(e) => onType(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-sm text-white focus:border-red-500 focus:outline-none"
        />
      </div>
    </div>
  );
}

// --- Delete User Dialog ---

/**
 * Delete a user: Authelia forgets them and the directory keeps a tombstone
 * — the user id with the name and address they last had — so plugins'
 * history stays readable; or, with "also erase personal data", scrub the
 * tombstone at once.
 */
function DeleteUserDialog({ user, onConfirm, onCancel, isPending }) {
  const [erase, setErase] = useState(false);
  const [typed, setTyped] = useState('');
  const confirmed = !erase || typed === user.username;
  return (
    <Modal onClose={onCancel}>
      <h2 className="mb-2 text-lg font-bold text-white">Delete User</h2>
      <p className="mb-3 text-sm text-zinc-400">
        Delete <span className="font-mono text-cyan-400">{user.username}</span>? They can no longer
        sign in, their grants and group memberships are removed, and every plugin they used is told
        they were deleted.
      </p>
      <p className="mb-4 text-xs text-zinc-500">
        The user directory keeps a tombstone — their user id with the name and address they last had
        — so what plugins recorded about them stays readable. A user created later under the same
        username is a new user with a new id.
      </p>
      <label className="mb-3 flex items-start gap-2 text-sm text-zinc-300">
        <input
          type="checkbox"
          checked={erase}
          onChange={(e) => {
            setErase(e.target.checked);
            setTyped('');
          }}
          className="mt-1"
        />
        <span>Also erase their personal data</span>
      </label>
      {erase && <ErasureConfirmation username={user.username} typed={typed} onType={setTyped} />}
      <DialogButtons
        confirmLabel={erase ? 'Delete and erase' : 'Delete'}
        destructive
        disabled={!confirmed}
        isPending={isPending}
        onConfirm={() => onConfirm(erase)}
        onCancel={onCancel}
      />
    </Modal>
  );
}

// --- Erase Dialog (a deleted user) ---

function EraseUserDialog({ user, onConfirm, onCancel, isPending }) {
  const [typed, setTyped] = useState('');
  return (
    <Modal onClose={onCancel}>
      <h2 className="mb-2 text-lg font-bold text-white">Erase Deleted User</h2>
      <p className="mb-3 text-sm text-zinc-400">
        Erase what Lamaste keeps of <span className="font-mono text-cyan-400">{user.username}</span>{' '}
        (<span className="font-mono text-xs">{user.userId}</span>)?
      </p>
      <ErasureConfirmation username={user.username} typed={typed} onType={setTyped} />
      <DialogButtons
        confirmLabel="Erase"
        destructive
        disabled={typed !== user.username}
        isPending={isPending}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    </Modal>
  );
}

// --- Status badge ---

function StatusBadge({ status }) {
  const disabled = status === 'disabled';
  return (
    <span
      className={`text-xs px-2 py-0.5 rounded-full border ${
        disabled
          ? 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20'
          : 'text-green-400 bg-green-500/10 border-green-500/20'
      }`}
      title={
        disabled
          ? 'Cannot sign in; every plugin audience shows them disabled; plugins’ user surfaces refuse them'
          : undefined
      }
    >
      {disabled ? 'disabled' : 'active'}
    </span>
  );
}

// --- Deleted users (the directory's tombstones) ---

/** Why a user was removed, in words. */
function removedText(user) {
  return user.removedReason === 'deleted-outside'
    ? 'gone from Authelia’s users file (not deleted through Lamaste)'
    : 'deleted';
}

/**
 * The users the directory keeps after they were deleted: their tombstone
 * (the id and the name they last had) until an administrator erases it,
 * whether Gatekeeper has dropped what it held under their username, and —
 * for an erased user — the plugins whose agent half has not acknowledged
 * the erasure yet.
 */
function DeletedUsersSection() {
  const client = useAdminClient();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [eraseTarget, setEraseTarget] = useState(null);

  const query = useQuery({
    queryKey: ['user-directory'],
    queryFn: () => client.getUserDirectory(),
    refetchInterval: 30000,
  });

  const eraseMutation = useMutation({
    mutationFn: (userId) => client.eraseDirectoryUser(userId),
    onSuccess: (data) => {
      invalidateUsers(queryClient);
      queryClient.invalidateQueries({ queryKey: ['invitations'] });
      toast(
        `Erased — ${data.invitationsPurged} invitation(s) and ${data.accessLogPurged} access-log entr${data.accessLogPurged === 1 ? 'y' : 'ies'} deleted; plugins are being told`,
      );
      setEraseTarget(null);
    },
    onError: (err) => {
      toast(errorMessage(err), 'error');
      setEraseTarget(null);
    },
  });

  const now = query.dataUpdatedAt;
  const removed = (query.data?.users ?? []).filter((u) => u.status === 'removed');

  return (
    <div className="mt-8">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold text-white">
            <Archive size={16} className="text-zinc-400" />
            Deleted Users
          </h2>
          <p className="text-zinc-500 text-sm">
            Tombstones the directory keeps until they are erased, so plugins&apos; history stays
            readable.
          </p>
        </div>
        {query.data?.directoryId && (
          <span className="flex items-center gap-1 text-xs text-zinc-500">
            directory <CopyableId id={query.data.directoryId} />
          </span>
        )}
      </div>
      <div className="overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-900">
        {query.isLoading ? (
          <div className="p-6 text-center">
            <div className="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-zinc-600 border-t-cyan-400" />
          </div>
        ) : query.isError ? (
          <div className="p-6 text-center text-red-400 text-sm">
            Failed to load the user directory: {errorMessage(query.error)}
          </div>
        ) : removed.length === 0 ? (
          <div className="p-6 text-center text-zinc-500 text-sm">No deleted users.</div>
        ) : (
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-zinc-700">
                <th className="px-4 py-3 text-xs font-semibold uppercase text-zinc-400">User</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase text-zinc-400">User ID</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase text-zinc-400 hidden sm:table-cell">
                  Removed
                </th>
                <th className="px-4 py-3 text-xs font-semibold uppercase text-zinc-400">State</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase text-zinc-400 text-right">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {removed.map((u) => {
                const erased = u.erasedAt !== null;
                const cleanupPending = u.principalClearedAt === null && !erased;
                return (
                  <tr key={u.userId} className="border-b border-zinc-700 last:border-b-0 align-top">
                    <td className="px-4 py-3 text-sm">
                      {erased ? (
                        <span className="text-zinc-600">erased</span>
                      ) : (
                        <>
                          <span className="font-mono text-zinc-300">{u.username}</span>
                          {u.displayName && (
                            <span className="block text-xs text-zinc-500">{u.displayName}</span>
                          )}
                        </>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <CopyableId id={u.userId} />
                    </td>
                    <td className="px-4 py-3 text-xs text-zinc-500 hidden sm:table-cell">
                      {removedText(u)}
                      {u.removedAt && (
                        <span className="block" title={new Date(u.removedAt).toLocaleString()}>
                          {relativeTime(u.removedAt, now)}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {erased ? (
                        <>
                          <span className="text-zinc-400">
                            erased {relativeTime(u.erasedAt, now)}
                            {u.erasure?.requestedBy ? ` by ${u.erasure.requestedBy}` : ''}
                          </span>
                          {u.pendingErasures.length > 0 ? (
                            <span className="mt-0.5 flex items-start gap-1 text-amber-400">
                              <Eraser size={11} className="mt-0.5 shrink-0" />
                              <span>
                                waiting for{' '}
                                {u.pendingErasures
                                  .map((name) =>
                                    (u.pendingErasuresInactive ?? []).includes(name)
                                      ? `${name} (not taking the feed — an agent keeps its data)`
                                      : name,
                                  )
                                  .join(', ')}{' '}
                                to acknowledge it
                              </span>
                            </span>
                          ) : (
                            <span className="block text-zinc-600">
                              acknowledged by every plugin
                            </span>
                          )}
                        </>
                      ) : cleanupPending ? (
                        <span
                          className="flex items-start gap-1 text-yellow-400"
                          title="Until it is done, nothing — no user, grant or group membership — is given to this username again"
                        >
                          <AlertTriangle size={11} className="mt-0.5 shrink-0" />
                          <span>
                            Gatekeeper cleanup pending — retried every minute; the username cannot
                            be reused until it is done
                          </span>
                        </span>
                      ) : (
                        <span className="text-zinc-500">tombstone</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {!erased && (
                        <button
                          type="button"
                          onClick={() => setEraseTarget(u)}
                          className="inline-flex items-center gap-1 rounded p-1.5 text-xs text-zinc-500 hover:bg-zinc-700 hover:text-red-400"
                          title="Erase what Lamaste keeps of this user"
                        >
                          <Eraser size={14} />
                          Erase
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {eraseTarget && (
        <EraseUserDialog
          user={eraseTarget}
          onConfirm={() => eraseMutation.mutate(eraseTarget.userId)}
          onCancel={() => setEraseTarget(null)}
          isPending={eraseMutation.isPending}
        />
      )}
    </div>
  );
}

// --- Main Users Page ---

export default function Users() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const client = useAdminClient();

  const [showAddModal, setShowAddModal] = useState(false);
  const [editUser, setEditUser] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [disableTarget, setDisableTarget] = useState(null);
  const [totpUri, setTotpUri] = useState(null);
  const [confirmTotpReset, setConfirmTotpReset] = useState(null);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteResult, setInviteResult] = useState(null);
  const [revokeTarget, setRevokeTarget] = useState(null);
  const { newUsersNeedDomains: showDomains } = useDomains();

  const usersQuery = useQuery({
    queryKey: ['users'],
    queryFn: () => client.getUsers(),
    // A new user's directory id appears within a minute.
    refetchInterval: 30000,
  });

  const deleteMutation = useMutation({
    mutationFn: ({ username, erase }) => client.deleteUser(username, { erase }),
    onSuccess: (data, { username, erase }) => {
      invalidateUsers(queryClient);
      if (erase) queryClient.invalidateQueries({ queryKey: ['invitations'] });
      toast(
        erase && data.erased
          ? `User '${username}' deleted and erased`
          : `User '${username}' deleted — the directory keeps a tombstone`,
      );
      if (!data.principalCleared) {
        toast(
          `Gatekeeper has not dropped the grants and groups of '${username}' yet — retried every minute; the username cannot be reused until then`,
          'error',
        );
      }
      toastWarnings(toast, data);
      setDeleteTarget(null);
    },
    onError: (err) => {
      toast(errorMessage(err), 'error');
      setDeleteTarget(null);
    },
  });

  // Disable (`disabled: true`) or enable a user.
  const statusMutation = useMutation({
    mutationFn: ({ username, disabled }) =>
      disabled ? client.disableUser(username) : client.enableUser(username),
    onSuccess: (data, { username, disabled }) => {
      invalidateUsers(queryClient);
      toast(
        disabled
          ? `User '${username}' disabled — signed out of the desktop, refused by every plugin`
          : `User '${username}' enabled`,
      );
      toastWarnings(toast, data);
      setDisableTarget(null);
    },
    onError: (err) => {
      toast(errorMessage(err), 'error');
      setDisableTarget(null);
    },
  });

  const totpMutation = useMutation({
    mutationFn: (username) => client.resetTotp(username),
    onSuccess: (data) => {
      setConfirmTotpReset(null);
      setTotpUri(data.totpUri);
    },
    onError: (err) => {
      toast(errorMessage(err), 'error');
      setConfirmTotpReset(null);
    },
  });

  const invitationsQuery = useQuery({
    queryKey: ['invitations'],
    queryFn: () => client.getInvitations(),
  });

  const revokeMutation = useMutation({
    mutationFn: (id) => client.revokeInvitation(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invitations'] });
      toast('Invitation revoked');
      setRevokeTarget(null);
    },
    onError: (err) => {
      toast(errorMessage(err), 'error');
      setRevokeTarget(null);
    },
  });

  const users = usersQuery.data?.users || [];
  const invitations = invitationsQuery.data?.invitations || [];
  const isLastUser = users.length <= 1;

  // After creating a user, immediately reset TOTP to show enrollment
  async function handleUserCreated(username) {
    setShowAddModal(false);
    try {
      const data = await totpMutation.mutateAsync(username);
      setTotpUri(data.totpUri);
    } catch {
      // Error handled by mutation onError
    }
  }

  function handleTotpResetRequest(username) {
    setConfirmTotpReset(username);
  }

  function handleTotpResetConfirm() {
    if (confirmTotpReset) {
      totpMutation.mutate(confirmTotpReset);
    }
  }

  function closeTotpModal() {
    setTotpUri(null);
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Users</h1>
          <p className="text-zinc-500 text-sm mt-1">
            Manage Authelia users, two-factor authentication, and what the user directory keeps of
            them.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowInviteModal(true)}
            className="flex items-center gap-2 rounded-lg border border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-300 hover:border-cyan-500 hover:text-white"
          >
            <Mail size={16} />
            Invite User
          </button>
          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 rounded-lg bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-500"
          >
            <UserPlus size={16} />
            Add User
          </button>
        </div>
      </div>

      {/* User Table */}
      <div className="overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-900">
        {usersQuery.isLoading ? (
          <div className="p-8 text-center">
            <div className="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-zinc-600 border-t-cyan-400" />
          </div>
        ) : usersQuery.isError ? (
          <div className="p-8 text-center text-red-400 text-sm">Failed to load users</div>
        ) : users.length === 0 ? (
          <div className="p-8 text-center text-zinc-500 text-sm">
            No users configured. Add your first user to get started.
          </div>
        ) : (
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-zinc-700">
                <th className="px-4 py-3 text-xs font-semibold uppercase text-zinc-400">
                  Username
                </th>
                <th className="px-4 py-3 text-xs font-semibold uppercase text-zinc-400">
                  Display Name
                </th>
                <th className="px-4 py-3 text-xs font-semibold uppercase text-zinc-400 hidden sm:table-cell">
                  Email
                </th>
                <th className="px-4 py-3 text-xs font-semibold uppercase text-zinc-400 hidden md:table-cell">
                  Groups
                </th>
                {showDomains && (
                  <th className="px-4 py-3 text-xs font-semibold uppercase text-zinc-400 hidden md:table-cell">
                    Domains
                  </th>
                )}
                <th className="px-4 py-3 text-xs font-semibold uppercase text-zinc-400">Status</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase text-zinc-400 hidden lg:table-cell">
                  User ID
                </th>
                <th className="px-4 py-3 text-xs font-semibold uppercase text-zinc-400 text-right">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const disabled = u.status === 'disabled';
                const lastAdmin = isLastEnabledAdmin(u, users);
                return (
                  <tr key={u.username} className="border-b border-zinc-700 last:border-b-0">
                    <td
                      className={`px-4 py-3 font-mono text-sm ${disabled ? 'text-zinc-500' : 'text-cyan-400'}`}
                    >
                      {u.username}
                      {isExternalAnywhere(u.domains) && (
                        <span className="ml-2">
                          <ExternalBadge />
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-zinc-300">{u.displayname}</td>
                    <td className="px-4 py-3 text-sm text-zinc-400 hidden sm:table-cell">
                      {u.email}
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <div className="flex flex-wrap gap-1">
                        {(u.groups || []).map((g) => (
                          <span
                            key={g}
                            className="rounded bg-zinc-700 px-2 py-0.5 text-xs text-zinc-300"
                          >
                            {g}
                          </span>
                        ))}
                      </div>
                    </td>
                    {showDomains && (
                      <td className="px-4 py-3 hidden md:table-cell">
                        <DomainChips domains={u.domains} />
                      </td>
                    )}
                    <td className="px-4 py-3">
                      <StatusBadge status={u.status} />
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell">
                      <CopyableId
                        id={u.userId}
                        missing="Not in the user directory yet — it adopts new users within a minute"
                      />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => setEditUser(u)}
                          className="rounded p-1.5 text-zinc-500 hover:bg-zinc-700 hover:text-zinc-300"
                          title="Edit user"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleTotpResetRequest(u.username)}
                          className="rounded p-1.5 text-zinc-500 hover:bg-zinc-700 hover:text-zinc-300"
                          title="Reset TOTP"
                        >
                          <KeyRound size={14} />
                        </button>
                        {disabled ? (
                          <button
                            type="button"
                            onClick={() =>
                              statusMutation.mutate({ username: u.username, disabled: false })
                            }
                            disabled={statusMutation.isPending}
                            className="rounded p-1.5 text-zinc-500 hover:bg-zinc-700 hover:text-green-400 disabled:opacity-30"
                            title="Enable user"
                          >
                            <UserCheck size={14} />
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => !lastAdmin && setDisableTarget(u.username)}
                            disabled={lastAdmin}
                            className="rounded p-1.5 text-zinc-500 hover:bg-zinc-700 hover:text-yellow-400 disabled:cursor-not-allowed disabled:opacity-30"
                            title={
                              lastAdmin
                                ? 'Cannot disable the last enabled administrator'
                                : 'Disable user'
                            }
                          >
                            <UserX size={14} />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => !isLastUser && setDeleteTarget(u)}
                          disabled={isLastUser}
                          className="rounded p-1.5 text-zinc-500 hover:bg-zinc-700 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-30"
                          title={isLastUser ? 'Cannot delete the last user' : 'Delete user'}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Invitations Section */}
      <div className="mt-8 mb-6">
        <h2 className="text-lg font-bold text-white mb-1">Invitations</h2>
        <p className="text-zinc-500 text-sm">Pending and past invitation links.</p>
      </div>
      <div className="overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-900">
        {invitationsQuery.isLoading ? (
          <div className="p-8 text-center">
            <div className="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-zinc-600 border-t-cyan-400" />
          </div>
        ) : invitationsQuery.isError ? (
          <div className="p-8 text-center text-red-400 text-sm">Failed to load invitations</div>
        ) : invitations.length === 0 ? (
          <div className="p-8 text-center text-zinc-500 text-sm">
            No invitations yet. Click &quot;Invite User&quot; to generate a link.
          </div>
        ) : (
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-zinc-700">
                <th className="px-4 py-3 text-xs font-semibold uppercase text-zinc-400">
                  Username
                </th>
                <th className="px-4 py-3 text-xs font-semibold uppercase text-zinc-400 hidden sm:table-cell">
                  Email
                </th>
                <th className="px-4 py-3 text-xs font-semibold uppercase text-zinc-400">Status</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase text-zinc-400 hidden md:table-cell">
                  Expires
                </th>
                <th className="px-4 py-3 text-xs font-semibold uppercase text-zinc-400 text-right">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {invitations.map((inv) => (
                <tr key={inv.id} className="border-b border-zinc-700 last:border-b-0">
                  <td className="px-4 py-3 font-mono text-sm text-cyan-400">
                    {inv.username}
                    {isExternalAnywhere(inv.domains) && (
                      <span className="ml-2">
                        <ExternalBadge />
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-zinc-400 hidden sm:table-cell">
                    {inv.email}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full border ${
                        inv.status === 'accepted'
                          ? 'text-green-400 bg-green-500/10 border-green-500/20'
                          : inv.status === 'expired'
                            ? 'text-zinc-500 bg-zinc-800 border-zinc-700'
                            : 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20'
                      }`}
                    >
                      {inv.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-zinc-500 hidden md:table-cell">
                    {new Date(inv.expiresAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {inv.status === 'pending' && (
                      <button
                        type="button"
                        onClick={() => setRevokeTarget(inv.id)}
                        className="rounded p-1.5 text-zinc-500 hover:bg-zinc-700 hover:text-red-400"
                        title="Revoke invitation"
                      >
                        <XCircle size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Invite User Modal */}
      {showInviteModal && (
        <InviteUserModal
          onClose={() => setShowInviteModal(false)}
          onSuccess={(result) => {
            setShowInviteModal(false);
            setInviteResult(result);
          }}
        />
      )}

      {/* Invite Link Modal */}
      {inviteResult && (
        <InviteLinkModal
          inviteUrl={inviteResult.inviteUrl}
          token={inviteResult.token}
          onClose={() => setInviteResult(null)}
        />
      )}

      {/* Revoke Invitation Confirmation */}
      {revokeTarget && (
        <ConfirmDialog
          title="Revoke Invitation"
          message="Are you sure you want to revoke this invitation? The link will no longer work."
          confirmLabel="Revoke"
          destructive
          onConfirm={() => revokeMutation.mutate(revokeTarget)}
          onCancel={() => setRevokeTarget(null)}
          isPending={revokeMutation.isPending}
        />
      )}

      {/* Add User Modal */}
      {showAddModal && (
        <UserFormModal onClose={() => setShowAddModal(false)} onSuccess={handleUserCreated} />
      )}

      {/* Edit User Modal */}
      {editUser && <UserFormModal user={editUser} onClose={() => setEditUser(null)} />}

      {/* Delete Confirmation */}
      {deleteTarget && (
        <DeleteUserDialog
          user={deleteTarget}
          onConfirm={(erase) => deleteMutation.mutate({ username: deleteTarget.username, erase })}
          onCancel={() => setDeleteTarget(null)}
          isPending={deleteMutation.isPending}
        />
      )}

      {/* Disable Confirmation */}
      {disableTarget && (
        <ConfirmDialog
          title="Disable User"
          message={`Disable '${disableTarget}'? They can no longer sign in; their desktop sessions and registry tokens end; every plugin's audience shows them disabled and plugins' user surfaces refuse them at once. Nothing is deleted — enable them again at any time.`}
          confirmLabel="Disable"
          destructive
          onConfirm={() => statusMutation.mutate({ username: disableTarget, disabled: true })}
          onCancel={() => setDisableTarget(null)}
          isPending={statusMutation.isPending}
        />
      )}

      {/* TOTP Reset Confirmation */}
      {confirmTotpReset && !totpUri && (
        <ConfirmDialog
          title="Reset TOTP"
          message={`This will invalidate the current TOTP secret for '${confirmTotpReset}'. They will need to re-enroll their authenticator app.`}
          confirmLabel="Reset TOTP"
          onConfirm={handleTotpResetConfirm}
          onCancel={() => setConfirmTotpReset(null)}
          isPending={totpMutation.isPending}
        />
      )}

      {/* TOTP Enrollment QR Code */}
      {totpUri && <TotpModal totpUri={totpUri} onClose={closeTotpModal} />}

      {/* The directory's tombstones: erase, pending erasures, Gatekeeper cleanup */}
      <DeletedUsersSection />

      {/* Identity & Groups Section */}
      <IdentitySection />
    </div>
  );
}

function IdentitySection() {
  const client = useAdminClient();
  const [expanded, setExpanded] = useState(false);

  const groupsQuery = useQuery({
    queryKey: ['identity-groups'],
    queryFn: () => client.getIdentityGroups(),
    retry: false,
    staleTime: 60000,
  });

  const selfQuery = useQuery({
    queryKey: ['identity-self'],
    queryFn: () => client.getIdentitySelf(),
    retry: false,
    staleTime: 60000,
    enabled: expanded,
  });

  const groups = groupsQuery.data?.groups || [];

  return (
    <div className="mt-8 border-t border-zinc-700 pt-6">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-2 text-lg font-semibold text-white hover:text-zinc-300 w-full text-left"
      >
        <Fingerprint size={18} className="text-cyan-400" />
        Identity & Groups
        {expanded ? (
          <ChevronUp size={16} className="text-zinc-500 ml-auto" />
        ) : (
          <ChevronDown size={16} className="text-zinc-500 ml-auto" />
        )}
      </button>

      {expanded && (
        <div className="mt-4 space-y-4">
          {/* Current Admin Identity */}
          {selfQuery.data && (
            <div className="rounded-lg bg-zinc-900 border border-zinc-800 p-4">
              <h3 className="text-sm font-medium text-zinc-400 mb-2">
                Your Identity (via Authelia)
              </h3>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <span className="text-zinc-500">Username:</span>
                <span className="text-zinc-200">{selfQuery.data.username || '—'}</span>
                <span className="text-zinc-500">Display Name:</span>
                <span className="text-zinc-200">{selfQuery.data.displayName || '—'}</span>
                <span className="text-zinc-500">Email:</span>
                <span className="text-zinc-200">{selfQuery.data.email || '—'}</span>
                <span className="text-zinc-500">Groups:</span>
                <span className="text-zinc-200">
                  {selfQuery.data.groups?.length > 0 ? selfQuery.data.groups.join(', ') : '—'}
                </span>
              </div>
            </div>
          )}

          {selfQuery.isError && (
            <div className="rounded-lg bg-zinc-900 border border-zinc-800 p-4">
              <p className="text-xs text-zinc-500">
                Identity information is only available when accessing the panel through an
                Authelia-protected domain.
              </p>
            </div>
          )}

          {/* Groups */}
          {groupsQuery.isLoading ? (
            <div className="h-10 animate-pulse rounded-lg bg-zinc-900 border border-zinc-800" />
          ) : groups.length > 0 ? (
            <div>
              <h3 className="text-sm font-medium text-zinc-400 mb-2">All Groups</h3>
              <div className="flex flex-wrap gap-2">
                {groups.map((group) => (
                  <span
                    key={group}
                    className="text-xs px-2.5 py-1 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20"
                  >
                    {group}
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-sm text-zinc-500">No groups defined in Authelia.</p>
          )}
        </div>
      )}
    </div>
  );
}

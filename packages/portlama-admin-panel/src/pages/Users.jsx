import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { QRCodeSVG } from 'qrcode.react';
import {
  UserPlus,
  Pencil,
  KeyRound,
  Trash2,
  X,
  Eye,
  EyeOff,
  Copy,
  Check,
  Mail,
  XCircle,
} from 'lucide-react';
import { useToast } from '../components/Toast.jsx';
import { useAdminClient } from '../context/AdminClientContext.jsx';

// --- Modal backdrop ---

function Modal({ children, onClose }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50">
      <div
        className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-zinc-800 p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 text-zinc-500 hover:text-zinc-300"
        >
          <X size={18} />
        </button>
        {children}
      </div>
    </div>
  );
}

// --- TOTP Enrollment Modal ---

function TotpModal({ totpUri, onClose }) {
  const [copied, setCopied] = useState(false);

  const secretMatch = totpUri.match(/secret=([A-Z2-7]+)/);
  const secret = secretMatch ? secretMatch[1] : '';
  const formattedSecret = secret.replace(/(.{4})/g, '$1 ').trim();

  function handleCopy() {
    navigator.clipboard.writeText(secret).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
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
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');

  const createMutation = useMutation({
    mutationFn: (data) => client.createUser(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ username, ...data }) => client.updateUser(username, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
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

    const groups = form.groups
      .split(',')
      .map((g) => g.trim())
      .filter(Boolean);

    try {
      if (isEdit) {
        const body = { username: user.username };
        if (form.displayname !== user.displayname) body.displayname = form.displayname;
        if (form.email !== user.email) body.email = form.email;
        if (form.password) body.password = form.password;
        const currentGroups = (user.groups || []).join(', ');
        if (form.groups !== currentGroups) body.groups = groups;

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
        });
        toast('User created successfully');
        onSuccess(result.user.username);
      }
    } catch (err) {
      setError(err.message);
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
        <div>
          <label className="mb-1 block text-sm text-zinc-400">Groups (comma-separated)</label>
          <input
            type="text"
            value={form.groups}
            onChange={(e) => handleChange('groups', e.target.value)}
            placeholder="admins, users"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
          />
        </div>

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

    const groups = form.groups
      .split(',')
      .map((g) => g.trim())
      .filter(Boolean);

    try {
      const result = await mutation.mutateAsync({
        username: form.username,
        email: form.email,
        groups,
      });
      toast('Invitation created');
      onSuccess(result);
    } catch (err) {
      setError(err.message);
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
        <div>
          <label className="mb-1 block text-sm text-zinc-400">
            Groups (comma-separated, optional)
          </label>
          <input
            type="text"
            value={form.groups}
            onChange={(e) => handleChange('groups', e.target.value)}
            placeholder="users"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
          />
        </div>

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
    navigator.clipboard.writeText(textToCopy).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
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

function ConfirmDialog({
  title,
  message,
  confirmLabel,
  destructive,
  onConfirm,
  onCancel,
  isPending,
}) {
  return (
    <Modal onClose={onCancel}>
      <h2 className="mb-2 text-lg font-bold text-white">{title}</h2>
      <p className="mb-6 text-sm text-zinc-400">{message}</p>
      <div className="flex gap-3">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-400 hover:text-white"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={isPending}
          className={`flex-1 rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 ${
            destructive ? 'bg-red-600 hover:bg-red-500' : 'bg-cyan-600 hover:bg-cyan-500'
          }`}
        >
          {isPending ? 'Please wait...' : confirmLabel}
        </button>
      </div>
    </Modal>
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
  const [totpUri, setTotpUri] = useState(null);
  const [confirmTotpReset, setConfirmTotpReset] = useState(null);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteResult, setInviteResult] = useState(null);
  const [revokeTarget, setRevokeTarget] = useState(null);

  const usersQuery = useQuery({
    queryKey: ['users'],
    queryFn: () => client.getUsers(),
  });

  const deleteMutation = useMutation({
    mutationFn: (username) => client.deleteUser(username),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toast('User deleted successfully');
      setDeleteTarget(null);
    },
    onError: (err) => {
      toast(err.message, 'error');
      setDeleteTarget(null);
    },
  });

  const totpMutation = useMutation({
    mutationFn: (username) => client.resetTotp(username),
    onSuccess: (data) => {
      setConfirmTotpReset(null);
      setTotpUri(data.totpUri);
    },
    onError: (err) => {
      toast(err.message, 'error');
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
      toast(err.message, 'error');
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
            Manage Authelia users and two-factor authentication.
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
                <th className="px-4 py-3 text-xs font-semibold uppercase text-zinc-400 text-right">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.username} className="border-b border-zinc-700 last:border-b-0">
                  <td className="px-4 py-3 font-mono text-sm text-cyan-400">{u.username}</td>
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
                      <button
                        type="button"
                        onClick={() => !isLastUser && setDeleteTarget(u.username)}
                        disabled={isLastUser}
                        className="rounded p-1.5 text-zinc-500 hover:bg-zinc-700 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-30"
                        title={isLastUser ? 'Cannot delete the last user' : 'Delete user'}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
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
                  <td className="px-4 py-3 font-mono text-sm text-cyan-400">{inv.username}</td>
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
        <ConfirmDialog
          title="Delete User"
          message={`Are you sure you want to delete user '${deleteTarget}'? This action cannot be undone.`}
          confirmLabel="Delete"
          destructive
          onConfirm={() => deleteMutation.mutate(deleteTarget)}
          onCancel={() => setDeleteTarget(null)}
          isPending={deleteMutation.isPending}
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
    </div>
  );
}

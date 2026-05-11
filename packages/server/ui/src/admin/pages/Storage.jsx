import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { HardDrive, Plus, Trash2, Link2, Unlink, AlertCircle, Loader2, X } from 'lucide-react';
import { useToast } from '../components/Toast.jsx';
import { useAdminClient } from '../context/AdminClientContext.jsx';
import { errorMessage } from '../lib/errorMessage.js';
import { relativeTime } from '../lib/formatters.js';

function RegisterServerModal({ onClose }) {
  const client = useAdminClient();
  const queryClient = useQueryClient();
  const addToast = useToast();

  const [form, setForm] = useState({
    id: crypto.randomUUID(),
    label: '',
    provider: 'digitalocean-spaces',
    region: '',
    bucket: '',
    endpoint: '',
    accessKey: '',
    secretKey: '',
  });

  const mutation = useMutation({
    mutationFn: (data) => client.registerStorageServer(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['storage-servers'] });
      addToast('Storage server registered');
      onClose();
    },
    onError: (err) => addToast(errorMessage(err), 'error'),
  });

  const update = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  const isValid =
    form.label && form.region && form.bucket && form.endpoint && form.accessKey && form.secretKey;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="w-full max-w-lg rounded-xl bg-zinc-900 border border-zinc-700 p-6 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white">Register Storage Server</h3>
          <button type="button" onClick={onClose} className="text-zinc-400 hover:text-white">
            <X size={20} />
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate(form);
          }}
          className="space-y-4"
        >
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-1">Label</label>
            <input
              type="text"
              value={form.label}
              onChange={(e) => update('label', e.target.value)}
              placeholder="my-storage"
              className="w-full rounded bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-1">Provider</label>
              <select
                value={form.provider}
                onChange={(e) => update('provider', e.target.value)}
                className="w-full rounded bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-zinc-200 focus:border-cyan-500 focus:outline-none"
              >
                <option value="digitalocean-spaces">DigitalOcean Spaces</option>
                <option value="s3">Amazon S3</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-1">Region</label>
              <input
                type="text"
                value={form.region}
                onChange={(e) => update('region', e.target.value)}
                placeholder="nyc3"
                className="w-full rounded bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-1">Bucket</label>
            <input
              type="text"
              value={form.bucket}
              onChange={(e) => update('bucket', e.target.value)}
              placeholder="my-bucket"
              className="w-full rounded bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-1">Endpoint URL</label>
            <input
              type="url"
              value={form.endpoint}
              onChange={(e) => update('endpoint', e.target.value)}
              placeholder="https://nyc3.digitaloceanspaces.com"
              className="w-full rounded bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-1">Access Key</label>
            <input
              type="password"
              value={form.accessKey}
              onChange={(e) => update('accessKey', e.target.value)}
              className="w-full rounded bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-zinc-200 font-mono focus:border-cyan-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-1">Secret Key</label>
            <input
              type="password"
              value={form.secretKey}
              onChange={(e) => update('secretKey', e.target.value)}
              className="w-full rounded bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-zinc-200 font-mono focus:border-cyan-500 focus:outline-none"
            />
          </div>

          <div className="rounded bg-amber-500/10 border border-amber-500/20 px-3 py-2">
            <p className="text-xs text-amber-300">
              Credentials are encrypted at rest using AES-256-GCM. They never leave the server.
            </p>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded bg-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-600"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!isValid || mutation.isPending}
              className="rounded bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-500 disabled:opacity-50"
            >
              {mutation.isPending ? (
                <Loader2 size={14} className="animate-spin inline mr-1" />
              ) : null}
              Register
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function BindPluginModal({ servers, onClose }) {
  const client = useAdminClient();
  const queryClient = useQueryClient();
  const addToast = useToast();

  const [pluginName, setPluginName] = useState('');
  const [storageServerId, setStorageServerId] = useState(servers[0]?.id || '');

  const pluginsQuery = useQuery({
    queryKey: ['plugins'],
    queryFn: () => client.getPlugins(),
  });

  const mutation = useMutation({
    mutationFn: (data) => client.createStorageBinding(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['storage-bindings'] });
      addToast('Plugin bound to storage');
      onClose();
    },
    onError: (err) => addToast(errorMessage(err), 'error'),
  });

  const plugins = pluginsQuery.data?.plugins || [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="w-full max-w-md rounded-xl bg-zinc-900 border border-zinc-700 p-6 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white">Bind Plugin to Storage</h3>
          <button type="button" onClick={onClose} className="text-zinc-400 hover:text-white">
            <X size={20} />
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate({ pluginName, storageServerId });
          }}
          className="space-y-4"
        >
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-1">Plugin</label>
            <select
              value={pluginName}
              onChange={(e) => setPluginName(e.target.value)}
              className="w-full rounded bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-zinc-200 focus:border-cyan-500 focus:outline-none"
            >
              <option value="">Select a plugin...</option>
              {plugins.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.displayName || p.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-1">Storage Server</label>
            <select
              value={storageServerId}
              onChange={(e) => setStorageServerId(e.target.value)}
              className="w-full rounded bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-zinc-200 focus:border-cyan-500 focus:outline-none"
            >
              {servers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label} ({s.provider} / {s.region})
                </option>
              ))}
            </select>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded bg-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-600"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!pluginName || !storageServerId || mutation.isPending}
              className="rounded bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-500 disabled:opacity-50"
            >
              {mutation.isPending ? (
                <Loader2 size={14} className="animate-spin inline mr-1" />
              ) : null}
              Bind
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function Storage() {
  const client = useAdminClient();
  const queryClient = useQueryClient();
  const addToast = useToast();

  const [showRegister, setShowRegister] = useState(false);
  const [showBind, setShowBind] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [unbindTarget, setUnbindTarget] = useState(null);

  const serversQuery = useQuery({
    queryKey: ['storage-servers'],
    queryFn: () => client.getStorageServers(),
    refetchInterval: 10000,
  });

  const bindingsQuery = useQuery({
    queryKey: ['storage-bindings'],
    queryFn: () => client.getStorageBindings(),
    refetchInterval: 10000,
  });

  const deleteServerMutation = useMutation({
    mutationFn: (id) => client.deleteStorageServer(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['storage-servers'] });
      queryClient.invalidateQueries({ queryKey: ['storage-bindings'] });
      addToast('Storage server removed');
      setDeleteTarget(null);
    },
    onError: (err) => {
      addToast(errorMessage(err), 'error');
      setDeleteTarget(null);
    },
  });

  const unbindMutation = useMutation({
    mutationFn: (pluginName) => client.deleteStorageBinding(pluginName),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['storage-bindings'] });
      addToast('Plugin unbound from storage');
      setUnbindTarget(null);
    },
    onError: (err) => {
      addToast(errorMessage(err), 'error');
      setUnbindTarget(null);
    },
  });

  const servers = serversQuery.data?.servers || [];
  const bindings = bindingsQuery.data?.bindings || [];

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-white">Storage</h1>
        <p className="text-zinc-500 text-sm mt-1">
          Manage S3-compatible storage servers and bind them to plugins.
        </p>
      </div>

      {/* Storage Servers */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <HardDrive size={18} className="text-cyan-400" />
            Storage Servers
          </h2>
          <button
            type="button"
            onClick={() => setShowRegister(true)}
            className="flex items-center gap-2 rounded bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-500"
          >
            <Plus size={14} />
            Register Server
          </button>
        </div>

        {serversQuery.isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 2 }).map((_, i) => (
              <div
                key={i}
                className="h-14 animate-pulse rounded-lg bg-zinc-900 border border-zinc-800"
              />
            ))}
          </div>
        ) : serversQuery.isError ? (
          <div className="rounded-lg bg-zinc-900 border border-zinc-800 p-6">
            <div className="flex items-center gap-2 text-red-400 text-sm">
              <AlertCircle size={16} />
              Failed to load storage servers
            </div>
          </div>
        ) : servers.length === 0 ? (
          <div className="rounded-lg bg-zinc-900 border border-zinc-800 p-8 text-center">
            <HardDrive size={32} className="mx-auto text-zinc-600 mb-3" />
            <p className="text-zinc-400 text-sm">
              No storage servers registered. Register one to enable plugin storage.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-zinc-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-700 bg-zinc-900">
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-zinc-400">
                    Label
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-zinc-400">
                    Provider
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-zinc-400 hidden md:table-cell">
                    Region
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-zinc-400 hidden lg:table-cell">
                    Bucket
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-zinc-400 hidden lg:table-cell">
                    Registered
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium uppercase text-zinc-400">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {servers.map((server) => (
                  <tr key={server.id} className="border-b border-zinc-700 bg-zinc-800">
                    <td className="px-4 py-3 text-zinc-200 font-semibold">{server.label}</td>
                    <td className="px-4 py-3 text-zinc-400">{server.provider}</td>
                    <td className="px-4 py-3 text-zinc-400 hidden md:table-cell">
                      {server.region}
                    </td>
                    <td className="px-4 py-3 text-zinc-400 font-mono text-xs hidden lg:table-cell">
                      {server.bucket}
                    </td>
                    <td className="px-4 py-3 text-zinc-500 hidden lg:table-cell">
                      {server.registeredAt ? relativeTime(server.registeredAt) : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(server)}
                        className="inline-flex items-center gap-1.5 rounded bg-zinc-700 px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-red-600/20 hover:text-red-400"
                        title="Remove server"
                      >
                        <Trash2 size={12} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Plugin Bindings */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <Link2 size={18} className="text-cyan-400" />
            Plugin Bindings
          </h2>
          {servers.length > 0 && (
            <button
              type="button"
              onClick={() => setShowBind(true)}
              className="flex items-center gap-2 rounded bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-500"
            >
              <Plus size={14} />
              Bind Plugin
            </button>
          )}
        </div>

        {bindingsQuery.isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 2 }).map((_, i) => (
              <div
                key={i}
                className="h-14 animate-pulse rounded-lg bg-zinc-900 border border-zinc-800"
              />
            ))}
          </div>
        ) : bindingsQuery.isError ? (
          <div className="rounded-lg bg-zinc-900 border border-zinc-800 p-6">
            <div className="flex items-center gap-2 text-red-400 text-sm">
              <AlertCircle size={16} />
              Failed to load bindings
            </div>
          </div>
        ) : bindings.length === 0 ? (
          <div className="rounded-lg bg-zinc-900 border border-zinc-800 p-8 text-center">
            <Link2 size={32} className="mx-auto text-zinc-600 mb-3" />
            <p className="text-zinc-400 text-sm">
              No plugins bound to storage.{' '}
              {servers.length === 0
                ? 'Register a storage server first.'
                : 'Use the button above to bind one.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-zinc-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-700 bg-zinc-900">
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-zinc-400">
                    Plugin
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-zinc-400">
                    Storage Server
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-zinc-400 hidden md:table-cell">
                    Bound
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium uppercase text-zinc-400">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {bindings.map((binding) => {
                  const server = servers.find((s) => s.id === binding.storageServerId);
                  return (
                    <tr key={binding.pluginName} className="border-b border-zinc-700 bg-zinc-800">
                      <td className="px-4 py-3 text-zinc-200 font-semibold">
                        {binding.pluginName}
                      </td>
                      <td className="px-4 py-3 text-zinc-400">
                        {server?.label || binding.storageServerId.slice(0, 8)}
                      </td>
                      <td className="px-4 py-3 text-zinc-500 hidden md:table-cell">
                        {binding.boundAt ? relativeTime(binding.boundAt) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => setUnbindTarget(binding.pluginName)}
                          className="inline-flex items-center gap-1.5 rounded bg-zinc-700 px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-red-600/20 hover:text-red-400"
                          title="Unbind plugin"
                        >
                          <Unlink size={12} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Register Server Modal */}
      {showRegister && <RegisterServerModal onClose={() => setShowRegister(false)} />}

      {/* Bind Plugin Modal */}
      {showBind && <BindPluginModal servers={servers} onClose={() => setShowBind(false)} />}

      {/* Delete Server Confirmation */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="w-full max-w-sm rounded-xl border border-zinc-700 bg-zinc-900 p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-white mb-3">Remove Storage Server</h3>
            <p className="text-sm text-zinc-400 mb-2">
              Are you sure you want to remove{' '}
              <strong className="text-white">{deleteTarget.label}</strong>?
            </p>
            <p className="text-xs text-amber-400 mb-4">
              All plugin bindings to this server will also be removed.
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="rounded bg-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-600"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleteServerMutation.isPending}
                onClick={() => deleteServerMutation.mutate(deleteTarget.id)}
                className="rounded bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50"
              >
                {deleteServerMutation.isPending ? 'Removing...' : 'Remove'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Unbind Confirmation */}
      {unbindTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="w-full max-w-sm rounded-xl border border-zinc-700 bg-zinc-900 p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-white mb-3">Unbind Plugin</h3>
            <p className="text-sm text-zinc-400 mb-4">
              Remove storage binding for <strong className="text-white">{unbindTarget}</strong>?
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setUnbindTarget(null)}
                className="rounded bg-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-600"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={unbindMutation.isPending}
                onClick={() => unbindMutation.mutate(unbindTarget)}
                className="rounded bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50"
              >
                {unbindMutation.isPending ? 'Unbinding...' : 'Unbind'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

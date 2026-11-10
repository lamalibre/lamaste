import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Pencil,
  Plus,
  Power,
  Smartphone,
  Trash2,
} from 'lucide-react';
import { NATIVE_ACCESS_TOKEN_MINUTES, NATIVE_LIFETIME_DAYS } from '@lamalibre/lamaste/native-apps';
import { useAdminClient } from '../context/AdminClientContext.jsx';
import { useToast } from '../components/Toast.jsx';
import { ConfirmDialog, DialogButtons, Modal } from '../components/Dialog.jsx';
import { ClientGrants, invalidateNativeGrants } from '../components/NativeGrants.jsx';
import { errorMessage } from '../lib/errorMessage.js';
import {
  associationFileUrls,
  associationsFromForm,
  associationsToForm,
  nativeClientIdOf,
  nativeClientStatusText,
  nativeHostChoices,
  splitList,
} from '../lib/native-apps.js';

const BUTTON =
  'inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:border-cyan-600 hover:text-white disabled:opacity-50';
const INPUT =
  'w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-white placeholder-zinc-600 focus:border-cyan-500 focus:outline-none';
const LABEL = 'mb-1 block text-xs text-zinc-400';

function invalidateClients(queryClient) {
  queryClient.invalidateQueries({ queryKey: ['native-apps'] });
  invalidateNativeGrants(queryClient);
}

/** Toast the panel's warnings beside a success (Authelia, Gatekeeper, the vhost). */
function toastWarnings(toast, result) {
  for (const w of result?.warnings ?? []) {
    toast(typeof w === 'string' ? w : w.message, 'error');
  }
}

function NumberField({ label, value, onChange, min, max }) {
  return (
    <label className="block">
      <span className={LABEL}>{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className={INPUT}
      />
    </label>
  );
}

/**
 * The fields a client's settings share between create and edit: its name,
 * redirect paths, lifetimes and app associations.
 */
function SettingsFields({ form, set }) {
  return (
    <div className="space-y-3">
      <label className="block">
        <span className={LABEL}>Name (shown on the sign-in consent screen)</span>
        <input
          className={INPUT}
          value={form.name}
          onChange={(e) => set({ name: e.target.value })}
        />
      </label>
      <label className="block">
        <span className={LABEL}>
          Redirect paths on the host (1–4, e.g. /oauth/callback) — the app claims them
        </span>
        <textarea
          rows={2}
          className={`${INPUT} font-mono`}
          value={form.redirectPaths}
          onChange={(e) => set({ redirectPaths: e.target.value })}
        />
      </label>
      <div className="grid grid-cols-3 gap-2">
        <NumberField
          label="Access token (min)"
          value={form.accessTokenMinutes}
          min={NATIVE_ACCESS_TOKEN_MINUTES.min}
          max={NATIVE_ACCESS_TOKEN_MINUTES.max}
          onChange={(v) => set({ accessTokenMinutes: v })}
        />
        <NumberField
          label="Idle (days)"
          value={form.idleDays}
          min={NATIVE_LIFETIME_DAYS.min}
          max={NATIVE_LIFETIME_DAYS.max}
          onChange={(v) => set({ idleDays: v })}
        />
        <NumberField
          label="Absolute (days)"
          value={form.absoluteDays}
          min={NATIVE_LIFETIME_DAYS.min}
          max={NATIVE_LIFETIME_DAYS.max}
          onChange={(v) => set({ absoluteDays: v })}
        />
      </div>
      <fieldset className="space-y-2 rounded-lg border border-zinc-700 p-3">
        <legend className="px-1 text-xs text-zinc-400">iOS (apple-app-site-association)</legend>
        <input
          className={`${INPUT} font-mono`}
          placeholder="Team id (10 characters)"
          value={form.teamId}
          onChange={(e) => set({ teamId: e.target.value })}
        />
        <textarea
          rows={2}
          className={`${INPUT} font-mono`}
          placeholder="Bundle ids, one per line"
          value={form.bundleIds}
          onChange={(e) => set({ bundleIds: e.target.value })}
        />
      </fieldset>
      <fieldset className="rounded-lg border border-zinc-700 p-3">
        <legend className="px-1 text-xs text-zinc-400">Android (assetlinks.json)</legend>
        <textarea
          rows={3}
          className={`${INPUT} font-mono`}
          placeholder="One app per line: package name, then SHA-256 certificate fingerprints"
          value={form.android}
          onChange={(e) => set({ android: e.target.value })}
        />
      </fieldset>
    </div>
  );
}

/** The request body of a settings form. */
function settingsBody(form) {
  return {
    name: form.name.trim(),
    redirectPaths: splitList(form.redirectPaths),
    accessTokenMinutes: form.accessTokenMinutes,
    idleDays: form.idleDays,
    absoluteDays: form.absoluteDays,
    associations: associationsFromForm(form),
  };
}

function formOf(client) {
  return {
    name: client.name,
    redirectPaths: client.redirectPaths.join('\n'),
    accessTokenMinutes: client.accessTokenMinutes,
    idleDays: client.idleDays,
    absoluteDays: client.absoluteDays,
    ...associationsToForm(client.associations),
  };
}

function CreateClientModal({ hosts, onClose }) {
  const client = useAdminClient();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [host, setHost] = useState(hosts[0] ? `${hosts[0].kind}:${hosts[0].id}` : '');
  const [slug, setSlug] = useState('');
  const [form, setForm] = useState({
    name: '',
    redirectPaths: '/oauth/callback',
    accessTokenMinutes: NATIVE_ACCESS_TOKEN_MINUTES.default,
    idleDays: NATIVE_LIFETIME_DAYS.idleDefault,
    absoluteDays: NATIVE_LIFETIME_DAYS.absoluteDefault,
    teamId: '',
    bundleIds: '',
    android: '',
  });
  const set = (change) => setForm((previous) => ({ ...previous, ...change }));
  const create = useMutation({
    mutationFn: () => {
      const [hostKind, hostId] = host.split(/:(.*)/s);
      return client.createNativeApp({ slug, hostKind, hostId, ...settingsBody(form) });
    },
    onSuccess: (result) => {
      invalidateClients(queryClient);
      toast(`Native client ${result.client.clientId} registered`);
      toastWarnings(toast, result);
      onClose();
    },
    onError: (err) => toast(errorMessage(err), 'error'),
  });
  return (
    <Modal onClose={onClose}>
      <h2 className="mb-4 text-lg font-bold text-white">Register a native app</h2>
      {hosts.length === 0 ? (
        <p className="text-sm text-zinc-400">
          No application host is free: a native client belongs to a plugin-owned site or a tunnel
          bound to plugin routes, one per host.
        </p>
      ) : (
        <div className="space-y-3">
          <label className="block">
            <span className={LABEL}>Application host</span>
            <select className={INPUT} value={host} onChange={(e) => setHost(e.target.value)}>
              {hosts.map((h) => (
                <option key={`${h.kind}:${h.id}`} value={`${h.kind}:${h.id}`}>
                  {h.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={LABEL}>
              Client id: <span className="font-mono">{nativeClientIdOf(slug || '<slug>')}</span>
            </span>
            <input
              className={`${INPUT} font-mono`}
              placeholder="slug (lowercase letters, digits, hyphens)"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
            />
          </label>
          <SettingsFields form={form} set={set} />
          <DialogButtons
            confirmLabel="Register"
            disabled={!slug || !form.name.trim()}
            isPending={create.isPending}
            onConfirm={() => create.mutate()}
            onCancel={onClose}
          />
        </div>
      )}
    </Modal>
  );
}

function EditClientModal({ nativeClient, onClose }) {
  const client = useAdminClient();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState(() => formOf(nativeClient));
  const set = (change) => setForm((previous) => ({ ...previous, ...change }));
  const update = useMutation({
    mutationFn: () => client.updateNativeApp(nativeClient.clientId, settingsBody(form)),
    onSuccess: (result) => {
      invalidateClients(queryClient);
      toast('Native client changed');
      toastWarnings(toast, result);
      onClose();
    },
    onError: (err) => toast(errorMessage(err), 'error'),
  });
  return (
    <Modal onClose={onClose}>
      <h2 className="mb-4 text-lg font-bold text-white">
        Edit <span className="font-mono">{nativeClient.clientId}</span>
      </h2>
      <div className="space-y-3">
        <SettingsFields form={form} set={set} />
        <DialogButtons
          confirmLabel="Save"
          disabled={!form.name.trim()}
          isPending={update.isPending}
          onConfirm={() => update.mutate()}
          onCancel={onClose}
        />
      </div>
    </Modal>
  );
}

function ClientCard({ nativeClient: c }) {
  const client = useAdminClient();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const change = useMutation({
    mutationFn: (action) =>
      action === 'delete'
        ? client.deleteNativeApp(c.clientId)
        : client.updateNativeApp(c.clientId, { enabled: action === 'enable' }),
    onSuccess: (result, action) => {
      invalidateClients(queryClient);
      toast(
        action === 'delete'
          ? `${c.clientId} deleted — its grants ended`
          : action === 'enable'
            ? `${c.clientId} enabled`
            : `${c.clientId} disabled — its grants ended`,
      );
      toastWarnings(toast, result);
      setConfirm(null);
    },
    onError: (err) => {
      toast(errorMessage(err), 'error');
      setConfirm(null);
    },
  });
  const files = associationFileUrls(c);

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-sm text-cyan-400">{c.clientId}</p>
          <p className="text-sm text-white">{c.name}</p>
          <p className="text-xs text-zinc-400">
            {c.hostKind} <span className="font-mono">{c.fqdn ?? c.hostId}</span>
            {c.accessMode ? ` · ${c.accessMode}` : ''} ·{' '}
            <span className={c.served ? 'text-green-400' : 'text-yellow-400'}>
              {nativeClientStatusText(c)}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={BUTTON} onClick={() => setEditing(true)}>
            <Pencil size={14} /> Edit
          </button>
          <button
            type="button"
            className={BUTTON}
            disabled={change.isPending}
            onClick={() => (c.enabled ? setConfirm('disable') : change.mutate('enable'))}
          >
            <Power size={14} /> {c.enabled ? 'Disable' : 'Enable'}
          </button>
          <button type="button" className={BUTTON} onClick={() => setConfirm('delete')}>
            <Trash2 size={14} /> Delete
          </button>
          <button type="button" className={BUTTON} onClick={() => setOpen(!open)}>
            {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />} Grants
          </button>
        </div>
      </div>
      <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
        <div>
          <dt className="inline text-zinc-500">Audience </dt>
          <dd className="inline font-mono text-zinc-300">{c.audience ?? '—'}</dd>
        </div>
        <div>
          <dt className="inline text-zinc-500">Lifetimes </dt>
          <dd className="inline text-zinc-300">
            access {c.accessTokenMinutes} min · idle {c.idleDays} d · absolute {c.absoluteDays} d
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="inline text-zinc-500">Redirect URIs </dt>
          <dd className="inline font-mono text-zinc-300">
            {c.redirectUris.length > 0 ? c.redirectUris.join(', ') : c.redirectPaths.join(', ')}
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="inline text-zinc-500">Plugins served </dt>
          <dd className="inline font-mono text-zinc-300">
            {c.servedRoutes.length > 0 ? c.servedRoutes.join(', ') : 'none'}
            {c.routes.length > c.servedRoutes.length &&
              ` (bound, not served: ${c.routes.filter((r) => !c.servedRoutes.includes(r)).join(', ')})`}
          </dd>
        </div>
        {files.length > 0 && (
          <div className="sm:col-span-2">
            <dt className="text-zinc-500">App association files</dt>
            {files.map((url) => (
              <dd key={url}>
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-mono text-cyan-400 hover:underline"
                >
                  {url} <ExternalLink size={12} />
                </a>
              </dd>
            ))}
          </div>
        )}
      </dl>
      {open && (
        <div className="mt-3 border-t border-zinc-800 pt-3">
          <ClientGrants clientId={c.clientId} />
        </div>
      )}
      {editing && <EditClientModal nativeClient={c} onClose={() => setEditing(false)} />}
      {confirm && (
        <ConfirmDialog
          title={confirm === 'delete' ? `Delete ${c.clientId}?` : `Disable ${c.clientId}?`}
          message={
            confirm === 'delete'
              ? 'The app can no longer sign anyone in; every grant ends and the host stops serving its association files.'
              : 'Nobody can sign in with the app until it is enabled again, and every grant ends now.'
          }
          confirmLabel={confirm === 'delete' ? 'Delete client' : 'Disable client'}
          destructive
          isPending={change.isPending}
          onConfirm={() => change.mutate(confirm)}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}

/**
 * Native (mobile) apps: one OIDC client per application host, signing
 * people in with PKCE and calling the host's plugins with bearer tokens;
 * each person's sign-in on a device is a grant that ends with their
 * standing.
 */
export default function NativeApps() {
  const client = useAdminClient();
  const [creating, setCreating] = useState(false);
  const clients = useQuery({ queryKey: ['native-apps'], queryFn: () => client.listNativeApps() });
  const tunnels = useQuery({ queryKey: ['tunnels'], queryFn: () => client.getTunnels() });
  const sites = useQuery({ queryKey: ['sites'], queryFn: () => client.getSites() });
  const list = clients.data?.clients ?? [];
  const hosts = nativeHostChoices({
    tunnels: tunnels.data?.tunnels ?? [],
    sites: sites.data?.sites ?? [],
    clients: list,
  });
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Smartphone className="text-cyan-400" size={24} />
          <div>
            <h1 className="text-2xl font-bold text-white">Native apps</h1>
            <p className="text-sm text-zinc-400">
              A mobile app signs people in through the domain’s sign-in and calls every plugin of
              its host with one access token, checked as a browser session is.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-500"
        >
          <Plus size={16} /> Register app
        </button>
      </div>
      {clients.isLoading && <p className="text-sm text-zinc-500">Loading native apps…</p>}
      {clients.isError && (
        <p className="flex items-center gap-2 text-sm text-red-400">
          <AlertCircle size={16} /> {errorMessage(clients.error)}
        </p>
      )}
      {!clients.isLoading && list.length === 0 && (
        <p className="text-sm text-zinc-500">No native app is registered.</p>
      )}
      <div className="space-y-4">
        {list.map((c) => (
          <ClientCard key={c.clientId} nativeClient={c} />
        ))}
      </div>
      {creating && <CreateClientModal hosts={hosts} onClose={() => setCreating(false)} />}
    </div>
  );
}

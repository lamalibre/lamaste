import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Eraser,
  Loader2,
  Plus,
  RefreshCw,
  ShieldAlert,
  Trash2,
  User,
  Users,
} from 'lucide-react';
import { useAdminClient } from '../context/AdminClientContext.jsx';
import { useToast } from './Toast.jsx';
import CopyableId from './CopyableId.jsx';
import { errorMessage } from '../lib/errorMessage.js';
import { relativeTime } from '../lib/formatters.js';
import { externalUserIds } from '../lib/domains.js';
import { ExternalBadge } from './DomainChoice.jsx';
import {
  attributeLabel,
  audienceRowView,
  readinessText,
  removeReasonText,
  toggledRoles,
  warningText,
} from '../lib/identity.js';

/** Refetch what an entitlement change or a sync changes. */
function invalidatePeople(queryClient, name) {
  queryClient.invalidateQueries({ queryKey: ['plugin-identity', name] });
  queryClient.invalidateQueries({ queryKey: ['plugin-audience', name] });
  queryClient.invalidateQueries({ queryKey: ['plugin-entitlements', name] });
  // Entitlements are Gatekeeper grants.
  queryClient.invalidateQueries({ queryKey: ['gatekeeper-grants'] });
}

/** `14:05 (12m ago)`, measured against `now` (when the data was fetched); a dash for none. */
function moment(iso, now) {
  if (!iso) return '—';
  return `${new Date(iso).toLocaleString()} (${relativeTime(iso, now)})`;
}

function SectionTitle({ children }) {
  return <p className="mb-1.5 text-zinc-500">{children}</p>;
}

/** The roles and attributes the installed version declares, its approval and readiness. */
function DeclaredSection({ view }) {
  const { declared, readiness, approval } = view;
  const ready = readinessText(readiness);
  return (
    <div className="space-y-2">
      <div>
        <SectionTitle>Roles the installed version declares:</SectionTitle>
        <ul className="space-y-0.5">
          {declared.roles.map((role) => (
            <li key={role.id}>
              <span className="font-mono text-zinc-200">{role.id}</span>
              <span className="text-zinc-400"> — {role.label}</span>
              {role.description && <span className="text-zinc-600"> · {role.description}</span>}
            </li>
          ))}
        </ul>
      </div>
      <p className="text-zinc-400">
        Each member reaches it with their user id, username, roles and status
        {declared.attributes.length > 0
          ? `, and their ${declared.attributes.map(attributeLabel).join(' and ')}`
          : ' — nothing else about them'}
        .
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {approval.approved ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-green-500/15 px-2 py-0.5 text-green-400">
            <Check size={11} /> identity approved
          </span>
        ) : (
          <span
            className="inline-flex items-center gap-1 rounded-full bg-yellow-500/15 px-2 py-0.5 text-yellow-400"
            title="Its users are sent to it, and reach it, only once it is approved"
          >
            <ShieldAlert size={11} /> identity waits for approval (Lifecycle hooks)
          </span>
        )}
        <span className={ready.ready ? 'text-green-400' : 'text-yellow-400'}>{ready.text}</span>
      </div>
    </div>
  );
}

/** One principal's roles: a checkbox per declared role, the undeclared ones it still carries, removal. */
function EntitlementRow({ entitlement, roles, onSet, onRemove, busy }) {
  const [confirming, setConfirming] = useState(false);
  const declaredHeld = entitlement.roles.filter((role) => roles.some((r) => r.id === role));
  const Icon = entitlement.principalType === 'user' ? User : Users;
  return (
    <li className="rounded bg-zinc-900 px-2 py-1.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="inline-flex items-center gap-1">
          <Icon
            size={11}
            className={entitlement.principalType === 'user' ? 'text-blue-400' : 'text-purple-400'}
          />
          <span className="font-mono text-zinc-200">{entitlement.principalId}</span>
          {entitlement.principalType === 'group' && <span className="text-zinc-600">group</span>}
        </span>
        {entitlement.principalType === 'user' && (
          <CopyableId id={entitlement.userId} missing="not in the user directory" />
        )}
        <span className="flex flex-wrap items-center gap-2">
          {roles.map((role) => {
            const held = declaredHeld.includes(role.id);
            // The last role goes with the entitlement itself (Remove).
            const last = held && declaredHeld.length === 1;
            return (
              <label
                key={role.id}
                className="flex items-center gap-1 text-zinc-300"
                title={last ? 'The last role — remove the entitlement instead' : role.label}
              >
                <input
                  type="checkbox"
                  checked={held}
                  disabled={busy || last}
                  onChange={(e) =>
                    onSet(entitlement, toggledRoles(declaredHeld, role.id, e.target.checked))
                  }
                />
                <span className="font-mono">{role.id}</span>
              </label>
            );
          })}
          {entitlement.unknownRoles.map((role) => (
            <span
              key={role}
              className="font-mono text-zinc-600 line-through"
              title="The installed version no longer declares this role: it counts for nothing"
            >
              {role}
            </span>
          ))}
        </span>
        <span className="ml-auto">
          {confirming ? (
            <span className="flex items-center gap-1.5">
              <span className="text-zinc-400">Remove every role?</span>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setConfirming(false);
                  onRemove(entitlement);
                }}
                className="rounded bg-red-600 px-2 py-0.5 text-white hover:bg-red-500 disabled:opacity-50"
              >
                Remove
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="rounded bg-zinc-700 px-2 py-0.5 text-zinc-300 hover:bg-zinc-600"
              >
                Cancel
              </button>
            </span>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirming(true)}
              title="Revoke every role this principal holds on the plugin"
              className="text-zinc-500 hover:text-red-400 disabled:opacity-50"
            >
              <Trash2 size={12} />
            </button>
          )}
        </span>
      </div>
    </li>
  );
}

/** Give a user or a Lamaste group roles on the plugin. */
function AddEntitlement({ roles, taken, onSet, busy }) {
  const client = useAdminClient();
  const [principalType, setPrincipalType] = useState('user');
  const [principalId, setPrincipalId] = useState('');
  const [chosen, setChosen] = useState([]);

  const usersQuery = useQuery({ queryKey: ['users'], queryFn: () => client.getUsers() });
  const groupsQuery = useQuery({
    queryKey: ['gatekeeper-groups'],
    queryFn: () => client.getGatekeeperGroups(),
    retry: false,
  });

  const free = (id) => !taken.has(`${principalType}:${id}`);
  const options =
    principalType === 'user'
      ? (usersQuery.data?.users ?? [])
          .filter((u) => free(u.username))
          .map((u) => ({
            id: u.username,
            label: `${u.username}${u.status === 'disabled' ? ' (disabled)' : ''}`,
          }))
      : (groupsQuery.data?.groups ?? [])
          .filter((g) => free(g.name))
          .map((g) => ({ id: g.name, label: g.name }));
  const listError =
    principalType === 'user'
      ? usersQuery.isError && 'Users could not be listed'
      : groupsQuery.isError &&
        `Lamaste groups could not be listed: ${errorMessage(groupsQuery.error)}`;

  const submit = (e) => {
    e.preventDefault();
    if (!principalId || chosen.length === 0) return;
    onSet({ principalType, principalId, roles: [...chosen].sort() }, () => {
      setPrincipalId('');
      setChosen([]);
    });
  };

  return (
    <form onSubmit={submit} className="space-y-2 rounded border border-zinc-800 p-2">
      <div className="flex flex-wrap items-center gap-2">
        {['user', 'group'].map((type) => (
          <button
            key={type}
            type="button"
            onClick={() => {
              setPrincipalType(type);
              setPrincipalId('');
            }}
            className={`rounded px-2 py-0.5 ${principalType === type ? 'bg-cyan-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'}`}
          >
            {type === 'user' ? 'User' : 'Group'}
          </button>
        ))}
        <select
          value={principalId}
          onChange={(e) => setPrincipalId(e.target.value)}
          aria-label={principalType === 'user' ? 'User' : 'Lamaste group'}
          className="min-w-40 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-zinc-200 focus:border-cyan-400 focus:outline-none"
        >
          <option value="">
            {principalType === 'user' ? 'Select a user…' : 'Select a Lamaste group…'}
          </option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-zinc-500">Roles:</span>
        {roles.map((role) => (
          <label key={role.id} className="flex items-center gap-1 text-zinc-300" title={role.label}>
            <input
              type="checkbox"
              checked={chosen.includes(role.id)}
              onChange={(e) => setChosen((prev) => toggledRoles(prev, role.id, e.target.checked))}
            />
            <span className="font-mono">{role.id}</span>
          </label>
        ))}
        <button
          type="submit"
          disabled={busy || !principalId || chosen.length === 0}
          className="ml-auto flex items-center gap-1 rounded bg-cyan-600 px-2.5 py-1 text-white hover:bg-cyan-500 disabled:opacity-50"
        >
          <Plus size={11} /> Give roles
        </button>
      </div>
      {listError && <p className="text-red-400">{listError}</p>}
      {principalType === 'group' && (
        <p className="text-zinc-600">
          A Lamaste group&apos;s members hold its roles while they are in it.
        </p>
      )}
    </form>
  );
}

/**
 * Who may use the plugin, with which of its roles: Gatekeeper plugin grants
 * with roles, to users or Lamaste groups. Grants without roles (desktop
 * installs, migrated legacy grants) never make anyone a member.
 */
function EntitlementsSection({ plugin, roles }) {
  const client = useAdminClient();
  const queryClient = useQueryClient();
  const addToast = useToast();
  const query = useQuery({
    queryKey: ['plugin-entitlements', plugin.name],
    queryFn: () => client.getPluginEntitlements(plugin.name),
  });
  const toastWarnings = (warnings) => {
    for (const warning of warnings ?? []) addToast(warningText(warning), 'error');
  };
  const set = useMutation({
    mutationFn: (entitlement) => client.setPluginEntitlement(plugin.name, entitlement),
    onSuccess: (data, entitlement) => {
      invalidatePeople(queryClient, plugin.name);
      addToast(
        data.changed
          ? `${entitlement.principalId}: ${entitlement.roles.join(', ')}`
          : `${entitlement.principalId} already holds exactly these roles`,
      );
      toastWarnings(data.warnings);
    },
    onError: (err) => addToast(errorMessage(err), 'error'),
  });
  const remove = useMutation({
    mutationFn: (principal) => client.removePluginEntitlement(plugin.name, principal),
    onSuccess: (data, principal) => {
      invalidatePeople(queryClient, plugin.name);
      addToast(`${principal.principalId} holds no role on ${plugin.name} any more`);
      toastWarnings(data.warnings);
    },
    onError: (err) => addToast(errorMessage(err), 'error'),
  });
  const busy = set.isPending || remove.isPending;
  const entitlements = query.data?.entitlements ?? [];
  const taken = new Set(entitlements.map((e) => `${e.principalType}:${e.principalId}`));

  return (
    <div className="space-y-2">
      <SectionTitle>Entitlements — who may use it, with which roles:</SectionTitle>
      {query.isLoading ? (
        <Loader2 size={12} className="animate-spin text-zinc-500" />
      ) : query.isError ? (
        <p className="text-red-400">{errorMessage(query.error)}</p>
      ) : entitlements.length === 0 ? (
        <p className="text-zinc-600">Nobody yet — give a user or a Lamaste group a role below.</p>
      ) : (
        <ul className="space-y-1">
          {entitlements.map((entitlement) => (
            <EntitlementRow
              key={`${entitlement.principalType}:${entitlement.principalId}`}
              entitlement={entitlement}
              roles={roles}
              busy={busy}
              onSet={(e, next) =>
                set.mutate({
                  principalType: e.principalType,
                  principalId: e.principalId,
                  roles: next,
                })
              }
              onRemove={(e) =>
                remove.mutate({ principalType: e.principalType, principalId: e.principalId })
              }
            />
          ))}
        </ul>
      )}
      {query.data?.roleless > 0 && (
        <p className="text-zinc-600">
          {query.data.roleless} grant{query.data.roleless === 1 ? '' : 's'} on this plugin carr
          {query.data.roleless === 1 ? 'ies' : 'y'} no roles (desktop installs, migrated grants) —
          they never make anyone a member.
        </p>
      )}
      <AddEntitlement
        roles={roles}
        taken={taken}
        busy={busy}
        onSet={(entitlement, done) => set.mutate(entitlement, { onSuccess: done })}
      />
    </div>
  );
}

const STATUS_STYLE = {
  active: 'bg-green-500/15 text-green-400',
  disabled: 'bg-yellow-500/15 text-yellow-400',
  removed: 'bg-zinc-700/60 text-zinc-400',
  erased: 'bg-red-500/10 text-red-400',
  unknown: 'bg-zinc-700/60 text-zinc-500',
};

/** One audience row: who, their roles, where they stand. */
function AudienceRow({ view, now, external }) {
  const name =
    view.status === 'erased'
      ? 'erased'
      : view.displayName && view.username
        ? `${view.displayName} (${view.username})`
        : (view.username ?? '—');
  return (
    <tr className="border-t border-zinc-800">
      <td className={`py-1 pr-2 ${view.status === 'erased' ? 'text-zinc-600' : 'text-zinc-200'}`}>
        {name}
        {external && (
          <span className="ml-2">
            <ExternalBadge />
          </span>
        )}
      </td>
      <td className="py-1 pr-2">
        <CopyableId id={view.userId} />
      </td>
      <td className="py-1 pr-2 font-mono text-zinc-300">{view.roles.join(', ') || '—'}</td>
      <td className="py-1 pr-2">
        <span className={`rounded-full px-1.5 py-0.5 ${STATUS_STYLE[view.status]}`}>
          {view.status === 'removed' ? removeReasonText(view.reason) : view.status}
        </span>
      </td>
      <td className="py-1 text-zinc-600" title={`seq ${view.seq} · version ${view.version}`}>
        {relativeTime(view.updatedAt, now)}
      </td>
    </tr>
  );
}

/**
 * The plugin's audience as its agent half is told: the members, and — on
 * request — the users who left it (deleted, no longer entitled, erased),
 * whose last known name the plugin keeps so its history stays readable.
 */
function AudienceSection({ plugin }) {
  const client = useAdminClient();
  const [showLeft, setShowLeft] = useState(false);
  const query = useQuery({
    queryKey: ['plugin-audience', plugin.name],
    queryFn: () => client.getPluginAudience(plugin.name),
    refetchInterval: 15000,
  });
  // Who is an external member of the plugin's domain — the audience counts
  // them when entitled, and does not say which they are.
  const usersQuery = useQuery({ queryKey: ['users'], queryFn: () => client.getUsers() });
  const externals = externalUserIds(usersQuery.data?.users, plugin.domain);
  const now = query.dataUpdatedAt;
  const views = (query.data?.audience ?? []).map(audienceRowView);
  const members = views.filter((v) => v.member);
  const left = views.filter((v) => !v.member);
  const shown = showLeft ? [...members, ...left] : members;

  return (
    <div>
      <SectionTitle>
        Audience — what its agent half is told
        {query.data ? ` (head seq ${query.data.head})` : ''}:
      </SectionTitle>
      {query.isLoading ? (
        <Loader2 size={12} className="animate-spin text-zinc-500" />
      ) : query.isError ? (
        <p className="text-red-400">{errorMessage(query.error)}</p>
      ) : views.length === 0 ? (
        <p className="text-zinc-600">No members yet.</p>
      ) : (
        <>
          {shown.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="text-zinc-500">
                    <th className="pb-1 pr-2 font-normal">User</th>
                    <th className="pb-1 pr-2 font-normal">User id</th>
                    <th className="pb-1 pr-2 font-normal">Roles</th>
                    <th className="pb-1 pr-2 font-normal">Status</th>
                    <th className="pb-1 font-normal">Changed</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((view) => (
                    <AudienceRow
                      key={view.userId}
                      view={view}
                      now={now}
                      external={view.member && externals.has(view.userId)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {members.length === 0 && <p className="text-zinc-600">No members.</p>}
          {left.length > 0 && (
            <button
              type="button"
              onClick={() => setShowLeft((v) => !v)}
              className="mt-1 text-zinc-500 hover:text-zinc-300"
            >
              {showLeft
                ? 'Hide the users who left'
                : `Show the ${left.length} user${left.length === 1 ? '' : 's'} who left (kept as tombstones)`}
            </button>
          )}
        </>
      )}
    </div>
  );
}

/** The feed to the agent half: where it stands, and Sync now / Reconcile. */
function SyncSection({ plugin, sync, now }) {
  const client = useAdminClient();
  const queryClient = useQueryClient();
  const addToast = useToast();
  const syncNow = useMutation({
    mutationFn: (reconcile) => client.syncPluginIdentity(plugin.name, { reconcile }),
    onSuccess: ({ result }, reconcile) => {
      invalidatePeople(queryClient, plugin.name);
      if (result.status === 'synced') {
        addToast(
          `${plugin.name}: ${result.replay ? 'replayed' : 'synced'} up to seq ${result.cursor}` +
            (reconcile ? ` — ${result.mismatches ?? 0} out of step` : ''),
        );
      } else if (result.status === 'up-to-date') {
        addToast(`${plugin.name}: its agent half is up to date (seq ${result.cursor})`);
      } else {
        addToast(`${plugin.name}: ${result.error ?? result.reason ?? result.status}`, 'error');
      }
    },
    onError: (err) => addToast(errorMessage(err), 'error'),
  });
  const otherDirectory = sync.halfDirectoryId !== null && sync.halfDirectoryId !== sync.directoryId;
  const rows = [
    ['directory', <CopyableId key="d" id={sync.directoryId} full />],
    [
      'agent half follows',
      sync.halfDirectoryId === null ? (
        <span className="text-zinc-600">nothing yet</span>
      ) : otherDirectory ? (
        <span className="text-yellow-400">
          another directory (<CopyableId id={sync.halfDirectoryId} />) — the next sync replays
        </span>
      ) : (
        'this directory'
      ),
    ],
    [
      'position',
      <span key="p">
        cursor <span className="font-mono text-zinc-300">{sync.cursor ?? '—'}</span> of head{' '}
        <span className="font-mono text-zinc-300">{sync.head}</span>
        {sync.behind > 0 ? (
          <span className="text-yellow-400"> — {sync.behind} change(s) behind</span>
        ) : (
          <span className="text-green-400"> — up to date</span>
        )}
      </span>,
    ],
    ['answered for version', sync.readyVersion ?? '—'],
    ['last sync', moment(sync.lastSyncAt, now)],
    [
      'last reconcile',
      <span key="r">
        {moment(sync.lastReconcileAt, now)}
        {sync.lastMismatches != null && (
          <span className={sync.lastMismatches > 0 ? 'text-red-400' : 'text-zinc-500'}>
            {' '}
            — {sync.lastMismatches} out of step
          </span>
        )}
      </span>,
    ],
  ];
  return (
    <div className="space-y-2">
      <SectionTitle>Feed to the agent half:</SectionTitle>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-zinc-500">{label}</dt>
            <dd className="text-zinc-300">{value}</dd>
          </div>
        ))}
      </dl>
      {sync.lastError && (
        <p className="flex items-start gap-1.5 text-red-400">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {sync.lastError}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={syncNow.isPending}
          onClick={() => syncNow.mutate(false)}
          className="flex items-center gap-1.5 rounded bg-zinc-700 px-2.5 py-1 text-zinc-300 hover:bg-zinc-600 disabled:opacity-50"
          title="Send the agent half what it has not applied"
        >
          {syncNow.isPending ? (
            <Loader2 size={11} className="animate-spin" />
          ) : (
            <RefreshCw size={11} />
          )}
          Sync now
        </button>
        <button
          type="button"
          disabled={syncNow.isPending}
          onClick={() => syncNow.mutate(true)}
          className="flex items-center gap-1.5 rounded bg-zinc-700 px-2.5 py-1 text-zinc-300 hover:bg-zinc-600 disabled:opacity-50"
          title="Replay the whole audience and count what the agent half held out of step (also runs daily)"
        >
          <RefreshCw size={11} />
          Reconcile
        </button>
      </div>
    </div>
  );
}

/** The erasures the agent half has not acknowledged (its cursor has not passed them). */
function PendingErasures({ ids }) {
  if (ids.length === 0) return null;
  return (
    <div>
      <SectionTitle>
        <span className="inline-flex items-center gap-1 text-amber-400">
          <Eraser size={11} /> Erasures its agent half has not acknowledged yet:
        </span>
      </SectionTitle>
      <ul className="flex flex-wrap gap-2">
        {ids.map((id) => (
          <li key={id}>
            <CopyableId id={id} />
          </li>
        ))}
      </ul>
      <p className="mt-1 text-zinc-600">
        Delivered within seconds while its hosting agent is online, on reconnect otherwise.
      </p>
    </div>
  );
}

/**
 * The *People* of an agent-hosted plugin that declares identity: the roles
 * and attributes its installed version declares with their approval and
 * whether users can reach it, who is entitled with which roles (by user or
 * Lamaste group), its audience as its agent half is told, the feed's state
 * with Sync now and Reconcile, and the erasures pending.
 */
export default function PluginIdentity({ plugin }) {
  const client = useAdminClient();
  const [open, setOpen] = useState(false);
  const query = useQuery({
    queryKey: ['plugin-identity', plugin.name],
    queryFn: () => client.getPluginIdentity(plugin.name),
    refetchInterval: open ? 10000 : 60000,
  });
  const view = query.data?.identity;
  if (query.isError) {
    return (
      <div className="rounded border border-zinc-800 bg-zinc-950/60 p-3 mb-4 text-xs text-red-400">
        People: {errorMessage(query.error)}
      </div>
    );
  }
  if (!view?.declared) return null;
  const ready = readinessText(view.readiness);
  const counts = view.audience ?? { active: 0, disabled: 0 };
  const members = counts.active + counts.disabled;
  const now = query.dataUpdatedAt;

  return (
    <div className="rounded border border-zinc-800 bg-zinc-950/60 p-3 mb-4 text-xs">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full flex-wrap items-center gap-2 text-left"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span className="text-zinc-300 font-medium">People</span>
        {ready.ready ? (
          <span className="inline-flex items-center gap-1 text-green-400">
            <Check size={11} /> ready
          </span>
        ) : (
          <span className="text-yellow-400" title={ready.text}>
            {view.readiness.reason?.replace(/_/g, ' ') ?? 'not ready'}
          </span>
        )}
        <span className="text-zinc-500">
          {members} member{members === 1 ? '' : 's'}
          {counts.disabled > 0 ? ` (${counts.disabled} disabled)` : ''}
        </span>
        {view.sync?.behind > 0 && (
          <span className="text-yellow-400">{view.sync.behind} to send</span>
        )}
        {view.sync?.lastError && (
          // Why the last sync did not finish, or was not tried.
          <span className="text-red-400" title={view.sync.lastError}>
            sync held up
          </span>
        )}
        {view.pendingErasures.length > 0 && (
          <span className="text-amber-400">
            {view.pendingErasures.length} erasure{view.pendingErasures.length === 1 ? '' : 's'}{' '}
            pending
          </span>
        )}
      </button>

      {open && (
        <div className="mt-3 space-y-4">
          <DeclaredSection view={view} />
          <EntitlementsSection plugin={plugin} roles={view.declared.roles} />
          <AudienceSection plugin={plugin} />
          {view.sync && <SyncSection plugin={plugin} sync={view.sync} now={now} />}
          <PendingErasures ids={view.pendingErasures} />
        </div>
      )}
    </div>
  );
}

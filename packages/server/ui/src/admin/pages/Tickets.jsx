import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ticket, Server, Link, Clock, Trash2, XCircle } from 'lucide-react';
import { useToast } from '../components/Toast.jsx';
import { useAdminClient } from '../context/AdminClientContext.jsx';
import { errorMessage } from '../lib/errorMessage.js';

// --- Status badges ---

function StatusBadge({ status }) {
  const styles =
    status === 'active'
      ? 'bg-green-500/20 text-green-400'
      : status === 'stale'
        ? 'bg-yellow-500/20 text-yellow-400'
        : status === 'dead'
          ? 'bg-red-500/20 text-red-400'
          : status === 'grace'
            ? 'bg-orange-500/20 text-orange-400'
            : 'bg-zinc-500/20 text-zinc-400';

  return <span className={`text-xs px-2 py-0.5 rounded-full ${styles}`}>{status}</span>;
}

function TicketStatusBadge({ ticket }) {
  if (ticket.used) {
    return <span className="text-xs px-2 py-0.5 rounded-full bg-zinc-500/20 text-zinc-400">used</span>;
  }
  if (new Date(ticket.expiresAt) < new Date()) {
    return <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/20 text-red-400">expired</span>;
  }
  return <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/20 text-green-400">pending</span>;
}

function relativeTime(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(iso).toLocaleDateString();
}

// --- Tab selector ---

const TABS = [
  { id: 'scopes', label: 'Scopes' },
  { id: 'instances', label: 'Instances' },
  { id: 'assignments', label: 'Assignments' },
  { id: 'tickets', label: 'Tickets' },
  { id: 'sessions', label: 'Sessions' },
];

// --- Scopes Tab ---

function ScopesTab() {
  const client = useAdminClient();
  const queryClient = useQueryClient();
  const addToast = useToast();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['ticket-scopes'],
    queryFn: () => client.getTicketScopes(),
    refetchInterval: 10000,
  });

  const deleteMutation = useMutation({
    mutationFn: (name) => client.deleteTicketScope(name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ticket-scopes'] });
      addToast('Scope unregistered');
    },
    onError: (err) => addToast(errorMessage(err), 'error'),
  });

  const [confirmDelete, setConfirmDelete] = useState(null);

  if (isLoading) return <div className="animate-pulse h-32 rounded-lg bg-zinc-900 border border-zinc-800" />;
  if (isError) return <div className="rounded-lg bg-zinc-900 border border-zinc-800 p-6"><p className="text-red-400 text-sm">Failed to load scopes</p></div>;

  const scopes = data?.scopes || [];

  if (scopes.length === 0) {
    return (
      <div className="rounded-lg bg-zinc-900 border border-zinc-800 p-8 text-center">
        <Ticket className="mx-auto h-8 w-8 text-zinc-600 mb-3" />
        <p className="text-zinc-400 text-sm">No ticket scopes registered</p>
        <p className="text-zinc-600 text-xs mt-1">Install a ticket scope package to get started</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {scopes.map((scope) => (
        <div key={scope.name} className="rounded-lg bg-zinc-900 border border-zinc-800 p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Ticket size={16} className="text-cyan-400" />
              <span className="text-white font-semibold">{scope.name}</span>
              <span className="text-zinc-500 text-xs">v{scope.version}</span>
            </div>
            {confirmDelete === scope.name ? (
              <span className="flex items-center gap-1.5 text-xs">
                <span className="text-zinc-400">Remove?</span>
                <button
                  type="button"
                  onClick={() => { deleteMutation.mutate(scope.name); setConfirmDelete(null); }}
                  className="rounded bg-red-600 px-2 py-1 text-white hover:bg-red-500"
                >Yes</button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(null)}
                  className="rounded bg-zinc-700 px-2 py-1 text-zinc-300 hover:bg-zinc-600"
                >No</button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmDelete(scope.name)}
                className="text-zinc-500 hover:text-red-400"
                title="Unregister scope"
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
          <p className="text-zinc-400 text-sm mb-2">{scope.description}</p>
          <div className="flex flex-wrap gap-2">
            {scope.scopes?.map((s) => (
              <span key={s.name} className="text-xs bg-zinc-800 text-cyan-400 px-2 py-0.5 rounded font-mono">
                {s.name}
                {s.instanceScoped && <span className="text-zinc-500 ml-1">(instance-scoped)</span>}
              </span>
            ))}
          </div>
          <div className="mt-2 flex gap-3 text-xs text-zinc-500">
            <span>Transport: {scope.transport?.strategies?.join(', ')}</span>
            <span>Protocol: {scope.transport?.protocol}</span>
            <span>Installed: {relativeTime(scope.installedAt)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// --- Instances Tab ---

function InstancesTab() {
  const client = useAdminClient();
  const queryClient = useQueryClient();
  const addToast = useToast();
  const [confirmDeregister, setConfirmDeregister] = useState(null);
  const { data, isLoading, isError } = useQuery({
    queryKey: ['ticket-instances'],
    queryFn: () => client.getTicketInstances(),
    refetchInterval: 10000,
  });

  const deregisterMutation = useMutation({
    mutationFn: (id) => client.deleteTicketInstance(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ticket-instances'] });
      addToast('Instance deregistered');
      setConfirmDeregister(null);
    },
    onError: (err) => addToast(errorMessage(err), 'error'),
  });

  if (isLoading) return <div className="animate-pulse h-32 rounded-lg bg-zinc-900 border border-zinc-800" />;
  if (isError) return <div className="rounded-lg bg-zinc-900 border border-zinc-800 p-6"><p className="text-red-400 text-sm">Failed to load instances</p></div>;

  const instances = data?.instances || [];

  if (instances.length === 0) {
    return (
      <div className="rounded-lg bg-zinc-900 border border-zinc-800 p-8 text-center">
        <Server className="mx-auto h-8 w-8 text-zinc-600 mb-3" />
        <p className="text-zinc-400 text-sm">No instances registered</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-800 text-left text-zinc-500">
            <th className="pb-2 pr-4 font-medium">Instance ID</th>
            <th className="pb-2 pr-4 font-medium">Scope</th>
            <th className="pb-2 pr-4 font-medium">Agent</th>
            <th className="pb-2 pr-4 font-medium">Status</th>
            <th className="pb-2 pr-4 font-medium">Last Heartbeat</th>
            <th className="pb-2 font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {instances.map((inst) => (
            <tr key={inst.instanceId} className="border-b border-zinc-800/50">
              <td className="py-3 pr-4 font-mono text-cyan-400 text-xs">{inst.instanceId.slice(0, 12)}...</td>
              <td className="py-3 pr-4 font-mono text-zinc-300 text-xs">{inst.scope}</td>
              <td className="py-3 pr-4 text-zinc-300">{inst.agentLabel}</td>
              <td className="py-3 pr-4"><StatusBadge status={inst.status} /></td>
              <td className="py-3 pr-4 text-zinc-500 text-xs">{relativeTime(inst.lastHeartbeat)}</td>
              <td className="py-3">
                {confirmDeregister === inst.instanceId ? (
                  <span className="flex items-center gap-1.5 text-xs">
                    <span className="text-zinc-400">Remove?</span>
                    <button
                      type="button"
                      onClick={() => deregisterMutation.mutate(inst.instanceId)}
                      className="rounded bg-red-600 px-2 py-1 text-white hover:bg-red-500"
                    >Yes</button>
                    <button
                      type="button"
                      onClick={() => setConfirmDeregister(null)}
                      className="rounded bg-zinc-700 px-2 py-1 text-zinc-300 hover:bg-zinc-600"
                    >No</button>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmDeregister(inst.instanceId)}
                    className="text-zinc-500 hover:text-red-400"
                    title="Deregister instance"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// --- Assignments Tab ---

function AssignmentsTab() {
  const client = useAdminClient();
  const queryClient = useQueryClient();
  const addToast = useToast();
  const [showForm, setShowForm] = useState(false);
  const [agentLabel, setAgentLabel] = useState('');
  const [instanceScope, setInstanceScope] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(null);

  const { data: assignmentsData, isLoading, isError } = useQuery({
    queryKey: ['ticket-assignments'],
    queryFn: () => client.getTicketAssignments(),
    refetchInterval: 10000,
  });

  const { data: scopesData } = useQuery({
    queryKey: ['ticket-scopes'],
    queryFn: () => client.getTicketScopes(),
    refetchInterval: 10000,
  });

  const { data: agentsData } = useQuery({
    queryKey: ['agents-list'],
    queryFn: () => client.getAgentCerts(),
    staleTime: 30000,
  });

  const createMutation = useMutation({
    mutationFn: (data) => client.createTicketAssignment(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ticket-assignments'] });
      addToast('Assignment created');
      setShowForm(false);
      setAgentLabel('');
      setInstanceScope('');
    },
    onError: (err) => addToast(errorMessage(err), 'error'),
  });

  const removeMutation = useMutation({
    mutationFn: ({ agentLabel: al, instanceScope: is }) => client.deleteTicketAssignment(al, is),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ticket-assignments'] });
      addToast('Assignment removed');
      setConfirmRemove(null);
    },
    onError: (err) => addToast(errorMessage(err), 'error'),
  });

  if (isLoading) return <div className="animate-pulse h-32 rounded-lg bg-zinc-900 border border-zinc-800" />;
  if (isError) return <div className="rounded-lg bg-zinc-900 border border-zinc-800 p-6"><p className="text-red-400 text-sm">Failed to load assignments</p></div>;

  const assignments = assignmentsData?.assignments || [];
  const instances = scopesData?.instances || [];
  const agents = (agentsData?.agents || []).filter((a) => !a.revoked);

  const instanceScopeOptions = instances
    .filter((inst) => inst.status !== 'dead')
    .map((inst) => `${inst.scope}:${inst.instanceId}`);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-zinc-400 text-sm">Assign agents to ticket scope instances</p>
        <button
          type="button"
          onClick={() => setShowForm(!showForm)}
          className="rounded bg-cyan-600 px-3 py-1.5 text-xs text-white hover:bg-cyan-500"
        >
          {showForm ? 'Cancel' : 'Add Assignment'}
        </button>
      </div>

      {showForm && (
        <div className="rounded-lg bg-zinc-900 border border-zinc-800 p-4 mb-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Agent</label>
              <select
                value={agentLabel}
                onChange={(e) => setAgentLabel(e.target.value)}
                className="w-full rounded bg-zinc-800 border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 focus:outline-none focus:border-cyan-400"
              >
                <option value="">Select agent...</option>
                {agents.map((a) => (
                  <option key={a.label} value={a.label}>{a.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Instance Scope</label>
              <select
                value={instanceScope}
                onChange={(e) => setInstanceScope(e.target.value)}
                className="w-full rounded bg-zinc-800 border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 focus:outline-none focus:border-cyan-400"
              >
                <option value="">Select instance...</option>
                {instanceScopeOptions.map((is) => (
                  <option key={is} value={is}>{is}</option>
                ))}
              </select>
            </div>
          </div>
          <button
            type="button"
            onClick={() => createMutation.mutate({ agentLabel, instanceScope })}
            disabled={!agentLabel || !instanceScope || createMutation.isPending}
            className="rounded bg-cyan-600 px-4 py-1.5 text-xs text-white hover:bg-cyan-500 disabled:opacity-50"
          >
            Assign
          </button>
        </div>
      )}

      {assignments.length === 0 ? (
        <div className="rounded-lg bg-zinc-900 border border-zinc-800 p-8 text-center">
          <Link className="mx-auto h-8 w-8 text-zinc-600 mb-3" />
          <p className="text-zinc-400 text-sm">No assignments</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-left text-zinc-500">
                <th className="pb-2 pr-4 font-medium">Agent</th>
                <th className="pb-2 pr-4 font-medium">Instance Scope</th>
                <th className="pb-2 pr-4 font-medium">Assigned</th>
                <th className="pb-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {assignments.map((a) => (
                <tr key={`${a.agentLabel}-${a.instanceScope}`} className="border-b border-zinc-800/50">
                  <td className="py-3 pr-4 text-zinc-300">{a.agentLabel}</td>
                  <td className="py-3 pr-4 font-mono text-cyan-400 text-xs">{a.instanceScope}</td>
                  <td className="py-3 pr-4 text-zinc-500 text-xs">{relativeTime(a.assignedAt)}</td>
                  <td className="py-3">
                    {confirmRemove === `${a.agentLabel}:${a.instanceScope}` ? (
                      <span className="flex items-center gap-1.5 text-xs">
                        <span className="text-zinc-400">Remove?</span>
                        <button
                          type="button"
                          onClick={() => removeMutation.mutate({ agentLabel: a.agentLabel, instanceScope: a.instanceScope })}
                          className="rounded bg-red-600 px-2 py-1 text-white hover:bg-red-500"
                        >Yes</button>
                        <button
                          type="button"
                          onClick={() => setConfirmRemove(null)}
                          className="rounded bg-zinc-700 px-2 py-1 text-zinc-300 hover:bg-zinc-600"
                        >No</button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmRemove(`${a.agentLabel}:${a.instanceScope}`)}
                        className="text-zinc-500 hover:text-red-400"
                        title="Remove assignment"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// --- Tickets Tab ---

function TicketsTab() {
  const client = useAdminClient();
  const queryClient = useQueryClient();
  const addToast = useToast();
  const [confirmRevoke, setConfirmRevoke] = useState(null);
  const { data, isLoading, isError } = useQuery({
    queryKey: ['tickets'],
    queryFn: () => client.getTickets(),
    refetchInterval: 5000,
  });

  const revokeMutation = useMutation({
    mutationFn: (id) => client.revokeTicket(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
      addToast('Ticket revoked');
      setConfirmRevoke(null);
    },
    onError: (err) => addToast(errorMessage(err), 'error'),
  });

  if (isLoading) return <div className="animate-pulse h-32 rounded-lg bg-zinc-900 border border-zinc-800" />;
  if (isError) return <div className="rounded-lg bg-zinc-900 border border-zinc-800 p-6"><p className="text-red-400 text-sm">Failed to load tickets</p></div>;

  const tickets = data?.tickets || [];

  if (tickets.length === 0) {
    return (
      <div className="rounded-lg bg-zinc-900 border border-zinc-800 p-8 text-center">
        <Clock className="mx-auto h-8 w-8 text-zinc-600 mb-3" />
        <p className="text-zinc-400 text-sm">No recent tickets</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-800 text-left text-zinc-500">
            <th className="pb-2 pr-4 font-medium">Ticket ID</th>
            <th className="pb-2 pr-4 font-medium">Scope</th>
            <th className="pb-2 pr-4 font-medium">Source</th>
            <th className="pb-2 pr-4 font-medium">Target</th>
            <th className="pb-2 pr-4 font-medium">Status</th>
            <th className="pb-2 pr-4 font-medium">Created</th>
            <th className="pb-2 font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {tickets.map((t) => (
            <tr key={t.id} className="border-b border-zinc-800/50">
              <td className="py-3 pr-4 font-mono text-cyan-400 text-xs">{t.id.slice(0, 12)}...</td>
              <td className="py-3 pr-4 font-mono text-zinc-300 text-xs">{t.scope}</td>
              <td className="py-3 pr-4 text-zinc-300">{t.source}</td>
              <td className="py-3 pr-4 text-zinc-300">{t.target}</td>
              <td className="py-3 pr-4"><TicketStatusBadge ticket={t} /></td>
              <td className="py-3 pr-4 text-zinc-500 text-xs">{relativeTime(t.createdAt)}</td>
              <td className="py-3">
                {!t.used && new Date(t.expiresAt) > new Date() && (
                  confirmRevoke === t.id ? (
                    <span className="flex items-center gap-1.5 text-xs">
                      <span className="text-zinc-400">Revoke?</span>
                      <button
                        type="button"
                        onClick={() => revokeMutation.mutate(t.id)}
                        className="rounded bg-red-600 px-2 py-1 text-white hover:bg-red-500"
                      >Yes</button>
                      <button
                        type="button"
                        onClick={() => setConfirmRevoke(null)}
                        className="rounded bg-zinc-700 px-2 py-1 text-zinc-300 hover:bg-zinc-600"
                      >No</button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmRevoke(t.id)}
                      className="text-zinc-500 hover:text-red-400"
                      title="Revoke ticket"
                    >
                      <XCircle size={14} />
                    </button>
                  )
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// --- Sessions Tab ---

function SessionsTab() {
  const client = useAdminClient();
  const queryClient = useQueryClient();
  const addToast = useToast();
  const [confirmKill, setConfirmKill] = useState(null);
  const { data, isLoading, isError } = useQuery({
    queryKey: ['ticket-sessions'],
    queryFn: () => client.getTicketSessions(),
    refetchInterval: 5000,
  });

  const killMutation = useMutation({
    mutationFn: (id) => client.killTicketSession(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ticket-sessions'] });
      addToast('Session terminated');
      setConfirmKill(null);
    },
    onError: (err) => addToast(errorMessage(err), 'error'),
  });

  if (isLoading) return <div className="animate-pulse h-32 rounded-lg bg-zinc-900 border border-zinc-800" />;
  if (isError) return <div className="rounded-lg bg-zinc-900 border border-zinc-800 p-6"><p className="text-red-400 text-sm">Failed to load sessions</p></div>;

  const sessions = data?.sessions || [];

  if (sessions.length === 0) {
    return (
      <div className="rounded-lg bg-zinc-900 border border-zinc-800 p-8 text-center">
        <Server className="mx-auto h-8 w-8 text-zinc-600 mb-3" />
        <p className="text-zinc-400 text-sm">No active sessions</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-800 text-left text-zinc-500">
            <th className="pb-2 pr-4 font-medium">Session ID</th>
            <th className="pb-2 pr-4 font-medium">Scope</th>
            <th className="pb-2 pr-4 font-medium">Source</th>
            <th className="pb-2 pr-4 font-medium">Target</th>
            <th className="pb-2 pr-4 font-medium">Status</th>
            <th className="pb-2 pr-4 font-medium">Last Activity</th>
            <th className="pb-2 font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((s) => (
            <tr key={s.sessionId} className="border-b border-zinc-800/50">
              <td className="py-3 pr-4 font-mono text-cyan-400 text-xs">{s.sessionId.slice(0, 12)}...</td>
              <td className="py-3 pr-4 font-mono text-zinc-300 text-xs">{s.scope}</td>
              <td className="py-3 pr-4 text-zinc-300">{s.source}</td>
              <td className="py-3 pr-4 text-zinc-300">{s.target}</td>
              <td className="py-3 pr-4"><StatusBadge status={s.status} /></td>
              <td className="py-3 pr-4 text-zinc-500 text-xs">{relativeTime(s.lastActivityAt)}</td>
              <td className="py-3">
                {s.status !== 'dead' && (
                  confirmKill === s.sessionId ? (
                    <span className="flex items-center gap-1.5 text-xs">
                      <span className="text-zinc-400">Kill?</span>
                      <button
                        type="button"
                        onClick={() => killMutation.mutate(s.sessionId)}
                        className="rounded bg-red-600 px-2 py-1 text-white hover:bg-red-500"
                      >Yes</button>
                      <button
                        type="button"
                        onClick={() => setConfirmKill(null)}
                        className="rounded bg-zinc-700 px-2 py-1 text-zinc-300 hover:bg-zinc-600"
                      >No</button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmKill(s.sessionId)}
                      className="text-zinc-500 hover:text-red-400"
                      title="Kill session"
                    >
                      <XCircle size={14} />
                    </button>
                  )
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// --- Main page ---

export default function Tickets() {
  const [activeTab, setActiveTab] = useState('scopes');

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-white">Tickets & Sessions</h1>
        <p className="text-zinc-500 text-sm mt-1">
          Manage agent-to-agent authorization scopes, instances, and active sessions
        </p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 mb-6 border-b border-zinc-800">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.id
                ? 'border-cyan-400 text-cyan-400'
                : 'border-transparent text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'scopes' && <ScopesTab />}
      {activeTab === 'instances' && <InstancesTab />}
      {activeTab === 'assignments' && <AssignmentsTab />}
      {activeTab === 'tickets' && <TicketsTab />}
      {activeTab === 'sessions' && <SessionsTab />}
    </div>
  );
}

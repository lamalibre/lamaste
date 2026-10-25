import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Globe2,
  Plus,
  Power,
  Search,
  Trash2,
  UserMinus,
  UserPlus,
} from 'lucide-react';
import { useAdminClient } from '../context/AdminClientContext.jsx';
import { useToast } from '../components/Toast.jsx';
import { useDomains } from '../components/DomainChoice.jsx';
import { errorMessage } from '../lib/errorMessage.js';
import {
  dnsRecordsFor,
  domainStatusText,
  domainUsageLines,
  explainDomainRefusal,
  memberCandidates,
} from '../lib/domains.js';

const BUTTON =
  'inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:border-cyan-600 hover:text-white disabled:opacity-50';

/** Refetch what a domain change touches: the domains, the users' memberships, the plugins. */
function invalidateDomains(queryClient) {
  for (const key of [['domains'], ['users'], ['plugins'], ['domain-members']]) {
    queryClient.invalidateQueries({ queryKey: key });
  }
}

function DnsCheck({ domain }) {
  const client = useAdminClient();
  const check = useMutation({ mutationFn: () => client.verifyDomainDns(domain.name) });
  const result = check.data;
  return (
    <div className="space-y-2">
      <button
        type="button"
        className={BUTTON}
        onClick={() => check.mutate()}
        disabled={check.isPending}
      >
        <Search size={14} /> {check.isPending ? 'Checking…' : 'Check DNS'}
      </button>
      {check.isError && <p className="text-xs text-red-400">{errorMessage(check.error)}</p>}
      {result && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-xs">
          <p className={result.ok ? 'text-green-400' : 'text-yellow-400'}>
            {result.ok
              ? `auth.${domain.name} points at this relay (${result.expectedIp})`
              : `auth.${domain.name} does not point at this relay (${result.expectedIp}) yet`}
            {result.wildcard ? ' — a wildcard record is in place.' : ''}
          </p>
          {!result.ok && (
            <>
              <p className="mt-2 text-zinc-400">Create these records at the domain’s DNS host:</p>
              <table className="mt-1 w-full text-left font-mono">
                <tbody>
                  {dnsRecordsFor(domain.name, result.expectedIp).map((r) => (
                    <tr key={r.name} className="align-top">
                      <td className="pr-3 text-zinc-500">{r.type}</td>
                      <td className="pr-3 text-cyan-300">{r.name}</td>
                      <td className="pr-3 text-zinc-300">{r.value}</td>
                      <td className="font-sans text-zinc-500">{r.purpose}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          {result.records.map((r) => (
            <p key={r.name} className="mt-1 text-zinc-500">
              {r.name}: {r.resolvedIps.length > 0 ? r.resolvedIps.join(', ') : 'no A record'}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function Members({ domain }) {
  const client = useAdminClient();
  const queryClient = useQueryClient();
  const addToast = useToast();
  const [candidate, setCandidate] = useState('');
  const members = useQuery({
    queryKey: ['domain-members', domain.name],
    queryFn: () => client.getDomainMembers(domain.name),
  });
  const users = useQuery({ queryKey: ['users'], queryFn: () => client.getUsers() });
  const change = useMutation({
    mutationFn: ({ userId, add }) =>
      add
        ? client.addDomainMember(domain.name, userId)
        : client.removeDomainMember(domain.name, userId),
    onSuccess: () => {
      setCandidate('');
      invalidateDomains(queryClient);
    },
    onError: (err) => addToast(explainDomainRefusal(err), 'error'),
  });
  const list = members.data?.members ?? [];
  const candidates = memberCandidates(users.data?.users ?? [], list);

  return (
    <div className="space-y-3">
      {members.isLoading ? (
        <p className="text-xs text-zinc-500">Loading members…</p>
      ) : list.length === 0 ? (
        <p className="text-xs text-zinc-500">
          No members — nobody can reach {domain.name}’s protected hosts.
        </p>
      ) : (
        <ul className="divide-y divide-zinc-800 rounded-lg border border-zinc-800">
          {list.map((m) => (
            <li key={m.userId} className="flex items-center justify-between px-3 py-2 text-sm">
              <span className="font-mono text-cyan-400">
                {m.username ?? m.userId}
                {m.status !== 'active' && (
                  <span className="ml-2 font-sans text-xs text-zinc-500">({m.status})</span>
                )}
              </span>
              <button
                type="button"
                className={BUTTON}
                disabled={change.isPending}
                onClick={() => change.mutate({ userId: m.userId, add: false })}
              >
                <UserMinus size={14} /> Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {candidates.length > 0 && (
        <div className="flex gap-2">
          <select
            value={candidate}
            onChange={(e) => setCandidate(e.target.value)}
            className="flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-white focus:border-cyan-500 focus:outline-none"
          >
            <option value="">Add a member…</option>
            {candidates.map((u) => (
              <option key={u.userId} value={u.userId}>
                {u.username}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={BUTTON}
            disabled={!candidate || change.isPending}
            onClick={() => change.mutate({ userId: candidate, add: true })}
          >
            <UserPlus size={14} /> Add
          </button>
        </div>
      )}
    </div>
  );
}

function DomainCard({ domain }) {
  const client = useAdminClient();
  const queryClient = useQueryClient();
  const addToast = useToast();
  const [open, setOpen] = useState(false);
  const onError = (err) => addToast(explainDomainRefusal(err), 'error');
  const activate = useMutation({
    mutationFn: () => client.activateDomain(domain.name),
    onSuccess: () => {
      addToast(`${domain.name} is active: its sign-in is auth.${domain.name}`);
      invalidateDomains(queryClient);
    },
    onError,
  });
  const remove = useMutation({
    mutationFn: () => client.removeDomain(domain.name),
    onSuccess: () => {
      addToast(`${domain.name} removed`);
      invalidateDomains(queryClient);
    },
    onError,
  });
  const usage = domainUsageLines(domain.usedBy);
  const active = domain.status === 'active';

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-mono text-base text-white">{domain.name}</p>
          <p className={`text-xs ${active ? 'text-green-400' : 'text-yellow-400'}`}>
            {domainStatusText(domain)} · {domain.members} member{domain.members === 1 ? '' : 's'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!active && (
            <button
              type="button"
              className={BUTTON}
              disabled={activate.isPending}
              onClick={() => activate.mutate()}
            >
              <Power size={14} /> {activate.isPending ? 'Activating…' : 'Activate'}
            </button>
          )}
          {!domain.primary && (
            <button
              type="button"
              className={BUTTON}
              disabled={remove.isPending || usage.length > 0}
              title={usage.length > 0 ? 'Still in use' : undefined}
              onClick={() => {
                if (window.confirm(`Remove ${domain.name} and end its memberships?`)) {
                  remove.mutate();
                }
              }}
            >
              <Trash2 size={14} /> Remove
            </button>
          )}
          <button type="button" className={BUTTON} onClick={() => setOpen(!open)}>
            {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />} Members
          </button>
        </div>
      </div>
      {usage.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs text-zinc-400">
          {usage.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      {!active && (
        <div className="mt-3">
          <DnsCheck domain={domain} />
        </div>
      )}
      {open && (
        <div className="mt-3">
          <Members domain={domain} />
        </div>
      )}
    </div>
  );
}

function AddDomain() {
  const client = useAdminClient();
  const queryClient = useQueryClient();
  const addToast = useToast();
  const [name, setName] = useState('');
  const add = useMutation({
    mutationFn: () => client.addDomain(name.trim().toLowerCase()),
    onSuccess: ({ domain }) => {
      addToast(`${domain.name} added — point auth.${domain.name} here, then activate it`);
      setName('');
      invalidateDomains(queryClient);
    },
    onError: (err) => addToast(explainDomainRefusal(err), 'error'),
  });
  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) add.mutate();
      }}
    >
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="example.com"
        className="flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-sm text-white placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
      />
      <button
        type="submit"
        disabled={!name.trim() || add.isPending}
        className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-500 disabled:opacity-50"
      >
        <Plus size={16} /> Add domain
      </button>
    </form>
  );
}

/**
 * The relay's base domains: each has its own sign-in (`auth.<domain>`) and
 * member list; a user reaches a domain's protected hosts only as a member.
 */
export default function Domains() {
  const domains = useDomains();
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Globe2 className="text-cyan-400" size={24} />
        <div>
          <h1 className="text-2xl font-bold text-white">Domains</h1>
          <p className="text-sm text-zinc-400">
            Every domain has its own sign-in and member list. The panel and the tunnel endpoint stay
            on the primary.
          </p>
        </div>
      </div>
      <AddDomain />
      {domains.isLoading && <p className="text-sm text-zinc-500">Loading domains…</p>}
      {domains.isError && (
        <p className="flex items-center gap-2 text-sm text-red-400">
          <AlertCircle size={16} /> {errorMessage(domains.error)}
        </p>
      )}
      <div className="space-y-4">
        {(domains.data ?? []).map((d) => (
          <DomainCard key={d.name} domain={d} />
        ))}
      </div>
      {domains.data?.length === 1 && (
        <p className="flex items-center gap-2 text-xs text-zinc-500">
          <CheckCircle2 size={14} /> One domain: every user is its member, as before.
        </p>
      )}
    </div>
  );
}

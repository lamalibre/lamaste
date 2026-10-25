import { useQuery } from '@tanstack/react-query';
import { useAdminClient } from '../context/AdminClientContext.jsx';
import { activeDomainNames, needsDomainChoice } from '../lib/domains.js';

/** The relay's domains, shared by every page that asks for one. */
export function useDomains() {
  const client = useAdminClient();
  return useQuery({
    queryKey: ['domains'],
    queryFn: () => client.getDomains(),
    select: (data) => data?.domains ?? [],
    staleTime: 30_000,
  });
}

const SELECT_CLASS =
  'w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none';

/**
 * Which domain a new hostname goes under — shown only once the relay has
 * two active domains (an empty value means the primary).
 */
export function DomainPicker({ value, onChange, label = 'Domain' }) {
  const { data: domains = [] } = useDomains();
  if (!needsDomainChoice(domains)) return null;
  const names = activeDomainNames(domains);
  return (
    <div>
      <label className="mb-1 block text-sm text-zinc-400">{label}</label>
      <select
        value={value || names[0]}
        onChange={(e) => onChange(e.target.value)}
        className={SELECT_CLASS}
      >
        {names.map((name, i) => (
          <option key={name} value={name}>
            {i === 0 ? `${name} (primary)` : name}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * Which domains a user is a member of — checkboxes, every domain (a pending
 * one too: its members are let in when it goes live). Hidden while the
 * relay has one domain, whose member every new user becomes.
 */
export function DomainMembershipChoice({ value, onChange, domains }) {
  if ((domains ?? []).length < 2) return null;
  const chosen = new Set(value);
  const toggle = (name) => {
    const next = new Set(chosen);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    onChange([...next].sort());
  };
  return (
    <fieldset>
      <legend className="mb-1 block text-sm text-zinc-400">Domains (member of)</legend>
      <div className="flex flex-wrap gap-3">
        {domains.map((d) => (
          <label key={d.name} className="flex items-center gap-2 text-sm text-zinc-300">
            <input
              type="checkbox"
              checked={chosen.has(d.name)}
              onChange={() => toggle(d.name)}
              className="accent-cyan-500"
            />
            <span className="font-mono">{d.name}</span>
            {d.status !== 'active' && <span className="text-xs text-zinc-500">(pending)</span>}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** A user's domains as chips. */
export function DomainChips({ domains }) {
  if (!domains || domains.length === 0) return <span className="text-xs text-zinc-500">none</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {domains.map((d) => (
        <span
          key={d}
          className="rounded border border-cyan-900 bg-cyan-950/40 px-2 py-0.5 font-mono text-xs text-cyan-300"
        >
          {d}
        </span>
      ))}
    </div>
  );
}

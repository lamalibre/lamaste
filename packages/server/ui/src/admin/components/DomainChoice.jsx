import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAdminClient } from '../context/AdminClientContext.jsx';
import { activeDomainNames, needsDomainChoice, sameDomains } from '../lib/domains.js';

/**
 * The relay's domains, shared by every page that asks for one, and the
 * panel's answer to whether users must be given theirs.
 */
export function useDomains() {
  const client = useAdminClient();
  const query = useQuery({
    queryKey: ['domains'],
    queryFn: () => client.getDomains(),
    staleTime: 30_000,
  });
  return {
    ...query,
    domains: query.data?.domains ?? [],
    newUsersNeedDomains: query.data?.newUsersNeedDomains === true,
  };
}

const SELECT_CLASS =
  'w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none';

/**
 * Which domain a new hostname goes under — shown only once the relay has
 * two active domains. `value` '' is the primary, and choosing the primary
 * answers ''; callers send `domain` only when it is not ''.
 */
export function DomainPicker({ value, onChange, label = 'Domain' }) {
  const { domains } = useDomains();
  if (!needsDomainChoice(domains)) return null;
  const [primary, ...others] = activeDomainNames(domains);
  return (
    <div>
      <label className="mb-1 block text-sm text-zinc-400">{label}</label>
      <select
        value={value || primary}
        onChange={(e) => onChange(e.target.value === primary ? '' : e.target.value)}
        className={SELECT_CLASS}
      >
        <option value={primary}>{primary} (primary)</option>
        {others.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * A user form's memberships: what the user is a member of (`user` null for
 * a new user, who starts with none), whether the form asks at all — the
 * panel's `newUsersNeedDomains` — and what a create or an edit request
 * carries.
 */
export function useMembershipChoice(user) {
  const { domains, newUsersNeedDomains } = useDomains();
  const [chosen, setChosen] = useState(null);
  const before = user?.domains ?? [];
  const value = chosen ?? [...before].sort();
  // An existing user's memberships are set by directory id: not before it has one.
  const asks = newUsersNeedDomains && (!user || Boolean(user.userId));
  return {
    domains,
    asks,
    value,
    setValue: setChosen,
    createFields: asks ? { domains: value } : {},
    editFields: asks && chosen !== null && !sameDomains(chosen, before) ? { domains: chosen } : {},
  };
}

/**
 * Which domains a user is a member of — checkboxes, every domain (a pending
 * one too: its members are let in when it goes live). Rendered only while
 * the form asks ({@link useMembershipChoice}).
 */
export function DomainMembershipChoice({ choice }) {
  if (!choice.asks) return null;
  const chosen = new Set(choice.value);
  const toggle = (name) => {
    const next = new Set(chosen);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    choice.setValue([...next].sort());
  };
  return (
    <fieldset>
      <legend className="mb-1 block text-sm text-zinc-400">Domains (member of)</legend>
      <div className="flex flex-wrap gap-3">
        {choice.domains.map((d) => (
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

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAdminClient } from '../context/AdminClientContext.jsx';
import {
  EXTERNAL_MEMBER_HINT,
  activeDomainNames,
  isExternalAnywhere,
  membershipKind,
  membershipsOf,
  needsDomainChoice,
  sameMemberships,
  withMembership,
} from '../lib/domains.js';

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
 * A user form's memberships — `{ name, kind }` per domain: what the user
 * holds (`user` null for a new user), whether the form asks at all, and
 * what a create or an edit request carries.
 *
 * A relay with two or more domains asks which domains (the panel's
 * `newUsersNeedDomains`), each with its kind. A one-domain relay asks only
 * whether the user is an external member of it: a new member is made by
 * the panel without being named, as before.
 */
export function useMembershipChoice(user) {
  const { domains, newUsersNeedDomains } = useDomains();
  const [chosen, setChosen] = useState(null);
  const before = membershipsOf(user?.domains);
  const only = !newUsersNeedDomains && domains.length === 1 ? domains[0].name : null;
  const value = chosen ?? (user || !only ? before : [{ name: only, kind: 'member' }]);
  // An existing user's memberships are set by directory id: not before it has one.
  const asks = (newUsersNeedDomains || only !== null) && (!user || Boolean(user.userId));
  const external = isExternalAnywhere(value);
  return {
    domains,
    asks,
    only,
    value,
    external,
    setValue: setChosen,
    createFields: asks && (newUsersNeedDomains || external) ? { domains: value } : {},
    editFields:
      asks && chosen !== null && !sameMemberships(chosen, before) ? { domains: chosen } : {},
  };
}

/** The badge an external member carries wherever users are listed. */
export function ExternalBadge({ title = EXTERNAL_MEMBER_HINT }) {
  return (
    <span
      title={title}
      className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 font-sans text-xs text-amber-300"
    >
      external
    </span>
  );
}

/**
 * Which domains a user belongs to and how — checkboxes with a kind each,
 * every domain (a pending one too: its members are let in when it goes
 * live); on a one-domain relay one checkbox, external or not. Rendered only
 * while the form asks ({@link useMembershipChoice}).
 */
export function DomainMembershipChoice({ choice }) {
  if (!choice.asks) return null;
  if (choice.only) {
    const external = membershipKind(choice.value, choice.only) === 'external';
    return (
      <label className="flex items-start gap-2 text-sm text-zinc-300">
        <input
          type="checkbox"
          checked={external}
          onChange={() =>
            choice.setValue(
              withMembership(choice.value, choice.only, external ? 'member' : 'external'),
            )
          }
          className="mt-1 accent-cyan-500"
        />
        <span>
          External member of <span className="font-mono">{choice.only}</span>
          <span className="block text-xs text-zinc-500">{EXTERNAL_MEMBER_HINT}</span>
        </span>
      </label>
    );
  }
  return (
    <fieldset>
      <legend className="mb-1 block text-sm text-zinc-400">Domains</legend>
      <div className="space-y-2">
        {choice.domains.map((d) => {
          const kind = membershipKind(choice.value, d.name);
          return (
            <div key={d.name} className="flex flex-wrap items-center gap-2 text-sm text-zinc-300">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={kind !== null}
                  onChange={() =>
                    choice.setValue(withMembership(choice.value, d.name, kind ? null : 'member'))
                  }
                  className="accent-cyan-500"
                />
                <span className="font-mono">{d.name}</span>
                {d.status !== 'active' && <span className="text-xs text-zinc-500">(pending)</span>}
              </label>
              {kind !== null && (
                <select
                  value={kind}
                  onChange={(e) =>
                    choice.setValue(withMembership(choice.value, d.name, e.target.value))
                  }
                  aria-label={`Kind of membership of ${d.name}`}
                  className="rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-xs text-white focus:border-cyan-500 focus:outline-none"
                >
                  <option value="member">member</option>
                  <option value="external">external</option>
                </select>
              )}
            </div>
          );
        })}
      </div>
      {choice.external && <p className="mt-1 text-xs text-zinc-500">{EXTERNAL_MEMBER_HINT}</p>}
    </fieldset>
  );
}

/** A user's memberships as chips, external ones marked. */
export function DomainChips({ domains }) {
  const list = membershipsOf(domains);
  if (list.length === 0) return <span className="text-xs text-zinc-500">none</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {list.map((d) => (
        <span
          key={d.name}
          title={d.kind === 'external' ? EXTERNAL_MEMBER_HINT : undefined}
          className={`rounded border px-2 py-0.5 font-mono text-xs ${
            d.kind === 'external'
              ? 'border-amber-900 bg-amber-950/40 text-amber-300'
              : 'border-cyan-900 bg-cyan-950/40 text-cyan-300'
          }`}
        >
          {d.name}
          {d.kind === 'external' ? ' · external' : ''}
        </span>
      ))}
    </div>
  );
}

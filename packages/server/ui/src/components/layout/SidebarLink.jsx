import { NavLink } from 'react-router-dom';

/**
 * A sidebar entry. `offline` — why the page cannot reach the agent half it
 * comes from (an agent-hosted plugin whose hosting is down) — marks it with
 * a dot and says why on hover; the page stays reachable.
 */
export default function SidebarLink({ to, icon: Icon, label, offline = null, onClick }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      onClick={onClick}
      title={offline ?? undefined}
      className={({ isActive }) =>
        [
          'flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors',
          isActive
            ? 'text-cyan-400 bg-zinc-800/50'
            : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800',
        ].join(' ')
      }
    >
      <Icon className="h-5 w-5" />
      {label}
      {offline && (
        <>
          <span
            className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-red-500"
            aria-hidden="true"
          />
          <span className="sr-only">(offline: {offline})</span>
        </>
      )}
    </NavLink>
  );
}

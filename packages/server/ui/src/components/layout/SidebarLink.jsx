import { NavLink } from 'react-router-dom';

export default function SidebarLink({ to, icon: Icon, label, onClick }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      onClick={onClick}
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
    </NavLink>
  );
}

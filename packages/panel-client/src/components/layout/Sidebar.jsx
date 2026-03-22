import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BookOpen,
  FileText,
  Globe,
  LayoutDashboard,
  Menu,
  Package,
  Server,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react';
import SidebarLink from './SidebarLink.jsx';

const baseNavItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/tunnels', icon: Globe, label: 'Tunnels' },
  { to: '/sites', icon: FileText, label: 'Static Sites' },
  { to: '/users', icon: Users, label: 'Users' },
  { to: '/certificates', icon: ShieldCheck, label: 'Certificates' },
  { to: '/services', icon: Server, label: 'Services' },
  { to: '/plugins', icon: Package, label: 'Plugins' },
  { to: '/docs', icon: BookOpen, label: 'Documentation' },
];

async function fetchEnabledPlugins() {
  try {
    const res = await fetch('/api/plugins');
    if (!res.ok) return [];
    const data = await res.json();
    return (data.plugins || []).filter(
      (p) => p.status === 'enabled' && p.panel?.label,
    );
  } catch {
    return [];
  }
}

function SidebarContent({ onLinkClick }) {
  const { data: enabledPlugins } = useQuery({
    queryKey: ['sidebar-plugins'],
    queryFn: fetchEnabledPlugins,
    refetchInterval: 30000,
    staleTime: 15000,
  });

  const pluginNavItems = (enabledPlugins || []).map((p) => ({
    to: `/plugins/${p.name}`,
    icon: Package,
    label: p.panel.label,
  }));

  const navItems = [...baseNavItems, ...pluginNavItems];

  return (
    <>
      <div className="border-b border-zinc-800 px-4 py-5">
        <span className="font-mono text-lg font-bold text-cyan-400">Portlama</span>
      </div>

      <nav className="flex-1 space-y-1 px-2 py-4">
        {navItems.map((item) => (
          <SidebarLink key={item.to} {...item} onClick={onLinkClick} />
        ))}
      </nav>

      <div className="border-t border-zinc-800 px-4 py-3">
        <span className="font-mono text-xs text-zinc-600">v0.1.0</span>
      </div>
    </>
  );
}

export default function Sidebar() {
  const [mobileOpen, setMobileOpen] = useState(false);

  const closeMobile = () => setMobileOpen(false);

  return (
    <>
      {/* Mobile hamburger button */}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        className="fixed left-4 top-4 z-40 rounded-md bg-zinc-900 p-2 text-zinc-400 hover:text-zinc-100 lg:hidden"
        aria-label="Open sidebar"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="fixed inset-0 bg-black/50" onClick={closeMobile} />
          <div className="relative flex h-screen w-64 flex-col bg-zinc-900">
            <button
              type="button"
              onClick={closeMobile}
              className="absolute right-3 top-4 rounded-md p-1 text-zinc-400 hover:text-zinc-100"
              aria-label="Close sidebar"
            >
              <X className="h-5 w-5" />
            </button>
            <SidebarContent onLinkClick={closeMobile} />
          </div>
        </div>
      )}

      {/* Desktop sidebar */}
      <div className="sticky top-0 hidden h-screen w-64 flex-col border-r border-zinc-800 bg-zinc-900 lg:flex">
        <SidebarContent />
      </div>
    </>
  );
}

import { useState } from 'react';
import { BookOpen, FileText, Globe, LayoutDashboard, Menu, Server, ShieldCheck, Users, X } from 'lucide-react';
import SidebarLink from './SidebarLink.jsx';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/tunnels', icon: Globe, label: 'Tunnels' },
  { to: '/sites', icon: FileText, label: 'Static Sites' },
  { to: '/users', icon: Users, label: 'Users' },
  { to: '/certificates', icon: ShieldCheck, label: 'Certificates' },
  { to: '/services', icon: Server, label: 'Services' },
  { to: '/docs', icon: BookOpen, label: 'Documentation' },
];

function SidebarContent({ onLinkClick }) {
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

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  BarChart3,
  BookOpen,
  Box,
  Cpu,
  Database,
  FileText,
  Folder,
  GitBranch,
  Globe,
  HardDrive,
  Heart,
  Layers,
  LayoutDashboard,
  List,
  Map,
  Menu,
  Package,
  Server,
  Settings,
  Shield,
  ShieldCheck,
  Terminal,
  Ticket,
  Truck,
  Users,
  Wifi,
  X,
  Zap,
} from 'lucide-react';
import SidebarLink from './SidebarLink.jsx';
import { useAdminClient } from '../../admin/index.js';

const iconMap = {
  activity: Activity,
  'bar-chart-3': BarChart3,
  'book-open': BookOpen,
  box: Box,
  cpu: Cpu,
  database: Database,
  'file-text': FileText,
  folder: Folder,
  'git-branch': GitBranch,
  globe: Globe,
  'hard-drive': HardDrive,
  heart: Heart,
  layers: Layers,
  'layout-dashboard': LayoutDashboard,
  list: List,
  map: Map,
  package: Package,
  server: Server,
  settings: Settings,
  shield: Shield,
  'shield-check': ShieldCheck,
  terminal: Terminal,
  ticket: Ticket,
  truck: Truck,
  users: Users,
  wifi: Wifi,
  zap: Zap,
};

function resolveIcon(iconName) {
  return (iconName && Object.hasOwn(iconMap, iconName) && iconMap[iconName]) || Package;
}

const baseNavItems = [
  { type: 'link', to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { type: 'link', to: '/tunnels', icon: Globe, label: 'Tunnels' },
  { type: 'link', to: '/sites', icon: FileText, label: 'Static Sites' },
  { type: 'link', to: '/users', icon: Users, label: 'Users' },
  { type: 'link', to: '/certificates', icon: ShieldCheck, label: 'Certificates' },
  { type: 'link', to: '/services', icon: Server, label: 'Services' },
  { type: 'link', to: '/tickets', icon: Ticket, label: 'Tickets' },
  { type: 'link', to: '/plugins', icon: Package, label: 'Plugins' },
  { type: 'link', to: '/storage', icon: HardDrive, label: 'Storage' },
  { type: 'link', to: '/settings', icon: Settings, label: 'Settings' },
  { type: 'link', to: '/docs', icon: BookOpen, label: 'Documentation' },
];

function SidebarContent({ onLinkClick }) {
  const client = useAdminClient();

  const { data: enabledPlugins } = useQuery({
    queryKey: ['sidebar-plugins'],
    queryFn: async () => {
      try {
        const data = await client.getPlugins();
        return (data.plugins || []).filter(
          (p) => p.status === 'enabled' && (p.panel?.label || p.panel?.pages?.length),
        );
      } catch {
        return [];
      }
    },
    refetchInterval: 30000,
    staleTime: 15000,
  });

  const pluginNavItems = (enabledPlugins || []).flatMap((p) => {
    if (p.panel?.pages?.length) {
      const groupLabel = p.displayName || p.name;
      return [
        { type: 'section-header', label: groupLabel, key: `section-${p.name}` },
        ...p.panel.pages.map((page) => ({
          type: 'link',
          to: `/plugins/${p.name}${page.path}`,
          icon: resolveIcon(page.icon),
          label: page.title,
        })),
      ];
    }
    if (p.panel?.label) {
      return [
        {
          type: 'link',
          to: `/plugins/${p.name}`,
          icon: resolveIcon(p.panel?.icon),
          label: p.panel.label,
        },
      ];
    }
    return [];
  });

  const navItems = [...baseNavItems, ...pluginNavItems];

  return (
    <>
      <div className="border-b border-zinc-800 px-4 py-5">
        <span className="font-mono text-lg font-bold text-cyan-400">Lamaste</span>
      </div>

      <nav className="flex-1 space-y-1 px-2 py-4">
        {navItems.map((item) =>
          item.type === 'section-header' ? (
            <div key={item.key} className="px-3 pt-4 pb-1">
              <span className="text-xs font-semibold uppercase tracking-wider text-zinc-600">
                {item.label}
              </span>
            </div>
          ) : (
            <SidebarLink
              key={item.to}
              to={item.to}
              icon={item.icon}
              label={item.label}
              onClick={onLinkClick}
            />
          ),
        )}
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

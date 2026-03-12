import { useQuery } from '@tanstack/react-query';
import { Cpu, HardDrive, Clock, Activity, Database } from 'lucide-react';
import { formatBytes, formatUptime } from '../../lib/formatters.js';

async function fetchSystemStats() {
  const res = await fetch('/api/system/stats');
  if (!res.ok) throw new Error('Failed to fetch system stats');
  return res.json();
}

async function fetchServices() {
  const res = await fetch('/api/services');
  if (!res.ok) throw new Error('Failed to fetch services');
  return res.json();
}

function StatsCard({ icon: Icon, label, value, isLoading, isError }) {
  return (
    <div className="rounded-lg bg-zinc-900 border border-zinc-800 p-6">
      <Icon size={20} className="text-cyan-400 mb-2" />
      <p className="text-zinc-400 text-sm mb-1">{label}</p>
      {isLoading ? (
        <div className="h-7 w-24 animate-pulse rounded bg-zinc-700" />
      ) : isError ? (
        <p className="text-red-400 text-sm">Error</p>
      ) : (
        <p className="text-xl font-semibold text-white">{value}</p>
      )}
    </div>
  );
}

function ServiceHealthDot({ status }) {
  const colorClass =
    status === 'active'
      ? 'bg-green-500'
      : status === 'failed'
        ? 'bg-red-500'
        : 'bg-zinc-500';

  return <span className={`inline-block w-2 h-2 rounded-full ${colorClass}`} />;
}

export default function Dashboard() {
  const statsQuery = useQuery({
    queryKey: ['system-stats'],
    queryFn: fetchSystemStats,
    refetchInterval: 5000,
  });

  const servicesQuery = useQuery({
    queryKey: ['services'],
    queryFn: fetchServices,
    refetchInterval: 5000,
  });

  const stats = statsQuery.data;
  const services = servicesQuery.data?.services;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-white">Dashboard</h1>
        <p className="text-zinc-500 text-sm mt-1">
          System overview and service health
        </p>
      </div>

      {/* System Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        <StatsCard
          icon={Cpu}
          label="CPU Usage"
          value={stats ? `${stats.cpu.usage}%` : '—'}
          isLoading={statsQuery.isLoading}
          isError={statsQuery.isError}
        />
        <StatsCard
          icon={Database}
          label="Memory Usage"
          value={
            stats
              ? `${formatBytes(stats.memory.used)} / ${formatBytes(stats.memory.total)}`
              : '—'
          }
          isLoading={statsQuery.isLoading}
          isError={statsQuery.isError}
        />
        <StatsCard
          icon={HardDrive}
          label="Disk Usage"
          value={
            stats
              ? `${formatBytes(stats.disk.used)} / ${formatBytes(stats.disk.total)}`
              : '—'
          }
          isLoading={statsQuery.isLoading}
          isError={statsQuery.isError}
        />
        <StatsCard
          icon={Clock}
          label="Uptime"
          value={stats ? formatUptime(stats.uptime) : '—'}
          isLoading={statsQuery.isLoading}
          isError={statsQuery.isError}
        />
      </div>

      {/* Service Health */}
      <div className="rounded-lg bg-zinc-900 border border-zinc-800 p-6 mb-8">
        <h2 className="text-sm font-semibold text-zinc-300 mb-4 flex items-center gap-2">
          <Activity size={14} className="text-cyan-400" />
          Service Health
        </h2>
        {servicesQuery.isLoading ? (
          <div className="flex gap-6 flex-wrap">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-5 w-28 animate-pulse rounded bg-zinc-700" />
            ))}
          </div>
        ) : servicesQuery.isError ? (
          <p className="text-red-400 text-sm">Failed to load service status</p>
        ) : (
          <div className="flex gap-6 flex-wrap">
            {services?.map((svc) => (
              <div key={svc.name} className="flex items-center gap-2">
                <ServiceHealthDot status={svc.status} />
                <span className="text-zinc-300 text-sm">{svc.name}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Quick Overview */}
      <div className="rounded-lg bg-zinc-900 border border-zinc-800 p-6">
        <h2 className="text-sm font-semibold text-zinc-300 mb-4 flex items-center gap-2">
          <Activity size={14} className="text-cyan-400" />
          Quick Overview
        </h2>
        <div className="flex gap-8 flex-wrap text-sm">
          <div className="text-zinc-400">
            Active Tunnels: <span className="text-white">0</span>
          </div>
          <div className="text-zinc-400">
            Registered Users: <span className="text-white">0</span>
          </div>
        </div>
      </div>
    </div>
  );
}

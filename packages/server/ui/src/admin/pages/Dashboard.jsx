import { useQuery } from '@tanstack/react-query';
import { Cpu, HardDrive, Clock, Activity, Database, ShieldAlert } from 'lucide-react';
import { formatBytes, formatUptime } from '../lib/formatters.js';
import { httpsCatchAllProblem } from '../lib/https-catch-all.js';
import { useAdminClient } from '../context/AdminClientContext.jsx';

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

/**
 * The relay's port-443 catch-all is not in place: a hostname no site serves
 * gets another site's certificate and sign-in redirect.
 */
function HttpsCatchAllWarning({ status }) {
  const problem = httpsCatchAllProblem(status);
  if (!problem) return null;
  return (
    <div
      role="alert"
      className="mb-6 flex gap-3 rounded-lg border border-red-900 bg-red-950/40 p-4 text-sm"
    >
      <ShieldAlert size={20} className="mt-0.5 shrink-0 text-red-400" />
      <div>
        <p className="font-semibold text-red-300">Unknown hostnames are not refused</p>
        <p className="mt-1 text-zinc-300">
          The HTTPS catch-all (
          <code className="text-zinc-200">lamalibre-lamaste-https-default</code>) {problem}. A
          hostname no site serves — a typo under a wildcard DNS record — gets another site&rsquo;s
          certificate and sign-in redirect.
        </p>
        <p className="mt-1 text-zinc-400">
          Another nginx site may own port 443&rsquo;s default server: find it with{' '}
          <code className="text-zinc-200">grep -rn default_server /etc/nginx/sites-enabled/</code>,
          remove it, then run the Panel Update.
        </p>
      </div>
    </div>
  );
}

function ServiceHealthDot({ status }) {
  const colorClass =
    status === 'active' ? 'bg-green-500' : status === 'failed' ? 'bg-red-500' : 'bg-zinc-500';

  return <span className={`inline-block w-2 h-2 rounded-full ${colorClass}`} />;
}

export default function Dashboard() {
  const client = useAdminClient();

  const statsQuery = useQuery({
    queryKey: ['system-stats'],
    queryFn: () => client.getSystemStats(),
    refetchInterval: 5000,
  });

  const servicesQuery = useQuery({
    queryKey: ['services'],
    queryFn: () => client.getServices(),
    refetchInterval: 5000,
  });

  const stats = statsQuery.data;
  const services = servicesQuery.data?.services;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-white">Dashboard</h1>
        <p className="text-zinc-500 text-sm mt-1">System overview and service health</p>
      </div>

      <HttpsCatchAllWarning status={stats?.httpsCatchAll?.status} />

      {/* System Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        <StatsCard
          icon={Cpu}
          label="CPU Usage"
          value={stats ? `${stats.cpu.usage}%` : '\u2014'}
          isLoading={statsQuery.isLoading}
          isError={statsQuery.isError}
        />
        <StatsCard
          icon={Database}
          label="Memory Usage"
          value={
            stats
              ? `${formatBytes(stats.memory.used)} / ${formatBytes(stats.memory.total)}`
              : '\u2014'
          }
          isLoading={statsQuery.isLoading}
          isError={statsQuery.isError}
        />
        <StatsCard
          icon={HardDrive}
          label="Disk Usage"
          value={
            stats ? `${formatBytes(stats.disk.used)} / ${formatBytes(stats.disk.total)}` : '\u2014'
          }
          isLoading={statsQuery.isLoading}
          isError={statsQuery.isError}
        />
        <StatsCard
          icon={Clock}
          label="Uptime"
          value={stats ? formatUptime(stats.uptime) : '\u2014'}
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
            Active Services:{' '}
            <span className="text-white">
              {services ? services.filter((s) => s.status === 'active').length : '—'}
            </span>
          </div>
          <div className="text-zinc-400">
            Total Services: <span className="text-white">{services ? services.length : '—'}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

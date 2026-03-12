import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Play, Square, RotateCw, Server } from 'lucide-react';
import { useToast } from '../../components/Toast.jsx';

async function fetchServices() {
  const res = await fetch('/api/services');
  if (!res.ok) throw new Error('Failed to fetch services');
  return res.json();
}

async function executeAction({ name, action }) {
  const res = await fetch(`/api/services/${name}/${action}`, { method: 'POST' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Failed to ${action} ${name}`);
  return data;
}

function StatusBadge({ status }) {
  const styles =
    status === 'active'
      ? 'bg-green-500/20 text-green-400'
      : status === 'failed'
        ? 'bg-red-500/20 text-red-400'
        : 'bg-zinc-500/20 text-zinc-400';

  const label =
    status === 'active'
      ? 'Active'
      : status === 'failed'
        ? 'Failed'
        : status === 'inactive'
          ? 'Inactive'
          : 'Unknown';

  return (
    <span className={`text-xs px-2 py-0.5 rounded-full ${styles}`}>{label}</span>
  );
}

function ServiceCard({ service, onAction, isActing }) {
  const [confirmStop, setConfirmStop] = useState(false);
  const isPanelService = service.name === 'portlama-panel';

  const handleStop = () => {
    if (isPanelService) return;
    if (!confirmStop) {
      setConfirmStop(true);
      return;
    }
    setConfirmStop(false);
    onAction(service.name, 'stop');
  };

  const cancelStop = () => setConfirmStop(false);

  return (
    <div className="rounded-lg bg-zinc-900 border border-zinc-800 p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Server size={16} className="text-cyan-400" />
          <span className="text-white font-semibold">{service.name}</span>
        </div>
        <StatusBadge status={service.status} />
      </div>

      <p className="text-zinc-400 text-sm mb-4">
        {service.status === 'active' && service.uptime
          ? `Uptime: ${service.uptime}`
          : '\u2014'}
      </p>

      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={isActing}
          onClick={() => onAction(service.name, 'start')}
          className="flex items-center gap-1.5 rounded bg-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-600 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Play size={12} />
          Start
        </button>

        {confirmStop ? (
          <span className="flex items-center gap-1.5 text-xs">
            <span className="text-zinc-400">Stop?</span>
            <button
              type="button"
              onClick={handleStop}
              className="rounded bg-red-600 px-2 py-1 text-white hover:bg-red-500"
            >
              Yes
            </button>
            <button
              type="button"
              onClick={cancelStop}
              className="rounded bg-zinc-700 px-2 py-1 text-zinc-300 hover:bg-zinc-600"
            >
              No
            </button>
          </span>
        ) : (
          <button
            type="button"
            disabled={isActing || isPanelService}
            onClick={handleStop}
            title={isPanelService ? 'Cannot stop panel service' : 'Stop service'}
            className="flex items-center gap-1.5 rounded bg-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Square size={12} />
            Stop
          </button>
        )}

        <button
          type="button"
          disabled={isActing}
          onClick={() => onAction(service.name, 'restart')}
          className="flex items-center gap-1.5 rounded bg-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-600 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <RotateCw size={12} />
          Restart
        </button>
      </div>
    </div>
  );
}

const MAX_LOG_LINES = 1000;

function LogViewer({ services }) {
  const [selectedService, setSelectedService] = useState('');
  const [logLines, setLogLines] = useState([]);
  const [wsError, setWsError] = useState(null);
  const containerRef = useRef(null);
  const wsRef = useRef(null);

  const handleServiceChange = useCallback((e) => {
    setSelectedService(e.target.value);
    setLogLines([]);
    setWsError(null);
  }, []);

  // Auto-scroll to bottom on new log lines
  useEffect(() => {
    const el = containerRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [logLines]);

  useEffect(() => {
    // Close existing connection
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    if (!selectedService) return;

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(
      `${proto}//${window.location.host}/api/services/${selectedService}/logs`,
    );

    wsRef.current = ws;

    ws.onmessage = (e) => {
      try {
        const parsed = JSON.parse(e.data);
        setLogLines((prev) => {
          const next = [...prev, parsed];
          return next.length > MAX_LOG_LINES ? next.slice(-MAX_LOG_LINES) : next;
        });
      } catch {
        // Ignore non-JSON messages
      }
    };

    ws.onerror = () => {
      setWsError('Connection lost');
    };

    ws.onclose = () => {
      wsRef.current = null;
    };

    return () => {
      ws.close();
    };
  }, [selectedService]);

  const serviceNames = services?.map((s) => s.name) || [];

  return (
    <div className="rounded-lg bg-zinc-900 border border-zinc-800 p-5">
      <h2 className="text-sm font-semibold text-zinc-300 mb-4">Service Logs</h2>

      <select
        value={selectedService}
        onChange={handleServiceChange}
        className="mb-4 rounded bg-zinc-800 border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 focus:outline-none focus:border-cyan-400"
      >
        <option value="">Select a service...</option>
        {serviceNames.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>

      <div
        ref={containerRef}
        className="h-96 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-950 p-4 font-mono text-sm"
      >
        {!selectedService ? (
          <p className="text-zinc-500 text-center mt-36">
            Select a service to view its logs
          </p>
        ) : wsError ? (
          <p className="text-red-400">{wsError}</p>
        ) : logLines.length === 0 ? (
          <p className="text-zinc-500 text-center mt-36">Waiting for log data...</p>
        ) : (
          logLines.map((line, i) => (
            <div key={i} className="leading-relaxed">
              {line.timestamp && (
                <span className="text-zinc-500">{line.timestamp} </span>
              )}
              <span className="text-zinc-300">{line.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default function Services() {
  const queryClient = useQueryClient();
  const addToast = useToast();

  const servicesQuery = useQuery({
    queryKey: ['services'],
    queryFn: fetchServices,
    refetchInterval: 5000,
  });

  const actionMutation = useMutation({
    mutationFn: executeAction,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['services'] });
      addToast(`${data.name} ${data.action}ed successfully`);
    },
    onError: (err) => {
      addToast(err.message, 'error');
    },
  });

  const handleAction = useCallback(
    (name, action) => {
      actionMutation.mutate({ name, action });
    },
    [actionMutation],
  );

  const services = servicesQuery.data?.services;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-white">Services</h1>
        <p className="text-zinc-500 text-sm mt-1">
          Manage system services and view live logs
        </p>
      </div>

      {/* Service Cards */}
      {servicesQuery.isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-40 animate-pulse rounded-lg bg-zinc-900 border border-zinc-800"
            />
          ))}
        </div>
      ) : servicesQuery.isError ? (
        <div className="rounded-lg bg-zinc-900 border border-zinc-800 p-6 mb-8">
          <p className="text-red-400 text-sm">Failed to load services</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
          {services?.map((svc) => (
            <ServiceCard
              key={svc.name}
              service={svc}
              onAction={handleAction}
              isActing={actionMutation.isPending}
            />
          ))}
        </div>
      )}

      {/* Log Viewer */}
      <LogViewer services={services} />
    </div>
  );
}

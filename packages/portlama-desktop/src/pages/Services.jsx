import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { invoke } from '@tauri-apps/api/core';
import {
  Loader2,
  RefreshCw,
  Plus,
  X,
  Globe,
  Brain,
  Database,
  Container,
  Code,
  Film,
  BarChart3,
  Wrench,
  Trash2,
} from 'lucide-react';

const CATEGORIES = [
  { id: 'all', label: 'All', icon: null },
  { id: 'ai', label: 'AI', icon: Brain },
  { id: 'database', label: 'Database', icon: Database },
  { id: 'docker', label: 'Docker', icon: Container },
  { id: 'dev', label: 'Dev', icon: Code },
  { id: 'media', label: 'Media', icon: Film },
  { id: 'monitoring', label: 'Monitoring', icon: BarChart3 },
  { id: 'custom', label: 'Custom', icon: Wrench },
];

const CATEGORY_COLORS = {
  ai: 'text-purple-400 bg-purple-500/10 border-purple-500/20',
  database: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
  dev: 'text-green-400 bg-green-500/10 border-green-500/20',
  media: 'text-pink-400 bg-pink-500/10 border-pink-500/20',
  monitoring: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20',
  custom: 'text-orange-400 bg-orange-500/10 border-orange-500/20',
};

const STATUS_BADGE = {
  running: 'text-green-400 bg-green-500/10 border-green-500/20',
  installed: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
  not_found: 'text-zinc-500 bg-zinc-800 border-zinc-700',
};

const CATEGORY_DROPDOWN_OPTIONS = ['ai', 'database', 'dev', 'media', 'monitoring', 'custom'];

function CategoryIcon({ category, size = 14 }) {
  const cat = CATEGORIES.find((c) => c.id === category);
  if (!cat?.icon) return null;
  const Icon = cat.icon;
  return <Icon size={size} />;
}

export default function Services() {
  const queryClient = useQueryClient();
  const [activeCategory, setActiveCategory] = useState('all');
  const [showExposeModal, setShowExposeModal] = useState(null);
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [exposeData, setExposeData] = useState({ subdomain: '', port: '', description: '' });
  const [exposeError, setExposeError] = useState(null);
  const [customData, setCustomData] = useState({
    name: '',
    port: '',
    binary: '',
    processName: '',
    category: 'dev',
    description: '',
  });
  const [customError, setCustomError] = useState(null);
  const [removeConfirm, setRemoveConfirm] = useState(null);
  const [removeError, setRemoveError] = useState(null);

  const servicesQuery = useQuery({
    queryKey: ['services'],
    queryFn: () => invoke('scan_services'),
    refetchInterval: 15000,
  });

  const exposeMutation = useMutation({
    mutationFn: async (data) => {
      await invoke('create_tunnel', {
        subdomain: data.subdomain,
        port: parseInt(data.port, 10),
        description: data.description || '',
      });
      await invoke('update_agent');
    },
    onSuccess: () => {
      setShowExposeModal(null);
      setExposeError(null);
      queryClient.invalidateQueries({ queryKey: ['services'] });
      queryClient.invalidateQueries({ queryKey: ['tunnels'] });
    },
    onError: (err) => {
      setExposeError(err?.message || String(err));
    },
  });

  const addCustomMutation = useMutation({
    mutationFn: (data) =>
      invoke('add_custom_service', {
        name: data.name,
        port: parseInt(data.port, 10),
        binary: data.binary || null,
        processName: data.processName || null,
        category: data.category,
        description: data.description || '',
      }),
    onSuccess: () => {
      setShowCustomForm(false);
      setCustomData({
        name: '',
        port: '',
        binary: '',
        processName: '',
        category: 'dev',
        description: '',
      });
      setCustomError(null);
      queryClient.invalidateQueries({ queryKey: ['services'] });
    },
    onError: (err) => {
      setCustomError(err?.message || String(err));
    },
  });

  const removeCustomMutation = useMutation({
    mutationFn: (id) => invoke('remove_custom_service', { id }),
    onSuccess: () => {
      setRemoveConfirm(null);
      setRemoveError(null);
      queryClient.invalidateQueries({ queryKey: ['services'] });
    },
    onError: (err) => {
      setRemoveError(err?.message || String(err));
    },
  });

  const scanResult = servicesQuery.data;
  const allServices = scanResult?.services || [];
  const dockerContainers = scanResult?.dockerContainers || [];

  const filteredServices =
    activeCategory === 'all'
      ? allServices
      : activeCategory === 'custom'
        ? allServices.filter((s) => s.source === 'custom')
        : allServices.filter((s) => s.category === activeCategory);

  const showDocker = activeCategory === 'all' || activeCategory === 'docker';

  const openExposeModal = (id, port, description) => {
    setExposeData({ subdomain: id, port: String(port), description });
    setExposeError(null);
    setShowExposeModal(id);
  };

  const handleExpose = (e) => {
    e.preventDefault();
    setExposeError(null);
    const port = parseInt(exposeData.port, 10);
    if (!exposeData.subdomain || !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(exposeData.subdomain)) {
      setExposeError('Subdomain must be lowercase alphanumeric with optional hyphens');
      return;
    }
    if (exposeData.subdomain.length > 63) {
      setExposeError('Subdomain must be at most 63 characters');
      return;
    }
    if (isNaN(port) || port < 1024 || port > 65535) {
      setExposeError('Port must be between 1024 and 65535');
      return;
    }
    exposeMutation.mutate(exposeData);
  };

  const handleAddCustom = (e) => {
    e.preventDefault();
    setCustomError(null);
    if (!customData.name.trim()) {
      setCustomError('Name is required');
      return;
    }
    const port = parseInt(customData.port, 10);
    if (isNaN(port) || port < 1 || port > 65535) {
      setCustomError('Port must be between 1 and 65535');
      return;
    }
    addCustomMutation.mutate(customData);
  };

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-lg font-bold text-white">Services</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => queryClient.invalidateQueries({ queryKey: ['services'] })}
            disabled={servicesQuery.isFetching}
            className="flex items-center gap-1.5 rounded bg-zinc-800 border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-700 disabled:opacity-50"
          >
            <RefreshCw size={14} className={servicesQuery.isFetching ? 'animate-spin' : ''} />
            Scan
          </button>
          <button
            onClick={() => setShowCustomForm(true)}
            className="flex items-center gap-1.5 rounded bg-cyan-600 hover:bg-cyan-500 px-3 py-1.5 text-sm text-white"
          >
            <Plus size={14} />
            Add Custom
          </button>
        </div>
      </div>

      {/* Category filter */}
      <div className="flex gap-1 mb-5 flex-wrap">
        {CATEGORIES.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveCategory(id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
              activeCategory === id
                ? 'bg-zinc-800 text-cyan-400 border border-cyan-500/30'
                : 'bg-zinc-900 text-zinc-400 border border-zinc-800 hover:text-zinc-200 hover:bg-zinc-800'
            }`}
          >
            {Icon && <Icon size={12} />}
            {label}
          </button>
        ))}
      </div>

      {/* Custom service form */}
      {showCustomForm && (
        <form
          onSubmit={handleAddCustom}
          className="bg-zinc-900 border border-zinc-800 rounded-lg p-5 mb-4"
        >
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-white">Add Custom Service</h2>
            <button
              type="button"
              onClick={() => {
                setShowCustomForm(false);
                setCustomError(null);
              }}
              className="text-zinc-500 hover:text-zinc-300"
            >
              <X size={16} />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className="text-xs text-zinc-500 block mb-1">Name</label>
              <input
                type="text"
                placeholder="My Service"
                value={customData.name}
                onChange={(e) => setCustomData({ ...customData, name: e.target.value })}
                className="w-full rounded bg-zinc-950 border border-zinc-700 px-3 py-2 text-sm text-white placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="text-xs text-zinc-500 block mb-1">Port</label>
              <input
                type="number"
                placeholder="3000"
                min={1}
                max={65535}
                value={customData.port}
                onChange={(e) => setCustomData({ ...customData, port: e.target.value })}
                className="w-full rounded bg-zinc-950 border border-zinc-700 px-3 py-2 text-sm text-white placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className="text-xs text-zinc-500 block mb-1">Binary (optional)</label>
              <input
                type="text"
                placeholder="my-service"
                value={customData.binary}
                onChange={(e) => setCustomData({ ...customData, binary: e.target.value })}
                className="w-full rounded bg-zinc-950 border border-zinc-700 px-3 py-2 text-sm text-white placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="text-xs text-zinc-500 block mb-1">Process name (optional)</label>
              <input
                type="text"
                placeholder="my-service"
                value={customData.processName}
                onChange={(e) => setCustomData({ ...customData, processName: e.target.value })}
                className="w-full rounded bg-zinc-950 border border-zinc-700 px-3 py-2 text-sm text-white placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className="text-xs text-zinc-500 block mb-1">Category</label>
              <select
                value={customData.category}
                onChange={(e) => setCustomData({ ...customData, category: e.target.value })}
                className="w-full rounded bg-zinc-950 border border-zinc-700 px-3 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none"
              >
                {CATEGORY_DROPDOWN_OPTIONS.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-zinc-500 block mb-1">Description</label>
              <input
                type="text"
                placeholder="What this service does"
                value={customData.description}
                onChange={(e) => setCustomData({ ...customData, description: e.target.value })}
                className="w-full rounded bg-zinc-950 border border-zinc-700 px-3 py-2 text-sm text-white placeholder-zinc-600 focus:border-cyan-500 focus:outline-none"
              />
            </div>
          </div>
          {customError && <p className="text-red-400 text-xs mb-3">{customError}</p>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={addCustomMutation.isPending}
              className="flex items-center gap-2 rounded bg-cyan-600 hover:bg-cyan-500 px-4 py-2 text-sm text-white disabled:opacity-50"
            >
              {addCustomMutation.isPending && <Loader2 size={14} className="animate-spin" />}
              Add Service
            </button>
            <button
              type="button"
              onClick={() => {
                setShowCustomForm(false);
                setCustomError(null);
              }}
              className="rounded bg-zinc-800 border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-700"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Loading state */}
      {servicesQuery.isLoading ? (
        <div className="flex items-center gap-2 text-zinc-500">
          <Loader2 size={14} className="animate-spin" />
          Scanning services...
        </div>
      ) : (
        <>
          {/* Service cards */}
          {filteredServices.length > 0 && (
            <div className="grid grid-cols-2 gap-4 mb-6">
              {filteredServices.map((service) => (
                <ServiceCard
                  key={service.id}
                  service={service}
                  onExpose={() =>
                    openExposeModal(
                      service.id,
                      service.detectedPort || service.defaultPort,
                      service.description,
                    )
                  }
                  isCustom={service.source === 'custom'}
                  removeConfirm={removeConfirm}
                  onRemoveClick={() => setRemoveConfirm(service.id)}
                  onRemoveConfirm={() => removeCustomMutation.mutate(service.id)}
                  onRemoveCancel={() => {
                    setRemoveConfirm(null);
                    setRemoveError(null);
                  }}
                  removeIsPending={removeCustomMutation.isPending}
                />
              ))}
            </div>
          )}

          {removeError && <p className="text-red-400 text-xs mb-3">{removeError}</p>}

          {filteredServices.length === 0 && !showDocker && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-8 text-center mb-6">
              <p className="text-zinc-400 text-sm">No services found in this category.</p>
            </div>
          )}

          {/* Docker section */}
          {showDocker && dockerContainers.length > 0 && (
            <>
              <div className="flex items-center gap-2 mb-4">
                <Container size={16} className="text-cyan-400" />
                <h2 className="text-sm font-semibold text-white">Docker Containers</h2>
                <span className="text-xs text-zinc-500">({dockerContainers.length})</span>
              </div>
              <div className="grid grid-cols-2 gap-4">
                {dockerContainers.map((container) => (
                  <DockerCard
                    key={container.id}
                    container={container}
                    onExpose={(port) =>
                      openExposeModal(
                        container.name.replace(/[^a-z0-9-]/g, '-'),
                        port,
                        `Docker: ${container.image}`,
                      )
                    }
                  />
                ))}
              </div>
            </>
          )}
        </>
      )}

      {/* Expose modal */}
      {showExposeModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <form
            onSubmit={handleExpose}
            className="bg-zinc-900 border border-zinc-800 rounded-lg p-6 w-96"
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-white">Expose Service</h2>
              <button
                type="button"
                onClick={() => {
                  setShowExposeModal(null);
                  setExposeError(null);
                }}
                className="text-zinc-500 hover:text-zinc-300"
              >
                <X size={16} />
              </button>
            </div>
            <div className="space-y-3 mb-4">
              <div>
                <label className="text-xs text-zinc-500 block mb-1">Subdomain</label>
                <input
                  type="text"
                  value={exposeData.subdomain}
                  onChange={(e) =>
                    setExposeData({ ...exposeData, subdomain: e.target.value.toLowerCase() })
                  }
                  className="w-full rounded bg-zinc-950 border border-zinc-700 px-3 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="text-xs text-zinc-500 block mb-1">Port</label>
                <input
                  type="number"
                  min={1024}
                  max={65535}
                  value={exposeData.port}
                  onChange={(e) => setExposeData({ ...exposeData, port: e.target.value })}
                  className="w-full rounded bg-zinc-950 border border-zinc-700 px-3 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="text-xs text-zinc-500 block mb-1">Description</label>
                <input
                  type="text"
                  value={exposeData.description}
                  onChange={(e) => setExposeData({ ...exposeData, description: e.target.value })}
                  className="w-full rounded bg-zinc-950 border border-zinc-700 px-3 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none"
                />
              </div>
            </div>
            {exposeError && <p className="text-red-400 text-xs mb-3">{exposeError}</p>}
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={exposeMutation.isPending}
                className="flex items-center gap-2 rounded bg-cyan-600 hover:bg-cyan-500 px-4 py-2 text-sm text-white disabled:opacity-50"
              >
                {exposeMutation.isPending && <Loader2 size={14} className="animate-spin" />}
                <Globe size={14} />
                Expose
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowExposeModal(null);
                  setExposeError(null);
                }}
                className="rounded bg-zinc-800 border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-700"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function ServiceCard({
  service,
  onExpose,
  isCustom,
  removeConfirm,
  onRemoveClick,
  onRemoveConfirm,
  onRemoveCancel,
  removeIsPending,
}) {
  const isRunning = service.status === 'running';
  const hasTunnel = !!service.tunnelFqdn;
  const categoryColor = CATEGORY_COLORS[service.category] || CATEGORY_COLORS.custom;
  const statusColor = STATUS_BADGE[service.status] || STATUS_BADGE.not_found;
  const showingConfirm = removeConfirm === service.id;

  return (
    <div
      className={`bg-zinc-900 border border-zinc-800 rounded-lg p-4 ${service.status === 'not_found' ? 'opacity-50' : ''}`}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <CategoryIcon category={service.category} size={14} />
          <span className="text-sm font-semibold text-white">{service.name}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={`text-xs px-2 py-0.5 rounded-full border ${categoryColor}`}>
            {service.category}
          </span>
          <span className={`text-xs px-2 py-0.5 rounded-full border ${statusColor}`}>
            {service.status === 'not_found' ? 'not found' : service.status}
          </span>
        </div>
      </div>
      <p className="text-xs text-zinc-500 mb-3">{service.description}</p>
      <div className="flex items-center justify-between">
        <span className="text-xs text-zinc-400 font-mono">
          Port {service.defaultPort}
          {service.detectedPort && service.detectedPort !== service.defaultPort && (
            <span className="text-cyan-400"> → detected {service.detectedPort}</span>
          )}
        </span>
        <div className="flex items-center gap-1.5">
          {isCustom && !showingConfirm && (
            <button
              onClick={onRemoveClick}
              className="text-zinc-600 hover:text-red-400 p-1"
              title="Remove custom service"
            >
              <Trash2 size={12} />
            </button>
          )}
          {isCustom && showingConfirm && (
            <div className="flex items-center gap-1">
              <button
                onClick={onRemoveConfirm}
                disabled={removeIsPending}
                className="text-xs px-2 py-1 rounded bg-red-600 hover:bg-red-500 text-white disabled:opacity-50"
              >
                {removeIsPending ? 'Removing...' : 'Confirm'}
              </button>
              <button
                onClick={onRemoveCancel}
                className="text-xs px-2 py-1 rounded bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
              >
                Cancel
              </button>
            </div>
          )}
          {isRunning && !hasTunnel && (
            <button
              onClick={onExpose}
              className="flex items-center gap-1 rounded bg-cyan-600 hover:bg-cyan-500 px-2.5 py-1 text-xs text-white"
            >
              <Globe size={12} />
              Expose
            </button>
          )}
          {hasTunnel && (
            <span
              className="text-xs text-cyan-400 font-mono truncate max-w-[160px]"
              title={service.tunnelFqdn}
            >
              {service.tunnelFqdn}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function DockerCard({ container, onExpose }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <Container size={14} className="text-cyan-400" />
          <span className="text-sm font-semibold text-white">{container.name}</span>
        </div>
        <span className="text-xs px-2 py-0.5 rounded-full border text-cyan-400 bg-cyan-500/10 border-cyan-500/20">
          docker
        </span>
      </div>
      <p className="text-xs text-zinc-500 mb-1 font-mono truncate" title={container.image}>
        {container.image}
      </p>
      <p className="text-xs text-zinc-600 mb-3">{container.status}</p>
      {container.ports.length > 0 ? (
        <div className="space-y-1.5">
          {container.ports.map((port, idx) => (
            <div key={idx} className="flex items-center justify-between">
              <span className="text-xs text-zinc-400 font-mono">
                :{port.hostPort} → :{port.containerPort}/{port.protocol}
              </span>
              {container.tunnelFqdn ? (
                <span
                  className="text-xs text-cyan-400 font-mono truncate max-w-[160px]"
                  title={container.tunnelFqdn}
                >
                  {container.tunnelFqdn}
                </span>
              ) : (
                <button
                  onClick={() => onExpose(port.hostPort)}
                  className="flex items-center gap-1 rounded bg-cyan-600 hover:bg-cyan-500 px-2.5 py-1 text-xs text-white"
                >
                  <Globe size={12} />
                  Expose
                </button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-zinc-600">No exposed ports</p>
      )}
    </div>
  );
}

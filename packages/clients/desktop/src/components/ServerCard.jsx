import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-shell';
import {
  Server,
  Trash2,
  ExternalLink,
  Globe,
  Loader2,
  AlertTriangle,
  X,
  ChevronsUp,
  ChevronUp,
  ArrowUpCircle,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { useState, useEffect } from 'react';

// ---------------------------------------------------------------------------
// Update helpers (same pattern as LocalPlugins)
// ---------------------------------------------------------------------------

function getUpdateType(current, latest) {
  const parse = (v) => (v || '0.0.0').split('.').map(Number);
  const [cMaj, cMin] = parse(current);
  const [lMaj, lMin] = parse(latest);
  if (lMaj > cMaj) return 'major';
  if (lMin > cMin) return 'minor';
  return 'patch';
}

function UpdateIcon({ type, size = 14 }) {
  if (type === 'major') return <ChevronsUp size={size} className="text-red-400" />;
  if (type === 'minor') return <ChevronUp size={size} className="text-amber-400" />;
  return <ArrowUpCircle size={size} className="text-cyan-400" />;
}

// ---------------------------------------------------------------------------
// Update steps for progress display
// ---------------------------------------------------------------------------

const UPDATE_STEPS = [
  { key: 'update_panel', label: 'Sending update request' },
  { key: 'verify_health', label: 'Waiting for server to restart' },
];

// ---------------------------------------------------------------------------
// Server Update Dialog
// ---------------------------------------------------------------------------

function ServerUpdateDialog({
  server,
  updateInfo,
  onClose,
  onUpdate,
  isUpdating,
  updateStep,
  updateError,
  updateSuccess,
}) {
  const updateType = getUpdateType(updateInfo.currentVersion, updateInfo.latestVersion);
  const typeLabel = { major: 'Major', minor: 'Minor', patch: 'Patch' }[updateType];
  const typeColor = { major: 'text-red-400', minor: 'text-amber-400', patch: 'text-cyan-400' }[
    updateType
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-full max-w-sm rounded-lg bg-zinc-900 border border-zinc-700 shadow-xl">
        <div className="flex items-center justify-between p-4 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <UpdateIcon type={updateType} size={16} />
            <span className="text-white font-semibold text-sm">{typeLabel} Update Available</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isUpdating && !updateError && !updateSuccess}
            className="text-zinc-500 hover:text-zinc-300 disabled:opacity-30"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-4 space-y-3">
          {!isUpdating ? (
            <>
              <div className="flex items-center justify-between text-sm">
                <span className="text-zinc-400">Server</span>
                <span className="text-white">{server.label}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-zinc-400">Current</span>
                <span className="text-zinc-300 font-mono text-xs">
                  v{updateInfo.currentVersion}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-zinc-400">Latest</span>
                <span className={`font-mono text-xs ${typeColor}`}>
                  v{updateInfo.latestVersion}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-zinc-400">Type</span>
                <span className={`text-xs ${typeColor}`}>{typeLabel}</span>
              </div>
              <p className="text-xs text-zinc-500">
                The panel server will restart during update. Tunnels will briefly disconnect.
              </p>
            </>
          ) : (
            <div className="space-y-2">
              {UPDATE_STEPS.map((step) => {
                const currentIdx = UPDATE_STEPS.findIndex((s) => s.key === updateStep);
                const stepIdx = UPDATE_STEPS.indexOf(step);
                const isPast = updateSuccess || (currentIdx >= 0 && currentIdx > stepIdx);
                const isCurrent = updateStep === step.key;

                return (
                  <div key={step.key} className="flex items-center gap-2 text-xs">
                    {isCurrent && updateError ? (
                      <XCircle size={12} className="text-red-400" />
                    ) : isCurrent ? (
                      <Loader2 size={12} className="animate-spin text-cyan-400" />
                    ) : isPast ? (
                      <CheckCircle2 size={12} className="text-green-400" />
                    ) : (
                      <div className="w-3 h-3 rounded-full border border-zinc-700" />
                    )}
                    <span
                      className={
                        isCurrent && updateError
                          ? 'text-red-400'
                          : isCurrent
                            ? 'text-cyan-400'
                            : isPast
                              ? 'text-zinc-400'
                              : 'text-zinc-600'
                      }
                    >
                      {step.label}
                    </span>
                  </div>
                );
              })}

              {updateError && (
                <div className="mt-3 p-3 rounded bg-red-500/10 border border-red-500/20">
                  <p className="text-xs text-red-400">{updateError}</p>
                </div>
              )}

              {updateSuccess && (
                <div className="mt-3 p-3 rounded bg-green-500/10 border border-green-500/20">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 size={14} className="text-green-400" />
                    <p className="text-xs text-green-400 font-medium">Panel server updated!</p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 p-4 border-t border-zinc-800">
          {!isUpdating ? (
            <>
              <button
                type="button"
                onClick={onClose}
                className="rounded px-3 py-1.5 text-xs text-zinc-300 bg-zinc-700 hover:bg-zinc-600"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onUpdate}
                className="rounded px-3 py-1.5 text-xs text-white bg-cyan-600 hover:bg-cyan-500"
              >
                Update
              </button>
            </>
          ) : updateSuccess ? (
            <button
              type="button"
              onClick={onClose}
              className="rounded px-3 py-1.5 text-xs text-green-400 bg-green-400/10 hover:bg-green-400/20 flex items-center gap-1"
            >
              <CheckCircle2 size={12} />
              Done
            </button>
          ) : updateError ? (
            <button
              type="button"
              onClick={onUpdate}
              className="rounded px-3 py-1.5 text-xs text-cyan-400 bg-cyan-400/10 hover:bg-cyan-400/20"
            >
              Retry
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main ServerCard
// ---------------------------------------------------------------------------

export default function ServerCard({ server, onSetActive, onManage }) {
  const queryClient = useQueryClient();
  const [confirmAction, setConfirmAction] = useState(null); // null | 'remove' | 'destroy'
  const [showDestroyModal, setShowDestroyModal] = useState(false);
  const [destroyAction, setDestroyAction] = useState('remove'); // 'remove' | 'destroy'
  const [confirmInput, setConfirmInput] = useState('');
  const [showUpdateDialog, setShowUpdateDialog] = useState(false);
  const [updateStep, setUpdateStep] = useState(null);
  const [updateError, setUpdateError] = useState(null);
  const [updateSuccess, setUpdateSuccess] = useState(false);

  const healthQuery = useQuery({
    queryKey: ['server-health', server.id],
    queryFn: () => invoke('check_server_health', { serverId: server.id }),
    refetchInterval: 30000,
  });

  const updateQuery = useQuery({
    queryKey: ['panel-update', server.id],
    queryFn: () => invoke('check_panel_update', { serverId: server.id }),
    enabled: healthQuery.data?.online === true && !!server.providerId,
    refetchInterval: 60000,
    staleTime: 30000,
  });

  // Listen for update progress events
  useEffect(() => {
    const unlisten = listen('panel-update-progress', (event) => {
      const { step, status } = event.payload;
      if (step && (status === 'running' || status === 'done')) {
        setUpdateStep(step);
      }
      if (step === 'complete' && status === 'done') {
        setUpdateSuccess(true);
        queryClient.invalidateQueries({ queryKey: ['panel-update', server.id] });
        queryClient.invalidateQueries({ queryKey: ['server-health', server.id] });
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [server.id, queryClient]);

  const startUpdate = async () => {
    setUpdateStep(null);
    setUpdateError(null);
    setUpdateSuccess(false);

    const info = updateQuery.data;
    if (!info) return;

    try {
      setUpdateStep(UPDATE_STEPS[0].key);
      await invoke('update_panel_server', {
        serverId: server.id,
        version: info.installerVersion,
      });
      setUpdateSuccess(true);
    } catch (err) {
      setUpdateError(err.toString());
    }
  };

  const destroyMutation = useMutation({
    mutationFn: () => invoke('destroy_cloud_server', { serverId: server.id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['servers'] });
      setShowDestroyModal(false);
    },
  });

  const removeMutation = useMutation({
    mutationFn: () => invoke('remove_server', { serverId: server.id }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['servers'] }),
  });

  const online = healthQuery.data?.online ?? false;
  const hasCloudControls = !!server.providerId;
  const updateInfo = updateQuery.data;
  const hasUpdate = updateInfo?.hasUpdate === true;
  const updateType = hasUpdate
    ? getUpdateType(updateInfo.currentVersion, updateInfo.latestVersion)
    : null;
  const isUpdating = updateStep !== null && !updateError && !updateSuccess;

  return (
    <div className="rounded-lg bg-zinc-900 border border-zinc-800 p-4">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <Server size={16} className="text-zinc-400" />
          <span className="text-sm font-medium text-white">{server.label}</span>
          {server.active && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-400/10 text-cyan-400 font-medium">
              Active
            </span>
          )}
          {hasUpdate && (
            <button
              onClick={() => setShowUpdateDialog(true)}
              className="p-0.5 rounded hover:bg-zinc-800"
              title={`Update available: v${updateInfo.currentVersion} → v${updateInfo.latestVersion}`}
            >
              <UpdateIcon type={updateType} size={14} />
            </button>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <span className={`h-2 w-2 rounded-full ${online ? 'bg-green-400' : 'bg-red-400'}`} />
          <span className="text-xs text-zinc-500">{online ? 'Online' : 'Offline'}</span>
        </div>
      </div>

      <div className="space-y-1 mb-4">
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          <Globe size={12} />
          <span className="font-mono">{server.ip}</span>
        </div>
        {server.region && <div className="text-xs text-zinc-500 ml-5">Region: {server.region}</div>}
        {server.provider && (
          <div className="text-xs text-zinc-500 ml-5">Provider: {server.provider}</div>
        )}
        {updateInfo?.currentVersion && (
          <div className="text-xs text-zinc-500 ml-5">
            Panel: v{updateInfo.currentVersion}
            {updateInfo.hasUpdate === false && (
              <span className="text-green-400/60 ml-1">(up to date)</span>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        {!server.active && (
          <button
            onClick={() => onSetActive(server.id)}
            className="text-xs px-2.5 py-1.5 rounded bg-zinc-800 text-zinc-300 hover:text-white hover:bg-zinc-700"
          >
            Set Active
          </button>
        )}
        {onManage && (
          <button
            onClick={() => onManage(server)}
            className="text-xs px-2.5 py-1.5 rounded bg-cyan-400/10 text-cyan-400 hover:bg-cyan-400/20 flex items-center gap-1"
          >
            <Server size={10} />
            Manage
          </button>
        )}
        <button
          onClick={() => {
            if (server.panelUrl?.startsWith('https://')) open(server.panelUrl);
          }}
          className="text-xs px-2.5 py-1.5 rounded bg-zinc-800 text-zinc-300 hover:text-white hover:bg-zinc-700 flex items-center gap-1"
        >
          <ExternalLink size={10} />
          Panel
        </button>

        {confirmAction ? (
          <div className="flex items-center gap-2 ml-auto">
            <span className="text-xs text-red-400">Are you sure?</span>
            <button
              onClick={() => {
                setDestroyAction(confirmAction);
                setConfirmAction(null);
                setShowDestroyModal(true);
                setConfirmInput('');
              }}
              className="text-xs px-2 py-1 rounded bg-red-500/20 text-red-400 hover:bg-red-500/30"
            >
              Yes
            </button>
            <button
              onClick={() => setConfirmAction(null)}
              className="text-xs px-2 py-1 rounded bg-zinc-800 text-zinc-400 hover:text-white"
            >
              No
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 ml-auto">
            {hasCloudControls && (
              <button
                onClick={() => setConfirmAction('remove')}
                className="text-xs px-2.5 py-1.5 rounded bg-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-700 flex items-center gap-1"
              >
                <X size={10} />
                Remove
              </button>
            )}
            <button
              onClick={() => setConfirmAction(hasCloudControls ? 'destroy' : 'remove')}
              className="text-xs px-2.5 py-1.5 rounded bg-zinc-800 text-zinc-400 hover:text-red-400 hover:bg-zinc-700 flex items-center gap-1"
            >
              <Trash2 size={10} />
              {hasCloudControls ? 'Destroy' : 'Remove'}
            </button>
          </div>
        )}
      </div>

      {(destroyMutation.isError || removeMutation.isError) && (
        <p className="text-xs text-red-400 mt-2">
          {destroyMutation.error?.toString() || removeMutation.error?.toString()}
        </p>
      )}

      {showDestroyModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg w-full max-w-sm">
            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
              <div className="flex items-center gap-2">
                <AlertTriangle
                  size={14}
                  className={destroyAction === 'destroy' ? 'text-red-400' : 'text-amber-400'}
                />
                <h3 className="text-sm font-bold text-white">
                  {destroyAction === 'destroy' ? 'Destroy Server' : 'Remove Server'}
                </h3>
              </div>
              <button
                onClick={() => setShowDestroyModal(false)}
                disabled={destroyMutation.isPending || removeMutation.isPending}
                className="text-zinc-500 hover:text-white disabled:opacity-30"
              >
                <X size={14} />
              </button>
            </div>
            <div className="px-4 py-4 space-y-3">
              {destroyAction === 'destroy' ? (
                <p className="text-xs text-zinc-400 leading-relaxed">
                  This will <strong className="text-red-400">permanently destroy</strong> the
                  droplet on DigitalOcean and remove it from the local registry. This action cannot
                  be undone.
                </p>
              ) : (
                <p className="text-xs text-zinc-400 leading-relaxed">
                  This will remove the server from the local registry. The server itself will not be
                  affected.
                </p>
              )}
              <div>
                <p className="text-xs text-zinc-400 mb-1.5">
                  Type <strong className="text-white font-mono">{server.label}</strong> to confirm:
                </p>
                <input
                  type="text"
                  value={confirmInput}
                  onChange={(e) => setConfirmInput(e.target.value)}
                  placeholder={server.label}
                  autoFocus
                  className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-white placeholder-zinc-700 focus:outline-none focus:border-red-400 font-mono"
                />
              </div>
              {(destroyMutation.isError || removeMutation.isError) && (
                <p className="text-xs text-red-400">
                  {destroyMutation.error?.toString() || removeMutation.error?.toString()}
                </p>
              )}
            </div>
            <div className="flex justify-end gap-2 px-4 py-3 border-t border-zinc-800">
              <button
                onClick={() => setShowDestroyModal(false)}
                disabled={destroyMutation.isPending || removeMutation.isPending}
                className="text-xs px-3 py-1.5 rounded bg-zinc-800 text-zinc-400 hover:text-white disabled:opacity-30"
              >
                Cancel
              </button>
              <button
                onClick={() =>
                  destroyAction === 'destroy' ? destroyMutation.mutate() : removeMutation.mutate()
                }
                disabled={
                  confirmInput !== server.label ||
                  destroyMutation.isPending ||
                  removeMutation.isPending
                }
                className={`text-xs px-3 py-1.5 rounded disabled:opacity-30 flex items-center gap-1 ${
                  destroyAction === 'destroy'
                    ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                    : 'bg-amber-500/20 text-amber-400 hover:bg-amber-500/30'
                }`}
              >
                {destroyMutation.isPending || removeMutation.isPending ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Trash2 size={10} />
                )}
                {destroyAction === 'destroy' ? 'Destroy' : 'Remove'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showUpdateDialog && updateInfo && (
        <ServerUpdateDialog
          server={server}
          updateInfo={updateInfo}
          onClose={() => {
            setShowUpdateDialog(false);
            if (updateSuccess) {
              setUpdateStep(null);
              setUpdateError(null);
              setUpdateSuccess(false);
            }
          }}
          onUpdate={startUpdate}
          isUpdating={isUpdating || updateSuccess || !!updateError}
          updateStep={updateStep}
          updateError={updateError}
          updateSuccess={updateSuccess}
        />
      )}
    </div>
  );
}

// ==========================================================================
// LocalDaemonPill — footer status pill for a local daemon service
// ==========================================================================
//
// Compact pill in the sidebar footer showing the daemon's service state
// (running / stopped / not installed) with a dropdown for Start / Stop /
// Restart / Install / Uninstall. Polls the service status every 5 seconds.
// Purely for lifecycle management — navigation is handled by the daemon
// entries in the AGENTS/SERVERS sections above.
//
// Install opens an InstallDaemonModal that streams NDJSON progress from
// the Rust backend. Uninstall requires typing "I understand" to confirm.
//
// Errors from actions are sticky: they persist across polls until the user
// explicitly dismisses them. A copy button is provided for long errors.

import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { invoke } from '@tauri-apps/api/core';
import {
  Cpu, Server, Puzzle,
  Play, Square, RotateCcw, Download, Trash2,
  Loader2, AlertTriangle, Copy, Check, X,
} from 'lucide-react';
import InstallDaemonModal from './InstallDaemonModal.jsx';

const POLL_MS = 5_000;

const STATE_META = {
  running:      { dot: 'bg-emerald-500', label: 'running' },
  loaded:       { dot: 'bg-amber-500 animate-pulse', label: 'starting\u2026' },
  stopped:      { dot: 'bg-zinc-600', label: 'stopped' },
  notInstalled: { dot: 'bg-zinc-700', label: 'not installed' },
  error:        { dot: 'bg-red-500', label: 'error' },
};

const KIND_CONFIG = {
  agent:      { label: 'Agent', Icon: Cpu, dataDir: '~/.lamalibre/lamaste/' },
  server:     { label: 'Server', Icon: Server, dataDir: '~/.lamalibre/lamaste/server/' },
  pluginHost: { label: 'Plugin Host', Icon: Puzzle, dataDir: '~/.lamalibre/local/' },
};

export default function LocalDaemonPill({ kind }) {
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [installModalOpen, setInstallModalOpen] = useState(false);
  const [uninstallConfirmOpen, setUninstallConfirmOpen] = useState(false);
  const [uninstallConfirmText, setUninstallConfirmText] = useState('');
  const [uninstallRemoveData, setUninstallRemoveData] = useState(false);
  const [uninstallBusy, setUninstallBusy] = useState(false);
  const rootRef = useRef(null);

  const { label: pillLabel, Icon: PillIcon, dataDir } = KIND_CONFIG[kind] || KIND_CONFIG.agent;

  // ---- Polling ----
  const { data: status } = useQuery({
    queryKey: ['daemon-service-status', kind],
    queryFn: () => invoke('daemon_get_service_status', { kind }),
    refetchInterval: POLL_MS,
  });

  const meta = status ? (STATE_META[status.state] ?? STATE_META.error) : STATE_META.stopped;
  const fullLabel = `${pillLabel} ${meta.label}`;
  const displayError = actionError ?? status?.error ?? null;
  const effectiveDot = actionError ? 'bg-red-500' : meta.dot;

  const canStart = status != null && (status.state === 'stopped' || status.state === 'error');
  const canStop = status != null && (status.state === 'running' || status.state === 'loaded');
  const canRestart = status != null && (status.state === 'running' || status.state === 'loaded');
  const canInstall = status != null && status.state === 'notInstalled';
  const canUninstall = status != null && status.installed;
  const hasActions = canStart || canStop || canRestart || canInstall || canUninstall;

  // ---- Click-outside-to-close ----
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // ---- Actions ----
  const runAction = useCallback(async (command, extra) => {
    setBusy(true);
    setActionError(null);
    try {
      await invoke(command, { kind, ...extra });
      queryClient.invalidateQueries({ queryKey: ['daemon-service-status', kind] });
    } catch (err) {
      setActionError(typeof err === 'string' ? err : err?.message ?? 'Unknown error');
      queryClient.invalidateQueries({ queryKey: ['daemon-service-status', kind] });
    } finally {
      setBusy(false);
    }
  }, [kind, queryClient]);

  const handleInstall = useCallback(() => {
    setOpen(false);
    setInstallModalOpen(true);
  }, []);

  const handleInstallModalClose = useCallback(() => {
    setInstallModalOpen(false);
    queryClient.invalidateQueries({ queryKey: ['daemon-service-status', kind] });
  }, [kind, queryClient]);

  const handleUninstallClick = useCallback(() => {
    setOpen(false);
    setUninstallConfirmText('');
    setUninstallRemoveData(false);
    setUninstallConfirmOpen(true);
  }, []);

  const handleUninstallConfirmed = useCallback(async () => {
    setUninstallBusy(true);
    try {
      await invoke('daemon_uninstall', { kind, removeData: uninstallRemoveData });
      setUninstallConfirmOpen(false);
      queryClient.invalidateQueries({ queryKey: ['daemon-service-status', kind] });
    } catch (err) {
      setActionError(typeof err === 'string' ? err : err?.message ?? 'Uninstall failed');
      setUninstallConfirmOpen(false);
      queryClient.invalidateQueries({ queryKey: ['daemon-service-status', kind] });
    } finally {
      setUninstallBusy(false);
    }
  }, [kind, uninstallRemoveData, queryClient]);

  const handleCopy = useCallback(async () => {
    if (!displayError) return;
    try {
      await navigator.clipboard.writeText(displayError);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API may fail
    }
  }, [displayError]);

  return (
    <>
      <div className="relative" ref={rootRef}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center gap-2 rounded px-2 py-1 text-[11px] border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 text-zinc-300"
          title={`${pillLabel} daemon`}
        >
          <PillIcon size={12} className="shrink-0 text-zinc-500" />
          <span className="flex-1 truncate text-left">{fullLabel}</span>
          <span className={`h-2 w-2 shrink-0 rounded-full ${effectiveDot}`} />
        </button>

        {open && (
          <div className="absolute bottom-full left-0 right-0 z-50 mb-1 w-60 rounded border border-zinc-800 bg-zinc-900 p-2 text-xs shadow-lg">
            {/* Status section */}
            <div className="border-b border-zinc-800 px-1 pb-2 mb-2">
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${effectiveDot}`} />
                <span className="font-medium text-zinc-200">{fullLabel}</span>
              </div>
              {status?.servicePath && (
                <div className="mt-1 truncate text-[10px] text-zinc-500" title={status.servicePath}>
                  {status.servicePath}
                </div>
              )}
            </div>

            {/* Sticky error display */}
            {displayError && (
              <div className="mb-2 rounded border border-red-500/30 bg-red-500/5 p-2 overflow-hidden">
                <div className="flex items-start gap-1.5 min-w-0">
                  <AlertTriangle size={12} className="mt-0.5 shrink-0 text-red-400" />
                  <div className="min-w-0 flex-1 overflow-hidden text-[10px] leading-relaxed text-red-300 font-mono break-all whitespace-pre-wrap">
                    {displayError}
                  </div>
                </div>
                <div className="mt-1.5 flex items-center justify-end gap-1">
                  <button
                    type="button"
                    onClick={handleCopy}
                    className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                    title="Copy error"
                  >
                    {copied ? (
                      <>
                        <Check size={10} className="text-emerald-400" />
                        <span className="text-emerald-400">Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy size={10} />
                        <span>Copy</span>
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setActionError(null)}
                    className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                    title="Dismiss error"
                  >
                    <X size={10} />
                    <span>Dismiss</span>
                  </button>
                </div>
              </div>
            )}

            {/* Action buttons */}
            {canStart && (
              <button
                type="button"
                disabled={busy}
                onClick={() => runAction('daemon_start')}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-emerald-400 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
                <span>Start {pillLabel.toLowerCase()}</span>
              </button>
            )}

            {canStop && (
              <button
                type="button"
                disabled={busy}
                onClick={() => runAction('daemon_stop')}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-red-400 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? <Loader2 size={12} className="animate-spin" /> : <Square size={12} />}
                <span>Stop {pillLabel.toLowerCase()}</span>
              </button>
            )}

            {canRestart && (
              <button
                type="button"
                disabled={busy}
                onClick={() => runAction('daemon_restart')}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-amber-400 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
                <span>Restart {pillLabel.toLowerCase()}</span>
              </button>
            )}

            {canInstall && (
              <button
                type="button"
                disabled={busy}
                onClick={handleInstall}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-cyan-400 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                <span>Install {pillLabel.toLowerCase()}</span>
              </button>
            )}

            {canUninstall && (
              <>
                {(canStart || canStop || canRestart || canInstall) && (
                  <div className="my-1 border-t border-zinc-800" />
                )}
                <button
                  type="button"
                  onClick={handleUninstallClick}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-red-400 hover:bg-zinc-800"
                >
                  <Trash2 size={12} />
                  <span>Uninstall {pillLabel.toLowerCase()}</span>
                </button>
              </>
            )}

            {!hasActions && !displayError && (
              <div className="px-2 py-1.5 text-[10px] text-zinc-500">No actions available.</div>
            )}
          </div>
        )}
      </div>

      {/* Install progress modal */}
      {installModalOpen && (
        <InstallDaemonModal kind={kind} onClose={handleInstallModalClose} />
      )}

      {/* Uninstall confirmation modal */}
      {uninstallConfirmOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          role="dialog"
          aria-modal="true"
          onKeyDown={(e) => { if (e.key === 'Escape' && !uninstallBusy) setUninstallConfirmOpen(false); }}
        >
          <div className="w-[26rem] rounded-lg border border-red-500/30 bg-zinc-900 shadow-xl">
            <div className="flex items-center gap-2 border-b border-zinc-800 px-4 py-3">
              <AlertTriangle size={16} className="text-red-400" />
              <h2 className="text-sm font-semibold text-zinc-100">Uninstall {pillLabel}</h2>
            </div>

            <div className="px-4 py-4 text-xs text-zinc-300 leading-relaxed">
              <p>
                This will stop the {pillLabel.toLowerCase()} daemon and remove its
                service file. The daemon will no longer start automatically.
              </p>

              <label className="mt-3 flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={uninstallRemoveData}
                  onChange={(e) => setUninstallRemoveData(e.target.checked)}
                  className="rounded border-zinc-600 bg-zinc-800 text-red-500 focus:ring-red-500"
                />
                <span className="text-zinc-300">
                  Also remove data directory
                  <span className="font-mono text-[10px] text-zinc-500 ml-1">{dataDir}</span>
                </span>
              </label>

              {uninstallRemoveData && (
                <div className="mt-2 rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-[11px] text-red-300">
                  All configuration, logs, and working data will be permanently deleted.
                </div>
              )}

              <div className="mt-4">
                <label className="block text-[11px] text-zinc-400">
                  Type <span className="font-semibold text-zinc-200">I understand</span> to confirm
                  <input
                    type="text"
                    value={uninstallConfirmText}
                    onChange={(e) => setUninstallConfirmText(e.target.value)}
                    placeholder="I understand"
                    className="mt-1 block w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs font-mono text-zinc-100 placeholder:text-zinc-700 focus:border-red-500 focus:outline-none"
                  />
                </label>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-zinc-800 px-4 py-3">
              <button
                type="button"
                disabled={uninstallBusy}
                onClick={() => setUninstallConfirmOpen(false)}
                className="rounded px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={uninstallBusy || uninstallConfirmText !== 'I understand'}
                onClick={handleUninstallConfirmed}
                className="flex items-center gap-2 rounded bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {uninstallBusy ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                Uninstall
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

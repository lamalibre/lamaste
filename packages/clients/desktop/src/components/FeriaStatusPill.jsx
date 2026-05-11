// ==========================================================================
// FeriaStatusPill — footer status pill for the Feria dev registry
// ==========================================================================
//
// Interactive Feria registry status pill for the desktop sidebar footer.
// Polls `feria_get_status` every 5s and exposes Start / Stop / Take-over
// actions through a dropdown that opens above the pill. Take-over opens a
// confirmation dialog because it SIGTERMs (and may SIGKILL) whatever
// external process currently holds port 4873.

import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { invoke } from '@tauri-apps/api/core';
import { Package, Play, Square, Zap, Loader2, X, AlertTriangle } from 'lucide-react';

const POLL_MS = 5_000;

const STATE_META = {
  'managed-running': { dot: 'bg-emerald-500', label: 'Feria running' },
  'external-running': { dot: 'bg-emerald-500', label: 'Feria (external)' },
  starting: { dot: 'bg-amber-500 animate-pulse', label: 'Feria starting\u2026' },
  error: { dot: 'bg-red-500', label: 'Feria error' },
  stopped: { dot: 'bg-zinc-600', label: 'Feria stopped' },
};

export default function FeriaStatusPill() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [takeoverConfirm, setTakeoverConfirm] = useState(false);
  const rootRef = useRef(null);

  // ---- Polling ----
  const { data: status } = useQuery({
    queryKey: ['feria-status'],
    queryFn: () => invoke('feria_get_status'),
    refetchInterval: POLL_MS,
    placeholderData: { state: 'stopped', binary: null, pid: null, error: null, ownable: false },
  });

  const meta = STATE_META[status?.state] ?? STATE_META.stopped;
  const canStart = status?.state === 'stopped' || status?.state === 'error';
  const canStop = status?.ownable === true;
  const canTakeover = status?.state === 'external-running';
  const hasActions = canStart || canStop || canTakeover;

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
  const runAction = useCallback(
    async (command) => {
      setBusy(true);
      try {
        await invoke(command);
        setOpen(false);
      } catch {
        // Error is reflected in the next poll cycle
      } finally {
        setBusy(false);
        queryClient.invalidateQueries({ queryKey: ['feria-status'] });
      }
    },
    [queryClient],
  );

  const handleTakeoverConfirmed = useCallback(() => {
    setTakeoverConfirm(false);
    runAction('feria_takeover');
  }, [runAction]);

  return (
    <>
      <div className="relative" ref={rootRef}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center gap-2 rounded px-2 py-1 text-[11px] border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 text-zinc-300"
          title={status?.binary ?? 'feria dev registry'}
        >
          <Package size={12} className="shrink-0 text-zinc-500" />
          <span className="flex-1 truncate text-left">{meta.label}</span>
          <span className={`h-2 w-2 shrink-0 rounded-full ${meta.dot}`} />
        </button>

        {open && (
          <div className="absolute bottom-full left-0 right-0 z-50 mb-1 w-60 rounded border border-zinc-800 bg-zinc-900 p-2 text-xs shadow-lg">
            {/* Status section */}
            <div className="border-b border-zinc-800 px-1 pb-2 mb-2">
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${meta.dot}`} />
                <span className="font-medium text-zinc-200">{meta.label}</span>
              </div>
              {status?.pid != null && (
                <div className="mt-1 text-[10px] text-zinc-500">pid {status.pid}</div>
              )}
              {status?.binary && (
                <div className="mt-1 truncate text-[10px] text-zinc-500" title={status.binary}>
                  {status.binary}
                </div>
              )}
              {status?.error && (
                <div className="mt-1 flex items-start gap-1 text-[10px] text-red-400">
                  <AlertTriangle size={10} className="mt-0.5 shrink-0" />
                  <span className="break-words">{status.error}</span>
                </div>
              )}
            </div>

            {/* Action buttons */}
            {canStart && (
              <button
                type="button"
                disabled={busy}
                onClick={() => runAction('feria_start')}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-emerald-400 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
                <span>Start feria</span>
              </button>
            )}

            {canStop && (
              <button
                type="button"
                disabled={busy}
                onClick={() => runAction('feria_stop')}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-red-400 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? <Loader2 size={12} className="animate-spin" /> : <Square size={12} />}
                <span>Stop feria</span>
              </button>
            )}

            {canTakeover && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setOpen(false);
                  setTakeoverConfirm(true);
                }}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-amber-400 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Zap size={12} />
                <span>Take over (kill external)</span>
              </button>
            )}

            {!hasActions && (
              <div className="px-2 py-1.5 text-[10px] text-zinc-500">No actions available.</div>
            )}
          </div>
        )}
      </div>

      {/* Takeover confirmation modal */}
      {takeoverConfirm && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60"
          onMouseDown={() => setTakeoverConfirm(false)}
        >
          <div
            className="max-w-md rounded border border-zinc-800 bg-zinc-900 p-4 text-xs text-zinc-300"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <AlertTriangle size={14} className="text-amber-400" />
                <h3 className="text-sm font-semibold text-zinc-100">Take over feria?</h3>
              </div>
              <button
                type="button"
                onClick={() => setTakeoverConfirm(false)}
                className="text-zinc-500 hover:text-zinc-200"
                title="Cancel"
              >
                <X size={14} />
              </button>
            </div>
            <p className="mb-4 leading-relaxed">
              This will SIGTERM the externally-running feria on port 4873, wait 3 seconds, SIGKILL
              if still alive, then spawn a managed replacement. Existing connections will be
              dropped.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setTakeoverConfirm(false)}
                className="rounded border border-zinc-700 px-3 py-1.5 text-zinc-300 hover:bg-zinc-800"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={handleTakeoverConfirmed}
                className="flex items-center gap-2 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-amber-400 hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />}
                Take over
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

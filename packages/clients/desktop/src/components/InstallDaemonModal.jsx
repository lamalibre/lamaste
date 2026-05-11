// ==========================================================================
// InstallDaemonModal — progress modal for daemon installation
// ==========================================================================
//
// Shown when the user clicks Install in a LocalDaemonPill. Calls
// `daemon_install`, streams NDJSON progress lines from the Rust backend
// via a Tauri event channel, and shows a final success or error state
// with a close button.

import { useState, useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, CheckCircle, XCircle, X, Copy, Check, Cpu, Server, Puzzle } from 'lucide-react';

const KIND_CONFIG = {
  agent: { label: 'Agent', Icon: Cpu },
  server: { label: 'Server', Icon: Server },
  pluginHost: { label: 'Plugin Host', Icon: Puzzle },
};

export default function InstallDaemonModal({ kind, onClose }) {
  const queryClient = useQueryClient();
  const { label, Icon } = KIND_CONFIG[kind] || KIND_CONFIG.agent;

  const [phase, setPhase] = useState('running'); // 'running' | 'success' | 'error'
  const [progressLines, setProgressLines] = useState([]);
  const [errorMessage, setErrorMessage] = useState(null);
  const [copied, setCopied] = useState(false);
  const logRef = useRef(null);

  const addLine = useCallback((text) => {
    setProgressLines((prev) => [...prev, text]);
  }, []);

  // Auto-scroll log area when new lines are added
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [progressLines]);

  // Run the installation on mount
  useEffect(() => {
    let unlisten = null;
    let cancelled = false;

    async function run() {
      const eventName = `daemon:install-progress:${kind}`;

      // Listen for NDJSON progress events
      try {
        unlisten = await listen(eventName, (event) => {
          if (cancelled) return;
          const ev = event.payload;
          if (ev.event === 'detection') {
            const d = ev.data;
            addLine(`Detected: ${d?.os ?? '?'} (${d?.arch ?? '?'}), node ${d?.nodeVersion ?? '?'}`);
          } else if (ev.event === 'step' && ev.status === 'start') {
            addLine(`${ev.name ?? 'step'}...`);
          } else if (ev.event === 'step' && ev.status === 'complete') {
            addLine(`${ev.name ?? 'step'} done`);
          } else if (ev.event === 'step' && ev.status === 'skipped') {
            addLine(`${ev.name ?? 'step'} skipped`);
          } else if (ev.event === 'summary') {
            addLine('Installation complete.');
          } else if (ev.event === 'done' && ev.status === 'failed') {
            addLine(`Error: ${ev.message ?? 'unknown'}`);
          } else if (ev.message) {
            addLine(ev.message);
          }
        });
      } catch {
        // Listen may fail — continue without live progress
      }

      addLine(`Installing ${label.toLowerCase()} daemon...`);

      try {
        const result = await invoke('daemon_install', { kind });

        if (cancelled) return;

        if (result.state === 'running' || result.state === 'loaded' || result.state === 'stopped') {
          addLine(`Service installed successfully (${result.state}).`);
          setPhase('success');
          queryClient.invalidateQueries({ queryKey: ['daemon-service-status', kind] });
        } else if (result.state === 'notInstalled') {
          setErrorMessage('Installation completed but service file was not found.');
          setPhase('error');
        } else {
          setErrorMessage(result.error ?? 'Installation completed with unexpected state.');
          setPhase('error');
        }
      } catch (err) {
        if (cancelled) return;
        const msg = typeof err === 'string' ? err : (err?.message ?? 'Installation failed');
        setErrorMessage(msg);
        addLine(`Error: ${msg}`);
        setPhase('error');
      } finally {
        if (unlisten) unlisten();
      }
    }

    run();

    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, [kind, label, addLine, queryClient]);

  const copyError = useCallback(async () => {
    if (!errorMessage) return;
    try {
      await navigator.clipboard.writeText(errorMessage);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // silent
    }
  }, [errorMessage]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      role="dialog"
      aria-modal="true"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && phase !== 'running') onClose();
      }}
    >
      <div className="w-[28rem] rounded-lg border border-zinc-800 bg-zinc-900 shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <div className="flex items-center gap-2">
            <Icon size={16} className="text-cyan-400" />
            <h2 className="text-sm font-semibold text-zinc-100">Install {label}</h2>
          </div>
          {phase !== 'running' && (
            <button type="button" onClick={onClose} className="text-zinc-500 hover:text-zinc-300">
              <X size={16} />
            </button>
          )}
        </div>

        {/* Progress log */}
        <div
          ref={logRef}
          className="max-h-48 overflow-y-auto border-b border-zinc-800 bg-zinc-950 px-4 py-3 font-mono text-[11px] leading-relaxed text-zinc-400"
        >
          {progressLines.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
          {phase === 'running' && (
            <div className="flex items-center gap-2 mt-1 text-cyan-400">
              <Loader2 size={12} className="animate-spin" />
              <span>Working...</span>
            </div>
          )}
        </div>

        {/* Result */}
        <div className="px-4 py-3">
          {phase === 'running' && (
            <p className="text-xs text-zinc-500">
              This may take a moment. Do not close this window.
            </p>
          )}
          {phase === 'success' && (
            <div className="flex items-center gap-2 text-emerald-400">
              <CheckCircle size={16} />
              <span className="text-sm font-medium">{label} installed successfully</span>
            </div>
          )}
          {phase === 'error' && (
            <div className="flex items-start gap-2">
              <XCircle size={16} className="mt-0.5 shrink-0 text-red-400" />
              <div className="min-w-0 flex-1">
                <span className="text-sm font-medium text-red-400">Installation failed</span>
                {errorMessage && (
                  <>
                    <div className="mt-1 max-h-24 overflow-y-auto rounded border border-red-500/20 bg-red-500/5 p-2 font-mono text-[10px] leading-relaxed text-red-300 break-all whitespace-pre-wrap">
                      {errorMessage}
                    </div>
                    <button
                      type="button"
                      onClick={copyError}
                      className="mt-1 flex items-center gap-1 rounded px-2 py-0.5 text-[10px] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                    >
                      {copied ? (
                        <>
                          <Check size={10} className="text-emerald-400" />
                          <span className="text-emerald-400">Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy size={10} />
                          <span>Copy error</span>
                        </>
                      )}
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {phase !== 'running' && (
          <div className="flex justify-end border-t border-zinc-800 px-4 py-3">
            <button
              type="button"
              onClick={onClose}
              className={`rounded px-4 py-1.5 text-xs font-medium text-white ${
                phase === 'success'
                  ? 'bg-emerald-600 hover:bg-emerald-500'
                  : 'bg-zinc-700 hover:bg-zinc-600'
              }`}
            >
              {phase === 'success' ? 'Done' : 'Close'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

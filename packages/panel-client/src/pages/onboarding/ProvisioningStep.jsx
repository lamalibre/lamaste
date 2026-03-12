import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, XCircle, Circle, Loader2, AlertTriangle } from 'lucide-react';
import { useProvisioningStream } from '../../hooks/useProvisioningStream.js';

function TaskIcon({ status }) {
  switch (status) {
    case 'done':
      return <CheckCircle2 size={18} className="shrink-0 text-green-400" />;
    case 'error':
      return <XCircle size={18} className="shrink-0 text-red-400" />;
    case 'running':
      return <Loader2 size={18} className="shrink-0 animate-spin text-cyan-400" />;
    default:
      return <Circle size={18} className="shrink-0 text-zinc-600" />;
  }
}

function TaskRow({ task, isLast }) {
  const titleClass =
    task.status === 'pending' ? 'text-zinc-500' : 'text-white';

  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <TaskIcon status={task.status} />
        {!isLast && <div className="mt-1 w-px flex-1 bg-zinc-700" />}
      </div>
      <div className="pb-4">
        <p className={`text-sm font-medium ${titleClass}`}>{task.title}</p>
        {task.message && task.status !== 'pending' && (
          <p className="mt-0.5 text-xs text-zinc-400">{task.message}</p>
        )}
      </div>
    </div>
  );
}

export default function ProvisioningStep({ onComplete }) {
  const {
    tasks,
    isComplete,
    isError,
    error,
    result,
    progress,
    logs,
    retry,
  } = useProvisioningStream();

  const [started, setStarted] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const logContainerRef = useRef(null);

  // Start provisioning on mount
  useEffect(() => {
    if (started) return;
    setStarted(true);

    fetch('/api/onboarding/provision', {
      method: 'POST',
    }).catch(() => {
      // 409 means already running — WebSocket will show existing progress
    });
  }, [started]);

  // Auto-scroll log container
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  // Auto-advance on completion
  useEffect(() => {
    if (isComplete && onComplete) {
      const timer = setTimeout(() => {
        onComplete(result);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [isComplete, onComplete, result]);

  async function handleRetry() {
    setRetrying(true);
    try {
      await retry();
    } catch {
      // Error will be reflected via WebSocket
    } finally {
      setRetrying(false);
    }
  }

  return (
    <div>
      <h2 className="mb-2 text-xl font-semibold text-white">Setting up your Portlama</h2>

      <div className="mb-5 rounded-md border border-amber-700 bg-amber-900/30 px-4 py-3">
        <div className="flex items-center gap-2">
          <AlertTriangle size={16} className="shrink-0 text-amber-300" />
          <p className="text-sm text-amber-300">
            Do not close this page while provisioning is in progress
          </p>
        </div>
      </div>

      <div className="mb-4">
        {tasks.map((task, i) => (
          <TaskRow key={task.id} task={task} isLast={i === tasks.length - 1} />
        ))}
      </div>

      <div
        ref={logContainerRef}
        className="mb-3 max-h-48 overflow-y-auto rounded border border-zinc-800 bg-zinc-950 p-3 font-mono text-sm text-zinc-400"
      >
        {logs.length === 0 ? (
          <p className="italic text-zinc-600">Waiting for provisioning to start...</p>
        ) : (
          logs.map((line, i) => (
            <p key={i} className="leading-relaxed">
              {line}
            </p>
          ))
        )}
      </div>

      {progress.total > 0 && (
        <p className="mb-4 text-sm text-zinc-500">
          Step {progress.current} of {progress.total}
        </p>
      )}

      {isError && error && (
        <div className="mb-4 rounded-md border border-red-700 bg-red-900/30 px-4 py-3">
          <p className="text-sm font-medium text-red-300">Provisioning failed</p>
          <p className="mt-1 text-xs text-red-400">{error.message}</p>
          <button
            type="button"
            onClick={handleRetry}
            disabled={retrying}
            className="mt-3 flex items-center gap-2 rounded-md bg-cyan-500 px-6 py-2 font-medium text-white transition-colors hover:bg-cyan-600 disabled:opacity-50"
          >
            {retrying && <Loader2 size={16} className="animate-spin" />}
            {retrying ? 'Retrying...' : 'Retry'}
          </button>
        </div>
      )}

      {isComplete && (
        <div className="text-center">
          <p className="text-sm text-green-400">Provisioning complete. Continuing...</p>
        </div>
      )}
    </div>
  );
}

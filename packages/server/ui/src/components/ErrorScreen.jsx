import { AlertCircle } from 'lucide-react';

export default function ErrorScreen({ onRetry }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950">
      <div className="flex flex-col items-center">
        <AlertCircle className="mb-4 h-12 w-12 text-red-400" />
        <h1 className="mb-2 font-mono text-xl font-bold text-zinc-100">Unable to connect</h1>
        <p className="mb-6 max-w-md text-center text-zinc-400">
          Could not reach the Lamaste panel server. Make sure the server is running and try again.
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="rounded-md bg-cyan-400 px-4 py-2 font-medium text-zinc-900 transition-colors hover:bg-cyan-300"
        >
          Retry
        </button>
      </div>
    </div>
  );
}

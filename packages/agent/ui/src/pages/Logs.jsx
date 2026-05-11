import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { ScrollText, RefreshCw } from 'lucide-react';
import { useAgentClient } from '../context/AgentClientContext.jsx';

export default function Logs() {
  const client = useAgentClient();
  const logsRef = useRef(null);

  const logsQuery = useQuery({
    queryKey: ['agent', 'logs'],
    queryFn: () => client.getLogs(),
    refetchInterval: 3000,
  });

  const logs = logsQuery.data || '';

  useEffect(() => {
    if (logsRef.current) {
      logsRef.current.scrollTop = logsRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div className="p-6 h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-bold text-white">Logs</h1>
        <button
          onClick={() => logsQuery.refetch()}
          className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200"
        >
          <RefreshCw size={12} />
          Refresh
        </button>
      </div>

      <div
        ref={logsRef}
        className="flex-1 min-h-0 bg-zinc-900 border border-zinc-800 rounded-lg p-4 overflow-y-auto"
      >
        {logs ? (
          <pre className="text-xs text-zinc-300 whitespace-pre-wrap break-all leading-relaxed">
            {logs}
          </pre>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-zinc-600">
            <ScrollText size={24} className="mb-2" />
            <p className="text-xs">No logs available</p>
          </div>
        )}
      </div>
    </div>
  );
}

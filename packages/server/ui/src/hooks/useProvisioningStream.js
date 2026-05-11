import { useState, useEffect, useRef, useCallback } from 'react';

const MAX_RECONNECT_DELAY = 10000;

/**
 * Custom hook that manages a WebSocket connection to the provisioning progress stream.
 * Maintains task state, handles reconnection with exponential backoff, and provides
 * a retry function to restart provisioning.
 */
export function useProvisioningStream() {
  const [tasks, setTasks] = useState([]);
  const [isComplete, setIsComplete] = useState(false);
  const [isError, setIsError] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [logs, setLogs] = useState([]);

  const wsRef = useRef(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef(null);
  const unmountedRef = useRef(false);
  const connectRef = useRef(null);

  useEffect(() => {
    unmountedRef.current = false;

    function connect() {
      if (unmountedRef.current) return;

      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${proto}//${window.location.host}/api/onboarding/provision/stream`;

      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectAttemptRef.current = 0;
      };

      ws.onmessage = (event) => {
        let data;
        try {
          data = JSON.parse(event.data);
        } catch {
          return;
        }

        // Handle full state message (sent on initial connection)
        if (data.type === 'state') {
          if (data.tasks) {
            setTasks(data.tasks);
          }
          if (data.error) {
            setIsError(true);
            setError(data.error);
          }
          if (data.result) {
            setResult(data.result);
            setIsComplete(true);
          }
          return;
        }

        // Handle completion event
        if (data.task === 'complete' && data.status === 'done') {
          setIsComplete(true);
          if (data.result) {
            setResult(data.result);
          }
          return;
        }

        // Handle error event
        if (data.status === 'error') {
          setIsError(true);
          setError({ task: data.task, message: data.error || data.message });
        }

        // Update progress
        if (data.progress) {
          setProgress(data.progress);
        }

        // Accumulate log lines
        if (data.log) {
          setLogs((prev) => [...prev.slice(-500), data.log]);
        }
        if (data.message) {
          setLogs((prev) => [...prev.slice(-500), data.message]);
        }

        // Update task in the tasks array
        setTasks((prev) => {
          const idx = prev.findIndex((t) => t.id === data.task);
          if (idx !== -1) {
            const updated = [...prev];
            updated[idx] = {
              ...updated[idx],
              status: data.status,
              message: data.message,
              log: data.log,
            };
            return updated;
          }
          // New task — append
          return [
            ...prev,
            {
              id: data.task,
              title: data.title || data.task,
              status: data.status,
              message: data.message,
              log: data.log,
            },
          ];
        });
      };

      ws.onclose = () => {
        if (unmountedRef.current) return;

        // Reconnect with exponential backoff
        const attempt = reconnectAttemptRef.current;
        const delay = Math.min(1000 * Math.pow(2, attempt), MAX_RECONNECT_DELAY);
        reconnectAttemptRef.current = attempt + 1;

        reconnectTimerRef.current = setTimeout(() => {
          if (!unmountedRef.current) {
            connect();
          }
        }, delay);
      };

      ws.onerror = () => {
        // The close event will fire after this and handle reconnection
      };
    }

    connectRef.current = connect;
    connect();

    return () => {
      unmountedRef.current = true;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  const retry = useCallback(async () => {
    setIsError(false);
    setError(null);
    setIsComplete(false);
    setResult(null);
    setTasks([]);
    setLogs([]);
    setProgress({ current: 0, total: 0 });

    const response = await fetch('/api/onboarding/provision', {
      method: 'POST',
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Failed to start provisioning');
    }
  }, []);

  return {
    tasks,
    isComplete,
    isError,
    error,
    result,
    progress,
    logs,
    retry,
  };
}

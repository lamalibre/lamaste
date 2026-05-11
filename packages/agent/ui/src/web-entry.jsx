import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AgentClientProvider } from './context/AgentClientContext.jsx';
import { ToastProvider } from './components/Toast.jsx';
import { createWebAgentClient } from './lib/web-agent-client.js';
import WebApp from './WebApp.jsx';
import './web.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 10_000,
    },
  },
});

const client = createWebAgentClient();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <AgentClientProvider client={client}>
        <ToastProvider>
          <WebApp />
        </ToastProvider>
      </AgentClientProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);

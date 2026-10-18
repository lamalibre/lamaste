import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OidcSecretRevealProvider } from '@lamalibre/lamaste-server-ui';
import App from './App.jsx';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchInterval: 5000,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      {/* Above every view: secrets an install answers with after the
          administrator left the server's pages still reach the dialog. */}
      <OidcSecretRevealProvider>
        <App />
      </OidcSecretRevealProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);

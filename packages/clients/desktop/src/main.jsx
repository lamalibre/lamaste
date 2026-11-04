import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OidcSecretRevealProvider, retryQuery } from '@lamalibre/lamaste-server-ui';
import App from './App.jsx';
import './index.css';

// No default polling: a query polls when it says so (`refetchInterval`).
// The server's pages are written for that — the web panel has no default
// either — and a blanket interval made every one of their queries hit the
// panel every five seconds, past its rate limit (100 requests a minute)
// on a page of plugin cards. Retried once, never a refusal nor the rate
// limit; not refetched on focus, as in the web panel.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: retryQuery,
      refetchOnWindowFocus: false,
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

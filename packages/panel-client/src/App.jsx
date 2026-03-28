import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useOnboardingStatus } from './hooks/useOnboardingStatus.js';
import {
  AdminClientProvider,
  ToastProvider,
  TwoFaProvider,
  DashboardPage,
  TunnelsPage,
  SitesPage,
  UsersPage,
  CertificatesPage,
  ServicesPage,
  PluginsPage,
  SettingsPage,
  TicketsPage,
} from '@lamalibre/portlama-admin-panel';
import { webAdminClient } from './lib/web-admin-client.js';
import Layout from './components/layout/Layout.jsx';
import LoadingScreen from './components/LoadingScreen.jsx';
import ErrorScreen from './components/ErrorScreen.jsx';
import OnboardingShell from './pages/onboarding/OnboardingShell.jsx';
import PluginLoaderRoute from './components/PluginLoaderRoute.jsx';
import DocsPage from './pages/docs/DocsPage.jsx';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function AppRoutes() {
  const { status, domain, isLoading, isError, refetch } = useOnboardingStatus();

  if (isLoading) {
    return <LoadingScreen />;
  }

  if (isError) {
    return <ErrorScreen onRetry={refetch} />;
  }

  if (status !== 'COMPLETED') {
    return <OnboardingShell />;
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/tunnels" element={<TunnelsPage />} />
        <Route path="/sites" element={<SitesPage domain={domain} />} />
        <Route path="/users" element={<UsersPage />} />
        <Route path="/certificates" element={<CertificatesPage />} />
        <Route path="/services" element={<ServicesPage />} />
        <Route path="/tickets" element={<TicketsPage />} />
        <Route path="/plugins" element={<PluginsPage />} />
        <Route path="/plugins/:pluginName/*" element={<PluginLoaderRoute />} />
        <Route path="/settings" element={<SettingsPage hasDomain={!!domain} />} />
        <Route path="/docs/*" element={<DocsPage />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AdminClientProvider client={webAdminClient}>
        <ToastProvider>
          <TwoFaProvider>
            <BrowserRouter>
              <AppRoutes />
            </BrowserRouter>
          </TwoFaProvider>
        </ToastProvider>
      </AdminClientProvider>
    </QueryClientProvider>
  );
}

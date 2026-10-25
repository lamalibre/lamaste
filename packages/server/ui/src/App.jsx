import { BrowserRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useOnboardingStatus } from './hooks/useOnboardingStatus.js';
import {
  AdminClientProvider,
  OidcSecretRevealProvider,
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
  StoragePage,
  AuditPage,
  DomainsPage,
} from './admin/index.js';
import { webAdminClient } from './lib/web-admin-client.js';
import { pluginAnchorId } from './admin/lib/web-surface.js';
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
  const navigate = useNavigate();
  // A plugin's card on the Plugins page (a plugin-owned site is managed there).
  const openPlugin = (name) => navigate(`/plugins#${encodeURIComponent(pluginAnchorId(name))}`);

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
        <Route path="/sites" element={<SitesPage domain={domain} onOpenPlugin={openPlugin} />} />
        <Route path="/users" element={<UsersPage />} />
        <Route path="/domains" element={<DomainsPage />} />
        <Route path="/certificates" element={<CertificatesPage />} />
        <Route path="/services" element={<ServicesPage />} />
        <Route path="/tickets" element={<TicketsPage />} />
        <Route path="/plugins" element={<PluginsPage />} />
        <Route path="/storage" element={<StoragePage />} />
        <Route path="/audit" element={<AuditPage />} />
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
          <OidcSecretRevealProvider>
            <TwoFaProvider>
              <BrowserRouter>
                <AppRoutes />
              </BrowserRouter>
            </TwoFaProvider>
          </OidcSecretRevealProvider>
        </ToastProvider>
      </AdminClientProvider>
    </QueryClientProvider>
  );
}

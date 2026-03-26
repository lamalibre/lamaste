import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useOnboardingStatus } from './hooks/useOnboardingStatus.js';
import { ToastProvider } from './components/Toast.jsx';
import Layout from './components/layout/Layout.jsx';
import LoadingScreen from './components/LoadingScreen.jsx';
import ErrorScreen from './components/ErrorScreen.jsx';
import OnboardingShell from './pages/onboarding/OnboardingShell.jsx';
import Dashboard from './pages/management/Dashboard.jsx';
import Tunnels from './pages/management/Tunnels.jsx';
import Sites from './pages/management/Sites.jsx';
import Users from './pages/Users.jsx';
import Certificates from './pages/management/Certificates.jsx';
import Services from './pages/management/Services.jsx';
import Plugins from './pages/management/Plugins.jsx';
import Settings from './pages/management/Settings.jsx';
import Tickets from './pages/management/Tickets.jsx';
import PluginLoader from './components/PluginLoader.jsx';
import DocsPage from './pages/docs/DocsPage.jsx';
import { TwoFaProvider } from './context/TwoFaContext.jsx';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function AppRoutes() {
  const { status, isLoading, isError, refetch } = useOnboardingStatus();

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
        <Route path="/" element={<Dashboard />} />
        <Route path="/tunnels" element={<Tunnels />} />
        <Route path="/sites" element={<Sites />} />
        <Route path="/users" element={<Users />} />
        <Route path="/certificates" element={<Certificates />} />
        <Route path="/services" element={<Services />} />
        <Route path="/tickets" element={<Tickets />} />
        <Route path="/plugins" element={<Plugins />} />
        <Route path="/plugins/:pluginName/*" element={<PluginLoader />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/docs/*" element={<DocsPage />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <TwoFaProvider>
          <BrowserRouter>
            <AppRoutes />
          </BrowserRouter>
        </TwoFaProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}

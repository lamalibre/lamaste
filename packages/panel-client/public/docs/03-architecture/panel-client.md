# Panel Client Architecture

> The panel-client is a React 18 SPA with a dark terminal aesthetic that provides the complete management interface for Portlama, from onboarding through daily operations.

## In Plain English

The panel client is what you see in your browser when you open the Portlama admin panel. It is a single-page application — one HTML file that loads JavaScript which handles all navigation and UI rendering in the browser. It communicates with the panel server through REST API calls and WebSocket connections.

The client has two modes. On first visit, it shows an onboarding wizard that walks you through domain setup and stack provisioning. After onboarding is complete, it switches to the full management interface with a sidebar navigation, dashboard, and pages for managing tunnels, users, certificates, services, and static sites.

## Overview

```
Browser
  │
  └── index.html (loaded from panel-server via @fastify/static)
        │
        └── React Application
              │
              ├── QueryClientProvider (@tanstack/react-query)
              │     └── Global query cache, retry config
              │
              ├── ToastProvider (custom context)
              │     └── Notification system
              │
              ├── BrowserRouter (react-router-dom)
              │     │
              │     └── AppRoutes
              │           │
              │           ├── useOnboardingStatus() → GET /api/onboarding/status
              │           │
              │           ├── [Loading] → LoadingScreen
              │           ├── [Error]   → ErrorScreen (with retry)
              │           │
              │           ├── [status !== 'COMPLETED'] → OnboardingShell
              │           │     ├── DomainStep
              │           │     ├── DnsStep
              │           │     ├── ProvisioningStep
              │           │     └── CompleteStep
              │           │
              │           └── [status === 'COMPLETED'] → Layout + Routes
              │                 ├── /           → Dashboard
              │                 ├── /tunnels    → Tunnels
              │                 ├── /sites      → Sites
              │                 ├── /users      → Users
              │                 ├── /certificates → Certificates
              │                 ├── /services   → Services
              │                 └── /docs/*     → DocsPage
```

## Mode Detection

The fundamental architectural decision is **mode detection at the app root**. The `useOnboardingStatus` hook calls `GET /api/onboarding/status` on every app load:

```javascript
export function useOnboardingStatus() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['onboarding', 'status'],
    queryFn: fetchOnboardingStatus,
    staleTime: 30_000,
    retry: 2,
    refetchOnWindowFocus: true,
  });

  return {
    status: data?.status,           // "FRESH" | "DOMAIN_SET" | "DNS_READY" | "PROVISIONING" | "COMPLETED"
    domain: data?.domain ?? null,
    ip: data?.ip ?? null,
    isLoading,
    isError,
    error,
    refetch,
  };
}
```

Four possible outcomes:

1. **Loading** — show a full-page loading screen while the status request is in flight
2. **Error** — show a full-page error screen with a retry button (server may be starting up)
3. **Not completed** — render the onboarding wizard (no sidebar, no management routes)
4. **Completed** — render the management layout with sidebar navigation and all management routes

This design means the onboarding and management UIs share no routes. React Router is only mounted in management mode. The onboarding wizard manages its own step-based navigation internally.

## Routing Structure

### Onboarding Mode

No React Router routes. The `OnboardingShell` component manages its own step progression based on the current `onboarding.status` value:

```
FRESH        → DomainStep     (domain + email form)
DOMAIN_SET   → DnsStep        (DNS records + verification button)
DNS_READY    → ProvisioningStep (start button → progress stream)
PROVISIONING → ProvisioningStep (auto-resume, show live progress)
COMPLETED    → CompleteStep    (credentials, TOTP QR, next steps)
```

The shell renders the appropriate step component and shows a progress indicator at the top.

### Management Mode

React Router handles navigation within the `Layout` component (sidebar + content area):

| Path | Component | Description |
|------|-----------|-------------|
| `/` | `Dashboard` | System stats (CPU, RAM, disk, uptime) + service health indicators |
| `/tunnels` | `Tunnels` | Tunnel CRUD table + create form + Mac plist download |
| `/sites` | `Sites` | Static site CRUD + file browser + upload |
| `/users` | `Users` | Authelia user table + create/edit/delete + TOTP enrollment |
| `/certificates` | `Certificates` | Let's Encrypt + mTLS cert listing + renewal + rotation |
| `/services` | `Services` | Service status cards + start/stop/restart buttons + live log viewer |
| `/docs/*` | `DocsPage` | Markdown documentation viewer with sidebar navigation |

## Data Fetching Patterns

All data fetching uses `@tanstack/react-query`. No `useEffect + fetch` patterns exist in the codebase.

### Queries (reading data)

```javascript
const { data, isLoading } = useQuery({
  queryKey: ['tunnels'],
  queryFn: () => fetch('/api/tunnels').then((r) => r.json()),
  refetchInterval: 10_000,  // Poll every 10 seconds for live data
});
```

Key conventions:
- `queryKey` is a descriptive array (e.g., `['tunnels']`, `['services']`, `['system', 'stats']`)
- `queryFn` uses the native `fetch` API (no axios or custom wrapper)
- `refetchInterval` is used for data that changes independently of user actions (service status, system stats)
- `staleTime` defaults to 0 (always refetch on mount) except for the onboarding status (30 seconds)

### Mutations (writing data)

```javascript
const qc = useQueryClient();
const mutation = useMutation({
  mutationFn: (body) =>
    fetch('/api/tunnels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(async (r) => {
      if (!r.ok) throw new Error((await r.json()).error);
      return r.json();
    }),
  onSuccess: () => qc.invalidateQueries({ queryKey: ['tunnels'] }),
});
```

Key conventions:
- Mutations always invalidate the relevant query on success (triggers an immediate refetch)
- Error handling extracts the `error` field from the JSON response body
- The `QueryClient` is configured with `retry: 1` globally

### WebSocket Connections

WebSocket hooks are used for two features:

**Provisioning stream** (`useProvisioningStream`):
- Connects to `/api/onboarding/provision/stream` during the provisioning step
- Receives progress events with task status, messages, and completion data
- Keeps the last 500 messages to prevent unbounded memory growth

**Live log streaming** (in `Services` page):
- Connects to `/api/services/:name/logs` when a log viewer is opened
- Receives `journalctl -f` output in real-time
- Disconnects when the log viewer is closed

Both follow the same pattern:

```javascript
useEffect(() => {
  if (!active) return;
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${proto}//${window.location.host}/api/path`);
  ws.onmessage = (e) => setMessages((prev) => [...prev.slice(-500), JSON.parse(e.data)]);
  ws.onerror = () => setError('Connection lost');
  return () => ws.close();
}, [active]);
```

## Design System

The panel uses a dark terminal aesthetic inspired by VS Code's dark theme. All styling uses Tailwind utility classes — no CSS files, no `style={}` attributes.

### Color Tokens

| Token | Tailwind Class | Usage |
|-------|---------------|-------|
| Page background | `bg-zinc-950` | Full page |
| Card/surface background | `bg-zinc-900` | Cards, panels, sidebar |
| Card borders | `border-zinc-800` | All card and section borders |
| Primary text | `text-zinc-100` | Headings |
| Secondary text | `text-zinc-400` | Labels, descriptions, body text |
| Muted text | `text-zinc-600` | Hints, timestamps, version numbers |
| Accent | `text-cyan-400` / `bg-cyan-600` | Links, primary buttons, active nav, brand |
| Success | `text-green-400` | Active, connected, healthy |
| Warning | `text-yellow-400` | Expiring, restarting |
| Error | `text-red-400` | Failed, disconnected, stopped |
| Font | `font-mono` | All body text — terminal feel |

### Component Patterns

**Cards:**
```jsx
<div className="bg-zinc-900 border border-zinc-800 rounded-lg p-5">
  <h2 className="text-sm font-semibold text-zinc-300 mb-4 flex items-center gap-2">
    <IconName size={14} className="text-cyan-400" />
    Section Title
  </h2>
  {/* Content */}
</div>
```

**Status badges:**
```jsx
<span className={`text-xs px-2 py-0.5 rounded-full border ${
  isActive
    ? 'text-green-400 bg-green-500/10 border-green-500/20'
    : 'text-zinc-500 bg-zinc-800 border-zinc-700'
}`}>
  {isActive ? 'active' : 'inactive'}
</span>
```

**Page wrapper:**
```jsx
<div className="p-6 max-w-4xl mx-auto">
  <div className="mb-6">
    <h1 className="text-xl font-bold text-white">Page Title</h1>
    <p className="text-zinc-500 text-sm mt-1">Brief description</p>
  </div>
  {/* Page content */}
</div>
```

### Icons

All icons come from the `lucide-react` package. Common icons used:

| Icon | Usage |
|------|-------|
| `LayoutDashboard` | Dashboard nav |
| `Globe` | Tunnels nav |
| `FileText` | Static Sites nav |
| `Users` | Users nav |
| `ShieldCheck` | Certificates nav |
| `Server` | Services nav |
| `BookOpen` | Documentation nav |
| `Menu` / `X` | Mobile sidebar toggle |

## Layout Component

The management mode uses a `Layout` component with sidebar + content area:

```jsx
export default function Layout() {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 overflow-y-auto bg-zinc-950 p-6 lg:p-8">
        <Outlet />
      </main>
    </div>
  );
}
```

### Sidebar

The sidebar is a responsive component:
- **Desktop** (lg+): Fixed 256px-wide sidebar, always visible
- **Mobile** (below lg): Hidden by default, revealed via hamburger menu button with an overlay

Navigation items are defined as a simple array:

```javascript
const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/tunnels', icon: Globe, label: 'Tunnels' },
  { to: '/sites', icon: FileText, label: 'Static Sites' },
  { to: '/users', icon: Users, label: 'Users' },
  { to: '/certificates', icon: ShieldCheck, label: 'Certificates' },
  { to: '/services', icon: Server, label: 'Services' },
  { to: '/docs', icon: BookOpen, label: 'Documentation' },
];
```

Each item renders a `SidebarLink` component with active-state highlighting via React Router's `useLocation`.

## Provider Stack

The app root wraps all content in three providers:

```jsx
<QueryClientProvider client={queryClient}>
  <ToastProvider>
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  </ToastProvider>
</QueryClientProvider>
```

1. **QueryClientProvider** — react-query cache with global defaults (`retry: 1`, `refetchOnWindowFocus: false`)
2. **ToastProvider** — custom context for displaying notification toasts
3. **BrowserRouter** — React Router for client-side navigation

## Documentation Viewer

The `/docs/*` route renders a markdown documentation viewer. Documentation files live in `public/docs/` as static markdown files:

- Loaded at runtime via `fetch()` (not react-query — static files, no cache invalidation needed)
- Rendered client-side with the `marked` library
- Styled with the `@tailwindcss/typography` plugin for prose formatting
- Navigation structure defined in `public/docs/_index.json`

The documentation system is independent of the panel-server API — docs load even if the server is unresponsive.

## Build Pipeline

The panel client uses Vite for development and production builds:

- **Development**: `vite` dev server with HMR, proxies `/api` and WebSocket to `:3100`
- **Production**: `vite build` outputs to `dist/` — static HTML, JS, and CSS bundles

The built `dist/` directory is served by the panel-server via `@fastify/static`. In production, no Vite dev server runs.

## Key Files

| File | Role |
|------|------|
| `packages/panel-client/src/App.jsx` | Root component, mode detection, routing |
| `packages/panel-client/src/main.jsx` | React root mount |
| `packages/panel-client/src/hooks/useOnboardingStatus.js` | Onboarding state query hook |
| `packages/panel-client/src/hooks/useProvisioningStream.js` | WebSocket hook for provisioning progress |
| `packages/panel-client/src/components/layout/Layout.jsx` | Sidebar + content outlet |
| `packages/panel-client/src/components/layout/Sidebar.jsx` | Navigation sidebar (responsive) |
| `packages/panel-client/src/components/Toast.jsx` | Notification toast system |
| `packages/panel-client/src/pages/onboarding/OnboardingShell.jsx` | Onboarding wizard container |
| `packages/panel-client/src/pages/management/Dashboard.jsx` | System stats + service health |
| `packages/panel-client/src/pages/management/Tunnels.jsx` | Tunnel CRUD + plist download |
| `packages/panel-client/src/pages/management/Sites.jsx` | Static site management + file browser |
| `packages/panel-client/src/pages/management/Services.jsx` | Service control + live logs |
| `packages/panel-client/src/pages/management/Certificates.jsx` | Certificate management |
| `packages/panel-client/src/pages/Users.jsx` | Authelia user management |
| `packages/panel-client/src/pages/docs/DocsPage.jsx` | Documentation viewer |
| `packages/panel-client/src/components/FileBrowser.jsx` | File tree for static sites |

## Design Decisions

### Why mode detection at the app root?

The onboarding wizard and the management UI are completely different experiences. By detecting mode at the top level, we avoid conditional rendering deep in the component tree and prevent impossible states (e.g., a user navigating to `/tunnels` before onboarding is complete). The server enforces this boundary too — management routes return 503 before onboarding — but the client-side check provides a clean UX.

### Why react-query instead of useEffect + fetch?

react-query handles caching, deduplication, background refetching, retry, and stale data management out of the box. Manual `useEffect + fetch` patterns require reimplementing all of this, leading to loading flicker, race conditions, and stale data bugs. The tradeoff is a ~12 KB dependency.

### Why Tailwind utility classes only?

Utility classes keep all styling co-located with the markup. There are no CSS files to maintain or naming conventions to enforce. The dark terminal aesthetic maps cleanly to a fixed set of zinc/cyan color tokens. Tailwind's purge step ensures only used classes appear in the production bundle.

### Why no state management library (Redux, Zustand)?

react-query handles server state (which is the majority of state in this app). The remaining UI state (form inputs, sidebar open/close, active tab) is local component state via `useState`. There is no shared client-side state complex enough to warrant a separate library.

### Why static markdown for documentation?

Markdown files in `public/docs/` are copied as-is to the build output. They can be read on GitHub, edited without build steps, and loaded independently of the panel-server API. The documentation viewer is a simple `fetch + marked` rendering — no SSG, no MDX compilation, no build-time processing.

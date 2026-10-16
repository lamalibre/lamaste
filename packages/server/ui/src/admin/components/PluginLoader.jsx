import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ServerOff, WifiOff } from 'lucide-react';
import { useAdminClient } from '../context/AdminClientContext.jsx';
import { panelAvailability } from '../lib/hostingState.js';

const THEME = {
  bg: 'zinc-950',
  card: 'zinc-900',
  accent: 'cyan-400',
  border: 'zinc-800',
};

/** How often the plugin list is read while the pages wait for the hosting, and once they are open. */
const WAITING_POLL_MS = 10_000;
const MOUNTED_POLL_MS = 30_000;

/** A centred line in the mount point: loading, or why the plugin's panel did not load. */
function showMessage(node, text) {
  node.textContent = '';
  const wrapper = document.createElement('div');
  wrapper.className = 'flex items-center justify-center h-64';
  const msg = document.createElement('p');
  msg.className = 'text-zinc-500 text-sm';
  msg.textContent = text;
  wrapper.appendChild(msg);
  node.appendChild(wrapper);
}

function findPlugin(data, name) {
  return data?.plugins?.find((p) => p.name === name);
}

/** Why an agent-hosted plugin's pages cannot open yet, instead of them. */
function HostingCard({ availability }) {
  const offline = availability.state === 'offline';
  return (
    <div className="rounded-lg bg-zinc-900 border border-zinc-800 p-6">
      <div className="flex items-start gap-3">
        {offline ? (
          <WifiOff size={18} className="mt-0.5 shrink-0 text-red-400" />
        ) : (
          <ServerOff size={18} className="mt-0.5 shrink-0 text-zinc-500" />
        )}
        <div>
          <p className="text-sm text-zinc-200">{availability.message}</p>
          <p className="mt-1 text-xs text-zinc-500">
            Its pages come from its agent half. This page checks every 10 seconds and opens them
            once the hosting is up.
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * Microfrontend loader for plugin panel pages.
 *
 * Host-agnostic: fetches the plugin JS bundle via client.fetchPluginBundle()
 * which is implemented differently per host:
 * - Web panel: fetch('/api/<pluginName>/panel.js')
 * - Desktop: invoke('admin_fetch_plugin_bundle', { name }) → Rust → curl + mTLS
 *
 * An agent-hosted plugin's bundle comes from its agent half through the
 * forwarder, so the loader reads the plugin list first (the query the
 * Plugins page and the sidebar read): while the hosting is down, or the
 * plugin is not hosted or its hosting is being set up or removed, it shows
 * why instead of fetching the bundle — which could only fail, after the
 * forwarder's timeout — polls every 10 seconds, and mounts the pages once
 * the hosting is up. Pages once mounted stay mounted; an outage after that
 * shows above them. A server plugin, or a list that cannot be read, loads
 * as before.
 *
 * Props:
 * - pluginName: string — the plugin name
 * - subPath: string — sub-path within the plugin (optional)
 * - basePath: string — base URL path for the plugin (optional)
 * - panelUrl: string — the panel origin URL (optional, for plugin context)
 */
export default function PluginLoader({ pluginName, subPath = '', basePath, panelUrl }) {
  const client = useAdminClient();
  const mountRef = useRef(null);

  const plugins = useQuery({
    queryKey: ['plugins'],
    queryFn: () => client.getPlugins(),
    refetchInterval: (query) =>
      panelAvailability(findPlugin(query.state.data, pluginName), Date.now()).state === 'mount'
        ? MOUNTED_POLL_MS
        : WAITING_POLL_MS,
  });

  const availability = plugins.data
    ? panelAvailability(findPlugin(plugins.data, pluginName), plugins.dataUpdatedAt)
    : plugins.isError
      ? { state: 'mount' }
      : { state: 'checking' };

  // The plugin whose pages may stay mounted whatever its hosting does next.
  const [mountedFor, setMountedFor] = useState(null);
  if (availability.state === 'mount' && mountedFor !== pluginName) setMountedFor(pluginName);
  const canMount = availability.state === 'mount' || mountedFor === pluginName;

  useEffect(() => {
    const node = mountRef.current;
    if (!pluginName || !canMount || !node) return undefined;
    let cancelled = false;
    let unmount = null;

    const mount = () => {
      const entry = window.__lamalibrePlugins?.[pluginName];
      if (!entry || typeof entry.mount !== 'function') {
        throw new Error('The plugin bundle registered no panel');
      }
      node.textContent = '';
      const result = entry.mount({
        mountPoint: node,
        panelUrl: panelUrl || window.location.origin,
        basePath: basePath || `/plugins/${pluginName}`,
        subPath: subPath || '',
        theme: THEME,
      });
      if (result && typeof result.unmount === 'function') unmount = result.unmount;
      else if (typeof result === 'function') unmount = result;
    };
    const fail = () => {
      if (!cancelled) showMessage(node, `Failed to load plugin panel for "${pluginName}"`);
    };

    if (window.__lamalibrePlugins?.[pluginName]) {
      // Loaded before: mount it again (another page of the plugin, or back to it).
      try {
        mount();
      } catch {
        fail();
      }
    } else {
      showMessage(node, 'Loading plugin...');
      client.fetchPluginBundle(pluginName).then((jsSource) => {
        if (cancelled) return;
        try {
          if (!window.__lamalibrePlugins) window.__lamalibrePlugins = {};
          // Evaluate the plugin JS in global scope
          const fn = new Function(jsSource); // dynamic eval for plugin bundles
          fn();
          mount();
        } catch {
          fail();
        }
      }, fail);
    }

    return () => {
      cancelled = true;
      if (unmount) unmount();
    };
  }, [pluginName, subPath, basePath, panelUrl, client, canMount]);

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {!canMount && availability.state === 'checking' && (
        <div className="flex items-center justify-center h-64">
          <p className="text-zinc-500 text-sm">Loading plugin...</p>
        </div>
      )}
      {!canMount && (availability.state === 'offline' || availability.state === 'waiting') && (
        <HostingCard availability={availability} />
      )}
      {canMount && (availability.state === 'offline' || availability.state === 'waiting') && (
        <div
          className={`mb-4 flex items-start gap-2 rounded border px-3 py-2 text-xs ${availability.state === 'offline' ? 'border-red-500/30 text-red-400' : 'border-zinc-700 text-zinc-400'}`}
        >
          <WifiOff size={12} className="mt-0.5 shrink-0" />
          <span>
            {availability.message} — this page cannot reach its agent half until the hosting is up
            again.
          </span>
        </div>
      )}
      {canMount && <div ref={mountRef} className="min-h-64" data-plugin={pluginName} />}
    </div>
  );
}

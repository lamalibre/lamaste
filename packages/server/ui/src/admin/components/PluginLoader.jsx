import { useEffect, useRef, useCallback } from 'react';
import { useAdminClient } from '../context/AdminClientContext.jsx';

/**
 * Microfrontend loader for plugin panel pages.
 *
 * Host-agnostic: fetches the plugin JS bundle via client.fetchPluginBundle()
 * which is implemented differently per host:
 * - Web panel: fetch('/api/<pluginName>/panel.js')
 * - Desktop: invoke('admin_fetch_plugin_bundle', { name }) → Rust → curl + mTLS
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
  const cleanupRef = useRef(null);

  const mountPlugin = useCallback(() => {
    if (!mountRef.current || !pluginName) return;

    if (!window.__lamalibrePlugins) {
      window.__lamalibrePlugins = {};
    }

    const pluginEntry = window.__lamalibrePlugins[pluginName];
    if (pluginEntry && typeof pluginEntry.mount === 'function') {
      const ctx = {
        mountPoint: mountRef.current,
        panelUrl: panelUrl || window.location.origin,
        basePath: basePath || `/plugins/${pluginName}`,
        subPath: subPath || '',
        theme: {
          bg: 'zinc-950',
          card: 'zinc-900',
          accent: 'cyan-400',
          border: 'zinc-800',
        },
      };

      const result = pluginEntry.mount(ctx);
      if (result && typeof result.unmount === 'function') {
        cleanupRef.current = result.unmount;
      } else if (typeof result === 'function') {
        cleanupRef.current = result;
      }
    }
  }, [pluginName, subPath, basePath, panelUrl]);

  useEffect(() => {
    if (!pluginName) return;

    // Clean up previous mount
    if (cleanupRef.current) {
      cleanupRef.current();
      cleanupRef.current = null;
    }

    // Clear mount point
    if (mountRef.current) {
      mountRef.current.innerHTML = '';
    }

    // Check if the plugin is already loaded
    if (window.__lamalibrePlugins?.[pluginName]) {
      mountPlugin();
      return;
    }

    // Fetch and evaluate the plugin bundle via the client abstraction
    let cancelled = false;
    client.fetchPluginBundle(pluginName).then((jsSource) => {
      if (cancelled) return;

      try {
        // Evaluate the plugin JS in global scope
        const fn = new Function(jsSource); // dynamic eval for plugin bundles
        fn();
        mountPlugin();
      } catch {
        if (mountRef.current) {
          mountRef.current.textContent = '';
          const wrapper = document.createElement('div');
          wrapper.className = 'flex items-center justify-center h-64';
          const msg = document.createElement('p');
          msg.className = 'text-zinc-500 text-sm';
          msg.textContent = `Failed to load plugin panel for "${pluginName}"`;
          wrapper.appendChild(msg);
          mountRef.current.appendChild(wrapper);
        }
      }
    }).catch(() => {
      if (cancelled || !mountRef.current) return;
      mountRef.current.textContent = '';
      const wrapper = document.createElement('div');
      wrapper.className = 'flex items-center justify-center h-64';
      const msg = document.createElement('p');
      msg.className = 'text-zinc-500 text-sm';
      msg.textContent = `Failed to load plugin panel for "${pluginName}"`;
      wrapper.appendChild(msg);
      mountRef.current.appendChild(wrapper);
    });

    return () => {
      cancelled = true;
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
    };
  }, [pluginName, client, mountPlugin]);

  // Re-mount when sub-path changes (navigation within plugin)
  useEffect(() => {
    if (window.__lamalibrePlugins?.[pluginName]) {
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
      if (mountRef.current) {
        mountRef.current.innerHTML = '';
      }
      mountPlugin();
    }
  }, [subPath, pluginName, mountPlugin]);

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div
        ref={mountRef}
        className="min-h-64"
        data-plugin={pluginName}
      >
        <div className="flex items-center justify-center h-64">
          <p className="text-zinc-500 text-sm">Loading plugin...</p>
        </div>
      </div>
    </div>
  );
}

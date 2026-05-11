import { useEffect, useRef, useCallback } from 'react';
import { useParams, useLocation } from 'react-router-dom';

/**
 * Microfrontend loader for plugin panel pages.
 *
 * 1. Creates a mount-point div
 * 2. Loads GET /api/<pluginName>/panel.js via dynamic script tag
 * 3. Plugin registers on window.__lamalibrePlugins[name] and exposes mount(ctx)
 * 4. Passes context: { mountPoint, panelUrl, basePath, subPath, theme }
 * 5. Cleanup on unmount
 */
export default function PluginLoader() {
  const { pluginName, '*': subPath } = useParams();
  const location = useLocation();
  const mountRef = useRef(null);
  const cleanupRef = useRef(null);
  const scriptRef = useRef(null);

  const mountPlugin = useCallback(() => {
    if (!mountRef.current || !pluginName) return;

    // Initialize the global plugin registry if not present
    if (!window.__lamalibrePlugins) {
      window.__lamalibrePlugins = {};
    }

    const pluginEntry = window.__lamalibrePlugins[pluginName];
    if (pluginEntry && typeof pluginEntry.mount === 'function') {
      const ctx = {
        mountPoint: mountRef.current,
        panelUrl: window.location.origin,
        basePath: `/plugins/${pluginName}`,
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
  }, [pluginName, subPath]);

  useEffect(() => {
    if (!pluginName) return;

    // Clean up previous mount
    if (cleanupRef.current) {
      cleanupRef.current();
      cleanupRef.current = null;
    }

    // Remove previous script tag
    if (scriptRef.current) {
      scriptRef.current.remove();
      scriptRef.current = null;
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

    // Load the plugin panel bundle
    const script = document.createElement('script');
    script.src = `/api/${pluginName}/panel.js`;
    script.async = true;
    script.onload = () => {
      mountPlugin();
    };
    script.onerror = () => {
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
    };

    document.body.appendChild(script);
    scriptRef.current = script;

    return () => {
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
      if (scriptRef.current) {
        scriptRef.current.remove();
        scriptRef.current = null;
      }
    };
  }, [pluginName, mountPlugin]);

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
  }, [location.pathname, pluginName, mountPlugin]);

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div ref={mountRef} className="min-h-64" data-plugin={pluginName}>
        <div className="flex items-center justify-center h-64">
          <p className="text-zinc-500 text-sm">Loading plugin...</p>
        </div>
      </div>
    </div>
  );
}

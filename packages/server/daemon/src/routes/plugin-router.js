/**
 * Server-side plugin router — delegates to pluginHostPlugin from @lamalibre/lamaste.
 *
 * Configures the core plugin host with:
 *   - mTLS auth strategy (two-level encapsulation)
 *   - Per-plugin auth hook: admits admin certs unconditionally, or
 *     agent / plugin-agent certs that hold at least one
 *     `plugin:<pluginName>:*` capability. Per-route capability specifics
 *     (e.g. `plugin:rodeo:run` vs `plugin:rodeo:submit`) remain each
 *     plugin's responsibility via its own preHandlers.
 *   - Server paths (/etc/lamalibre/lamaste/)
 *   - Storage config resolution per plugin
 *   - Onboarding guard (503 before onboarding completes)
 */
import { pluginHostPlugin } from '@lamalibre/lamaste';
import { readPlugins } from '../lib/plugins.js';
import { getPluginStorageConfig } from '../lib/storage.js';
import { getConfig } from '../lib/config.js';
import { getCaPaths } from '../lib/pki-paths.js';
import { managementOnly } from '../middleware/onboarding-guard.js';

// eslint-disable-next-line no-undef
const STATE_DIR = process.env.LAMALIBRE_LAMASTE_STATE_DIR || '/etc/lamalibre/lamaste';
const PLUGINS_DIR = `${STATE_DIR}/plugins`;

export default async function pluginRouter(fastify) {
  // Block all plugin routes until onboarding is complete
  fastify.addHook('onRequest', managementOnly());

  await fastify.register(pluginHostPlugin, {
    baseDir: STATE_DIR,
    pluginsDataDir: PLUGINS_DIR,
    readRegistry: readPlugins,
    auth: 'mtls',
    authHookFactory: (pluginName) => {
      const allowedPrefix = `plugin:${pluginName}:`;
      return async (request, reply) => {
        const role = request.certRole;
        if (role === 'admin') return;

        if (role === 'agent' || role === 'plugin-agent') {
          const caps = request.certCapabilities || [];
          if (caps.some((c) => c.startsWith(allowedPrefix))) {
            return;
          }
        }

        return reply.code(403).send({
          error: 'Insufficient scope for plugin route',
          details: {
            required: `admin OR agent with at least one "${allowedPrefix}*" capability`,
            current: role ?? 'unknown',
          },
        });
      };
    },

    /**
     * Resolve per-plugin register options: always injects `lamasteCa`
     * ({ certPath, keyPath }) so plugins (e.g. rodeo) can reuse Lamaste's
     * CA for mTLS; adds `storage` only when the plugin has bound storage.
     */
    resolvePluginOptions: async (plugin) => {
      const panelConfig = getConfig();
      const base = {
        lamasteCa: getCaPaths(),
      };

      const storageConfig = await getPluginStorageConfig(plugin.name);
      if (storageConfig) {
        base.storage = {
          ...storageConfig,
          prefix: panelConfig.serverId,
        };
      }

      return base;
    },
  });
}

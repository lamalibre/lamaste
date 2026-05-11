import { execFile } from 'node:child_process';
import { readFile, writeFile, rename, open, unlink, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import crypto from 'node:crypto';
import { z } from 'zod';
import { getSystemStats } from '../../lib/system-stats.js';
import { getConfig } from '../../lib/config.js';
import { setPluginCapabilities } from '../../lib/mtls.js';
import { getPluginCapabilities } from '../../lib/plugins.js';
import { PLUGIN_CAPABILITY_REGEX } from '@lamalibre/lamaste';

// Persist agent-reported capabilities so they survive server restarts
const AGENT_CAPS_FILE = () => join(getConfig().dataDir, 'agent-plugin-caps.json');

async function loadAgentReportedCaps() {
  try {
    const raw = await readFile(AGENT_CAPS_FILE(), 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.capabilities) ? parsed.capabilities : [];
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    return [];
  }
}

async function saveAgentReportedCaps(caps) {
  const filePath = AGENT_CAPS_FILE();
  const tmpPath = `${filePath}.tmp`;
  await mkdir(dirname(filePath), { recursive: true });
  const content = JSON.stringify({ capabilities: caps }, null, 2) + '\n';
  await writeFile(tmpPath, content, { encoding: 'utf-8', mode: 0o600 });
  const fd = await open(tmpPath, 'r');
  await fd.sync();
  await fd.close();
  await rename(tmpPath, filePath);
}

const UpdateBodySchema = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+$/, 'Version must be semver (e.g. 1.0.43)'),
});

export default async function systemRoutes(fastify, _opts) {
  // Load agent-reported capabilities from disk on startup
  try {
    const persistedCaps = await loadAgentReportedCaps();
    if (persistedCaps.length > 0) {
      const serverCaps = await getPluginCapabilities();
      const merged = [...new Set([...serverCaps, ...persistedCaps])];
      setPluginCapabilities(merged);
      fastify.log.info({ count: persistedCaps.length }, 'Loaded persisted agent plugin capabilities');
    }
  } catch (err) {
    fastify.log.warn({ err: err.message }, 'Failed to load agent-reported capabilities');
  }
  fastify.get(
    '/system/stats',
    {
      preHandler: fastify.requireRole(['admin', 'agent'], { capability: 'system:read' }),
    },
    async (request, reply) => {
      try {
        const stats = await getSystemStats(request.log);
        return stats;
      } catch {
        return reply.code(500).send({ error: 'Failed to retrieve system stats' });
      }
    },
  );

  // ------------------------------------------------------------------
  // POST /system/update — trigger a panel server update
  //
  // Uses `systemd-run` to launch the update script in a transient
  // systemd unit. This is critical: the panel runs as the
  // lamalibre-lamaste-serverd service, and systemd's default
  // KillMode (control-group) kills ALL processes in the cgroup when
  // the service stops. A detached child (spawn + unref) still lives
  // in the parent's cgroup, so it gets killed when the installer runs
  // `systemctl stop lamalibre-lamaste-serverd`. `systemd-run` places the script
  // in its own cgroup, letting it survive the panel restart.
  //
  // Returns 202 immediately — caller should poll /api/health until
  // the server comes back with the new version.
  // ------------------------------------------------------------------
  fastify.post(
    '/system/update',
    {
      preHandler: fastify.requireRole(['admin']),
    },
    async (request, reply) => {
      const body = UpdateBodySchema.parse(request.body);
      const { version } = body;

      // Write the update script to /etc/lamalibre/lamaste/ (NOT /tmp) because the
      // panel service uses PrivateTmp=true — files written to /tmp are in a
      // private namespace invisible to other systemd units.
      const scriptId = crypto.randomBytes(8).toString('hex');
      const configDir = getConfig().dataDir;
      // Extension must be .sh to match the tightened sudoers glob
      const scriptPath = join(configDir, `update-${scriptId}.sh`);

      // Build script without interpolating user input — version is validated
      // by the Zod regex above (/^\d+\.\d+\.\d+$/), but we avoid the fragile
      // pattern of template-literal shell scripts. scriptPath is server-derived
      // (dataDir + random hex) but we still quote it defensively.
      const escapedScriptPath = scriptPath.replace(/'/g, "'\\''");
      const script = [
        '#!/bin/bash',
        'set -e',
        '',
        '# Give the HTTP response time to flush',
        'sleep 2',
        '',
        '# Run the installer in redeploy mode — it stops and restarts the panel service',
        `npx --yes '@lamalibre/create-lamaste@${version}' --yes 2>&1 || true`,
        '',
        '# Self-cleanup',
        `rm -f '${escapedScriptPath}'`,
      ].join('\n') + '\n';

      await writeFile(scriptPath, script, { mode: 0o700 });

      // Launch in a transient systemd unit so the script survives
      // the panel service being stopped and restarted by the installer.
      // Uses sudo because the panel runs as the lamaste user, and
      // systemd-run needs root to create system-level transient units.
      const unitName = `lamalibre-lamaste-update-${scriptId}`;
      execFile('sudo', [
        'systemd-run',
        '--unit', unitName,
        '--no-block',
        '/usr/bin/bash', scriptPath,
      ], (err) => {
        if (err) {
          request.log.error({ err, version }, 'Failed to launch update unit');
          // Clean up the update script if systemd-run fails
          unlink(scriptPath).catch(() => {});
        }
      });

      request.log.info({ version, unit: unitName }, 'Panel update initiated via systemd-run');

      return reply.code(202).send({
        ok: true,
        message: `Update to create-lamaste@${version} initiated. The panel will restart shortly.`,
      });
    },
  );

  // ------------------------------------------------------------------
  // POST /agents/plugins/report — accept agent plugin capability report
  //
  // Agents report their enabled plugins during `lamaste-agent update`.
  // The server merges the reported plugin capabilities into the valid
  // capabilities set so they can be assigned to agents.
  // ------------------------------------------------------------------

  // Capability strings must be in the namespaced plugin form
  // `plugin:<short-name>:<action>` (see PLUGIN_CAPABILITY_REGEX). The
  // route-side prefix-scoping below additionally requires the `<short-name>`
  // segment to match the reporting plugin's own derived route.
  const PluginReportSchema = z.object({
    plugins: z.array(
      z.object({
        name: z.string().regex(/^[a-z0-9-]+$/),
        version: z.string(),
        capabilities: z.array(z.string().regex(PLUGIN_CAPABILITY_REGEX)).default([]),
      }),
    ),
  });

  fastify.post(
    '/agents/plugins/report',
    {
      preHandler: fastify.requireRole(['admin', 'agent']),
    },
    async (request, reply) => {
      const result = PluginReportSchema.safeParse(request.body);
      if (!result.success) {
        return reply.code(400).send({ error: 'Invalid plugin report', details: result.error.issues });
      }
      const { plugins } = result.data;

      // Collect capabilities, scoped to the reporting plugin's namespace.
      // Only accept caps whose `<short-name>` segment matches the plugin's
      // own name — this stops a compromised plugin from contributing
      // capabilities that another plugin has claimed (or from inventing new
      // top-level namespaces; the regex above already blocks anything
      // outside `plugin:*`).
      const reportedCaps = new Set();
      for (const plugin of plugins) {
        const expectedPrefix = `plugin:${plugin.name}:`;
        for (const cap of plugin.capabilities) {
          if (cap.startsWith(expectedPrefix)) {
            reportedCaps.add(cap);
          }
        }
      }

      if (reportedCaps.size === 0) {
        return { ok: true, merged: 0 };
      }

      // Merge with existing server-side plugin capabilities
      const serverCaps = await getPluginCapabilities();
      const allPluginCaps = [...new Set([...serverCaps, ...reportedCaps])];
      setPluginCapabilities(allPluginCaps);

      // Persist agent-reported capabilities so they survive server restarts
      const existingAgentCaps = await loadAgentReportedCaps();
      const allAgentCaps = [...new Set([...existingAgentCaps, ...reportedCaps])];
      await saveAgentReportedCaps(allAgentCaps);

      request.log.info(
        { agentPlugins: plugins.length, newCaps: reportedCaps.size },
        'Agent plugin capabilities reported',
      );

      return { ok: true, merged: reportedCaps.size };
    },
  );
}

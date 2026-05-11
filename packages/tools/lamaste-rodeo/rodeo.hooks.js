// ============================================================================
// e2e.hooks.js — Lamaste-specific hooks for the generic E2E CLI/UI stack.
// ============================================================================
//
// This file is the one place where project-specific knowledge lives: how to
// install Node on a VM, how to run create-lamaste, how to enroll an agent,
// how to wipe Authelia state between tests, what the hot-reload recipes are,
// and what env vars the test scripts expect.
//
// The CLI (packages/tools/e2e) dynamically imports this module via the
// `hooks` field in e2e.config.json, passes in a bound `ctx` object, and
// delegates all project-specific work here. Nothing in this file reaches
// back into the CLI's internals — the contract is the ctx object only.
//
// Every hook is optional. If a hook is absent, the CLI treats that as a
// no-op (for resetBetweenTests / buildTestEnv) or an "unknown role/package"
// error (for provisionRole / hotReload / tiers).
//
// --- Context shape -----------------------------------------------------------
//
// ctx = {
//   mp,        // multipass operations (exec, transfer, getIp, snapshot, ...)
//   config,    // the parsed e2e.config.json
//   repoRoot,  // absolute path to the project root
//   vmNames,   // { [role]: multipassName }
//   vmIps,     // { [multipassName]: staticIp }
//   domain,    // resolved test domain
//   state,     // { load, update, setVmState, setVmTier, getVmTier }
//   logger,    // { info, warn, error }
//   emit,      // { step, error } — NDJSON emitters
//   packPackage,    // (pkgName) => Promise<tarballPath>
//   packageDirs,    // { [pkgName]: "relative/workspace/path" }  (from config.packages)
//   // Per-hook extras:
//   vm,        // multipass name — provisionRole, tiers (per-VM), hotReload
//   role,      // role name — provisionRole only
//   vms,       // multipass names list — tiers only
//   tarballPath,   // hotReload only — host-side path
//   remotePath,    // hotReload only — VM-side path
// }
//
// Return-value contracts:
//   resetBetweenTests(ctx)    → void
//   buildTestEnv(ctx)         → { [envVar: string]: string }
//   provisionRole[role](ctx)  → { ok, error?, credentials?, domain? }
//   tiers[name](ctx)          → { credentials?, domain? }  (throws on failure)
//   hotReload[pkg](ctx)       → { service? } — if `service` present, CLI restarts it
// ----------------------------------------------------------------------------

import { runTier } from '@lamalibre/rodeo/agent';

// ---------------------------------------------------------------------------
// Public hook contract
// ---------------------------------------------------------------------------

export default {
  /**
   * Reset ephemeral state between three-VM tests.
   * Lamaste: clear Authelia regulation DB so login rate-limits don't cascade.
   */
  async resetBetweenTests(ctx) {
    const { mp, vmNames } = ctx;
    const host = vmNames.host;
    await mp.exec(host, 'systemctl stop authelia', { sudo: true, allowFailure: true });
    await mp.exec(
      host,
      'sqlite3 /etc/authelia/db.sqlite3 "DELETE FROM authentication_logs; DELETE FROM totp_history;"',
      { sudo: true, allowFailure: true },
    );
    await mp.exec(host, 'systemctl start authelia', { sudo: true, allowFailure: true });
    await new Promise((r) => setTimeout(r, 3000));
  },

  /**
   * Operator-invoked cleanup: kill stray test-time processes that `test reset`
   * (the manual command, not per-test) should wipe. Optional.
   */
  async cleanupStrayProcesses(ctx) {
    // Assumed role set: `agent`. On suites without an `agent` role this
    // hook is a no-op — `pkill` targets are Lamaste-specific.
    const { mp, vmNames } = ctx;
    const agent = vmNames.agent;
    if (!agent) return;
    await Promise.all([
      mp.exec(agent, 'pkill -f "python3 -m http.server" || true', {
        sudo: true,
        allowFailure: true,
      }),
      mp.exec(agent, 'pkill -f chisel || true', {
        sudo: true,
        allowFailure: true,
      }),
    ]);
  },

  /**
   * Optional: return a map of service name → systemd status for the
   * `env status` command. The CLI calls this with the built ctx and
   * passes whatever comes back through to the result. Missing hook =
   * CLI omits the `services` field entirely.
   *
   * Lamaste: checks core services on the host VM.
   */
  async collectServiceStatus(ctx) {
    const { mp, vmNames, config } = ctx;
    const host = vmNames.host;
    if (!host) return {};

    // Only probe services if the host is actually reachable.
    const info = await mp.info(host);
    const state = info?.info?.[host]?.state;
    if (state !== 'Running') return {};

    const serviceNames = config.suites?.[ctx.suite]?.monitorServices ||
      config.serviceStatus?.services || [
        'lamalibre-lamaste-serverd',
        'nginx',
        'authelia',
        'chisel-server',
      ];
    const entries = await Promise.all(
      serviceNames.map(async (svc) => {
        const result = await mp.exec(host, `systemctl is-active ${svc} 2>/dev/null | head -1`, {
          sudo: true,
          allowFailure: true,
        });
        return [svc, result.stdout.trim() || 'unknown'];
      }),
    );
    return Object.fromEntries(entries);
  },

  /**
   * Optional: diagnostics for the `diagnose` command.
   * - collectLogs(ctx): return { [logName]: text } of service logs to embed
   *   in the generated prompt.
   *
   * The error → file map lives in e2e.config.json under `diagnose.errorFileMap`
   * (pure data, repo-wide). It used to live here under `diagnose.errorFileMap`
   * and that hook path is still honored as a backwards-compat fallback.
   */
  diagnose: {
    async collectLogs(ctx) {
      const { mp, vmNames } = ctx;
      const host = vmNames.host;
      if (!host) return {};

      const logs = {};
      try {
        const r = await mp.exec(
          host,
          'journalctl -u lamalibre-lamaste-serverd --since "15 min ago" --no-pager -n 100',
          { sudo: true, timeout: 15_000, allowFailure: true },
        );
        if (r.exitCode === 0 && r.stdout.trim())
          logs['lamalibre-lamaste-serverd'] = r.stdout.trim();
      } catch {
        /* VM may not be running */
      }

      try {
        const r = await mp.exec(host, 'tail -50 /var/log/nginx/error.log', {
          sudo: true,
          timeout: 10_000,
          allowFailure: true,
        });
        if (r.exitCode === 0 && r.stdout.trim()) logs['nginx-error'] = r.stdout.trim();
      } catch {
        /* OK */
      }

      try {
        const r = await mp.exec(
          host,
          'journalctl -u authelia --since "15 min ago" --no-pager -n 50',
          { sudo: true, timeout: 15_000, allowFailure: true },
        );
        if (r.exitCode === 0 && r.stdout.trim()) logs['authelia'] = r.stdout.trim();
      } catch {
        /* OK */
      }

      return logs;
    },
  },

  /**
   * Build the env map passed to each test script's bash invocation.
   * Called once per `test run` / `test run-all`.
   */
  buildTestEnv(ctx) {
    const { state, vmNames, vmIps, domain } = ctx;
    const s = state.load();
    return {
      HOST_IP: vmIps[vmNames.host] || '',
      AGENT_IP: vmIps[vmNames.agent] || '',
      VISITOR_IP: vmIps[vmNames.visitor] || '',
      TEST_DOMAIN: domain,
      ADMIN_PASSWORD: 'not-used-mTLS-only',
      AGENT_P12_PASSWORD: s.credentials?.agentP12Password || 'not-used-enrollment-flow',
      TEST_USER: 'testuser',
      TEST_USER_PASSWORD: 'TestPassword-E2E-123',
      LOG_LEVEL: '1',
      LOG_DIR: '/tmp',
    };
  },

  /**
   * Per-tier builders, invoked by the smart provisioner when a tier can't
   * be restored from snapshot. The CLI handles the snapshot layer and state
   * recording; these hooks only do the work to reach the tier.
   *
   * Tier 'provisioned' may return { credentials, domain } which the CLI
   * persists to state via updateState().
   */
  // Assumed role set for every tier below: `host`, `agent`, `visitor`.
  // These tiers are Lamaste-specific and only apply to suites whose VMs
  // declare those roles. The generic CLI filters VMs via suiteTierAppliesTo,
  // so suites that omit a role are correctly skipped for that tier.
  tiers: {
    async 'node-ready'(ctx) {
      const result = await runTier({ suite: ctx.suite, tier: 'node-ready', ctx });
      return { credentials: result.outputs, domain: result.domain };
    },

    async installed(ctx) {
      const result = await runTier({ suite: ctx.suite, tier: 'installed', ctx });
      return { credentials: result.outputs, domain: result.domain };
    },

    async provisioned(ctx) {
      const result = await runTier({ suite: ctx.suite, tier: 'provisioned', ctx });
      return { credentials: result.outputs, domain: result.domain };
    },
  },

  /**
   * Manual per-role provisioners for `lamaste-e2e provision <role>`.
   * Keyed by VM role name — roles must match keys in e2e.config.json vms.
   *
   * Hooks only do work and report it. The CLI dispatcher in
   * packages/tools/e2e/src/commands/provision.js handles all state
   * writes (setVmTier, setVmState, updateState) based on the shape:
   *   { ok, error?, credentials?, domain?, tierReached? }
   */
  // Assumed role set: `host`, `agent`, `visitor` — each entry below names
  // the role it provisions. Suites that don't declare one of these roles
  // cannot invoke the matching provisionRole hook (the CLI rejects unknown
  // roles before dispatch).
  provisionRole: {
    async host(ctx) {
      // Walk each tier filtered to sections that touch the host role,
      // reporting the highest tier actually reached for accurate state on
      // partial failure. runTier's `role` parameter filters sections via
      // sectionTouchesRole() (see packages/tools/e2e/src/tier-runner.js).
      const tierOrder = ['node-ready', 'installed', 'provisioned'];
      let tierReached = null;
      let accumulated = {};
      try {
        for (const tier of tierOrder) {
          const result = await runTier({ suite: ctx.suite, tier, ctx, role: 'host' });
          tierReached = tier;
          accumulated = { ...accumulated, ...result.outputs };
        }
        return {
          ok: true,
          credentials: accumulated,
          domain: ctx.domain,
          tierReached,
        };
      } catch (err) {
        return {
          ok: false,
          error: err.message,
          ...(tierReached ? { tierReached } : {}),
        };
      }
    },

    async agent(ctx) {
      // Agent setup is declared in the `provisioned` tier. Prior tiers
      // (node-ready, installed) are expected to have been reached via the
      // full provision flow or an earlier `provision host`. runTier with
      // role=agent filters sections to those touching the agent VM.
      try {
        const result = await runTier({
          suite: ctx.suite,
          tier: 'provisioned',
          ctx,
          role: 'agent',
        });
        return {
          ok: true,
          credentials: result.outputs,
          domain: ctx.domain,
          tierReached: 'provisioned',
        };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },

    async visitor(ctx) {
      try {
        const result = await runTier({
          suite: ctx.suite,
          tier: 'provisioned',
          ctx,
          role: 'visitor',
        });
        return {
          ok: true,
          credentials: result.outputs,
          domain: ctx.domain,
          tierReached: 'provisioned',
        };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },
  },

  /**
   * Per-package hot-reload recipes. The CLI packs and transfers the tarball,
   * then calls the matching hook with { tarballPath, remotePath, vm }. The
   * hook extracts and installs the package. If the hook returns { service },
   * the CLI restarts that systemd service after extraction.
   */
  hotReload: {
    async 'lamaste-serverd'(ctx) {
      const INSTALL_DIR = '/opt/lamalibre/lamaste';
      await ctx.mp.exec(
        ctx.vm,
        [
          `rm -rf /tmp/hot-reload-extract`,
          `mkdir -p /tmp/hot-reload-extract`,
          `tar xzf ${ctx.remotePath} -C /tmp/hot-reload-extract`,
          `cp /tmp/hot-reload-extract/package/package.json ${INSTALL_DIR}/serverd/package.json`,
          `rm -rf ${INSTALL_DIR}/serverd/src`,
          `cp -r /tmp/hot-reload-extract/package/src ${INSTALL_DIR}/serverd/src`,
          `cd ${INSTALL_DIR}/serverd && npm install --production --ignore-scripts`,
          `chown -R lamaste:lamaste ${INSTALL_DIR}/serverd`,
          `rm -rf /tmp/hot-reload-extract`,
        ].join(' && '),
        { sudo: true, timeout: 60_000 },
      );
      return { service: 'lamalibre-lamaste-serverd' };
    },

    async 'lamaste-server-ui'(ctx) {
      const INSTALL_DIR = '/opt/lamalibre/lamaste';
      await ctx.mp.exec(
        ctx.vm,
        [
          `rm -rf /tmp/hot-reload-extract`,
          `mkdir -p /tmp/hot-reload-extract`,
          `tar xzf ${ctx.remotePath} -C /tmp/hot-reload-extract`,
          `rm -rf ${INSTALL_DIR}/lamaste-server-ui/dist`,
          `cp -r /tmp/hot-reload-extract/package/dist ${INSTALL_DIR}/lamaste-server-ui/dist`,
          `chown -R lamaste:lamaste ${INSTALL_DIR}/lamaste-server-ui`,
          `rm -rf /tmp/hot-reload-extract`,
        ].join(' && '),
        { sudo: true, timeout: 60_000 },
      );
      return {};
    },

    async 'lamaste-gatekeeper'(ctx) {
      const INSTALL_DIR = '/opt/lamalibre/lamaste';
      await ctx.mp.exec(
        ctx.vm,
        [
          `rm -rf /tmp/hot-reload-extract`,
          `mkdir -p /tmp/hot-reload-extract`,
          `tar xzf ${ctx.remotePath} -C /tmp/hot-reload-extract`,
          `cp /tmp/hot-reload-extract/package/package.json ${INSTALL_DIR}/gatekeeper/package.json`,
          `rm -rf ${INSTALL_DIR}/gatekeeper/dist`,
          `cp -r /tmp/hot-reload-extract/package/dist ${INSTALL_DIR}/gatekeeper/dist`,
          `cd ${INSTALL_DIR}/gatekeeper && npm install --production --ignore-scripts`,
          `chown -R lamaste:lamaste ${INSTALL_DIR}/gatekeeper`,
          `rm -rf /tmp/hot-reload-extract`,
        ].join(' && '),
        { sudo: true, timeout: 60_000 },
      );
      return { service: 'lamalibre-lamaste-gatekeeper' };
    },

    async 'create-lamaste'(ctx) {
      await ctx.mp.exec(ctx.vm, `npm install -g ${ctx.remotePath}`, {
        sudo: true,
        timeout: 60_000,
      });
      return {};
    },

    async 'lamaste-agent'(ctx) {
      await ctx.mp.exec(ctx.vm, `npm install -g ${ctx.remotePath}`, {
        sudo: true,
        timeout: 60_000,
      });
      return {};
    },
  },
};

#!/usr/bin/env node
// ============================================================================
// migrate-e2e-config.mjs
// ============================================================================
//
// One-shot migration for e2e.config.json: moves from shared top-level
// `vms` / `subnet` / `paths.suites` / `testDeps` and `tiers.*.appliesTo` into
// per-suite fields. Idempotent: if the input already looks new-shape, exits
// 0 without touching the file.
//
// Usage:
//   node scripts/migrate-e2e-config.mjs [path.json] [options]
//
// Options:
//   --interface <name>         Network interface to embed in each suite
//                              (default: raw.vms.networkInterface if present)
//   --subnet <cidr>            Static-IP subnet to embed in each suite
//                              (default: raw.subnet if present)
//   --hot-reload-suite <name>  Suite for the hotReload block
//                              (default: first suite with default:true, else first)
//   --hot-reload-role <role>   Role for the hotReload block
//                              (default: "host")
//
// Both --interface and --subnet are required if the legacy config does not
// already carry the corresponding fields. The script is idempotent: running
// it against an already-migrated config is a no-op and does not touch any
// of the default values.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

function die(msg) {
  process.stderr.write(`migrate-e2e-config: ${msg}\n`);
  process.exit(1);
}

function info(msg) {
  process.stderr.write(`migrate-e2e-config: ${msg}\n`);
}

function isLegacy(cfg) {
  if (!cfg || typeof cfg !== 'object') return false;
  if (cfg.vms && typeof cfg.vms === 'object') return true;
  if (typeof cfg.subnet === 'string') return true;
  if (cfg.paths && typeof cfg.paths === 'object' && cfg.paths.suites) return true;
  if (cfg.testDeps && typeof cfg.testDeps === 'object') return true;
  if (cfg.tiers && typeof cfg.tiers === 'object') {
    for (const t of Object.values(cfg.tiers)) {
      if (t && typeof t === 'object' && Array.isArray(t.appliesTo)) return true;
    }
  }
  return false;
}

function detectIndent(src) {
  // Look for the first indented line; default to 2 spaces.
  const m = src.match(/\n(\s+)\S/);
  if (!m) return 2;
  const ws = m[1];
  if (ws.startsWith('\t')) return '\t';
  return ws.length;
}

/**
 * Parse CLI arguments into `{ target, options }`. Positional argument (if
 * any) is the target file path. All `--flag value` pairs are captured into
 * `options`. Unknown flags are a hard error — legacy configs vary enough
 * that silent drops would be dangerous.
 */
function parseArgs(argv) {
  const knownFlags = new Set([
    '--interface',
    '--subnet',
    '--hot-reload-suite',
    '--hot-reload-role',
  ]);
  const options = {};
  let target = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      if (!knownFlags.has(arg)) die(`unknown flag: ${arg}`);
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        die(`flag ${arg} requires a value`);
      }
      options[arg.slice(2)] = value;
      i++;
    } else if (target === null) {
      target = arg;
    } else {
      die(`unexpected positional argument: ${arg}`);
    }
  }

  return { target, options };
}

function migrate(raw, cliOptions) {
  const next = {};

  // Preserve insertion order similar to original.
  if (raw.$schema !== undefined) next.$schema = raw.$schema;
  if (raw.project !== undefined) next.project = raw.project;
  if (raw.hooks !== undefined) next.hooks = raw.hooks;

  // paths — strip suites
  const oldPaths = raw.paths || {};
  next.paths = {
    logs: oldPaths.logs,
    tempDir: oldPaths.tempDir,
  };
  // Preserve any extra fields on paths except `suites`.
  for (const [k, v] of Object.entries(oldPaths)) {
    if (k !== 'suites' && k !== 'logs' && k !== 'tempDir') {
      next.paths[k] = v;
    }
  }

  if (raw.profiles !== undefined) next.profiles = raw.profiles;

  // tiers — strip appliesTo
  const oldTiers = raw.tiers || {};
  next.tiers = {};
  for (const [tierName, tierDef] of Object.entries(oldTiers)) {
    const { appliesTo: _drop, ...rest } = tierDef || {};
    next.tiers[tierName] = rest;
  }

  // Build per-suite VM maps, tierAppliesTo, testDeps, path, subnet, iface.
  const rawVms = raw.vms || {};

  // Resolution order: CLI flag → legacy field → hard error. No magic
  // per-project defaults so the script is safe to reuse on any repo.
  const networkInterface =
    cliOptions['interface'] ||
    (typeof rawVms.networkInterface === 'string' ? rawVms.networkInterface : null);
  if (!networkInterface) {
    die(
      'network interface missing: pass --interface <name> (legacy config has no vms.networkInterface)',
    );
  }

  const subnet = cliOptions['subnet'] || (typeof raw.subnet === 'string' ? raw.subnet : null);
  if (!subnet) {
    die('subnet missing: pass --subnet <cidr> (legacy config has no subnet)');
  }

  info(`using networkInterface=${networkInterface}`);
  info(`using subnet=${subnet}`);
  const roleEntries = Object.fromEntries(
    Object.entries(rawVms).filter(
      ([, v]) => v && typeof v === 'object' && typeof v.name === 'string',
    ),
  );

  const oldSuites = raw.suites || {};
  const oldSuitesPaths = (raw.paths && raw.paths.suites) || {};
  const oldTestDeps = raw.testDeps || {};

  next.suites = {};
  for (const [suiteName, suiteDef] of Object.entries(oldSuites)) {
    const roles = Array.isArray(suiteDef?.vms) ? suiteDef.vms : [];
    const vmsForSuite = {};
    for (const role of roles) {
      if (roleEntries[role]) {
        vmsForSuite[role] = { ...roleEntries[role] };
      }
    }

    const tierAppliesTo = {};
    for (const [tierName, tierDef] of Object.entries(oldTiers)) {
      const applies = Array.isArray(tierDef?.appliesTo) ? tierDef.appliesTo : [];
      tierAppliesTo[tierName] = applies.filter((r) => roles.includes(r));
    }

    const suitePath = oldSuitesPaths[suiteName];
    if (!suitePath) {
      die(`suite "${suiteName}" has no entry in paths.suites`);
    }

    const merged = {
      label: suiteDef.label,
    };
    if (suiteDef.default === true) merged.default = true;
    if (suiteDef.runner !== undefined) merged.runner = suiteDef.runner;
    merged.path = suitePath;
    merged.networkInterface = networkInterface;
    merged.subnet = subnet;
    merged.vms = vmsForSuite;
    merged.tierAppliesTo = tierAppliesTo;
    merged.testDeps = oldTestDeps[suiteName] || {};

    // Preserve any extra fields on the suite.
    for (const [k, v] of Object.entries(suiteDef)) {
      if (!['label', 'default', 'runner', 'vms'].includes(k) && !(k in merged)) {
        merged[k] = v;
      }
    }

    next.suites[suiteName] = merged;
  }

  // hotReload — add default if not present
  if (raw.hotReload !== undefined) {
    next.hotReload = raw.hotReload;
  } else {
    const suiteEntries = Object.entries(next.suites);
    const fallbackSuite =
      suiteEntries.find(([, s]) => s.default === true)?.[0] || suiteEntries[0]?.[0] || null;
    const hotSuite = cliOptions['hot-reload-suite'] || fallbackSuite;
    const hotRole = cliOptions['hot-reload-role'] || 'host';
    if (hotSuite) {
      if (!next.suites[hotSuite]) {
        die(`--hot-reload-suite "${hotSuite}" is not declared in the config`);
      }
      info(`using hotReload suite=${hotSuite} targetRole=${hotRole}`);
      next.hotReload = { suite: hotSuite, targetRole: hotRole };
    }
  }

  if (raw.defaults !== undefined) next.defaults = raw.defaults;
  if (raw.packages !== undefined) next.packages = raw.packages;

  // Preserve any remaining unknown top-level keys except the ones we dropped.
  const dropKeys = new Set([
    '$schema',
    'project',
    'hooks',
    'paths',
    'vms',
    'subnet',
    'profiles',
    'tiers',
    'suites',
    'testDeps',
    'defaults',
    'packages',
    'hotReload',
  ]);
  for (const [k, v] of Object.entries(raw)) {
    if (!dropKeys.has(k) && !(k in next)) next[k] = v;
  }

  return next;
}

function atomicWrite(filePath, content) {
  const dir = path.dirname(filePath);
  const tmp = path.join(dir, `.${path.basename(filePath)}.${process.pid}.tmp`);
  const fd = fs.openSync(tmp, 'w', 0o644);
  try {
    fs.writeSync(fd, content);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, filePath);
}

function main() {
  const { target: targetArg, options } = parseArgs(process.argv.slice(2));
  const target = path.resolve(targetArg || path.join(process.cwd(), 'e2e.config.json'));
  if (!fs.existsSync(target)) die(`file not found: ${target}`);

  const src = fs.readFileSync(target, 'utf-8');
  let raw;
  try {
    raw = JSON.parse(src);
  } catch (err) {
    die(`invalid JSON in ${target}: ${err.message}`);
  }

  if (!isLegacy(raw)) {
    info(`${target} is already in the new shape — no changes`);
    process.exit(0);
  }

  const next = migrate(raw, options);

  const indent = detectIndent(src);
  const trailingNewline = src.endsWith('\n') ? '\n' : '';
  const serialized = JSON.stringify(next, null, indent) + trailingNewline;

  atomicWrite(target, serialized);

  const summary = [
    `migrated ${target}`,
    `  suites: ${Object.keys(next.suites).join(', ')}`,
    `  dropped top-level: vms, subnet, paths.suites, testDeps, tiers.*.appliesTo`,
    `  added per suite: path, networkInterface, subnet, vms, tierAppliesTo, testDeps`,
    `  hotReload: ${JSON.stringify(next.hotReload || null)}`,
  ].join('\n');
  info(summary);
}

main();

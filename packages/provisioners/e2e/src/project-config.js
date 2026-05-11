// ============================================================================
// Project Config Loader
// ============================================================================
// Loads e2e.config.json once at MCP server startup. Walks upward from the
// current working directory to find the config file. The MCP server cannot
// function without a project config — it drives every tool schema.
//
// Exports:
//   PROJECT_CONFIG  — parsed config object
//   ROLE_NAMES      — keys of config.vms (e.g. ['host','agent','visitor'])
//   PROFILE_NAMES   — keys of config.profiles
//   SUITE_NAMES     — keys of config.suites
//   TIER_NAMES      — keys of config.tiers
//   PACKAGE_NAMES   — keys of config.packages
//   DEFAULT_DOMAIN  — config.defaults.domain
//   PROJECT_CONFIG_PATH — absolute path to the loaded file
// ============================================================================

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

function findConfigFile(startDir) {
  let dir = resolve(startDir);
  while (true) {
    const candidate = join(dir, 'e2e.config.json');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

const configPath = findConfigFile(process.cwd());
if (!configPath) {
  throw new Error(
    'Lamaste E2E MCP: e2e.config.json not found in cwd or any parent. ' +
      'The MCP server requires a project config to function.',
  );
}

let parsed;
try {
  parsed = JSON.parse(readFileSync(configPath, 'utf8'));
} catch (err) {
  throw new Error(
    `Lamaste E2E MCP: failed to parse ${configPath}: ${err.message}`,
  );
}

export const PROJECT_CONFIG_PATH = configPath;
export const PROJECT_CONFIG = parsed;

// Filter out non-role keys from vms (e.g. networkInterface). A role entry is
// an object with a `name` field — anything else is configuration scoped under
// the vms namespace.
export const ROLE_NAMES = Object.entries(parsed.vms || {})
  .filter(([, v]) => v && typeof v === 'object' && typeof v.name === 'string')
  .map(([k]) => k);

export const PROFILE_NAMES = Object.keys(parsed.profiles || {});
export const SUITE_NAMES = Object.keys(parsed.suites || {});
export const TIER_NAMES = Object.keys(parsed.tiers || {});
export const PACKAGE_NAMES = Object.keys(parsed.packages || {});
export const DEFAULT_DOMAIN = parsed.defaults?.domain ?? '';

/** Profile flagged `default: true`, falling back to the first declared profile. */
export const DEFAULT_PROFILE =
  Object.entries(parsed.profiles || {}).find(([, p]) => p?.default === true)?.[0] ||
  PROFILE_NAMES[0] ||
  null;

/** Suite flagged `default: true`, falling back to the first declared suite. */
export const DEFAULT_SUITE =
  Object.entries(parsed.suites || {}).find(([, s]) => s?.default === true)?.[0] ||
  SUITE_NAMES[0] ||
  null;

/**
 * Build a Zod-compatible enum argument list from a dynamic array.
 * Zod requires at least one literal; callers should fall back to z.string()
 * when this returns null.
 */
export function toEnumTuple(values) {
  if (!Array.isArray(values) || values.length === 0) return null;
  return values;
}

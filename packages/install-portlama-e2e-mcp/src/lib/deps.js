// ============================================================================
// Test Discovery & Dependency Graph
// ============================================================================
// Discovers test files from the filesystem and verifies they are git-tracked.
// Only files matching the NN-name.sh convention that are committed to git are
// eligible for execution — this prevents injected scripts from being run.

import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { SINGLE_VM_DIR, THREE_VM_DIR, REPO_ROOT } from '../config.js';

/** Pattern for valid test files: two-digit prefix, hyphen, name, .sh extension. */
const TEST_FILE_PATTERN = /^(\d{2})-[a-z0-9-]+\.sh$/;

/**
 * Get the set of git-tracked files in a directory (relative to repo root).
 * Returns a Set of filenames (not full paths).
 */
function getGitTrackedFiles(dir) {
  try {
    const relativePath = dir.replace(REPO_ROOT + '/', '');
    const output = execSync(`git ls-files "${relativePath}"`, {
      cwd: REPO_ROOT,
      encoding: 'utf-8',
      timeout: 5000,
    });
    return new Set(
      output
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((f) => f.split('/').pop()),
    );
  } catch {
    // If git is unavailable, fall back to empty set (all files rejected)
    return new Set();
  }
}

/**
 * Discover test files from a directory.
 * Only returns files that:
 *   1. Match the NN-name.sh naming convention
 *   2. Are tracked by git (not injected/untracked)
 * Returns a map of { number: filename }.
 */
export function discoverTests(dir) {
  const gitTracked = getGitTrackedFiles(dir);
  const files = fs.readdirSync(dir).filter((f) => TEST_FILE_PATTERN.test(f));
  const map = {};

  for (const file of files) {
    if (!gitTracked.has(file)) continue; // reject untracked files
    const num = parseInt(file.slice(0, 2), 10);
    map[num] = file;
  }

  return map;
}

/**
 * Single-VM test dependency graph.
 * Key = test number, Value = array of prerequisite test numbers.
 *
 * Test 01 verifies fresh install, 03 runs onboarding. Most tests require
 * onboarding to be complete, so they depend on 03.
 */
export const SINGLE_VM_DEPS = {
  1: [], // fresh-install — no deps
  2: [1], // mtls-enforcement
  3: [1], // onboarding-flow
  4: [3], // tunnel-lifecycle (needs onboarding)
  5: [3], // user-lifecycle
  6: [1], // service-control
  7: [3], // cert-renewal
  8: [3], // mtls-rotation
  9: [3], // ip-fallback
  10: [1], // resilience
  11: [3], // input-validation
  12: [3], // user-invitations
  13: [3], // site-lifecycle
  15: [3], // plugin-lifecycle
  16: [3], // enrollment-tokens
};

/**
 * Three-VM test dependency graph.
 * All tests require onboarding to be complete (test 01 verifies it).
 * Tests are otherwise independent — each cleans up after itself.
 */
export const THREE_VM_DEPS = {
  1: [], // onboarding-complete — no deps
  2: [1], // tunnel-traffic
  3: [1], // tunnel-toggle-traffic
  4: [1], // authelia-auth
  5: [1], // admin-journey
  6: [1], // tunnel-user-journey
  7: [1], // site-visitor-journey
  8: [1], // invitation-journey
  9: [1], // agent-site-deploy
  11: [1], // plugin-lifecycle
  12: [1], // enrollment-lifecycle
};

/** Lazily discovered test maps — cached after first call. */
let _singleVmTests = null;
let _threeVmTests = null;

/** Get the single-VM test file map. Auto-discovered and cached. */
export function getSingleVmTests() {
  if (!_singleVmTests) _singleVmTests = discoverTests(SINGLE_VM_DIR);
  return _singleVmTests;
}

/** Get the three-VM test file map. Auto-discovered and cached. */
export function getThreeVmTests() {
  if (!_threeVmTests) _threeVmTests = discoverTests(THREE_VM_DIR);
  return _threeVmTests;
}

/** Invalidate cached test maps (e.g. after adding new tests). */
export function clearTestCache() {
  _singleVmTests = null;
  _threeVmTests = null;
}

/**
 * Resolve the full dependency chain for a given test number.
 * Returns a sorted array of test numbers that must run (including the target).
 */
export function resolveDeps(testNumber, depGraph) {
  const visited = new Set();
  const order = [];

  function walk(n) {
    if (visited.has(n)) return;
    visited.add(n);
    const deps = depGraph[n] || [];
    for (const dep of deps) {
      walk(dep);
    }
    order.push(n);
  }

  walk(testNumber);
  return order.sort((a, b) => a - b);
}

/**
 * Given a target test, return the minimal set of test filenames to run.
 */
export function resolveTestChain(testNumber, suite = 'three-vm') {
  const depGraph = suite === 'single-vm' ? SINGLE_VM_DEPS : THREE_VM_DEPS;
  const testMap = suite === 'single-vm' ? getSingleVmTests() : getThreeVmTests();

  const chain = resolveDeps(testNumber, depGraph);
  return chain
    .map((n) => ({ number: n, file: testMap[n] }))
    .filter((t) => t.file);
}

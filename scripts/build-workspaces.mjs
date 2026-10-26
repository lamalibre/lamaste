/**
 * Builds every workspace that has a `build` script, each after the
 * workspaces it depends on.
 *
 * `npm run --workspaces build` runs them in the order of the `workspaces`
 * globs, i.e. by folder name, and never by dependency: once the panel UI
 * imported `@lamalibre/lamaste/domains`, a clean checkout built the desktop
 * app (which bundles the panel UI's sources) before the core library had
 * a `dist/`, and failed. The order here comes from each workspace's own
 * `dependencies`, `devDependencies` and `peerDependencies` on another
 * workspace; ties keep the folder order. A dependency cycle is refused.
 *
 *   node scripts/build-workspaces.mjs
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The workspace folders the root `workspaces` globs name (`dir/*` segments only). */
function workspaceDirs() {
  const { workspaces } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const dirs = [];
  for (const pattern of workspaces) {
    let found = [root];
    for (const segment of pattern.split('/')) {
      found = found.flatMap((dir) => {
        if (segment !== '*') return existsSync(join(dir, segment)) ? [join(dir, segment)] : [];
        return readdirSync(dir, { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => join(dir, entry.name))
          .sort();
      });
    }
    dirs.push(...found.filter((dir) => existsSync(join(dir, 'package.json'))));
  }
  return dirs;
}

/**
 * Workspaces in dependency order.
 *
 * @param {Array<{ name: string, dir: string, deps: string[] }>} packages in folder order
 * @returns {Array<{ name: string, dir: string, deps: string[] }>}
 */
export function dependencyOrder(packages) {
  const byName = new Map(packages.map((pkg) => [pkg.name, pkg]));
  const ordered = [];
  const state = new Map(); // name -> 'visiting' | 'done'
  const visit = (pkg, path) => {
    if (state.get(pkg.name) === 'done') return;
    if (state.get(pkg.name) === 'visiting') {
      throw new Error(`Workspace dependency cycle: ${[...path, pkg.name].join(' -> ')}`);
    }
    state.set(pkg.name, 'visiting');
    for (const dep of pkg.deps) {
      const target = byName.get(dep);
      if (target) visit(target, [...path, pkg.name]);
    }
    state.set(pkg.name, 'done');
    ordered.push(pkg);
  };
  for (const pkg of packages) visit(pkg, []);
  return ordered;
}

function main() {
  const packages = workspaceDirs().map((dir) => {
    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    const deps = Object.keys({
      ...manifest.dependencies,
      ...manifest.devDependencies,
      ...manifest.peerDependencies,
    });
    return { name: manifest.name, dir, deps, build: Boolean(manifest.scripts?.build) };
  });
  for (const pkg of dependencyOrder(packages)) {
    if (!pkg.build) continue;
    execFileSync('npm', ['run', 'build', '-w', relative(root, pkg.dir)], {
      cwd: root,
      stdio: 'inherit',
    });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();

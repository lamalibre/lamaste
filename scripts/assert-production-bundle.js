/**
 * Refuses to publish a web bundle that is not a production build.
 *
 * A Vite build inherits `NODE_ENV` from the shell: run with
 * `NODE_ENV=development`, it emits React's development build, whose JSX
 * calls (`jsxDEV`) carry the absolute path of every source file on the
 * machine that built it. create-lamaste up to 4.2 vendored such a panel.
 * The Vite configs now force production for `vite build`; the packing
 * scripts call this as well, so whatever produced a bundle, a development
 * one is never packed.
 *
 *   assertProductionBundle(distDir, { label, monorepoRoot })
 *
 * Throws when `distDir` has no `index.html`, when `index.html` names an
 * asset that is not there, or when a JavaScript asset contains `jsxDEV` or
 * the monorepo's absolute path. As a command (a package's "prepack"):
 *
 *   node scripts/assert-production-bundle.js <distDir> [label]
 */

import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

async function listFiles(dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(path)));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

/**
 * @param {string} distDir
 * @param {{ label: string, monorepoRoot: string }} opts
 */
export async function assertProductionBundle(distDir, { label, monorepoRoot }) {
  const indexHtml = join(distDir, 'index.html');
  if (!existsSync(indexHtml)) {
    throw new Error(`${label}: ${indexHtml} not found. Run "npm run build" first.`);
  }

  const html = await readFile(indexHtml, 'utf8');
  for (const [, ref] of html.matchAll(/(?:src|href)="\/?(assets\/[^"]+)"/g)) {
    if (!existsSync(join(distDir, ref))) {
      throw new Error(`${label}: index.html names ${ref}, which the build did not produce.`);
    }
  }

  for (const file of await listFiles(distDir)) {
    if (!file.endsWith('.js')) continue;
    const code = await readFile(file, 'utf8');
    const name = relative(distDir, file);
    if (code.includes('jsxDEV')) {
      throw new Error(
        `${label}: ${name} is a development build (jsxDEV). Rebuild with "npm run build".`,
      );
    }
    if (code.includes(monorepoRoot)) {
      throw new Error(`${label}: ${name} contains this machine's source path (${monorepoRoot}).`);
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [distDir, label = distDir] = process.argv.slice(2);
  if (!distDir) {
    console.error('usage: node scripts/assert-production-bundle.js <distDir> [label]');
    process.exit(2);
  }
  const monorepoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
  assertProductionBundle(resolve(distDir), { label, monorepoRoot }).catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

/**
 * Bundles sibling monorepo packages into vendor/ so that create-portlama
 * works standalone when installed via npx (outside the monorepo).
 *
 * Run automatically via the "prepublishOnly" npm script.
 */

import { cp, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const thisDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(thisDir, '..');
const monorepoRoot = join(packageRoot, '..', '..');
const vendorDir = join(packageRoot, 'vendor');

async function main() {
  // Clean vendor/ if it exists, then recreate
  await rm(vendorDir, { recursive: true, force: true });
  await mkdir(vendorDir, { recursive: true });

  // --- panel-server: package.json + src/ ---
  const serverSrc = join(monorepoRoot, 'packages', 'panel-server');
  if (!existsSync(serverSrc)) {
    throw new Error(
      `panel-server not found at ${serverSrc}. Run from the monorepo root.`,
    );
  }

  const serverDest = join(vendorDir, 'panel-server');
  await mkdir(serverDest, { recursive: true });
  await cp(join(serverSrc, 'package.json'), join(serverDest, 'package.json'));
  await cp(join(serverSrc, 'src'), join(serverDest, 'src'), {
    recursive: true,
  });

  console.log('Bundled vendor/panel-server (package.json + src/)');

  // --- panel-client: dist/ (pre-built assets) ---
  const clientDist = join(monorepoRoot, 'packages', 'panel-client', 'dist');
  if (!existsSync(clientDist)) {
    throw new Error(
      `panel-client/dist/ not found at ${clientDist}. Run "npm run build" first.`,
    );
  }

  const clientDest = join(vendorDir, 'panel-client');
  await mkdir(join(clientDest, 'dist'), { recursive: true });
  await cp(clientDist, join(clientDest, 'dist'), { recursive: true });

  console.log('Bundled vendor/panel-client (dist/)');

  console.log('Vendor bundling complete.');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

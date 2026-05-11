/**
 * Bundles sibling monorepo packages into vendor/ so that create-lamaste
 * works standalone when installed via npx (outside the monorepo).
 *
 * Run automatically via the "prepublishOnly" npm script.
 */

import { cp, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const thisDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(thisDir, '..');
const monorepoRoot = join(packageRoot, '..', '..', '..');
const vendorDir = join(packageRoot, 'vendor');

async function main() {
  // Clean vendor/ if it exists, then recreate
  await rm(vendorDir, { recursive: true, force: true });
  await mkdir(vendorDir, { recursive: true });

  // --- lamaste-serverd: package.json + src/ ---
  const serverSrc = join(monorepoRoot, 'packages', 'server', 'daemon');
  if (!existsSync(serverSrc)) {
    throw new Error(`lamaste-serverd not found at ${serverSrc}. Run from the monorepo root.`);
  }

  const serverDest = join(vendorDir, 'serverd');
  await mkdir(serverDest, { recursive: true });
  await cp(join(serverSrc, 'package.json'), join(serverDest, 'package.json'));
  await cp(join(serverSrc, 'src'), join(serverDest, 'src'), {
    recursive: true,
  });

  console.log('Bundled vendor/serverd from lamaste-serverd (package.json + src/)');

  // --- lamaste-server: server operational CLI (package.json + bin/ + src/) ---
  // The 2.0 refactor split the CLI out of the daemon; this CLI owns
  // `lamaste-server reset-admin` (the recovery path that also supplies the
  // legacy `lamaste-reset-admin` binary via symlink at install time).
  const serverCliSrc = join(monorepoRoot, 'packages', 'server', 'cli');
  if (!existsSync(serverCliSrc)) {
    throw new Error(`lamaste-server CLI not found at ${serverCliSrc}. Run from the monorepo root.`);
  }
  const serverCliDest = join(vendorDir, 'server');
  await mkdir(serverCliDest, { recursive: true });
  await cp(join(serverCliSrc, 'package.json'), join(serverCliDest, 'package.json'));
  await cp(join(serverCliSrc, 'bin'), join(serverCliDest, 'bin'), { recursive: true });
  await cp(join(serverCliSrc, 'src'), join(serverCliDest, 'src'), { recursive: true });
  console.log('Bundled vendor/server from lamaste-server CLI (package.json + bin/ + src/)');

  // --- lamaste-server-ui: dist/ (pre-built assets) ---
  const clientDist = join(monorepoRoot, 'packages', 'server', 'ui', 'dist');
  if (!existsSync(clientDist)) {
    throw new Error(`lamaste-server-ui/dist/ not found at ${clientDist}. Run "npm run build" first.`);
  }

  const clientDest = join(vendorDir, 'server-ui');
  await mkdir(join(clientDest, 'dist'), { recursive: true });
  await cp(clientDist, join(clientDest, 'dist'), { recursive: true });

  console.log('Bundled vendor/server-ui (dist/)');

  // --- gatekeeper: package.json + dist/ (compiled TypeScript) ---
  const gatekeeperSrc = join(monorepoRoot, 'packages', 'sdks', 'gatekeeper');
  const gatekeeperDist = join(gatekeeperSrc, 'dist');
  if (existsSync(gatekeeperDist)) {
    const gatekeeperDest = join(vendorDir, 'gatekeeper');
    await mkdir(gatekeeperDest, { recursive: true });
    await cp(join(gatekeeperSrc, 'package.json'), join(gatekeeperDest, 'package.json'));
    await cp(gatekeeperDist, join(gatekeeperDest, 'dist'), { recursive: true });
    console.log('Bundled vendor/gatekeeper (package.json + dist/)');
  } else {
    console.log('Skipped vendor/gatekeeper (dist/ not found — run "npm run build" first)');
  }

  // --- docs: version-stamped markdown ---
  const docsStampScript = join(monorepoRoot, 'packages', 'core', 'docs', 'scripts', 'version-stamp.js');
  if (existsSync(docsStampScript)) {
    const docsDest = join(vendorDir, 'docs');
    execFileSync('node', [docsStampScript, docsDest], {
      cwd: monorepoRoot,
      stdio: 'inherit',
    });
    console.log('Bundled vendor/docs (version-stamped)');
  } else {
    console.log('Skipped vendor/docs (version-stamp script not found)');
  }

  console.log('Vendor bundling complete.');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

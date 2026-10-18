/**
 * Copies the agent panel SPA — lamaste-agent-ui's web build (`dist-web/`,
 * produced by `npm run build`) — into panel-dist/, which lamaste-agentd
 * serves. Runs before every `npm pack` / `npm publish` (the "prepack"
 * script): panel-dist/ is emptied first, so a packed daemon never carries
 * stale assets, and a development build is refused. Progress goes to
 * stderr: `npm pack --json` prints its JSON on stdout.
 */

import { cp, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertProductionBundle } from '../../../../scripts/assert-production-bundle.js';

const thisDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(thisDir, '..');
const monorepoRoot = join(packageRoot, '..', '..', '..');
const webBuild = join(monorepoRoot, 'packages', 'agent', 'ui', 'dist-web');
const panelDist = join(packageRoot, 'panel-dist');

async function main() {
  await assertProductionBundle(webBuild, { label: 'lamaste-agent-ui/dist-web', monorepoRoot });
  await rm(panelDist, { recursive: true, force: true });
  await cp(webBuild, panelDist, { recursive: true });
  console.error('Bundled panel-dist/ from lamaste-agent-ui (dist-web/)');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

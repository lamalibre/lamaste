/**
 * Version-stamp script for server-bundled documentation.
 *
 * Replaces bare @lamalibre/<pkg> references in markdown files with
 * @lamalibre/<pkg>@<version> using the actual version from each package's
 * package.json.
 *
 * Usage:
 *   node scripts/version-stamp.js <output-dir>
 *
 * The script copies all docs (markdown + _index.json) into <output-dir>,
 * replacing package references with versioned ones. The source files are
 * never modified.
 *
 * On GitHub Pages, deploy the raw source docs (no stamping) so references
 * stay as @lamalibre/<pkg> — npm resolves to latest.
 */

import { readdir, readFile, writeFile, mkdir, cp } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const thisDir = dirname(fileURLToPath(import.meta.url));
const docsRoot = join(thisDir, '..');
const monorepoRoot = resolve(docsRoot, '..', '..', '..');

const outputDir = process.argv[2];
if (!outputDir) {
  console.error('Usage: node scripts/version-stamp.js <output-dir>');
  process.exit(1);
}

/**
 * Discover all @lamalibre/* packages and their versions by scanning the
 * monorepo workspace.
 */
async function discoverPackageVersions() {
  const versions = new Map();
  const groups = ['core', 'agent', 'server', 'desktop', 'sdks', 'provisioners', 'tools'];

  for (const group of groups) {
    const groupDir = join(monorepoRoot, 'packages', group);
    if (!existsSync(groupDir)) continue;

    const entries = await readdir(groupDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const pkgJsonPath = join(groupDir, entry.name, 'package.json');
      if (!existsSync(pkgJsonPath)) continue;

      const pkgJson = JSON.parse(await readFile(pkgJsonPath, 'utf8'));
      if (pkgJson.name?.startsWith('@lamalibre/')) {
        versions.set(pkgJson.name, pkgJson.version);
      }
    }
  }

  return versions;
}

/**
 * Build a regex that matches @lamalibre/<pkg> but NOT already-versioned
 * @lamalibre/<pkg>@<version>.
 */
function buildReplaceRegex(versions) {
  // Sort by name length descending so longer names match first
  const names = [...versions.keys()].sort((a, b) => b.length - a.length);
  // Escape the @ in package names for regex
  const escaped = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  // Match the package name NOT followed by @ (to avoid double-stamping)
  return new RegExp(`(${escaped.join('|')})(?!@)`, 'g');
}

/**
 * Recursively process all markdown files in a directory.
 */
async function processDir(srcDir, destDir, regex, versions) {
  await mkdir(destDir, { recursive: true });
  const entries = await readdir(srcDir, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = join(srcDir, entry.name);
    const destPath = join(destDir, entry.name);

    if (entry.isDirectory()) {
      // Skip scripts directory
      if (entry.name === 'scripts' || entry.name === 'node_modules') continue;
      await processDir(srcPath, destPath, regex, versions);
    } else if (entry.name.endsWith('.md')) {
      let content = await readFile(srcPath, 'utf8');
      content = content.replace(regex, (match) => {
        const version = versions.get(match);
        return version ? `${match}@${version}` : match;
      });
      await writeFile(destPath, content);
    } else {
      // Copy non-markdown files as-is (_index.json, etc.)
      await cp(srcPath, destPath);
    }
  }
}

async function main() {
  const versions = await discoverPackageVersions();
  console.log(`Discovered ${versions.size} @lamalibre packages`);

  const regex = buildReplaceRegex(versions);
  const resolvedOutput = resolve(outputDir);

  await processDir(docsRoot, resolvedOutput, regex, versions);
  console.log(`Version-stamped docs written to ${resolvedOutput}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

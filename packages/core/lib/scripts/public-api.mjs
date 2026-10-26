/**
 * The public API of `@lamalibre/lamaste`: every name — value or type — that
 * each subpath export (`.`, `./agent`, `./server`, ...) declares in its built
 * `.d.ts`, read with the TypeScript checker.
 *
 * Plugins and a relay's own panel depend on this package with a caret range,
 * so a minor release must never take a name away: a 4.6 serverd that
 * resolves core 4.7 imports what 4.6 exported. `public-api.json` holds the
 * names of the latest release; test/public-api.test.js fails when the build
 * lacks one of them. A release adds its new names with
 *
 *   node scripts/public-api.mjs --write
 *
 * (after `npm run build`), which only ever grows the file within a major.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

export const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const SNAPSHOT = join(PACKAGE_DIR, 'public-api.json');

/**
 * @param {string} [packageDir]
 * @returns {Record<string, string[]>} subpath -> sorted exported names
 */
export function exportedNames(packageDir = PACKAGE_DIR) {
  const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
  /** @type {Record<string, string[]>} */
  const names = {};
  for (const [subpath, target] of Object.entries(manifest.exports)) {
    const types = typeof target === 'object' && target !== null ? target.types : undefined;
    if (typeof types !== 'string') continue;
    const file = resolve(packageDir, types);
    const program = ts.createProgram([file], { noEmit: true, skipLibCheck: true });
    const source = program.getSourceFile(file);
    if (!source) throw new Error(`${subpath}: ${types} is not built (run npm run build)`);
    const checker = program.getTypeChecker();
    const moduleSymbol = checker.getSymbolAtLocation(source);
    names[subpath] = moduleSymbol
      ? checker
          .getExportsOfModule(moduleSymbol)
          .map((symbol) => symbol.name)
          .sort()
      : [];
  }
  return names;
}

/**
 * The names the snapshot holds that the build does not export.
 *
 * @param {Record<string, string[]>} snapshot
 * @param {Record<string, string[]>} current
 * @returns {string[]} `subpath name` entries
 */
export function missingNames(snapshot, current) {
  const missing = [];
  for (const [subpath, list] of Object.entries(snapshot)) {
    const have = new Set(current[subpath] ?? []);
    for (const name of list) if (!have.has(name)) missing.push(`${subpath} ${name}`);
  }
  return missing;
}

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv.includes('--write')) {
  const current = exportedNames();
  const snapshot = JSON.parse(readFileSync(SNAPSHOT, 'utf8').trim() || '{}');
  const missing = missingNames(snapshot, current);
  if (missing.length > 0) {
    throw new Error(
      `The build no longer exports ${missing.join(', ')}; restore them before a minor release`,
    );
  }
  writeFileSync(SNAPSHOT, `${JSON.stringify(current, null, 2)}\n`);
}

#!/usr/bin/env node
// Pack one release of this repository's @lamalibre packages — the bytes
// that are attached to the GitHub Release (the durable copy) and published
// to Feria by publish-to-feria.mjs. Run after `npm ci && npm run build` at
// the release tag:
//
//   node .github/scripts/pack-release.mjs <version> --out <dir>
//
// Every release package (release-packages.mjs) must be at <version>. Each is
// packed with `npm pack --workspace` (its prepack runs: create-lamaste
// bundles its vendor/, agentd its panel); the integrity npm reports must
// match the bytes written. <dir> receives the tarballs and
// release-manifest.json:
//
//   { "version": "4.14.0", "packages": [ { "name", "version", "file",
//     "integrity", "shasum", "size" } ] }

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  MANIFEST,
  VERSION_RE,
  integrityOf,
  releasePackages,
  shasumOf,
  tarballManifest,
} from './release-packages.mjs';

let version;
let out;
for (const args = process.argv.slice(2); args.length > 0; ) {
  const arg = args.shift();
  if (arg === '--out') out = args.shift();
  else if (version === undefined) version = arg;
  else version = null;
}
if (!version || !VERSION_RE.test(version) || !out) {
  console.error('usage: pack-release.mjs <version> --out <dir>');
  process.exit(2);
}
out = path.resolve(out);
mkdirSync(out, { recursive: true });
if (readdirSync(out).length > 0) {
  console.error(`${out} is not empty — pack a release into an empty directory`);
  process.exit(2);
}

const packages = releasePackages();
const wrong = packages.filter((p) => p.version !== version);
if (wrong.length > 0) {
  for (const p of wrong)
    console.log(`::error::${p.name} (${p.dir}) is at ${p.version}, not ${version}`);
  process.exit(1);
}

const manifest = { version, packages: [] };
for (const { name, dir } of packages) {
  // stdout is npm's JSON; prepack scripts report on stderr.
  const stdout = execFileSync(
    'npm',
    ['pack', `--workspace=${dir}`, '--pack-destination', out, '--json'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
  );
  const [packed] = JSON.parse(stdout);
  const file = path.join(out, packed.filename);
  const bytes = readFileSync(file);
  const integrity = integrityOf(bytes);
  if (packed.integrity !== integrity) {
    console.log(`::error::${name}: npm reported ${packed.integrity}, the file is ${integrity}`);
    process.exit(1);
  }
  const inside = tarballManifest(bytes);
  if (inside.name !== name || inside.version !== version) {
    console.log(`::error::${packed.filename} carries ${inside.name}@${inside.version}`);
    process.exit(1);
  }
  manifest.packages.push({
    name,
    version,
    file: packed.filename,
    integrity,
    shasum: shasumOf(bytes),
    size: bytes.length,
  });
  console.log(`packed ${name}@${version} ${packed.filename} ${integrity}`);
}
writeFileSync(path.join(out, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`${manifest.packages.length} packages and ${MANIFEST} in ${out}`);

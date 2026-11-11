#!/usr/bin/env node
// Publish one release of this repository's @lamalibre packages to Feria —
// the tarballs pack-release.mjs wrote at the release tag (the GitHub
// Release's assets), byte for byte. Feria is where Lamaste installs itself
// from; npmjs is not a source any more (since 4.14).
//
//   FERIA_URL=https://feria.codelama.com.tr \
//     node .github/scripts/publish-to-feria.mjs <version> --dir <dir> --npmrc <file> [--dry-run]
//
// Feria's address comes from FERIA_URL — the workflow's `env` names it once
// (there is no default here, so the two can never disagree). The token is
// read from the `//<feria-host>/:_authToken=` line of the given npmrc file
// and never printed.
//
// <dir> holds the release's tarballs and release-manifest.json. Checked
// before anything is published:
//   - the manifest is of <version> and lists exactly this checkout's release
//     packages (release-packages.mjs), each at <version>
//   - every tarball's bytes match the manifest's integrity, and the
//     package.json inside names that package at <version>
// Then, for each package:
//   - Feria holds <version> with the same integrity → already published
//   - Feria holds <version> with another integrity  → error (Feria lets a
//     version be overwritten; a released version is never replaced here)
//   - otherwise → npm publish the tarball; Feria must then report the same
//     integrity
// The dist-tag: `next` for a prerelease; `latest` unless Feria's latest is a
// newer release (a patch of an older line gets `release-<major>.<minor>`).
// Zero dependencies (Node 22).

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  MANIFEST,
  VERSION_RE,
  integrityOf,
  releasePackages,
  tarballManifest,
} from './release-packages.mjs';

if (!process.env.FERIA_URL || !/^https?:\/\/[^/\s]+\/?$/.test(process.env.FERIA_URL)) {
  console.error(
    'FERIA_URL must name the registry as https://<host> (the workflow sets it; by hand, export it)',
  );
  process.exit(2);
}
const FERIA = process.env.FERIA_URL.replace(/\/$/, '');
if (FERIA.startsWith('http://') && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(FERIA)) {
  console.error('FERIA_URL may be plain http only to this machine (a local test registry)');
  process.exit(2);
}

let version;
let dir;
let npmrc;
let dryRun = false;
for (const args = process.argv.slice(2); args.length > 0; ) {
  const arg = args.shift();
  if (arg === '--dir') dir = args.shift();
  else if (arg === '--npmrc') npmrc = args.shift();
  else if (arg === '--dry-run') dryRun = true;
  else if (version === undefined) version = arg;
  else version = null;
}
if (!version || !VERSION_RE.test(version) || !dir || !npmrc) {
  console.error(
    'usage: FERIA_URL=https://<host> publish-to-feria.mjs <version> --dir <dir> --npmrc <file> [--dry-run]',
  );
  process.exit(2);
}
dir = path.resolve(dir);

const feriaHost = new URL(FERIA).host;
const tokenLine = readFileSync(npmrc, 'utf8')
  .split('\n')
  .find((l) => l.startsWith(`//${feriaHost}/:_authToken=`));
if (!tokenLine) {
  console.error(`${npmrc} has no token for ${feriaHost}`);
  process.exit(2);
}
const feriaToken = tokenLine.slice(tokenLine.indexOf('=') + 1).trim();

const encode = (name) => name.replace('/', '%2f');

async function packument(name) {
  const res = await fetch(`${FERIA}/${encode(name)}`, {
    headers: { accept: 'application/json', authorization: `Bearer ${feriaToken}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${FERIA} answered HTTP ${res.status} for ${name}`);
  return res.json();
}

/** -1, 0 or 1 for two plain `MAJOR.MINOR.PATCH` versions. */
function compareRelease(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return 0;
}

/** The dist-tag `version` is published under, given Feria's current `latest`. */
function distTag(current) {
  if (version.includes('-')) return 'next';
  if (typeof current !== 'string' || !/^\d+\.\d+\.\d+$/.test(current)) return 'latest';
  if (compareRelease(version, current) >= 0) return 'latest';
  const [major, minor] = version.split('.');
  return `release-${major}.${minor}`;
}

// --- Check the release as a whole before publishing any of it ---------------

const errors = [];
const manifest = JSON.parse(readFileSync(path.join(dir, MANIFEST), 'utf8'));
if (manifest.version !== version) {
  console.log(`::error::${MANIFEST} is of ${manifest.version}, not ${version}`);
  process.exit(1);
}
const expected = releasePackages();
const listed = new Map((manifest.packages ?? []).map((p) => [p.name, p]));
for (const { name, version: local, dir: pkgDir } of expected) {
  if (local !== version) errors.push(`${name} (${pkgDir}) is at ${local}, not ${version}`);
  if (!listed.has(name)) errors.push(`${name} is missing from ${MANIFEST}`);
}
for (const name of listed.keys()) {
  if (!expected.some((p) => p.name === name))
    errors.push(`${MANIFEST} lists ${name}, not a release package`);
}
const tarballs = new Map();
for (const entry of listed.values()) {
  if (entry.version !== version || path.basename(entry.file) !== entry.file) {
    errors.push(`${MANIFEST} entry of ${entry.name} is malformed`);
    continue;
  }
  let bytes;
  try {
    bytes = readFileSync(path.join(dir, entry.file));
  } catch {
    errors.push(`${entry.file} is missing`);
    continue;
  }
  if (integrityOf(bytes) !== entry.integrity) {
    errors.push(`${entry.file} does not match its integrity in ${MANIFEST}`);
    continue;
  }
  const inside = tarballManifest(bytes);
  if (inside.name !== entry.name || inside.version !== version) {
    errors.push(
      `${entry.file} carries ${inside.name}@${inside.version}, not ${entry.name}@${version}`,
    );
    continue;
  }
  tarballs.set(entry.name, bytes);
}
if (errors.length > 0) {
  for (const e of errors) console.log(`::error::${e}`);
  process.exit(1);
}

// --- Publish ------------------------------------------------------------------

const work = mkdtempSync(path.join(tmpdir(), 'feria-publish-'));
const publishrc = path.join(work, 'npmrc');
writeFileSync(publishrc, `//${feriaHost}/:_authToken=${feriaToken}\n`, { mode: 0o600 });

try {
  for (const entry of listed.values()) {
    const { name, integrity } = entry;
    const feria = await packument(name);
    const held = feria?.versions?.[version]?.dist?.integrity;
    if (held === integrity) {
      console.log(`= ${name}@${version} already on Feria`);
      continue;
    }
    if (held !== undefined) {
      errors.push(`${name}@${version} is on Feria with a different integrity — not replacing it`);
      continue;
    }
    const tag = distTag(feria?.['dist-tags']?.latest);
    if (dryRun) {
      console.log(`~ ${name}@${version} would be published to Feria (tag ${tag})`);
      continue;
    }
    // Absolute on purpose: npm reads a bare "dir/x.tgz" as a GitHub user/repo.
    const file = path.join(work, entry.file);
    writeFileSync(file, tarballs.get(name));
    execFileSync(
      'npm',
      [
        'publish',
        file,
        '--registry',
        `${FERIA}/`,
        '--userconfig',
        publishrc,
        '--tag',
        tag,
        '--access',
        'public',
        '--ignore-scripts',
      ],
      { stdio: ['ignore', 'ignore', 'inherit'] },
    );
    const after = await packument(name);
    if (after?.versions?.[version]?.dist?.integrity !== integrity) {
      errors.push(
        `${name}@${version}: Feria does not report the release's integrity after publishing`,
      );
      continue;
    }
    console.log(`+ ${name}@${version} published to Feria (tag ${tag})`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}

if (errors.length > 0) {
  for (const e of errors) console.log(`::error::${e}`);
  process.exit(1);
}

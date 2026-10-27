#!/usr/bin/env node
// Copy one release of this repository's @lamalibre packages from npmjs to
// Feria, byte for byte.
//
//   FERIA_URL=https://feria.codelama.com.tr \
//     node .github/scripts/mirror-to-feria.mjs <version> --npmrc <file> [--dry-run]
//
// Feria's address comes from FERIA_URL — the workflow's `env` names it
// once for the job and the script (there is no default here, so the two
// can never disagree); a run by hand sets it as above, with the token in
// `~/.npmrc` (`//<feria-host>/:_authToken=`).
//
// Releases are published to npmjs by hand; Feria serves @lamalibre as a
// closed scope (it never falls back to npmjs), so every release must also
// land there. The package set is every package.json tracked in this
// repository that is named @lamalibre/*, not private, and not pinned to
// another registry by publishConfig.registry.
//
// For each package:
//   - never published to npmjs at all      → warning, skipped
//   - on npmjs, but not at <version>       → error (an incomplete release)
//   - npmjs tarball fails its integrity    → error
//   - Feria holds <version> with the same integrity → already mirrored
//   - Feria holds <version> with another integrity  → error (Feria lets a
//     version be overwritten; a released version is never replaced here)
//   - otherwise                            → npm publish the npmjs tarball
//
// The Feria token is read from the `//<feria-host>/:_authToken=` line of
// the given npmrc file and never printed. Zero dependencies (Node 22).

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const NPMJS = 'https://registry.npmjs.org';
if (!process.env.FERIA_URL || !/^https:\/\/[^/\s]+\/?$/.test(process.env.FERIA_URL)) {
  console.error(
    'FERIA_URL must name the registry as https://<host> (the workflow sets it; by hand, export it)',
  );
  process.exit(2);
}
const FERIA = process.env.FERIA_URL.replace(/\/$/, '');

let version;
let npmrc;
let dryRun = false;
for (const args = process.argv.slice(2); args.length > 0; ) {
  const arg = args.shift();
  if (arg === '--npmrc') npmrc = args.shift();
  else if (arg === '--dry-run') dryRun = true;
  else if (version === undefined) version = arg;
  else version = null;
}
if (!version || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version) || !npmrc) {
  console.error(
    'usage: FERIA_URL=https://<host> mirror-to-feria.mjs <version> --npmrc <file> [--dry-run]',
  );
  process.exit(2);
}

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

async function packument(base, name, headers = {}) {
  const res = await fetch(`${base}/${encode(name)}`, {
    headers: { accept: 'application/json', ...headers },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${base} answered HTTP ${res.status} for ${name}`);
  return res.json();
}

function releasePackages() {
  const files = execFileSync('git', ['ls-files', '*package.json', 'package.json'], {
    encoding: 'utf8',
  })
    .split('\n')
    .filter((f) => f && !f.includes('node_modules/'));
  const found = [];
  for (const file of files) {
    const pkg = JSON.parse(readFileSync(file, 'utf8'));
    if (typeof pkg.name !== 'string' || !pkg.name.startsWith('@lamalibre/')) continue;
    if (pkg.private === true || pkg.publishConfig?.registry) continue;
    found.push({ name: pkg.name, version: pkg.version, dir: path.dirname(file) });
  }
  return found.sort((a, b) => a.name.localeCompare(b.name));
}

const packages = releasePackages();
const errors = [];
const work = mkdtempSync(path.join(tmpdir(), 'mirror-'));
const publishrc = path.join(work, 'npmrc');
writeFileSync(publishrc, `//${feriaHost}/:_authToken=${feriaToken}\n`, { mode: 0o600 });

try {
  for (const { name, version: localVersion, dir } of packages) {
    if (localVersion !== version) {
      errors.push(`${name} (${dir}) is at ${localVersion}, not ${version}`);
      continue;
    }
    const npm = await packument(NPMJS, name);
    if (npm === null) {
      console.log(`::warning::${name} has never been published to npmjs — skipped`);
      continue;
    }
    const meta = npm.versions?.[version];
    if (!meta) {
      errors.push(`${name}@${version} is not on npmjs (an incomplete release?)`);
      continue;
    }

    const feria = await packument(FERIA, name, { authorization: `Bearer ${feriaToken}` });
    const held = feria?.versions?.[version]?.dist?.integrity;
    if (held === meta.dist.integrity) {
      console.log(`= ${name}@${version} already on Feria`);
      continue;
    }
    if (held !== undefined) {
      errors.push(`${name}@${version} is on Feria with a different integrity — not replacing it`);
      continue;
    }

    const res = await fetch(meta.dist.tarball);
    if (!res.ok) {
      errors.push(`${name}@${version}: npmjs tarball answered HTTP ${res.status}`);
      continue;
    }
    const tarball = Buffer.from(await res.arrayBuffer());
    const integrity = `sha512-${createHash('sha512').update(tarball).digest('base64')}`;
    if (integrity !== meta.dist.integrity) {
      errors.push(`${name}@${version}: npmjs tarball does not match its integrity`);
      continue;
    }

    // npm needs a tag; use the npmjs dist-tag that points at this version.
    const tag =
      Object.entries(npm['dist-tags'] ?? {}).find(([, v]) => v === version)?.[0] ?? 'backfill';
    if (dryRun) {
      console.log(`~ ${name}@${version} would be published to Feria (tag ${tag})`);
      continue;
    }
    // Absolute on purpose: npm reads a bare "dir/x.tgz" as a GitHub user/repo.
    const file = path.join(work, `${encode(name)}-${version}.tgz`);
    writeFileSync(file, tarball);
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
      ],
      { stdio: ['ignore', 'ignore', 'inherit'] },
    );
    const after = await packument(FERIA, name, { authorization: `Bearer ${feriaToken}` });
    if (after?.versions?.[version]?.dist?.integrity !== meta.dist.integrity) {
      errors.push(`${name}@${version}: Feria does not report the npmjs integrity after publishing`);
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

/**
 * A stand-in `npm` for tests of the panel's package handling: it answers
 * `view <pkg>@<v> dist.integrity --json`, `install`, `uninstall` and `pack`
 * from a registry the test describes, and logs every call (arguments and
 * working directory) so a test can check exactly what the panel ran.
 *
 * `installFakeNpm(dir)` writes the script, puts it first on PATH for this
 * test process (each test file runs in its own), and returns the controls.
 */

import { appendFileSync, readFileSync } from 'node:fs';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const SCRIPT = String.raw`#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const root = process.env.LAMASTE_TEST_FAKE_NPM;
const reg = JSON.parse(fs.readFileSync(path.join(root, 'registry.json'), 'utf8'));
const args = process.argv.slice(2);
fs.appendFileSync(
  path.join(root, 'calls.log'),
  JSON.stringify({ args, cwd: process.cwd() }) + '\n',
);
const cmd = args[0];
const valueFlags = new Set(['--pack-destination']);
const positional = [];
for (let i = 1; i < args.length; i++) {
  if (valueFlags.has(args[i])) i++;
  else if (!args[i].startsWith('--')) positional.push(args[i]);
}

function resolveSpec(spec) {
  const at = spec.indexOf('@', 1);
  const name = at === -1 ? spec : spec.slice(0, at);
  const wanted = at === -1 ? 'latest' : spec.slice(at + 1);
  const version = (reg.distTags[name] || {})[wanted] || wanted;
  return { name, version, key: name + '@' + version };
}

function notFound(spec) {
  process.stderr.write('npm error code E404\nnpm error 404 ' + spec + ' could not be found\n');
  process.stdout.write(JSON.stringify({ error: { code: 'E404', summary: 'No match for ' + spec } }) + '\n');
  process.exit(1);
}

function tarHeader(name, size) {
  const h = Buffer.alloc(512, 0);
  h.write(name, 0, 100, 'utf8');
  h.write('0000644\0', 100);
  h.write('0000000\0', 108);
  h.write('0000000\0', 116);
  h.write(size.toString(8).padStart(11, '0') + '\0', 124);
  h.write('00000000000\0', 136);
  h.write('        ', 148);
  h.write('0', 156);
  h.write('ustar\0', 257);
  h.write('00', 263);
  let sum = 0;
  for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
  return h;
}

function tgz(files) {
  const parts = [];
  for (const [file, content] of Object.entries(files)) {
    const data = Buffer.from(content);
    parts.push(tarHeader('package/' + file, data.length), data);
    parts.push(Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  parts.push(Buffer.alloc(1024));
  return zlib.gzipSync(Buffer.concat(parts));
}

function writeFiles(dir, files) {
  for (const [file, content] of Object.entries(files)) {
    const target = path.join(dir, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
}

switch (cmd) {
  case 'view': {
    const spec = positional[0];
    if (!Object.prototype.hasOwnProperty.call(reg.integrity, spec)) notFound(spec);
    const value = reg.integrity[spec];
    if (value !== null) process.stdout.write(JSON.stringify(value) + '\n');
    break;
  }
  case 'install': {
    const { name, key } = resolveSpec(positional[0]);
    if (reg.failInstall.includes(key)) {
      process.stderr.write('npm error install of ' + key + ' failed\n');
      process.exit(1);
    }
    const pkg = reg.packages[key];
    if (!pkg) notFound(key);
    const dest = path.join(process.cwd(), 'node_modules', ...name.split('/'));
    fs.rmSync(dest, { recursive: true, force: true });
    writeFiles(dest, pkg.files);
    break;
  }
  case 'uninstall': {
    const name = positional[0];
    fs.rmSync(path.join(process.cwd(), 'node_modules', ...name.split('/')), {
      recursive: true,
      force: true,
    });
    break;
  }
  case 'pack': {
    const { name, version, key } = resolveSpec(positional[0]);
    const pkg = reg.packages[key];
    if (!pkg) notFound(key);
    const dest = args[args.indexOf('--pack-destination') + 1];
    const filename = name.slice(1).replace('/', '-') + '-' + version + '.tgz';
    fs.writeFileSync(path.join(dest, filename), tgz(pkg.files));
    process.stdout.write(JSON.stringify([{ filename, version }]) + '\n');
    break;
  }
  default:
    process.stderr.write('fake npm: unsupported command ' + cmd + '\n');
    process.exit(2);
}
`;

/**
 * @param {string} dir an empty directory of the test's own
 */
export async function installFakeNpm(dir) {
  const binDir = path.join(dir, 'bin');
  await mkdir(binDir, { recursive: true });
  const script = path.join(binDir, 'npm');
  await writeFile(script, SCRIPT);
  await chmod(script, 0o755);
  process.env.LAMASTE_TEST_FAKE_NPM = dir;
  process.env.PATH = `${binDir}${path.delimiter}${process.env.PATH}`;

  const registry = { packages: {}, integrity: {}, distTags: {}, failInstall: [] };
  const registryPath = path.join(dir, 'registry.json');
  const logPath = path.join(dir, 'calls.log');
  const save = () => writeFile(registryPath, JSON.stringify(registry));
  await save();
  appendFileSync(logPath, '');

  return {
    /** Publish `<name>@<version>` with `files` (`package.json` is added). */
    async publish(name, version, files) {
      registry.packages[`${name}@${version}`] = {
        files: { 'package.json': JSON.stringify({ name, version }), ...files },
      };
      registry.distTags[name] = { ...registry.distTags[name], latest: version };
      await save();
    },
    /** What `npm view <spec> dist.integrity` answers: a value, null (no field), or undefined (E404). */
    async setIntegrity(spec, value) {
      if (value === undefined) delete registry.integrity[spec];
      else registry.integrity[spec] = value;
      await save();
    },
    async failInstall(spec, fail = true) {
      registry.failInstall = registry.failInstall.filter((s) => s !== spec);
      if (fail) registry.failInstall.push(spec);
      await save();
    },
    /** Every call so far: `{ args, cwd }`. */
    calls() {
      return readFileSync(logPath, 'utf-8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    },
  };
}

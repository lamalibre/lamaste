#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  generateLocalHostServiceConfig,
  writeLocalHostServiceConfig,
  removeLocalHostServiceConfig,
} from '@lamalibre/lamaste/agent';

import { startLocalPluginHost } from '../src/server.js';

const SELF_PATH = fileURLToPath(import.meta.url);
const DEFAULT_PORT = 9293;

function parsePort(argv, fallback = DEFAULT_PORT) {
  const idx = argv.indexOf('--port');
  if (idx === -1) return fallback;
  const raw = argv[idx + 1];
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    process.stderr.write(`Invalid port: ${raw}\n`);
    process.exit(1);
  }
  return parsed;
}

function printHelp() {
  process.stdout.write(
    `Usage: lamalibre-local-plugin-hostd [options]\n\n` +
      `  (default)                   Start the local plugin host on 127.0.0.1:<port>\n` +
      `  --write-service-config      Write the launchd plist / systemd unit pointing at this binary,\n` +
      `                              then exit. Uses --port for the service port (default ${DEFAULT_PORT}).\n` +
      `  --remove-service-config     Remove the launchd plist / systemd unit, then exit.\n` +
      `  --port <n>                  HTTP port (default ${DEFAULT_PORT})\n` +
      `  --help, -h                  Show this help\n`,
  );
}

async function runWriteServiceConfig(port) {
  const entryPath = path.resolve(SELF_PATH);
  const content = generateLocalHostServiceConfig(entryPath, port);
  await writeLocalHostServiceConfig(content);
  process.stdout.write(
    JSON.stringify({
      event: 'service-config-written',
      entryPath,
      port,
    }) + '\n',
  );
}

async function runRemoveServiceConfig() {
  await removeLocalHostServiceConfig();
  process.stdout.write(JSON.stringify({ event: 'service-config-removed' }) + '\n');
}

async function main() {
  const argv = process.argv.slice(2);

  if (argv.includes('--help') || argv.includes('-h')) {
    printHelp();
    process.exit(0);
  }

  if (argv.includes('--write-service-config')) {
    const port = parsePort(argv);
    await runWriteServiceConfig(port);
    return;
  }

  if (argv.includes('--remove-service-config')) {
    await runRemoveServiceConfig();
    return;
  }

  const port = parsePort(argv);
  await startLocalPluginHost({ port });
}

try {
  await main();
} catch (error) {
  const msg = error instanceof Error ? error.message : 'Unknown error';
  process.stderr.write(`\n  Lamaste Local Plugin Host failed.\n  Error: ${msg}\n\n`);
  process.exit(1);
}

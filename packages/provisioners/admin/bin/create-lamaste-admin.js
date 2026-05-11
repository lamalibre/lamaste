#!/usr/bin/env node

import { upgrade, upgradeJson } from '../src/upgrade.js';

const args = process.argv.slice(2);

if (args.includes('--json')) {
  // Non-interactive NDJSON mode for desktop app integration
  const getArg = (name) => {
    const idx = args.indexOf(name);
    return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : undefined;
  };

  const panelUrl = getArg('--panel-url');
  const p12Path = getArg('--p12-path');
  const outputP12Path = getArg('--output-p12');
  const passwordFile = getArg('--password-file');
  const p12Password = process.env.LAMALIBRE_LAMASTE_P12_PASS;

  if (!panelUrl || !p12Path || !outputP12Path || !p12Password) {
    const line = JSON.stringify({
      event: 'error',
      message: 'Missing required arguments. Usage: create-lamaste-admin --json --panel-url <url> --p12-path <path> --output-p12 <path> [--password-file <path>] (with LAMALIBRE_LAMASTE_P12_PASS env var)',
      recoverable: false,
    });
    process.stdout.write(line + '\n');
    process.exit(1);
  }

  await upgradeJson({ panelUrl, p12Path, p12Password, outputP12Path, passwordFile });
} else {
  try {
    await upgrade();
  } catch (error) {
    console.error('\n');
    console.error('  Lamaste Admin Upgrade failed.');
    console.error(`  Error: ${error.message}`);
    console.error('\n');
    process.exit(1);
  }
}

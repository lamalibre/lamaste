#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { install } from '../src/install.js';

if (process.argv.includes('--version') || process.argv.includes('-v')) {
  const pkg = JSON.parse(
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8'),
  );
  console.log(pkg.version);
  process.exit(0);
}

install().catch((err) => {
  console.error(`\n  Error: ${err.message}\n`);
  process.exit(1);
});

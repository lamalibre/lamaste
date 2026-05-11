#!/usr/bin/env node

import { main } from '../src/index.js';

try {
  await main();
} catch (error) {
  const msg = error instanceof Error ? error.message : 'Unknown error';
  process.stderr.write('\n  Lamaste Agent failed.\n');
  process.stderr.write(`  Error: ${msg}\n\n`);
  process.exit(1);
}

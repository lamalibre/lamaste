#!/usr/bin/env node

import { main } from '../src/index.js';

try {
  await main();
} catch (error) {
  console.error('\n');
  console.error('  Portlama Agent failed.');
  console.error(`  Error: ${error.message}`);
  console.error('\n');
  process.exit(1);
}

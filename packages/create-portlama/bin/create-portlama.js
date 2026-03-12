#!/usr/bin/env node

import { main } from '../src/index.js';

try {
  await main();
} catch (error) {
  console.error('\n');
  console.error('  Portlama installation failed.');
  console.error(`  Error: ${error.message}`);
  console.error('\n');
  console.error('  You can safely re-run this installer to retry.');
  console.error('\n');
  process.exit(1);
}

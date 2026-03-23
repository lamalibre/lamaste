#!/usr/bin/env node

import { upgrade } from '../src/upgrade.js';

try {
  await upgrade();
} catch (error) {
  console.error('\n');
  console.error('  Portlama Admin Upgrade failed.');
  console.error(`  Error: ${error.message}`);
  console.error('\n');
  process.exit(1);
}

#!/usr/bin/env node

import { groupCommand } from './commands/groups.js';
import { grantCommand } from './commands/grants.js';
import { accessCommand } from './commands/access.js';

const args = process.argv.slice(2);
const command = args[0];

async function main(): Promise<void> {
  switch (command) {
    case 'group':
      await groupCommand(args.slice(1));
      break;
    case 'grant':
      await grantCommand(args.slice(1));
      break;
    case 'access':
      await accessCommand(args.slice(1));
      break;
    case '--help':
    case '-h':
    case undefined:
      printHelp();
      break;
    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exit(1);
  }
}

function printHelp(): void {
  console.log(`lamaste-gatekeeper — authorization management CLI

Usage: lamaste-gatekeeper <command> [options]

Commands:
  group    Manage Lamaste access control groups
  grant    Manage access grants
  access   Check access and run diagnostics

Run 'lamaste-gatekeeper <command> --help' for command-specific help.`);
}

main().catch((err: unknown) => {
  console.error('Error:', (err as Error).message);
  process.exit(1);
});

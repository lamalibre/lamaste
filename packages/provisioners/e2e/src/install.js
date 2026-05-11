// ============================================================================
// Interactive Installer
// ============================================================================
// Installs the lamaste-e2e CLI and optionally configures the MCP server.
//
// Modes:
//   Default:     CLI + desktop
//   --mcp:       CLI + desktop + configure MCP server in Claude Code
//   --cli-only:  CLI only (no desktop)
//
// Steps:
//   1. Detect lamaste repository root
//   2. Verify prerequisites (multipass, node >= 20)
//   3. Install npm dependencies (ensures CLI is linked in workspace)
//   4. Verify CLI loads
//   5. [--mcp] Check Claude Code CLI + register MCP server

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';
import { execa } from 'execa';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Find lamaste repo root by walking up from cwd or package location. */
function findRepoRoot() {
  // First try: walk up from cwd
  let dir = process.cwd();
  while (dir !== path.dirname(dir)) {
    if (
      fs.existsSync(path.join(dir, 'CLAUDE.md')) &&
      fs.existsSync(path.join(dir, 'packages', 'server', 'daemon'))
    ) {
      return dir;
    }
    dir = path.dirname(dir);
  }

  // Second try: relative to this package (when installed in the monorepo)
  const candidate = path.resolve(__dirname, '..', '..', '..', '..');
  if (
    fs.existsSync(path.join(candidate, 'CLAUDE.md')) &&
    fs.existsSync(path.join(candidate, 'packages', 'server', 'daemon'))
  ) {
    return candidate;
  }

  return null;
}

/**
 * @param {{ mcp?: boolean, cliOnly?: boolean }} options
 */
export async function install({ mcp = false, cliOnly = false } = {}) {
  const mode = mcp ? 'CLI + Desktop + MCP' : cliOnly ? 'CLI only' : 'CLI + Desktop';

  console.log('');
  console.log(chalk.bold.cyan('  ┌─────────────────────────────────────────────┐'));
  console.log(chalk.bold.cyan('  │     Lamaste E2E Infrastructure Installer    │'));
  console.log(chalk.bold.cyan('  └─────────────────────────────────────────────┘'));
  console.log(`\n  Mode: ${chalk.cyan(mode)}\n`);

  const steps = [];
  let repoRoot = null;

  // Step 1: Detect repo
  process.stdout.write(chalk.dim('  Detecting lamaste repository... '));
  repoRoot = findRepoRoot();
  if (!repoRoot) {
    console.log(chalk.red('not found'));
    console.error(
      chalk.red(
        '\n  Could not find lamaste repository. Run from within the repo,\n' +
          '  or clone it first: git clone https://github.com/lamalibre/lamaste.git\n',
      ),
    );
    process.exit(1);
  }
  console.log(chalk.green(repoRoot));
  steps.push(`Repository: ${repoRoot}`);

  // Step 2: Check Node.js
  process.stdout.write(chalk.dim('  Checking Node.js version... '));
  const major = parseInt(process.version.slice(1).split('.')[0], 10);
  if (major < 20) {
    console.log(chalk.red(process.version));
    console.error(chalk.red(`\n  Node.js >= 20 required (found ${process.version}).\n`));
    process.exit(1);
  }
  console.log(chalk.green(process.version));

  // Step 3: Check Multipass
  process.stdout.write(chalk.dim('  Checking Multipass... '));
  try {
    const { stdout } = await execa('multipass', ['version']);
    console.log(chalk.green(stdout.split('\n')[0]));
  } catch {
    console.log(chalk.red('not found'));
    console.error(
      chalk.red('\n  Multipass is not installed. Install from https://multipass.run\n'),
    );
    process.exit(1);
  }

  // Step 4: Install dependencies
  process.stdout.write(chalk.dim('  Installing dependencies... '));
  if (
    fs.existsSync(path.join(repoRoot, 'node_modules')) ||
    fs.existsSync(path.join(repoRoot, 'packages', 'tools', 'e2e', 'node_modules'))
  ) {
    console.log(chalk.green('already installed (workspace)'));
  } else {
    await execa('npm', ['install', '--ignore-scripts'], { cwd: repoRoot });
    console.log(chalk.green('done'));
  }

  // Step 5: Verify CLI
  process.stdout.write(chalk.dim('  Verifying lamaste-e2e CLI... '));
  const cliBin = path.join(repoRoot, 'packages', 'tools', 'e2e', 'bin', 'lamaste-e2e.js');
  try {
    const { stdout } = await execa('node', [cliBin, 'env', 'detect', '--json']);
    const event = JSON.parse(stdout.trim().split('\n').pop());
    if (event.ok) {
      console.log(chalk.green('ok'));
    } else {
      throw new Error('CLI returned non-ok');
    }
  } catch (err) {
    console.log(chalk.red('failed'));
    console.error(chalk.red(`\n  CLI verification failed: ${err.message}\n`));
    process.exit(1);
  }

  // Step 6: MCP registration (optional)
  if (mcp) {
    process.stdout.write(chalk.dim('  Checking Claude Code CLI... '));
    try {
      const { stdout } = await execa('claude', ['--version']);
      console.log(chalk.green(stdout.trim()));
    } catch {
      console.log(chalk.red('not found'));
      console.error(
        chalk.red('\n  Claude Code CLI not found. Install from https://claude.com/claude-code\n'),
      );
      process.exit(1);
    }

    process.stdout.write(chalk.dim('  Registering MCP server... '));
    const serverPath = path.join(repoRoot, 'packages', 'provisioners', 'e2e', 'src', 'index.js');
    await execa('claude', ['mcp', 'remove', 'e2e'], { reject: false });
    await execa('claude', ['mcp', 'add', '--transport', 'stdio', 'e2e', '--', 'node', serverPath]);
    console.log(chalk.green('registered as "e2e"'));
  }

  // Success
  console.log('');
  console.log(chalk.green.bold('  Installation complete!'));
  console.log('');
  console.log(chalk.dim('  CLI is available at:'));
  console.log(`    ${chalk.cyan('node ' + cliBin)}`);
  console.log('');
  console.log(chalk.dim('  Quick start:'));
  console.log(`    ${chalk.cyan('lamaste-e2e env detect')}        — detect hardware`);
  console.log(`    ${chalk.cyan('lamaste-e2e vm create')}         — create VMs`);
  console.log(`    ${chalk.cyan('lamaste-e2e provision')}          — provision to full state`);
  console.log(`    ${chalk.cyan('lamaste-e2e test run 1')}         — run a test`);
  console.log(`    ${chalk.cyan('lamaste-e2e diagnose 1')}         — debug a failed test`);

  if (!mcp) {
    console.log('');
    console.log(chalk.dim('  Tip: Add --mcp to also configure the Claude Code MCP server:'));
    console.log(`    ${chalk.cyan('npx @lamalibre/create-lamaste-e2e --mcp')}`);
  } else {
    console.log('');
    console.log(chalk.dim('  MCP server registered. Restart Claude Code to activate.'));
  }
  console.log('');
}

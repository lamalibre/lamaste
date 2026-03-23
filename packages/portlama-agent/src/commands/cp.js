import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import chalk from 'chalk';
import { assertMacOS } from '../lib/platform.js';
import { requireAgentConfig } from '../lib/config.js';
import { downloadRemoteFile, uploadRemoteFile } from '../lib/panel-api.js';

/**
 * Parse a cp argument to determine if it's a remote path (agent-label:/path)
 * or a local path.
 * @param {string} arg
 * @returns {{ isRemote: boolean, agentLabel?: string, path: string }}
 */
function parseLocation(arg) {
  // Match pattern: label:/path (label must be lowercase alphanumeric with hyphens, matching server validation)
  const match = arg.match(/^([a-z0-9-]+):(.+)$/);
  if (match) {
    return { isRemote: true, agentLabel: match[1], path: match[2] };
  }
  return { isRemote: false, path: arg };
}

/**
 * Run the file copy command.
 * Supports download (remote → local) and upload (local → remote).
 * @param {string[]} args
 */
export async function runCp(args) {
  assertMacOS();
  const config = await requireAgentConfig();

  if (args.length < 2) {
    printUsage();
    process.exit(1);
  }

  const source = parseLocation(args[0]);
  const dest = parseLocation(args[1]);

  // Validate: exactly one side must be remote
  if (source.isRemote && dest.isRemote) {
    console.error(
      chalk.red('\n  Cannot copy between two remote agents. One side must be a local path.\n'),
    );
    process.exit(1);
  }

  if (!source.isRemote && !dest.isRemote) {
    console.error(
      chalk.red(
        '\n  Both paths are local. Use the system cp command for local copies.\n' +
          '  For remote transfers, prefix with agent-label: (e.g. myagent:/path/to/file)\n',
      ),
    );
    process.exit(1);
  }

  if (source.isRemote) {
    await runDownload(config, source, dest);
  } else {
    await runUpload(config, source, dest);
  }
}

/**
 * Download a file from a remote agent.
 * @param {object} config
 * @param {{ agentLabel: string, path: string }} source
 * @param {{ path: string }} dest
 */
async function runDownload(config, source, dest) {
  const agentLabel = source.agentLabel;
  const remotePath = source.path;
  let localPath = path.resolve(dest.path);

  // If dest is a directory, use the remote filename
  try {
    const destStat = await stat(localPath);
    if (destStat.isDirectory()) {
      const remoteBasename = path.basename(remotePath);
      localPath = path.join(localPath, remoteBasename);
    }
  } catch {
    // Path doesn't exist yet — that's fine, we'll create the file
    // Ensure the parent directory exists
    const parentDir = path.dirname(localPath);
    if (!existsSync(parentDir)) {
      console.error(chalk.red(`\n  Parent directory does not exist: ${parentDir}\n`));
      process.exit(1);
    }
  }

  console.log('');
  console.log(chalk.dim(`  Downloading ${chalk.bold(agentLabel)}:${remotePath} → ${localPath}`));

  try {
    await downloadRemoteFile(
      config,
      agentLabel,
      remotePath,
      localPath,
    );
  } catch (err) {
    console.error(chalk.red(`\n  Download failed: ${err.message}\n`));
    process.exit(1);
  }

  console.log(`  ${chalk.green('✓')} Downloaded to ${chalk.cyan(localPath)}`);
  console.log('');
}

/**
 * Upload a local file to a remote agent.
 * @param {object} config
 * @param {{ path: string }} source
 * @param {{ agentLabel: string, path: string }} dest
 */
async function runUpload(config, source, dest) {
  const localPath = path.resolve(source.path);
  const agentLabel = dest.agentLabel;
  const remotePath = dest.path;

  // Validate local file exists
  if (!existsSync(localPath)) {
    console.error(chalk.red(`\n  Local file not found: ${localPath}\n`));
    process.exit(1);
  }

  let localStat;
  try {
    localStat = await stat(localPath);
  } catch (err) {
    console.error(chalk.red(`\n  Cannot read file: ${err.message}\n`));
    process.exit(1);
  }

  if (!localStat.isFile()) {
    console.error(
      chalk.red('\n  Only single file transfers are currently supported.\n') +
        chalk.dim(
          '  To transfer a directory, archive it first (e.g. tar -czf archive.tar.gz dir/).\n',
        ),
    );
    process.exit(1);
  }

  console.log('');
  console.log(chalk.dim(`  Uploading ${localPath} → ${chalk.bold(agentLabel)}:${remotePath}`));

  try {
    await uploadRemoteFile(
      config,
      agentLabel,
      remotePath,
      localPath,
    );
  } catch (err) {
    console.error(chalk.red(`\n  Upload failed: ${err.message}\n`));
    process.exit(1);
  }

  console.log(`  ${chalk.green('✓')} Uploaded to ${chalk.cyan(`${agentLabel}:${remotePath}`)}`);
  console.log('');
}

/**
 * Print usage information.
 */
function printUsage() {
  const c = chalk.cyan;
  const d = chalk.dim;

  console.error(`
  ${chalk.bold('Usage:')}

    ${c('portlama-agent cp')} ${d('<source> <destination>')}

  ${chalk.bold('Download from agent:')}

    ${c('portlama-agent cp myagent:/var/log/app.log ./app.log')}

  ${chalk.bold('Upload to agent:')}

    ${c('portlama-agent cp ./config.json myagent:/etc/app/config.json')}

  ${chalk.bold('Notes:')}

    Remote paths use the format: ${c('agent-label:/absolute/path')}
    Only single file transfers are supported.
`);
}

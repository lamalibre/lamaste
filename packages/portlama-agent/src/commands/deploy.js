import chalk from 'chalk';
import { Listr } from 'listr2';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { assertMacOS } from '../lib/platform.js';
import { requireAgentConfig } from '../lib/config.js';
import { fetchSites, fetchSiteFiles, deleteSiteFile, uploadSiteFiles } from '../lib/panel-api.js';
import { formatBytes } from '../lib/format.js';
import { filterBlockedFiles, runClamAvScan } from '../lib/scan.js';

const UUID_PREFIX_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-/;

/**
 * Recursively scan a directory and return file metadata.
 * Skips hidden files and directories (those starting with '.').
 * @param {string} dir - Absolute directory path
 * @param {string} [base=''] - Relative base path for building relative paths
 * @returns {Promise<Array<{ relativePath: string, absolutePath: string, size: number }>>}
 */
async function scanDirectory(dir, base = '') {
  const entries = await readdir(dir, { withFileTypes: true });
  const results = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (entry.isSymbolicLink()) continue;
    const fullPath = path.join(dir, entry.name);
    const relPath = base ? path.join(base, entry.name) : entry.name;
    if (entry.isDirectory()) {
      results.push(...(await scanDirectory(fullPath, relPath)));
    } else if (entry.isFile()) {
      const s = await stat(fullPath);
      results.push({ relativePath: relPath, absolutePath: fullPath, size: s.size });
    }
  }
  return results;
}

/**
 * Deploy a local directory to a static site on the panel.
 * @param {string[]} args
 */
export async function runDeploy(args) {
  assertMacOS();
  const config = await requireAgentConfig();

  const target = args[0];
  const localPath = args[1];

  if (!target || !localPath) {
    console.error(`\n  Usage: ${chalk.cyan('portlama-agent deploy <site-name> <local-path>')}\n`);
    process.exit(1);
  }

  // Validate local path exists and is a directory
  const resolvedPath = path.resolve(localPath);
  let localStat;
  try {
    localStat = await stat(resolvedPath);
  } catch {
    console.error(`\n  ${chalk.red(`Path does not exist: ${resolvedPath}`)}\n`);
    process.exit(1);
  }
  if (!localStat.isDirectory()) {
    console.error(`\n  ${chalk.red(`Path is not a directory: ${resolvedPath}`)}\n`);
    process.exit(1);
  }

  // Resolve site ID and FQDN
  let siteId;
  let siteFqdn;

  let data;
  try {
    data = await fetchSites(config);
  } catch (err) {
    console.error(`\n  ${chalk.red(`Failed to connect to panel: ${err.message}`)}\n`);
    process.exit(1);
  }
  const sites = data.sites || [];

  if (UUID_PREFIX_RE.test(target)) {
    const match = sites.find((s) => s.id === target);
    if (!match) {
      console.error(`\n  ${chalk.red(`Site not found: ${target}`)}\n`);
      process.exit(1);
    }
    siteId = match.id;
    siteFqdn = match.fqdn;
  } else {
    const match = sites.find((s) => s.name === target);
    if (!match) {
      console.error(`\n  ${chalk.red(`Site not found: ${target}`)}\n`);
      process.exit(1);
    }
    siteId = match.id;
    siteFqdn = match.fqdn || match.name;
  }

  // Scan local directory recursively
  const allFiles = await scanDirectory(resolvedPath);

  if (allFiles.length === 0) {
    console.error(`\n  ${chalk.red('No files found in the specified directory.')}\n`);
    process.exit(1);
  }

  // Extension allowlist check
  const { allowed: files, blocked } = filterBlockedFiles(allFiles);
  if (blocked.length > 0) {
    console.error(`\n  ${chalk.red('Blocked files with disallowed extensions:')}\n`);
    for (const f of blocked) {
      const ext = path.extname(f.relativePath) || '(no extension)';
      console.error(`    ${chalk.yellow(ext)}  ${f.relativePath}`);
    }
    console.error(
      `\n  ${chalk.dim('Only static web assets are allowed. Remove these files and retry.')}\n`,
    );
    process.exit(1);
  }

  // ClamAV malware scan via Docker
  const scanTasks = new Listr(
    [
      {
        title: `Scanning ${files.length} files for malware`,
        task: async (_ctx, task) => {
          const result = await runClamAvScan(resolvedPath);
          if (!result.available) {
            task.output = chalk.yellow('Docker not available — skipping malware scan');
            return;
          }
          if (result.infected && result.infected.length > 0) {
            const listing = result.infected
              .map((i) => `    ${chalk.red(i.virus)}  ${i.file}`)
              .join('\n');
            throw new Error(
              `ClamAV found ${result.infected.length} infected file(s):\n${listing}\n\n  Remove infected files and retry.`,
            );
          }
          task.output = `${files.length} files clean`;
        },
        rendererOptions: { persistentOutput: true },
      },
    ],
    {
      renderer: 'default',
      rendererOptions: { collapseSubtasks: false },
      exitOnError: true,
    },
  );

  try {
    await scanTasks.run();
  } catch (err) {
    console.error(`\n  ${chalk.red(`Deploy aborted: ${err.message}`)}\n`);
    process.exit(1);
  }

  const tasks = new Listr(
    [
      {
        title: 'Clearing remote files',
        task: async (_ctx, task) => {
          const { files: remoteFiles } = await fetchSiteFiles(config, siteId, '.');
          for (const f of remoteFiles) {
            task.output = `Removing ${f.name}`;
            await deleteSiteFile(config, siteId, f.name);
          }
        },
        rendererOptions: { persistentOutput: false },
      },
      {
        title: `Uploading ${files.length} files`,
        task: async (_ctx, task) => {
          let uploaded = 0;

          // Group files by directory
          const groups = new Map();
          for (const f of files) {
            const dir = path.dirname(f.relativePath);
            if (!groups.has(dir)) groups.set(dir, []);
            groups.get(dir).push(f);
          }

          for (const [dir, groupFiles] of groups) {
            // Batch in groups of 10
            for (let i = 0; i < groupFiles.length; i += 10) {
              const batch = groupFiles.slice(i, i + 10);
              const uploadDir = dir === '.' ? '.' : dir;
              await uploadSiteFiles(
                config,
                siteId,
                uploadDir,
                batch.map((f) => f.absolutePath),
              );
              uploaded += batch.length;
              task.output = `${batch[batch.length - 1].relativePath} (${uploaded}/${files.length})`;
            }
          }
        },
        rendererOptions: { persistentOutput: false },
      },
      {
        title: 'Verifying deployment',
        task: async (_ctx, task) => {
          // Count remote files recursively to match local recursive scan
          let remoteCount = 0;
          const countRemote = async (dirPath) => {
            const { files: entries } = await fetchSiteFiles(config, siteId, dirPath);
            for (const entry of entries) {
              if (entry.type === 'directory') {
                const subPath = dirPath === '.' ? entry.name : `${dirPath}/${entry.name}`;
                await countRemote(subPath);
              } else {
                remoteCount++;
              }
            }
          };
          await countRemote('.');
          const localCount = files.length;
          if (remoteCount !== localCount) {
            task.output = `Warning: remote has ${remoteCount} files but ${localCount} were uploaded`;
            throw new Error(
              `Verification failed: expected ${localCount} files on remote but found ${remoteCount}`,
            );
          }
          task.output = `${remoteCount} files verified`;
        },
      },
    ],
    {
      renderer: 'default',
      rendererOptions: { collapseSubtasks: false },
      exitOnError: true,
    },
  );

  try {
    await tasks.run();
  } catch (err) {
    console.error(`\n  ${chalk.red(`Deploy failed: ${err.message}`)}\n`);
    process.exit(1);
  }

  // Print summary
  const totalSize = files.reduce((sum, f) => sum + f.size, 0);
  console.log('');
  console.log(
    `  ${chalk.green('✓')} Deployed ${chalk.bold(String(files.length))} files (${formatBytes(totalSize)}) to ${chalk.cyan(`https://${siteFqdn}/`)}`,
  );
  console.log('');
}

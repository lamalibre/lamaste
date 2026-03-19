import { createInterface } from 'node:readline';
import chalk from 'chalk';
import { assertMacOS } from '../lib/platform.js';
import { requireAgentConfig } from '../lib/config.js';
import { fetchSites, createSite, deleteSite } from '../lib/panel-api.js';
import { formatBytes } from '../lib/format.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Prompt for user input via readline.
 * @param {string} question
 * @returns {Promise<string>}
 */
function prompt(question) {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolvePromise) => {
    rl.question(`  ${question}`, (answer) => {
      rl.close();
      resolvePromise(answer.trim());
    });
  });
}

/**
 * Parse simple CLI flags from an array of arguments.
 * Supports --key value and boolean --flag.
 * @param {string[]} args
 * @returns {{ positional: string[], flags: Record<string, string|boolean> }}
 */
function parseFlags(args) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(args[i]);
    }
  }
  return { positional, flags };
}

/**
 * Sites command dispatcher.
 * @param {string[]} args
 */
export async function runSites(args) {
  assertMacOS();
  const config = await requireAgentConfig();
  const sub = args[0];

  if (sub === 'create') return runCreate(config, args.slice(1));
  if (sub === 'delete') return runDelete(config, args.slice(1));
  if (sub && sub !== 'list') {
    console.error(`\n  Unknown subcommand: ${chalk.red(sub)}`);
    console.error(`  Usage: ${chalk.cyan('portlama-agent sites [list|create|delete]')}\n`);
    process.exit(1);
  }
  return runList(config);
}

/**
 * List all static sites.
 * @param {object} config
 */
async function runList(config) {
  const b = chalk.bold;
  const c = chalk.cyan;
  const d = chalk.dim;
  const y = chalk.yellow;

  console.log('');
  console.log(b('  Static Sites'));
  console.log(d('  ─'.repeat(28)));

  let sites;
  try {
    const data = await fetchSites(config.panelUrl, config.p12Path, config.p12Password);
    sites = data.sites || [];
  } catch {
    console.log(`  ${y('Could not reach panel to fetch site list.')}`);
    console.log('');
    return;
  }

  if (sites.length === 0) {
    console.log(`  ${d('No sites configured.')}`);
    console.log('');
    return;
  }

  for (const site of sites) {
    const typeBadge = site.type === 'custom' ? d('[custom]') : d('[managed]');
    let statusLabel;
    if (site.status === 'live') {
      statusLabel = chalk.green('Live');
    } else if (site.status === 'dns_pending') {
      statusLabel = y('DNS Pending');
    } else {
      statusLabel = y('Setup');
    }
    const size = site.totalSize != null ? d(`(${formatBytes(site.totalSize)})`) : '';

    console.log(`  ${c('•')} ${b(site.name)} ${d(site.fqdn || '')} ${typeBadge} ${statusLabel} ${size}`);
  }

  console.log('');
}

/**
 * Create a new static site.
 * @param {object} config
 * @param {string[]} args
 */
async function runCreate(config, args) {
  const { positional, flags } = parseFlags(args);
  const name = positional[0];

  if (!name) {
    console.error(`\n  Usage: ${chalk.cyan('portlama-agent sites create <name> [--type managed|custom] [--domain <fqdn>] [--spa] [--auth]')}\n`);
    process.exit(1);
  }

  const type = flags.type || 'managed';
  if (type !== 'managed' && type !== 'custom') {
    console.error(`\n  Invalid type: ${chalk.red(type)}. Must be ${chalk.cyan('managed')} or ${chalk.cyan('custom')}.\n`);
    process.exit(1);
  }

  if (type === 'custom' && !flags.domain) {
    console.error(`\n  ${chalk.red('--domain is required for custom type sites.')}\n`);
    process.exit(1);
  }

  const body = {
    name,
    type,
    spaMode: flags.spa === true,
    autheliaProtected: flags.auth === true,
  };

  if (flags.domain) {
    body.customDomain = flags.domain;
  }

  let result;
  try {
    result = await createSite(config.panelUrl, config.p12Path, config.p12Password, body);
  } catch (err) {
    const detail = err.message || 'Unknown error';
    console.error(`\n  ${chalk.red(`Failed to create site: ${detail}`)}\n`);
    process.exit(1);
  }
  const site = result.site || result;
  const fqdn = site.fqdn || flags.domain || name;

  console.log('');
  console.log(`  ${chalk.green('✓')} Site ${chalk.bold(name)} created`);
  console.log(`  ${chalk.bold('FQDN:')}  ${chalk.cyan(fqdn)}`);
  console.log(`  ${chalk.bold('URL:')}   ${chalk.cyan(`https://${fqdn}/`)}`);

  if (type === 'custom') {
    console.log('');
    console.log(chalk.dim('  DNS setup required:'));
    console.log(chalk.dim(`    Create a CNAME record pointing ${fqdn} to your Portlama server.`));
  }

  console.log('');
}

/**
 * Delete a static site by name or UUID.
 * @param {object} config
 * @param {string[]} args
 */
async function runDelete(config, args) {
  const target = args[0];

  if (!target) {
    console.error(`\n  Usage: ${chalk.cyan('portlama-agent sites delete <name|uuid>')}\n`);
    process.exit(1);
  }

  let siteId;
  let siteName = target;

  if (UUID_RE.test(target)) {
    siteId = target;
  } else {
    let data;
    try {
      data = await fetchSites(config.panelUrl, config.p12Path, config.p12Password);
    } catch (err) {
      console.error(`\n  ${chalk.red(`Failed to connect to panel: ${err.message}`)}\n`);
      process.exit(1);
    }
    const sites = data.sites || [];
    const match = sites.find((s) => s.name === target);
    if (!match) {
      console.error(`\n  ${chalk.red(`Site not found: ${target}`)}\n`);
      process.exit(1);
    }
    siteId = match.id;
    siteName = match.name;
  }

  const answer = await prompt(`Delete site ${chalk.bold(siteName)}? This cannot be undone. [y/N] `);
  if (answer.toLowerCase() !== 'y') {
    console.log(chalk.dim('  Cancelled.'));
    return;
  }

  try {
    await deleteSite(config.panelUrl, config.p12Path, config.p12Password, siteId);
  } catch (err) {
    const detail = err.message || 'Unknown error';
    console.error(`\n  ${chalk.red(`Failed to delete site: ${detail}`)}\n`);
    process.exit(1);
  }

  console.log('');
  console.log(`  ${chalk.green('✓')} Site ${chalk.bold(siteName)} deleted.`);
  console.log('');
}

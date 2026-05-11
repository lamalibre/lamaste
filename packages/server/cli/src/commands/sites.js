/**
 * lamaste-server sites — Manage static sites.
 *
 * Subcommands:
 *   list                            List managed sites
 *   create --name <n> [--type <t>]  Create a site
 *   delete <id>                     Delete a site by ID
 *
 * List reads directly from the state file.
 * Create/delete use the panel REST API (which has the full
 * nginx/certbot/directory dependency stack).
 */

import chalk from 'chalk';
import { readSites } from '../state.js';
import { panelRequest } from '../panel-api.js';
import { emit, emitError, emitComplete } from '../ndjson.js';

/**
 * @param {string[]} args
 * @param {{ json: boolean }} options
 */
export async function runSites(args, { json }) {
  const sub = args[0];

  switch (sub) {
    case 'list':
      return listSites({ json });
    case 'create':
      return createSite(args.slice(1), { json });
    case 'delete':
      return deleteSite(args[1], { json });
    default:
      printSiteUsage();
      process.exit(sub ? 1 : 0);
  }
}

function printSiteUsage() {
  const b = chalk.bold;
  const c = chalk.cyan;
  console.log(`
${b('Usage:')} lamaste-server sites <subcommand>

${b('Subcommands:')}
  ${c('list')}                                  List managed sites
  ${c('create')} --name <n> [options]            Create a site
  ${c('delete')} <id>                            Delete a site by ID

${b('Create options:')}
  --name <name>         Site name (required)
  --type <type>         Site type: managed (default) or custom
  --custom-domain <d>   Custom domain (required if type is custom)
  --spa                 Enable SPA mode (single-page application routing)
  --authelia            Enable Authelia protection
`);
}

/**
 * @param {{ json: boolean }} options
 */
async function listSites({ json }) {
  const sites = await readSites();

  if (json) {
    emit({ sites });
    return;
  }

  if (sites.length === 0) {
    console.log('\n  No sites configured.\n');
    return;
  }

  const b = chalk.bold;
  const c = chalk.cyan;
  const g = chalk.green;
  const y = chalk.yellow;
  const d = chalk.dim;

  console.log('');
  console.log(b('  Static Sites'));
  console.log(d('  ' + '\u2500'.repeat(50)));

  for (const s of sites) {
    const dnsStatus = s.dnsVerified ? g('verified') : y('pending DNS');
    const certStatus = s.certIssued ? g('cert issued') : y('no cert');
    const spaTag = s.spaMode ? d('[SPA]') : '';
    const authTag = s.autheliaProtected ? d('[protected]') : '';

    console.log(
      `  ${c(s.name)}  ${d(s.fqdn)}  ${s.type}  ${dnsStatus}  ${certStatus} ${spaTag} ${authTag}`.trimEnd(),
    );
    console.log(`    ${d(`id: ${s.id}`)}`);
  }
  console.log('');
}

/**
 * @param {string[]} args
 * @param {{ json: boolean }} options
 */
async function createSite(args, { json }) {
  const name = getArg(args, 'name');
  const type = getArg(args, 'type') || 'managed';
  const customDomain = getArg(args, 'custom-domain') || undefined;
  const spaMode = args.includes('--spa');
  const autheliaProtected = args.includes('--authelia');

  if (!name) {
    const msg = 'Error: --name is required';
    if (json) emitError(msg);
    else console.error(`\n  ${msg}\n`);
    process.exit(1);
  }

  if (type !== 'managed' && type !== 'custom') {
    const msg = 'Error: --type must be managed or custom';
    if (json) emitError(msg);
    else console.error(`\n  ${msg}\n`);
    process.exit(1);
  }

  if (type === 'custom' && !customDomain) {
    const msg = 'Error: --custom-domain is required for custom type sites';
    if (json) emitError(msg);
    else console.error(`\n  ${msg}\n`);
    process.exit(1);
  }

  /** @type {Record<string, unknown>} */
  const body = { name, type, spaMode, autheliaProtected };
  if (customDomain) body.customDomain = customDomain;

  if (!json) process.stderr.write(`  Creating site ${chalk.cyan(name)}...`);

  try {
    const result = await panelRequest('POST', '/api/sites', body);

    if (json) {
      emitComplete({ site: result.site || result });
    } else {
      console.log(` ${chalk.green('ok')}`);
      const site = result.site || result;
      console.log(`  FQDN: ${chalk.cyan(String(site.fqdn || name))}`);
      console.log(`  ID:   ${chalk.dim(String(site.id || 'unknown'))}`);
      if (result.message) {
        console.log(`  ${chalk.dim(String(result.message))}`);
      }
      console.log('');
    }
  } catch (err) {
    if (json) emitError(err.message);
    else {
      console.log(` ${chalk.red('failed')}`);
      console.error(`  ${chalk.red(err.message)}\n`);
    }
    process.exit(1);
  }
}

/**
 * @param {string | undefined} id
 * @param {{ json: boolean }} options
 */
async function deleteSite(id, { json }) {
  if (!id) {
    const msg = 'Usage: lamaste-server sites delete <id>';
    if (json) emitError(msg);
    else console.error(`\n  ${msg}\n`);
    process.exit(1);
  }

  if (!json) process.stderr.write(`  Deleting site ${chalk.dim(id)}...`);

  try {
    await panelRequest('DELETE', `/api/sites/${id}`);
    if (json) {
      emitComplete({ id, deleted: true });
    } else {
      console.log(` ${chalk.green('ok')}\n`);
    }
  } catch (err) {
    if (json) emitError(err.message);
    else {
      console.log(` ${chalk.red('failed')}`);
      console.error(`  ${chalk.red(err.message)}\n`);
    }
    process.exit(1);
  }
}

/**
 * @param {string[]} args
 * @param {string} name
 * @returns {string | null}
 */
function getArg(args, name) {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1 || idx + 1 >= args.length) return null;
  return args[idx + 1];
}

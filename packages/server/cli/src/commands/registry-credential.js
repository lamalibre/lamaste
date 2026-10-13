/**
 * lamaste-server registry-credential — the panel's service credential on the
 * Lamalibre npm registry (Feria), used to broker short-lived install tokens
 * for agents.
 *
 *   registry-credential show
 *   registry-credential set --url <registry> [--token-stdin]
 *       The token is read from LAMASTE_REGISTRY_TOKEN, or from stdin with
 *       --token-stdin. It is never accepted as a command-line argument.
 *   registry-credential clear
 */

import chalk from 'chalk';
import { panelRequest } from '../panel-api.js';
import { emit } from '../ndjson.js';

/**
 * @param {string[]} args
 * @param {{ json: boolean }} options
 */
export async function runRegistryCredential(args, { json }) {
  const sub = args[0];
  switch (sub) {
    case 'show':
      return show({ json });
    case 'set':
      return set(args.slice(1), { json });
    case 'clear':
      return clear({ json });
    default:
      process.stderr.write(
        `Usage: lamaste-server registry-credential <show | set --url <registry> [--token-stdin] | clear>\n`,
      );
      process.exit(1);
  }
}

async function show({ json }) {
  const result = await panelRequest('GET', '/api/registry-credential');
  if (json) {
    emit(result);
    return;
  }
  if (!result.configured) {
    console.log(chalk.dim('No registry credential configured.'));
    return;
  }
  console.log(`${chalk.bold('Registry:')}   ${result.registryUrl}`);
  console.log(`${chalk.bold('Scope:')}      ${result.scope}`);
  console.log(`${chalk.bold('Owner:')}      ${result.owner ?? chalk.dim('(unknown)')}`);
  console.log(`${chalk.bold('Configured:')} ${result.configuredAt}`);
}

async function set(args, { json }) {
  let url;
  let tokenFromStdin = false;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--url') {
      url = args[++i];
    } else if (arg.startsWith('--url=')) {
      url = arg.slice('--url='.length);
    } else if (arg === '--token-stdin') {
      tokenFromStdin = true;
    } else if (arg === '--token' || arg.startsWith('--token=')) {
      throw new Error(
        'The token is never accepted on the command line — set LAMASTE_REGISTRY_TOKEN or use --token-stdin',
      );
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!url) throw new Error('registry-credential set: --url <registry> is required');

  let token = tokenFromStdin ? (await readStdin()).trim() : process.env.LAMASTE_REGISTRY_TOKEN;
  if (!token) {
    throw new Error(
      'No token: set LAMASTE_REGISTRY_TOKEN, or pipe it in with --token-stdin (e.g. from `feria-server token bootstrap`)',
    );
  }
  token = token.trim();

  const result = await panelRequest('PUT', '/api/registry-credential', {
    registryUrl: url,
    token,
  });
  if (result.error) throw new Error(result.error);
  if (json) {
    emit(result);
    return;
  }
  console.log(
    `${chalk.green('✓')} Registry credential configured for ${result.registryUrl} as ${result.owner ?? '(unknown)'}`,
  );
}

async function clear({ json }) {
  const result = await panelRequest('DELETE', '/api/registry-credential');
  if (json) {
    emit(result);
    return;
  }
  console.log(
    result.removed
      ? `${chalk.green('✓')} Registry credential removed`
      : chalk.dim('Nothing to remove.'),
  );
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => (data += chunk));
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

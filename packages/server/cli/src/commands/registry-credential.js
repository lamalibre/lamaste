/**
 * lamaste-server registry-credential — the panel's service credential on the
 * Lamalibre npm registry (Feria), used to broker short-lived install tokens
 * for agents.
 *
 *   registry-credential show
 *   registry-credential set --url <registry> --oidc [--issuer-domain <domain>]
 *       The panel authenticates as its own `lamaste-server` OIDC client on
 *       the relay's Authelia (client-credentials grant, Feria login). Nothing
 *       to paste; Feria's auth.json must grant the relay's lamaste-server client
 *       read and admin through a "workloads" rule on its groups issuer for the
 *       relay Authelia.
 *   registry-credential set --url <registry> [--token-stdin]
 *       A long-lived Feria token, read from LAMASTE_REGISTRY_TOKEN or from
 *       stdin with --token-stdin. Never accepted as a command-line argument.
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
        `Usage: lamaste-server registry-credential <show | set --url <registry> (--oidc [--issuer-domain <domain>] | --token-stdin) | clear>\n`,
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
  console.log(
    `${chalk.bold('Auth:')}       ${
      result.auth === 'oidc'
        ? `Authelia OIDC client ${result.clientId} (client credentials)`
        : 'long-lived registry token'
    }`,
  );
  console.log(`${chalk.bold('Owner:')}      ${result.owner ?? chalk.dim('(unknown)')}`);
  console.log(`${chalk.bold('Configured:')} ${result.configuredAt}`);
}

async function set(args, { json }) {
  let url;
  let tokenFromStdin = false;
  let oidc = false;
  let issuerDomain;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--url') {
      url = args[++i];
    } else if (arg.startsWith('--url=')) {
      url = arg.slice('--url='.length);
    } else if (arg === '--token-stdin') {
      tokenFromStdin = true;
    } else if (arg === '--oidc') {
      oidc = true;
    } else if (arg === '--issuer-domain') {
      issuerDomain = args[++i]?.toLowerCase();
    } else if (arg === '--token' || arg.startsWith('--token=')) {
      throw new Error(
        'The token is never accepted on the command line — set LAMASTE_REGISTRY_TOKEN or use --token-stdin',
      );
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!url) throw new Error('registry-credential set: --url <registry> is required');
  if (issuerDomain !== undefined && !oidc) {
    throw new Error('registry-credential set: --issuer-domain goes with --oidc');
  }
  if (oidc && tokenFromStdin) {
    throw new Error('registry-credential set: choose --oidc or --token-stdin, not both');
  }

  let auth;
  if (oidc) {
    // The domain whose issuer (https://auth.<domain>) the registry trusts; the primary when absent.
    auth = { kind: 'oidc', ...(issuerDomain ? { issuerDomain } : {}) };
  } else {
    let token = tokenFromStdin ? (await readStdin()).trim() : process.env.LAMASTE_REGISTRY_TOKEN;
    if (!token) {
      throw new Error(
        'No token: use --oidc, set LAMASTE_REGISTRY_TOKEN, or pipe a token in with --token-stdin (e.g. from `feria-server token bootstrap`)',
      );
    }
    token = token.trim();
    auth = { kind: 'token', token };
  }

  const result = await panelRequest('PUT', '/api/registry-credential', {
    registryUrl: url,
    auth,
  });
  if (result.error) throw new Error(result.error);
  if (json) {
    emit(result);
    return;
  }
  console.log(
    `${chalk.green('✓')} Registry credential configured for ${result.registryUrl} as ${result.owner ?? '(unknown)'}` +
      (result.auth === 'oidc' ? ` (Authelia client ${result.clientId})` : ''),
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

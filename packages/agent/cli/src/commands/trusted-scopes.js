/**
 * lamaste-agent trusted-scopes — the npm scopes plugins may come from.
 *
 *   trusted-scopes [list]                   this agent's: its relay's list, as
 *                                           the last sync recorded it (read only —
 *                                           the relay's administrator changes it)
 *   trusted-scopes --local [list]           the local plugin host's (desktop)
 *   trusted-scopes --local add <scope>      trust one more scope locally: its
 *                                           plugins run with the same privileges
 *                                           as Lamalibre's own on this machine
 *   trusted-scopes --local remove <scope>   refused while a local plugin uses it
 *
 * `@lamalibre` is always trusted. The local list is
 * ~/.lamalibre/local/trusted-scopes.json, changed only here.
 */

import chalk from 'chalk';
import {
  addLocalTrustedScope,
  agentTrustedScopes,
  localTrustedScopes,
  removeLocalTrustedScope,
  resolveLabel,
} from '@lamalibre/lamaste/agent';

function scopeArgument(raw) {
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new Error('Name a scope, e.g. @example');
  }
  return raw.endsWith('/') ? raw.slice(0, -1) : raw;
}

function print(scopes, json, where) {
  if (json) {
    process.stdout.write(`${JSON.stringify({ event: 'trusted-scopes', where, scopes })}\n`);
    return;
  }
  console.log(`${chalk.bold('Trusted publisher scopes')} ${chalk.dim(`(${where})`)}`);
  for (const scope of scopes) {
    console.log(`  ${scope}${scope === '@lamalibre' ? chalk.dim('  built in') : ''}`);
  }
}

/**
 * @param {string[]} args
 * @param {{ label?: string, json: boolean }} options
 */
export async function runTrustedScopes(args, { label, json }) {
  const local = args.includes('--local');
  const rest = args.filter((a) => a !== '--local');
  const sub = rest[0] ?? 'list';

  if (!local) {
    if (sub !== 'list') {
      throw new Error(
        "An agent follows its relay's trusted scopes: the relay's administrator changes them (lamaste-server trusted-scopes). Use --local for the local plugin host.",
      );
    }
    const resolved = await resolveLabel(label);
    print(await agentTrustedScopes(resolved), json, `agent ${resolved}, from its relay`);
    return;
  }

  try {
    switch (sub) {
      case 'list':
        print(await localTrustedScopes(), json, 'local plugin host');
        return;
      case 'add':
        print(await addLocalTrustedScope(scopeArgument(rest[1])), json, 'local plugin host');
        return;
      case 'remove':
        print(await removeLocalTrustedScope(scopeArgument(rest[1])), json, 'local plugin host');
        return;
      default:
        throw new Error(
          'Usage: lamaste-agent trusted-scopes [list] | --local [list | add <scope> | remove <scope>]',
        );
    }
  } catch (err) {
    if (json) {
      process.stdout.write(
        `${JSON.stringify({ event: 'error', message: err.message, code: err.code ?? null, recoverable: false })}\n`,
      );
      process.exit(1);
    }
    throw err;
  }
}

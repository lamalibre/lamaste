/**
 * lamaste-server trusted-scopes — the relay's trusted publisher scopes:
 * the npm scopes whose plugins this relay installs and runs.
 *
 *   trusted-scopes [list]          the built-in scope and the additional ones
 *   trusted-scopes add <scope>     trust one more scope (its plugins run with
 *                                  the same privileges as Lamalibre's own; the
 *                                  configured registry must host it)
 *   trusted-scopes remove <scope>  stop trusting it (refused while a plugin or
 *                                  a push-install policy uses it)
 *
 * Through the panel's API like every panel-owned state (audited there).
 */

import chalk from 'chalk';
import { panelRequest } from '../panel-api.js';
import { emit } from '../ndjson.js';

/** An npm scope as the panel takes it: `@example` (a trailing slash is dropped). */
export function scopeArgument(raw) {
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new Error('Name a scope, e.g. @example');
  }
  return raw.endsWith('/') ? raw.slice(0, -1) : raw;
}

/** The panel's refusal as an Error carrying its code and what is in the way. */
function refused(result) {
  const parts = [result.error];
  if (Array.isArray(result.plugins) && result.plugins.length > 0) {
    parts.push(`plugins: ${result.plugins.join(', ')}`);
  }
  if (Array.isArray(result.policies) && result.policies.length > 0) {
    parts.push(`push-install policies: ${result.policies.join(', ')}`);
  }
  return Object.assign(new Error(parts.join(' — ')), { code: result.code });
}

/**
 * @param {string[]} args
 * @param {{ json: boolean }} options
 */
export async function runTrustedScopes(args, { json }) {
  const sub = args[0] ?? 'list';
  switch (sub) {
    case 'list':
      return list({ json });
    case 'add':
      return change('POST', scopeArgument(args[1]), { json });
    case 'remove':
      return change('DELETE', scopeArgument(args[1]), { json });
    default:
      process.stderr.write(
        'Usage: lamaste-server trusted-scopes [list | add <scope> | remove <scope>]\n',
      );
      process.exit(1);
  }
}

function print(view) {
  console.log(`${chalk.bold('Built in:')}   ${view.builtIn}`);
  console.log(
    `${chalk.bold('Additional:')} ${
      view.additional.length > 0 ? view.additional.join(', ') : chalk.dim('(none)')
    }`,
  );
}

async function list({ json }) {
  const result = await panelRequest('GET', '/api/settings/trusted-scopes');
  if (result.error) throw refused(result);
  if (json) {
    emit(result);
    return;
  }
  print(result);
}

async function change(method, scope, { json }) {
  const result =
    method === 'POST'
      ? await panelRequest('POST', '/api/settings/trusted-scopes', { scope })
      : await panelRequest('DELETE', `/api/settings/trusted-scopes/${encodeURIComponent(scope)}`);
  if (result.error) throw refused(result);
  if (json) {
    emit(result);
    return;
  }
  console.log(
    method === 'POST'
      ? `${chalk.green('✓')} ${scope} is trusted: its plugins run with the same privileges as Lamalibre's own`
      : `${chalk.green('✓')} ${scope} is no longer trusted`,
  );
  print(result);
}

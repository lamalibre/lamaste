/**
 * Changing the relay's trusted publisher scopes — the only writer of
 * `panel.json` `trustedScopes`.
 *
 * Both changes run under the panel's plugin lock (the lock install, update
 * and package replacement take), so a removal can never interleave with an
 * install of a package from the scope it removes. Each change is audited
 * with the strict `recordAudit` — a trust change that cannot be audited is
 * not made — and announced to the administrators.
 */

import {
  BUILTIN_TRUSTED_SCOPE,
  MAX_ADDITIONAL_TRUSTED_SCOPES,
  isNpmScope,
} from '@lamalibre/lamaste';
import { recordAudit } from './audit.js';
import { updateConfig } from './config.js';
import { notifyAdminsBestEffort } from './notifications.js';
import { readPlugins, withPluginLock } from './plugins.js';
import { readPushInstallConfig } from './push-install.js';
import {
  additionalTrustedScopes,
  assertRegistryHostsScope,
  getTrustedScopes,
} from './trusted-scopes.js';

function refusal(message, statusCode, code, extra = {}) {
  return Object.assign(new Error(message), { statusCode, code, ...extra });
}

/** What `GET /api/settings/trusted-scopes` answers. */
export function trustedScopesView() {
  return {
    builtIn: BUILTIN_TRUSTED_SCOPE,
    additional: additionalTrustedScopes(),
    effective: [...getTrustedScopes()],
  };
}

function checkScope(scope) {
  if (!isNpmScope(scope)) {
    throw refusal(
      `"${String(scope).slice(0, 80)}" is not an npm scope (@ followed by lowercase letters, digits and hyphens)`,
      400,
      'invalid_scope',
    );
  }
  if (scope === BUILTIN_TRUSTED_SCOPE) {
    throw refusal(
      `${BUILTIN_TRUSTED_SCOPE} is always trusted and is not added or removed`,
      400,
      'builtin_scope',
    );
  }
}

/**
 * Write the list, then audit the change; when the audit cannot be written
 * the previous list is put back and the error thrown — a trust change is
 * never in effect without its audit entry.
 */
async function changeAudited(previous, next, entry) {
  await updateConfig({ trustedScopes: next });
  try {
    await recordAudit(entry);
  } catch (err) {
    await updateConfig({ trustedScopes: previous });
    throw err;
  }
}

/** Whether `name` (a package name, maybe with a version) is in `scope`. */
function inScope(name, scope) {
  return typeof name === 'string' && name.startsWith(`${scope}/`);
}

/**
 * What still uses `scope` on this relay: installed plugins (whatever their
 * status or hosting — a pending update is of an installed plugin's own
 * package) and push-install policy entries.
 */
async function usesOfScope(scope) {
  const { plugins } = await readPlugins();
  const installed = plugins.filter((p) => inScope(p.packageName, scope)).map((p) => p.packageName);
  const config = await readPushInstallConfig();
  const policies = (config.policies ?? [])
    .filter((p) => (p.allowedPlugins ?? []).some((name) => inScope(name, scope)))
    .map((p) => p.id);
  return { plugins: installed, policies };
}

/**
 * Trust `scope`. The configured registry must host it (a scope trusted
 * without a registry that holds it closed would be resolved from npmjs).
 * @param {string} scope
 * @param {{ actor: string, log?: import('pino').Logger }} who
 */
export function addTrustedScope(scope, { actor, log }) {
  return withPluginLock(async () => {
    checkScope(scope);
    const current = additionalTrustedScopes();
    if (current.includes(scope)) {
      throw refusal(`${scope} is already trusted`, 409, 'scope_already_trusted');
    }
    if (current.length >= MAX_ADDITIONAL_TRUSTED_SCOPES) {
      throw refusal(
        `At most ${MAX_ADDITIONAL_TRUSTED_SCOPES} additional scopes can be trusted`,
        409,
        'too_many_scopes',
      );
    }
    await assertRegistryHostsScope(scope, { fresh: true });
    await changeAudited(current, [...current, scope], {
      actor,
      action: 'settings.trusted-scope.added',
      details: { scope },
    });
    log?.info({ scope }, 'Trusted publisher scope added');
    await notifyAdminsBestEffort(
      {
        source: 'lamaste',
        level: 'warning',
        message: `${scope} is now a trusted publisher scope: its plugins run with the same privileges as Lamalibre's own (by ${actor})`,
      },
      log,
    );
    return trustedScopesView();
  });
}

/**
 * Stop trusting `scope` — refused while anything on this relay uses it.
 * @param {string} scope
 * @param {{ actor: string, log?: import('pino').Logger }} who
 */
export function removeTrustedScope(scope, { actor, log }) {
  return withPluginLock(async () => {
    checkScope(scope);
    const current = additionalTrustedScopes();
    if (!current.includes(scope)) {
      throw refusal(`${scope} is not trusted`, 404, 'scope_not_trusted');
    }
    const uses = await usesOfScope(scope);
    if (uses.plugins.length > 0 || uses.policies.length > 0) {
      const parts = [];
      if (uses.plugins.length > 0) parts.push(`installed plugins ${uses.plugins.join(', ')}`);
      if (uses.policies.length > 0) parts.push(`push-install policies ${uses.policies.join(', ')}`);
      throw refusal(
        `${scope} is still used by ${parts.join(' and ')} — uninstall the plugins and edit the policies first`,
        409,
        'scope_in_use',
        uses,
      );
    }
    await changeAudited(
      current,
      current.filter((s) => s !== scope),
      { actor, action: 'settings.trusted-scope.removed', details: { scope } },
    );
    log?.info({ scope }, 'Trusted publisher scope removed');
    await notifyAdminsBestEffort(
      {
        source: 'lamaste',
        level: 'info',
        message: `${scope} is no longer a trusted publisher scope; agents stop using it at their next sync (by ${actor})`,
      },
      log,
    );
    return trustedScopesView();
  });
}

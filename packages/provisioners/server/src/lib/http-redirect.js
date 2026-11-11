import { execa } from 'execa';
import { readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import {
  HTTPS_DEFAULT_SITE,
  HTTP_REDIRECT_SITE,
  generateHttpRedirectVhost,
  generateHttpsDefaultVhost,
} from './service-config.js';

/**
 * Install or refresh one of the installer's own nginx sites, test nginx, and
 * reload it. Idempotent. Run as root. On a failed `nginx -t` the previous
 * state is restored and the error is thrown.
 *
 * @param {{ site: string, content: string, what: string, reload: boolean }} spec
 * @returns {Promise<{ changed: boolean }>}
 */
async function ensureSite({ site, content, what, reload }) {
  const available = `/etc/nginx/sites-available/${site}`;
  const enabled = `/etc/nginx/sites-enabled/${site}`;
  const previous = existsSync(available) ? await readFile(available, 'utf8') : null;
  const wasEnabled = existsSync(enabled);
  if (previous === content && wasEnabled) return { changed: false };

  await writeFile(available, content, { mode: 0o644 });
  if (!wasEnabled) await symlink(available, enabled);

  try {
    await execa('nginx', ['-t']);
  } catch (err) {
    if (previous === null) await rm(available, { force: true });
    else await writeFile(available, previous, { mode: 0o644 });
    if (!wasEnabled) await rm(enabled, { force: true });
    throw new Error(`nginx rejected ${what}; left as it was:\n${err.stderr || err.message}`);
  }
  if (reload) await execa('systemctl', ['reload', 'nginx']);
  return { changed: true };
}

/**
 * Install or refresh the port-80 → HTTPS redirect site.
 *
 * @param {{ reload?: boolean }} [options] - reload nginx afterwards (default true)
 * @returns {Promise<{ changed: boolean }>}
 */
export function ensureHttpRedirect({ reload = true } = {}) {
  return ensureSite({
    site: HTTP_REDIRECT_SITE,
    content: generateHttpRedirectVhost(),
    what: 'the HTTP → HTTPS redirect site',
    reload,
  });
}

/**
 * Install or refresh the port-443 catch-all that refuses, at the TLS
 * handshake, every hostname no site of the relay serves.
 *
 * @param {{ reload?: boolean }} [options] - reload nginx afterwards (default true)
 * @returns {Promise<{ changed: boolean }>}
 */
export function ensureHttpsDefault({ reload = true } = {}) {
  return ensureSite({
    site: HTTPS_DEFAULT_SITE,
    content: generateHttpsDefaultVhost(),
    what: 'the HTTPS catch-all site',
    reload,
  });
}

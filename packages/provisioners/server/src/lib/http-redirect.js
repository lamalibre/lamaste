import { execa } from 'execa';
import { readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { HTTP_REDIRECT_SITE, generateHttpRedirectVhost } from './service-config.js';

const AVAILABLE = `/etc/nginx/sites-available/${HTTP_REDIRECT_SITE}`;
const ENABLED = `/etc/nginx/sites-enabled/${HTTP_REDIRECT_SITE}`;

/**
 * Install or refresh the port-80 → HTTPS redirect site, test nginx, and
 * reload it. Idempotent. Run as root. On a failed `nginx -t` the previous
 * state is restored and the error is thrown.
 *
 * @param {{ reload?: boolean }} [options] - reload nginx afterwards (default true)
 * @returns {Promise<{ changed: boolean }>}
 */
export async function ensureHttpRedirect({ reload = true } = {}) {
  const content = generateHttpRedirectVhost();
  const previous = existsSync(AVAILABLE) ? await readFile(AVAILABLE, 'utf8') : null;
  const wasEnabled = existsSync(ENABLED);
  if (previous === content && wasEnabled) return { changed: false };

  await writeFile(AVAILABLE, content, { mode: 0o644 });
  if (!wasEnabled) await symlink(AVAILABLE, ENABLED);

  try {
    await execa('nginx', ['-t']);
  } catch (err) {
    if (previous === null) await rm(AVAILABLE, { force: true });
    else await writeFile(AVAILABLE, previous, { mode: 0o644 });
    if (!wasEnabled) await rm(ENABLED, { force: true });
    throw new Error(
      `nginx rejected the HTTP → HTTPS redirect site; left as it was:\n${err.stderr || err.message}`,
    );
  }
  if (reload) await execa('systemctl', ['reload', 'nginx']);
  return { changed: true };
}

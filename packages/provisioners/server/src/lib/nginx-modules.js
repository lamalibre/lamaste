import { execa } from 'execa';

/**
 * What the relay's nginx must be built with. The auth portal's vhost
 * rewrites Authelia's index HTML for a domain's brand with `sub_filter`
 * (`ngx_http_sub_module`, packages/core/docs/auth-branding-design.md), and
 * nginx refuses a configuration naming a directive of a module it lacks —
 * `nginx -t` fails and the panel cannot write any auth vhost. Ubuntu
 * 24.04's `nginx` package is built with it; a reduced build (Debian's
 * `nginx-light`, a custom build without `--with-http_sub_module`) is not.
 *
 * Only a module compiled in counts: `--with-http_sub_module=dynamic` makes
 * a module nginx loads only with a `load_module` directive in nginx.conf,
 * which Lamaste neither writes nor allows in a vhost.
 */
export const NGINX_SUB_MODULE_FLAG = '--with-http_sub_module';

/**
 * Whether `nginx -V`'s output says the binary was built with the sub module
 * compiled in. The output (nginx writes it to stderr) carries one
 * `configure arguments:` line of space-separated flags; the flag must be
 * there as a whole word — `=dynamic` or any other suffix does not count.
 *
 * @param {string} output - stdout and stderr of `nginx -V`
 */
export function hasSubModule(output) {
  const line = String(output)
    .split(/\r?\n/)
    .find((l) => l.startsWith('configure arguments:'));
  if (!line) return false;
  return line.slice('configure arguments:'.length).split(/\s+/).includes(NGINX_SUB_MODULE_FLAG);
}

/** The version line of `nginx -V` (`nginx version: nginx/1.24.0 (Ubuntu)`), or null. */
export function nginxVersionLine(output) {
  return (
    String(output)
      .split(/\r?\n/)
      .find((l) => l.startsWith('nginx version:')) ?? null
  );
}

/** The refusal of an nginx without the sub module compiled in. */
export function nginxSubModuleMissingError(output) {
  const version = nginxVersionLine(output);
  return new Error(
    `${version ? `${version.replace('nginx version: ', '')} at` : 'The nginx on'} this relay is not built with the HTTP sub module ` +
      `(${NGINX_SUB_MODULE_FLAG} in \`nginx -V\`), which Lamaste's sign-in pages need. ` +
      `Install a build that has it compiled in: on Ubuntu 24.04 the \`nginx\` package (\`apt-get install nginx\`; ` +
      `on Debian also \`nginx-full\` or \`nginx-extras\`, never \`nginx-light\`), or configure a source build with ${NGINX_SUB_MODULE_FLAG}. ` +
      'A dynamic build (`=dynamic`) does not count. Nothing was changed.',
  );
}

/**
 * The output of `nginx -V` — stdout and stderr together (nginx prints the
 * build information to stderr).
 *
 * @param {{ exec?: typeof execa }} [options]
 */
export async function nginxBuildInfo({ exec = execa } = {}) {
  let result;
  try {
    result = await exec('nginx', ['-V'], { reject: false });
  } catch (error) {
    throw new Error(`nginx is not installed or \`nginx -V\` could not run: ${error.message}`);
  }
  return `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
}

/**
 * Fail unless the installed nginx is built with the sub module (see
 * {@link NGINX_SUB_MODULE_FLAG}). Run before anything on the relay changes:
 * right after nginx is installed on a fresh relay, and first on a redeploy.
 * Returns the version line for the task's output.
 *
 * @param {{ exec?: typeof execa }} [options]
 */
export async function assertNginxSubModule(options = {}) {
  const output = await nginxBuildInfo(options);
  if (!hasSubModule(output)) throw nginxSubModuleMissingError(output);
  return nginxVersionLine(output) ?? 'nginx';
}

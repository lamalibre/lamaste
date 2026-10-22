/**
 * A stand-in `sudo` for tests of what the panel writes into nginx: the
 * vhosts `lamaste-priv nginx-site write` would install land in a directory
 * of the test's, `enable`/`disable`/`remove` keep a link state beside them,
 * certbot finds no certificate (so a tunnel's vhost is written on its own
 * lineage), and `nginx -t`, reloads, chisel restarts and the rest succeed
 * (as does `chgrp`, for the chisel authfile).
 *
 * `installFakeSudo(dir)` writes the script, puts it first on PATH for this
 * test process (each test file runs in its own) and returns the controls,
 * among them the deps of the vhost reconcile over that directory.
 */

import { existsSync } from 'node:fs';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * @param {string} dir
 */
export async function installFakeSudo(dir) {
  const bin = path.join(dir, 'bin');
  const captured = path.join(dir, 'sites-available');
  const enabled = path.join(dir, 'sites-enabled');
  await mkdir(bin, { recursive: true });
  await mkdir(captured, { recursive: true });
  await mkdir(enabled, { recursive: true });
  const script = path.join(bin, 'sudo');
  await writeFile(
    script,
    `#!/bin/sh
case "$1" in
  */lamaste-priv)
    if [ "$2" = nginx-site ]; then
      case "$3" in
        write) cat > "${captured}/$4" ;;
        enable) : > "${enabled}/$4" ;;
        disable) rm -f "${enabled}/$4" ;;
        remove) rm -f "${captured}/$4" "${enabled}/$4" ;;
      esac
    fi
    exit 0 ;;
  */lamaste-certbot)
    if [ "$2" = list ]; then echo "No certificates found"; fi
    exit 0 ;;
  */lamaste-cert-info)
    exit 3 ;;
esac
exit 0
`,
  );
  await chmod(script, 0o755);
  // The chisel authfile goes to the group chisel runs as, which a test
  // machine does not have.
  const chgrp = path.join(bin, 'chgrp');
  await writeFile(chgrp, '#!/bin/sh\nexit 0\n');
  await chmod(chgrp, 0o755);
  process.env.PATH = `${bin}${path.delimiter}${process.env.PATH}`;

  /** The vhost `name` as written, or null. */
  async function read(name) {
    try {
      return await readFile(path.join(captured, name), 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }

  const isEnabled = (name) => existsSync(path.join(enabled, name));

  return {
    captured,
    read,
    isEnabled,
    /**
     * The deps of `reconcileTunnelVhosts` / `reconcileUserSurfaceVhosts`
     * over the written vhosts: the panel's state and plugins, nginx writes
     * through this sudo.
     *
     * @param {{ readTunnels: Function, installVhost: Function, servedUserSurfaceRoutes: Function }} lib
     */
    reconcileDeps(lib) {
      return {
        readTunnels: lib.readTunnels,
        readInstalledVhost: read,
        installVhost: lib.installVhost,
        isSiteEnabled: async (name) => isEnabled(name),
        servedUserSurface: lib.servedUserSurfaceRoutes,
      };
    },
  };
}

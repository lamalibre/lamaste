/**
 * The dependency objects the core tunnel workflows take
 * (`@lamalibre/lamaste/server` createTunnel, updateTunnel, ...), wired to the
 * daemon's nginx, certbot, chisel and state modules. Shared by the tunnel
 * routes and by agent revocation.
 */

import {
  writePublicVhost,
  writeGatekeeperVhost as writeGatekeeperVhostOf,
  removeAppVhost,
  enableAppVhost,
  disableAppVhost,
  writeAgentPanelVhost,
  removeAgentPanelVhost,
  enableAgentPanelVhost,
  disableAgentPanelVhost,
} from './nginx.js';
import { issueTunnelCert } from './certbot.js';
import { syncChisel } from './chisel.js';
import { nativeHostOf } from './native-files.js';
import { readTunnels, writeTunnels } from './state.js';

/**
 * An `authenticated` or `restricted` tunnel's vhost, with what the host's
 * served native client needs (native-apps-design.md D6, R2): its
 * association files and redirect paths, and no `Authorization` to the
 * backend. A failed lookup fails the write — never a vhost without them.
 */
async function writeGatekeeperVhost(fqdn, domain, port, certPath, opts = {}) {
  return writeGatekeeperVhostOf(fqdn, domain, port, certPath, {
    ...opts,
    native: await nativeHostOf(fqdn),
  });
}

export const tunnelNginxDeps = Object.freeze({
  writePublicVhost,
  writeGatekeeperVhost,
  writeAgentPanelVhost,
  removeAppVhost,
  removeAgentPanelVhost,
  enableAppVhost,
  disableAppVhost,
  enableAgentPanelVhost,
  disableAgentPanelVhost,
});

export const tunnelCertbotDeps = Object.freeze({ issueTunnelCert });

export const tunnelChiselDeps = Object.freeze({ syncChisel });

export const tunnelStateDeps = Object.freeze({ readTunnels, writeTunnels });

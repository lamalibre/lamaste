/**
 * The dependency objects the core tunnel workflows take
 * (`@lamalibre/lamaste/server` createTunnel, updateTunnel, ...), wired to the
 * daemon's nginx, certbot, chisel and state modules. Shared by the tunnel
 * routes and by agent revocation.
 */

import {
  writePublicVhost,
  writeAuthenticatedVhost,
  writeRestrictedVhost,
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
import { readTunnels, writeTunnels } from './state.js';

export const tunnelNginxDeps = Object.freeze({
  writePublicVhost,
  writeAuthenticatedVhost,
  writeRestrictedVhost,
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

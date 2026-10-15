/**
 * Who may use an agent's panel through the relay, and what the relay then
 * asserts to that agent's `lamaste-agentd`.
 *
 * The agent-panel vhost (`agent-<label>.<domain>`) verifies the browser's
 * client certificate, then asks the panel — an nginx `auth_request` to
 * `GET /api/agent-panel/authz/<label>` — whether the request may go to the
 * agent. The panel's mTLS middleware has already turned the certificate
 * into a role and refused a revoked one; this decides the rest, and the
 * panel signs a relay assertion (`relay-assertion.ts`) for the request,
 * which nginx forwards with it. The daemon trusts nothing else from the
 * relay: before this, it read the caller from `X-SSL-Client-*` headers
 * that anything able to reach its loopback port could write.
 *
 * Pure: the caller passes the tunnel state and signs.
 */

import { AGENT_LABEL_REGEX } from '../constants.js';
import type { RelayCaller } from '../relay-assertion.js';
import type { TunnelEntry } from './tunnels.js';

const METHOD_RE = /^[A-Z]{1,16}$/;
const MAX_URI_LENGTH = 4096;
// eslint-disable-next-line no-control-regex
const URI_FORBIDDEN_RE = /[\u0000- \u007f]/;

export interface AgentPanelAuthzRequest {
  /** The agent whose panel the vhost serves (fixed in the vhost's configuration). */
  readonly label: string;
  /** Role the mTLS middleware derived from the client certificate. */
  readonly certRole: string | undefined;
  /** Agent label of an agent certificate, `null` for admin. */
  readonly certLabel: string | null | undefined;
  /** `$request_method` of the request nginx is authorizing. */
  readonly method: string | undefined;
  /** `$request_uri` of that request — sent to the agent unchanged. */
  readonly uri: string | undefined;
}

/** A caller the agent-panel vhost admits: a certificate holder, never a user. */
type CertificateCaller = Extract<RelayCaller, { type: 'admin' | 'agent' }>;

export type AgentPanelAuthzDecision =
  | {
      readonly ok: true;
      readonly aud: string;
      /** The panel tunnel's port: the port the agent's daemon listens on. */
      readonly port: number;
      readonly caller: CertificateCaller;
      readonly method: string;
      readonly path: string;
    }
  | {
      readonly ok: false;
      readonly status: 400 | 403;
      readonly reason: 'invalid_request' | 'no_panel_tunnel' | 'not_authorized';
    };

/** The enabled panel tunnel of `label`, if it has one. */
export function findAgentPanelTunnel(
  tunnels: readonly TunnelEntry[],
  label: string,
): TunnelEntry | undefined {
  return tunnels.find(
    (t) =>
      t.type === 'panel' &&
      t.exposure !== 'internal' &&
      t.agentLabel === label &&
      t.subdomain === `agent-${label}` &&
      t.enabled !== false,
  );
}

/**
 * Decide one agent-panel request. Admitted: the administrator certificate,
 * and the certificate of the agent the panel belongs to (its capabilities
 * are checked by the daemon). Refused: every other agent, plugin-agent
 * certificates, and any agent without an enabled panel tunnel.
 */
export function authorizeAgentPanelRequest(
  req: AgentPanelAuthzRequest,
  tunnels: readonly TunnelEntry[],
): AgentPanelAuthzDecision {
  const { label, method, uri } = req;
  if (
    !AGENT_LABEL_REGEX.test(label) ||
    typeof method !== 'string' ||
    !METHOD_RE.test(method) ||
    typeof uri !== 'string' ||
    !uri.startsWith('/') ||
    uri.length > MAX_URI_LENGTH ||
    URI_FORBIDDEN_RE.test(uri)
  ) {
    return { ok: false, status: 400, reason: 'invalid_request' };
  }

  let caller: CertificateCaller;
  if (req.certRole === 'admin') {
    caller = { type: 'admin' };
  } else if (req.certRole === 'agent' && req.certLabel === label) {
    caller = { type: 'agent', label };
  } else {
    return { ok: false, status: 403, reason: 'not_authorized' };
  }

  const tunnel = findAgentPanelTunnel(tunnels, label);
  if (!tunnel) return { ok: false, status: 403, reason: 'no_panel_tunnel' };

  return { ok: true, aud: label, port: tunnel.port, caller, method, path: uri };
}

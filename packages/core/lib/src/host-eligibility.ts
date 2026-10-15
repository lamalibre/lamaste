/**
 * Which agents can host a plugin: the manifest's `agent.requires` and, when
 * Lamaste installs the agent half, what installing it needs — checked
 * against the host facts the agent reported. Pure: the relay calls it for
 * the host dialog and again when a hosting starts.
 */

import semver from 'semver';

import { APPHOST_PROTOCOL_VERSION } from './agent-half.js';
import type { AgentHalfDeclaration } from './agent-half.js';
import type { AgentRequires, HostFacts } from './schemas.js';

export interface HostEligibility {
  readonly eligible: boolean;
  /** Why the agent cannot host the plugin, one sentence each; empty when it can. */
  readonly reasons: string[];
}

/** What the relay itself brings to the check. */
export interface HostEligibilityRelay {
  /**
   * The id of the key the relay signs app jobs with; null when its signing
   * key is unusable — then it can have no agent half installed anywhere.
   */
  readonly relayKid: string | null;
}

/** Enough of a key id to compare by eye. */
function shortKid(kid: string): string {
  return kid.slice(0, 12);
}

const OS_NAMES: Readonly<Record<HostFacts['os'], string>> = { linux: 'Linux', darwin: 'macOS' };

/** Distributions apt-get installs system packages on. */
const DEBIAN_FAMILY = ['debian', 'ubuntu'];

/**
 * Whether an agent with host facts `facts` can host a plugin that requires
 * `requires` and, with `agentHalf`, whose agent half Lamaste installs.
 * `facts` is null while the agent has not reported any. `requires.node` is
 * checked against the Node.js the agent half will run on: the app host
 * helper's (`facts.apphost.node`) for one Lamaste installs, the agent's own
 * (`facts.node`) for one installed by hand. An agent half Lamaste installs
 * also needs the helper to trust the key this relay signs app jobs with
 * (`relay.relayKid`): the agent's pinned key (`facts.apphost.relayKid`)
 * must be it.
 */
export function hostEligibility(
  requires: AgentRequires | null | undefined,
  agentHalf: AgentHalfDeclaration | null,
  facts: HostFacts | null,
  relay: HostEligibilityRelay,
): HostEligibility {
  if (!facts) {
    return {
      eligible: false,
      reasons: [
        'The agent has not reported its host yet — its sync is not running, or its lamaste-agent is too old to report it',
      ],
    };
  }
  const reasons: string[] = [];

  if (requires?.os && !requires.os.includes(facts.os)) {
    reasons.push(
      `The plugin runs on ${requires.os.map((os) => OS_NAMES[os]).join(' or ')}; ` +
        `the agent runs ${OS_NAMES[facts.os]}`,
    );
  }

  if (requires?.node !== undefined) {
    if (semver.validRange(requires.node) === null) {
      reasons.push(`The plugin's Node.js requirement "${requires.node}" is not a semver range`);
    } else if (agentHalf) {
      // An agent half Lamaste installs runs on the app host helper's Node.js
      // (its unit's ExecStart), whatever the agent itself runs on. Without
      // the helper there is none to check yet — that reason follows below.
      if (facts.apphost && !semver.satisfies(facts.apphost.node, requires.node)) {
        reasons.push(
          `The plugin needs Node.js ${requires.node}; the agent half would run on ` +
            `${facts.apphost.node} (the Node.js of the agent's app host helper)`,
        );
      }
    } else if (!semver.satisfies(facts.node, requires.node)) {
      reasons.push(`The plugin needs Node.js ${requires.node}; the agent has ${facts.node}`);
    }
  }

  if (agentHalf) {
    if (facts.os !== 'linux') {
      reasons.push(
        `Lamaste installs an agent half only on a Linux agent; the agent runs ${OS_NAMES[facts.os]}`,
      );
    } else {
      if (!facts.systemd) {
        reasons.push(
          'The agent half runs as a systemd service, and systemd is not the system manager on the agent',
        );
      }
      if (!facts.apphost) {
        reasons.push(
          'The app host helper is not enabled on the agent (sudo lamaste-agent apphost enable)',
        );
      } else {
        if (facts.apphost.version < APPHOST_PROTOCOL_VERSION) {
          reasons.push(
            `The agent's app host helper speaks protocol ${facts.apphost.version}; this relay needs ` +
              `${APPHOST_PROTOCOL_VERSION} (update lamaste-agent, then sudo lamaste-agent apphost enable)`,
          );
        }
        if (relay.relayKid === null) {
          reasons.push(
            "The relay's signing key is unusable, so it cannot sign the jobs the agent's app host " +
              "helper runs (see the panel's log)",
          );
        } else if (facts.apphost.relayKid === null) {
          reasons.push(
            "The agent's app host helper has no key of this relay pinned; re-pin the relay key: " +
              'sudo lamaste-agent apphost pin',
          );
        } else if (facts.apphost.relayKid !== relay.relayKid) {
          reasons.push(
            `The agent's app host helper trusts relay key ${shortKid(facts.apphost.relayKid)}, ` +
              `but this relay signs with ${shortKid(relay.relayKid)}; re-pin the relay key: ` +
              'sudo lamaste-agent apphost pin',
          );
        }
      }
      if (agentHalf.systemPackages.length > 0) {
        const family = facts.distro ? [facts.distro.id, ...facts.distro.idLike] : [];
        if (!family.some((id) => DEBIAN_FAMILY.includes(id))) {
          reasons.push(
            `The plugin needs system packages (${agentHalf.systemPackages.join(', ')}), which ` +
              `Lamaste installs on Debian or Ubuntu only; the agent runs ` +
              `${facts.distro ? `"${facts.distro.id}"` : 'an unknown distribution'}`,
          );
        }
      }
    }
  }

  return { eligible: reasons.length === 0, reasons };
}

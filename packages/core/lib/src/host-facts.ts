/**
 * The hash of an agent's host facts (`HostFactsSchema`) — shared by
 * the agent, which reports its facts when their hash changed, and the
 * relay, which tells the agent in its agent-config answer the hash of the
 * facts it stores for it (`hostFactsHash`). The agent compares the two, so
 * an agent whose record on the relay was replaced (re-enrolled on the same
 * label, a restored backup) reports again on its next sync instead of the
 * next day.
 */

import crypto from 'node:crypto';

import type { HostFacts } from './schemas.js';

/** A {@link hostFactsHash}: SHA-256, lowercase hex. */
export const HOST_FACTS_HASH_RE = /^[a-f0-9]{64}$/;

/**
 * SHA-256 of the facts in a fixed field order — what decides whether they
 * changed. The relay and the agent compare their hashes, so the canonical
 * form is part of their contract: a field added later must leave the hash
 * of facts without it as it was (an absent field is left out, not set).
 */
export function hostFactsHash(facts: HostFacts): string {
  const canonical = {
    os: facts.os,
    arch: facts.arch,
    distro:
      facts.distro === null
        ? null
        : { id: facts.distro.id, idLike: facts.distro.idLike, versionId: facts.distro.versionId },
    node: facts.node,
    systemd: facts.systemd,
    apphost:
      facts.apphost === null
        ? null
        : {
            version: facts.apphost.version,
            node: facts.apphost.node,
            relayKid: facts.apphost.relayKid,
          },
  };
  return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

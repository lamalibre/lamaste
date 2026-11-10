/**
 * Calls and events between app plugins (slice 8): the words and the small
 * pure helpers the Peers page, a plugin card's Peers section and the
 * approval preview share. `GET /api/peers` is the source:
 * `{ shelves: [{ shelfId, appliedAt, appliedBy, edges: [{ scope, provider,
 * consumer, state, reason?, grantedSeq }] }], plugins, edges, channels,
 * readiness }`.
 */

/** Why an applied edge is pending, in words. */
const PENDING_REASONS = {
  consumer_not_installed: 'the consumer is not installed',
  provider_not_installed: 'the provider is not installed',
  not_consumed: 'the consumer’s installed version does not consume the scope',
  not_provided: 'the provider’s installed version does not provide the scope',
  consumer_not_approved: 'the consumer’s installed version is not approved',
  provider_not_approved: 'the provider’s installed version is not approved',
  major_mismatch: 'the consumer speaks a major the provider does not serve',
};

export function pendingReasonText(reason) {
  return PENDING_REASONS[reason] ?? reason ?? 'pending';
}

/** Why an update ends or narrows an edge (`pendingUpdate.peers.breaks[].reason`). */
const BREAK_REASONS = {
  scope_removed: 'the scope is gone',
  major_removed: 'the major it speaks is no longer served',
  endpoints_removed: 'endpoints it may call are gone',
  events_removed: 'events it subscribes to are no longer published',
};

export function breakReasonText(reason) {
  return BREAK_REASONS[reason] ?? reason;
}

/** A peer channel's state, in words. */
export function channelStateText(channel) {
  if (!channel) return 'no channel';
  return (
    {
      attached: 'attached',
      attaching: 'attaching…',
      backoff: 'retrying',
      detached: 'detached',
    }[channel.state] ?? channel.state
  );
}

/**
 * Every applied edge that touches `route`, from the shelves of
 * `GET /api/peers`: `incoming` (other plugins consuming its scopes) and
 * `outgoing` (scopes it consumes), each with the shelves that grant it.
 * An edge granted by two shelves is listed once.
 */
export function edgesOf(view, route) {
  const incoming = new Map();
  const outgoing = new Map();
  for (const shelf of view?.shelves ?? []) {
    for (const edge of shelf.edges) {
      const target = edge.provider === route ? incoming : edge.consumer === route ? outgoing : null;
      if (!target) continue;
      const key = `${edge.consumer} ${edge.scope}`;
      const known = target.get(key);
      if (known) {
        known.shelves.push(shelf.shelfId);
        // Effective as soon as any shelf's copy is.
        if (edge.state === 'effective') Object.assign(known, { state: 'effective', reason: null });
      } else {
        target.set(key, { ...edge, reason: edge.reason ?? null, shelves: [shelf.shelfId] });
      }
    }
  }
  const sorted = (map) =>
    [...map.values()].sort((a, b) =>
      `${a.scope} ${a.consumer}`.localeCompare(`${b.scope} ${b.consumer}`),
    );
  return { incoming: sorted(incoming), outgoing: sorted(outgoing) };
}

/** Whether a plugin's `peers` block declares anything. */
export function declaresPeers(block) {
  return (
    !!block &&
    (Object.keys(block.provides ?? {}).length > 0 || Object.keys(block.consumes ?? {}).length > 0)
  );
}

/**
 * Parse what an administrator pasted as a shelf's scope graph: the shelf
 * manifest's `scopes` block, or a whole shelf manifest holding one. Returns
 * `{ scopes }` or `{ error }`; the relay checks the rest.
 */
export function parseShelfScopes(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return { error: 'Not JSON' };
  }
  if (value && typeof value === 'object' && !Array.isArray(value) && value.scopes) {
    value = value.scopes;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { error: 'Expected a scopes block: { "<scope>": { "provider", "consumers" } }' };
  }
  return { scopes: value };
}

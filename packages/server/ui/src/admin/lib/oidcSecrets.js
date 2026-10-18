/**
 * Secrets of confidential OIDC clients a plugin change created. The panel
 * hands each out once — in the response of the install or enable call that
 * created it, or on the first read of a finished update operation — and can
 * only rotate it afterwards. These helpers carry a secret from that response
 * straight to the dialog that shows it: never into the query cache, the
 * browser's storage or a log.
 */

/**
 * The well-formed `{ id, secret }` pairs of a response's `oidcClients`.
 *
 * @param {unknown} oidcClients
 * @returns {Array<{ id: string, secret: string }>}
 */
export function createdSecrets(oidcClients) {
  if (!Array.isArray(oidcClients)) return [];
  return oidcClients
    .filter(
      (c) =>
        c !== null &&
        typeof c === 'object' &&
        typeof c.id === 'string' &&
        c.id !== '' &&
        typeof c.secret === 'string' &&
        c.secret !== '',
    )
    .map(({ id, secret }) => ({ id, secret }));
}

/**
 * A response split into what may be kept (`result`, without `oidcClients`)
 * and the secrets it carried.
 *
 * @template T
 * @param {T} response
 * @returns {{ result: T, secrets: Array<{ id: string, secret: string }> }}
 */
export function withoutSecrets(response) {
  if (response === null || typeof response !== 'object') return { result: response, secrets: [] };
  const { oidcClients, ...result } = response;
  return { result, secrets: createdSecrets(oidcClients) };
}

/**
 * What the panel does about the secrets of operation `op`, given how this
 * panel follows it (`followed`: started here; `reading`: its one read is
 * under way; undefined: started elsewhere — another panel, the CLI — or
 * before the page was reloaded):
 *
 * - `read`: started here and its secrets wait — read them now;
 * - `reading`: the read is under way;
 * - `offer`: its secrets wait — read them when the administrator asks, so
 *   a CLI following its own operation is not robbed of them;
 * - `forget`: started here and finished with nothing to show;
 * - null: nothing to do (still running, or nothing waits).
 *
 * @param {{ status: string, revealPending?: boolean }} op
 * @param {'followed' | 'reading' | undefined} follow
 * @returns {'read' | 'reading' | 'offer' | 'forget' | null}
 */
export function operationSecretsAction(op, follow) {
  if (op.status === 'running') return null;
  if (follow === 'reading') return 'reading';
  if (op.revealPending === true) return follow === 'followed' ? 'read' : 'offer';
  return follow === 'followed' ? 'forget' : null;
}

/**
 * A plugin's operations query data with operation `id`'s secrets marked as
 * read — they are handed out once, so the list stops offering them at once.
 *
 * @param {{ operations?: Array<{ id: string }> } | undefined} data
 * @param {string} id
 */
export function markSecretsRead(data, id) {
  if (!data?.operations) return data;
  return {
    ...data,
    operations: data.operations.map((op) => (op.id === id ? { ...op, revealPending: false } : op)),
  };
}

/** The secrets waiting for the administrator, the first one shown first. */
export const initialRevealState = { next: 1, queue: [] };

/**
 * `{ type: 'reveal', plugin, cause, secrets }` queues secrets to show (none
 * queues nothing); `{ type: 'acknowledge', key }` drops the ones shown, once
 * the administrator confirmed they stored them.
 *
 * @param {{ next: number, queue: Array<{ key: number, plugin: string, cause: string, secrets: Array<{ id: string, secret: string }> }> }} state
 * @param {{ type: 'reveal', plugin: string, cause: string, secrets: unknown } | { type: 'acknowledge', key: number }} action
 */
export function revealReducer(state, action) {
  switch (action.type) {
    case 'reveal': {
      const secrets = createdSecrets(action.secrets);
      if (secrets.length === 0) return state;
      const reveal = { key: state.next, plugin: action.plugin, cause: action.cause, secrets };
      return { next: state.next + 1, queue: [...state.queue, reveal] };
    }
    case 'acknowledge':
      // By key: a second click on the same dialog must not drop the next one.
      if (state.queue[0]?.key !== action.key) return state;
      return { ...state, queue: state.queue.slice(1) };
    default:
      return state;
  }
}

/** What created the secrets: a call (`install`, `enable`) or an operation's kind. */
const CAUSE_VERB = { install: 'Installing', enable: 'Enabling', update: 'Updating' };

/**
 * "Updating fx created a confidential OIDC client" — what the dialog is
 * about.
 *
 * @param {{ plugin: string, cause: string, secrets: Array<unknown> }} reveal
 */
export function revealHeading({ plugin, cause, secrets }) {
  const what =
    secrets.length === 1
      ? 'a confidential OIDC client'
      : `${secrets.length} confidential OIDC clients`;
  const verb = CAUSE_VERB[cause];
  return verb ? `${verb} ${plugin} created ${what}` : `An operation on ${plugin} created ${what}`;
}

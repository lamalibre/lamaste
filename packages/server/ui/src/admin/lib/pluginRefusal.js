import { errorMessage, refusalOf } from './errorMessage.js';

/** What Lamaste does with the agent half for each push-install action. */
const PUSH_VERB = {
  install: 'installs',
  update: 'updates',
  uninstall: 'removes',
};

/**
 * A refused plugin operation (hosting, removing a hosting, uninstalling,
 * updating) explained for the panel: the panel's message, the reasons an
 * agent cannot host the plugin, and what lifts a refusal the administrator
 * can lift.
 *
 * @param {unknown} err  what the admin client rejected with
 * @param {{ agentLabel?: string | null, action?: 'install' | 'update' | 'uninstall' }} [context]
 *   the agent the operation pushes to and the push-install action it needs
 * @returns {{ message: string, code: string | null, reasons: string[], hint: string | null }}
 */
export function explainRefusal(err, { agentLabel = null, action = 'install' } = {}) {
  const { code, reasons } = refusalOf(err);
  const agent = agentLabel ? `agent "${agentLabel}"` : 'the hosting agent';
  let hint = null;
  if (code === 'push_install_refused') {
    hint =
      `Lamaste ${PUSH_VERB[action] ?? 'changes'} the agent half by push install: push install must be ` +
      `on for this relay and enabled for ${agent} with its window open, and the agent's policy must ` +
      `allow "${action}" of the agent package from your address.`;
  } else if (code === 'agent_not_eligible') {
    hint =
      'Each agent reports its host on its sync (about every 30 seconds) — once what the reasons name is fixed on the agent, it becomes eligible.';
  } else if (code === 'hooks_not_approved') {
    hint = 'Review and approve what the plugin brings under Lifecycle hooks on its card first.';
  }
  return { message: errorMessage(err), code, reasons, hint };
}

/** One line for a toast: the panel's message and, when there is one, what lifts the refusal. */
export function refusalText(err, context) {
  const { message, hint } = explainRefusal(err, context);
  return hint ? `${message} — ${hint}` : message;
}

/**
 * Effects of relay hooks — the only way a hook changes anything outside its
 * return value. Lamaste performs them with its own credentials:
 *
 * - `audit`         an audit log entry, actor `plugin:<route>`, action `hook.<event>`
 * - `notify-admins` a panel notification
 * - `log`           one metadata line in the panel's log
 *
 * A hook may only use the effect types its plugin declared (`hooks.relay.effects`,
 * shown in the approval) or, for a shared hook, the ones Lamaste defines for
 * it. Each type is rate-limited per plugin over a sliding minute; what is
 * refused or over the limit is dropped and counted, and the count is
 * audited at most once a minute per plugin.
 */

import { HOOK_EFFECT_LIMITS } from '@lamalibre/lamaste/hooks';
import { recordAuditBestEffort } from './audit.js';
import { notifyAdminsBestEffort } from './notifications.js';

const WINDOW_MS = 60_000;

/** `${plugin}\0${type}` → issue times within the window. */
const windows = new Map();
/** plugin → { refused, overLimit, lastReportAt } */
const drops = new Map();

function takeToken(plugin, type, now) {
  const key = `${plugin}\0${type}`;
  const limit = HOOK_EFFECT_LIMITS.perMinute[type];
  const times = (windows.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (times.length >= limit) {
    windows.set(key, times);
    return false;
  }
  times.push(now);
  windows.set(key, times);
  return true;
}

async function reportDrops(plugin, stage, now, logger) {
  const d = drops.get(plugin);
  if (!d || (d.refused === 0 && d.overLimit === 0)) return;
  if (now - d.lastReportAt < WINDOW_MS) return;
  const { refused, overLimit } = d;
  drops.set(plugin, { refused: 0, overLimit: 0, lastReportAt: now });
  await recordAuditBestEffort(
    {
      actor: 'lamaste',
      action: 'hooks.effects-dropped',
      plugin,
      details: { stage, refused, overLimit },
    },
    logger,
  );
}

function countDrop(plugin, kind) {
  const d = drops.get(plugin) ?? { refused: 0, overLimit: 0, lastReportAt: 0 };
  d[kind]++;
  drops.set(plugin, d);
}

/**
 * Perform the effects of one decision.
 *
 * @param {string} plugin
 * @param {string} stage
 * @param {ReadonlyArray<import('@lamalibre/lamaste/hooks').HookEffect>} effects validated
 * @param {ReadonlySet<string>} allowed effect types this hook may use
 * @param {import('pino').Logger} [logger]
 */
export async function performHookEffects(plugin, stage, effects, allowed, logger) {
  const now = Date.now();
  for (const effect of effects) {
    if (!allowed.has(effect.type)) {
      countDrop(plugin, 'refused');
      continue;
    }
    if (!takeToken(plugin, effect.type, now)) {
      countDrop(plugin, 'overLimit');
      continue;
    }
    switch (effect.type) {
      case 'audit':
        await recordAuditBestEffort(
          {
            actor: `plugin:${plugin}`,
            action: `hook.${effect.event}`,
            plugin,
            details: { stage, ...(effect.data ?? {}) },
          },
          logger,
        );
        break;
      case 'notify-admins':
        await notifyAdminsBestEffort(
          { source: `plugin:${plugin}`, level: effect.level ?? 'info', message: effect.message },
          logger,
        );
        break;
      case 'log': {
        const line = {
          plugin,
          stage,
          hookLog: effect.message,
          ...(effect.data ? { data: effect.data } : {}),
        };
        if (effect.level === 'warn') logger?.warn(line, 'Plugin hook log');
        else logger?.info(line, 'Plugin hook log');
        break;
      }
      default:
        countDrop(plugin, 'refused');
    }
  }
  await reportDrops(plugin, stage, now, logger);
}

/** Forget rate-limit state (tests). */
export function resetHookEffectLimitsForTests() {
  windows.clear();
  drops.clear();
}

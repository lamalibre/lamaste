/**
 * Cache invalidation hook registered by the gatekeeper server at startup.
 *
 * Library writers (grants, groups) call {@link notifyCacheInvalidated} after a
 * successful write so the in-memory session cache and version counter can be
 * updated deterministically — `fs.watch` is unreliable on network filesystems
 * and container bind mounts, so the explicit notification closes that gap.
 *
 * If no server is registered (e.g. a CLI-only process touching the files),
 * the notifier is a no-op.
 */

export type CacheInvalidator = () => void;

let invalidator: CacheInvalidator | null = null;

export function registerCacheInvalidator(fn: CacheInvalidator): void {
  invalidator = fn;
}

export function notifyCacheInvalidated(): void {
  invalidator?.();
}

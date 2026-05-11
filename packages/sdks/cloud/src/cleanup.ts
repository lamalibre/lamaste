/**
 * Cleanup stack — maintains a LIFO queue of rollback actions.
 *
 * On error, runs all registered cleanup actions in reverse order.
 * Individual failures are captured and returned so callers can surface
 * the specific dangling resources to the operator.
 */

type CleanupAction = () => Promise<void>;

/** A cleanup that failed while the stack was unwinding. */
export interface CleanupFailure {
  readonly label: string;
  readonly message: string;
}

/** Result of running all registered cleanups. */
export interface CleanupResult {
  readonly ok: boolean;
  readonly failures: readonly CleanupFailure[];
}

export class CleanupStack {
  readonly actions: Array<{ label: string; fn: CleanupAction }> = [];

  push(label: string, fn: CleanupAction): void {
    this.actions.push({ label, fn });
  }

  clear(): void {
    this.actions.length = 0;
  }

  async runAll(): Promise<CleanupResult> {
    const failures: CleanupFailure[] = [];
    // Run in reverse order
    for (let i = this.actions.length - 1; i >= 0; i--) {
      const action = this.actions[i]!;
      try {
        await action.fn();
      } catch (err: unknown) {
        failures.push({
          label: action.label,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return { ok: failures.length === 0, failures };
  }
}

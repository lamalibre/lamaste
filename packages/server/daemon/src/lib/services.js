import { execa } from 'execa';

export const ALLOWED_SERVICES = ['nginx', 'chisel', 'authelia', 'lamalibre-lamaste-serverd'];

const ALLOWED_ACTIONS = ['start', 'stop', 'restart', 'reload'];

/**
 * Format a duration in milliseconds to a human-readable string like "2d 5h 30m".
 */
function formatDuration(ms) {
  if (ms <= 0) return '0s';

  const seconds = Math.floor(ms / 1000);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (parts.length === 0) parts.push(`${secs}s`);

  return parts.join(' ');
}

/**
 * Query the status and uptime of a single service.
 */
async function getServiceStatus(name) {
  try {
    const { stdout: statusOut } = await execa('systemctl', ['is-active', name]);
    const status = statusOut.trim();

    let uptime = null;
    if (status === 'active') {
      try {
        const { stdout: timestampOut } = await execa('systemctl', [
          'show',
          name,
          '--property=ActiveEnterTimestamp',
        ]);
        // Output looks like: ActiveEnterTimestamp=Thu 2024-03-14 10:30:45 UTC
        const match = timestampOut.match(/=(.+)$/);
        if (match && match[1]) {
          const activeEnter = new Date(match[1]);
          if (!Number.isNaN(activeEnter.getTime())) {
            uptime = formatDuration(Date.now() - activeEnter.getTime());
          }
        }
      } catch {
        // If we can't get uptime, that's not fatal
      }
    }

    return { name, status, uptime };
  } catch {
    // Service not installed or systemctl failed for this service
    // Check the exit code to distinguish inactive vs failed vs unknown
    try {
      const { stdout } = await execa('systemctl', ['is-active', name], {
        reject: false,
      });
      const status = stdout.trim();
      if (status === 'inactive' || status === 'failed') {
        return { name, status, uptime: null };
      }
    } catch {
      // Fall through to unknown
    }
    return { name, status: 'unknown', uptime: null };
  }
}

/**
 * Retrieve status and uptime of all managed services in parallel.
 */
export async function getAllServiceStatuses() {
  const results = await Promise.all(ALLOWED_SERVICES.map(getServiceStatus));
  return results;
}

/**
 * Validate a service name against the allowlist.
 */
export function isAllowedService(name) {
  return ALLOWED_SERVICES.includes(name);
}

/**
 * Validate an action against the allowlist.
 */
export function isAllowedAction(action) {
  return ALLOWED_ACTIONS.includes(action);
}

/**
 * Execute a systemctl action on a managed service.
 * Returns { ok: true, name, action } on success.
 * Throws with a descriptive error on failure.
 */
export async function executeServiceAction(name, action) {
  // Safety: cannot stop the panel from the UI
  if (name === 'lamalibre-lamaste-serverd' && action === 'stop') {
    const err = new Error(
      'Cannot stop the panel service from the UI — it would terminate this session',
    );
    err.statusCode = 400;
    throw err;
  }

  try {
    await execa('sudo', ['systemctl', action, name], { timeout: 30_000 });
    return { ok: true, name, action };
  } catch (err) {
    const details = err.stderr || err.message;
    const error = new Error(`Failed to ${action} ${name}`);
    error.statusCode = 500;
    error.details = details;
    throw error;
  }
}

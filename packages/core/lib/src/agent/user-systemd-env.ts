/**
 * Make `systemctl --user` work in non-PAM root sessions.
 *
 * `multipass exec ... -- sudo bash -c "..."`, cron jobs, and `npx` invoked
 * from an installer all spawn shells that do not go through PAM. Root in
 * those shells has no `XDG_RUNTIME_DIR`, so `systemctl --user daemon-reload`
 * fails with "Failed to connect to bus: No medium found" even when lingering
 * is enabled and `/run/user/0/systemd/` is alive.
 *
 * `userSystemdEnv()` returns just the env keys that need to be added when the
 * caller's environment is missing them, leaving everything else to execa's
 * default `process.env` inheritance. `runUserSystemctl()` is the canonical
 * helper for `systemctl --user <args>` — every place in the agent that needs
 * to talk to the user systemd instance should go through it.
 */

import { existsSync, statSync } from 'node:fs';
import { platform } from 'node:os';

import type { Options as ExecaOptions, Result as ExecaResult } from 'execa';

export function userSystemdEnv(): NodeJS.ProcessEnv {
  if (platform() !== 'linux') return {};

  const env: NodeJS.ProcessEnv = {};
  const uid = typeof process.getuid === 'function' ? process.getuid() : 0;
  const runtimeDir = `/run/user/${uid}`;

  if (!process.env.XDG_RUNTIME_DIR && existsSync(runtimeDir)) {
    try {
      const st = statSync(runtimeDir);
      if (st.uid === uid) {
        env.XDG_RUNTIME_DIR = runtimeDir;
      }
    } catch {
      // /run/user/<uid> raced or got removed; nothing we can do.
    }
  }

  if (!process.env.DBUS_SESSION_BUS_ADDRESS && env.XDG_RUNTIME_DIR) {
    const busSocket = `${env.XDG_RUNTIME_DIR}/bus`;
    if (existsSync(busSocket)) {
      env.DBUS_SESSION_BUS_ADDRESS = `unix:path=${busSocket}`;
    }
  }

  return env;
}

export async function runUserSystemctl(
  args: readonly string[],
  options: ExecaOptions = {},
): Promise<ExecaResult> {
  const { execa } = await import('execa');
  // execa's generic Result type is parameterised by the resolved Options
  // shape; we erase that to the public ExecaResult so callers don't need to
  // care which option keys we passed.
  const result = (await execa('systemctl', ['--user', ...args], {
    ...options,
    env: { ...userSystemdEnv(), ...(options.env ?? {}) },
  })) as unknown as ExecaResult;
  return result;
}

import { execa } from 'execa';
import { existsSync } from 'node:fs';
import { chmod, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { RETIRED_SUDOERS_WRAPPERS, SUDOERS_WRAPPERS } from './service-config.js';

/**
 * Install the root-owned programs the sudoers rules name, from this
 * package's scripts/ directory, and remove the ones earlier versions
 * installed that no rule references any more. Each script is syntax-checked
 * first: an error would only surface when the panel needs it.
 *
 * Run before the sudoers file is written.
 *
 * @param {string} scriptsDir
 * @param {(line: string) => void} report
 */
export async function installSudoersWrappers(scriptsDir, report) {
  for (const w of SUDOERS_WRAPPERS) {
    const src = join(scriptsDir, w.name);
    if (!existsSync(src)) {
      throw new Error(
        `Sudoers wrapper script not found in package: ${src}. The provisioner package is incomplete.`,
      );
    }
    report(`Validating ${w.name}...`);
    if (w.interpreter === 'node') {
      await execa('node', ['--check', src]);
    } else {
      await execa('bash', ['-n', src]);
    }
    report(`Installing ${w.name} to ${w.dest}...`);
    await execa('install', ['-o', 'root', '-g', 'root', '-m', '0755', src, w.dest]);
  }
  for (const path of RETIRED_SUDOERS_WRAPPERS) {
    await rm(path, { force: true });
  }
}

const SUDOERS_PATH = '/etc/sudoers.d/lamaste';

/**
 * Install the sudoers file atomically: written under a name sudo ignores
 * (it skips files in sudoers.d whose name contains a dot), checked with
 * `visudo -c`, then renamed into place. An invalid file is never live, so a
 * failure cannot lock sudo out.
 *
 * @param {string} content
 */
export async function installSudoersFile(content) {
  const staged = `${SUDOERS_PATH}.lamaste-new`;
  await writeFile(staged, content, { mode: 0o440 });
  try {
    await chmod(staged, 0o440);
    await execa('visudo', ['-c', '-q', '-f', staged]);
  } catch (error) {
    await rm(staged, { force: true });
    throw new Error(
      `Sudoers validation failed — the installed rules are unchanged.\n${error.stderr || error.message}`,
    );
  }
  await rename(staged, SUDOERS_PATH);
}

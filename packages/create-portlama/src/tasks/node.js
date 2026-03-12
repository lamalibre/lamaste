import { execa } from 'execa';
import { unlink } from 'node:fs/promises';

/**
 * Node.js 20 LTS installation subtasks.
 *
 * @param {object} ctx  Shared installer context.
 * @param {object} task Parent Listr2 task reference.
 * @returns {import('listr2').ListrTask[]}
 */
export function nodeTasks(ctx, task) {
  return task.newListr([
    {
      title: 'Checking existing Node.js installation',
      task: async (_ctx, subtask) => {
        try {
          const { stdout } = await execa('node', ['--version']);
          const version = stdout.trim();
          const major = parseInt(version.replace(/^v/, ''), 10);

          if (major >= 20) {
            ctx.nodeAlreadyInstalled = true;
            subtask.output = `Node.js ${version} found, skipping install`;
          } else {
            subtask.output = `Node.js ${version} found (below v20), will upgrade`;
          }
        } catch {
          subtask.output = 'Node.js not found, installing v20 LTS';
        }
      },
      rendererOptions: { persistentOutput: true },
    },
    {
      title: 'Installing NodeSource repository',
      skip: () => ctx.nodeAlreadyInstalled && 'Node.js 20+ already installed',
      task: async (_ctx, subtask) => {
        const setupScript = '/tmp/nodesource_setup.sh';

        subtask.output = 'Downloading NodeSource setup script...';
        try {
          await execa('curl', [
            '-fsSL',
            'https://deb.nodesource.com/setup_20.x',
            '-o',
            setupScript,
          ]);
        } catch (error) {
          throw new Error(
            `Failed to download NodeSource setup script. Check your internet connection.\n${error.stderr || error.message}`,
          );
        }

        subtask.output = 'Running NodeSource setup...';
        try {
          await execa('bash', [setupScript]);
        } catch (error) {
          throw new Error(
            `NodeSource setup script failed.\n${error.stderr || error.message}`,
          );
        }

        await unlink(setupScript).catch(() => {});
        subtask.output = 'NodeSource repository added';
      },
      rendererOptions: { persistentOutput: true },
    },
    {
      title: 'Installing Node.js 20 LTS',
      skip: () => ctx.nodeAlreadyInstalled && 'Node.js 20+ already installed',
      task: async (_ctx, subtask) => {
        subtask.output = 'Running apt-get install nodejs...';
        try {
          await execa('apt-get', ['install', '-y', 'nodejs']);
        } catch (error) {
          throw new Error(
            `Failed to install Node.js. Try running 'apt-get update' manually and retrying.\n${error.stderr || error.message}`,
          );
        }
        subtask.output = 'Node.js installed';
      },
      rendererOptions: { persistentOutput: true },
    },
    {
      title: 'Verifying Node.js installation',
      task: async (_ctx, subtask) => {
        const { stdout: nodeVersion } = await execa('node', ['--version']);
        const { stdout: npmVersion } = await execa('npm', ['--version']);

        const trimmedNode = nodeVersion.trim();
        const trimmedNpm = npmVersion.trim();

        if (!trimmedNode.startsWith('v20') && !ctx.nodeAlreadyInstalled) {
          // If nodeAlreadyInstalled is true, we accepted any v20+ earlier
          const major = parseInt(trimmedNode.replace(/^v/, ''), 10);
          if (major < 20) {
            throw new Error(
              `Expected Node.js v20+, got ${trimmedNode}. Installation may have failed.`,
            );
          }
        }

        ctx.nodeVersion = trimmedNode;
        ctx.npmVersion = trimmedNpm;

        subtask.output = `Node.js ${trimmedNode}, npm ${trimmedNpm}`;
      },
      rendererOptions: { persistentOutput: true },
    },
  ]);
}

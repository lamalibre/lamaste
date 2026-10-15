import { execa } from 'execa';
import {
  MIN_NODE_VERSION,
  NODE_BIN,
  NODE_MAJOR,
  installNodeFromNodeSource,
  installedNodeVersion,
  nodeTooNewError,
  nodeVersionSupported,
  nodeVersionTooNew,
} from '../lib/node-version.js';

/**
 * Node.js installation subtasks: {@link NODE_BIN} must be at least
 * {@link MIN_NODE_VERSION} and below `MAX_NODE_MAJOR_EXCLUSIVE` (see
 * lib/node-version.js for why). An older Node.js is upgraded from NodeSource.
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
        const version = await installedNodeVersion();
        if (version === null) {
          subtask.output = `Node.js not found at ${NODE_BIN}, installing ${NODE_MAJOR}.x`;
        } else if (nodeVersionSupported(version)) {
          ctx.nodeAlreadyInstalled = true;
          subtask.output = `Node.js ${version} found, skipping install`;
        } else if (nodeVersionTooNew(version)) {
          throw nodeTooNewError(version);
        } else {
          subtask.output = `Node.js ${version} found (below ${MIN_NODE_VERSION}), will upgrade`;
        }
      },
      rendererOptions: { persistentOutput: true },
    },
    {
      title: `Installing Node.js ${NODE_MAJOR} LTS`,
      skip: () => ctx.nodeAlreadyInstalled && `Node.js ${MIN_NODE_VERSION}+ already installed`,
      task: async (_ctx, subtask) => {
        await installNodeFromNodeSource((line) => {
          subtask.output = line;
        });
        subtask.output = 'Node.js installed';
      },
      rendererOptions: { persistentOutput: true },
    },
    {
      title: 'Verifying Node.js installation',
      task: async (_ctx, subtask) => {
        const nodeVersion = await installedNodeVersion();
        const { stdout: npmVersion } = await execa('npm', ['--version']);
        if (nodeVersion === null || !nodeVersionSupported(nodeVersion)) {
          throw new Error(
            `Expected Node.js ${MIN_NODE_VERSION}+ at ${NODE_BIN}, got ${nodeVersion ?? 'none'}. Installation may have failed.`,
          );
        }
        ctx.nodeVersion = nodeVersion;
        ctx.npmVersion = npmVersion.trim();
        subtask.output = `Node.js ${nodeVersion}, npm ${ctx.npmVersion}`;
      },
      rendererOptions: { persistentOutput: true },
    },
  ]);
}

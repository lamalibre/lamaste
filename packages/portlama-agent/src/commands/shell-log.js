import path from 'node:path';
import chalk from 'chalk';
import { assertMacOS } from '../lib/platform.js';
import { requireAgentConfig } from '../lib/config.js';
import { fetchShellSessions, downloadShellRecording } from '../lib/panel-api.js';

/**
 * Parse simple CLI flags from an array of arguments.
 * @param {string[]} args
 * @returns {{ positional: string[], flags: Record<string, string|boolean> }}
 */
function parseFlags(args) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(args[i]);
    }
  }
  return { positional, flags };
}

/**
 * Format a date string for display.
 * @param {string} isoDate
 * @returns {string}
 */
function formatDate(isoDate) {
  try {
    const d = new Date(isoDate);
    return d.toLocaleString();
  } catch {
    return isoDate || 'unknown';
  }
}

/**
 * Format duration in seconds to human-readable.
 * @param {number} seconds
 * @returns {string}
 */
function formatDuration(seconds) {
  if (seconds == null) return 'unknown';
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins < 60) return `${mins}m ${secs}s`;
  const hours = Math.floor(mins / 60);
  const remainMins = mins % 60;
  return `${hours}h ${remainMins}m`;
}

/**
 * List shell sessions, optionally filtered by agent label.
 * @param {object} config
 * @param {string} [agentLabel]
 */
async function runList(config, agentLabel) {
  const b = chalk.bold;
  const c = chalk.cyan;
  const d = chalk.dim;
  const y = chalk.yellow;

  console.log('');
  console.log(b('  Shell Sessions'));
  console.log(d('  ─'.repeat(28)));

  let sessions;
  try {
    const data = await fetchShellSessions(config);
    sessions = data.sessions || [];
  } catch (err) {
    console.log(`  ${y(`Could not fetch sessions: ${err.message}`)}`);
    console.log('');
    return;
  }

  // Filter by agent label if specified
  if (agentLabel) {
    sessions = sessions.filter((s) => s.agentLabel === agentLabel);
  }

  if (sessions.length === 0) {
    const suffix = agentLabel ? ` for agent ${chalk.bold(agentLabel)}` : '';
    console.log(`  ${d(`No sessions found${suffix}.`)}`);
    console.log('');
    return;
  }

  // Sort by start time, newest first
  sessions.sort((a, b2) => {
    const da = new Date(a.startedAt || 0);
    const db = new Date(b2.startedAt || 0);
    return db - da;
  });

  for (const session of sessions) {
    const statusLabel =
      session.status === 'active'
        ? chalk.green('Active')
        : session.status === 'ended'
          ? d('Ended')
          : d(session.status || 'unknown');

    console.log(`  ${c('•')} ${b(session.id)}`);
    console.log(`    Agent:    ${session.agentLabel || d('unknown')}`);
    console.log(`    Status:   ${statusLabel}`);
    console.log(`    Started:  ${formatDate(session.startedAt)}`);
    if (session.endedAt) {
      console.log(`    Ended:    ${formatDate(session.endedAt)}`);
    }
    if (session.duration != null) {
      console.log(`    Duration: ${formatDuration(session.duration)}`);
    }
    if (session.commandCount != null) {
      console.log(`    Commands: ${session.commandCount}`);
    }
    console.log('');
  }
}

/**
 * Download a session recording.
 * @param {object} config
 * @param {string} agentLabel
 * @param {string} sessionId
 */
async function runDownload(config, agentLabel, sessionId) {
  const outputPath = path.resolve(`${sessionId}.log`);

  console.log('');
  console.log(chalk.dim(`  Downloading recording for session ${chalk.bold(sessionId)}...`));

  try {
    await downloadShellRecording(
      config,
      agentLabel,
      sessionId,
      outputPath,
    );
  } catch (err) {
    console.error(chalk.red(`\n  Download failed: ${err.message}\n`));
    process.exit(1);
  }

  console.log(`  ${chalk.green('✓')} Recording saved to ${chalk.cyan(outputPath)}`);
  console.log('');
}

/**
 * Shell log command: list or download session recordings.
 * @param {string[]} args
 */
export async function runShellLog(args) {
  assertMacOS();
  const config = await requireAgentConfig();

  const { positional, flags } = parseFlags(args);
  const agentLabel = positional[0];

  if (flags.download) {
    const sessionId = typeof flags.download === 'string' ? flags.download : null;
    if (!sessionId || !agentLabel) {
      console.error(
        `\n  Usage: ${chalk.cyan('portlama-agent shell-log <agent-label> --download <session-id>')}\n`,
      );
      process.exit(1);
    }
    return runDownload(config, agentLabel, sessionId);
  }

  // Default to --list behavior
  return runList(config, agentLabel);
}

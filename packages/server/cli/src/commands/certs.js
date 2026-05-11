/**
 * lamaste-server certs — Certificate status and renewal.
 *
 * Subcommands:
 *   status     Show certificate expiry and renewal status
 *   renew      Force certificate renewal via certbot
 *   agents     List agent certificates
 */

import chalk from 'chalk';
import { execa } from 'execa';
import { getMtlsCerts, readCertExpiry, listAgentCerts } from '@lamalibre/lamaste/server';
import { PKI_DIR } from '../config.js';
import { exec } from '../exec.js';
import { emit, emitStep, emitError, emitComplete } from '../ndjson.js';

/**
 * @param {string[]} args
 * @param {{ json: boolean }} options
 */
export async function runCerts(args, { json }) {
  const sub = args[0] || 'status';

  switch (sub) {
    case 'status':
      return certStatus({ json });
    case 'renew':
      return certRenew({ json });
    case 'agents':
      return agentCerts({ json });
    default:
      printCertUsage();
      process.exit(1);
  }
}

function printCertUsage() {
  const b = chalk.bold;
  const c = chalk.cyan;
  console.log(`
${b('Usage:')} lamaste-server certs <subcommand>

${b('Subcommands:')}
  ${c('status')}     Show mTLS and Let's Encrypt certificate status (default)
  ${c('renew')}      Force Let's Encrypt certificate renewal
  ${c('agents')}     List agent certificates with expiry info
`);
}

/**
 * @param {{ json: boolean }} options
 */
async function certStatus({ json }) {
  // mTLS certs
  const mtlsCerts = await getMtlsCerts(PKI_DIR, exec);

  // Let's Encrypt certs
  let letsencryptCerts = [];
  try {
    const { stdout } = await execa('sudo', ['certbot', 'certificates', '--non-interactive'], {
      timeout: 30000,
    });
    letsencryptCerts = parseCertbotOutput(stdout);
  } catch {
    // certbot may not be installed or may have no certs
  }

  if (json) {
    emit({ mtls: mtlsCerts, letsencrypt: letsencryptCerts });
    return;
  }

  const b = chalk.bold;
  const c = chalk.cyan;
  const g = chalk.green;
  const y = chalk.yellow;
  const r = chalk.red;
  const d = chalk.dim;

  console.log('');
  console.log(b('  mTLS Certificates'));
  console.log(d('  ' + '\u2500'.repeat(40)));

  if (mtlsCerts.length === 0) {
    console.log(`  ${d('No mTLS certificates found.')}`);
  }

  for (const cert of mtlsCerts) {
    const label = cert.type === 'mtls-ca' ? 'CA' : 'Client';
    const status = cert.expiringSoon ? y('expiring soon') : g('valid');
    console.log(
      `  ${b(label + ':')}  ${status}  ${d(`expires in ${cert.daysUntilExpiry} days`)}  ${d(cert.expiresAt)}`,
    );
  }

  if (letsencryptCerts.length > 0) {
    console.log('');
    console.log(b("  Let's Encrypt Certificates"));
    console.log(d('  ' + '\u2500'.repeat(40)));

    for (const cert of letsencryptCerts) {
      const daysLeft = cert.daysUntilExpiry;
      const status = daysLeft <= 7 ? r('critical') : daysLeft <= 30 ? y('expiring') : g('valid');
      console.log(
        `  ${c(cert.domain)}  ${status}  ${d(`expires in ${daysLeft} days`)}`,
      );
    }
  }

  console.log('');
}

/**
 * @param {{ json: boolean }} options
 */
async function certRenew({ json }) {
  if (json) emitStep('renew', 'running', 'Forcing certificate renewal');
  else process.stderr.write('  Forcing certificate renewal...');

  try {
    await execa('sudo', ['certbot', 'renew', '--force-renewal', '--non-interactive'], {
      timeout: 120000,
    });

    // Reload nginx to pick up new certs
    await execa('sudo', ['nginx', '-t']);
    await execa('sudo', ['systemctl', 'reload', 'nginx']);

    if (json) {
      emitStep('renew', 'complete');
      emitComplete({ renewed: true });
    } else {
      console.log(` ${chalk.green('ok')}`);
      console.log('  Certificates renewed and nginx reloaded.\n');
    }
  } catch (err) {
    const msg = err.stderr || err.message;
    if (json) {
      emitStep('renew', 'failed', msg);
      emitError(msg);
    } else {
      console.log(` ${chalk.red('failed')}`);
      console.error(`  ${chalk.red(msg)}\n`);
    }
    process.exit(1);
  }
}

/**
 * @param {{ json: boolean }} options
 */
async function agentCerts({ json }) {
  const agents = await listAgentCerts(PKI_DIR);

  if (json) {
    emit({ agents });
    return;
  }

  const b = chalk.bold;
  const c = chalk.cyan;
  const g = chalk.green;
  const r = chalk.red;
  const y = chalk.yellow;
  const d = chalk.dim;

  console.log('');
  console.log(b('  Agent Certificates'));
  console.log(d('  ' + '\u2500'.repeat(50)));

  if (agents.length === 0) {
    console.log(`  ${d('No agent certificates.')}`);
    console.log('');
    return;
  }

  for (const agent of agents) {
    const revoked = agent.revoked ? r(' [REVOKED]') : '';
    const expiring = agent.expiringSoon ? y(' [EXPIRING]') : '';
    const method = agent.enrollmentMethod === 'hardware-bound' ? d(' (hw-bound)') : '';
    const certType = agent.certType === 'plugin-agent' ? d(' (plugin)') : '';
    console.log(
      `  ${c(agent.label)}${certType}${method}  ${d(agent.serial)}${revoked}${expiring}`,
    );

    if (agent.capabilities.length > 0) {
      console.log(`    ${d('capabilities:')} ${agent.capabilities.join(', ')}`);
    }

    if (agent.expiresAt) {
      console.log(`    ${d(`expires: ${agent.expiresAt}`)}`);
    }
  }
  console.log('');
}

/**
 * Parse certbot certificates output into structured data.
 * @param {string} output
 * @returns {Array<{ domain: string, daysUntilExpiry: number, expiresAt: string }>}
 */
function parseCertbotOutput(output) {
  const certs = [];
  const blocks = output.split('Certificate Name:').slice(1);

  for (const block of blocks) {
    const domainMatch = block.match(/Domains:\s+(.+)/);
    const expiryMatch = block.match(/Expiry Date:\s+(\S+ \S+ \S+ \S+ \S+)/);

    if (domainMatch && expiryMatch) {
      const domain = domainMatch[1].trim().split(/\s+/)[0];
      const expiryDate = new Date(expiryMatch[1]);
      const daysUntilExpiry = Math.floor(
        (expiryDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
      );
      certs.push({
        domain,
        daysUntilExpiry,
        expiresAt: expiryDate.toISOString(),
      });
    }
  }

  return certs;
}

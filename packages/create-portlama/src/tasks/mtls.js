import { execa } from 'execa';
import { writeFile, readFile, access } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { generatePassword } from '../lib/secrets.js';

/**
 * mTLS certificate generation subtasks.
 * Creates a self-signed CA, client certificate, and PKCS12 bundle.
 *
 * Idempotent: if the CA key and client PKCS12 bundle already exist,
 * all generation steps are skipped to avoid invalidating previously
 * imported client certificates.
 *
 * @param {object} ctx  Shared installer context.
 * @param {object} task Parent Listr2 task reference.
 * @returns {import('listr2').ListrTask[]}
 */
export function mtlsTasks(ctx, task) {
  const pkiDir = ctx.pkiDir;
  const alreadyProvisioned =
    existsSync(`${pkiDir}/ca.key`) && existsSync(`${pkiDir}/client.p12`);

  if (alreadyProvisioned) {
    return task.newListr([
      {
        title: 'mTLS certificates already exist — skipping generation',
        task: async () => {
          // Read the existing p12 password so the summary can display it.
          ctx.p12Password = await readFile(
            `${pkiDir}/.p12-password`,
            'utf8',
          );
        },
      },
    ]);
  }

  return task.newListr([
    {
      title: 'Creating PKI directory',
      task: async (_ctx, subtask) => {
        await execa('mkdir', ['-p', pkiDir]);
        await execa('chmod', ['700', pkiDir]);
        subtask.output = `PKI directory: ${pkiDir}`;
      },
      rendererOptions: { persistentOutput: true },
    },
    {
      title: 'Generating CA private key and certificate',
      task: async (_ctx, subtask) => {
        subtask.output = 'Generating 4096-bit RSA CA key...';
        await execa('openssl', ['genrsa', '-out', `${pkiDir}/ca.key`, '4096']);

        subtask.output = 'Creating self-signed CA certificate (10 year validity)...';
        await execa('openssl', [
          'req',
          '-x509',
          '-new',
          '-nodes',
          '-key',
          `${pkiDir}/ca.key`,
          '-sha256',
          '-days',
          '3650',
          '-out',
          `${pkiDir}/ca.crt`,
          '-subj',
          '/CN=Portlama CA/O=Portlama',
        ]);

        await execa('chmod', ['600', `${pkiDir}/ca.key`]);
        await execa('chmod', ['644', `${pkiDir}/ca.crt`]);

        // Verify files exist
        await assertFileExists(`${pkiDir}/ca.key`);
        await assertFileExists(`${pkiDir}/ca.crt`);

        subtask.output = 'CA key and certificate generated';
      },
      rendererOptions: { persistentOutput: true },
    },
    {
      title: 'Generating client key and CSR',
      task: async (_ctx, subtask) => {
        subtask.output = 'Generating 4096-bit RSA client key...';
        await execa('openssl', [
          'genrsa',
          '-out',
          `${pkiDir}/client.key`,
          '4096',
        ]);

        subtask.output = 'Creating certificate signing request...';
        await execa('openssl', [
          'req',
          '-new',
          '-key',
          `${pkiDir}/client.key`,
          '-out',
          `${pkiDir}/client.csr`,
          '-subj',
          '/CN=admin/O=Portlama',
        ]);

        await execa('chmod', ['600', `${pkiDir}/client.key`]);

        await assertFileExists(`${pkiDir}/client.key`);
        await assertFileExists(`${pkiDir}/client.csr`);

        subtask.output = 'Client key and CSR generated';
      },
      rendererOptions: { persistentOutput: true },
    },
    {
      title: 'Signing client certificate with CA',
      task: async (_ctx, subtask) => {
        subtask.output = 'Signing client certificate (2 year validity)...';
        await execa('openssl', [
          'x509',
          '-req',
          '-in',
          `${pkiDir}/client.csr`,
          '-CA',
          `${pkiDir}/ca.crt`,
          '-CAkey',
          `${pkiDir}/ca.key`,
          '-CAcreateserial',
          '-out',
          `${pkiDir}/client.crt`,
          '-days',
          '730',
          '-sha256',
        ]);

        await execa('chmod', ['644', `${pkiDir}/client.crt`]);

        await assertFileExists(`${pkiDir}/client.crt`);

        // Clean up CSR (no longer needed)
        await execa('rm', ['-f', `${pkiDir}/client.csr`]);

        subtask.output = 'Client certificate signed and CSR removed';
      },
      rendererOptions: { persistentOutput: true },
    },
    {
      title: 'Creating PKCS12 bundle',
      task: async (_ctx, subtask) => {
        const password = generatePassword();

        subtask.output = 'Creating PKCS12 bundle for browser import...';
        await execa('openssl', [
          'pkcs12',
          '-export',
          '-keypbe', 'PBE-SHA1-3DES',
          '-certpbe', 'PBE-SHA1-3DES',
          '-macalg', 'sha1',
          '-out',
          `${pkiDir}/client.p12`,
          '-inkey',
          `${pkiDir}/client.key`,
          '-in',
          `${pkiDir}/client.crt`,
          '-certfile',
          `${pkiDir}/ca.crt`,
          '-passout', 'stdin',
        ], { input: password });

        // Save password to file (no trailing newline)
        await writeFile(`${pkiDir}/.p12-password`, password, { mode: 0o600 });
        await execa('chmod', ['600', `${pkiDir}/client.p12`]);

        await assertFileExists(`${pkiDir}/client.p12`);
        await assertFileExists(`${pkiDir}/.p12-password`);

        ctx.p12Password = password;
        subtask.output = 'PKCS12 bundle created';
      },
      rendererOptions: { persistentOutput: true },
    },
  ]);
}

/**
 * Assert that a file exists, throwing a descriptive error if it does not.
 * @param {string} filePath
 */
async function assertFileExists(filePath) {
  try {
    await access(filePath);
  } catch {
    throw new Error(`Expected file was not created: ${filePath}`);
  }
}

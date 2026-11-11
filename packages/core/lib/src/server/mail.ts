/**
 * Server-side mail rules that need node (packages/core/docs/mail-design.md):
 * the CA bundle an `smtp` transport may carry (`caPem`, Q4) — trusted in
 * addition to the system roots, for that transport only.
 */

import { X509Certificate } from 'node:crypto';

import { splitPemCertificates } from '../mail.js';

/** Why a CA bundle is refused. */
export class MailCaPemError extends Error {
  readonly code: 'not_pem' | 'not_certificate' | 'not_ca';

  constructor(message: string, code: MailCaPemError['code']) {
    super(message);
    this.name = 'MailCaPemError';
    this.code = code;
  }
}

/**
 * The certificates of `pem`, each a CA certificate (basic constraints
 * `CA:TRUE`), normalised — what the transport stores and hands to TLS as
 * `ca` beside the system roots. Throws {@link MailCaPemError} for anything
 * else: text that is not a bundle of PEM certificates, a block that does
 * not parse, a leaf certificate.
 */
export function parseMailCaPem(pem: string): string[] {
  const blocks = splitPemCertificates(pem);
  if (blocks === null) {
    throw new MailCaPemError('Not a bundle of PEM certificates', 'not_pem');
  }
  return blocks.map((block, i) => {
    let certificate: X509Certificate;
    try {
      certificate = new X509Certificate(block);
    } catch {
      throw new MailCaPemError(`Certificate ${i + 1} does not parse`, 'not_certificate');
    }
    if (!certificate.ca) {
      throw new MailCaPemError(`Certificate ${i + 1} is not a CA certificate`, 'not_ca');
    }
    return certificate.toString();
  });
}

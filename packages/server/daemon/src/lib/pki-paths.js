/**
 * PKI path derivation for the Lamaste server daemon.
 *
 * Exposes the canonical CA cert/key locations consumed by other daemon
 * modules (mtls, csr-signing, enrollment, revocation, plugins) and shared
 * with plugins through the plugin host's `resolvePluginOptions` callback.
 *
 * The directory is derived from `LAMALIBRE_LAMASTE_PKI_DIR` with the same
 * `/etc/lamalibre/lamaste/pki` default used throughout the daemon. Keeping the
 * default in one exported helper gives us a single place to point at when
 * the other consumers are migrated onto it.
 */
import path from 'node:path';

const DEFAULT_PKI_DIR = '/etc/lamalibre/lamaste/pki';

/**
 * Return the PKI directory.
 *
 * @returns {string}
 */
export function getPkiDir() {
  return process.env.LAMALIBRE_LAMASTE_PKI_DIR || DEFAULT_PKI_DIR;
}

/**
 * Return the canonical CA cert and key paths.
 *
 * The files themselves are not read here — callers that need to verify
 * existence or parse the certificate must do so explicitly. This helper
 * only centralizes the path derivation.
 *
 * @returns {{ certPath: string, keyPath: string }}
 */
export function getCaPaths() {
  const pkiDir = getPkiDir();
  return {
    certPath: path.join(pkiDir, 'ca.crt'),
    keyPath: path.join(pkiDir, 'ca.key'),
  };
}

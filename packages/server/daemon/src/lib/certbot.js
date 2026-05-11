/**
 * Shim — certbot/Let's Encrypt helpers now live in `@lamalibre/lamaste/server`.
 * This file wires the daemon's execa instance to the parameterized core API
 * so existing daemon callers continue to work unchanged.
 */

import { execa } from 'execa';
import {
  issueCert as issueCertCore,
  issueCoreCerts as issueCoreCertsCore,
  issueAppCert as issueAppCertCore,
  listCerts as listCertsCore,
  renewCert as renewCertCore,
  renewAll as renewAllCore,
  setupAutoRenew as setupAutoRenewCore,
  hasWildcardCert as hasWildcardCertCore,
  issueTunnelCert as issueTunnelCertCore,
  getCertPath as getCertPathCore,
  isCertValid as isCertValidCore,
} from '@lamalibre/lamaste/server';

export function issueCert(fqdn, email) {
  return issueCertCore(fqdn, email, execa);
}

export function issueCoreCerts(domain, email) {
  return issueCoreCertsCore(domain, email, execa);
}

export function issueAppCert(subdomain, domain, email) {
  return issueAppCertCore(subdomain, domain, email, execa);
}

export function listCerts() {
  return listCertsCore(execa);
}

export function renewCert(domain, options = {}) {
  return renewCertCore(domain, execa, options);
}

export function renewAll() {
  return renewAllCore(execa);
}

export function setupAutoRenew() {
  return setupAutoRenewCore(execa);
}

export function hasWildcardCert(domain) {
  return hasWildcardCertCore(domain, execa);
}

export function issueTunnelCert(fqdn, email) {
  return issueTunnelCertCore(fqdn, email, execa);
}

export function getCertPath(fqdn, domain) {
  return getCertPathCore(fqdn, domain, execa);
}

export function isCertValid(fqdn) {
  return isCertValidCore(fqdn, execa);
}

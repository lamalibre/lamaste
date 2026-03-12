import { readFile } from 'node:fs/promises';
import { execa } from 'execa';

/**
 * Parse /etc/os-release and validate that we are on Ubuntu 24.04.
 * @returns {{ id: string, versionId: string, prettyName: string }}
 */
export async function detectOS() {
  let content;
  try {
    content = await readFile('/etc/os-release', 'utf8');
  } catch {
    throw new Error(
      'Could not read /etc/os-release. Portlama requires Ubuntu 24.04.',
    );
  }

  const fields = {};
  for (const line of content.split('\n')) {
    const match = line.match(/^(\w+)=(.*)$/);
    if (match) {
      // Strip surrounding quotes if present
      fields[match[1]] = match[2].replace(/^"|"$/g, '');
    }
  }

  const id = fields.ID || '';
  const versionId = fields.VERSION_ID || '';
  const prettyName = fields.PRETTY_NAME || `${id} ${versionId}`;

  if (id !== 'ubuntu' || !versionId.startsWith('24.04')) {
    throw new Error(
      `Portlama requires Ubuntu 24.04. Detected: ${prettyName}`,
    );
  }

  return { id, versionId, prettyName };
}

/**
 * Detect the public IP address of this machine.
 * Tries the DigitalOcean metadata API first, falls back to hostname -I.
 * When allowPrivate is true (--dev mode), accepts RFC 1918 addresses.
 * @param {{ allowPrivate?: boolean }} options
 * @returns {string} The IPv4 address.
 */
export async function detectIP({ allowPrivate = false } = {}) {
  const isAcceptable = (ip) => allowPrivate ? isValidIPv4(ip) : isPublicIP(ip);

  // Try DigitalOcean metadata API first
  try {
    const { stdout } = await execa('curl', [
      '-s',
      '--max-time',
      '2',
      'http://169.254.169.254/metadata/v1/interfaces/public/0/ipv4/address',
    ]);
    const ip = stdout.trim();
    if (ip && isAcceptable(ip)) {
      return ip;
    }
  } catch {
    // Metadata API not available, fall back
  }

  // Fallback: hostname -I
  try {
    const { stdout } = await execa('hostname', ['-I']);
    const addresses = stdout.trim().split(/\s+/);
    for (const addr of addresses) {
      if (isAcceptable(addr)) {
        return addr;
      }
    }
  } catch {
    // hostname -I failed
  }

  throw new Error(
    'Could not detect a public IP address. Portlama must be installed on a server with a public IP.',
  );
}

/**
 * Check whether the given string is a valid IPv4 address (any routable address, not loopback/link-local).
 * @param {string} ip
 * @returns {boolean}
 */
function isValidIPv4(ip) {
  const parts = ip.split('.');
  if (parts.length !== 4) return false;

  const octets = parts.map(Number);
  if (octets.some((o) => Number.isNaN(o) || o < 0 || o > 255)) return false;

  const [a, b] = octets;

  // Reject loopback, link-local, and 0.0.0.0
  if (a === 127) return false;
  if (a === 169 && b === 254) return false;
  if (octets.every((o) => o === 0)) return false;

  return true;
}

/**
 * Check whether the given IPv4 address is public (not RFC 1918 / loopback / link-local).
 * @param {string} ip
 * @returns {boolean}
 */
function isPublicIP(ip) {
  if (!isValidIPv4(ip)) return false;

  const [a, b] = ip.split('.').map(Number);

  // 10.0.0.0/8
  if (a === 10) return false;
  // 172.16.0.0/12
  if (a === 172 && b >= 16 && b <= 31) return false;
  // 192.168.0.0/16
  if (a === 192 && b === 168) return false;

  return true;
}

/**
 * Verify the process is running as root.
 * @throws {Error} if not root
 */
export function checkRoot() {
  if (process.getuid() !== 0) {
    throw new Error(
      'Portlama installer must be run as root. Try: sudo npx @lamalibre/create-portlama',
    );
  }
}

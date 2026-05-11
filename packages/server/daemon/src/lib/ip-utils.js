/**
 * IP address matching utilities — allow/deny list evaluation with CIDR support.
 * Used by push-install policy enforcement.
 */

/**
 * Check whether an IP is allowed given allow and deny lists.
 * Deny list takes precedence. Empty allow list means all IPs allowed.
 * @param {string} ip
 * @param {string[]} allowedIps
 * @param {string[]} deniedIps
 * @returns {boolean}
 */
export function isIpAllowed(ip, allowedIps, deniedIps) {
  // Check deny list first (takes precedence)
  if (deniedIps.length > 0 && matchesAny(ip, deniedIps)) {
    return false;
  }

  // Empty allow list means all IPs allowed
  if (allowedIps.length === 0) {
    return true;
  }

  // Check allow list
  return matchesAny(ip, allowedIps);
}

/**
 * Strip the ::ffff: prefix from IPv4-mapped IPv6 addresses so that
 * comparisons work consistently against plain IPv4 entries.
 */
function normalizeIp(ip) {
  if (ip.startsWith('::ffff:')) {
    return ip.slice(7);
  }
  return ip;
}

/**
 * Check if an IP matches any entry in a list of IPs/CIDRs.
 */
function matchesAny(ip, list) {
  const normalized = normalizeIp(ip);
  for (const entry of list) {
    const normalizedEntry = normalizeIp(entry);
    if (normalizedEntry.includes('/')) {
      if (ipInCidr(normalized, normalizedEntry)) return true;
    } else {
      if (normalized === normalizedEntry) return true;
    }
  }
  return false;
}

/**
 * Check if an IPv4 address is within a CIDR range.
 */
function ipInCidr(ip, cidr) {
  const [range, bitsStr] = cidr.split('/');
  const bits = parseInt(bitsStr, 10);
  if (bits < 0 || bits > 32) return false;
  const mask = bits === 0 ? 0 : ~(2 ** (32 - bits) - 1);
  const ipNum = ipToNum(ip);
  const rangeNum = ipToNum(range);
  if (ipNum === null || rangeNum === null) return false;
  return (ipNum & mask) === (rangeNum & mask);
}

/**
 * Convert an IPv4 address string to a 32-bit number.
 */
function ipToNum(ip) {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const nums = parts.map(Number);
  if (nums.some((n) => isNaN(n) || n < 0 || n > 255)) return null;
  return ((nums[0] << 24) | (nums[1] << 16) | (nums[2] << 8) | nums[3]) >>> 0;
}

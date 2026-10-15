/**
 * Which proxy hop the panel trusts for a request's client address — the
 * Fastify `trustProxy` function.
 *
 * The panel listens on 127.0.0.1 only; every request reaches it through the
 * relay's nginx (the panel vhost, the IP-based panel on :9292), which
 * appends the address it accepted the connection from to
 * `X-Forwarded-For` (`proxy_set_header X-Forwarded-For
 * $proxy_add_x_forwarded_for`). The panel trusts exactly that one hop, and
 * only when it comes from loopback: `request.ip` is then the address nginx
 * saw — what push-install IP policies, rate limits and logs see — never an
 * `X-Forwarded-For` entry the client wrote itself (those sit further left),
 * and never a header from a peer that is not local should the panel ever
 * listen elsewhere.
 */

import net from 'node:net';

/** Whether `address` is a loopback address (IPv4 127/8, `::1`, or IPv4-mapped 127/8). */
export function isLoopbackAddress(address) {
  if (typeof address !== 'string') return false;
  const v4 = address.startsWith('::ffff:') ? address.slice(7) : address;
  if (net.isIPv4(v4)) return v4.split('.')[0] === '127';
  return net.isIPv6(address) && (address === '::1' || /^(0{1,4}:){7}0{0,3}1$/.test(address));
}

/**
 * Fastify / proxy-addr trust function: `hop` 0 is the connection's own peer.
 * @param {string} address
 * @param {number} hop
 */
export function trustLocalNginxHop(address, hop) {
  return hop === 0 && isLoopbackAddress(address);
}

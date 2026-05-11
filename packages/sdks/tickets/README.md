# @lamalibre/lamaste-tickets

SDK for the Lamaste ticket system — panel-mediated agent-to-agent
authorization. The panel issues short-lived tickets that grant a source
agent the right to open a transport channel against a target agent's
named instance scope.

This package contains the TypeScript client used by both sides of that
exchange (issuance, validation, sessions, instance management). The
panel-side enforcement (rate limits, capability checks, instance
heartbeats, replay protection) lives in the `lamalibre-lamaste-serverd` daemon and is not in
scope here.

## Plugin Transport Security: Re-Validation Required

The panel validates the `transport.direct.host` field on `RegisterInstance`
against a deny list of private, loopback, link-local, and cloud-metadata
addresses (see `packages/server/daemon/src/lib/tickets.js`). That check
runs **at register time** against the literal value in the request body.

**That check is not sufficient on its own.** The panel does not — and
cannot — control DNS resolution at the moment a plugin transport actually
opens a TCP connection to the target. An attacker who registers an
instance with a hostname (`my-agent.example.com`) that resolves to a
public IP at register time can later flip the DNS record to
`169.254.169.254` (the AWS/GCP metadata endpoint) and drive plugin
transports to fetch instance metadata, IAM credentials, or whatever else
the host runtime exposes there. This is a classic DNS rebinding pattern.

Plugin transport consumers (the code that takes a ticket + instance
record and opens the actual TCP stream) **MUST** re-resolve
`transport.direct.host` to an IP at use time and reject reserved IPs
before establishing the connection. Pinning to the resolved IP for the
lifetime of the connection is the correct mitigation — DNS lookups
during a single connection should not be re-trusted either.

### Reference implementation

```ts
import { promises as dns } from 'node:dns';
import net from 'node:net';

/**
 * Reject loopback, link-local, private, and cloud-metadata IPs.
 * Mirrors the panel-side deny list in tickets.js.
 */
function isReservedIp(ip: string): boolean {
  if (ip === '169.254.169.254') return true;          // AWS/GCP/Azure metadata
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;          // link-local
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true;          // private
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower.startsWith('fe80:') || lower.startsWith('fc') || lower.startsWith('fd')) {
      return true;
    }
  }
  return false;
}

export async function resolveSafeAddress(host: string): Promise<string> {
  // dns.lookup returns the OS resolver result — what the kernel would use
  // for an actual connect() call. Use { all: false } so we get one IP
  // that we can pin for the duration of the connection.
  const { address } = await dns.lookup(host, { all: false });
  if (isReservedIp(address)) {
    throw new Error(`Refusing to connect to reserved IP ${address} (host: ${host})`);
  }
  return address;
}
```

Open the connection against the resolved IP, not the hostname:

```ts
const ip = await resolveSafeAddress(instance.transport.direct.host);
const socket = net.createConnection({ host: ip, port: instance.transport.direct.port });
```

### Roadmap

A future release may move this enforcement into a shared transport
library that plugin authors are required to use, so that the deny list
stays centralised and is updated in one place when new metadata
endpoints (e.g. new cloud providers) are added. Until that ships, the
re-validation above is the plugin author's responsibility — the panel
cannot do it for you.

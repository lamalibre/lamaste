# @lamalibre/lamaste-panel-client

React 18 + Vite + Tailwind management UI for the Lamaste panel. This is a
private package internal to the [Lamaste monorepo](https://github.com/lamalibre/lamaste)
and is not published to npm.

## What It Does

The panel client is a single-page application with a dark terminal aesthetic.
It operates in two modes:

- **Onboarding** (first visit) — step-by-step wizard for domain setup, DNS
  verification, and stack provisioning with a live progress stream.
- **Management** (after onboarding) — dashboard, tunnels, users, certificates,
  and services pages.

Data fetching uses `@tanstack/react-query`. Icons come from `lucide-react`.
Routing is handled by `react-router-dom`. In production the built static files
are served by the panel server.

## Development

```bash
# From the monorepo root
npm run dev -w packages/panel-client
```

Vite proxies `/api` and WebSocket connections to `localhost:9292` during
development.

## Further Reading

See the main repository for architecture details, design system tokens, and the
full development plan: <https://github.com/lamalibre/lamaste>

## Disclaimer

This software is provided "as is", without warranty of any kind, express or implied. The authors and contributors accept no liability for any damages, data loss, security incidents, or legal consequences arising from the use of this software.

Lamaste is designed for self-hosted use cases — personal projects, development environments, demos, and internal tools. It is not a substitute for production infrastructure. Production workloads require dedicated hosting, load balancing, redundancy, monitoring, and operational expertise that are beyond the scope of this project.

**You are solely responsible for what you expose through Lamaste.** By tunneling an application to the public internet, you grant anyone with access the ability to interact with that application as if they were on your local network. This carries inherent risks:

- **Arbitrary code execution:** If the tunneled application contains vulnerabilities or backdoors, remote attackers may exploit them to execute code on your machine, access your file system, or compromise your operating system.
- **Data exposure:** Misconfigured or insecure applications may leak sensitive data, credentials, or private files to the internet.
- **Lateral movement:** A compromised tunneled application may be used as an entry point to attack other devices and services on your local network.
- **Resource abuse:** Publicly accessible applications may be used for cryptocurrency mining, spam relaying, botnet hosting, or other abuse that could result in legal action against you.

Lamaste provides authentication and access control mechanisms, but no security measure is absolute. It is your responsibility to understand the software you expose, keep it updated, and assess the risks of making it publicly accessible. The authors of Lamaste bear no responsibility for the consequences of tunneling untrusted, vulnerable, or malicious software.

## License

[Polyform Noncommercial 1.0.0](./LICENSE.md) — see [LICENSE.md](./LICENSE.md) for details.

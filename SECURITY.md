# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 1.x     | Yes       |

## Reporting a Vulnerability

**Do not open a public issue for security vulnerabilities.**

If you discover a security vulnerability in Lamaste, please report it
responsibly through one of these channels:

1. **GitHub Security Advisory** (preferred):
   [Open a private advisory](https://github.com/lamalibre/lamaste/security/advisories/new)

2. **Email**: security@codelama.dev

### What to Include

- Description of the vulnerability
- Steps to reproduce
- Affected component (installer, serverd, panel-client, agent, desktop, cloud, tickets, nginx config, PKI)
- Potential impact

### What to Expect

- **Acknowledgment** within 48 hours on a best-effort basis — this is a small-team project, so response times may vary
- **Status update** within 7 days on a best-effort basis, with an assessment and remediation timeline
- **Credit** in the release notes (unless you prefer to remain anonymous)

### What Qualifies

- mTLS bypass or certificate validation issues
- Authentication or authorization bypass (Authelia, panel middleware)
- Privilege escalation (agent role accessing admin endpoints)
- Secret or credential leakage
- Command injection or arbitrary code execution
- Path traversal or file access outside intended directories
- Cross-site scripting (XSS) in the panel client
- Insecure default configurations

### Out of Scope

- Denial of service against the droplet (resource exhaustion)
- Issues requiring physical access to the server
- Social engineering attacks
- Vulnerabilities in upstream dependencies (report those to the upstream project)

## Disclosure Policy

We follow coordinated disclosure. We ask that you give us reasonable time to
address the issue before any public disclosure. We aim to release fixes within
30 days of a confirmed vulnerability, but this is on a best-effort basis.

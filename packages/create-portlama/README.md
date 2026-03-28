# @lamalibre/create-portlama

One-command setup for secure reverse tunnels with a management dashboard.

## Quick Start

```bash
ssh root@<droplet-ip> "apt install -y npm && npx @lamalibre/create-portlama"
```

The installer runs unattended on a fresh Ubuntu 24.04 droplet and provisions
the full Portlama stack with zero prompts. When finished it prints:

- An SCP command to download the mTLS client certificate (`.p12`)
- The p12 password
- The panel URL (`https://<ip>:9292`)

Import the certificate into your browser and open the URL to begin onboarding.

### JSON Mode

For programmatic use (e.g. from the Portlama desktop app), pass `--json` to
replace the interactive Listr2 terminal UI with NDJSON progress lines on stdout:

```bash
npx @lamalibre/create-portlama --json
```

The `--json` flag implies `--yes` (no prompts) and `--dev` (accept private IPs).
Each line is a JSON object with one of these shapes:

```jsonl
{"event":"step","step":"check_environment","status":"running"}
{"event":"step","step":"harden_system","status":"complete"}
{"event":"step","step":"install_node","status":"skipped"}
{"event":"complete","server":{"ip":"...","panelUrl":"...","p12Path":"...","p12PasswordPath":"..."}}
{"event":"error","message":"...","recoverable":false}
```

## What It Provisions

- **OS hardening** — swap, UFW, fail2ban, SSH lockdown
- **Node.js 20 LTS**
- **mTLS PKI** — CA, server cert, client cert + PKCS12 bundle
- **nginx** — TLS on port 9292 with `ssl_verify_client on`
- **Panel server + client** — systemd service, static frontend

Domain setup, Chisel tunnels, Authelia, and Let's Encrypt certificates are
configured through the browser-based onboarding wizard after installation.

## Requirements

| Requirement | Details                 |
| ----------- | ----------------------- |
| OS          | Ubuntu 24.04 LTS        |
| Access      | root                    |
| Node.js     | >= 20.0.0               |
| RAM         | 512 MB minimum          |
| Recommended | DigitalOcean $4 droplet |

## Further Reading

See the main repository for architecture, development plan, and full
documentation: <https://github.com/lamalibre/portlama>

## Disclaimer

This software is provided "as is", without warranty of any kind, express or implied. The authors and contributors accept no liability for any damages, data loss, security incidents, or legal consequences arising from the use of this software.

Portlama is designed for self-hosted use cases — personal projects, development environments, demos, and internal tools. It is not a substitute for production infrastructure. Production workloads require dedicated hosting, load balancing, redundancy, monitoring, and operational expertise that are beyond the scope of this project.

**You are solely responsible for what you expose through Portlama.** By tunneling an application to the public internet, you grant anyone with access the ability to interact with that application as if they were on your local network. This carries inherent risks:

- **Arbitrary code execution:** If the tunneled application contains vulnerabilities or backdoors, remote attackers may exploit them to execute code on your machine, access your file system, or compromise your operating system.
- **Data exposure:** Misconfigured or insecure applications may leak sensitive data, credentials, or private files to the internet.
- **Lateral movement:** A compromised tunneled application may be used as an entry point to attack other devices and services on your local network.
- **Resource abuse:** Publicly accessible applications may be used for cryptocurrency mining, spam relaying, botnet hosting, or other abuse that could result in legal action against you.

Portlama provides authentication and access control mechanisms, but no security measure is absolute. It is your responsibility to understand the software you expose, keep it updated, and assess the risks of making it publicly accessible. The authors of Portlama bear no responsibility for the consequences of tunneling untrusted, vulnerable, or malicious software.

## License

[Polyform Noncommercial 1.0.0](./LICENSE.md) — see [LICENSE.md](./LICENSE.md) for details.

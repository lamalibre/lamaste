# Contributing to Portlama

Thank you for considering contributing. This document explains how to get started,
what we care about, and how to submit changes.

## Development Setup

```bash
git clone https://github.com/YOUR_ORG/portlama.git
cd portlama
npm install
```

### Running the panel in development

The panel backend needs a config file. Create a minimal one:

```bash
mkdir -p dev
cat > dev/panel.json <<EOF
{
  "port": 9292,
  "domain": "localhost",
  "jwtSecret": "dev-secret-not-for-production",
  "deployUser": "$(whoami)",
  "autheliaConfig": "/tmp/fake-authelia.yml",
  "autheliaUsers": "/tmp/fake-users.yml",
  "chiselAuth": "/tmp/fake-chisel-auth.txt",
  "chiselService": "chisel",
  "autheliaService": "authelia",
  "nginxConfigDir": "/tmp/nginx-available",
  "nginxEnabledDir": "/tmp/nginx-enabled",
  "certbotEmail": "dev@localhost",
  "pkiDir": "/tmp/portlama-pki"
}
EOF
export CONFIG_FILE=dev/panel.json
export NODE_ENV=development

npm run dev:server  # Fastify on :9292
npm run dev:client  # Vite on :5173
```

In development mode, `NODE_ENV=development` disables the mTLS check so you can
access the panel from a browser without importing a client certificate.

## Project Structure

Read `CLAUDE.md` at the root for a full map. Each package has its own `CLAUDE.md`
with implementation guides for the remaining work.

## What To Work On

Check the `🔲 TODO` items in:

- `CLAUDE.md` (root) — complete task list
- `packages/create-portlama/CLAUDE.md` — installer phases 2, 3, 4, 7
- `packages/panel-server/CLAUDE.md` — certbot.js, logs route, error middleware
- `packages/panel-client/CLAUDE.md` — Users.jsx, Certs.jsx, missing config files

## Code Standards

- **ES Modules only** — `import`/`export`, no `require()`
- **Async/await** — no callback-style async
- **execa for shell commands** — never `child_process.exec` or template strings in commands
- **Zod for API validation** — all route body inputs validated with a schema
- **Atomic file writes** — write to `.tmp` then `rename()` for any config file
- **bcrypt for passwords** — never argon2id (OOM on small VPS)

## Pull Request Process

1. Fork the repo and create a branch: `git checkout -b feat/my-feature`
2. Make your changes
3. Run syntax checks: `node --check packages/**/*.js`
4. Test the installer dry-run: `node packages/create-portlama/bin/create-portlama.js --help`
5. Submit a PR with a clear description of what changed and why

## PR Checklist

- [ ] No hardcoded secrets or credentials
- [ ] New shell operations use `execa` with array args (not string concatenation)
- [ ] New API routes have Zod validation
- [ ] New systemctl operations have a corresponding sudoers rule in `05-panel.js`
- [ ] CLAUDE.md updated if the architecture or conventions changed

## Reporting Issues

Use GitHub Issues. For security vulnerabilities, please email us directly rather
than opening a public issue.

## Code of Conduct

Be respectful. We're building infrastructure software — focus on technical merit.

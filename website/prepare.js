#!/usr/bin/env node

/**
 * Prepares the VitePress source directory:
 * 1. Copies markdown docs from @lamalibre/lamaste-docs (packages/core/docs) into website/src/
 * 2. Generates the sidebar config from _index.json
 * 3. Writes the landing page (index.md)
 *
 * Run before `vitepress build` or `vitepress dev`.
 */

import { readFileSync, writeFileSync, cpSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const docsSource = resolve(__dirname, '..', 'packages', 'core', 'docs');
const srcDir = resolve(__dirname, 'src');

// 1. Clean and copy docs into src/ — only the numbered section directories
// and _index.json. Skips package.json, scripts/, todo/, and loose design notes
// that live in @lamalibre/lamaste-docs but are not user-facing pages.
rmSync(srcDir, { recursive: true, force: true });
mkdirSync(srcDir, { recursive: true });
cpSync(docsSource, srcDir, {
  recursive: true,
  filter: (src) => {
    const rel = src.slice(docsSource.length).replace(/^\//, '');
    if (rel === '') return true;
    const topLevel = rel.split('/')[0];
    return /^\d{2}-/.test(topLevel) || topLevel === '_index.json';
  },
});

// Remove _index.json from the copy (not a page)
rmSync(resolve(srcDir, '_index.json'), { force: true });

console.log('Copied docs into website/src/');

// 2. Generate sidebar from _index.json
const index = JSON.parse(readFileSync(resolve(docsSource, '_index.json'), 'utf-8'));

// Omit `collapsed` so every section is permanently expanded — full tree always visible
const sidebar = index.sections.map((section) => ({
  text: section.title,
  items: section.pages.map((page) => ({
    text: page.title,
    link: `/${page.file.replace(/\.md$/, '')}`,
  })),
}));

// 3. Copy E2E test results into src/e2e-results/
const e2eSource = resolve(__dirname, '..', 'e2e-logs');
const e2eDest = resolve(srcDir, 'e2e-results');

/** Map of log filenames to sidebar display titles. */
const SINGLE_VM_TESTS = [
  ['single-test-01-fresh-install.md', '01 Fresh Install'],
  ['single-test-02-mtls-enforcement.md', '02 mTLS Enforcement'],
  ['single-test-03-onboarding-flow.md', '03 Onboarding Flow'],
  ['single-test-04-tunnel-lifecycle.md', '04 Tunnel Lifecycle'],
  ['single-test-05-user-lifecycle.md', '05 User Lifecycle'],
  ['single-test-06-service-control.md', '06 Service Control'],
  ['single-test-07-cert-renewal.md', '07 Cert Renewal'],
  ['single-test-08-mtls-rotation.md', '08 mTLS Rotation'],
  ['single-test-09-ip-fallback.md', '09 IP Fallback'],
  ['single-test-10-resilience.md', '10 Resilience'],
  ['single-test-11-input-validation.md', '11 Input Validation'],
  ['single-test-12-user-invitations.md', '12 User Invitations'],
  ['single-test-13-site-lifecycle.md', '13 Site Lifecycle'],
  ['single-test-15-plugin-lifecycle.md', '15 Plugin Lifecycle'],
  ['single-test-16-enrollment-tokens.md', '16 Enrollment Tokens'],
];

const THREE_VM_TESTS = [
  ['test-01-onboarding-complete.md', '01 Onboarding Complete'],
  ['test-02-tunnel-traffic.md', '02 Tunnel Traffic'],
  ['test-03-tunnel-toggle-traffic.md', '03 Tunnel Toggle'],
  ['test-04-authelia-auth.md', '04 Authelia Auth'],
  ['test-05-admin-journey.md', '05 Admin Journey'],
  ['test-06-tunnel-user-journey.md', '06 Tunnel User Journey'],
  ['test-07-site-visitor-journey.md', '07 Site Visitor Journey'],
  ['test-08-invitation-journey.md', '08 Invitation Journey'],
  ['test-09-agent-site-deploy.md', '09 Agent Site Deploy'],
  ['test-11-plugin-lifecycle.md', '11 Plugin Lifecycle'],
  ['test-12-enrollment-lifecycle.md', '12 Enrollment Lifecycle'],
];

/**
 * Copy an e2e log markdown file into the docs source, wrapping the test-output
 * body in a fenced code block. The raw logs contain placeholder text like
 * `agent-<label>` which vitepress's Vue compiler otherwise interprets as
 * unclosed HTML tags. Keeps the leading `# heading` and `> blockquote`
 * (if present) so the sidebar entry and page title still render.
 */
function copyE2eLog(src, dest) {
  const raw = readFileSync(src, 'utf-8');
  const lines = raw.split('\n');
  const headerLines = [];
  let i = 0;
  while (i < lines.length && (lines[i].startsWith('# ') || lines[i].startsWith('> '))) {
    headerLines.push(lines[i]);
    i++;
  }
  // Skip a single blank separator line, if present.
  if (i < lines.length && lines[i] === '') {
    headerLines.push('');
    i++;
  }
  const body = lines.slice(i).join('\n').trimEnd();
  const wrapped = `${headerLines.join('\n')}\n\n\`\`\`text\n${body}\n\`\`\`\n`;
  writeFileSync(dest, wrapped);
}

if (existsSync(e2eSource)) {
  mkdirSync(e2eDest, { recursive: true });

  // Copy summary files
  for (const name of ['single-vm-e2e.md', 'three-vm-e2e.md']) {
    const src = resolve(e2eSource, name);
    if (existsSync(src)) copyE2eLog(src, resolve(e2eDest, name));
  }

  // Copy individual test results
  const allTests = [...SINGLE_VM_TESTS, ...THREE_VM_TESTS];
  for (const [filename] of allTests) {
    const src = resolve(e2eSource, filename);
    if (existsSync(src)) copyE2eLog(src, resolve(e2eDest, filename));
  }

  // Also copy setup/orchestration logs
  for (const name of ['orchestrate.md', 'setup-host.md', 'setup-agent.md', 'setup-visitor.md']) {
    const src = resolve(e2eSource, name);
    if (existsSync(src)) copyE2eLog(src, resolve(e2eDest, name));
  }

  console.log('Copied E2E test results');
} else {
  console.warn('e2e-logs/ not found — skipping E2E results');
}

// Build sidebar — docs sections + E2E results
const e2eSidebarSections = [];

if (existsSync(e2eSource)) {
  const singleVmItems = [{ text: 'Summary', link: '/e2e-results/single-vm-e2e' }];
  for (const [filename, title] of SINGLE_VM_TESTS) {
    if (existsSync(resolve(e2eSource, filename))) {
      singleVmItems.push({
        text: title,
        link: `/e2e-results/${filename.replace(/\.md$/, '')}`,
      });
    }
  }
  e2eSidebarSections.push({ text: 'E2E: Single-VM', items: singleVmItems });

  const threeVmItems = [{ text: 'Summary', link: '/e2e-results/three-vm-e2e' }];
  for (const [filename, title] of THREE_VM_TESTS) {
    if (existsSync(resolve(e2eSource, filename))) {
      threeVmItems.push({
        text: title,
        link: `/e2e-results/${filename.replace(/\.md$/, '')}`,
      });
    }
  }
  e2eSidebarSections.push({ text: 'E2E: Three-VM', items: threeVmItems });
}

const fullSidebar = [...sidebar, ...e2eSidebarSections];

const sidebarPath = resolve(__dirname, '.vitepress', 'sidebar.json');
writeFileSync(sidebarPath, JSON.stringify(fullSidebar, null, 2) + '\n');
console.log(`Wrote ${fullSidebar.length} sidebar sections`);

// 3. Write landing page
const landingPage = `---
layout: home

hero:
  name: Lamaste
  text: Self-hosted secure tunneling
  tagline: Expose local web apps through a cheap VPS. Zero-login admin via client certificates. Never SSH again.
  actions:
    - theme: brand
      text: Get Started
      link: /00-introduction/what-is-lamaste
    - theme: alt
      text: Quick Start
      link: /00-introduction/quickstart
    - theme: alt
      text: API Reference
      link: /04-api-reference/overview

features:
  - title: Zero-Config Setup
    details: One npx command provisions a VPS. Onboarding wizard handles domain, DNS, and certificates through the browser.
  - title: mTLS Security
    details: Admin panel protected by client certificates. No passwords, no SSH keys. Hardware-bound certificates via macOS Keychain.
  - title: Plugin Ecosystem
    details: Shell, Sync, Herd, and Caravana plugins extend the platform. Each works standalone or integrated via the tunnel.
  - title: Self-Hosted
    details: Your data stays on your machines. The VPS is just a relay. Local-first, cost-aware, encryption by default.
---
`;

writeFileSync(resolve(srcDir, 'index.md'), landingPage);
console.log('Wrote landing page');

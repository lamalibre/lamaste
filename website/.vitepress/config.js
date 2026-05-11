import { defineConfig } from 'vitepress';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

let sidebar;
try {
  sidebar = JSON.parse(readFileSync(resolve(__dirname, 'sidebar.json'), 'utf-8'));
} catch {
  console.warn('sidebar.json not found — run "node build-sidebar.js" first');
  sidebar = [];
}

export default defineConfig({
  title: 'Lamaste',
  description: 'Self-hosted secure tunneling platform',

  // GitHub Pages deploys to https://<org>.github.io/lamaste/
  base: '/lamaste/',

  srcDir: resolve(__dirname, '..', 'src'),
  outDir: resolve(__dirname, 'dist'),

  head: [['link', { rel: 'icon', type: 'image/svg+xml', href: '/lamaste/logo.svg' }]],

  themeConfig: {
    siteTitle: 'Lamaste',
    logo: '/logo.svg',

    sidebar,

    nav: [
      { text: 'Guide', link: '/00-introduction/what-is-lamaste' },
      { text: 'API Reference', link: '/04-api-reference/overview' },
      { text: 'E2E Results', link: '/e2e-results/single-vm-e2e' },
    ],

    socialLinks: [{ icon: 'github', link: 'https://github.com/lamalibre/lamaste' }],

    search: {
      provider: 'local',
    },

    editLink: {
      pattern:
        'https://github.com/lamalibre/lamaste/edit/main/packages/panel-client/public/docs/:path',
      text: 'Edit this page on GitHub',
    },

    footer: {
      message: 'Released under the PolyForm Noncommercial License 1.0.0',
      copyright: 'Copyright 2026 Code Lama Software',
    },

    outline: {
      level: [2, 3],
    },
  },

  // Skip dead-link checks for panel-internal links
  ignoreDeadLinks: true,
});

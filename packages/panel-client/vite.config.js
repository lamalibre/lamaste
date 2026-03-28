import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

const adminPanelPath = path.resolve(__dirname, '../portlama-admin-panel/src');

export default defineConfig({
  plugins: [
    react({
      // Include the workspace-linked admin-panel package in JSX transformation
      include: [/\.jsx$/, /\.tsx$/],
    }),
  ],
  resolve: {
    // Ensure workspace symlinks are followed
    preserveSymlinks: false,
  },
  optimizeDeps: {
    // Include the admin-panel so Vite pre-bundles it correctly
    include: ['@lamalibre/portlama-admin-panel'],
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3100',
        changeOrigin: true,
      },
      '/api/ws': {
        target: 'ws://127.0.0.1:3100',
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    commonjsOptions: {
      // Allow workspace packages to be processed
      include: [/portlama-admin-panel/, /node_modules/],
    },
  },
});

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [
    react({
      include: [/\.jsx$/, /\.tsx$/],
    }),
  ],
  resolve: {
    preserveSymlinks: false,
  },
  optimizeDeps: {
    include: ['@lamalibre/lamaste-server-ui', '@lamalibre/lamaste-agent-ui'],
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    commonjsOptions: {
      include: [/lamaste-server-ui/, /lamaste-agent-ui/, /node_modules/],
    },
  },
});

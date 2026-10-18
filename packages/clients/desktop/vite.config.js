import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ command }) => {
  // `vite build` is a production build whatever NODE_ENV the shell exports.
  // Vite reads NODE_ENV before loading this file and decides afterwards: with
  // NODE_ENV=development it emitted React's development build, carrying this
  // machine's source paths (scripts/assert-production-bundle.js).
  if (command === 'build') process.env.NODE_ENV = 'production';
  return {
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
  };
});

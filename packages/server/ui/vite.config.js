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
        '/docs': {
          target: 'http://127.0.0.1:3100',
          changeOrigin: true,
        },
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: false,
    },
  };
});

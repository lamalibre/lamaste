import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [
    react({
      include: [/\.jsx$/],
    }),
  ],
  build: {
    outDir: 'dist-web',
    sourcemap: false,
  },
});

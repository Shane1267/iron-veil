import { defineConfig } from 'vite';

// One config for the browser game (dist/) and the online server bundle (dist-server/,
// built with `vite build --ssr server/index.js`).
export default defineConfig(({ isSsrBuild }) => ({
  base: './',
  server: { port: 5173, open: false },
  build: {
    target: isSsrBuild ? 'node18' : 'es2020',
    outDir: isSsrBuild ? 'dist-server' : 'dist',
    chunkSizeWarningLimit: 1500,
    rollupOptions: isSsrBuild ? {} : {
      output: {
        manualChunks: { three: ['three'] },
      },
    },
  },
  test: {
    include: ['tests/unit/**/*.test.js'],
    environment: 'node',
  },
}));

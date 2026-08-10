import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Keywulf is a static site. Vite copies everything in /public verbatim into
// /dist (including data/today.json and _headers), and fingerprints the JS/CSS
// it bundles so those can be cached forever. See public/_headers for the
// cache policy that keeps today.json fresh.
export default defineConfig({
  plugins: [react()],
  build: {
    target: 'es2021',
    sourcemap: false,
    // Keep chunks predictable; the app is small enough not to need manual splits.
    rollupOptions: {
      output: {
        manualChunks: undefined,
      },
    },
  },
});

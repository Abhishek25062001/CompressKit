import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// CompressKit is a fully static, client-side app. No server code, no env vars.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  worker: {
    // Module workers let the video worker dynamically import the FFmpeg core.
    format: 'es',
  },
  optimizeDeps: {
    // These packages locate their .wasm files relative to import.meta.url,
    // which breaks if Vite pre-bundles them.
    exclude: ['@ffmpeg/core', '@jsquash/avif'],
  },
  build: {
    target: 'es2022',
    // The FFmpeg core (~32 MB wasm) is an asset that is only fetched on demand.
    chunkSizeWarningLimit: 1200,
  },
});
